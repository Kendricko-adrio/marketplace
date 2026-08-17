import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, orderItems, jubelioStockOperations } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createPayment } from "@/lib/midtrans";
import { requestLogger, serializeError, withRequestId } from "@/lib/logger";

export async function POST(request: NextRequest) {
  let log = requestLogger(request, { module: "midtrans-create" });
  log.info("repayment requested");
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return withRequestId(access.response, log);
    const { session } = access;

    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      log.warn("repayment rejected — orderId missing");
      return withRequestId(NextResponse.json(
        { success: false, error: "orderId is required" },
        { status: 400 }
      ), log);
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
    log = log.child({ orderId, userId: session.user.id });

    if (order.userId !== session.user.id) {
      log.warn("repayment rejected — ownership mismatch");
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    // Only allow re-payment for pending_payment orders (failed_payment is final)
    if (order.status !== "pending_payment") {
      log.warn("repayment rejected — order is not pending payment", { status: order.status });
      return NextResponse.json(
        {
          success: false,
          error: "Order is not pending payment",
        },
        { status: 400 }
      );
    }

    const reserveRows = await db
      .select({ status: jubelioStockOperations.status })
      .from(jubelioStockOperations)
      .where(
        and(
          eq(jubelioStockOperations.orderId, orderId),
          eq(jubelioStockOperations.type, "reserve"),
          inArray(jubelioStockOperations.status, ["applied", "committed"])
        )
      )
      .limit(1);
    if (reserveRows.length === 0) {
      log.warn("repayment rejected — Jubelio reserve not confirmed");
      return NextResponse.json(
        {
          success: false,
          error: "Stock has not been confirmed by Jubelio",
        },
        { status: 409 }
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

    // Persist Snap redirect URL
    await db
      .update(orders)
      .set({ snapRedirectUrl: result.redirectUrl })
      .where(eq(orders.id, orderId));
    log.info("repayment payment created", { redirectUrl: !!result.redirectUrl });

    return withRequestId(NextResponse.json({
      success: true,
      redirectUrl: result.redirectUrl,
      token: result.token,
    }), log);
  } catch (error) {
    log.error("repayment failed", { error: serializeError(error) });
    return withRequestId(NextResponse.json(
      { success: false, error: "Failed to create payment" },
      { status: 500 }
    ), log);
  }
}
