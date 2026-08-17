import { describe, it, expect } from "vitest";
import { computeVoucherDiscount } from "./vouchers";

// Backs POST /api/vouchers/validate discount preview. Worked examples from
// the seeded vouchers (DISKON10: 10% capped at 50.000; HMT25RB: flat 25.000).
describe("computeVoucherDiscount", () => {
  it("computes a percentage discount", () => {
    expect(computeVoucherDiscount("percentage", "10", 100_000)).toBe(10_000);
  });

  it("caps a percentage discount at maxDiscount", () => {
    expect(computeVoucherDiscount("percentage", "10", 1_000_000, "50000")).toBe(
      50_000
    );
  });

  it("does not cap when maxDiscount is absent", () => {
    expect(computeVoucherDiscount("percentage", "10", 1_000_000)).toBe(100_000);
  });

  it("returns the flat value for fixed discounts", () => {
    expect(computeVoucherDiscount("fixed", "25000", 200_000)).toBe(25_000);
  });

  it("returns the flat value for shipping discounts", () => {
    expect(computeVoucherDiscount("shipping", "20000", 50_000)).toBe(20_000);
  });

  it("handles decimal percentage values", () => {
    expect(computeVoucherDiscount("percentage", "7.5", 200_000)).toBe(15_000);
  });
});
