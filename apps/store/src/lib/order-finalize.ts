import { db } from "@/db";
import {
  orders,
  orderItems,
  branches,
  notifications,
  jubelioSalesOperations,
} from "@/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { sendEmail } from "@/lib/email";
import {
  pickupReadyEmailHTML,
  pickupReadyEmailText,
  paymentFailedEmailHTML,
  paymentFailedEmailText,
} from "@/lib/email-templates-order";
import { createModuleLogger } from "@/lib/logger";
import { generatePickupCode } from "@/lib/pickup-code";
import { dispatchJubelioSalesCancel } from "@/lib/jubelio-sales-lifecycle";
import {
  consumeReservedRedemption,
  findRedemptionForOrder,
  lockRedemptionOwners,
  recordLatePaidReview,
} from "@/lib/discount-lifecycle";

export { generatePickupCode } from "@/lib/pickup-code";

/**
 * Module-scope logger: hanya nama module yang diikat di sini. `requestId`
 * dibaca dari scope AsyncLocalStorage saat baris ditulis, jadi membuatnya sekali
 * ketika module dievaluasi (sebelum scope HTTP ada) adalah benar.
 */
const log = createModuleLogger("order-finalize");

/** Bentuk token kode yang boleh diteruskan: uppercase + angka + underscore. */
const SAFE_LOG_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Proyeksi error statis milik module ini; teks asli provider tidak disalin. */
class OrderFinalizeLogError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "OrderFinalizeLogError";
    this.code = code;
  }
}

/**
 * Error dependency (penyimpanan/transport/notifikasi) diproyeksikan statis:
 * pesan konstan milik module, dan `code` hanya bila bentuknya token aman.
 * `message`, `stack`, `cause`, serta teks hasil provider tidak pernah disalin
 * ke log.
 */
function safeDependencyErrorLog(error: unknown): OrderFinalizeLogError {
  return new OrderFinalizeLogError(
    "Order finalize gagal pada lapisan penyimpanan, transport atau notifikasi",
    knownLogCode(error)
  );
}

function knownLogCode(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return undefined;
    }
    const code = error.code;
    return typeof code === "string" && SAFE_LOG_CODE.test(code) ? code : undefined;
  } catch {
    // Nilai hostile (getter/proxy melempar) tidak membawa sinyal aman.
    return undefined;
  }
}

/**
 * Map a Midtrans transaction_status to a human-readable failure reason.
 * Returns null for non-failure statuses. Only used for terminal failures
 * (`expire`); deny/cancel are non-terminal attempt failures in the multi-method
 * Snap flow (the customer may retry with another method on the same order).
 */
export function describeFailureReason(
  transactionStatus: string,
  statusMessage?: string
): string | null {
  switch (transactionStatus) {
    case "expire":
      return "Payment expired — user did not complete payment in time";
    case "deny":
      return statusMessage
        ? `Payment denied by issuer/acquirer (${statusMessage})`
        : "Payment denied by issuer/acquirer";
    case "cancel":
      return "Payment cancelled";
    default:
      return null;
  }
}

/**
 * Classify an authoritative Midtrans transaction status into a webhook action.
 * Pure helper so the multi-attempt semantics are unit-testable.
 *
 * - "finalize" → payment succeeded (settlement, or capture with accepted fraud).
 * - "fail"     → terminal failure (expire): cancel the Sales Order.
 * - "defer"    → non-terminal (pending/deny/cancel/failure): Snap allows the
 *   customer to retry with another method on the same order, so the order must
 *   stay pending_payment until settlement or the TTL sweep.
 */
export function resolvePaymentOutcome(
  transactionStatus: string,
  fraudStatus?: string
): "finalize" | "fail" | "defer" {
  if (transactionStatus === "settlement") return "finalize";
  if (transactionStatus === "capture") {
    return fraudStatus === "accept" ? "finalize" : "defer";
  }
  if (transactionStatus === "expire") return "fail";
  return "defer";
}

export type FinalizeResult = {
  claimed: boolean;
  pickupCode?: string | null;
};

/**
 * Authoritative payment attributes (from Midtrans GET status, never the raw
 * webhook body) persisted atomically with the finalization claim.
 */
export type PaymentAttributes = {
  paymentType?: string;
  transactionId?: string;
};

/**
 * Minimal view of an order row needed by the finalizer. Callers pass the order
 * they already loaded (webhook) or a freshly loaded one (sweep); the finalizer
 * does not reload it for the claim — the claim-guard UPDATE is the source of
 * truth for who wins the race.
 */
export type OrderView = {
  id: string;
  branchId: string | null;
  contactEmail: string;
  total: string;
  subtotal: string;
  serviceFee: string;
  ppnRate: string;
  ppnAmount: string;
  pickupDate: Date | null;
  pickupTime: string | null;
};

/**
 * Claim a paid order (pending_payment → processing + paid) WITHOUT exposing
 * fulfillment. Sales-Order settlement (invoice → payment verification) gates
 * `ready_for_pickup`: the claim guard serializes the webhook-vs-sweep race,
 * and only a VERIFIED settlement may move the order to ready_for_pickup.
 * If 0 rows are updated, another handler already processed the order.
 */
export async function claimPaidOrder(
  orderId: string,
  paymentAttributes?: PaymentAttributes
): Promise<FinalizeResult> {
  const redemption = await findRedemptionForOrder(orderId);
  const claimed = await db.transaction(async (tx) => {
    // Lock group 3 before group 5: Offer → usage → client usage, then the
    // existing order → Redemption. A concurrent webhook/sweep serializes here.
    if (redemption && redemption.status === "reserved") {
      await lockRedemptionOwners(tx, redemption);
    }
    const [current] = await tx
      .select({ id: orders.id, status: orders.status, paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);
    if (!current || current.status !== "pending_payment" || current.paymentStatus !== "pending") {
      log.info(
        `Order ${orderId}: paid-order claim lost — already handled by another path`
      );
      return false;
    }
    await tx
      .update(orders)
      .set({
        status: "processing",
        paymentStatus: "paid",
        ...(paymentAttributes?.paymentType
          ? { paymentMethod: paymentAttributes.paymentType }
          : {}),
        ...(paymentAttributes?.transactionId
          ? { midtransTransactionId: paymentAttributes.transactionId }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
    if (redemption) {
      const consumed = await consumeReservedRedemption(tx, {
        identity: redemption,
        redemptionId: redemption.id,
        source: "midtrans",
        correlation: paymentAttributes?.transactionId ?? null,
      });
      if (!consumed) {
        // Paid authoritative must never lose its evidence: if the hold was
        // already released, keep it released and record ONE review event.
        const reviewed = await recordLatePaidReview(tx, {
          orderId,
          correlation: paymentAttributes?.transactionId ?? null,
          reason: "Paid arrived after the Redemption was released",
        });
        if (reviewed) {
          await tx.update(orders)
            .set({ fulfillmentBlockedReason: "Paid after Redemption release; manual review required", updatedAt: new Date() })
            .where(eq(orders.id, orderId));
          log.warn(
            `Order ${orderId}: paid after Redemption release — late review recorded, fulfillment blocked`
          );
        }
      }
    }
    return true;
  });
  if (!claimed) return { claimed: false };
  log.info(
    `Order ${orderId}: paid → processing (awaiting Sales-Order settlement)`
  );
  return { claimed: true };
}

/**
 * Block fulfillment for a PAID order whose Sales-Order settlement is
 * unverified or ambiguous. Keeps Midtrans's authoritative paid status, never
 * touches paymentStatus, and (together with the absence of a pickup code)
 * keeps the order out of ready_for_pickup until an operator resolves it.
 */
export async function blockOrderFulfillment(
  orderId: string,
  reason: string
): Promise<void> {
  await db
    .update(orders)
    .set({ fulfillmentBlockedReason: reason, updatedAt: new Date() })
    .where(
      and(eq(orders.id, orderId), eq(orders.paymentStatus, "paid"))
    );
}

/**
 * Move a PAID, settlement-verified order to ready_for_pickup: collision-checked
 * pickup code, admin notification, pickup-ready email. Guarded to
 * processing + paid + unblocked, so a paid-but-ambiguous order can never gain
 * a pickup code.
 */
export async function fulfillPaidOrder(
  orderId: string,
  order: OrderView
): Promise<FinalizeResult> {
  if (!order.branchId) {
    log.error(`Order ${orderId}: cannot fulfill — order has no branchId`);
    return { claimed: false };
  }

  let pickupCode: string | null = null;
  pickupCode = await db.transaction(async (tx) => {
    // Re-check the settlement gate inside the tx: a blocked order must never
    // surface a pickup code.
    const gate = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.status, "processing"),
          eq(orders.paymentStatus, "paid")
        )
      )
      .for("update")
      .limit(1);
    if (gate.length === 0) return null;

    let code = generatePickupCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.pickupCode, code),
            inArray(orders.status, ["ready_for_pickup", "completed"])
          )
        )
        .limit(1);
      if (existing.length === 0) break;
      code = generatePickupCode();
      attempts++;
    }

    await tx
      .update(orders)
      .set({
        status: "ready_for_pickup",
        pickupCode: code,
        fulfillmentBlockedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    return code;
  });

  if (!pickupCode) return { claimed: false };

  // Create admin notification so branch/HQ staff see the new paid order.
  let notificationId: string | null = null;
  try {
    notificationId = crypto.randomUUID();
    await db.insert(notifications).values({
      id: notificationId,
      type: "order_paid",
      orderId: order.id,
      branchId: order.branchId!,
      title: "Order Paid — Ready for Pickup",
      message: `Order #${order.id.slice(0, 8).toUpperCase()} has been paid (Rp ${parseFloat(
        order.total
      ).toLocaleString("id-ID")}) and is ready for pickup.`,
    });
    // Wake admin long-poll listeners across processes via Postgres NOTIFY.
    await db.execute(
      sql`SELECT pg_notify('new_notification', ${JSON.stringify({ id: notificationId })})`
    );
  } catch (notifyError) {
    log.error(
      `Order ${orderId}: admin notification insert failed`,
      safeDependencyErrorLog(notifyError)
    );
  }

  // Send pickup-ready email (best-effort, outside the tx).
  try {
    const [branchData, itemsForEmail] = await Promise.all([
      db
        .select()
        .from(branches)
        .where(eq(branches.id, order.branchId!))
        .limit(1),
      db
        .select({
          productName: orderItems.productName,
          variantInfo: orderItems.variantInfo,
          price: orderItems.price,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId)),
    ]);

    if (branchData.length > 0) {
      const emailOrder = {
        id: order.id,
        total: order.total,
        subtotal: order.subtotal,
        serviceFee: order.serviceFee,
        ppnRate: order.ppnRate,
        ppnAmount: order.ppnAmount,
        pickupDate: order.pickupDate,
        pickupTime: order.pickupTime,
      };
      const branch = {
        name: branchData[0].name,
        address: branchData[0].address,
        city: branchData[0].city,
        operatingHours: branchData[0].operatingHours,
      };
      const html = pickupReadyEmailHTML({
        order: emailOrder,
        pickupCode,
        branch,
        items: itemsForEmail,
      });
      const text = pickupReadyEmailText({
        order: emailOrder,
        pickupCode,
        branch,
        items: itemsForEmail,
      });
      await sendEmail({
        to: order.contactEmail,
        subject: `Your Order is Ready for Pickup — #${order.id.slice(0, 8).toUpperCase()}`,
        html,
        text,
      });
    }
  } catch (emailError) {
    log.error(
      `Order ${orderId}: pickup-ready email failed`,
      safeDependencyErrorLog(emailError)
    );
  }

  log.info(
    `Order ${orderId}: paid → ready_for_pickup (pickup code ${pickupCode})`
  );
  return { claimed: true, pickupCode };
}

/**
 * Backwards-compatible alias: legacy callers finalized payment + pickup in one
 * step. The Sales-Order flow splits the claim (paid) from fulfillment
 * (settlement-verified); this helper keeps the old call shape working by
 * claiming the payment and letting the caller run settlement + fulfillment.
 */
export async function claimAndFinalizePaidOrder(
  orderId: string,
  _order: OrderView,
  paymentAttributes?: PaymentAttributes
): Promise<FinalizeResult> {
  return claimPaidOrder(orderId, paymentAttributes);
}

/**
 * Atomically claim a pending_payment order as failed, then cancel its Sales
 * Order pre-invoice. The local hold is released ONLY after a confirmed cancel;
 * an ambiguous cancel keeps the hold and routes to manual review.
 */
export async function claimAndFailOrder(
  orderId: string,
  reason: string,
  midtransStatus: string,
  paymentAttributes?: PaymentAttributes
): Promise<FinalizeResult> {
  const claimed = await db.transaction(async (tx) => {
    const res = await tx
      .update(orders)
      .set({
        status: "failed_payment",
        paymentStatus: "failed",
        paymentFailureReason: reason,
        midtransFailureStatus: midtransStatus,
        ...(paymentAttributes?.paymentType
          ? { paymentMethod: paymentAttributes.paymentType }
          : {}),
        ...(paymentAttributes?.transactionId
          ? { midtransTransactionId: paymentAttributes.transactionId }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(eq(orders.id, orderId), eq(orders.status, "pending_payment"))
      )
      .returning({ id: orders.id });
    return res.length > 0;
  });

  if (!claimed) return { claimed: false };

  // Pre-invoice cancel: never cancels once an invoice exists (the lifecycle
  // refuses); the hold stays until a confirmed cancel or manual review.
  try {
    const outcome = await dispatchJubelioSalesCancel({
      orderId,
      reason,
    });
    log.info(
      `Order ${orderId}: Sales-Order cancel dispatched on payment failure (status ${outcome.status})`
    );
    if (outcome.status === "manual_review") {
      await blockOrderFulfillment(
        orderId,
        `Sales-Order cancel is unresolved after payment failure: ${outcome.message}`
      );
    }
  } catch (cancelError) {
    log.error(
      `Order ${orderId}: Sales-Order cancel dispatch failed`,
      safeDependencyErrorLog(cancelError)
    );
  }

  // Send payment-failed email (best-effort, outside the tx).
  try {
    const [itemsForEmail, orderRows] = await Promise.all([
      db
        .select({
          productName: orderItems.productName,
          variantInfo: orderItems.variantInfo,
          price: orderItems.price,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId)),
      db
        .select({
          id: orders.id,
          contactEmail: orders.contactEmail,
          total: orders.total,
          subtotal: orders.subtotal,
          serviceFee: orders.serviceFee,
          ppnRate: orders.ppnRate,
          ppnAmount: orders.ppnAmount,
          pickupDate: orders.pickupDate,
          pickupTime: orders.pickupTime,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1),
    ]);
    const emailOrder = orderRows[0] ?? {
      id: orderId,
      contactEmail: "",
      total: "0",
      subtotal: "0",
      serviceFee: "0",
      ppnRate: "0",
      ppnAmount: "0",
      pickupDate: null,
      pickupTime: null,
    };
    const html = paymentFailedEmailHTML({
      order: emailOrder,
      reason,
      items: itemsForEmail,
    });
    const text = paymentFailedEmailText({
      order: emailOrder,
      reason,
      items: itemsForEmail,
    });
    await sendEmail({
      to: emailOrder.contactEmail,
      subject: `Pembayaran Gagal — #${orderId.slice(0, 8).toUpperCase()}`,
      html,
      text,
    });
  } catch (emailError) {
    log.error(
      `Order ${orderId}: payment-failed email failed`,
      safeDependencyErrorLog(emailError)
    );
  }

  log.info(
    `Order ${orderId}: order failed_payment (midtrans status ${midtransStatus})`
  );
  return { claimed: true };
}

export type LateSettlementResult = {
  status: "settled" | "manual_review" | "skipped";
  message?: string;
};

/**
 * Late settlement: Midtrans reports payment for a FAILED order.
 *
 * - After a confirmed Sales-Order cancel the stock is already released
 *   remotely: the paid status is kept (Midtrans is authoritative) but the
 *   order is blocked from fulfillment and routed to manual review. No new SO,
 *   invoice, payment or adjustment is ever created automatically.
 * - If the SO cancel never happened (still active), the order can proceed
 *   through the normal settlement pipeline.
 */
export async function processLateSettlement(
  orderId: string,
  paymentAttributes?: PaymentAttributes
): Promise<LateSettlementResult> {
  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order || order.paymentStatus === "paid") return { status: "skipped" };
  if (order.status !== "failed_payment") return { status: "skipped" };

  const cancelOp = await db
    .select({ status: jubelioSalesOperations.status })
    .from(jubelioSalesOperations)
    .where(
      and(
        eq(jubelioSalesOperations.orderId, orderId),
        eq(jubelioSalesOperations.type, "cancel")
      )
    )
    .limit(1);
  const cancelConfirmed =
    cancelOp.length > 0 &&
    ["confirmed", "dispatched_unknown", "intent", "manual_review"].includes(
      cancelOp[0].status
    );

  if (cancelConfirmed) {
    const message =
      "Late payment arrived after the Sales-Order cancel path started; manual reconciliation required";
    // Keep Midtrans's authoritative paid status, block pickup, surface review.
    // One transaction: order paid attributes + conditional Redemption consume
    // (hold belum dilepas) atau late-review event (sudah released).
    const redemption = await findRedemptionForOrder(orderId);
    await db.transaction(async (tx) => {
      if (redemption && redemption.status === "reserved") {
        await lockRedemptionOwners(tx, redemption);
      }
      const [updated] = await tx
        .update(orders)
        .set({
          status: "processing",
          paymentStatus: "paid",
          fulfillmentBlockedReason: message,
          paymentFailureReason: null,
          ...(paymentAttributes?.paymentType
            ? { paymentMethod: paymentAttributes.paymentType }
            : {}),
          ...(paymentAttributes?.transactionId
            ? { midtransTransactionId: paymentAttributes.transactionId }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.status, "failed_payment"),
            eq(orders.paymentStatus, "failed")
          )
        )
        .returning({ id: orders.id });
      if (!updated || !redemption) return;
      const consumed = await consumeReservedRedemption(tx, {
        identity: redemption,
        redemptionId: redemption.id,
        source: "midtrans",
        correlation: paymentAttributes?.transactionId ?? null,
        reason: message,
      });
      if (!consumed) {
        await recordLatePaidReview(tx, {
          orderId,
          correlation: paymentAttributes?.transactionId ?? null,
          reason: message,
        });
      }
    });
    log.warn(`Order ${orderId}: late settlement after cancel → manual review`);
    return { status: "manual_review", message };
  }

  const claimed = await claimLatePaidOrder(orderId, paymentAttributes);
  if (!claimed) return { status: "skipped" };
  log.info(
    `Order ${orderId}: late settlement claimed — settlement pipeline takes over`
  );
  return { status: "settled" };
}

/**
 * Claim a failed_payment order back to processing + paid (late settlement with
 * an active Sales Order). Guarded to failed_payment + failed.
 */
export async function claimLatePaidOrder(
  orderId: string,
  paymentAttributes?: PaymentAttributes
): Promise<boolean> {
  const redemption = await findRedemptionForOrder(orderId);
  const claimed = await db.transaction(async (tx) => {
    // Urutan lock §9.2: Offer/usage (3) → order/Redemption (5).
    if (redemption && redemption.status === "reserved") {
      await lockRedemptionOwners(tx, redemption);
    }
    const [current] = await tx
      .select({ status: orders.status, paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);
    if (!current || current.status !== "failed_payment" || current.paymentStatus !== "failed") {
      log.info(`Order ${orderId}: late-paid claim lost — order moved on`);
      return false;
    }
    await tx
      .update(orders)
      .set({
        status: "processing",
        paymentStatus: "paid",
        fulfillmentBlockedReason: null,
        paymentFailureReason: null,
        midtransFailureStatus: null,
        ...(paymentAttributes?.paymentType
          ? { paymentMethod: paymentAttributes.paymentType }
          : {}),
        ...(paymentAttributes?.transactionId
          ? { midtransTransactionId: paymentAttributes.transactionId }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
    if (redemption) {
      const consumed = await consumeReservedRedemption(tx, {
        identity: redemption,
        redemptionId: redemption.id,
        source: "midtrans",
        correlation: paymentAttributes?.transactionId ?? null,
        reason: "Late payment on active Sales Order",
      });
      if (!consumed) {
        const reviewed = await recordLatePaidReview(tx, {
          orderId,
          correlation: paymentAttributes?.transactionId ?? null,
          reason: "Late payment on active Sales Order with released Redemption",
        });
        if (reviewed) {
          await tx.update(orders)
            .set({ fulfillmentBlockedReason: "Late payment after Redemption release; manual review required", updatedAt: new Date() })
            .where(eq(orders.id, orderId));
        }
      }
    }
    return true;
  });
  return claimed;
}