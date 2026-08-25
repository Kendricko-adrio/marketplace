import { describe, expect, it } from "vitest";
import {
  flattenStock,
  parseJubelioStartPage,
  resolveJubelioThumbnail,
  resolveKnownJubelioStockRows,
  upsertJubelioBranches,
  type Db,
  type JubelioLocation,
} from "./jubelio-sync";

describe("upsertJubelioBranches", () => {
  it("imports every named location and mirrors Jubelio is_active into branch status", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    let conflictUpdate: Record<string, unknown> | undefined;
    const db = {
      insert: () => ({
        values: (rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows);
          return {
            onConflictDoUpdate: async (config: Record<string, unknown>) => {
              conflictUpdate = config;
            },
          };
        },
      }),
    } as unknown as Db;
    const location = (
      location_id: number,
      location_name: string,
      is_active: boolean
    ): JubelioLocation => ({
      location_id,
      location_name,
      location_code: `LOC-${location_id}`,
      is_pos_outlet: false,
      is_active,
    });

    const count = await upsertJubelioBranches(db, [
      location(1, "Transit", true),
      location(2, "Dago 123", false),
      location(3, "WEBSITE ADF", true),
    ]);

    expect(count).toBe(3);
    expect(inserted.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: "Transit", status: "aktif" },
      { name: "Dago 123", status: "nonaktif" },
      { name: "WEBSITE ADF", status: "aktif" },
    ]);
    expect(conflictUpdate).toHaveProperty("set.status");
  });
});

describe("flattenStock", () => {
  it("includes stock from every Jubelio location without filtering by name", () => {
    expect(
      flattenStock({
        locations: [
          {
            location_id: 1,
            location_name: "Transit",
            location_code: "TR",
            is_pos_outlet: false,
            is_active: false,
          },
          {
            location_id: 2,
            location_name: "WEBSITE ADF",
            location_code: "WEB",
            is_pos_outlet: false,
            is_active: true,
          },
        ],
        data: [
          {
            item_id: 101,
            item_code: "SKU-101",
            item_group_id: 10,
            location_stocks: [
              { location_id: 1, on_hand: 2 },
              { location_id: 2, on_hand: 3 },
            ],
          },
        ],
      })
    ).toEqual([
      { itemId: 101, locationId: 1, onHand: 2 },
      { itemId: 101, locationId: 2, onHand: 3 },
    ]);
  });
});

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
