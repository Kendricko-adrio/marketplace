import { db } from "@/db";
import {
  branchStocks,
  clients,
  checkoutRequests,
  jubelioSalesOperations,
  orderItems,
  orders,
  type JubelioSalesOrderCreateRequest,
  type JubelioSalesPaymentRequest,
} from "@/db";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import {
  JubelioSalesGatewayError,
  createJubelioSalesGateway,
  type JubelioPaymentSnapshot,
  type JubelioSalesGateway,
} from "./jubelio-sales-client";
import {
  claimJubelioSalesOperationForDispatch,
  getJubelioSalesOperation,
  markJubelioSalesOperationConfirmed,
  markJubelioSalesOperationManualReview,
  markJubelioSalesOperationRejectedAfterClaim,
  persistJubelioSalesInvoiceId,
  persistJubelioSalesOrderId,
  persistJubelioSalesPaymentId,
  recordJubelioSalesIntent,
  type JubelioSalesOperation,
} from "./jubelio-sales-operations";
import {
  JubelioSalesContractError,
  readSettlementAuthorityRecord,
  type VersionedSalesOrderExpectation,
} from "./jubelio-sales-expected";
import { createLogger, serializeError, type Logger } from "./logger";
import {
  findRedemptionForOrder,
  lockRedemptionOwners,
  releaseReservedRedemption,
} from "./discount-lifecycle";

/**
 * Jubelio Sales-Order lifecycle dispatch (plan: jubelio-sales-api-switching,
 * features 2 + 3).
 *
 * Every remote write goes through the durable ledger:
 *   1. intent persisted BEFORE the POST (unique per order+type),
 *   2. ONE conditional claim (`intent` → `dispatched_unknown`) grants the
 *      single POST permission,
 *   3. after the gateway attempt exactly one outcome is recorded:
 *      `confirmed` (independent GET verified, remote id persisted),
 *      `rejected` (definitive pre-apply rejection) or `manual_review`
 *      (ambiguous/unknown). A claimed write is NEVER re-POSTed.
 *
 * Provider calls stay OUTSIDE any DB transaction. Hold accounting:
 *   - the local hold is acquired BEFORE the create POST (place-order tx),
 *   - on a confirmed create the hold clears AND `available_stock` drops by the
 *     same quantity (the provider now carries the liability via `on_order`),
 *   - cancel cannot clear a second hold: this order's hold was already
 *     cleared at create confirmation. A subsequent sync restores availability.
 */

let defaultSalesGateway: JubelioSalesGateway | null = null;

export function getDefaultJubelioSalesGateway(): JubelioSalesGateway {
  if (!defaultSalesGateway) {
    defaultSalesGateway = createJubelioSalesGateway();
  }
  return defaultSalesGateway;
}

/** Inject a gateway (tests). Pass null to reset to the default factory. */
export function setDefaultJubelioSalesGateway(
  gateway: JubelioSalesGateway | null
): void {
  defaultSalesGateway = gateway;
}

export type SalesDispatchOutcome =
  | { status: "confirmed"; operation: JubelioSalesOperation }
  | { status: "rejected"; message: string }
  | { status: "manual_review"; message: string; operation: JubelioSalesOperation }
  | { status: "in_flight"; operation: JubelioSalesOperation }
  | { status: "skipped"; message: string };

/** One order-item line for hold accounting (local branch ids + quantities). */
export type OrderHoldLine = { variantId: string; quantity: number };

/**
 * Conditional operation claim and stock/Redemption accounting live in ONE DB
 * transaction. A crash either rolls the whole transaction back or leaves the
 * operation marked accounted. Other orders' holds cannot be consumed by a
 * replay.
 *
 * Lock ordering (§9.2): Offer identity → usage → client usage (3) before the
 * existing order (5), stock (6), and finally the provider operation/ledger (7).
 * The provider op claim is the LAST mutation; if it is lost, the transaction is
 * rolled back so no stock/Redemption accounting double-applies.
 */
class HoldAccountingClaimLost extends Error {
  constructor() {
    super("Confirmed hold accounting was already completed by another path");
    this.name = "HoldAccountingClaimLost";
  }
}

async function accountConfirmedHold(orderId: string, type: "create" | "cancel"): Promise<boolean> {
  const redemption = type === "cancel" ? await findRedemptionForOrder(orderId) : null;
  try {
    return await db.transaction(async (tx) => {
      if (redemption && redemption.status === "reserved") {
        await lockRedemptionOwners(tx, redemption);
      }
      const [order] = await tx.select({ branchId: orders.branchId }).from(orders)
        .where(eq(orders.id, orderId)).for("update");
      if (!order?.branchId) {
        throw new Error(`Cannot account confirmed ${type} hold: missing branch`);
      }
      const lines = await tx.select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
        .from(orderItems).where(eq(orderItems.orderId, orderId));
      if (lines.length === 0) throw new Error("Cannot account confirmed hold without order items");
      if (type === "create") {
        for (const line of lines) {
          const [stock] = await tx.update(branchStocks).set({
            pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${line.quantity})`,
            availableStock: sql`GREATEST(COALESCE(${branchStocks.availableStock}, 0) - ${line.quantity}, 0)`,
            updatedAt: new Date(),
          }).where(and(eq(branchStocks.branchId, order.branchId),
            eq(branchStocks.productVariantId, line.variantId)))
            .returning({ branchId: branchStocks.branchId });
          if (!stock) throw new Error("Cannot account confirmed hold: stock row missing");
        }
      } else if (redemption) {
        // Confirmed pre-invoice cancel is the ONLY safe unpaid terminal that
        // releases capacity: release once, in the same commit as the stock
        // accounting the create path already performed.
        await releaseReservedRedemption(tx, {
          identity: redemption,
          orderId,
          source: "jubelio-cancel",
          reason: "Sales Order cancel confirmed before invoice",
        });
      }
      // Group 7 — the provider ledger claim goes LAST. A lost claim throws to
      // roll back the whole transaction instead of leaving partial accounting.
      // The create path reads the confirmed op's remote id (unlocked discovery)
      // and updates the already-locked order BEFORE the claim, so no earlier
      // lock group is touched after group 7.
      if (type === "create") {
        const [candidate] = await tx.select({ salesOrderId: jubelioSalesOperations.salesOrderId })
          .from(jubelioSalesOperations)
          .where(and(eq(jubelioSalesOperations.orderId, orderId),
            eq(jubelioSalesOperations.type, type),
            eq(jubelioSalesOperations.status, "confirmed"),
            isNull(jubelioSalesOperations.holdAccountedAt)))
          .limit(1);
        if (candidate?.salesOrderId == null) throw new HoldAccountingClaimLost();
        await tx.update(orders).set({ jubelioSalesOrderId: candidate.salesOrderId, updatedAt: new Date() })
          .where(eq(orders.id, orderId));
      }
      const [op] = await tx.update(jubelioSalesOperations)
        .set({ holdAccountedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(jubelioSalesOperations.orderId, orderId),
          eq(jubelioSalesOperations.type, type),
          eq(jubelioSalesOperations.status, "confirmed"),
          isNull(jubelioSalesOperations.holdAccountedAt)))
        .returning();
      if (!op) throw new HoldAccountingClaimLost();
      return true;
    });
  } catch (error) {
    if (error instanceof HoldAccountingClaimLost) return false;
    throw error;
  }
}

export async function mirrorConfirmedSalesOrderHold(orderId: string, logger?: Logger): Promise<void> {
  if (await accountConfirmedHold(orderId, "create")) logger?.info("confirmed SO hold accounted", { orderId });
}

export async function releaseConfirmedSalesOrderHold(orderId: string, logger?: Logger): Promise<void> {
  // If create confirmation crashed before accounting, finish it first.
  await accountConfirmedHold(orderId, "create");
  if (await accountConfirmedHold(orderId, "cancel")) logger?.info("confirmed SO cancel accounted", { orderId });
}

/** Finish committed confirmations left between provider GET and local accounting. */
export async function reconcileConfirmedSalesOrderHolds(limit = 50): Promise<number> {
  const rows = await db.select({ orderId: jubelioSalesOperations.orderId, type: jubelioSalesOperations.type })
    .from(jubelioSalesOperations)
    .where(and(eq(jubelioSalesOperations.status, "confirmed"),
      inArray(jubelioSalesOperations.type, ["create", "cancel"]),
      isNull(jubelioSalesOperations.holdAccountedAt)))
    .orderBy(jubelioSalesOperations.confirmedAt).limit(limit);
  let applied = 0;
  for (const row of rows) {
    if (row.type === "cancel") await accountConfirmedHold(row.orderId, "create");
    if (await accountConfirmedHold(row.orderId, row.type as "create" | "cancel")) applied++;
  }
  return applied;
}

function classifyGatewayError(error: unknown): {
  kind: "ambiguous" | "definitive" | "unexpected";
  message: string;
} {
  if (error instanceof JubelioSalesGatewayError) {
    return {
      kind: error.options.ambiguous ? "ambiguous" : "definitive",
      message: error.message,
    };
  }
  return {
    // Without a typed pre-send rejection we cannot prove the write was not applied.
    kind: "ambiguous",
    message: error instanceof Error ? error.message : "Unexpected Jubelio error",
  };
}

/** Remote ids the gateway already returned for a failed/ambiguous stage. */
function gatewayKnownIds(error: unknown): {
  salesOrderId?: number;
  invoiceId?: number;
  paymentId?: number;
} {
  if (!(error instanceof JubelioSalesGatewayError)) return {};
  const { salesOrderId, invoiceId, paymentId } = error.options;
  return {
    ...(salesOrderId != null ? { salesOrderId } : {}),
    ...(invoiceId != null ? { invoiceId } : {}),
    ...(paymentId != null ? { paymentId } : {}),
  };
}

/**
 * Keeps a KNOWN returned provider id durable when the stage outcome was
 * ambiguous/failed: the id must stay reconcilable by GET, but is never a
 * confirmed pointer and never authorizes a re-POST (spec §10.2/§10.3).
 */
async function persistKnownReturnedIds(
  operationId: string,
  ids: { salesOrderId?: number; invoiceId?: number; paymentId?: number },
  log: Logger
): Promise<void> {
  try {
    if (ids.salesOrderId != null) {
      await persistJubelioSalesOrderId(db, operationId, ids.salesOrderId);
    }
    if (ids.invoiceId != null) {
      await persistJubelioSalesInvoiceId(db, operationId, ids.invoiceId);
    }
    if (ids.paymentId != null) {
      await persistJubelioSalesPaymentId(db, operationId, ids.paymentId);
    }
  } catch (error) {
    log.error(
      "Jubelio returned provider id could not be persisted after an ambiguous outcome",
      { operationId, error: serializeError(error) }
    );
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type DispatchCreateResult =
  | { status: "confirmed"; salesOrderId: number }
  | { status: "rejected"; message: string }
  | { status: "manual_review"; message: string }
  | { status: "in_flight" };

/**
 * Dispatch the durable SO create for an order whose intent was already
 * persisted (place-order persists it inside the checkout transaction). The
 * caller must have acquired the local hold BEFORE calling this.
 *
 * - At most one POST per order (the ledger claim gate).
 * - Unknown create results keep the hold and go to `manual_review` — never a
 *   blind retry, never a second SO.
 */
export async function dispatchJubelioSalesCreate(input: {
  orderId: string;
  create: JubelioSalesOrderCreateRequest;
  gateway?: JubelioSalesGateway;
  logger?: Logger;
  /** Hanya existing sweep: claim tetap memakai ledger yang sama. */
  checkoutRecovery?: boolean;
}): Promise<DispatchCreateResult> {
  const log =
    input.logger?.child({ orderId: input.orderId, module: "jubelio-sales-create" }) ??
    createLogger({ module: "jubelio-sales-create", orderId: input.orderId });
  const reference = input.create.note;
  const recorded = await recordJubelioSalesIntent(db, {
    orderId: input.orderId,
    type: "create",
    reference,
    payload: { type: "create", create: input.create },
  });

  if (recorded.operation.status === "confirmed") {
    // A previous attempt already confirmed this create (crash/replay).
    if (recorded.operation.salesOrderId != null) {
      await mirrorConfirmedSalesOrderHold(input.orderId, log);
      return { status: "confirmed", salesOrderId: recorded.operation.salesOrderId };
    }
  }
  if (recorded.operation.status !== "intent") {
    // dispatched_unknown (possibly sent), manual_review, rejected, aborted —
    // never re-POST. Reconciliation belongs to the sweep / ops.
    return { status: "in_flight" };
  }

  const claimed = input.checkoutRecovery
    ? await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
        const [discovered] = await tx.select().from(checkoutRequests)
          .where(eq(checkoutRequests.orderId, input.orderId)).limit(1);
        if (!discovered) return null;
        await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, discovered.clientId)).for("update");
        const [receipt] = await tx.select().from(checkoutRequests).where(eq(checkoutRequests.id, discovered.id)).for("update");
        const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
        if (!receipt || !order || receipt.clientId !== order.userId || receipt.status !== "accepted" ||
            order.status !== "pending_payment" || order.paymentStatus !== "pending" ||
            !order.expiresAt || order.expiresAt.getTime() <= Date.now()) return null;
        const authority = readSettlementAuthorityRecord({ createPayload: recorded.operation.payload, orderRow: order });
        if (authority.providerContractVersion !== 2) return null;
        return claimJubelioSalesOperationForDispatch(tx, recorded.operation.id);
      })
    : await claimJubelioSalesOperationForDispatch(db, recorded.operation.id);
  if (!claimed?.claimed) {
    return { status: "in_flight" };
  }

  const gateway = input.gateway ?? getDefaultJubelioSalesGateway();
  log.info("Jubelio sales order create dispatched", {
    operationId: recorded.operation.id,
  });
  let result: Awaited<ReturnType<JubelioSalesGateway["createSalesOrder"]>>;
  try {
    result = await gateway.createSalesOrder({
      ...input.create,
      operationId: recorded.operation.id,
      // Durable handle BEFORE the gateway's independent verification GET: a
      // crash between the POST and the GET must not lose the only
      // reconciliation path (spec §10.2). Rejection is ambiguous and is never
      // retried; the id stays on the error.
      onSalesOrderId: async (salesOrderId) => {
        const persisted = await persistJubelioSalesOrderId(
          db,
          recorded.operation.id,
          salesOrderId
        );
        if (!persisted) {
          throw new Error(
            `Jubelio sales order ${salesOrderId} id persistence lost the dispatch claim`
          );
        }
      },
    });
  } catch (error) {
    const classified = classifyGatewayError(error);
    if (classified.kind === "ambiguous") {
      await persistKnownReturnedIds(
        recorded.operation.id,
        gatewayKnownIds(error),
        log
      );
      await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
        message: classified.message,
      });
      log.error("Jubelio sales create outcome unknown — manual review", {
        error: serializeError(error),
      });
      return { status: "manual_review", message: classified.message };
    }
    // Definitive pre-apply rejection (4xx / invalid input / backpressure):
    // the write never reached the provider, so recording `rejected` is safe.
    await markJubelioSalesOperationRejectedAfterClaim(db, recorded.operation.id, {
      message: classified.message,
    });
    log.warn("Jubelio sales create rejected", { message: classified.message });
    return { status: "rejected", message: classified.message };
  }
  // Local persistence errors are NOT provider rejections: the remote SO may
  // already be confirmed. Propagate and let the sweep finish local accounting.
  const channelStatusMatches = result.order.channelStatus === "Belum Bayar";
  const confirmed = await markJubelioSalesOperationConfirmed(db, recorded.operation.id, {
    salesOrderId: result.salesOrderId,
    channelStatusMatches,
  });
  if (!channelStatusMatches) {
    log.error("Jubelio create channel marker differs after core confirmation", {
      operationId: recorded.operation.id,
      salesOrderId: result.salesOrderId,
      reason: "CREATE_MARKER_MISMATCH",
    });
  }
  if (!confirmed) return { status: "in_flight" };
  await mirrorConfirmedSalesOrderHold(input.orderId, log);
  log.info("Jubelio sales order created and confirmed", {
    salesOrderId: result.salesOrderId, operationId: recorded.operation.id,
  });
  return { status: "confirmed", salesOrderId: result.salesOrderId };
}

// ---------------------------------------------------------------------------
// Cancel (pre-invoice only)
// ---------------------------------------------------------------------------

export type DispatchCancelResult =
  | { status: "confirmed"; salesOrderId: number }
  | { status: "rejected"; message: string }
  | { status: "manual_review"; message: string }
  | { status: "in_flight" }
  | { status: "skipped"; message: string };

/**
 * Cancel the order's Sales Order BEFORE any invoice exists and release the
 * local hold only after a confirmed cancel. Never cancels once an invoice
 * operation is in flight or confirmed.
 */
export async function dispatchJubelioSalesCancel(input: {
  orderId: string;
  reason: string;
  gateway?: JubelioSalesGateway;
  logger?: Logger;
}): Promise<DispatchCancelResult> {
  const log =
    input.logger?.child({ orderId: input.orderId, module: "jubelio-sales-cancel" }) ??
    createLogger({ module: "jubelio-sales-cancel", orderId: input.orderId });

  const createOp = await getJubelioSalesOperation(db, {
    orderId: input.orderId,
    type: "create",
  });
  if (!createOp || createOp.status !== "confirmed" || createOp.salesOrderId == null) {
    return {
      status: "skipped",
      message: "No confirmed Sales Order to cancel",
    };
  }
  // Never cancel once an invoice exists or is being created.
  const invoiceOp = await getJubelioSalesOperation(db, {
    orderId: input.orderId,
    type: "invoice",
  });
  if (
    invoiceOp &&
    ["intent", "dispatched_unknown", "confirmed"].includes(invoiceOp.status)
  ) {
    return {
      status: "skipped",
      message: "Invoice operation exists — cancel is not allowed post-invoice",
    };
  }

  const priorCancel = await getJubelioSalesOperation(db, { orderId: input.orderId, type: "cancel" });
  const reference = priorCancel?.reference ?? `OKCIR_SO_CANCEL:${input.orderId}`;
  const recorded = await recordJubelioSalesIntent(db, {
    orderId: input.orderId,
    type: "cancel",
    reference,
    salesOrderId: createOp.salesOrderId,
    payload: {
      type: "cancel",
      cancel: { salesOrderId: createOp.salesOrderId },
    },
  });
  if (recorded.operation.status === "confirmed") {
    await releaseConfirmedSalesOrderHold(input.orderId, log);
    return {
      status: "confirmed",
      salesOrderId: createOp.salesOrderId,
    };
  }
  if (recorded.operation.status !== "intent") {
    return { status: "in_flight" };
  }

  const claimed = await claimJubelioSalesOperationForDispatch(
    db,
    recorded.operation.id
  );
  if (!claimed.claimed) {
    return { status: "in_flight" };
  }

  const gateway = input.gateway ?? getDefaultJubelioSalesGateway();
  log.info("Jubelio sales order cancel dispatched", {
    salesOrderId: createOp.salesOrderId,
    reason: input.reason,
  });
  let result: Awaited<ReturnType<JubelioSalesGateway["cancelSalesOrder"]>>;
  try {
    result = await gateway.cancelSalesOrder({
      salesOrderId: createOp.salesOrderId,
      operationId: recorded.operation.id,
    });
  } catch (error) {
    const classified = classifyGatewayError(error);
    if (classified.kind === "ambiguous") {
      await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
        message: classified.message,
      });
      log.error("Jubelio sales cancel outcome unknown — manual review", {
        error: serializeError(error),
      });
      return { status: "manual_review", message: classified.message };
    }
    // The pre-read inside the gateway may have found the SO already canceled
    // (alreadyCanceled returns success). A definitive failure here means the
    // SO is still active — the hold stays and the sweep retries reconciliation.
    await markJubelioSalesOperationRejectedAfterClaim(db, recorded.operation.id, {
      message: classified.message,
    });
    log.warn("Jubelio sales cancel rejected", { message: classified.message });
    return { status: "rejected", message: classified.message };
  }
  const confirmed = await markJubelioSalesOperationConfirmed(
    db, recorded.operation.id, { salesOrderId: createOp.salesOrderId }
  );
  if (!confirmed) return { status: "in_flight" };
  await releaseConfirmedSalesOrderHold(input.orderId, log);
  log.info("Jubelio sales order canceled and accounting reconciled", {
    salesOrderId: createOp.salesOrderId, alreadyCanceled: result.alreadyCanceled,
  });
  return { status: "confirmed", salesOrderId: createOp.salesOrderId };
}

// ---------------------------------------------------------------------------
// Settlement (Path 1): invoice → verify → payment
// ---------------------------------------------------------------------------

/** Integer money from the numeric(15,2) column. */
export function toIntegerMoney(value: string | number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Money value is not finite: ${String(value)}`);
  }
  return Math.round(n);
}

/** Tolerant money equality (serialization noise allowed, real mismatch not). */
export function moneyEquals(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.min(0.0001, 1e-6 * scale);
}

function paymentAccountId(): number | null {
  const raw = process.env.JUBELIO_PAYMENT_ACCOUNT_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** payment_type is a NUMBER at runtime (sandbox 2026-09-24; 0 = cash/other). */
function paymentType(): number {
  const raw = Number(process.env.JUBELIO_PAYMENT_TYPE);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * Otoritas expected provider satu order (spec §8.3 "Sales operation", §10.2).
 *
 * - `legacy` — intent unversioned + baris order tetap `0/0/0`: aturan lama
 *   (`orders.subtotal`) dipertahankan apa adanya, tanpa recompute.
 * - `v2` — intent kontrak2 + baris order `pricing1/engine1/provider2` +
 *   financial snapshot immutable yang nilainya SAMA: `expectedProviderPayable`
 *   tersimpan menjadi satu-satunya nominal invoice/payment/grand total.
 * - `hold` — versi unknown atau dua record tidak setuju: TIDAK ada provider
 *   write; tahap berikutnya ditahan (paid-but-blocked/manual review).
 *
 * Kedua record dibaca dari yang TERSIMPAN (operation ledger + order row),
 * tidak pernah dari master price/tax/quote/config saat ini.
 */
type SettlementAuthority =
  | { kind: "legacy" }
  | { kind: "v2"; expectation: VersionedSalesOrderExpectation }
  | { kind: "hold"; message: string };

async function loadSettlementAuthority(
  orderId: string
): Promise<SettlementAuthority> {
  const createOp = await getJubelioSalesOperation(db, {
    orderId,
    type: "create",
  });
  if (!createOp || createOp.status !== "confirmed") {
    return {
      kind: "hold",
      message: "Settlement requires a confirmed Sales Order request snapshot",
    };
  }
  const rows = await db
    .select({
      pricingContractVersion: orders.pricingContractVersion,
      pricingEngineVersion: orders.pricingEngineVersion,
      providerContractVersion: orders.providerContractVersion,
      pricingSnapshot: orders.pricingSnapshot,
      fulfillmentMethod: orders.fulfillmentMethod,
      subtotal: orders.subtotal,
      discount: orders.discount,
      shippingCost: orders.shippingCost,
      serviceFee: orders.serviceFee,
      ppnRate: orders.ppnRate,
      ppnAmount: orders.ppnAmount,
      total: orders.total,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      kind: "hold",
      message: "Settlement requires the immutable order financial snapshot",
    };
  }
  try {
    const authority = readSettlementAuthorityRecord({
      createPayload: createOp.payload,
      orderRow: row,
    });
    return authority.providerContractVersion === 2
      ? { kind: "v2", expectation: authority }
      : { kind: "legacy" };
  } catch (error) {
    const message =
      error instanceof JubelioSalesContractError
        ? `${error.code}: ${error.message}`
        : "order/provider snapshot could not be decoded";
    return { kind: "hold", message };
  }
}

export type SettlementStepResult =
  | { status: "confirmed" }
  | { status: "manual_review"; message: string }
  | { status: "in_flight" };

/**
 * Ensure the order's invoice exists (Path 1 conversion), is persisted and is
 * verified against the local order. At most one conversion POST per order.
 */
export async function ensureJubelioInvoice(input: {
  orderId: string;
  gateway?: JubelioSalesGateway;
  logger?: Logger;
  /**
   * Ticket 07 — the SYSTEM GET-only recovery: verified manual_review
   * operations reconcile by GET (never a POST); anything unverifiable stays
   * held (in_flight). Admins/UI can never pass this flag.
   */
  readOnlyRecovery?: boolean;
}): Promise<SettlementStepResult> {
  const log =
    input.logger?.child({ orderId: input.orderId, module: "jubelio-sales-invoice" }) ??
    createLogger({ module: "jubelio-sales-invoice", orderId: input.orderId });

  const orderRows = await db
    .select({
      total: orders.total,
      subtotal: orders.subtotal,
      jubelioSalesOrderId: orders.jubelioSalesOrderId,
      jubelioInvoiceId: orders.jubelioInvoiceId,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order?.jubelioSalesOrderId) {
    return {
      status: "manual_review",
      message: "Settlement requires a confirmed Sales Order id",
    };
  }

  const existing = await getJubelioSalesOperation(db, {
    orderId: input.orderId,
    type: "invoice",
  });
  if (existing?.status === "confirmed" && existing.invoiceId != null) {
    return { status: "confirmed" };
  }

  // Otoritas expected provider dari DUA record tersimpan (intent + order
  // snapshot). Versi unknown/drift menahan tahap ini SEBELUM provider write
  // apa pun (spec §10.2/§10.3).
  const authority = await loadSettlementAuthority(input.orderId);
  if (authority.kind === "hold") {
    if (input.readOnlyRecovery === true) {
      log.warn("settlement authority unavailable — invoice recovery held", {
        message: authority.message,
      });
      return { status: "in_flight" };
    }
    log.error("settlement authority unavailable — invoice held for review", {
      message: authority.message,
    });
    return { status: "manual_review", message: authority.message };
  }
  const expectedEnvelope =
    authority.kind === "v2" ? authority.expectation : undefined;

  if (existing) {
    if (existing.status === "manual_review") {
      // Ticket 07 — the GET-only recovery: a KNOWN manual-review invoice id
      // is verified directly against the provider (a GET, never a POST); a
      // verified match confirms through the recovery-flagged mark path, a
      // mismatch/failure keeps it held (in_flight — no re-review writes).
      if (input.readOnlyRecovery === true && existing.invoiceId != null) {
        const gateway = input.gateway ?? getDefaultJubelioSalesGateway();
        try {
          const invoice = await gateway.getInvoice(existing.invoiceId);
          const linkedOrder = await gateway.getSalesOrder(order.jubelioSalesOrderId!);
          const verified =
            linkedOrder.invoiceId === existing.invoiceId && !linkedOrder.isCanceled
              ? await verifyInvoiceAgainstOrder({
                  orderId: input.orderId,
                  invoice,
                  expectedSubtotal: toIntegerMoney(order.subtotal),
                  ...(expectedEnvelope ? { expected: expectedEnvelope } : {}),
                })
              : { ok: false as const, message: "Sales Order does not reference the active invoice" };
          if (verified.ok) {
            const confirmed = await markJubelioSalesOperationConfirmed(
              db,
              existing.id,
              { invoiceId: existing.invoiceId, readOnlyRecovery: true }
            );
            if (confirmed) {
              await db
                .update(orders)
                .set({ jubelioInvoiceId: existing.invoiceId, updatedAt: new Date() })
                .where(eq(orders.id, input.orderId));
              log.info("Jubelio invoice recovered by GET (read-only recovery)", {
                invoiceId: existing.invoiceId,
              });
              return { status: "confirmed" };
            }
            return { status: "in_flight" };
          }
          log.warn("recovery invoice verification failed", {
            invoiceId: existing.invoiceId,
            message: verified.message,
          });
          return { status: "in_flight" };
        } catch (error) {
          log.warn("recovery invoice GET failed", {
            error: serializeError(error),
          });
          // Held either way: never a POST during recovery.
          return { status: "in_flight" };
        }
      }
      return {
        status: "manual_review",
        message: existing.lastError ?? "Invoice operation is in manual review",
      };
    }
    if (existing.status === "dispatched_unknown") {
      // A conversion POST may have been applied. With a persisted invoice id
      // the sweep (or this call, when aged) reconciles via GET — never a
      // second POST.
      if (existing.invoiceId != null) {
        const gateway = input.gateway ?? getDefaultJubelioSalesGateway();
        try {
          const invoice = await gateway.getInvoice(existing.invoiceId);
          const linkedOrder = await gateway.getSalesOrder(order.jubelioSalesOrderId);
          const verified = linkedOrder.invoiceId === existing.invoiceId && !linkedOrder.isCanceled
            ? await verifyInvoiceAgainstOrder({
                orderId: input.orderId, invoice,
                expectedSubtotal: toIntegerMoney(order.subtotal),
                ...(expectedEnvelope ? { expected: expectedEnvelope } : {}),
              })
            : { ok: false as const, message: "Sales Order does not reference the active invoice" };
          if (verified.ok) {
            const confirmed = await markJubelioSalesOperationConfirmed(
              db,
              existing.id,
              { invoiceId: existing.invoiceId }
            );
            if (confirmed) {
              await db
                .update(orders)
                .set({ jubelioInvoiceId: existing.invoiceId, updatedAt: new Date() })
                .where(eq(orders.id, input.orderId));
              log.info("Jubelio invoice reconciled by GET", {
                invoiceId: existing.invoiceId,
              });
              return { status: "confirmed" };
            }
            return { status: "in_flight" };
          }
          await markJubelioSalesOperationManualReview(db, existing.id, {
            message: verified.message,
          });
          return { status: "manual_review", message: verified.message };
        } catch (error) {
          const classified = classifyGatewayError(error);
          log.warn("Jubelio invoice reconcile-by-GET failed", {
            invoiceId: existing.invoiceId,
            error: serializeError(error),
          });
          if (classified.kind === "ambiguous") {
            return { status: "in_flight" };
          }
          await markJubelioSalesOperationManualReview(db, existing.id, {
            message: classified.message,
          });
          return { status: "manual_review", message: classified.message };
        }
      }
      // Claimed but no invoice id yet: too early to know; let the stale-claim
      // triage age it into manual review. Never re-POST here.
      return { status: "in_flight" };
    }
    // rejected/aborted: a definitive pre-apply failure. A paid order still
    // needs its invoice, but automatic retries are forbidden — manual review.
    // Ticket 07 — the recovery NEVER re-POSTs a previously rejected write;
    // it stays held until humans settle it outside the app.
    if (input.readOnlyRecovery === true) {
      log.info("recovery held — the invoice operation was already rejected", {
        orderId: input.orderId,
      });
      return { status: "in_flight" };
    }
    return {
      status: "manual_review",
      message: existing.lastError ?? "Invoice operation was rejected earlier",
    };
  }

  // Ticket 07 — the recovery NEVER records an intent/POST for a MISSING
  // operation; it stays held (in_flight) until escalation resolves it.
  if (input.readOnlyRecovery === true) {
    log.info("recovery held — no invoice operation exists to verify", {
      orderId: input.orderId,
    });
    return { status: "in_flight" };
  }

  // No operation yet: persist the intent, claim, POST once, persist the
  // invoice id BEFORE verification, verify, confirm.
  const reference = `OKCIR_SO_INVOICE:${input.orderId}:${crypto.randomUUID()}`;
  const recorded = await recordJubelioSalesIntent(db, {
    orderId: input.orderId,
    type: "invoice",
    reference,
    salesOrderId: order.jubelioSalesOrderId,
    payload: {
      type: "invoice",
      invoice: { salesOrderId: order.jubelioSalesOrderId },
    },
  });
  if (recorded.operation.status !== "intent") {
    return { status: "in_flight" };
  }
  const claimed = await claimJubelioSalesOperationForDispatch(
    db,
    recorded.operation.id
  );
  if (!claimed.claimed) {
    return { status: "in_flight" };
  }

  const gateway = input.gateway ?? getDefaultJubelioSalesGateway();
  try {
    const result = await gateway.createInvoice({
      salesOrderId: order.jubelioSalesOrderId,
      operationId: recorded.operation.id,
      // Durable handle BEFORE the invoice/SO verification GETs; a rejecting
      // hook is ambiguous and never retried (spec §10.2).
      onInvoiceId: async (invoiceId) => {
        const persisted = await persistJubelioSalesInvoiceId(
          db,
          recorded.operation.id,
          invoiceId
        );
        if (!persisted) {
          throw new Error(
            `Jubelio invoice ${invoiceId} id persistence lost the dispatch claim`
          );
        }
      },
    });
    // Idempotent belt-and-braces for a gateway implementation without hooks.
    const persisted = await persistJubelioSalesInvoiceId(
      db,
      recorded.operation.id,
      result.invoiceId
    );
    if (!persisted) {
      log.warn("Jubelio invoice id persistence lost the claim", {
        invoiceId: result.invoiceId,
      });
      return { status: "in_flight" };
    }
    const verified = await verifyInvoiceAgainstOrder({
      orderId: input.orderId,
      invoice: result.invoice,
      expectedSubtotal: toIntegerMoney(order.subtotal),
      ...(expectedEnvelope ? { expected: expectedEnvelope } : {}),
    });
    if (!verified.ok) {
      await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
        message: verified.message,
      });
      return { status: "manual_review", message: verified.message };
    }
    const confirmed = await markJubelioSalesOperationConfirmed(
      db,
      recorded.operation.id,
      { invoiceId: result.invoiceId }
    );
    if (!confirmed) {
      return { status: "in_flight" };
    }
    await db
      .update(orders)
      .set({ jubelioInvoiceId: result.invoiceId, updatedAt: new Date() })
      .where(eq(orders.id, input.orderId));
    log.info("Jubelio invoice created and verified", {
      invoiceId: result.invoiceId,
      invoiceNo: result.invoice.invoiceNo,
    });
    return { status: "confirmed" };
  } catch (error) {
    const classified = classifyGatewayError(error);
    // A paid order can never lose its authoritative paid status, and a
    // settlement write is never repeated — any failure routes to review.
    const message = classified.message;
    // A KNOWN returned id stays reconcilable by GET, but is never a confirmed
    // pointer and never authorizes another POST.
    await persistKnownReturnedIds(
      recorded.operation.id,
      gatewayKnownIds(error),
      log
    );
    if (classified.kind === "ambiguous") {
      await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
        message,
      });
      log.error("Jubelio invoice conversion outcome unknown — manual review", {
        error: serializeError(error),
      });
      return { status: "manual_review", message };
    }
    await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
      message,
    });
    log.warn("Jubelio invoice conversion rejected — manual review", { message });
    return { status: "manual_review", message };
  }
}

async function verifyInvoiceAgainstOrder(input: {
  orderId: string;
  invoice: {
    salesorderId: number | null;
    contactId: number | null;
    locationId: number | null;
    isCanceled: boolean;
    grandTotal: number;
    subTotal: number;
    totalDisc: number;
    totalTax: number;
    items: { itemId: number; quantity: number; price: number; amount: number }[];
  };
  /** Branch legacy: pre-PPN local subtotal (aturan lama, tidak diubah). */
  expectedSubtotal: number;
  /**
   * Kontrak provider v2: expected TERSIMPAN (intent + order snapshot yang
   * sudah disepakati). Bila diisi, verifikasi memakai expected provider
   * payable, bukan `orders.subtotal`.
   */
  expected?: VersionedSalesOrderExpectation;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const invoice = input.invoice;
  const createOp = await getJubelioSalesOperation(db, { orderId: input.orderId, type: "create" });
  if (createOp?.status !== "confirmed" || createOp.payload.type !== "create") {
    return { ok: false, message: "No confirmed Sales Order request to verify invoice" };
  }
  const request = createOp.payload.create;
  const expected = input.expected;
  // NOTE: the runtime invoice GET exposes salesorder_id as null (the SO link
  // is proven by the gateway via the SO GET's invoice_id), so the id-level
  // linkage check here is conditional on the field being present.
  if (invoice.salesorderId !== null) {
    const orderRows = await db
      .select({ jubelioSalesOrderId: orders.jubelioSalesOrderId })
      .from(orders)
      .where(eq(orders.id, input.orderId))
      .limit(1);
    if (invoice.salesorderId !== orderRows[0]?.jubelioSalesOrderId) {
      return {
        ok: false,
        message: `Invoice belongs to sales order ${invoice.salesorderId}, expected ${orderRows[0]?.jubelioSalesOrderId}`,
      };
    }
  }
  if (invoice.isCanceled) {
    return { ok: false, message: "Invoice is canceled" };
  }
  const expectedContactId = expected ? expected.contactId : request.contactId;
  const expectedLocationId = expected ? expected.locationId : request.locationId;
  if (invoice.contactId !== expectedContactId || invoice.locationId !== expectedLocationId) {
    return { ok: false, message: "Invoice contact or branch differs from the Sales Order request" };
  }
  const expectedLineSource = expected ? expected.lines : request.items;
  const expectedLines = [...expectedLineSource].sort((a, b) => a.itemId - b.itemId);
  const invoiceLines = [...invoice.items].sort((a, b) => a.itemId - b.itemId);
  if (expectedLines.length !== invoiceLines.length || invoiceLines.some((line, index) => {
    const expectedLine = expectedLines[index];
    // Whole-line Markdown is a DISCOUNT on the invoice line, so amount is
    // gross - disc (tax stays 0). A lowered unit price or a raised grand total
    // is a mismatch, never a discount.
    const expectedAmount =
      expectedLine.price * expectedLine.quantity - (expectedLine.discAmount ?? 0);
    return (
      line.itemId !== expectedLine.itemId ||
      line.quantity !== expectedLine.quantity ||
      !moneyEquals(line.price, expectedLine.price) ||
      !moneyEquals(line.amount, expectedAmount)
    );
  })) {
    return { ok: false, message: `Invoice item lines differ from the Sales Order request (invoice ${invoiceLines.map((line) => `${line.itemId}/${line.quantity}/${line.price}/${line.amount}`).join(",")}; expected ${expectedLines.map((line) => `${line.itemId}/${line.quantity}/${line.price}/${line.price * line.quantity - (line.discAmount ?? 0)}`).join(",")})` };
  }
  if (expected) {
    // Kontrak v2: invoice harus membuktikan gross SOURCE, total whole-line
    // discount, net goods dan expected provider payable TERSIMPAN (net ongkir
    // terpisah, tidak dijumlah ulang di sini dan bukan `orders.subtotal`).
    const expectedGross = expected.lines.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0
    );
    const expectedDiscount = expected.lines.reduce(
      (sum, line) => sum + line.discAmount,
      0
    );
    if (
      !moneyEquals(invoice.subTotal, expectedGross) ||
      !moneyEquals(invoice.totalDisc, expectedDiscount) ||
      !moneyEquals(invoice.subTotal - invoice.totalDisc, expected.netGoods)
    ) {
      return {
        ok: false,
        message: `Invoice sub total ${invoice.subTotal} - total disc ${invoice.totalDisc} does not match the stored source gross ${expectedGross} / net goods ${expected.netGoods}`,
      };
    }
    if (!moneyEquals(invoice.grandTotal, expected.expectedProviderPayable)) {
      return {
        ok: false,
        message: `Invoice grand total ${invoice.grandTotal} does not match the stored expected provider payable ${expected.expectedProviderPayable}`,
      };
    }
    return { ok: true };
  }
  // Money: the SO was created with zero disc/zero tax, so the invoice grand
  // total must equal the pre-PPN local subtotal (the Jubelio envelope does
  // not carry the local PPN construct). Tolerant decimals, real mismatch fails.
  if (!moneyEquals(invoice.grandTotal, input.expectedSubtotal)) {
    return {
      ok: false,
      message: `Invoice grand total ${invoice.grandTotal} does not match the order subtotal ${input.expectedSubtotal}`,
    };
  }
  return { ok: true };
}

/**
 * Ensure the order's invoice payment exists (Path 1, at most once). Requires
 * the invoice operation to be confirmed.
 */
export async function ensureJubelioPayment(input: {
  orderId: string;
  gateway?: JubelioSalesGateway;
  logger?: Logger;
  /**
   * Ticket 07 — the SYSTEM GET-only recovery: verified manual_review
   * operations reconcile by GET (never a POST); anything unverifiable stays
   * held (in_flight). Admins/UI can never pass this flag.
   */
  readOnlyRecovery?: boolean;
}): Promise<SettlementStepResult> {
  const log =
    input.logger?.child({ orderId: input.orderId, module: "jubelio-sales-payment" }) ??
    createLogger({ module: "jubelio-sales-payment", orderId: input.orderId });

  const orderRows = await db
    .select({
      total: orders.total,
      subtotal: orders.subtotal,
      contactPhone: orders.contactPhone,
      jubelioSalesOrderId: orders.jubelioSalesOrderId,
      jubelioInvoiceId: orders.jubelioInvoiceId,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  const order = orderRows[0];
  if (!order?.jubelioInvoiceId) {
    // Ticket 07 — a recovery never guesses an invoice id (no POST); held.
    if (input.readOnlyRecovery === true) {
      log.info("recovery held — no invoice id to verify the payment against", {
        orderId: input.orderId,
      });
      return { status: "in_flight" };
    }
    return {
      status: "manual_review",
      message: "Payment requires a verified invoice id",
    };
  }

  const existing = await getJubelioSalesOperation(db, {
    orderId: input.orderId,
    type: "payment",
  });
  if (existing?.status === "confirmed" && existing.paymentId != null) {
    return { status: "confirmed" };
  }

  // Otoritas expected provider dari DUA record tersimpan (intent + order
  // snapshot). Versi unknown/drift menahan tahap ini SEBELUM provider write.
  const authority = await loadSettlementAuthority(input.orderId);
  if (authority.kind === "hold") {
    if (input.readOnlyRecovery === true) {
      log.warn("settlement authority unavailable — payment recovery held", {
        message: authority.message,
      });
      return { status: "in_flight" };
    }
    log.error("settlement authority unavailable — payment held for review", {
      message: authority.message,
    });
    return { status: "manual_review", message: authority.message };
  }
  const invoiceId = order.jubelioInvoiceId;
  const salesOrderId = order.jubelioSalesOrderId ?? null;
  const legacyAmount = toIntegerMoney(order.subtotal);
  // Kontrak v2 memakai expected provider payable TERSIMPAN (net goods + net
  // ongkir); branch legacy tetap memakai subtotal lokal seperti sebelumnya.
  const payableAmount =
    authority.kind === "v2"
      ? authority.expectation.expectedProviderPayable
      : legacyAmount;
  const getGateway = () => input.gateway ?? getDefaultJubelioSalesGateway();
  const verifyPayment = (
    payment: JubelioPaymentSnapshot,
    intent: JubelioSalesPaymentRequest | null
  ) =>
    verifyPaymentAgainstRequest({
      payment,
      intent,
      authority,
      invoiceId,
      salesOrderId,
      legacyAmount,
      getGateway,
    });

  if (existing) {
    if (existing.status === "manual_review") {
      // Ticket 07 — the GET-only recovery for a KNOWN payment id.
      if (input.readOnlyRecovery === true && existing.paymentId != null) {
        const gateway = input.gateway ?? getDefaultJubelioSalesGateway();
        try {
          const payment = await gateway.getPayment(existing.paymentId);
          const intent =
            existing.payload.type === "payment" ? existing.payload.payment : null;
          const mismatch = await verifyPayment(payment, intent);
          if (mismatch) {
            log.warn("recovery payment verification failed", {
              paymentId: existing.paymentId,
              message: mismatch,
            });
            // Held: the op stays manual_review (never a flip without proof).
            return { status: "in_flight" };
          }
          const confirmed = await markJubelioSalesOperationConfirmed(
            db,
            existing.id,
            { paymentId: existing.paymentId, readOnlyRecovery: true }
          );
          if (confirmed) {
            await db
              .update(orders)
              .set({ jubelioPaymentId: existing.paymentId, updatedAt: new Date() })
              .where(eq(orders.id, input.orderId));
            log.info("Jubelio payment recovered by GET (read-only recovery)", {
              paymentId: existing.paymentId,
            });
            return { status: "confirmed" };
          }
          return { status: "in_flight" };
        } catch (error) {
          log.warn("recovery payment GET failed", {
            error: serializeError(error),
          });
          return { status: "in_flight" };
        }
      }
      return {
        status: "manual_review",
        message: existing.lastError ?? "Payment operation is in manual review",
      };
    }
    if (existing.status === "dispatched_unknown") {
      if (existing.paymentId != null) {
        // Reconcile by the persisted payment id — never a second POST.
        const gateway = input.gateway ?? getDefaultJubelioSalesGateway();
        try {
          const payment = await gateway.getPayment(existing.paymentId);
          const intent =
            existing.payload.type === "payment" ? existing.payload.payment : null;
          const mismatch = await verifyPayment(payment, intent);
          if (mismatch) {
            await markJubelioSalesOperationManualReview(db, existing.id, {
              message: mismatch,
            });
            return { status: "manual_review", message: mismatch };
          }
          const confirmed = await markJubelioSalesOperationConfirmed(
            db,
            existing.id,
            { paymentId: existing.paymentId }
          );
          if (confirmed) {
            await db
              .update(orders)
              .set({ jubelioPaymentId: existing.paymentId, updatedAt: new Date() })
              .where(eq(orders.id, input.orderId));
            log.info("Jubelio payment reconciled by GET", {
              paymentId: existing.paymentId,
            });
            return { status: "confirmed" };
          }
          return { status: "in_flight" };
        } catch (error) {
          const classified = classifyGatewayError(error);
          if (classified.kind === "ambiguous") {
            return { status: "in_flight" };
          }
          await markJubelioSalesOperationManualReview(db, existing.id, {
            message: classified.message,
          });
          return { status: "manual_review", message: classified.message };
        }
      }
      return { status: "in_flight" };
    }
    // Ticket 07 — a recovery never re-POSTs a previously rejected/aborted
    // payment write; it stays held (in_flight) until escalation resolves it.
    if (input.readOnlyRecovery === true) {
      log.info("recovery held — the payment operation was already rejected", {
        orderId: input.orderId,
      });
      return { status: "in_flight" };
    }
    return {
      status: "manual_review",
      message: existing.lastError ?? "Payment operation was rejected earlier",
    };
  }

  // Ticket 07 — the recovery NEVER records an intent/POST for a MISSING
  // payment operation; it stays held (in_flight).
  if (input.readOnlyRecovery === true) {
    log.info("recovery held — no payment operation exists to verify", {
      orderId: input.orderId,
    });
    return { status: "in_flight" };
  }

  const accountId = paymentAccountId();
  if (accountId == null) {
    const message =
      "JUBELIO_PAYMENT_ACCOUNT_ID is not configured; the invoice payment cannot be created";
    log.error(message);
    // Record the intent + manual review so ops sees the blocked settlement.
    const reference = `OKCIR_SO_PAYMENT:${input.orderId}:${crypto.randomUUID()}`;
    const recorded = await recordJubelioSalesIntent(db, {
      orderId: input.orderId,
      type: "payment",
      reference,
      payload: {
        type: "payment",
        payment: {
          invoiceId: order.jubelioInvoiceId,
          accountId: 0,
          amount: payableAmount,
          contactId: -1,
          contactName: "Customer",
          paymentType: paymentType(),
        },
      },
      salesOrderId: order.jubelioSalesOrderId ?? undefined,
    });
    await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
      message,
    });
    return { status: "manual_review", message };
  }

  const reference = `OKCIR_SO_PAYMENT:${input.orderId}:${crypto.randomUUID()}`;
  const paymentRequest = {
    invoiceId: order.jubelioInvoiceId,
    accountId,
    amount: payableAmount,
    contactId: -1,
    contactName: "Customer",
    paymentType: paymentType(),
    note: reference,
  };
  const recorded = await recordJubelioSalesIntent(db, {
    orderId: input.orderId,
    type: "payment",
    reference,
    salesOrderId: order.jubelioSalesOrderId ?? undefined,
    payload: { type: "payment", payment: paymentRequest },
  });
  if (recorded.operation.status !== "intent") {
    return { status: "in_flight" };
  }
  const claimed = await claimJubelioSalesOperationForDispatch(
    db,
    recorded.operation.id
  );
  if (!claimed.claimed) {
    return { status: "in_flight" };
  }

  const gateway = input.gateway ?? getDefaultJubelioSalesGateway();
  try {
    const result = await gateway.createInvoicePayment({
      payment: paymentRequest,
      operationId: recorded.operation.id,
      // Durable handle BEFORE the payment verification GET (spec §10.2).
      onPaymentId: async (paymentId) => {
        const persisted = await persistJubelioSalesPaymentId(
          db,
          recorded.operation.id,
          paymentId
        );
        if (!persisted) {
          throw new Error(
            `Jubelio payment ${paymentId} id persistence lost the dispatch claim`
          );
        }
      },
    });
    // Kontrak v2: verifikasi tambahan terhadap INTENT TERSIMPAN (amount,
    // account/type, satu association, grand total/due dan paid amount invoice).
    // Branch legacy tidak berubah — gateway sudah memverifikasi linkage-nya.
    if (authority.kind === "v2") {
      const intent =
        recorded.operation.payload.type === "payment"
          ? recorded.operation.payload.payment
          : null;
      const mismatch = await verifyPayment(result.payment, intent);
      if (mismatch) {
        await persistKnownReturnedIds(
          recorded.operation.id,
          { paymentId: result.paymentId },
          log
        );
        await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
          message: mismatch,
        });
        log.error("Jubelio payment does not match the stored expected payable — manual review", {
          paymentId: result.paymentId,
          message: mismatch,
        });
        return { status: "manual_review", message: mismatch };
      }
    }
    const confirmed = await markJubelioSalesOperationConfirmed(
      db,
      recorded.operation.id,
      { paymentId: result.paymentId, salesOrderId: order.jubelioSalesOrderId ?? undefined }
    );
    if (!confirmed) {
      return { status: "in_flight" };
    }
    await db
      .update(orders)
      .set({ jubelioPaymentId: result.paymentId, updatedAt: new Date() })
      .where(eq(orders.id, input.orderId));
    log.info("Jubelio payment created and verified", {
      paymentId: result.paymentId,
      invoiceId: order.jubelioInvoiceId,
    });
    return { status: "confirmed" };
  } catch (error) {
    const classified = classifyGatewayError(error);
    const message = classified.message;
    // Never retry a payment; ambiguity and rejection both keep the order paid
    // but blocked and route to manual review. A KNOWN payment id stays
    // reconcilable by GET (never a confirmed pointer).
    await persistKnownReturnedIds(
      recorded.operation.id,
      gatewayKnownIds(error),
      log
    );
    await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
      message,
    });
    log.error("Jubelio payment not confirmed — manual review", {
      error: serializeError(error),
    });
    return { status: "manual_review", message };
  }
}

/**
 * Verifikasi payment terhadap record tersimpan.
 *
 * - Legacy: aturan lama (satu line untuk invoice ini, line amount dan header
 *   amount = subtotal lokal) — tidak diubah.
 * - Kontrak v2 (spec §10.2): exact amount = expected provider payable
 *   TERSIMPAN, account/type intent yang sah, tepat satu association ke
 *   invoice/SO yang benar, grand total line = payable, due 0, dan paid amount
 *   invoice (GET invoice) = payable. Missing field = mismatch (fail closed).
 */
async function verifyPaymentAgainstRequest(input: {
  payment: JubelioPaymentSnapshot;
  intent: JubelioSalesPaymentRequest | null;
  authority: SettlementAuthority;
  invoiceId: number;
  salesOrderId: number | null;
  legacyAmount: number;
  getGateway: () => JubelioSalesGateway;
}): Promise<string | null> {
  const payment = input.payment;
  const linked = payment.invoices.find(
    (item) => item.invoiceId === input.invoiceId
  );
  if (!linked || payment.invoices.length !== 1) {
    return `Payment has no single line for invoice ${input.invoiceId}`;
  }
  if (input.authority.kind === "legacy") {
    if (!moneyEquals(linked.paymentAmount, input.legacyAmount)) {
      return `Payment line amount does not match ${input.legacyAmount}`;
    }
    if (!moneyEquals(payment.amount, input.legacyAmount)) {
      return `Payment amount ${payment.amount} does not match ${input.legacyAmount}`;
    }
    return null;
  }
  if (input.authority.kind === "hold") {
    return input.authority.message;
  }
  const expectedPayable = input.authority.expectation.expectedProviderPayable;
  const intent = input.intent;
  if (!intent) {
    return "Payment intent snapshot is missing";
  }
  if (intent.invoiceId !== input.invoiceId) {
    return `Payment intent references invoice ${intent.invoiceId}, expected ${input.invoiceId}`;
  }
  if (!moneyEquals(intent.amount, expectedPayable)) {
    return `Payment intent amount ${intent.amount} does not match the stored expected provider payable ${expectedPayable}`;
  }
  if (!moneyEquals(payment.amount, expectedPayable)) {
    return `Payment amount ${payment.amount} does not match the stored expected provider payable ${expectedPayable}`;
  }
  if (!moneyEquals(linked.paymentAmount, expectedPayable)) {
    return `Payment line for invoice ${input.invoiceId} is ${linked.paymentAmount}, expected ${expectedPayable}`;
  }
  if (linked.grandTotal === undefined || !moneyEquals(linked.grandTotal, expectedPayable)) {
    return `Payment line grand total ${String(linked.grandTotal)} does not match the stored expected provider payable ${expectedPayable}`;
  }
  if (linked.due === undefined || !moneyEquals(linked.due, 0)) {
    return `Payment line due ${String(linked.due)} is not settled to 0`;
  }
  // Observed association uses the DTO spelling `salesorderId` (the parser
  // normalizes the provider's `salesorder_id`); a line pointing at another
  // sales order can never confirm this payment.
  if (
    linked.salesorderId !== null &&
    input.salesOrderId !== null &&
    linked.salesorderId !== input.salesOrderId
  ) {
    return `Payment line belongs to sales order ${String(linked.salesorderId)}, expected ${input.salesOrderId}`;
  }
  if (payment.accountId === undefined || payment.accountId !== intent.accountId) {
    return `Payment account ${String(payment.accountId)} does not match the stored account intent ${intent.accountId}`;
  }
  if (payment.paymentType === undefined || payment.paymentType !== intent.paymentType) {
    return `Payment type ${String(payment.paymentType)} does not match the stored type intent ${intent.paymentType}`;
  }
  // The paid invoice must show the same paid amount (spec §10.2). One GET; any
  // read failure keeps the stage held — never a second payment write.
  let paidInvoice;
  try {
    paidInvoice = await input.getGateway().getInvoice(input.invoiceId);
  } catch {
    return "Invoice paid amount could not be read after the payment";
  }
  if (
    paidInvoice.paymentAmount === undefined ||
    !moneyEquals(paidInvoice.paymentAmount, expectedPayable)
  ) {
    return `Invoice paid amount ${String(paidInvoice.paymentAmount)} does not match the stored expected provider payable ${expectedPayable}`;
  }
  if (!moneyEquals(paidInvoice.grandTotal, expectedPayable)) {
    return `Invoice grand total ${paidInvoice.grandTotal} does not match the stored expected provider payable ${expectedPayable}`;
  }
  return null;
}