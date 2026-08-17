import { after, NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, orderItems } from "@/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";
import {
  orderCompletedEmailHTML,
  orderCompletedEmailText,
} from "@/lib/email-templates-order";
import { requestLogger, serializeError } from "@/lib/logger";

// Internal endpoint called by the admin app to mark an order as completed
// and send Email #2 (Order Completed). Guarded by an HMAC secret derived
// from BETTER_AUTH_SECRET so only the admin app (which shares the secret)
// can call it.

function computeExpectedSecret(orderId: string): string {
  const authSecret = process.env.BETTER_AUTH_SECRET;
  if (!authSecret) return "";
  return crypto
    .createHmac("sha256", authSecret)
    .update(orderId)
    .digest("hex");
}

export async function POST(request: NextRequest) {
  const log = requestLogger(request, { module: "order-complete" });
  let orderId: string | undefined;
  try {
    const body = await request.json();
    orderId = body.orderId;
    const { secret } = body;

    if (!orderId) {
      log.warn("missing orderId");
      return NextResponse.json(
        { success: false, error: "orderId is required" },
        { status: 400 }
      );
    }
    const completedOrderId = orderId;

    const orderLog = log.child({ orderId });

    // Verify the shared secret
    const expectedSecret = computeExpectedSecret(orderId);
    if (!expectedSecret || secret !== expectedSecret) {
      orderLog.error("invalid shared secret — unauthorized");
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Load the order
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (orderRows.length === 0) {
      orderLog.error("order not found");
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const order = orderRows[0];

    // Only allow completion from ready_for_pickup
    if (order.status !== "ready_for_pickup") {
      orderLog.warn("order not in ready_for_pickup", { status: order.status });
      return NextResponse.json(
        {
          success: false,
          error: `Order must be ready_for_pickup (current: ${order.status})`,
        },
        { status: 400 }
      );
    }

    // Mark as completed
    const completedAt = new Date();
    await db
      .update(orders)
      .set({
        status: "completed",
        updatedAt: completedAt,
      })
      .where(eq(orders.id, orderId));

    orderLog.info("order completed", { completedAt: completedAt.toISOString() });

    // Email is a post-response side effect. SMTP latency must not keep the
    // admin's pickup verification request open after the order is committed.
    after(async () => {
      try {
        const items = await db
        .select({
          productName: orderItems.productName,
          variantInfo: orderItems.variantInfo,
          price: orderItems.price,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, completedOrderId));

        const html = orderCompletedEmailHTML({
          order: {
            id: order.id,
            total: order.total,
            subtotal: order.subtotal,
            serviceFee: order.serviceFee,
            pickupDate: order.pickupDate,
            pickupTime: order.pickupTime,
          },
          items,
        });

        const text = orderCompletedEmailText({
          order: {
            id: order.id,
            total: order.total,
            subtotal: order.subtotal,
            serviceFee: order.serviceFee,
            pickupDate: order.pickupDate,
            pickupTime: order.pickupTime,
          },
          items,
        });

        await sendEmail({
          to: order.contactEmail,
          subject: `Your Order has been Completed — #${order.id.slice(0, 8).toUpperCase()}`,
          html,
          text,
        });
      } catch (emailError) {
        log.error("completion email failed", {
          orderId: completedOrderId,
          error: serializeError(emailError),
        });
      }
    });

    return NextResponse.json({
      success: true,
      completedAt: completedAt.toISOString(),
    });
  } catch (error) {
    log.error("complete order failed", {
      orderId,
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to complete order" },
      { status: 500 }
    );
  }
}
