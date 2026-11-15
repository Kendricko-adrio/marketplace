/**
 * Service operasi `completePickupOrder` — satu operasi: penyelesaian pickup
 * (guard `ready_for_pickup` → `completed`) + produksi efek komunikasi.
 *
 * - Order versi komunikasi 1: fakta `pickup_completed` dicatat pada transaksi
 *   yang sama, lalu job email diproduksi worker (tanpa direct-send kedua).
 * - Order versi 0: perilaku legacy (email selesai langsung) dipertahankan.
 *
 * HMAC tetap diverifikasi di HTTP adapter; service ini tidak menyentuh request.
 */

import { db } from "@/db";
import { orderItems, orders } from "@/db";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email";
import {
  orderCompletedEmailHTML,
  orderCompletedEmailText,
} from "@/lib/email-templates-order";
import { createModuleLogger } from "@/lib/logger";
import { projectOrderCommunications } from "@/features/order-communications/project-order-communications-service";
import {
  completePickupWithCommunicationEvent,
  type PickupCompletionOutcome,
} from "./pickup-completion-repository";

const log = createModuleLogger("complete-pickup");

async function sendLegacyCompletionEmail(orderId: string): Promise<void> {
  try {
    const [orderRows, items] = await Promise.all([
      db.select().from(orders).where(eq(orders.id, orderId)).limit(1),
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
    const order = orderRows[0];
    if (!order) return;
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
    await sendEmail({
      to: order.contactEmail,
      subject: `Your Order has been Completed — #${order.id.slice(0, 8).toUpperCase()}`,
      html: orderCompletedEmailHTML({ order: emailOrder, items }),
      text: orderCompletedEmailText({ order: emailOrder, items }),
    });
  } catch {
    log.error(`Order ${orderId}: completion email failed`);
  }
}

export async function completePickupOrder(input: {
  orderId: string;
}): Promise<PickupCompletionOutcome> {
  const rows = await db
    .select({
      id: orders.id,
      status: orders.status,
      orderCommunicationVersion: orders.orderCommunicationVersion,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  const order = rows[0];
  if (!order) return { status: "not_found" };
  if (order.status !== "ready_for_pickup" && order.status !== "completed") {
    return { status: "not_ready", orderStatus: order.status };
  }

  const outcome = await completePickupWithCommunicationEvent({
    orderId: input.orderId,
    now: new Date(),
  });

  if (outcome.status === "completed" && order.orderCommunicationVersion >= 1) {
    try {
      const projection = await projectOrderCommunications({
        limit: 1,
        orderId: input.orderId,
        mirror: false,
      });
      log.info(
        `Order ${input.orderId}: pickup-completed email queued (jobs ${projection.emailJobsCreated})`
      );
    } catch {
      log.error(`Order ${input.orderId}: pickup-completed projection failed`);
    }
  } else if (outcome.status === "completed") {
    await sendLegacyCompletionEmail(input.orderId);
  }

  return outcome;
}
