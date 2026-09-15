import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  orders,
  orderItems,
  branches,
  clients,
  productVariants,
  products,
  jubelioStockOperations,
} from "@/db";
import { asc, eq } from "drizzle-orm";
import { serializeError } from "@/lib/logger";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";

export const dynamic = "force-dynamic";

// GET /api/admin/orders/[id]   [orders:view]
//
// Own-branch scope pins the lookup to the Home Branch: a cross-branch order
// id maps to 404 so existence is not disclosed. All-branch scope is
// unrestricted.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("orders", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const orderLog = logger.child({ orderId: id });
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      orderLog.warn("orders.detail.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const order = await db
      .select({
        order: {
          id: orders.id,
          userId: orders.userId,
          branchId: orders.branchId,
          addressId: orders.addressId,
          voucherId: orders.voucherId,
          status: orders.status,
          paymentMethod: orders.paymentMethod,
          paymentStatus: orders.paymentStatus,
          paymentFailureReason: orders.paymentFailureReason,
          midtransFailureStatus: orders.midtransFailureStatus,
          pickupDate: orders.pickupDate,
          pickupTime: orders.pickupTime,
          contactPhone: orders.contactPhone,
          contactEmail: orders.contactEmail,
          subtotal: orders.subtotal,
          shippingCost: orders.shippingCost,
          discount: orders.discount,
          serviceFee: orders.serviceFee,
          ppnRate: orders.ppnRate,
          ppnAmount: orders.ppnAmount,
          total: orders.total,
          midtransTransactionId: orders.midtransTransactionId,
          shippingCarrier: orders.shippingCarrier,
          trackingNumber: orders.trackingNumber,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
        },
        customer: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
        },
        branch: branches,
      })
      .from(orders)
      .innerJoin(clients, eq(orders.userId, clients.id))
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .where(eq(orders.id, id))
      .limit(1);

    if (order.length === 0) {
      crossBranchNotFound(orderLog);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    // RBAC: own-branch scope can only view their branch's orders — cross-
    // branch ids hide behind 404.
    if (
      authorization.mode === "own" &&
      order[0].order.branchId !== authorization.branchId
    ) {
      crossBranchNotFound(orderLog);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    // Get order items with variant + product thumbnail (Jubelio CDN image)
    const items = await db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        variantId: orderItems.variantId,
        productName: orderItems.productName,
        variantInfo: orderItems.variantInfo,
        price: orderItems.price,
        quantity: orderItems.quantity,
        createdAt: orderItems.createdAt,
        productId: productVariants.productId,
        thumbnail: products.thumbnail,
      })
      .from(orderItems)
      .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(orderItems.orderId, id));

    const itemsWithImages = items.map((item) => ({
      ...item,
      imageUrl: item.thumbnail ?? null,
    }));
    const stockOperations = await db
      .select({
        id: jubelioStockOperations.id,
        type: jubelioStockOperations.type,
        status: jubelioStockOperations.status,
        remoteAdjustmentId: jubelioStockOperations.remoteAdjustmentId,
        attemptCount: jubelioStockOperations.attemptCount,
        lastError: jubelioStockOperations.lastError,
        createdAt: jubelioStockOperations.createdAt,
        updatedAt: jubelioStockOperations.updatedAt,
      })
      .from(jubelioStockOperations)
      .where(eq(jubelioStockOperations.orderId, id))
      .orderBy(asc(jubelioStockOperations.createdAt));

    orderLog.info("orders.detail", {
      outcome: "success",
      scope: authorization.mode,
      stockOperationCount: stockOperations.length,
    });
    return NextResponse.json({
      success: true,
      data: {
        ...order[0].order,
        customer: order[0].customer,
        branch: order[0].branch,
        items: itemsWithImages,
        stockOperations,
      },
    });
  } catch (error) {
    logger.error("orders.detail.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}