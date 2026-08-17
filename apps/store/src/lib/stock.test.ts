import { describe, it, expect } from "vitest";
import { hasAvailableStock } from "./stock";

describe("hasAvailableStock", () => {
  it("returns false when there are no branch stock rows at all", () => {
    expect(hasAvailableStock([])).toBe(false);
  });

  it("returns false when every branch has zero stock", () => {
    expect(hasAvailableStock([{ stock: 0, reservedStock: 0 }])).toBe(false);
  });

  it("returns false when stock is fully reserved (available = 0)", () => {
    expect(hasAvailableStock([{ stock: 5, reservedStock: 5 }])).toBe(false);
  });

  it("returns false when available is negative (over-reserved)", () => {
    expect(hasAvailableStock([{ stock: 2, reservedStock: 4 }])).toBe(false);
  });

  it("returns true when a single branch has available units", () => {
    expect(hasAvailableStock([{ stock: 5, reservedStock: 3 }])).toBe(true);
  });

  it("returns true when at least one of several branches has available units", () => {
    expect(
      hasAvailableStock([
        { stock: 0, reservedStock: 0 },
        { stock: 2, reservedStock: 0 },
        { stock: 1, reservedStock: 1 },
      ])
    ).toBe(true);
  });

  it("returns false when every branch is out of stock", () => {
    expect(
      hasAvailableStock([
        { stock: 0, reservedStock: 0 },
        { stock: 3, reservedStock: 3 },
      ])
    ).toBe(false);
  });
});
