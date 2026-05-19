import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";

// Mock payment callback/webhook
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Mock signature verification (in real implementation, verify Midtrans signature)
    const { order_id, transaction_status, payment_type } = body;

    if (!order_id || !transaction_status) {
      return NextResponse.json(
        { success: false, error: "Invalid callback data" },
        { status: 400 }
      );
    }

    // Map Midtrans status to our status
    let paymentStatus: "pending" | "paid" | "failed" = "pending";
    let orderStatus: "proses" | "batal" = "proses";

    switch (transaction_status) {
      case "capture":
      case "settlement":
        paymentStatus = "paid";
        orderStatus = "proses";
        break;
      case "deny":
      case "cancel":
      case "expire":
        paymentStatus = "failed";
        orderStatus = "batal";
        break;
      case "pending":
        paymentStatus = "pending";
        break;
    }

    // Update order status
    await db
      .update(orders)
      .set({
        paymentStatus,
        status: orderStatus,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order_id));

    console.log(
      `Payment callback received: Order ${order_id} - Status: ${paymentStatus}`
    );

    return NextResponse.json({
      success: true,
      message: "Callback processed",
    });
  } catch (error) {
    console.error("Error processing payment callback:", error);
    return NextResponse.json(
      { success: false, error: "Failed to process callback" },
      { status: 500 }
    );
  }
}
