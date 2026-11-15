import { describe, expect, it } from "vitest";

import {
  DISCOUNT_IMPORT_LIMIT_DEFAULTS,
  DISCOUNT_IMPORT_LIMIT_KEYS,
  DiscountImportLimitError,
  parseDiscountImportLimit,
  resolveDiscountImportLimits,
} from "./discount-import-limits";

// =========================================================
// Seam L — configured import limits (spec §6.2, X06)
// =========================================================
// Expected values are the approved defaults/literals from the spec, never a
// value re-derived by calling the module under test.

describe("parseDiscountImportLimit", () => {
  it("memakai default untuk nilai yang tidak diset", () => {
    for (const key of ["maxRows", "maxFileBytes", "maxExpandedBytes"] as const) {
      expect(parseDiscountImportLimit(key, null)).toBe(
        DISCOUNT_IMPORT_LIMIT_DEFAULTS[key]
      );
      expect(parseDiscountImportLimit(key, undefined)).toBe(
        DISCOUNT_IMPORT_LIMIT_DEFAULTS[key]
      );
      expect(parseDiscountImportLimit(key, "")).toBe(
        DISCOUNT_IMPORT_LIMIT_DEFAULTS[key]
      );
    }
    expect(parseDiscountImportLimit("maxRows", "")).toBe(1000);
    expect(parseDiscountImportLimit("maxFileBytes", null)).toBe(5242880);
    expect(parseDiscountImportLimit("maxExpandedBytes", undefined)).toBe(26214400);
  });

  it("menerima bilangan bulat 1..2147483647", () => {
    expect(parseDiscountImportLimit("maxRows", "1000")).toBe(1000);
    expect(parseDiscountImportLimit("maxRows", "1")).toBe(1);
    expect(parseDiscountImportLimit("maxRows", "2147483647")).toBe(2147483647);
    expect(parseDiscountImportLimit("maxFileBytes", "5242880")).toBe(5242880);
    expect(parseDiscountImportLimit("maxExpandedBytes", "26214400")).toBe(26214400);
  });

  it("menolak nol, negatif, pecahan, teks, dan nilai di luar batas", () => {
    const rejected = [
      "0",
      "-5",
      "1.5",
      "abc",
      "2147483648",
      "1000abc",
      "+5",
      "1e3",
      " ",
      "   ",
      "1000 ",
      " 1000",
    ];
    for (const value of rejected) {
      expect(() => parseDiscountImportLimit("maxRows", value)).toThrow(
        DiscountImportLimitError
      );
    }
  });

  it("melaporkan key yang gagal di dalam error", () => {
    let caught: unknown = null;
    try {
      parseDiscountImportLimit("maxFileBytes", "abc");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DiscountImportLimitError);
    expect((caught as DiscountImportLimitError).key).toBe("maxFileBytes");
  });
});

describe("resolveDiscountImportLimits", () => {
  it("mengekspor key dan default yang disepakati", () => {
    expect(DISCOUNT_IMPORT_LIMIT_KEYS).toEqual({
      maxRows: "discount.import.maxRows",
      maxFileBytes: "discount.import.maxFileBytes",
      maxExpandedBytes: "discount.import.maxExpandedBytes",
    });
    expect(DISCOUNT_IMPORT_LIMIT_DEFAULTS).toEqual({
      maxRows: 1000,
      maxFileBytes: 5242880,
      maxExpandedBytes: 26214400,
    });
  });

  it("menggabungkan default per key dengan nilai valid", () => {
    expect(resolveDiscountImportLimits({})).toEqual({
      maxRows: 1000,
      maxFileBytes: 5242880,
      maxExpandedBytes: 26214400,
    });
    expect(
      resolveDiscountImportLimits({
        maxRows: "5",
        maxFileBytes: null,
        maxExpandedBytes: undefined,
      })
    ).toEqual({
      maxRows: 5,
      maxFileBytes: 5242880,
      maxExpandedBytes: 26214400,
    });
  });

  it("fail closed: satu key invalid menggagalkan seluruh resolve", () => {
    expect(() =>
      resolveDiscountImportLimits({ maxRows: "10", maxFileBytes: "abc" })
    ).toThrow(DiscountImportLimitError);
    expect(() => resolveDiscountImportLimits({ maxRows: "0" })).toThrow(
      DiscountImportLimitError
    );
    expect(() =>
      resolveDiscountImportLimits({ maxExpandedBytes: "26214400x" })
    ).toThrow(DiscountImportLimitError);
  });
});
