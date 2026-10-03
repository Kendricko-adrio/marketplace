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
      { itemId: 101, locationId: 1, onHand: 2, onOrder: 0, reserved: 0, available: 2 },
      { itemId: 101, locationId: 2, onHand: 3, onOrder: 0, reserved: 0, available: 3 },
    ]);
  });
});

describe("flattenStock", () => {
  it("keeps explicit zero-stock observations so a provider zero clears stale positive branch_stock", () => {
    expect(
      flattenStock({
        locations: [
          {
            location_id: 1,
            location_name: "WEBSITE ADF",
            location_code: "WEB",
            is_pos_outlet: false,
            is_active: true,
          },
          {
            location_id: 2,
            location_name: "Dago 123",
            location_code: "DG",
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
              // Explicit zero observation — must reach the upsert so the
              // stale positive row is overwritten with 0, not dropped.
              { location_id: 1, on_hand: 0 },
              { location_id: 2, on_hand: 3 },
            ],
          },
        ],
      })
    ).toEqual([
      { itemId: 101, locationId: 1, onHand: 0, onOrder: 0, reserved: 0, available: 0 },
      { itemId: 101, locationId: 2, onHand: 3, onOrder: 0, reserved: 0, available: 3 },
    ]);
  });
  it("treats an explicit available:0 as a zero observation and clamps a negative observation to a fail-closed zero", () => {
    expect(
      flattenStock({
        locations: [
          {
            location_id: 1,
            location_name: "WEBSITE ADF",
            location_code: "WEB",
            is_pos_outlet: false,
            is_active: true,
          },
        ],
        data: [
          {
            item_id: 201,
            item_code: "SKU-201",
            item_group_id: 20,
            // on_hand absent, available explicitly 0 — still an observation.
            location_stocks: [{ location_id: 1, available: 0 }],
          },
          {
            item_id: 202,
            item_code: "SKU-202",
            item_group_id: 20,
            // Negative observation: clamped to 0 (fail closed) so a stale
            // positive local row is hidden, not left sellable.
            location_stocks: [{ location_id: 1, on_hand: -1 }],
          },
        ],
      })
    ).toEqual([
      // Explicit available:0 is a real observation, mirrored verbatim.
      { itemId: 201, locationId: 1, onHand: 0, onOrder: 0, reserved: 0, available: 0 },
      // Negative on_hand is clamped; with no explicit available it derives 0.
      { itemId: 202, locationId: 1, onHand: 0, onOrder: 0, reserved: 0, available: 0 },
    ]);
  });
  it("emits a fail-closed zero for absent and non-finite observations on identified item+location, and still skips unknown locations", () => {
    expect(
      flattenStock({
        locations: [
          {
            location_id: 1,
            location_name: "WEBSITE ADF",
            location_code: "WEB",
            is_pos_outlet: false,
            is_active: true,
          },
        ],
        data: [
          {
            item_id: 301,
            item_code: "SKU-301",
            item_group_id: 30,
            // No on_hand/available/reserved at all: fail closed to 0 so a
            // stale positive local row is hidden instead of left sellable.
            location_stocks: [{ location_id: 1 }],
          },
          {
            item_id: 302,
            item_code: "SKU-302",
            item_group_id: 30,
            // Non-finite value: clamped to 0, never written through as NaN.
            location_stocks: [{ location_id: 1, on_hand: NaN }],
          },
          {
            item_id: 303,
            item_code: "SKU-303",
            item_group_id: 30,
            // Unknown location id: still skipped entirely (FK safety).
            location_stocks: [{ location_id: 99, on_hand: 5 }],
          },
        ],
      })
    ).toEqual([
      // All series absent → available null (fail closed upstream), onHand 0.
      { itemId: 301, locationId: 1, onHand: 0, onOrder: 0, reserved: 0, available: null },
      // Non-finite on_hand clamps to 0; the derived available is 0, never NaN.
      { itemId: 302, locationId: 1, onHand: 0, onOrder: 0, reserved: 0, available: 0 },
    ]);
  });
});

describe("resolveKnownJubelioStockRows", () => {
  it("keeps known variants, uses their database ids, and skips unknown stock items", () => {
    const rows = resolveKnownJubelioStockRows(
      [
        { itemId: 101, locationId: 7, onHand: 3, onOrder: 0, reserved: 0, available: 3 },
        { itemId: 999, locationId: 7, onHand: 4, onOrder: 0, reserved: 0, available: 4 },
      ],
      new Map([[101, "legacy-variant-id"]])
    );

    expect(rows).toEqual([
      {
        branchId: "jubelio:branch:902ba3cda1883801594b6e1b",
        productVariantId: "legacy-variant-id",
        stock: 3,
        onOrder: 0,
        providerReserved: 0,
        available: 3,
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

describe("upsertJubelioBranches — shipping-origin complement (ticket 02)", () => {
  // GUARD (green by absence; turns red the moment the sync starts writing
  // shipping columns). The local shipping-origin complement
  // (shipping_phone/shipping_address/shipping_postal_code/shipping_area_id)
  // belongs to the branch admin menu alone — Jubelio master data (location
  // phone/address/post_code/area) must never seed it and never overwrite the
  // branch admin's edit ("Pelengkap lokal diedit sekali di menu Branch admin
  // dan tidak ditimpa impor Jubelio").
  it("never writes the shipping-origin complement from Jubelio locations", async () => {
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

    // A location WITH the full complement fields Jubelio carries (phone,
    // address, post_code, area are all optional fields of JubelioLocation):
    // the sync still must not map any of them into the shipping columns.
    const location: JubelioLocation = {
      location_id: 21,
      location_name: "Gudang Pusat E2E",
      location_code: "LOC-21",
      is_pos_outlet: false,
      is_active: true,
      phone: "0215551000",
      address: "Jl. Jubelio Master 1",
      post_code: "12345",
      area: "Kelurahan Master",
    };

    await upsertJubelioBranches(db, [location]);

    // Insert path: the complement is never seeded from provider master data.
    for (const row of inserted) {
      expect(
        Object.keys(row).filter((key) => key.startsWith("shipping")),
        `insert must not carry shipping* keys (got ${Object.keys(row).join(", ")})`
      ).toEqual([]);
    }

    // Update path: the conflict SET allowlist never touches the complement.
    const setKeys = Object.keys(
      (conflictUpdate?.set as Record<string, unknown>) ?? {}
    );
    // The known master-mirrored fields keep flowing (name/city/address/
    // status/updatedAt at minimum — the address IS the general branch
    // address, not the shipping sender block).
    expect(setKeys).toEqual(
      expect.arrayContaining(["name", "city", "address", "status", "updatedAt"])
    );
    expect(
      setKeys.filter((key) => key.startsWith("shipping")),
      `conflict SET must not contain shipping* keys (got ${setKeys.join(", ")})`
    ).toEqual([]);
  });
});
