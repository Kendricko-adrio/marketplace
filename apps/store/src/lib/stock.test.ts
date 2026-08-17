import { describe, it, expect } from "vitest";
import { hasAvailableStock } from "./stock";

describe("hasAvailableStock", () => {
  it("returns false when there are no branch stock rows at all", () => {
    expect(hasAvailableStock([])).toBe(false);
  });

  it("returns false when every branch has zero stock", () => {
    expect(hasAvailableStock([{ stock: 0, pendingRemoteStock: 0 }])).toBe(false);
  });

  it("returns false while all stock is waiting for remote confirmation", () => {
    expect(hasAvailableStock([{ stock: 5, pendingRemoteStock: 5 }])).toBe(false);
  });

  it("returns false when a pending remote hold exceeds observed stock", () => {
    expect(hasAvailableStock([{ stock: 2, pendingRemoteStock: 4 }])).toBe(false);
  });

  it("returns true when a single branch has available units", () => {
    expect(hasAvailableStock([{ stock: 5, pendingRemoteStock: 3 }])).toBe(true);
  });

  it("returns true when at least one of several branches has available units", () => {
    expect(
      hasAvailableStock([
        { stock: 0, pendingRemoteStock: 0 },
        { stock: 2, pendingRemoteStock: 0 },
        { stock: 1, pendingRemoteStock: 1 },
      ])
    ).toBe(true);
  });

  it("returns false when every branch is out of stock", () => {
    expect(
      hasAvailableStock([
        { stock: 0, pendingRemoteStock: 0 },
        { stock: 3, pendingRemoteStock: 3 },
      ])
    ).toBe(false);
  });
});
