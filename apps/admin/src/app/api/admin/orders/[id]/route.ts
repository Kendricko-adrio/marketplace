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
  jubelioSalesOperations,
} from "@/db";
import {
  asc,
  eq,
} from "drizzle-orm";
import { serializeError } from "@/lib/logger";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { deliveryShipments, deliveryTrackingEvents, deliveryBookingReviews } from "@/db";

import { authorizeLoaded } from "@/lib/rbac/resolver";
import { projectDeliveryAccess, projectDeliveryStage } from "@/lib/delivery-workflow";
import { deliverySettlementVerified } from "@/lib/delivery-settlement";
import { inspectDeliveryEligibility } from "@/lib/shipment-fulfillment";
import { createShipmentTracking } from "@marketplace/db/src/shipment-tracking";
import { createDeliveryFollowUp } from "@/lib/delivery-follow-up";

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
          // Remote Jubelio ids + fulfillment-block reason (Sales-Order flow).
          // A paid-but-ambiguous order shows these instead of a pickup code.
          jubelioSalesOrderId: orders.jubelioSalesOrderId,
          jubelioInvoiceId: orders.jubelioInvoiceId,
          jubelioPaymentId: orders.jubelioPaymentId,
          fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
          // Ticket 04/05 — the fulfillment method + the immutable delivery
          // snapshot (delivery rows never expose a pickup code instead).
          fulfillmentMethod: orders.fulfillmentMethod,
          deliverySnapshot: orders.deliverySnapshot,
          // Ticket 07 — the failure/manual evidence (the admin-only display
          // + the gated panels).
          deliveryFailureCode: orders.deliveryFailureCode,
          deliveryFailureAt: orders.deliveryFailureAt,
          deliveryFailureBy: orders.deliveryFailureBy,
          deliveryManualReason: orders.deliveryManualReason,
          deliveryManualAt: orders.deliveryManualAt,
          deliveryManualBy: orders.deliveryManualBy,
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
        // Ticket 06 — the handoff stamp + the verified tracking + POD.
        shipment: {
          state: deliveryShipments.state,
          awb: deliveryShipments.awb,
          trackingUrl: deliveryShipments.trackingUrl,
          quoteRates: deliveryShipments.quoteRates,
          bookedPrice: deliveryShipments.bookedPrice,
          billedPrice: deliveryShipments.billedPrice,
          attemptCount: deliveryShipments.attemptCount,
          dispatchedAt: deliveryShipments.dispatchedAt,
          bookedAt: deliveryShipments.bookedAt,
          packedAt: deliveryShipments.createdAt,
          packedBy: deliveryShipments.packedBy,
          bookedBy: deliveryShipments.bookedBy,
          handedOverAt: deliveryShipments.handedOverAt,
          handedOverBy: deliveryShipments.handedOverBy,
          latestStatus: deliveryShipments.latestStatus,
          latestEventAt: deliveryShipments.latestEventAt,
          deliveredAt: deliveryShipments.deliveredAt,
          podUrl: deliveryShipments.podUrl,
        },
      })
      .from(orders)
      .innerJoin(clients, eq(orders.userId, clients.id))
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .leftJoin(deliveryShipments, eq(deliveryShipments.orderId, orders.id))
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

    // Ticket 06 — the tracking timeline: receipts in order, with the applied
    // state and the ignore reason so the operator sees the diagnostics (the
    // statusDetail is only shown inside the orders:view-scoped detail).
    const trackingTimeline = await db
      .select({
        id: deliveryTrackingEvents.id,
        latestStatus: deliveryTrackingEvents.latestStatus,
        statusDetail: deliveryTrackingEvents.statusDetail,
        receivedAt: deliveryTrackingEvents.receivedAt,
        providerEventAt: deliveryTrackingEvents.providerEventAt,
        applied: deliveryTrackingEvents.applied,
        ignoredReason: deliveryTrackingEvents.ignoredReason,
        source: deliveryTrackingEvents.source,
      })
      .from(deliveryTrackingEvents)
      .innerJoin(deliveryShipments, eq(deliveryTrackingEvents.shipmentId, deliveryShipments.id))
      .where(eq(deliveryShipments.orderId, id))
      .orderBy(asc(deliveryTrackingEvents.receivedAt));
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

    // Ticket 05 — actor-allowed projection: the server-pinned Home Branch
    // match (the CTAs also require the client-side orders:edit hint, but the
    // routes enforce the real grants); an unpacked order ships shipment null
    // (the left-join's all-null row is normalized away).
    const shipmentRow = order[0].shipment?.state ? order[0].shipment : null;
    const homeBranchMatch =
      !!ctx.policy.user.homeBranchId &&
      ctx.policy.user.homeBranchId === order[0].order.branchId;
    const bookingReviews = order[0].order.fulfillmentMethod === "delivery" ? await db.select({
      attemptNumber: deliveryBookingReviews.attemptNumber,
      reference: deliveryBookingReviews.proofReference,
      reason: deliveryBookingReviews.proofReason,
      createdAt: deliveryBookingReviews.createdAt,
    }).from(deliveryBookingReviews).where(eq(deliveryBookingReviews.orderId, id)).orderBy(asc(deliveryBookingReviews.createdAt)) : [];
    let workflow = null;
    if (order[0].order.fulfillmentMethod === "delivery") {
      const canEditOrders = authorizeLoaded(ctx.policy, "orders", "edit").allowed;
      const homeBranchId = ctx.policy.user.homeBranchId;
      const homeBranch = homeBranchId ? await db.select({ name: branches.name }).from(branches).where(eq(branches.id, homeBranchId)).limit(1) : [];
      const access = projectDeliveryAccess({
        canEditOrders, homeBranchId, homeBranchName: homeBranch[0]?.name,
        orderBranchId: order[0].order.branchId, orderBranchName: order[0].branch?.name,
      });
      const settlement = await db.select().from(jubelioSalesOperations).where(eq(jubelioSalesOperations.orderId, id));
      const stage = projectDeliveryStage({
        ...order[0].order, shipment: shipmentRow,
        settlementVerified: deliverySettlementVerified(order[0].order, settlement),
      });
      const eligibility = access.allowed
        ? await inspectDeliveryEligibility(db, id, { id: ctx.user.id, homeBranchId, canEditOrders })
        : { eligible: false, known: true };
      const tracking = access.allowed ? await createShipmentTracking(db).inspect(id, { id: ctx.user.id, homeBranchId, canEditOrders }) : { reconcile: false, handoff: false };
      const special = access.allowed ? await createDeliveryFollowUp(db).inspect(id, { id: ctx.user.id, homeBranchId, canEditOrders }) : { failure: false, release: false, finish: false };
      workflow = { stage, access, eligibility, tracking, special };
    }
    orderLog.info("orders.detail", { outcome: "success", scope: authorization.mode, stockOperationCount: stockOperations.length });
    return NextResponse.json({
      success: true,
      data: {
        ...order[0].order,
        customer: order[0].customer,
        branch: order[0].branch,
        shipment: shipmentRow,
        actor: { allowed: homeBranchMatch },
        workflow,
        bookingReviews,
        trackingTimeline,
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