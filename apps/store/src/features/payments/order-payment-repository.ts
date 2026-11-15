import { and, eq, isNull, sql } from "drizzle-orm";
import {
  cartItems,
  db,
  orderItems,
  jubelioSalesOperations,
  orderPaymentSessions,
  orders,
} from "@/db";
import type {
  OrderCartSelection,
  OrderPaymentSessionProvenance,
  OrderPaymentSessionState,
} from "@marketplace/db/src/schema";
import type { PaymentInitializationOutcome } from "./payment-evidence";
import { readOrderPricing } from "@/lib/versioned-pricing";
import { buildPaymentItemDetails } from "@/lib/payment-item-details";

/**
 * Persistence ledger payment session milik order (spec TX-02 §8.1/§12).
 *
 * Aturan yang dijaga di sini:
 * - Satu order = satu baris; `provider_reference` immutable.
 * - Klaim dispatch adalah CAS `intent → dispatched_unknown` dengan
 *   `dispatch_claim_id` yang disimpan SEBELUM provider POST.
 * - Ownership/eligibility, deadline, confirmed SO, dan absennya cancel aktif
 *   diperiksa ulang di dalam transaksi yang sama dengan klaim.
 * - Hasil `ready` menyimpan token + redirect ke session DAN
 *   `orders.snap_redirect_url` pada satu transaksi, lalu menghapus cart
 *   selection asli secara idempoten.
 * - Tidak ada HTTP provider di modul ini.
 */

export type OrderPaymentWriteDatabase = Pick<
  typeof db,
  "select" | "insert" | "update" | "transaction"
>;
type SessionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OrderPaymentClaim =
  | { claimed: false; reason: "not_found" }
  | {
      claimed: false;
      reason: "not_eligible";
      orderStatus: string;
      paymentStatus: string;
    }
  | { claimed: false; reason: "deadline_passed" }
  | { claimed: false; reason: "sales_order_not_confirmed" }
  | { claimed: false; reason: "cancel_active" }
  | { claimed: false; reason: "already_claimed" }
  | { claimed: false; reason: "ready"; redirectUrl: string }
  | { claimed: false; reason: "rejected" | "paid" | "expired" | "manual_review" }
  | { claimed: false; reason: "legacy_unknown" }
  | {
      claimed: true;
      sessionId: string;
      dispatchClaimId: string;
      providerReference: string;
      expectedAmount: string;
      paymentStartedAt: Date;
      expiresAt: Date;
      cartSnapshot: OrderCartSelection[] | null;
    };

const SESSION_ACTIVE_CLAIM = "dispatched_unknown";
const CANCEL_ACTIVE_STATUSES = ["intent", "dispatched_unknown", "confirmed", "manual_review"] as const;

async function lockOrder(tx: SessionTx, orderId: string) {
  await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
  const [row] = await tx
    .select({
      id: orders.id,
      userId: orders.userId,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      total: orders.total,
      expiresAt: orders.expiresAt,
      snapRedirectUrl: orders.snapRedirectUrl,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .for("update")
    .limit(1);
  return row ?? null;
}

async function readSession(tx: SessionTx, orderId: string) {
  const [row] = await tx
    .select()
    .from(orderPaymentSessions)
    .where(eq(orderPaymentSessions.orderId, orderId))
    .for("update")
    .limit(1);
  return row ?? null;
}

async function salesOrderReadiness(tx: SessionTx, orderId: string) {
  const rows = await tx
    .select({ type: jubelioSalesOperations.type, status: jubelioSalesOperations.status })
    .from(jubelioSalesOperations)
    .where(eq(jubelioSalesOperations.orderId, orderId));
  const create = rows.find((row) => row.type === "create");
  const cancel = rows.find((row) => row.type === "cancel");
  return {
    createConfirmed: create ? create.status === "confirmed" : false,
    hasCreate: !!create,
    cancelActive: !!cancel && (CANCEL_ACTIVE_STATUSES as readonly string[]).includes(cancel.status),
  };
}

/**
 * Records the payment intent + exact cart selection INSIDE the initial order
 * transaction, before any provider call. Without this row an initialization
 * cannot claim anything (spec §8.1).
 */
export async function recordOrderPaymentIntent(
  tx: SessionTx,
  input: {
    orderId: string;
    providerReference: string;
    expectedAmount: string;
    paymentStartedAt: Date;
    expiresAt: Date;
    cartSnapshot: OrderCartSelection[];
    now: Date;
  }
): Promise<{ sessionId: string }> {
  const [inserted] = await tx
    .insert(orderPaymentSessions)
    .values({
      id: crypto.randomUUID(),
      orderId: input.orderId,
      providerReference: input.providerReference,
      provenance: "runtime",
      state: "intent",
      expectedAmount: input.expectedAmount,
      currency: "IDR",
      paymentStartedAt: input.paymentStartedAt,
      expiresAt: input.expiresAt,
      cartSnapshot: input.cartSnapshot,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: orderPaymentSessions.orderId })
    .returning({ id: orderPaymentSessions.id });
  if (inserted) return { sessionId: inserted.id };
  const [existing] = await tx
    .select({ id: orderPaymentSessions.id })
    .from(orderPaymentSessions)
    .where(eq(orderPaymentSessions.orderId, input.orderId))
    .limit(1);
  if (!existing) throw new Error("Payment session intent could not be recorded");
  return { sessionId: existing.id };
}

/**
 * At-most-once dispatch claim shared by legacy initial payment and repayment.
 *
 * Returns the durable reason when this caller may not dispatch. A loser never
 * receives `claimed: true`, so at most one provider session can ever be created.
 */
export async function claimOrderPaymentInitialization(
  input: { orderId: string; clientId: string; now: Date; adoptHistoricalRedirect?: boolean },
  database: OrderPaymentWriteDatabase = db
): Promise<OrderPaymentClaim> {
  return database.transaction(async (tx) => {
    const order = await lockOrder(tx, input.orderId);
    if (!order) return { claimed: false, reason: "not_found" } as const;
    if (order.userId !== input.clientId) return { claimed: false, reason: "not_found" } as const;

    const session = await readSession(tx, input.orderId);

    // Durable states always win over a new initialization.
    if (session?.state === "ready") {
      return {
        claimed: false,
        reason: "ready",
        redirectUrl: session.redirectUrl ?? "",
      } as const;
    }
    if (session && ["rejected", "paid", "expired", "manual_review"].includes(session.state)) {
      return { claimed: false, reason: session.state as "rejected" | "paid" | "expired" | "manual_review" } as const;
    }
    if (session?.state === SESSION_ACTIVE_CLAIM) {
      return { claimed: false, reason: "already_claimed" } as const;
    }

    if (order.status !== "pending_payment" || order.paymentStatus !== "pending") {
      return {
        claimed: false,
        reason: "not_eligible",
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
      } as const;
    }

    const readiness = await salesOrderReadiness(tx, input.orderId);
    if (readiness.cancelActive) return { claimed: false, reason: "cancel_active" } as const;
    if (readiness.hasCreate && !readiness.createConfirmed) {
      return { claimed: false, reason: "sales_order_not_confirmed" } as const;
    }

    // Historical order without a ledger row: adopt a still-valid redirect, or
    // record it as legacy_unknown. A missing row is NEVER proof of never-sent.
    if (!session) {
      if (input.adoptHistoricalRedirect && order.snapRedirectUrl) {
        await tx
          .insert(orderPaymentSessions)
          .values({
            id: crypto.randomUUID(),
            orderId: input.orderId,
            providerReference: input.orderId,
            provenance: "adopted_redirect",
            state: "ready",
            expectedAmount: order.total,
            currency: "IDR",
            paymentStartedAt: null,
            expiresAt: order.expiresAt,
            redirectUrl: order.snapRedirectUrl,
            lastVerifiedStatus: "adopted",
            lastVerifiedAt: input.now,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({ target: orderPaymentSessions.orderId });
        return { claimed: false, reason: "ready", redirectUrl: order.snapRedirectUrl } as const;
      }
      await tx
        .insert(orderPaymentSessions)
        .values({
          id: crypto.randomUUID(),
          orderId: input.orderId,
          providerReference: input.orderId,
          provenance: "legacy_unknown",
          state: "manual_review",
          expectedAmount: order.total,
          currency: "IDR",
          paymentStartedAt: null,
          expiresAt: order.expiresAt,
          lastErrorCode: "legacy_unknown",
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: orderPaymentSessions.orderId });
      return { claimed: false, reason: "legacy_unknown" } as const;
    }

    if (!session.paymentStartedAt || !session.expiresAt) {
      return { claimed: false, reason: "legacy_unknown" } as const;
    }
    if (session.expiresAt.getTime() <= input.now.getTime()) {
      return { claimed: false, reason: "deadline_passed" } as const;
    }

    const dispatchClaimId = crypto.randomUUID();
    const [claimed] = await tx
      .update(orderPaymentSessions)
      .set({
        state: SESSION_ACTIVE_CLAIM,
        dispatchClaimId,
        dispatchedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(orderPaymentSessions.id, session.id),
          eq(orderPaymentSessions.state, "intent"),
          isNull(orderPaymentSessions.dispatchClaimId)
        )
      )
      .returning({ id: orderPaymentSessions.id });
    if (!claimed) return { claimed: false, reason: "already_claimed" } as const;

    return {
      claimed: true,
      sessionId: session.id,
      dispatchClaimId,
      providerReference: session.providerReference,
      expectedAmount: session.expectedAmount,
      paymentStartedAt: session.paymentStartedAt,
      expiresAt: session.expiresAt,
      cartSnapshot: session.cartSnapshot ?? null,
    } as const;
  });
}

export type OrderPaymentOutcomeResult =
  | { kind: "ready"; redirectUrl: string; token: string; cartLinesDeleted: number }
  | { kind: "unknown" }
  | { kind: "rejected" }
  | { kind: "claim_lost" };

/**
 * Persist the dispatch owner's outcome. `ready` writes the session handle,
 * `orders.snap_redirect_url`, and the idempotent cart cleanup in ONE local
 * commit; a crash before this leaves the row `dispatched_unknown` (unknown).
 */
export async function recordOrderPaymentOutcome(
  input: {
    sessionId: string;
    dispatchClaimId: string;
    outcome: PaymentInitializationOutcome;
    now: Date;
  },
  database: OrderPaymentWriteDatabase = db
): Promise<OrderPaymentOutcomeResult> {
  return database.transaction(async (tx) => {
    // Lock order FIRST, then the session child: the claim path uses the same
    // order → session order, so a concurrent claim/outcome can never deadlock.
    const [identity] = await tx
      .select({ orderId: orderPaymentSessions.orderId })
      .from(orderPaymentSessions)
      .where(eq(orderPaymentSessions.id, input.sessionId))
      .limit(1);
    if (!identity) return { kind: "claim_lost" } as const;
    await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, identity.orderId))
      .for("update")
      .limit(1);
    const [session] = await tx
      .select()
      .from(orderPaymentSessions)
      .where(eq(orderPaymentSessions.id, input.sessionId))
      .for("update")
      .limit(1);
    if (!session || session.dispatchClaimId !== input.dispatchClaimId) {
      return { kind: "claim_lost" } as const;
    }
    if (session.state !== SESSION_ACTIVE_CLAIM) {
      // Another owner already recorded an outcome for this claim.
      return { kind: "claim_lost" } as const;
    }

    if (input.outcome.kind === "unknown") {
      await tx
        .update(orderPaymentSessions)
        .set({
          lastErrorCode: input.outcome.code,
          lastVerifiedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(orderPaymentSessions.id, session.id));
      return { kind: "unknown" } as const;
    }

    if (input.outcome.kind === "definitive_rejection") {
      const [rejected] = await tx
        .update(orderPaymentSessions)
        .set({
          state: "rejected",
          lastErrorCode: input.outcome.code,
          lastVerifiedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(orderPaymentSessions.id, session.id),
            eq(orderPaymentSessions.state, SESSION_ACTIVE_CLAIM),
            eq(orderPaymentSessions.dispatchClaimId, input.dispatchClaimId)
          )
        )
        .returning({ id: orderPaymentSessions.id });
      return rejected ? ({ kind: "rejected" } as const) : ({ kind: "claim_lost" } as const);
    }

    const [ready] = await tx
      .update(orderPaymentSessions)
      .set({
        state: "ready",
        token: input.outcome.token,
        redirectUrl: input.outcome.redirectUrl,
        lastErrorCode: null,
        lastVerifiedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(orderPaymentSessions.id, session.id),
          eq(orderPaymentSessions.state, SESSION_ACTIVE_CLAIM),
          eq(orderPaymentSessions.dispatchClaimId, input.dispatchClaimId)
        )
      )
      .returning({ id: orderPaymentSessions.id, orderId: orderPaymentSessions.orderId });
    if (!ready) return { kind: "claim_lost" } as const;

    await tx
      .update(orders)
      .set({ snapRedirectUrl: input.outcome.redirectUrl, updatedAt: input.now })
      .where(eq(orders.id, ready.orderId));

    // Idempotent cleanup of the EXACT selection that produced this order. A
    // historical row without a snapshot never guesses which cart line to drop.
    let cartLinesDeleted = 0;
    for (const line of session.cartSnapshot ?? []) {
      const deleted = await tx
        .delete(cartItems)
        .where(
          and(
            eq(cartItems.id, line.itemId),
            eq(cartItems.cartId, line.cartId),
            eq(cartItems.variantId, line.variantId),
            eq(cartItems.quantity, line.quantity)
          )
        )
        .returning({ id: cartItems.id });
      cartLinesDeleted += deleted.length;
    }

    return {
      kind: "ready",
      redirectUrl: input.outcome.redirectUrl,
      token: input.outcome.token,
      cartLinesDeleted,
    } as const;
  });
}

export type OrderPaymentEvidence = {
  state: OrderPaymentSessionState;
  provenance: OrderPaymentSessionProvenance;
  dispatchClaimId: string | null;
  dispatchedAt: Date | null;
  expiresAt: Date | null;
  paymentStartedAt: Date | null;
  redirectUrl: string | null;
  /** Durable classification used by recovery (never inferred from absence). */
  classification: "never_sent" | "possibly_sent" | "unknown";
};

/** Internal, authenticated evidence read (never a browser endpoint). */
export async function loadOrderPaymentEvidence(
  input: { orderId: string },
  database: Pick<typeof db, "select"> = db
): Promise<OrderPaymentEvidence | null> {
  const [row] = await database
    .select({
      state: orderPaymentSessions.state,
      provenance: orderPaymentSessions.provenance,
      dispatchClaimId: orderPaymentSessions.dispatchClaimId,
      dispatchedAt: orderPaymentSessions.dispatchedAt,
      expiresAt: orderPaymentSessions.expiresAt,
      paymentStartedAt: orderPaymentSessions.paymentStartedAt,
      redirectUrl: orderPaymentSessions.redirectUrl,
    })
    .from(orderPaymentSessions)
    .where(eq(orderPaymentSessions.orderId, input.orderId))
    .limit(1);
  if (!row) return null;
  const classification: OrderPaymentEvidence["classification"] =
    row.dispatchClaimId != null
      ? "possibly_sent"
      : row.state === "intent"
        ? "never_sent"
        : row.provenance === "legacy_unknown"
          ? "unknown"
          : "possibly_sent";
  return {
    ...row,
    state: row.state as OrderPaymentSessionState,
    provenance: row.provenance as OrderPaymentSessionProvenance,
    classification,
  };
}

export type OrderPaymentRecoveryView = {
  state: OrderPaymentSessionState;
  message: string;
  paymentAvailable: boolean;
  canInitialize: boolean;
  redirectUrl: string | null;
  expiresAt: string | null;
};

const recoveryMessages: Record<OrderPaymentSessionState, string> = {
  intent: "Pembayaran belum disiapkan. Batas waktu pembayaran tetap sama.",
  dispatched_unknown:
    "Status pembayaran belum dapat dipastikan. Periksa status pembayaran dan jangan membuat pembayaran baru.",
  ready: "Pembayaran sudah disiapkan. Batas waktu pembayaran tetap sama.",
  rejected: "Pembayaran belum dapat disiapkan. Pesanan tidak dilanjutkan otomatis.",
  manual_review: "Status pembayaran sedang diperiksa. Jangan membuat pembayaran baru.",
  paid: "Pembayaran diterima. Tidak perlu membayar ulang.",
  expired: "Waktu pembayaran sudah habis.",
};

/**
 * Owner-scoped safe projection for the order detail surface. No token, no
 * provenance, no claim id, no raw provider payload.
 */
export async function readOwnedOrderPaymentRecovery(
  input: { orderId: string; clientId: string; now: Date },
  database: Pick<typeof db, "select"> = db
): Promise<OrderPaymentRecoveryView | null> {
  const [row] = await database
    .select({
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      expiresAt: orders.expiresAt,
      snapRedirectUrl: orders.snapRedirectUrl,
      state: orderPaymentSessions.state,
      sessionExpiresAt: orderPaymentSessions.expiresAt,
      sessionRedirectUrl: orderPaymentSessions.redirectUrl,
    })
    .from(orders)
    .leftJoin(orderPaymentSessions, eq(orderPaymentSessions.orderId, orders.id))
    .where(and(eq(orders.id, input.orderId), eq(orders.userId, input.clientId)))
    .limit(1);
  if (!row) return null;

  const rawState = row.state as OrderPaymentSessionState | null;
  const deadline = row.sessionExpiresAt ?? row.expiresAt;
  const unexpired = deadline ? deadline.getTime() > input.now.getTime() : false;
  const payable =
    row.status === "pending_payment" && row.paymentStatus === "pending" && unexpired;
  const redirectUrl = row.sessionRedirectUrl ?? row.snapRedirectUrl ?? null;

  const state: OrderPaymentSessionState =
    rawState ??
    (row.paymentStatus === "paid"
      ? "paid"
      : redirectUrl
        ? "ready"
        : row.paymentStatus === "failed"
          ? "expired"
          : "manual_review");

  const paymentAvailable = payable && state === "ready" && !!redirectUrl;
  const canInitialize = payable && (state === "intent" || (!rawState && !redirectUrl));
  return {
    state,
    message:
      state === "paid" || row.paymentStatus === "paid"
        ? recoveryMessages.paid
        : rawState === null && !redirectUrl && row.paymentStatus === "pending"
          ? "Status pembayaran sedang diperiksa. Jangan membuat pembayaran baru."
          : recoveryMessages[state],
    paymentAvailable,
    canInitialize,
    redirectUrl: paymentAvailable ? redirectUrl : null,
    expiresAt: deadline ? deadline.toISOString() : null,
  };
}

export type SnapSessionRequest = {
  customer: { first_name: string; email: string; phone: string };
  items: Array<{ id: string; name: string; price: number; quantity: number }>;
  expectedAmount: string;
  expiresAt: Date;
};

/**
 * Persisted provider request context for repayment: the order OWN snapshot and
 * versioned pricing decoder, never the cart or current master data. Initial
 * legacy keeps its already approved item details and passes its own request.
 */
export async function loadSnapSessionRequest(
  orderId: string,
  database: Pick<typeof db, "select"> = db
): Promise<SnapSessionRequest | null> {
  const [order] = await database
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const items = await database
    .select({
      productName: orderItems.productName,
      variantId: orderItems.variantId,
      price: orderItems.price,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const pricing = readOrderPricing(order);
  // item_details must sum to gross_amount, so the persisted snapshot (not raw
  // master prices) builds the provider request — same shape the old route used.
  const details =
    pricing.pricingContractVersion === 1
      ? buildPaymentItemDetails({
          items: pricing.lines.map((line) => ({
            id: line.variantId,
            name:
              items.find((item) => item.variantId === line.variantId)?.productName ?? "Product",
            price: line.effectiveUnitPrice,
            quantity: line.quantity,
          })),
          discount: pricing.goodsDiscount,
          shippingCost: pricing.shippingCost,
          serviceFee: pricing.serviceFee,
          ppnRatePercent: pricing.ppnRatePercent,
          ppnAmount: pricing.ppnAmount,
          total: pricing.total,
        })
      : buildPaymentItemDetails({
          items: items.map((item) => ({
            id: item.variantId,
            name: item.productName,
            price: item.price,
            quantity: item.quantity,
          })),
          discount: pricing.discount,
          shippingCost: pricing.shippingCost,
          serviceFee: pricing.serviceFee,
          ppnRatePercent: pricing.ppnRatePercent,
          ppnAmount: pricing.ppnAmount,
          total: pricing.total,
        });
  return {
    customer: {
      first_name: order.contactEmail.split("@")[0] || "Customer",
      email: order.contactEmail,
      phone: order.contactPhone,
    },
    items: details,
    expectedAmount: pricing.total,
    expiresAt: order.expiresAt ?? new Date(),
  };
}

export type RepaymentOrderContext = {
  orderId: string;
  status: string;
  paymentStatus: string;
  expiresAt: Date | null;
  hasSalesOrder: boolean;
  pricing: ReturnType<typeof readOrderPricing>;
};

/**
 * Owner-scoped repayment guard read. The strict pricing decoder runs before any
 * claim so an unknown contract can never reach the payment provider.
 */
export async function loadRepaymentOrderContext(
  input: { orderId: string; clientId: string },
  database: Pick<typeof db, "select"> = db
): Promise<RepaymentOrderContext | null> {
  const [order] = await database
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.userId, input.clientId)))
    .limit(1);
  if (!order) return null;
  return {
    orderId: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    expiresAt: order.expiresAt,
    hasSalesOrder: order.jubelioSalesOrderId != null,
    pricing: readOrderPricing(order),
  };
}
