import { describe, expect, it } from "vitest";
import { buildShipmentParcel } from "./shipment-parcel";

const fallback = { weight: 400, length: 20, width: 15, height: 10 };

describe("Shipment parcel contract", () => {
  it("totals per-unit gram weights across SKUs and quantities plus packaging without inventing a box", () => {
    expect(buildShipmentParcel({
      items: [
        { itemName: "Kemeja", quantity: 2, value: 100000, dimensions: { weight: 300, length: 30, width: 20, height: 2 } },
        { itemName: "Celana", quantity: 3, value: 80000, dimensions: null },
      ],
      fallback,
      packagingWeight: 100,
    })).toEqual({
      weight: 1900,
      items: [
        { item_name: "Kemeja", quantity: 2, value: 100000, weight: 300, length: 30, width: 20, height: 2 },
        { item_name: "Celana", quantity: 3, value: 80000, weight: 400, length: 20, width: 15, height: 10 },
      ],
    });
  });

  it("fails closed rather than sending zero or invalid product/fallback/packaging weights", () => {
    expect(() => buildShipmentParcel({ items: [{ itemName: "A", quantity: 1, value: 10, dimensions: { ...fallback, weight: 0 } }], fallback: { ...fallback, weight: 0 }, packagingWeight: 100 })).toThrow();
    expect(() => buildShipmentParcel({ items: [{ itemName: "A", quantity: 0, value: 10, dimensions: fallback }], fallback, packagingWeight: 100 })).toThrow();
    expect(() => buildShipmentParcel({ items: [{ itemName: "A", quantity: 1, value: 10, dimensions: fallback }], fallback, packagingWeight: -1 })).toThrow();
  });
});
