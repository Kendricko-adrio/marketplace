import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, orderItems } from "@/db";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";
import {
  orderCompletedEmailHTML,
  orderCompletedEmailText,
} from "@/lib/email-templates-order";

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
  try {
    const body = await request.json();
    const { orderId, secret } = body;

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "orderId is required" },
        { status: 400 }
      );
    }

    // Verify the shared secret
    const expectedSecret = computeExpectedSecret(orderId);
    if (!expectedSecret || secret !== expectedSecret) {
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
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const order = orderRows[0];

    // Only allow completion from ready_for_pickup
    if (order.status !== "ready_for_pickup") {
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

    // Send Email #2
    try {
      const items = await db
        .select({
          productName: orderItems.productName,
          variantInfo: orderItems.variantInfo,
          price: orderItems.price,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

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
      console.error(
        "order-complete: failed to send completion email:",
        emailError
      );
      // Don't fail the request — the order is already completed
    }

    return NextResponse.json({
      success: true,
      completedAt: completedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error completing order:", error);
    return NextResponse.json(
      { success: false, error: "Failed to complete order" },
      { status: 500 }
    );
  }
}