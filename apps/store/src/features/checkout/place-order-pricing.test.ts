import { describe, expect, it } from "vitest";
import { buildPickupPricingSnapshot, buildDeliveryBaselineSnapshot, finalizePricingFromSnapshot, buildPlacePaymentItemDetails, calculatePlaceOrderSubtotal, buildLegacyPickupPricing } from "./place-order-pricing";

const selectedItems = [{ variantId: "variant", productName: "Shoes", variantPrice: "1000", quantity: 2 }];
const input = { selectedItems, ppnRatePercent: 11, providerTax: { taxId: -2, ratePercent: "11" }, effectiveOf: () => "800", markdownRevisionOf: () => "markdown" };
describe("place-order pricing assembly", () => {
  it("preserves legacy subtotal and pickup decimal formatting separately from versioned pricing", () => {
    const subtotal = calculatePlaceOrderSubtotal(selectedItems, null);
    expect(subtotal).toBe("2000.00");
    expect(buildLegacyPickupPricing(subtotal, 11)).toEqual({ subtotal: "2000.00", discount: "0.00", taxableBase: "2000.00", shippingCost: "0.00", serviceFee: "0.00", ppnRatePercent: "11", ppnAmount: "220.00", total: "2220.00" });
  });
  it("preserves frozen pickup pricing and item-detail total after Markdown", () => {
    const snapshot = buildPickupPricingSnapshot({ ...input, isDelivery: false });
    expect(snapshot).toMatchObject({ subtotal: "1600", total: "1776", ppnAmount: "176", markdownTotal: "400" });
    const { pricing, deliverySnapshot } = finalizePricingFromSnapshot(snapshot, null);
    expect(pricing).toEqual({ subtotal: "1600", discount: "0", shippingCost: "0", taxableBase: "1600", serviceFee: "0", ppnRatePercent: "11", ppnAmount: "176", total: "1776" });
    expect(deliverySnapshot).toBeNull();
    const details = buildPlacePaymentItemDetails({ selectedItems, pricingSnapshot: snapshot, effectiveOf: input.effectiveOf, pricing });
    expect(details).toEqual([{ id: "variant", name: "Shoes", price: 800, quantity: 2 }, { id: "PPN", name: "PPN 11%", price: 176, quantity: 1 }]);
  });
  it("builds the delivery baseline from original quoted shipping", () => {
    const snapshot = buildDeliveryBaselineSnapshot({ ...input, shippingCost: 500 });
    expect(snapshot).toMatchObject({ shippingBeforeSubsidy: "500", providerQuotedShippingCost: "500", shippingCost: "500", shippingSubsidy: "0", ppnAmount: "176", total: "2276" });
  });
});
