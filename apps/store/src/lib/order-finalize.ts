import { db } from "@/db";
import { orders, orderItems, branchStocks, branches } from "@/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { sendEmail } from "@/lib/email";
import {
  pickupReadyEmailHTML,
  pickupReadyEmailText,
  paymentFailedEmailHTML,
  paymentFailedEmailText,
} from "@/lib/email-templates-order";
import { createLogger, serializeError, type Logger } from "@/lib/logger";

// 6-char pickup code alphabet (no ambiguous chars: O, I, 0, 1)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePickupCode(): string {
  return Array.from(
    { length: 6 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  ).join("");
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
 *   2. convert the stock reservation into a real deduction per order item:
 *      stock -= qty, reservedStock -= qty, both clamped by GREATEST(0, ...) to
 *      absorb any drift. This also fixes the pre-reservation oversell bug (the
 *      old code did a read-modify-write with Math.max(0, …) and no guard).
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

    // 2. Convert reservation → real deduction per item.
    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    for (const item of items) {
      await tx
        .update(branchStocks)
        .set({
          stock: sql`GREATEST(0, ${branchStocks.stock} - ${item.quantity})`,
          reservedStock: sql`GREATEST(0, ${branchStocks.reservedStock} - ${item.quantity})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(branchStocks.branchId, order.branchId!),
            eq(branchStocks.productVariantId, item.variantId)
          )
        );
    }

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

  // 5. Send pickup-ready email (best-effort, outside the tx).
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
 *   2. release reservedStock per item (GREATEST(0, reservedStock - qty)). Stock
 *      itself is untouched: pending orders never deducted stock, they only
 *      held a reservation.
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

    // Release the reservation for each item (pending→failed: stock was never
    // deducted, only reserved).
    if (order.branchId) {
      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));
      for (const item of items) {
        await tx
          .update(branchStocks)
          .set({
            reservedStock: sql`GREATEST(0, ${branchStocks.reservedStock} - ${item.quantity})`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(branchStocks.branchId, order.branchId),
              eq(branchStocks.productVariantId, item.variantId)
            )
          );
      }
    }
    return true;
  });

  if (!claimed) return { claimed: false };

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