import { db } from "@/db";
import {
  branchStocks,
  jubelioSalesOperations,
  orderItems,
  orders,
  type JubelioSalesOrderCreateRequest,
} from "@/db";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import {
  JubelioSalesGatewayError,
  createJubelioSalesGateway,
  type JubelioSalesGateway,
} from "./jubelio-sales-client";
import {
  claimJubelioSalesOperationForDispatch,
  getJubelioSalesOperation,
  markJubelioSalesOperationConfirmed,
  markJubelioSalesOperationManualReview,
  markJubelioSalesOperationRejectedAfterClaim,
  persistJubelioSalesInvoiceId,
  recordJubelioSalesIntent,
  type JubelioSalesOperation,
} from "./jubelio-sales-operations";
import { createLogger, serializeError, type Logger } from "./logger";

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

// Conditional operation claim and stock accounting live in ONE DB transaction.
// A crash either rolls the whole transaction back or leaves the operation
// marked accounted. Other orders' holds cannot be consumed by a replay.
async function accountConfirmedHold(orderId: string, type: "create" | "cancel"): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [op] = await tx.update(jubelioSalesOperations)
      .set({ holdAccountedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jubelioSalesOperations.orderId, orderId),
        eq(jubelioSalesOperations.type, type),
        eq(jubelioSalesOperations.status, "confirmed"),
        isNull(jubelioSalesOperations.holdAccountedAt)))
      .returning();
    if (!op) return false;
    const [order] = await tx.select({ branchId: orders.branchId }).from(orders)
      .where(eq(orders.id, orderId));
    if (!order?.branchId || (type === "create" && op.salesOrderId == null)) {
      throw new Error(`Cannot account confirmed ${type} hold: missing branch or remote id`);
    }
    const lines = await tx.select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
      .from(orderItems).where(eq(orderItems.orderId, orderId));
    if (lines.length === 0) throw new Error("Cannot account confirmed hold without order items");
    for (const line of lines) {
      if (type === "cancel") continue; // create already cleared this order's hold
      const [stock] = await tx.update(branchStocks).set({
        pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${line.quantity})`,
        availableStock: sql`GREATEST(COALESCE(${branchStocks.availableStock}, 0) - ${line.quantity}, 0)`,
        updatedAt: new Date(),
      }).where(and(eq(branchStocks.branchId, order.branchId),
        eq(branchStocks.productVariantId, line.variantId)))
        .returning({ branchId: branchStocks.branchId });
      if (!stock) throw new Error("Cannot account confirmed hold: stock row missing");
    }
    if (type === "create") {
      await tx.update(orders).set({ jubelioSalesOrderId: op.salesOrderId, updatedAt: new Date() })
        .where(eq(orders.id, orderId));
    }
    return true;
  });
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

  const claimed = await claimJubelioSalesOperationForDispatch(
    db,
    recorded.operation.id
  );
  if (!claimed.claimed) {
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
    });
  } catch (error) {
    const classified = classifyGatewayError(error);
    if (classified.kind === "ambiguous") {
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

  if (existing) {
    if (existing.status === "confirmed" && existing.invoiceId != null) {
      return { status: "confirmed" };
    }
    if (existing.status === "manual_review") {
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
    return {
      status: "manual_review",
      message: existing.lastError ?? "Invoice operation was rejected earlier",
    };
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
    });
    // Persist the returned invoice id BEFORE depending on it (crash leaves a
    // reconcilable GET handle).
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
  expectedSubtotal: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const invoice = input.invoice;
  const createOp = await getJubelioSalesOperation(db, { orderId: input.orderId, type: "create" });
  if (createOp?.status !== "confirmed" || createOp.payload.type !== "create") {
    return { ok: false, message: "No confirmed Sales Order request to verify invoice" };
  }
  const request = createOp.payload.create;
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
  if (invoice.contactId !== request.contactId || invoice.locationId !== request.locationId) {
    return { ok: false, message: "Invoice contact or branch differs from the Sales Order request" };
  }
  const expectedLines = [...request.items].sort((a, b) => a.itemId - b.itemId);
  const invoiceLines = [...invoice.items].sort((a, b) => a.itemId - b.itemId);
  if (expectedLines.length !== invoiceLines.length || invoiceLines.some((line, index) =>
    line.itemId !== expectedLines[index].itemId || line.quantity !== expectedLines[index].quantity ||
    !moneyEquals(line.price, expectedLines[index].price) ||
    !moneyEquals(line.amount, expectedLines[index].price * expectedLines[index].quantity)
  )) {
    return { ok: false, message: "Invoice item lines differ from the Sales Order request" };
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
    return {
      status: "manual_review",
      message: "Payment requires a verified invoice id",
    };
  }

  const existing = await getJubelioSalesOperation(db, {
    orderId: input.orderId,
    type: "payment",
  });
  if (existing) {
    if (existing.status === "confirmed" && existing.paymentId != null) {
      return { status: "confirmed" };
    }
    if (existing.status === "manual_review") {
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
          const mismatch = verifyPaymentAgainstRequest({
            payment,
            invoiceId: order.jubelioInvoiceId,
            amount: toIntegerMoney(order.subtotal),
          });
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
    return {
      status: "manual_review",
      message: existing.lastError ?? "Payment operation was rejected earlier",
    };
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
          amount: toIntegerMoney(order.subtotal),
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
    amount: toIntegerMoney(order.subtotal),
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
    });
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
    // but blocked and route to manual review.
    await markJubelioSalesOperationManualReview(db, recorded.operation.id, {
      message,
    });
    log.error("Jubelio payment not confirmed — manual review", {
      error: serializeError(error),
    });
    return { status: "manual_review", message };
  }
}

function verifyPaymentAgainstRequest(input: {
  payment: {
    invoiceId: number | null;
    amount: number;
    invoices: { invoiceId: number; paymentAmount: number; salesorderId: number | null }[];
  };
  invoiceId: number;
  amount: number;
}): string | null {
  const payment = input.payment;
  const linked = payment.invoices.find(
    (item) => item.invoiceId === input.invoiceId
  );
  if (!linked || payment.invoices.length !== 1) {
    return `Payment has no single line for invoice ${input.invoiceId}`;
  }
  if (!moneyEquals(linked.paymentAmount, input.amount)) {
    return `Payment line amount does not match ${input.amount}`;
  }
  if (!moneyEquals(payment.amount, input.amount)) {
    return `Payment amount ${payment.amount} does not match ${input.amount}`;
  }
  return null;
}