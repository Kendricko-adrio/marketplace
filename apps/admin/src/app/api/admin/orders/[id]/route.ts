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
import { withPermission, getBranchScope } from "@/lib/auth-guard";
import { requestLogger, serializeError } from "@/lib/logger";

export const GET = withPermission(async (
  _ctx,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  let log = requestLogger(request, {
    module: "admin-orders",
    action: "detail",
    userId: _ctx.user.id,
    role: _ctx.user.role,
  });
  try {
    const { id } = await params;
    log = log.child({ orderId: id });
    const scope = getBranchScope(_ctx.user);

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
      log.warn("order not found");
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    // RBAC: branch admin can only view their own branch's orders
    if (scope.mode === "own" && order[0].order.branchId !== scope.branchId) {
      log.warn("forbidden — order belongs to a different branch", {
        orderBranchId: order[0].order.branchId,
        adminBranchId: scope.branchId,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden — order belongs to a different branch" },
        { status: 403 }
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

    log.info("order detail served", { stockOperationCount: stockOperations.length });
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
    log.error("fetch order detail failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}, "orders", "view");