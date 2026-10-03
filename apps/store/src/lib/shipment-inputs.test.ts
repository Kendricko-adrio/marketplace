import { describe, expect, it } from "vitest";
import { buildShipmentInputs } from "./shipment-inputs";
import type { ShipmentDimensions } from "./shipment-parcel";

// =========================================================
// buildShipmentInputs — Shipment request inputs assembled from the branch's
// LOCAL shipping-origin complement + per-SKU master dimensions (ticket 02).
//
// PURE adapter: no DB, no env, no UI, no readiness flag. The later quote
// stage feeds the branch row (origin fields from the branch-edit slice) and
// order items enriched with per-SKU master dims (sync attaches normalized
// numbers per variant; store fallback config ships as
// shipment.parcelFallback JSON + shipment.packagingWeightGrams system_config
// managed by IT via the DB — never invented as a readiness flag here).
//
// Contract (spec "Asal dan parcel"):
// - origin: name = branch NAME (the sender identity), phone/address/zipcode
//   = shippingPhone/shippingAddress/shippingPostalCode — REQUIRED: a
//   pickup-only branch without a configured origin (or a nonaktif branch)
//   must THROW, never send blank/zero values to Shipment;
//   area_id = shippingAreaId when present (string, leading zeros preserved,
//   e.g. "01010101"), omitted when the branch has none.
// - items: per-SKU master dims, or — for dimensionless SKUs — the store
//   fallback dims; same per-item validity rules as the existing
//   buildShipmentParcel adapter (grams positive-safe-integer, cm finite
//   positive). No usable master dims AND no fallback → THROW (fail closed).
// - weight: total = Σ per-unit grams × quantity + packaging grams;
//   packagingWeight omitted (undefined) or NaN must THROW.
//
// RED until apps/store/src/lib/shipment-inputs.ts exists. Expected values are
// the independent literals below (worked example computed by hand), never
// recomputed from the implementation.
// =========================================================

const MASTER_GRIP: ShipmentDimensions = {
  weight: 250,
  length: 30,
  width: 20,
  height: 10,
};
const FALLBACK: ShipmentDimensions = {
  weight: 100,
  length: 15,
  width: 10,
  height: 5,
};

const READY_BRANCH = {
  name: "Cabang Jakarta Pusat",
  status: "aktif",
  shippingPhone: "021999888777",
  shippingAddress: "Jl. Origin E2E No. 7, Gudang B",
  shippingPostalCode: "10110",
  shippingAreaId: "01010101",
} as const;

const ONE_ITEM = [
  { itemName: "Grip Pro", quantity: 2, value: 150000, dimensions: MASTER_GRIP },
];

describe("buildShipmentInputs", () => {
  it("builds the origin block from the branch shipping complement (sender = branch name, optional Shipment area id keeps leading zeros)", () => {
    const inputs = buildShipmentInputs({
      branch: READY_BRANCH,
      items: ONE_ITEM,
      fallback: FALLBACK,
      packagingWeight: 40,
    });
    expect(inputs.origin).toEqual({
      name: "Cabang Jakarta Pusat",
      phone: "021999888777",
      address: "Jl. Origin E2E No. 7, Gudang B",
      zipcode: "10110",
      area_id: "01010101",
    });
  });

  it("omits area_id (never a fake/empty string) when the branch has none", () => {
    const inputs = buildShipmentInputs({
      branch: { ...READY_BRANCH, shippingAreaId: null },
      items: ONE_ITEM,
      fallback: FALLBACK,
      packagingWeight: 40,
    });
    // toEqual ignores undefined-valued keys: the seam may leave the key out
    // entirely or carry it as undefined — a fabricated "" would fail.
    expect(inputs.origin).toEqual({
      name: "Cabang Jakarta Pusat",
      phone: "021999888777",
      address: "Jl. Origin E2E No. 7, Gudang B",
      zipcode: "10110",
    });
  });

  it("combines per-SKU master dims and the fallback dims per quantity (independent worked total)", () => {
    const inputs = buildShipmentInputs({
      branch: READY_BRANCH,
      items: [
        { itemName: "Grip Pro", quantity: 2, value: 150000, dimensions: MASTER_GRIP },
        { itemName: "Band Wide", quantity: 3, value: 90000, dimensions: null },
      ],
      fallback: FALLBACK, // the dimensionless SKU ships with fallback dims
      packagingWeight: 40,
    });
    // Worked example by hand from the literals above:
    // 2 × 250 g + 3 × 100 g + 40 g kemasan = 840 g.
    expect(inputs.weight).toBe(840);
    expect(inputs.items[0]).toMatchObject({
      item_name: "Grip Pro",
      quantity: 2,
      weight: 250,
      length: 30,
      width: 20,
      height: 10,
    });
    expect(inputs.items[1]).toMatchObject({
      item_name: "Band Wide",
      quantity: 3,
      weight: 100,
      length: 15,
      width: 10,
      height: 5,
    });
  });

  it("throws for an invalid or inactive origin instead of sending blank/zero values", () => {
    expect(() =>
      buildShipmentInputs({
        branch: { ...READY_BRANCH, shippingPhone: null },
        items: ONE_ITEM,
        fallback: FALLBACK,
        packagingWeight: 40,
      })
    ).toThrow();
    expect(() =>
      buildShipmentInputs({
        branch: { ...READY_BRANCH, shippingPostalCode: null },
        items: ONE_ITEM,
        fallback: FALLBACK,
        packagingWeight: 40,
      })
    ).toThrow();
    expect(() =>
      buildShipmentInputs({
        branch: { ...READY_BRANCH, shippingAddress: "   " },
        items: ONE_ITEM,
        fallback: FALLBACK,
        packagingWeight: 40,
      })
    ).toThrow();
    // A nonaktif branch must never become a shipment origin here.
    expect(() =>
      buildShipmentInputs({
        branch: { ...READY_BRANCH, status: "nonaktif" },
        items: ONE_ITEM,
        fallback: FALLBACK,
        packagingWeight: 40,
      })
    ).toThrow();
  });

  it("throws when an item has neither valid master dims nor a valid fallback", () => {
    const dimensionless = [
      { itemName: "Mystery", quantity: 1, value: 1, dimensions: null },
    ];
    expect(() =>
      buildShipmentInputs({
        branch: READY_BRANCH,
        items: dimensionless,
        fallback: null,
        packagingWeight: 40,
      })
    ).toThrow();
    // A broken master row (zero grams) is NOT valid master dims.
    expect(() =>
      buildShipmentInputs({
        branch: READY_BRANCH,
        items: [
          {
            itemName: "Mystery",
            quantity: 1,
            value: 1,
            dimensions: { weight: 0, length: 30, width: 20, height: 10 },
          },
        ],
        fallback: null,
        packagingWeight: 40,
      })
    ).toThrow();
  });

  it("fails on a missing (omitted) or NaN packaging weight", () => {
    expect(() =>
      buildShipmentInputs({
        branch: READY_BRANCH,
        items: ONE_ITEM,
        fallback: FALLBACK,
        packagingWeight: NaN,
      })
    ).toThrow();
    const withoutPackaging = {
      branch: READY_BRANCH,
      items: ONE_ITEM,
      fallback: FALLBACK,
    };
    expect(() =>
      buildShipmentInputs(
        withoutPackaging as unknown as Parameters<typeof buildShipmentInputs>[0]
      )
    ).toThrow();
  });
});