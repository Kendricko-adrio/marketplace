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
  discountCodes,
  discountRedemptions,
  discountOfferRevisions,
} from "@/db";
import { hasGlobalGrant } from "@/lib/admin-command";
import { maskPromoCode } from "@marketplace/db/src/discount-code";
import {
  and,
  asc,
  eq,
} from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { deliveryShipments, deliveryTrackingEvents, deliveryBookingReviews } from "@/db";

import { authorizeLoaded } from "@/lib/rbac/resolver";
import { projectDeliveryAccess, projectDeliveryStage } from "@/lib/delivery-workflow";
import { deliverySettlementVerified } from "@/lib/delivery-settlement";
import { inspectDeliveryEligibility } from "@/lib/shipment-fulfillment";
import { createShipmentTracking } from "@marketplace/db/src/shipment-tracking";
import { createDeliveryFollowUp } from "@/lib/delivery-follow-up";
// Ticket 01 diskon — decoder uang versi yang sama dengan store (pure, tanpa
// runtime shared DB).
import {
  readOrderPricing,
  PricingContractError,
} from "@marketplace/db/src/versioned-pricing";

export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-orders-detail");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/decoder tidak
 * pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

// GET /api/admin/orders/[id]   [orders:view]
//
// Own-branch scope pins the lookup to the Home Branch: a cross-branch order
// id maps to 404 so existence is not disclosed. All-branch scope is
// unrestricted.
async function orderDetail(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guardResult = await guard("orders", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const { id } = await params;
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      log.warn(
        `orders detail ditolak: branch scope tidak dapat ditentukan (order ${id}, userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
      );
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
          // Ticket 01 diskon — versi kontrak uang + snapshot JSONB; nominal
          // dibaca lewat decoder yang sama dengan store, bukan kolom mentah.
          pricingContractVersion: orders.pricingContractVersion,
          pricingEngineVersion: orders.pricingEngineVersion,
          providerContractVersion: orders.providerContractVersion,
          pricingSnapshot: orders.pricingSnapshot,
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
      crossBranchNotFound();
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
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    // Ticket 01 diskon — paired reader. Setelah RBAC/branch scope lolos, admin
    // men-decode snapshot tersimpan dengan decoder shared yang sama dengan
    // store, SEBELUM DTO uang atau workflow delivery dibangun. Uang diproyeksikan
    // dari snapshot, bukan dari kolom relational/master price/config terbaru;
    // baris legacy tetap memakai decoder legacy eksplisit (cents). Route ini
    // read-only: tidak ada reprice maupun provider write.
    const persistedOrder = order[0].order;
    let pricing: ReturnType<typeof readOrderPricing>;
    try {
      pricing = readOrderPricing(persistedOrder);
    } catch (pricingError) {
      // Versi unknown/corrupt fail closed: error generik 500 + konteks terstruktur
      // (kode kontrak + ketiga kolom versi tersimpan), tanpa menyentuh provider.
      // Kode kontrak adalah token statis, bukan teks bebas DB/decoder.
      log.error(
        `orders detail gagal decode pricing (order ${id}, pricingErrorCode ${
          pricingError instanceof PricingContractError ? pricingError.code : "UNKNOWN"
        }, pricingContractVersion ${persistedOrder.pricingContractVersion ?? "null"}, pricingEngineVersion ${persistedOrder.pricingEngineVersion ?? "null"}, providerContractVersion ${persistedOrder.providerContractVersion ?? "null"}, outcome error)`,
        new RouteLogError("orders detail pricing fail-closed")
      );
      return NextResponse.json(
        { success: false, error: "Failed to fetch order" },
        { status: 500 }
      );
    }
    const pricedOrder = {
      ...persistedOrder,
      subtotal: pricing.subtotal,
      discount:
        pricing.pricingContractVersion === 1
          ? pricing.goodsDiscount
          : pricing.discount,
      shippingCost: pricing.shippingCost,
      serviceFee: pricing.serviceFee,
      ppnRate: pricing.ppnRatePercent,
      ppnAmount: pricing.ppnAmount,
      total: pricing.total,
      pricingSnapshot: pricing.pricingContractVersion === 1 ? pricing : null,
    };

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
        pricingContractVersion: orderItems.pricingContractVersion,
        netLineAmount: orderItems.netLineAmount,
        createdAt: orderItems.createdAt,
        productId: productVariants.productId,
        thumbnail: products.thumbnail,
      })
      .from(orderItems)
      .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(orderItems.orderId, id));

    // Line kontrak `1` diambil dari snapshot (quantity, harga efektif, net line);
    // baris versi yang tidak cocok fail closed, sama seperti pembaca store.
    const itemsWithImages = items.map((item) => {
      const line =
        pricing.pricingContractVersion === 1
          ? pricing.lines.find((candidate) => candidate.variantId === item.variantId)
          : null;
      if (
        pricing.pricingContractVersion === 1 &&
        (!line || item.pricingContractVersion !== 1)
      ) {
        throw new Error("Order item pricing version mismatch");
      }
      return {
        ...item,
        price: line?.effectiveUnitPrice ?? item.price,
        quantity: line?.quantity ?? item.quantity,
        netLineAmount: line?.netLineAmount ?? item.netLineAmount,
        imageUrl: item.thumbnail ?? null,
      };
    });

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
    log.info(
      `orders detail served (order ${id}, scope ${authorization.mode}, stockOperationCount ${stockOperations.length}, outcome success)`
    );
    // Ticket 07 — read-only Coupon redemption state for ops. No customer
    // identities beyond this order and no Offer code literal (public only).
    const [redemption] = await db
      .select({
        offerName: discountOfferRevisions.name,
        benefitAmount: discountRedemptions.benefitAmount,
        activationKind: discountRedemptions.activationKind,
        codeId: discountRedemptions.codeId,
        canonicalCode: discountCodes.canonicalCode,
        status: discountRedemptions.status,
        policyVersion: discountRedemptions.policyVersion,
        consumedAt: discountRedemptions.consumedAt,
        releasedAt: discountRedemptions.releasedAt,
      })
      .from(discountRedemptions)
      .leftJoin(discountCodes, eq(discountCodes.id, discountRedemptions.codeId))
      .innerJoin(
        discountOfferRevisions,
        and(
          eq(discountOfferRevisions.id, discountRedemptions.revisionId),
          eq(discountOfferRevisions.offerId, discountRedemptions.offerId)
        )
      )
      .where(eq(discountRedemptions.orderId, order[0].order.id))
      .limit(1);
    /**
     * Viewer admin menerima label masked + codeId; literal hanya untuk promo
     * editor (discounts:view+edit). Audit/export/daftar kode tetap masked.
     */
    const canViewCodeLiteral =
      hasGlobalGrant(ctx.policy, "discounts", "view") &&
      hasGlobalGrant(ctx.policy, "discounts", "edit");
    const promo = redemption
      ? {
          ...redemption,
          canonicalCode: undefined,
          code: canViewCodeLiteral ? redemption.canonicalCode : null,
          maskedCode: redemption.canonicalCode
            ? maskPromoCode(redemption.canonicalCode)
            : null,
        }
      : null;
    return NextResponse.json({
      success: true,
      data: {
        ...pricedOrder,
        customer: order[0].customer,
        branch: order[0].branch,
        shipment: shipmentRow,
        promo,
        actor: { allowed: homeBranchMatch },
        workflow,
        bookingReviews,
        trackingTimeline,
        items: itemsWithImages,
        stockOperations,
      },
    });
  } catch {
    log.error(
      "orders detail gagal (outcome error)",
      new RouteLogError("orders detail gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(orderDetail, "admin-orders-detail");