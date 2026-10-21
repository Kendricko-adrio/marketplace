import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  deliveryShipments,
  deliveryTrackingEvents,
  orders,
  orderItems,
  productVariants,
  products,
  branches,
  discountRedemptions,
  discountOfferRevisions,
} from "@/db";
import { asc, eq, and } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createLogger, serializeError } from "@/lib/logger";
import { readOrderPricing } from "@/lib/versioned-pricing";
const log = createLogger({ module: "orders-detail" });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const { id } = await params;

    const order = await db
      .select({
        order: orders,
        branch: branches,
      })
      .from(orders)
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .where(and(eq(orders.id, id), eq(orders.userId, session.user.id)))
      .limit(1);

    if (order.length === 0) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const persistedOrder = order[0].order;
    const pricing = readOrderPricing(persistedOrder);
    const orderData = {
      ...persistedOrder,
      subtotal: pricing.subtotal,
      discount: pricing.pricingContractVersion === 1 ? pricing.goodsDiscount : pricing.discount,
      shippingCost: pricing.shippingCost, serviceFee: pricing.serviceFee,
      ppnRate: pricing.ppnRatePercent, ppnAmount: pricing.ppnAmount, total: pricing.total,
      pricingSnapshot: pricing.pricingContractVersion === 1 ? pricing : null,
    };
    const branchData = order[0].branch;

    // Only expose pickup code when order is ready_for_pickup or completed
    const pickupCode =
      orderData.status === "ready_for_pickup" || orderData.status === "completed"
        ? orderData.pickupCode
        : null;

    // Get items with productId + product thumbnail (Jubelio CDN image).
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
        sourceUnitPrice: orderItems.sourceUnitPrice,
        markdownAmount: orderItems.markdownAmount,
        goodsDiscountAmount: orderItems.goodsDiscountAmount,
        netLineAmount: orderItems.netLineAmount,
        createdAt: orderItems.createdAt,
        productId: productVariants.productId,
        thumbnail: products.thumbnail,
        slug: products.slug,
      })
      .from(orderItems)
      .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(orderItems.orderId, orderData.id));

    const itemsWithImages = items.map((item) => {
      const line = pricing.pricingContractVersion === 1 ? pricing.lines.find((line) => line.variantId === item.variantId) : null;
      if (pricing.pricingContractVersion === 1 && (!line || item.pricingContractVersion !== 1)) {
        throw new Error("Order item pricing version mismatch");
      }
      return { ...item, price: line?.effectiveUnitPrice ?? item.price,
        quantity: line?.quantity ?? item.quantity, netLineAmount: line?.netLineAmount ?? item.netLineAmount,
        imageUrl: item.thumbnail ?? null };
    });

    // Ticket 06 — the customer-safe tracking DTO: only the order this route
    // is already userId-pinned to; only the public tracking surface (the AWB
    // /link when booked, the APPLIED timeline events — ignored/late internal
    // receipts are never shown — and the safe POD link). The internal costs,
    // booking actors and the stored provider request are never exposed.
    const shipmentRows = await db
      .select({
        id: deliveryShipments.id,
        state: deliveryShipments.state,
        awb: deliveryShipments.awb,
        trackingUrl: deliveryShipments.trackingUrl,
        latestStatus: deliveryShipments.latestStatus,
        deliveredAt: deliveryShipments.deliveredAt,
        podUrl: deliveryShipments.podUrl,
      })
      .from(deliveryShipments)
      .where(eq(deliveryShipments.orderId, orderData.id))
      .limit(1);
    const shipmentStateRow = shipmentRows[0];
    const shipment = shipmentStateRow?.state ? shipmentStateRow : null;
    const trackRows = shipment
      ? await db
          .select({
            latestStatus: deliveryTrackingEvents.latestStatus,
            statusDetail: deliveryTrackingEvents.statusDetail,
            providerEventAt: deliveryTrackingEvents.providerEventAt,
            receivedAt: deliveryTrackingEvents.receivedAt,
          })
          .from(deliveryTrackingEvents)
          .where(
            and(
              eq(deliveryTrackingEvents.shipmentId, shipment.id),
              eq(deliveryTrackingEvents.applied, true)
            )
          )
          .orderBy(asc(deliveryTrackingEvents.receivedAt))
      : [];

    log.info("owned order detail read", { orderId: id, hasShipment: !!shipment });

    // Ticket 07 — the customer sees ONLY their own Coupon redemption status
    // (public Offers have no code literal to expose). A released redemption is
    // retained evidence, not an active discount.
    const [redemption] = await db
      .select({
        offerName: discountOfferRevisions.name,
        benefitAmount: discountRedemptions.benefitAmount,
        status: discountRedemptions.status,
        consumedAt: discountRedemptions.consumedAt,
        releasedAt: discountRedemptions.releasedAt,
      })
      .from(discountRedemptions)
      .innerJoin(
        discountOfferRevisions,
        and(
          eq(discountOfferRevisions.id, discountRedemptions.revisionId),
          eq(discountOfferRevisions.offerId, discountRedemptions.offerId)
        )
      )
      .where(eq(discountRedemptions.orderId, orderData.id))
      .limit(1);
    const promo = redemption
      ? {
          name: redemption.offerName,
          benefitAmount: redemption.benefitAmount,
          status: redemption.status,
          consumedAt: redemption.consumedAt,
          releasedAt: redemption.releasedAt,
        }
      : null;

    return NextResponse.json({
      success: true,
      data: {
        ...orderData,
        // Ticket 07 — the internal manual/actor evidence (the who/when of the
        // manual actions) never reaches the customer; the failure CODE stays
        // visible as a safe status. No automatic communications exist.
        deliveryManualReason: undefined,
        deliveryManualAt: undefined,
        deliveryManualBy: undefined,
        deliveryFailureBy: undefined,
        pickupCode,
        branch: branchData,
        promo,
        items: itemsWithImages,
        shipment: shipment
          ? {
              awb: shipment.awb,
              trackingUrl: shipment.trackingUrl,
              latestStatus: shipment.latestStatus,
              delivered: shipment.deliveredAt != null,
              deliveredAt: shipment.deliveredAt,
              podUrl: shipment.podUrl,
              timeline: trackRows.map((event) => ({
                status: event.latestStatus,
                detail: event.statusDetail,
                at: event.providerEventAt ?? event.receivedAt,
              })),
            }
          : null,
      },
    });
  } catch (error) {
    log.error("order detail read failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}
