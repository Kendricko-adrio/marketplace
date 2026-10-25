import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, orderItems } from "@/db";
import { eq } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createPayment } from "@/lib/midtrans";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { buildPaymentItemDetails } from "@/lib/payment-item-details";
import { getConfigNumber } from "@/lib/config";
import { readOrderPricing } from "@/lib/versioned-pricing";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("payments-midtrans-create");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari Midtrans/DB
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

async function createRepayment(request: NextRequest): Promise<Response> {
  log.info("repayment requested");
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      log.warn("repayment rejected — orderId missing");
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
      log.warn(
        `repayment rejected — ownership mismatch (order ${orderId}, user ${session.user.id})`
      );
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    // Validate every explicit version before returning an existing redirect
    // too: unknown contracts must never reach payment or financial display.
    const pricing = readOrderPricing(order);

    // Only allow re-payment for pending_payment orders (failed_payment is final)
    if (order.status !== "pending_payment") {
      log.warn(
        `repayment rejected — order is not pending payment (order ${orderId}, status ${order.status})`
      );
      return NextResponse.json(
        {
          success: false,
          error: "Order is not pending payment",
        },
        { status: 400 }
      );
    }

    // Reject orders past their reservation TTL — the sweep cron has likely
    // already released the stock, and extending the reservation here would
    // contradict `orders.expiresAt`.
    if (order.expiresAt && order.expiresAt.getTime() <= Date.now()) {
      log.warn(
        `repayment rejected — order expired (order ${orderId}, expires ${order.expiresAt.toISOString()})`
      );
      return NextResponse.json(
        { success: false, error: "Order has expired. Please create a new order." },
        { status: 400 }
      );
    }

    // Reuse the existing Snap redirect URL when present: the customer may have
    // already chosen a payment method (Midtrans marks the order_id as used and
    // refuses to re-create a token for it), so a new token would fail.
    if (order.snapRedirectUrl) {
      log.info(`repayment reusing existing Snap redirect URL (order ${orderId})`);
      return NextResponse.json({
        success: true,
        redirectUrl: order.snapRedirectUrl,
        token: null,
      });
    }

    // Re-payment reuses the SAME confirmed Sales Order — never a new SO. The
    // create operation must be confirmed (verified via GET /sales/orders/{id})
    // before Midtrans is involved; the settlement pipeline later converts that
    // same SO to an invoice.
    if (order.jubelioSalesOrderId == null) {
      log.warn(
        `repayment rejected — no confirmed Jubelio Sales Order (order ${orderId})`
      );
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

    // Align the Midtrans expiry countdown with the remaining reservation TTL
    // (anchored at `expiresAt`), so re-created tokens cannot outlive the
    // reservation clock.
    const ttlConfig = await getConfigNumber("reservation.ttlMinutes", 15);
    const remainingMs = order.expiresAt
      ? order.expiresAt.getTime() - Date.now()
      : ttlConfig * 60_000;
    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));

    const result = await createPayment(
      orderId,
      Number(pricing.total),
      {
        first_name: session.user.name || "Customer",
        email: order.contactEmail,
        phone: order.contactPhone,
      },
      buildPaymentItemDetails({
        items: pricing.pricingContractVersion === 1
          ? pricing.lines.map((line) => ({ id: line.variantId,
              name: items.find((item) => item.variantId === line.variantId)?.productName ?? "Product",
              price: line.effectiveUnitPrice, quantity: line.quantity }))
          : items.map((item) => ({ id: item.variantId, name: item.productName, price: item.price, quantity: item.quantity })),
        discount: pricing.pricingContractVersion === 1 ? pricing.goodsDiscount : pricing.discount,
        shippingCost: pricing.shippingCost,
        serviceFee: pricing.serviceFee,
        ppnRatePercent: pricing.ppnRatePercent,
        ppnAmount: pricing.ppnAmount,
        total: pricing.total,
      }),
      remainingMinutes,
      // Anchor rounded-up duration backwards from the existing deadline so
      // Midtrans expiry never extends the local reservation even by seconds.
      order.expiresAt ? new Date(order.expiresAt.getTime() - remainingMinutes * 60_000) : new Date()
    );

    // Persist Snap redirect URL
    await db
      .update(orders)
      .set({ snapRedirectUrl: result.redirectUrl })
      .where(eq(orders.id, orderId));
    log.info(
      `repayment payment created (order ${orderId}, redirect ${result.redirectUrl ? "ada" : "kosong"})`
    );

    return NextResponse.json({
      success: true,
      redirectUrl: result.redirectUrl,
      token: result.token,
    });
  } catch {
    log.error("repayment failed", new RouteLogError("repayment failed"));
    return NextResponse.json(
      { success: false, error: "Failed to create payment" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(createRepayment, "payments-midtrans-create");
