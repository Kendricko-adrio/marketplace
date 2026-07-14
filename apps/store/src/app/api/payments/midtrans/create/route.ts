import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, orderItems } from "@/db";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { createPayment } from "@/lib/midtrans";

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "orderId is required" },
        { status: 400 }
      );
    }

    // Load the order and verify ownership
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

    if (order.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    // Only allow re-payment for pending_payment orders
    if (order.status !== "pending_payment") {
      return NextResponse.json(
        {
          success: false,
          error: "Order is not pending payment",
        },
        { status: 400 }
      );
    }

    // Load order items for Midtrans item_details
    const items = await db
      .select({
        productName: orderItems.productName,
        variantId: orderItems.variantId,
        price: orderItems.price,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    const result = await createPayment(
      orderId,
      parseFloat(order.total),
      {
        first_name: session.user.name || "Customer",
        email: order.contactEmail,
        phone: order.contactPhone,
      },
      [
        ...items.map((item) => ({
          id: item.variantId,
          name: item.productName,
          price: parseFloat(item.price),
          quantity: item.quantity,
        })),
        {
          id: "SERVICE_FEE",
          name: "Service Fee",
          price: parseFloat(order.serviceFee),
          quantity: 1,
        },
      ]
    );

    // Persist Midtrans identifiers (Core API: transaction id; Snap: redirect URL)
    if (result.mode === "core") {
      await db
        .update(orders)
        .set({ midtransTransactionId: result.transactionId })
        .where(eq(orders.id, orderId));
    } else if (result.mode === "snap") {
      await db
        .update(orders)
        .set({ snapRedirectUrl: result.redirectUrl })
        .where(eq(orders.id, orderId));
    }

    return NextResponse.json({
      success: true,
      mode: result.mode,
      ...(result.mode === "core"
        ? {
            transactionId: result.transactionId,
            qrString: result.qrString,
            qrImageUrl: result.qrImageUrl,
          }
        : {
            redirectUrl: result.redirectUrl,
            token: result.token,
          }),
    });
  } catch (error) {
    console.error("Error creating Midtrans payment:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create payment" },
      { status: 500 }
    );
  }
}