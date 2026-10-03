import { db } from "@/db";
import { jubelioSalesOperations, orders } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  ensureJubelioInvoice,
  ensureJubelioPayment,
  getDefaultJubelioSalesGateway,
  releaseConfirmedSalesOrderHold,
} from "./jubelio-sales-lifecycle";
import {
  markJubelioSalesOperationConfirmed,
  markJubelioSalesOperationManualReview,
  markStaleJubelioSalesOperationForManualReview,
} from "./jubelio-sales-operations";
import {
  blockOrderFulfillment,
  fulfillPaidOrder,
  type OrderView,
} from "./order-finalize";
import { reconcileJubelioChannelStatusForOrder } from "./jubelio-channel-mirror";
import { createLogger, serializeError, type Logger } from "./logger";

/**
 * Sales-Order settlement pipeline (plan: jubelio-sales-api-switching,
 * feature 3 — Path 1 ONLY).
 *
 * On an authoritative Midtrans settlement, exactly once per order:
 *   SO → invoice conversion (persist invoice id) → `GET /sales/invoices/{id}`
 *   verification → `POST /sales/payments/` → verified payment association →
 *   ready_for_pickup.
 *
 * Any ambiguous or unverified invoice/payment KEEPS the Midtrans paid status,
 * blocks ready_for_pickup / pickup codes and creates a manual-review case.
 * No automatic retry, no automatic refund, never Path 2
 * (`/sales/packlists/create-invoice-payment`).
 */

export type SettlementOutcome =
  | { status: "fulfilled"; pickupCode: string | null }
  | { status: "manual_review"; message: string }
  | { status: "pending" }
  | { status: "skipped" };

type SettleOrderRow = {
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
  status: string;
  paymentStatus: string;
  // Ticket 04: `delivery` settlements never claim pickup — the verified gate
  // completes in `processing` (no ready_for_pickup, no pickup code).
  fulfillmentMethod: string | null;
  fulfillmentBlockedReason: string | null;
};

async function loadOrder(orderId: string): Promise<SettleOrderRow | null> {
  const rows = await db
    .select({
      id: orders.id,
      branchId: orders.branchId,
      contactEmail: orders.contactEmail,
      total: orders.total,
      subtotal: orders.subtotal,
      serviceFee: orders.serviceFee,
      ppnRate: orders.ppnRate,
      ppnAmount: orders.ppnAmount,
      pickupDate: orders.pickupDate,
      pickupTime: orders.pickupTime,
      status: orders.status,
      paymentStatus: orders.paymentStatus,
      fulfillmentMethod: orders.fulfillmentMethod,
      fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Run the full settlement pipeline for a PAID order. Idempotent: duplicate
 * webhook + sweep races converge on the durable ledger (at most one external
 * invoice conversion and one payment POST across all callers).
 */
export async function settleJubelioSalesOrder(
  orderId: string,
  options: { logger?: Logger; readOnlyRecovery?: boolean } = {}
): Promise<SettlementOutcome> {
  const log = options.logger ?? createLogger({ module: "jubelio-sales-settlement", orderId });
  const order = await loadOrder(orderId);
  if (!order || order.paymentStatus !== "paid") {
    return { status: "skipped" };
  }
  if (!["processing", "ready_for_pickup", "completed"].includes(order.status)) {
    return { status: "skipped" };
  }
  if (order.status !== "processing") {
    // Already fulfilled.
    return { status: "skipped" };
  }

  // Late-settlement race guard: a cancel that became active after the payment
  // claim must never be followed by invoice/payment writes.
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
  if (
    cancelOp.length > 0 &&
    ["confirmed", "dispatched_unknown", "intent", "manual_review"].includes(
      cancelOp[0].status
    )
  ) {
    const message =
      "Sales-Order cancel is active while payment is paid — manual reconciliation required";
    await blockOrderFulfillment(orderId, message);
    log.warn("settlement blocked by active cancel", { message });
    await reconcileChannelMirrorAfterManualReview(orderId, log, "cancel_active");
    return { status: "manual_review", message };
  }

  // Ticket 07 — the GET-only recovery flag forwards ONLY for a paid-
  // blocked DELIVERY order; a NORMAL settlement keeps the flag off (the
  // legacy behavior untouched; the recovery must never fire as a first
  // attempt).
  const recoveryForwarded =
    (options.readOnlyRecovery === true ||
      (order.fulfillmentMethod === "delivery" &&
        order.fulfillmentBlockedReason != null)) &&
    order.fulfillmentMethod === "delivery" &&
    order.fulfillmentBlockedReason != null;

  const invoiceResult = await ensureJubelioInvoice({
    orderId,
    logger: log,
    ...(recoveryForwarded ? { readOnlyRecovery: true } : {}),
  });
  if (invoiceResult.status !== "confirmed") {
    if (invoiceResult.status === "manual_review") {
      await blockOrderFulfillment(
        orderId,
        `Sales-Order invoice is unverified: ${invoiceResult.message}`
      );
      await reconcileChannelMirrorAfterManualReview(orderId, log, "invoice");
      return { status: "manual_review", message: invoiceResult.message };
    }
    return { status: "pending" };
  }

  const paymentResult = await ensureJubelioPayment({
    orderId,
    logger: log,
    ...(recoveryForwarded ? { readOnlyRecovery: true } : {}),
  });
  if (paymentResult.status !== "confirmed") {
    if (paymentResult.status === "manual_review") {
      await blockOrderFulfillment(
        orderId,
        `Sales-Order payment is unverified: ${paymentResult.message}`
      );
      await reconcileChannelMirrorAfterManualReview(orderId, log, "payment");
      return { status: "manual_review", message: paymentResult.message };
    }
    return { status: "pending" };
  }

  // Ticket 04 — DELIVERY gate: after BOTH invoice and payment are GET-
  // confirmed (the confirm-once ledger above just committed them), the paid
  // delivery order completes IN `processing` (no pickup code, no email, no
  // Siap-Proses mirror) and the paid-but-blocked reason is cleared by a
  // guarded conditional update (processing + paid only). A booking remains
  // ticket 05. The outcome is decided by the committed ledger, not by the
  // update's row count.
  if (order.fulfillmentMethod === "delivery") {
    await db
      .update(orders)
      .set({ fulfillmentBlockedReason: null, updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.paymentStatus, "paid"),
          eq(orders.status, "processing")
        )
      );
    log.info("delivery fulfillment gate completed in processing", {
      branchId: order.branchId,
    });
    return { status: "fulfilled", pickupCode: null };
  }

  const view: OrderView = {
    id: order.id,
    branchId: order.branchId,
    contactEmail: order.contactEmail,
    total: order.total,
    subtotal: order.subtotal,
    serviceFee: order.serviceFee,
    ppnRate: order.ppnRate,
    ppnAmount: order.ppnAmount,
    pickupDate: order.pickupDate,
    pickupTime: order.pickupTime,
  };
  const fulfilled = await fulfillPaidOrder(orderId, view, log);
  if (!fulfilled.claimed) {
    return { status: "skipped" };
  }
  // BEST-EFFORT channel mirror (ticket #03): pickup was just granted by the
  // committed local state. The Siap Proses projection must never block,
  // fail or unfulfill pickup: a mirror failure is logged and left to the
  // sweep's bounded GET-only reconciliation.
  try {
    const mirror = await reconcileJubelioChannelStatusForOrder(db, {
      orderId,
      logger: log,
    });
    log.info("channel-status mirror reconciled after fulfillment", {
      outcome: mirrorOutcomeStatus(mirror),
    });
  } catch (error) {
    log.error("channel-status mirror reconciliation failed after fulfillment", {
      error: serializeError(error),
    });
  }
  return { status: "fulfilled", pickupCode: fulfilled.pickupCode ?? null };
}

function mirrorOutcomeStatus(
  mirror:
    | { status: string; [key: string]: unknown }
    | undefined
): string {
  return typeof mirror?.status === "string" ? mirror.status : "unknown";
}

/**
 * Ticket #04: after a settlement manual review COMMITTED its paid-but-blocked
 * state (`fulfillment_blocked_reason`), project the `Menunggu Verifikasi`
 * marker onto the Status Channel — best effort. A mirror failure is logged
 * and NEVER changes the manual-review outcome, the paid status, the block or
 * pickup eligibility; the sweep's bounded paid-but-blocked pass covers any
 * missed dispatch.
 */
async function reconcileChannelMirrorAfterManualReview(
  orderId: string,
  log: Logger,
  step: "cancel_active" | "invoice" | "payment"
): Promise<void> {
  try {
    const mirror = await reconcileJubelioChannelStatusForOrder(db, {
      orderId,
      logger: log,
    });
    log.info("channel-status mirror reconciled after settlement manual review", {
      step,
      outcome: mirrorOutcomeStatus(mirror),
    });
  } catch (error) {
    log.error(
      "channel-status mirror reconciliation failed after settlement manual review",
      { step, error: serializeError(error) }
    );
  }
}

/**
 * Sweep-side settlement reconciliation: paid orders whose settlement never
 * completed (crash after the paid claim, ambiguous invoice/payment, or a
 * missed webhook) resume exactly where their durable ledger left off.
 */
export async function reconcileSettlements(
  limit = 50,
  logger?: Logger
): Promise<{ scanned: number; fulfilled: number; review: number; pending: number }> {
  const log = logger ?? createLogger({ module: "settlement-reconcile" });
  const stuck = await db
    .select({
      id: orders.id,
      fulfillmentMethod: orders.fulfillmentMethod,
      fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "processing"),
        eq(orders.paymentStatus, "paid"),
        // Only orders without a VERIFIED payment yet (fulfilled ones leave
        // `processing`).
      )
    )
    .limit(limit);
  let fulfilled = 0;
  let review = 0;
  let pending = 0;
  for (const row of stuck) {
    const outcome = await settleJubelioSalesOrder(row.id, {
      logger: log,
      // Ticket 07 — a paid-but-blocked DELIVERY order re-drives through the
      // GET-only recovery (the verified manual_review ops); everything else
      // keeps the legacy (option-off) settlement.
      ...(row.fulfillmentMethod === "delivery" &&
      row.fulfillmentBlockedReason != null
        ? { readOnlyRecovery: true }
        : {}),
    });
    if (outcome.status === "fulfilled") fulfilled++;
    else if (outcome.status === "manual_review") review++;
    else pending++;
  }
  log.info("settlement reconciliation completed", {
    scanned: stuck.length,
    fulfilled,
    review,
    pending,
  });
  return { scanned: stuck.length, fulfilled, review, pending };
}

/**
 * Sweep-side reconciliation of in-flight SO operations using the persisted
 * remote ids + GET (never a re-POST):
 *   - cancel ops: GET the SO; a confirmed cancel releases the hold.
 *   - invoice ops with a persisted invoice id: GET-verify → confirm or review.
 *   - payment ops with a persisted payment id: GET-verify → confirm or review.
 * Aged unknown dispatches without remote ids go to manual review (triage).
 */
export async function reconcileJubelioSalesOperations(
  limit = 50,
  options: { logger?: Logger; staleCutoffMs?: number } = {}
): Promise<{
  scanned: number;
  confirmed: number;
  released: number;
  marked: number;
  pending: number;
}> {
  const log = options.logger ?? createLogger({ module: "sales-op-reconcile" });
  const staleCutoff = Date.now() - (options.staleCutoffMs ?? 15 * 60_000);
  const rows = await db
    .select()
    .from(jubelioSalesOperations)
    .where(inArray(jubelioSalesOperations.status, ["dispatched_unknown"]))
    .limit(limit);

  let confirmed = 0;
  let released = 0;
  let marked = 0;
  let pending = 0;
  const gateway = getDefaultJubelioSalesGateway();

  for (const op of rows) {
    const opLog = log.child({
      orderId: op.orderId,
      operationId: op.id,
      type: op.type,
    });
    const aged = op.dispatchedAt != null && op.dispatchedAt.getTime() < staleCutoff;

    if (op.type === "cancel" && op.salesOrderId != null) {
      try {
        const snapshot = await gateway.getSalesOrder(op.salesOrderId);
        if (snapshot.isCanceled) {
          const done = await markJubelioSalesOperationConfirmed(db, op.id, {
            salesOrderId: op.salesOrderId,
          });
          if (done) {
            confirmed++;
            await releaseConfirmedSalesOrderHold(op.orderId, opLog);
            released++;
            opLog.info("cancel reconciled by GET — hold released", {
              salesOrderId: op.salesOrderId,
            });
            continue;
          }
        } else if (aged) {
          const reviewOp = await markJubelioSalesOperationManualReview(db, op.id, {
            message:
              "Cancel dispatch outcome is still unknown and the sales order is not canceled; inspect Jubelio before any action",
          });
          if (reviewOp) marked++;
          else pending++;
          continue;
        }
        pending++;
        continue;
      } catch (error) {
        opLog.warn("cancel reconcile GET failed", { error: String(error) });
        pending++;
        continue;
      }
    }

    if (op.type === "invoice" || op.type === "payment") {
      // Settlement steps reconcile through their own verified pipelines.
      const order = await loadOrder(op.orderId);
      if (!order || order.paymentStatus !== "paid") {
        pending++;
        continue;
      }
      if (op.invoiceId == null && op.paymentId == null && !aged) {
        pending++;
        continue;
      }
      try {
        const step =
          op.type === "invoice"
            ? await ensureJubelioInvoice({ orderId: op.orderId, logger: opLog })
            : await ensureJubelioPayment({ orderId: op.orderId, logger: opLog });
        if (step.status === "confirmed") confirmed++;
        else if (step.status === "manual_review") marked++;
        else pending++;
      } catch (error) {
        opLog.warn("settlement reconcile failed", { error: String(error) });
        pending++;
      }
      continue;
    }

    // create ops (and anything else): aged unknown → manual review triage.
    if (aged) {
      const reviewOp = await markStaleJubelioSalesOperationForManualReview(
        db,
        op.id,
        new Date(staleCutoff)
      );
      if (reviewOp) marked++;
      else pending++;
    } else {
      pending++;
    }
  }

  log.info("sales operation reconciliation completed", {
    scanned: rows.length,
    confirmed,
    released,
    marked,
    pending,
  });
  return { scanned: rows.length, confirmed, released, marked, pending };
}