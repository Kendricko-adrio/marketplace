import { describe, it, expect } from "vitest";
import {
  groupBranchStock,
  computeScopedTotals,
  type BranchStockInputRow,
  type BranchStockScope,
  type ScopedTotalsInputRow,
} from "./branch-stock";

// Raw rows as the product-detail API would hand them off (one row per
// branch × variant). Order is intentionally shuffled in the fixtures so the
// sort + group behaviour is exercised, not just a pass-through.

const ROWS: BranchStockInputRow[] = [
  {
    branchId: "br-srb",
    branchName: "Cabang Surabaya",
    branchCode: "SRB-01",
    branchCity: "Surabaya",
    branchStatus: "aktif",
    variantId: "v-40",
    sku: "ART-40",
    size: "40",
    color: "Hitam",
    stock: 10,
    reservedStock: 1,
    pendingRemoteStock: 1,
  },
  {
    branchId: "br-jkt",
    branchName: "Cabang Jakarta Pusat",
    branchCode: "JKT-01",
    branchCity: "Jakarta Pusat",
    branchStatus: "aktif",
    variantId: "v-41",
    sku: "ART-41",
    size: "41",
    color: "Hitam",
    stock: 15,
    reservedStock: 0,
    pendingRemoteStock: 0,
  },
  {
    branchId: "br-jkt",
    branchName: "Cabang Jakarta Pusat",
    branchCode: "JKT-01",
    branchCity: "Jakarta Pusat",
    branchStatus: "aktif",
    variantId: "v-40",
    sku: "ART-40",
    size: "40",
    color: "Hitam",
    stock: 20,
    reservedStock: 2,
    pendingRemoteStock: 2,
  },
  {
    branchId: "br-bdg",
    branchName: "Cabang Bandung Dago",
    branchCode: "BDG-01",
    branchCity: "Bandung",
    branchStatus: "nonaktif",
    variantId: "v-40",
    sku: "ART-40",
    size: "40",
    color: "Hitam",
    stock: 3,
    reservedStock: 5, // reserved > stock → available clamps to 0
    pendingRemoteStock: 5,
  },
];

describe("groupBranchStock", () => {
  it("mode 'all' keeps every branch, grouped + sorted, with available clamped at 0", () => {
    const scope: BranchStockScope = { mode: "all" };
    const out = groupBranchStock(scope, ROWS);

    // Branches sorted by name: Bandung Dago < Jakarta Pusat < Surabaya.
    expect(out.map((b) => b.name)).toEqual([
      "Cabang Bandung Dago",
      "Cabang Jakarta Pusat",
      "Cabang Surabaya",
    ]);

    const jkt = out.find((b) => b.id === "br-jkt")!;
    // Within a branch, rows sorted by size then color. Jakarta has 40 then 41.
    expect(jkt.rows.map((r) => r.sku)).toEqual(["ART-40", "ART-41"]);
    expect(jkt.rows[0]).toMatchObject({ stock: 20, reservedStock: 2, available: 18 });
    expect(jkt.rows[1]).toMatchObject({ stock: 15, reservedStock: 0, available: 15 });

    // Branch metadata is carried through.
    expect(jkt).toMatchObject({
      code: "JKT-01",
      city: "Jakarta Pusat",
      status: "aktif",
    });

    // reserved > stock clamps available to 0 (Bandung row).
    const bdg = out.find((b) => b.id === "br-bdg")!;
    expect(bdg.rows[0]).toMatchObject({ stock: 3, reservedStock: 5, available: 0 });
  });

  it("mode 'own' drops other branches even when their rows are passed in", () => {
    const scope: BranchStockScope = { mode: "own", branchId: "br-jkt" };
    const out = groupBranchStock(scope, ROWS);

    expect(out.map((b) => b.id)).toEqual(["br-jkt"]);
    expect(out[0].name).toBe("Cabang Jakarta Pusat");
    // Only Jakarta's two variants survive the filter.
    expect(out[0].rows.map((r) => r.sku).sort()).toEqual(["ART-40", "ART-41"]);
  });

  it("mode 'own' with a branchId that has no rows returns an empty array", () => {
    const scope: BranchStockScope = { mode: "own", branchId: "br-ghost" };
    expect(groupBranchStock(scope, ROWS)).toEqual([]);
  });

  it("a branch with only zero-stock rows still appears", () => {
    const rows: BranchStockInputRow[] = [
      {
        branchId: "br-jkt",
        branchName: "Cabang Jakarta Pusat",
        branchCode: "JKT-01",
        branchCity: "Jakarta Pusat",
        branchStatus: "aktif",
        variantId: "v-40",
        sku: "ART-40",
        size: "40",
        color: "Hitam",
        stock: 0,
        reservedStock: 0,
        pendingRemoteStock: 0,
      },
    ];
    const out = groupBranchStock({ mode: "all" }, rows);
    expect(out).toHaveLength(1);
    expect(out[0].rows[0]).toMatchObject({ stock: 0, reservedStock: 0, available: 0 });
  });

  it("shuffled input still yields name-sorted branches and size-sorted rows", () => {
    const shuffled: BranchStockInputRow[] = [
      ROWS[2], // jkt v-40
      ROWS[3], // bdg
      ROWS[1], // jkt v-41
      ROWS[0], // srb
    ];
    const out = groupBranchStock({ mode: "all" }, shuffled);
    expect(out.map((b) => b.name)).toEqual([
      "Cabang Bandung Dago",
      "Cabang Jakarta Pusat",
      "Cabang Surabaya",
    ]);
    const jkt = out.find((b) => b.id === "br-jkt")!;
    expect(jkt.rows.map((r) => r.sku)).toEqual(["ART-40", "ART-41"]);
  });

  it("empty input yields empty output", () => {
    expect(groupBranchStock({ mode: "all" }, [])).toEqual([]);
    expect(groupBranchStock({ mode: "own", branchId: "br-jkt" }, [])).toEqual([]);
  });
});

// Stock rows for the products-list API: one row per branch × variant, but the
// list route only needs per-product totals scoped to the caller's branch access.
// Mirrors the same scope rules as groupBranchStock (defence in depth: the SQL
// `where` is the real access control; this pure filter is the tested guarantee).
const TOTALS_ROWS: ScopedTotalsInputRow[] = [
  { branchId: "br-jkt", stock: 20, reservedStock: 2, pendingRemoteStock: 2 },
  { branchId: "br-jkt", stock: 15, reservedStock: 0, pendingRemoteStock: 0 },
  { branchId: "br-srb", stock: 10, reservedStock: 1, pendingRemoteStock: 1 },
  { branchId: "br-bdg", stock: 3, reservedStock: 5, pendingRemoteStock: 5 }, // pending > stock → clamps
];

describe("computeScopedTotals", () => {
  it("mode 'all' sums every row and clamps available at 0", () => {
    const out = computeScopedTotals({ mode: "all" }, TOTALS_ROWS);
    // 20 + 15 + 10 + 3 = 48; 2 + 0 + 1 + 5 = 8 → 40.
    expect(out).toEqual({ totalStock: 48, totalReserved: 8, totalAvailable: 40 });
  });

  it("mode 'own' keeps only the matching branch's rows", () => {
    const out = computeScopedTotals(
      { mode: "own", branchId: "br-jkt" },
      TOTALS_ROWS
    );
    // Jakarta only: 20 + 15 = 35 stock, 2 + 0 = 2 reserved → 33 available.
    expect(out).toEqual({ totalStock: 35, totalReserved: 2, totalAvailable: 33 });
  });

  it("mode 'own' with a branch that has no rows yields zeros", () => {
    const out = computeScopedTotals(
      { mode: "own", branchId: "br-ghost" },
      TOTALS_ROWS
    );
    expect(out).toEqual({ totalStock: 0, totalReserved: 0, totalAvailable: 0 });
  });

  it("available clamps to 0 when reserved exceeds stock (own branch)", () => {
    const rows: ScopedTotalsInputRow[] = [
      { branchId: "br-bdg", stock: 3, reservedStock: 5, pendingRemoteStock: 5 },
    ];
    const out = computeScopedTotals({ mode: "own", branchId: "br-bdg" }, rows);
    expect(out).toEqual({ totalStock: 3, totalReserved: 5, totalAvailable: 0 });
  });

  it("empty rows yield zeros in both modes", () => {
    expect(computeScopedTotals({ mode: "all" }, [])).toEqual({
      totalStock: 0,
      totalReserved: 0,
      totalAvailable: 0,
    });
    expect(
      computeScopedTotals({ mode: "own", branchId: "br-jkt" }, [])
    ).toEqual({ totalStock: 0, totalReserved: 0, totalAvailable: 0 });
  });
});
