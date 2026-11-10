import { buildPricingSnapshot, type PricingSnapshot } from "@/lib/versioned-pricing";
import { buildPaymentItemDetails } from "@/lib/payment-item-details";
import { calculateLineItemSubtotal, calculateOrderPricing, type OrderPricing } from "@/lib/order-pricing";
import type { DeliverySnapshotPayload } from "@marketplace/db/src/schema";
import type { ValidatedProviderTax } from "@marketplace/db/src/provider-tax";

interface PricingItem { variantId: string; variantPrice: string; quantity: number }
interface SnapshotInput {
  selectedItems: readonly PricingItem[];
  ppnRatePercent: number | string;
  providerTax: ValidatedProviderTax | null;
  effectiveOf: (item: PricingItem) => string;
  markdownRevisionOf: (item: PricingItem) => string | null;
}

export function calculatePlaceOrderSubtotal(selectedItems: readonly PricingItem[], pricingSnapshot: PricingSnapshot | null): string {
  return pricingSnapshot?.subtotal ?? calculateLineItemSubtotal(
    selectedItems.map((item) => ({ price: item.variantPrice, quantity: item.quantity }))
  );
}

export function buildLegacyPickupPricing(subtotal: string, ppnRatePercent: number | string): OrderPricing {
  return calculateOrderPricing({
    fulfillmentMethod: "pickup", subtotal, discount: 0, shippingCost: 0, serviceFee: 0, ppnRatePercent,
  });
}

export function buildPickupPricingSnapshot({ selectedItems, isDelivery, ppnRatePercent, providerTax, effectiveOf, markdownRevisionOf }: SnapshotInput & { isDelivery: boolean }): PricingSnapshot {
  return buildPricingSnapshot({
    fulfillmentMethod: isDelivery ? "delivery" : "pickup", ppnRatePercent,
    providerTax: providerTax ?? undefined,
    lines: selectedItems.map((item) => ({
      variantId: item.variantId, quantity: item.quantity,
      sourceUnitPrice: item.variantPrice, effectiveUnitPrice: effectiveOf(item),
      markdownRevisionId: markdownRevisionOf(item),
    })),
  });
}

export function buildDeliveryBaselineSnapshot({ selectedItems, ppnRatePercent, providerTax, effectiveOf, markdownRevisionOf, shippingCost }: SnapshotInput & { shippingCost: number }): PricingSnapshot {
  return buildPricingSnapshot({
    providerTax: providerTax ?? undefined,
    fulfillmentMethod: "delivery", ppnRatePercent,
    lines: selectedItems.map((item) => ({
      variantId: item.variantId, quantity: item.quantity,
      sourceUnitPrice: item.variantPrice, effectiveUnitPrice: effectiveOf(item),
      markdownRevisionId: markdownRevisionOf(item),
    })),
    shippingBeforeSubsidy: String(shippingCost),
    providerQuotedShippingCost: String(shippingCost),
  });
}

export function finalizePricingFromSnapshot(pricingSnapshot: PricingSnapshot, deliverySnapshot: DeliverySnapshotPayload | null): { pricing: OrderPricing; deliverySnapshot: DeliverySnapshotPayload | null } {
  const pricing: OrderPricing = {
    subtotal: pricingSnapshot.subtotal, discount: pricingSnapshot.goodsDiscount,
    shippingCost: pricingSnapshot.shippingCost, taxableBase: pricingSnapshot.taxableBase,
    serviceFee: pricingSnapshot.serviceFee, ppnRatePercent: pricingSnapshot.ppnRatePercent,
    ppnAmount: pricingSnapshot.ppnAmount, total: pricingSnapshot.total,
  };
  if (deliverySnapshot) deliverySnapshot = { ...deliverySnapshot, pricing };
  return { pricing, deliverySnapshot };
}

export function buildPlacePaymentItemDetails({ selectedItems, pricingSnapshot, effectiveOf, pricing }: {
  selectedItems: readonly (PricingItem & { productName: string })[];
  pricingSnapshot: PricingSnapshot | null;
  effectiveOf: (item: PricingItem) => string;
  pricing: OrderPricing;
}) {
  return buildPaymentItemDetails({
    items: selectedItems.map((item) => ({
      id: item.variantId,
      name: item.productName,
      // Midtrans goods use the EFFECTIVE unit amounts (Markdown already
      // deducted once) plus the goods-discount adjustment; the detail total
      // must equal the stored customer total exactly.
      price: pricingSnapshot ? effectiveOf(item) : item.variantPrice,
      quantity: item.quantity,
    })),
    ...pricing,
  });
}
