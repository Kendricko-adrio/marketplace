import { describe, it, expect } from "vitest";
import { computeDiscountPercent } from "./pricing";

describe("computeDiscountPercent", () => {
  it("returns 0 when net price equals the RRP", () => {
    expect(computeDiscountPercent(1_100_000, 1_100_000)).toBe(0);
  });

  it("returns the rounded percent for a discounted net price", () => {
    // RRP 1.100.000, net 850.000 → 22.7% → 23
    expect(computeDiscountPercent(1_100_000, 850_000)).toBe(23);
  });

  it("returns 25 for a quarter off", () => {
    expect(computeDiscountPercent(100_000, 75_000)).toBe(25);
  });

  it("returns 0 when the net price is above the RRP", () => {
    expect(computeDiscountPercent(100_000, 120_000)).toBe(0);
  });

  it("returns 0 when the RRP is zero or negative", () => {
    expect(computeDiscountPercent(0, 0)).toBe(0);
    expect(computeDiscountPercent(-100, 50)).toBe(0);
  });

  it("rounds to the nearest whole percent", () => {
    // 1/3 off → 33.33% → 33
    expect(computeDiscountPercent(300_000, 200_000)).toBe(33);
  });
});
