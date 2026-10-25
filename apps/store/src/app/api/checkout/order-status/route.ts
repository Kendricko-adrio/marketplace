import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db";
import { eq } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("store-checkout-order-status");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap tidak pernah masuk log; kontrak HTTP tetap sama.
 */
class OrderStatusLogError extends Error {
  constructor() {
    super("checkout order-status: gagal membaca status order");
    this.name = "OrderStatusLogError";
  }
}

/**
 * GET /api/checkout/order-status?orderId=xxx
 * Returns the current paymentStatus & status of an order.
 * Used by the checkout page to poll for QRIS payment confirmation.
 * The webhook (/api/webhooks/midtrans) remains the source of truth —
 * this endpoint only reads the DB.
 */
async function readOrderStatus(request: NextRequest): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const orderId = request.nextUrl.searchParams.get("orderId");
    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "Missing orderId parameter" },
        { status: 400 }
      );
    }

    const orderRows = await db
      .select({
        id: orders.id,
        userId: orders.userId,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
      })
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

    // Ensure the order belongs to the authenticated user
    if (order.userId !== session.user.id) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      status: order.status,
      paymentStatus: order.paymentStatus,
    });
  } catch {
    log.error(
      "Status order gagal dibaca (outcome error)",
      new OrderStatusLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch order status" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(
  readOrderStatus,
  "store-checkout-order-status"
);
