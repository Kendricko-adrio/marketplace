import { describe, expect, it } from "vitest";
import { selectObservedStock } from "./jubelio-stock-refresh";

const requested = new Set([101]);
const mapped = new Set(["101:15"]);
const locations = [{ location_id: 15, location_name: "Outlet" }];

function response(stocks: unknown) {
  return { locations, data: [{ item_id: 101, location_stocks: stocks }] };
}

describe("stock-only provider observation boundary", () => {
  it("accepts an explicit zero and never invents missing mapped pairs", () => {
    expect(selectObservedStock(response([{ location_id: 15, on_hand: 0, on_order: 0, reserved: 0, available: 0 }]), requested, mapped))
      .toEqual([{ itemId: 101, locationId: 15, onHand: 0, onOrder: 0, reserved: 0, available: 0 }]);
    expect(selectObservedStock(response([]), requested, mapped)).toEqual([]);
  });

  it("accepts omitted reserved only when explicit available proves the liability is zero", () => {
    expect(selectObservedStock(response([{ location_id: 15, on_hand: 8, on_order: 0, available: 8 }]), requested, mapped))
      .toEqual([{ itemId: 101, locationId: 15, onHand: 8, onOrder: 0, reserved: 0, available: 8 }]);
    expect(selectObservedStock(response([{ location_id: 15, on_hand: 8, on_order: 0, available: 7 }]), requested, mapped)).toEqual([]);
  });

  it("refuses missing or malformed liability, mismatched totals and duplicate observations", () => {
    const valid = { location_id: 15, on_hand: 4, on_order: 1, reserved: 1, available: 2 };
    for (const row of [
      { ...valid, available: undefined },
      { ...valid, on_order: -1 },
      { ...valid, available: 3 },
      { ...valid, available: 1.5 },
    ]) {
      expect(selectObservedStock(response([row]), requested, mapped)).toEqual([]);
    }
    expect(selectObservedStock(response([valid, valid]), requested, mapped)).toEqual([]);
    expect(selectObservedStock({ locations, data: null }, requested, mapped)).toEqual([]);
  });
});
