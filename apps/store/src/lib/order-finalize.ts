import { db } from "@/db";
import {
  orders,
  orderItems,
  branchStocks,
  branches,
  notifications,
  jubelioStockOperations,
} from "@/db";
import { eq, and, gte, inArray, sql } from "drizzle-orm";
import { sendEmail } from "@/lib/email";
import {
  pickupReadyEmailHTML,
  pickupReadyEmailText,
  paymentFailedEmailHTML,
  paymentFailedEmailText,
} from "@/lib/email-templates-order";
import { createLogger, serializeError, type Logger } from "@/lib/logger";
import { randomInt } from "node:crypto";
import { releaseJubelioStockForOrder } from "@/lib/jubelio-stock-saga";

// 6-char pickup code alphabet (no ambiguous chars: O, I, 0, 1)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePickupCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_CHARS[randomInt(CODE_CHARS.length)]
  ).join("");
}

export function canFinalizeReservedStock(
  reservedStock: number,
  quantity: number
): boolean {
  return reservedStock >= quantity;
}

export function getStockFinalizationDeltas(
  quantity: number,
  usesRemoteAdjustment: boolean
): { stock: number; reservedStock: number; pendingRemoteStock: number } {
  return {
    stock: usesRemoteAdjustment ? 0 : -quantity,
    reservedStock: -quantity,
    pendingRemoteStock: usesRemoteAdjustment ? 0 : -quantity,
  };
}

/**
 * Map a Midtrans transaction_status to a human-readable failure reason.
 * Returns null for non-failure statuses.
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

export type FinalizeResult = {
  claimed: boolean;
  pickupCode?: string | null;
};

/**
 * Minimal view of an order row needed by the finalizer. Callers pass the order
 * they already loaded (webhook) or a freshly loaded one (sweep); the finalizer
 * does not reload it for the claim — the claim-guard UPDATE is the source of
 * truth for who wins the race.
 */
type OrderView = {
  id: string;
  branchId: string | null;
  contactEmail: string;
  total: string;
  subtotal: string;
  serviceFee: string;
  pickupDate: Date | null;
  pickupTime: string | null;
};

/**
 * Atomically claim a pending_payment order as paid and finalize it:
 *   1. claim-guard UPDATE (pending_payment/pending → processing/paid). If it
 *      returns 0 rows, another handler (webhook or sweep) already processed the
 *      order → return { claimed: false } so the caller skips side effects.
 *   2. commit the already-applied Jubelio deduction by decreasing only
 *      reservedStock. `stock` already mirrors Jubelio's reduced on-hand value.
 *   3. generate a collision-checked pickup code and move to ready_for_pickup.
 *   4. send the pickup-ready email (best-effort, outside the tx).
 *
 * The claim guard serializes the webhook-vs-sweep race: only the first caller
 * to flip status off pending_payment proceeds; the other sees 0 rows and skips.
 */
export async function claimAndFinalizePaidOrder(
  orderId: string,
  order: OrderView,
  logger?: Logger
): Promise<FinalizeResult> {
  const log = logger?.child({ orderId }) ?? createLogger({ module: "order-finalize", orderId });
  if (!order.branchId) {
    log.error("cannot finalize — order has no branchId");
    return { claimed: false };
  }

  let pickupCode: string | null = null;

  pickupCode = await db.transaction(async (tx) => {
    // 1. Claim guard: pending_payment + pending → processing + paid.
    const claimed = await tx
      .update(orders)
      .set({
        status: "processing",
        paymentStatus: "paid",
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
    if (claimed.length === 0) return null; // already handled by another path

    // Orders created before this feature have no durable Jubelio operation.
    // Keep their former local-stock semantics during a rolling deployment.
    const reserveOperations = await tx
      .select({ id: jubelioStockOperations.id })
      .from(jubelioStockOperations)
      .where(
        and(
          eq(jubelioStockOperations.orderId, orderId),
          eq(jubelioStockOperations.type, "reserve")
        )
      )
      .limit(1);
    const usesRemoteAdjustment = reserveOperations.length > 0;

    // 2. Commit the already-applied remote reservation per item.
    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    for (const item of items) {
      const updatedStock = await tx
        .update(branchStocks)
        .set({
          ...(usesRemoteAdjustment
            ? {}
            : {
                stock: sql`${branchStocks.stock} - ${item.quantity}`,
                pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} - ${item.quantity}`,
              }),
          reservedStock: sql`${branchStocks.reservedStock} - ${item.quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(branchStocks.branchId, order.branchId!),
            eq(branchStocks.productVariantId, item.variantId),
            gte(branchStocks.reservedStock, item.quantity),
            ...(usesRemoteAdjustment
              ? []
              : [
                  gte(branchStocks.stock, item.quantity),
                  gte(branchStocks.pendingRemoteStock, item.quantity),
                ])
          )
        )
        .returning({ branchId: branchStocks.branchId });

      if (updatedStock.length === 0) {
        throw new Error(
          `Inventory reservation drift for variant ${item.variantId}`
        );
      }
    }

    await tx
      .update(jubelioStockOperations)
      .set({ status: "committed", updatedAt: new Date() })
      .where(
        and(
          eq(jubelioStockOperations.orderId, orderId),
          eq(jubelioStockOperations.type, "reserve"),
          eq(jubelioStockOperations.status, "applied")
        )
      );

    // 3. Generate a collision-checked pickup code.
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

    // 4. Move to ready_for_pickup with the pickup code.
    await tx
      .update(orders)
      .set({
        status: "ready_for_pickup",
        pickupCode: code,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    return code;
  });

  if (!pickupCode) return { claimed: false };

  // 5. Create admin notification so branch/HQ staff see the new paid order.
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

  // 6. Send pickup-ready email (best-effort, outside the tx).
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
 * Atomically claim a pending_payment order as failed and release its stock
 * reservation:
 *   1. claim-guard UPDATE (pending_payment → failed_payment). If 0 rows,
 *      another handler already processed it → return { claimed: false }.
 *   2. enqueue and attempt a compensating Jubelio +qty adjustment. Local
 *      reservedStock remains held until Jubelio confirms the release.
 *   3. send the payment-failed email (best-effort, outside the tx).
 *
 * Note: paid-order reversal (refund after settlement) is intentionally NOT
 * handled here — consistent with the webhook, which treats paid orders as
 * terminal and ignores later failure callbacks.
 */
export async function claimAndFailOrder(
  orderId: string,
  reason: string,
  midtransStatus: string,
  logger?: Logger
): Promise<FinalizeResult> {
  const log = logger?.child({ orderId }) ?? createLogger({ module: "order-finalize", orderId });
  // Re-load the order (the caller's in-memory copy may be stale by the time a
  // sweep batch reaches it).
  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (orderRows.length === 0) return { claimed: false };
  const order = orderRows[0];

  const claimed = await db.transaction(async (tx) => {
    const res = await tx
      .update(orders)
      .set({
        status: "failed_payment",
        paymentStatus: "failed",
        paymentFailureReason: reason,
        midtransFailureStatus: midtransStatus,
        updatedAt: new Date(),
      })
      .where(
        and(eq(orders.id, orderId), eq(orders.status, "pending_payment"))
      )
      .returning({ id: orders.id });
    if (res.length === 0) return false;

    return true;
  });

  if (!claimed) return { claimed: false };

  // The order is terminal immediately, but stock is not exposed locally until
  // the compensating Jubelio adjustment is confirmed. Failures remain durable
  // in jubelio_stock_operation and are retried by the sweep cron.
  try {
    const releaseResult = await releaseJubelioStockForOrder(orderId, undefined, log);
    if (releaseResult.status === "skipped" && order.branchId) {
      await db.transaction(async (tx) => {
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));
        for (const item of items) {
          const released = await tx
            .update(branchStocks)
            .set({
              reservedStock: sql`${branchStocks.reservedStock} - ${item.quantity}`,
              pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} - ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(branchStocks.branchId, order.branchId!),
                eq(branchStocks.productVariantId, item.variantId),
                gte(branchStocks.reservedStock, item.quantity),
                gte(branchStocks.pendingRemoteStock, item.quantity)
              )
            )
            .returning({ branchId: branchStocks.branchId });
          if (released.length === 0) {
            throw new Error(
              `Legacy inventory reservation drift for variant ${item.variantId}`
            );
          }
        }
      });
    }
  } catch (releaseError) {
    log.error("Jubelio stock release queued for retry", {
      error: serializeError(releaseError),
    });
  }

  // Send payment-failed email (best-effort, outside the tx).
  try {
    const itemsForEmail = await db
      .select({
        productName: orderItems.productName,
        variantInfo: orderItems.variantInfo,
        price: orderItems.price,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const emailOrder = {
      id: order.id,
      total: order.total,
      subtotal: order.subtotal,
      serviceFee: order.serviceFee,
      pickupDate: order.pickupDate,
      pickupTime: order.pickupTime,
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
      to: order.contactEmail,
      subject: `Pembayaran Gagal — #${order.id.slice(0, 8).toUpperCase()}`,
      html,
      text,
    });
  } catch (emailError) {
    log.error("payment-failed email failed", { error: serializeError(emailError) });
  }

  log.info("order failed_payment", { midtransStatus, reason });
  return { claimed: true };
}
