import { describe, expect, it } from "vitest";
import {
  parseJubelioStartPage,
  resolveJubelioThumbnail,
  resolveKnownJubelioStockRows,
} from "./jubelio-sync";

describe("resolveKnownJubelioStockRows", () => {
  it("keeps known variants, uses their database ids, and skips unknown stock items", () => {
    const rows = resolveKnownJubelioStockRows(
      [
        { itemId: 101, locationId: 7, onHand: 3 },
        { itemId: 999, locationId: 7, onHand: 4 },
      ],
      new Map([[101, "legacy-variant-id"]])
    );

    expect(rows).toEqual([
      {
        branchId: "jubelio:branch:902ba3cda1883801594b6e1b",
        productVariantId: "legacy-variant-id",
        stock: 3,
      },
    ]);
  });
});

describe("resolveJubelioThumbnail", () => {
  it("returns null when both master thumbnail and catalog images are absent", () => {
    expect(resolveJubelioThumbnail(null, null)).toBe(null);
  });
});

describe("parseJubelioStartPage", () => {
  it("defaults to the first page when unset", () => {
    expect(parseJubelioStartPage(undefined)).toBe(1);
  });

  it("accepts a positive integer page", () => {
    expect(parseJubelioStartPage("46")).toBe(46);
  });

  it("rejects non-positive or non-integer pages", () => {
    expect(() => parseJubelioStartPage("0")).toThrow(
      "JUBELIO_SYNC_START_PAGE must be a positive integer"
    );
    expect(() => parseJubelioStartPage("4.5")).toThrow(
      "JUBELIO_SYNC_START_PAGE must be a positive integer"
    );
  });
});
