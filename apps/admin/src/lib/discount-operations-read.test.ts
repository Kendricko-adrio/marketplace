import { describe, expect, it } from "vitest";

import { computeAvailability } from "./discount-operations-read";
import { wholeRupiah } from "./discount-usage-drift";

// =========================================================
// Seam L — capacity arithmetic for the ops read (ticket 12)
// =========================================================
// Expected values are the approved spec example, not values produced by the
// implementation: quota100 / consumed90 / held10 → available0 and
// budget100000 / consumed80000 / held20000 → available0.

describe("computeAvailability — global consumed/held/available", () => {
  it("matches the spec example exactly", () => {
    expect(
      computeAvailability({
        quotaCount: 100,
        budgetAmount: "100000",
        heldCount: 10,
        consumedCount: 90,
        heldAmount: "20000",
        consumedAmount: "80000",
      })
    ).toEqual({
      basis: "global",
      consumedCount: 90,
      heldCount: 10,
      consumedAmount: "80000",
      heldAmount: "20000",
      availableCount: 0,
      availableAmount: "0",
    });
  });

  it("never reports negative availability and keeps unbounded bounds null", () => {
    expect(
      computeAvailability({
        quotaCount: 3,
        budgetAmount: null,
        heldCount: 4,
        consumedCount: 2,
        heldAmount: "10000",
        consumedAmount: "5000",
      })
    ).toMatchObject({
      availableCount: 0,
      availableAmount: null,
    });
    expect(
      computeAvailability({
        quotaCount: null,
        budgetAmount: null,
        heldCount: 0,
        consumedCount: 0,
        heldAmount: "0",
        consumedAmount: "0",
      })
    ).toMatchObject({ availableCount: null, availableAmount: null });
  });
});

describe("wholeRupiah — canonical money text for the read DTO", () => {
  it("strips the numeric scale without rounding", () => {
    expect(wholeRupiah("25000.00")).toBe("25000");
    expect(wholeRupiah("0.00")).toBe("0");
    expect(wholeRupiah("9999999999999.00")).toBe("9999999999999");
  });

  it("refuses a fractional value instead of truncating it", () => {
    expect(() => wholeRupiah("25000.50")).toThrow(/whole Rupiah/);
  });
});
