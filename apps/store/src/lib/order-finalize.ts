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
import { createLogger, serializeError, type Logger } from "@/lib/logger";
import { generatePickupCode } from "@/lib/pickup-code";
import { dispatchJubelioSalesCancel } from "@/lib/jubelio-sales-lifecycle";

export { generatePickupCode } from "@/lib/pickup-code";

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
  logger?: Logger,
  paymentAttributes?: PaymentAttributes
): Promise<FinalizeResult> {
  const log = logger?.child({ orderId }) ?? createLogger({ module: "order-finalize", orderId });
  const claimed = await db
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
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.status, "pending_payment"),
        eq(orders.paymentStatus, "pending")
      )
    )
    .returning({ id: orders.id });
  if (claimed.length === 0) {
    log.info("paid-order claim lost — already handled by another path");
    return { claimed: false };
  }
  log.info("order paid → processing (awaiting Sales-Order settlement)");
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
  order: OrderView,
  logger?: Logger
): Promise<FinalizeResult> {
  const log = logger?.child({ orderId }) ?? createLogger({ module: "order-finalize", orderId });
  if (!order.branchId) {
    log.error("cannot fulfill — order has no branchId");
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
    log.error("admin notification insert failed", { error: serializeError(notifyError) });
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
    log.error("pickup-ready email failed", { error: serializeError(emailError) });
  }

  log.info("order paid → ready_for_pickup", { pickupCode });
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
  logger?: Logger,
  paymentAttributes?: PaymentAttributes
): Promise<FinalizeResult> {
  return claimPaidOrder(orderId, logger, paymentAttributes);
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
  logger?: Logger,
  paymentAttributes?: PaymentAttributes
): Promise<FinalizeResult> {
  const log = logger?.child({ orderId }) ?? createLogger({ module: "order-finalize", orderId });
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
      logger: log,
    });
    log.info("Sales-Order cancel dispatched on payment failure", {
      status: outcome.status,
      ...(outcome.status === "manual_review" || outcome.status === "rejected"
        ? { message: outcome.message }
        : {}),
      ...(outcome.status === "skipped" ? { message: outcome.message } : {}),
    });
    if (outcome.status === "manual_review") {
      await blockOrderFulfillment(
        orderId,
        `Sales-Order cancel is unresolved after payment failure: ${outcome.message}`
      );
    }
  } catch (cancelError) {
    log.error("Sales-Order cancel dispatch failed", {
      error: serializeError(cancelError),
    });
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
    log.error("payment-failed email failed", { error: serializeError(emailError) });
  }

  log.info("order failed_payment", { midtransStatus, reason });
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
  logger?: Logger,
  paymentAttributes?: PaymentAttributes
): Promise<LateSettlementResult> {
  const log = (logger ?? createLogger({ module: "late-settlement" })).child({ orderId });
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
    await db
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
      );
    log.warn("late settlement after cancel → manual review", { message });
    return { status: "manual_review", message };
  }

  const claimed = await claimLatePaidOrder(orderId, log, paymentAttributes);
  if (!claimed) return { status: "skipped" };
  log.info("late settlement claimed — settlement pipeline takes over");
  return { status: "settled" };
}

/**
 * Claim a failed_payment order back to processing + paid (late settlement with
 * an active Sales Order). Guarded to failed_payment + failed.
 */
export async function claimLatePaidOrder(
  orderId: string,
  logger?: Logger,
  paymentAttributes?: PaymentAttributes
): Promise<boolean> {
  const log = logger?.child({ orderId }) ?? createLogger({ module: "order-finalize", orderId });
  const claimed = await db
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
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.status, "failed_payment"),
        eq(orders.paymentStatus, "failed")
      )
    )
    .returning({ id: orders.id });
  if (claimed.length === 0) {
    log.info("late-paid claim lost — order moved on");
    return false;
  }
  return true;
}