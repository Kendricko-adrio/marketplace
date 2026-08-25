import { db } from "@/db";
import { branches, notifications, orderItems, orders } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { sendEmail } from "./email";
import {
  pickupReadyEmailHTML,
  pickupReadyEmailText,
} from "./email-templates-order";
import { createLogger, serializeError, type Logger } from "./logger";

/** Runs the customer/admin effects after a late settlement has safely reached
 * ready_for_pickup. The notification query makes the durable admin effect
 * idempotent when reconciliation and webhook processing overlap. */
export async function deliverLatePaidOrderSideEffects(
  orderId: string,
  logger?: Logger
): Promise<void> {
  const log = (logger ?? createLogger({ module: "late-paid-side-effects" })).child({
    orderId,
  });
  const orderRows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.status, "ready_for_pickup"),
        eq(orders.paymentStatus, "paid")
      )
    )
    .limit(1);
  const order = orderRows[0];
  if (!order?.branchId || !order.pickupCode) return;

  try {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.orderId, orderId),
          eq(notifications.type, "order_paid")
        )
      )
      .limit(1);
    if (existing.length === 0) {
      const id = crypto.randomUUID();
      await db.insert(notifications).values({
        id,
        type: "order_paid",
        orderId,
        branchId: order.branchId,
        title: "Late Payment Confirmed — Ready for Pickup",
        message: `Order #${order.id.slice(0, 8).toUpperCase()} settled after expiry and its stock is now confirmed.`,
      });
      await db.execute(
        sql`SELECT pg_notify('new_notification', ${JSON.stringify({ id })})`
      );
    }
  } catch (error) {
    log.error("late-paid admin notification failed", {
      error: serializeError(error),
    });
  }

  try {
    const [branchRows, items] = await Promise.all([
      db.select().from(branches).where(eq(branches.id, order.branchId)).limit(1),
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
    const branch = branchRows[0];
    if (!branch) return;
    const emailOrder = {
      id: order.id,
      total: order.total,
      subtotal: order.subtotal,
      serviceFee: order.serviceFee,
      pickupDate: order.pickupDate,
      pickupTime: order.pickupTime,
    };
    await sendEmail({
      to: order.contactEmail,
      subject: `Pembayaran Dikonfirmasi — #${order.id.slice(0, 8).toUpperCase()}`,
      html: pickupReadyEmailHTML({
        order: emailOrder,
        pickupCode: order.pickupCode,
        branch,
        items,
      }),
      text: pickupReadyEmailText({
        order: emailOrder,
        pickupCode: order.pickupCode,
        branch,
        items,
      }),
    });
  } catch (error) {
    log.error("late-paid pickup email failed", { error: serializeError(error) });
  }
}
