import { describe, expect, it } from "vitest";
import {
  calculateLineItemSubtotal,
  calculateOrderPricing,
  resolvePpnRate,
} from "./order-pricing";

describe("calculateLineItemSubtotal", () => {
  it("sums decimal line prices without binary floating-point drift", () => {
    expect(calculateLineItemSubtotal([
      { price: "0.10", quantity: 1 },
      { price: "0.20", quantity: 1 },
    ])).toBe("0.30");
  });
});

describe("calculateOrderPricing", () => {
  it("charges 11% PPN without incrementing an already-whole result", () => {
    expect(calculateOrderPricing({ subtotal: "100000", ppnRatePercent: "11" })).toMatchObject({
      taxableBase: "100000.00",
      ppnAmount: "11000.00",
      total: "111000.00",
    });
  });

  it("rounds a fractional PPN upward to a whole Rupiah", () => {
    expect(calculateOrderPricing({ subtotal: "909092.82", ppnRatePercent: "11" }).ppnAmount).toBe("100001.00");
  });

  it("calculates PPN after discount", () => {
    expect(calculateOrderPricing({ subtotal: "200000", discount: "50000", ppnRatePercent: "11" })).toMatchObject({
      taxableBase: "150000.00",
      ppnAmount: "16500.00",
      total: "166500.00",
    });
  });

  it("clamps the taxable base when discount meets or exceeds subtotal", () => {
    expect(calculateOrderPricing({ subtotal: "100", discount: "100", ppnRatePercent: "11" }).ppnAmount).toBe("0.00");
    expect(calculateOrderPricing({ subtotal: "100", discount: "150", ppnRatePercent: "11" }).taxableBase).toBe("0.00");
  });

  it("supports zero and deterministic decimal rates", () => {
    expect(calculateOrderPricing({ subtotal: "100000", ppnRatePercent: "0" }).ppnAmount).toBe("0.00");
    expect(calculateOrderPricing({ subtotal: "99999.99", ppnRatePercent: "11.5" }).ppnAmount).toBe("11500.00");
  });

  it("includes shipping and service fees in total but not taxable base", () => {
    expect(calculateOrderPricing({ subtotal: "100000", shippingCost: "5000", serviceFee: "1000", ppnRatePercent: "11" }).total).toBe("117000.00");
  });
});

describe("resolvePpnRate", () => {
  it.each(["invalid", "-1", "100.01", Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to 11 for invalid or out-of-range value %s",
    (value) => expect(resolvePpnRate(value)).toBe("11")
  );

  it("accepts rates from zero through one hundred", () => {
    expect(resolvePpnRate("0")).toBe("0");
    expect(resolvePpnRate("12.5")).toBe("12.5");
    expect(resolvePpnRate("100")).toBe("100");
  });
});
