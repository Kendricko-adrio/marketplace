import { describe, expect, it } from "vitest";
import { normalizeJubelioMasterParcel } from "./jubelio-parcel";

// =========================================================
// normalizeJubelioMasterParcel — Jubelio master package fields (ticket 02).
//
// dist.yaml declares the package fields for /inventory/items/{id} twice:
// - getProductResponse (~18094): package_weight/package_length/package_width/
//   package_height as STRINGS (example "1000");
// - the items/{id} GET block (~15692): package_weight as NUMBER with
//   "Package weight in gram" (grams unit confirmed).
//
// The seam therefore accepts BOTH shapes and normalizes them to:
//   weight  — grams: safe positive INTEGER (never a fraction)
//   length/width/height — cm: finite positive numbers (decimals allowed)
//
// Anything missing / zero / negative / non-finite / unparsable → NULL
// (fail closed). No group dimensions are assumed per SKU: the later sync
// implementation GETs EVERY SKU /inventory/items/{id} and attaches the
// normalized dimensions to the variant; an unusable item stays null and the
// store layer falls back at request time (store fallback config, not here).
//
// RED until packages/db/src/jubelio-parcel.ts exists. Expected values are
// independent literals below, never recomputed from the implementation.
// =========================================================

const RAW_DOCS = {
  package_weight: "250",
  package_length: "39.5",
  package_width: "20",
  package_height: "10",
} as const;

describe("normalizeJubelioMasterParcel", () => {
  it("normalizes the documented string package fields (getProductResponse) to gram/cm numbers", () => {
    expect(normalizeJubelioMasterParcel({ ...RAW_DOCS })).toEqual({
      weight: 250,
      length: 39.5,
      width: 20,
      height: 10,
    });
  });

  it("accepts the number-shaped items/{id} response too (dist.yaml: 'Package weight in gram', type number)", () => {
    expect(
      normalizeJubelioMasterParcel({
        package_weight: 250,
        package_length: 39.5,
        package_width: 20,
        package_height: 10,
      })
    ).toEqual({ weight: 250, length: 39.5, width: 20, height: 10 });
  });

  it("returns null when any package field is missing", () => {
    expect(normalizeJubelioMasterParcel({})).toBeNull();
    for (const key of [
      "package_weight",
      "package_length",
      "package_width",
      "package_height",
    ] as const) {
      const partial: Record<string, unknown> = { ...RAW_DOCS };
      delete partial[key];
      expect(
        normalizeJubelioMasterParcel(partial),
        `missing ${key} must fail closed`
      ).toBeNull();
    }
  });

  it("returns null for zero or negative values", () => {
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_weight: "0" })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_weight: "-250" })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_length: "0" })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_height: "-10" })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_width: 0 })
    ).toBeNull();
  });

  it("returns null for non-finite, unparsable and fractional-gram values", () => {
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_weight: "abc" })
    ).toBeNull();
    // Comma decimals are not parsable — fail closed, never reinterpret.
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_weight: "12,5" })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_weight: "Infinity" })
    ).toBeNull();
    // Grams are integer grams: a fractional weight is unusable master data.
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_weight: "250.5" })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_weight: 250.5 })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_weight: NaN })
    ).toBeNull();
    // cm stay finite positive numbers.
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_length: "NaN" })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_length: "" })
    ).toBeNull();
    expect(
      normalizeJubelioMasterParcel({ ...RAW_DOCS, package_height: Infinity })
    ).toBeNull();
  });

  it("returns null for non-object raw payloads", () => {
    expect(normalizeJubelioMasterParcel(null)).toBeNull();
    expect(normalizeJubelioMasterParcel("x")).toBeNull();
    expect(normalizeJubelioMasterParcel(42)).toBeNull();
  });
});