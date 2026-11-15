import { describe, it, expect } from "vitest";
import { hasAvailableStock, sellableUnits, isFreshStockSnapshot } from "./stock";

it("rejects expired or missing provider snapshots even when local hold updated the row", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  expect(isFreshStockSnapshot(null, now)).toBe(false);
  expect(isFreshStockSnapshot(new Date("2026-09-24T11:44:59Z"), now)).toBe(false);
  expect(isFreshStockSnapshot(new Date("2026-09-24T11:45:00Z"), now)).toBe(true);
  expect(isFreshStockSnapshot(new Date("2026-09-24T12:00:01Z"), now)).toBe(false);
});

// Sellable rule (Sales-Order flow, plan feature 1):
//   sellable = provider `available` − local unconfirmed SO holds.
// The provider's `available` already nets out on_order/reserved, so the
// provider series is never subtracted again (no double counting). A missing
// snapshot (availableStock null) fails closed to 0.

describe("sellableUnits", () => {
  it("fails closed when the provider available snapshot is missing", () => {
    expect(sellableUnits({ availableStock: null, pendingRemoteStock: 0 })).toBe(0);
  });

  it("fails closed on a negative or non-finite snapshot", () => {
    expect(sellableUnits({ availableStock: -3, pendingRemoteStock: 0 })).toBe(0);
    expect(sellableUnits({ availableStock: NaN, pendingRemoteStock: 0 })).toBe(0);
  });

  it("subtracts only local unconfirmed SO holds, never the provider series", () => {
    // available 5, on_order 2 (already netted inside `available`), 1 local hold.
    expect(sellableUnits({ availableStock: 5, pendingRemoteStock: 1 })).toBe(4);
  });

  it("clamps at zero when holds exceed the snapshot", () => {
    expect(sellableUnits({ availableStock: 2, pendingRemoteStock: 4 })).toBe(0);
  });

  it("keeps an explicit provider zero as zero", () => {
    expect(sellableUnits({ availableStock: 0, pendingRemoteStock: 0 })).toBe(0);
  });
});

describe("hasAvailableStock", () => {
  it("returns false when there are no branch stock rows at all", () => {
    expect(hasAvailableStock([])).toBe(false);
  });

  it("returns false when every branch lacks a provider snapshot (fail closed)", () => {
    expect(
      hasAvailableStock([
        { stock: 7, pendingRemoteStock: 0, availableStock: null },
      ])
    ).toBe(false);
  });

  it("returns false while all stock is waiting for remote confirmation", () => {
    expect(
      hasAvailableStock([{ stock: 5, pendingRemoteStock: 5, availableStock: 5 }])
    ).toBe(false);
  });

  it("returns true when a single branch has available units", () => {
    expect(
      hasAvailableStock([{ stock: 5, pendingRemoteStock: 3, availableStock: 5 }])
    ).toBe(true);
  });

  it("returns true when at least one of several branches has available units", () => {
    expect(
      hasAvailableStock([
        { stock: 0, pendingRemoteStock: 0, availableStock: 0 },
        { stock: 2, pendingRemoteStock: 0, availableStock: 2 },
        { stock: 1, pendingRemoteStock: 1, availableStock: 1 },
      ])
    ).toBe(true);
  });

  it("returns false when every branch is out of stock", () => {
    expect(
      hasAvailableStock([
        { stock: 0, pendingRemoteStock: 0, availableStock: 0 },
        { stock: 3, pendingRemoteStock: 3, availableStock: 3 },
      ])
    ).toBe(false);
  });
});