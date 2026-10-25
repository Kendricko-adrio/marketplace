import { describe, expect, it } from "vitest";

import {
  MarkdownPriceError,
  computePercentTarget,
  projectMarkdownPrice,
  validateSetTarget,
} from "./markdown-pricing";

/**
 * Seam L — proyeksi harga Markdown SKU (spec §4.1, §4.4, §6.1).
 *
 * Expected values are the independent literals from the approved spec, NOT
 * values produced by the module under test.
 */
describe("projectMarkdownPrice", () => {
  it("memakai target saat 0 < target < source (base300000→target150000)", () => {
    expect(
      projectMarkdownPrice({
        sourceUnitPrice: "300000",
        storedTargetUnitPrice: "150000",
        markdownRevisionId: "rev-3",
      })
    ).toEqual({
      sourceUnitPrice: "300000",
      effectiveUnitPrice: "150000",
      storedTarget: "150000",
      markdownActive: true,
      markdownRevisionId: "rev-3",
    });
  });

  it("tanpa coretan saat source turun ke 120000 sementara target 150000 tersimpan", () => {
    expect(
      projectMarkdownPrice({
        sourceUnitPrice: "120000",
        storedTargetUnitPrice: "150000",
        markdownRevisionId: "rev-3",
      })
    ).toEqual({
      sourceUnitPrice: "120000",
      effectiveUnitPrice: "120000",
      storedTarget: "150000",
      markdownActive: false,
      markdownRevisionId: null,
    });
  });

  it("tanpa coretan saat source sama dengan target", () => {
    expect(
      projectMarkdownPrice({
        sourceUnitPrice: "150000",
        storedTargetUnitPrice: "150000",
        markdownRevisionId: "rev-3",
      })
    ).toEqual({
      sourceUnitPrice: "150000",
      effectiveUnitPrice: "150000",
      storedTarget: "150000",
      markdownActive: false,
      markdownRevisionId: null,
    });
  });

  it("mengaktifkan kembali target saat source naik ke 400000", () => {
    expect(
      projectMarkdownPrice({
        sourceUnitPrice: "400000",
        storedTargetUnitPrice: "150000",
        markdownRevisionId: "rev-3",
      })
    ).toEqual({
      sourceUnitPrice: "400000",
      effectiveUnitPrice: "150000",
      storedTarget: "150000",
      markdownActive: true,
      markdownRevisionId: "rev-3",
    });
  });

  it("restore (target null) mengikuti source tanpa coretan", () => {
    expect(
      projectMarkdownPrice({
        sourceUnitPrice: "300000",
        storedTargetUnitPrice: null,
        markdownRevisionId: null,
      })
    ).toEqual({
      sourceUnitPrice: "300000",
      effectiveUnitPrice: "300000",
      storedTarget: null,
      markdownActive: false,
      markdownRevisionId: null,
    });
  });

  it("menolak target aktif tanpa revision ID (coretan tanpa histori)", () => {
    expect(() =>
      projectMarkdownPrice({
        sourceUnitPrice: "300000",
        storedTargetUnitPrice: "150000",
        markdownRevisionId: null,
      })
    ).toThrow(MarkdownPriceError);
  });

  it("menolak target nol/pecahan dan source pecahan", () => {
    expect(() =>
      projectMarkdownPrice({ sourceUnitPrice: "300000", storedTargetUnitPrice: "0" })
    ).toThrow(MarkdownPriceError);
    expect(() =>
      projectMarkdownPrice({
        sourceUnitPrice: "300000",
        storedTargetUnitPrice: "150000.50",
      })
    ).toThrow(MarkdownPriceError);
    expect(() =>
      projectMarkdownPrice({ sourceUnitPrice: "300000.0001", storedTargetUnitPrice: null })
    ).toThrow(MarkdownPriceError);
  });
});

describe("computePercentTarget", () => {
  it("shortcut 85% dari 100001 memakai half-up → 85001", () => {
    expect(computePercentTarget("100001", "15")).toBe("85001");
  });

  it("shortcut 20% dari 300000 → 240000", () => {
    expect(computePercentTarget("300000", "20")).toBe("240000");
  });

  it("menerima rate sampai 6 digit dan membulatkan setengah ke atas", () => {
    // 100000 * 33.3333% discount = 33333.3 → target 66667
    expect(computePercentTarget("100000", "33.3333")).toBe("66667");
  });

  it("menolak rate 0, di atas 100, dan lebih dari 6 digit", () => {
    expect(() => computePercentTarget("100000", "0")).toThrow(MarkdownPriceError);
    expect(() => computePercentTarget("100000", "100.000001")).toThrow(
      MarkdownPriceError
    );
    expect(() => computePercentTarget("100000", "10.1234567")).toThrow(
      MarkdownPriceError
    );
  });
});

describe("validateSetTarget", () => {
  it("menerima target positif di bawah source terbaru", () => {
    expect(validateSetTarget("150000", "300000")).toBe("150000");
  });

  it("menolak target 0, sama dengan source, di atas source, dan pecahan", () => {
    expect(() => validateSetTarget("0", "300000")).toThrow(MarkdownPriceError);
    expect(() => validateSetTarget("300000", "300000")).toThrow(
      MarkdownPriceError
    );
    expect(() => validateSetTarget("400000", "300000")).toThrow(
      MarkdownPriceError
    );
    expect(() => validateSetTarget("150000.5", "300000")).toThrow(
      MarkdownPriceError
    );
  });
});
