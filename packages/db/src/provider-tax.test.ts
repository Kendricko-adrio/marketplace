import { describe, expect, it } from "vitest";

import {
  allocateProviderTax,
  parseValidatedProviderTax,
  ProviderTaxError,
} from "./provider-tax";

// =========================================================
// PPN provider — pure tax context dan alokasi whole-line
// =========================================================
// Expected values adalah literal dari spec
// `.scratch/jubelio-sales-api-switching/plan/jubelio-sales-order-tax-spec.md`
// §5.3 (contoh acceptance independen, rate 11%), bukan hasil hitung ulang oleh
// fungsi yang sedang diuji. Total pajak per baris WAJIB sama dengan ppnAmount
// order: ceil dihitung sekali pada net barang, bukan per baris.

const rate11 = "11";

describe("allocateProviderTax", () => {
  it("memajaki barang 100000 sekali → 11000", () => {
    expect(
      allocateProviderTax({
        lines: [{ variantId: "v1", netLineAmount: "100000" }],
        ppnRatePercent: rate11,
        ppnAmount: "11000",
      })
    ).toEqual([{ variantId: "v1", providerTaxAmount: "11000" }]);
  });

  it("qty 2 × 100000 memajaki whole line 200000 → 22000, bukan 11000", () => {
    expect(
      allocateProviderTax({
        lines: [{ variantId: "v1", netLineAmount: "200000" }],
        ppnRatePercent: rate11,
        ppnAmount: "22000",
      })
    ).toEqual([{ variantId: "v1", providerTaxAmount: "22000" }]);
  });

  it("barang 130000 setelah Coupon 20000 → 14300", () => {
    expect(
      allocateProviderTax({
        lines: [{ variantId: "v1", netLineAmount: "130000" }],
        ppnRatePercent: rate11,
        ppnAmount: "14300",
      })
    ).toEqual([{ variantId: "v1", providerTaxAmount: "14300" }]);
  });

  it("delivery memajaki net barang 150000 saja, ongkir tidak → 16500", () => {
    expect(
      allocateProviderTax({
        lines: [{ variantId: "v1", netLineAmount: "150000" }],
        ppnRatePercent: rate11,
        ppnAmount: "16500",
      })
    ).toEqual([{ variantId: "v1", providerTaxAmount: "16500" }]);
  });

  it("dua baris 100001 → order 22001 dengan selisih dibagi menurut tie-break variantId", () => {
    expect(
      allocateProviderTax({
        lines: [
          { variantId: "b", netLineAmount: "100001" },
          { variantId: "a", netLineAmount: "100001" },
        ],
        ppnRatePercent: rate11,
        ppnAmount: "22001",
      })
    ).toEqual([
      { variantId: "b", providerTaxAmount: "11000" },
      { variantId: "a", providerTaxAmount: "11001" },
    ]);
  });

  it("urutan input tidak mengubah alokasi per variant", () => {
    const first = allocateProviderTax({
      lines: [
        { variantId: "a", netLineAmount: "100001" },
        { variantId: "b", netLineAmount: "100001" },
      ],
      ppnRatePercent: rate11,
      ppnAmount: "22001",
    });
    const second = allocateProviderTax({
      lines: [
        { variantId: "b", netLineAmount: "100001" },
        { variantId: "a", netLineAmount: "100001" },
      ],
      ppnRatePercent: rate11,
      ppnAmount: "22001",
    });
    expect(first).toEqual([
      { variantId: "a", providerTaxAmount: "11001" },
      { variantId: "b", providerTaxAmount: "11000" },
    ]);
    expect(second).toEqual([...first].reverse());
  });

  it("baris net 0 tetap mendapat pajak 0 dan tidak mengambil sisa pembulatan", () => {
    expect(
      allocateProviderTax({
        lines: [
          { variantId: "free", netLineAmount: "0" },
          { variantId: "paid", netLineAmount: "150000" },
        ],
        ppnRatePercent: rate11,
        ppnAmount: "16500",
      })
    ).toEqual([
      { variantId: "free", providerTaxAmount: "0" },
      { variantId: "paid", providerTaxAmount: "16500" },
    ]);
  });

  it("net barang 0 seluruhnya → pajak 0 tanpa pembagian nol", () => {
    expect(
      allocateProviderTax({
        lines: [{ variantId: "v1", netLineAmount: "0" }],
        ppnRatePercent: rate11,
        ppnAmount: "0",
      })
    ).toEqual([{ variantId: "v1", providerTaxAmount: "0" }]);
  });

  it("rate 0 → seluruh baris 0", () => {
    expect(
      allocateProviderTax({
        lines: [
          { variantId: "a", netLineAmount: "12345" },
          { variantId: "b", netLineAmount: "999" },
        ],
        ppnRatePercent: "0",
        ppnAmount: "0",
      })
    ).toEqual([
      { variantId: "a", providerTaxAmount: "0" },
      { variantId: "b", providerTaxAmount: "0" },
    ]);
  });

  it("menerima rate kanonik setara 11.00", () => {
    expect(
      allocateProviderTax({
        lines: [{ variantId: "v1", netLineAmount: "100000" }],
        ppnRatePercent: "11.00",
        ppnAmount: "11000",
      })
    ).toEqual([{ variantId: "v1", providerTaxAmount: "11000" }]);
  });

  it("menolak ppnAmount yang tidak sama dengan ceil net × rate", () => {
    for (const ppnAmount of ["10999", "11001"]) {
      expect(() =>
        allocateProviderTax({
          lines: [{ variantId: "v1", netLineAmount: "100000" }],
          ppnRatePercent: rate11,
          ppnAmount,
        })
      ).toThrow(ProviderTaxError);
    }
  });

  it("menolak baris net pecahan, negatif, atau variant duplikat", () => {
    for (const netLineAmount of ["100000.50", "-1", "1e5", " 100000"]) {
      expect(() =>
        allocateProviderTax({
          lines: [{ variantId: "v1", netLineAmount }],
          ppnRatePercent: rate11,
          ppnAmount: "0",
        })
      ).toThrow(ProviderTaxError);
    }
    expect(() =>
      allocateProviderTax({
        lines: [
          { variantId: "v1", netLineAmount: "100" },
          { variantId: "v1", netLineAmount: "100" },
        ],
        ppnRatePercent: rate11,
        ppnAmount: "22",
      })
    ).toThrow(ProviderTaxError);
  });

  it("menolak daftar baris kosong", () => {
    expect(() =>
      allocateProviderTax({ lines: [], ppnRatePercent: rate11, ppnAmount: "0" })
    ).toThrow(ProviderTaxError);
  });
});

describe("parseValidatedProviderTax", () => {
  it("menerima tax id negatif -2 (PPN 11% tenant) dan menormalkan rate", () => {
    expect(
      parseValidatedProviderTax({ taxId: -2, ratePercent: "11.00" })
    ).toEqual({ taxId: -2, ratePercent: "11" });
    expect(
      parseValidatedProviderTax({ taxId: 7, ratePercent: "11" })
    ).toEqual({ taxId: 7, ratePercent: "11" });
  });

  it("menolak tax id 0, pecahan, overflow, string, dan null", () => {
    const invalidIds: unknown[] = [
      0,
      1.5,
      Number.MAX_SAFE_INTEGER + 2,
      "-2",
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ];
    for (const taxId of invalidIds) {
      expect(() =>
        parseValidatedProviderTax({ taxId, ratePercent: "11" })
      ).toThrow(ProviderTaxError);
    }
  });

  it("menolak rate di luar 0..100, lebih dari 6 digit pecahan, dan bentuk ambigu", () => {
    for (const ratePercent of ["100.0000001", "101", "-2.00", "1e1", " 11", "11%"]) {
      expect(() =>
        parseValidatedProviderTax({ taxId: -2, ratePercent })
      ).toThrow(ProviderTaxError);
    }
  });

  it("menolak field asing dan payload bukan object", () => {
    expect(() =>
      parseValidatedProviderTax({ taxId: -2, ratePercent: "11", taxName: "PPN" })
    ).toThrow(ProviderTaxError);
    expect(() => parseValidatedProviderTax(null)).toThrow(ProviderTaxError);
    expect(() => parseValidatedProviderTax("11")).toThrow(ProviderTaxError);
  });
});
