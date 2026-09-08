import { describe, expect, it } from "vitest";
import { buildPaymentItemDetails } from "./payment-item-details";

describe("buildPaymentItemDetails", () => {
  it("adds the immutable PPN snapshot and preserves the gross-total invariant", () => {
    const details = buildPaymentItemDetails({
      items: [{ id: "sku-1", name: "Sepatu", price: "100000.00", quantity: 1 }],
      discount: "0.00",
      shippingCost: "5000.00",
      serviceFee: "1000.00",
      ppnRatePercent: "11",
      ppnAmount: "11000.00",
      total: "117000.00",
    });

    expect(details).toEqual([
      { id: "sku-1", name: "Sepatu", price: 100000, quantity: 1 },
      { id: "PPN", name: "PPN 11%", price: 11000, quantity: 1 },
      { id: "SHIPPING", name: "Shipping", price: 5000, quantity: 1 },
      { id: "SERVICE_FEE", name: "Service Fee", price: 1000, quantity: 1 },
    ]);
    expect(details.reduce((sum, item) => sum + item.price * item.quantity, 0)).toBe(117000);
  });

  it("represents discounts as a negative line and omits zero adjustments", () => {
    expect(buildPaymentItemDetails({
      items: [{ id: "sku-1", name: "Sepatu", price: "100000", quantity: 2 }],
      discount: "50000",
      shippingCost: "0",
      serviceFee: "0",
      ppnRatePercent: "11",
      ppnAmount: "16500",
      total: "166500",
    })).toEqual([
      { id: "sku-1", name: "Sepatu", price: 100000, quantity: 2 },
      { id: "DISCOUNT", name: "Discount", price: -50000, quantity: 1 },
      { id: "PPN", name: "PPN 11%", price: 16500, quantity: 1 },
    ]);
  });

  it("rejects a payload whose item details do not equal the order snapshot total", () => {
    expect(() => buildPaymentItemDetails({
      items: [{ id: "sku-1", name: "Sepatu", price: "100000", quantity: 1 }],
      discount: "0",
      shippingCost: "0",
      serviceFee: "0",
      ppnRatePercent: "11",
      ppnAmount: "11000",
      total: "100000",
    })).toThrow("Payment item details must equal order total");
  });
});
