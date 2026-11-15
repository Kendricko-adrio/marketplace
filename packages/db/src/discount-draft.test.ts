import { describe, expect, it } from "vitest";
import {
  parseDiscountDraftConfiguration,
  validateDiscountDraftForPublish,
  type DiscountDraftConfiguration,
} from "./discount-draft";

function emptyDraft(): DiscountDraftConfiguration {
  return {
    draftSchemaVersion: 1,
    name: null,
    currency: "IDR",
    minSubtotal: null,
    startAt: null,
    endAt: null,
    benefit: null,
    capacity: { quotaCount: null, budgetAmount: null, perClientLimit: 1 },
    codeChanges: { proposedCodes: [], states: [] },
  };
}

describe("snapshot draft diskon", () => {
  it("menormalisasi field kosong, canonical codes, tanggal offset, dan angka tanpa float", () => {
    const input = {
      ...emptyDraft(), name: "  Promo Juli  ", minSubtotal: "0000",
      startAt: "2026-07-01T07:00:00+07:00",
      benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "012.500000", capAmount: "" },
      capacity: { quotaCount: 200, budgetAmount: "000100000", perClientLimit: 2 },
      codeChanges: { proposedCodes: ["  juli-2026  "], states: [] },
    };
    expect(parseDiscountDraftConfiguration(input)).toEqual({
      success: true,
      configuration: {
        ...input, name: "Promo Juli", minSubtotal: "0", startAt: "2026-07-01T00:00:00.000Z",
        benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "12.5", capAmount: null },
        capacity: { quotaCount: 200, budgetAmount: "100000", perClientLimit: 2 },
        codeChanges: { proposedCodes: ["JULI-2026"], states: [] },
      },
    });
    expect(input.codeChanges.proposedCodes).toEqual(["  juli-2026  "]);
  });

  it.each([
    { name: "unknown schema", patch: { draftSchemaVersion: 2 }, path: "draftSchemaVersion" },
    { name: "unknown root field", patch: { live: true }, path: "live" },
    { name: "missing field", patch: { minSubtotal: undefined }, path: "minSubtotal" },
    { name: "currency", patch: { currency: "USD" }, path: "currency" },
    { name: "name length", patch: { name: "x".repeat(121) }, path: "name" },
    { name: "negative money", patch: { minSubtotal: "-1" }, path: "minSubtotal" },
    { name: "fractional money", patch: { minSubtotal: "100.01" }, path: "minSubtotal" },
    { name: "numeric money", patch: { minSubtotal: 100 }, path: "minSubtotal" },
    { name: "money overflow", patch: { minSubtotal: "10000000000000" }, path: "minSubtotal" },
    { name: "implicit timezone", patch: { startAt: "2026-07-01T07:00" }, path: "startAt" },
    { name: "calendar overflow", patch: { endAt: "2026-02-30T00:00:00Z" }, path: "endAt" },
    { name: "invalid offset", patch: { startAt: "2026-07-01T00:00:00+24:00" }, path: "startAt" },
    { name: "empty window", patch: { startAt: "2026-07-01T00:00:00Z", endAt: "2026-07-01T00:00:00Z" }, path: "endAt" },
    { name: "mixed benefit", patch: { benefit: { kind: "shipping", paramsVersion: 1, capAmount: "1", rate: "10" } }, path: "benefit.rate" },
    { name: "benefit version", patch: { benefit: { kind: "fixed_goods", paramsVersion: 2, fixedAmount: "1" } }, path: "benefit.paramsVersion" },
    { name: "zero benefit", patch: { benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "0" } }, path: "benefit.fixedAmount" },
    { name: "percent bound", patch: { benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "100.000001", capAmount: null } }, path: "benefit.rate" },
    { name: "percent precision", patch: { benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "12.1234567", capAmount: null } }, path: "benefit.rate" },
    { name: "zero optional cap", patch: { benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "0" } }, path: "benefit.capAmount" },
    { name: "count overflow", patch: { capacity: { quotaCount: 2147483648, budgetAmount: null, perClientLimit: 1 } }, path: "capacity.quotaCount" },
    { name: "fractional count", patch: { capacity: { quotaCount: 1.5, budgetAmount: null, perClientLimit: 1 } }, path: "capacity.quotaCount" },
    { name: "zero per client", patch: { capacity: { quotaCount: null, budgetAmount: null, perClientLimit: 0 } }, path: "capacity.perClientLimit" },
    { name: "duplicate code", patch: { codeChanges: { proposedCodes: ["abc", "ABC"], states: [] } }, path: "codeChanges.proposedCodes.1" },
    { name: "invalid code", patch: { codeChanges: { proposedCodes: ["ıBC"], states: [] } }, path: "codeChanges.proposedCodes.0" },
    { name: "too many codes", patch: { codeChanges: { proposedCodes: Array.from({ length: 51 }, (_, i) => `CODE-${i}`), states: [] } }, path: "codeChanges.proposedCodes" },
    { name: "missing state version", patch: { codeChanges: { proposedCodes: [], states: [{ codeId: "code-1", state: "active" }] } }, path: "codeChanges.states.0.expectedCodeVersion" },
    { name: "duplicate state", patch: { codeChanges: { proposedCodes: [], states: [
      { codeId: "code-1", expectedCodeVersion: 1, state: "active" },
      { codeId: "code-1", expectedCodeVersion: 1, state: "inactive" },
    ] } }, path: "codeChanges.states.1.codeId" },
  ])("menolak $name dengan path aman", ({ patch, path }) => {
    const result = parseDiscountDraftConfiguration({ ...emptyDraft(), ...patch });
    expect(result).toEqual({ success: false, issues: expect.arrayContaining([
      expect.objectContaining({ path, message: expect.any(String) }),
    ]) });
  });

  it.each([
    { kind: "fixed_goods", paramsVersion: 1, fixedAmount: null },
    { kind: "percentage_goods", paramsVersion: 1, rate: null, capAmount: null },
    { kind: "shipping", paramsVersion: 1, capAmount: null },
  ])("menerima parameter kosong $kind untuk draft, bukan publish", (benefit) => {
    const result = parseDiscountDraftConfiguration({ ...emptyDraft(), benefit });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Draft parsial harus diterima");
    expect(validateDiscountDraftForPublish(result.configuration)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: benefit.kind === "fixed_goods" ? "benefit.fixedAmount" : benefit.kind === "shipping" ? "benefit.capAmount" : "benefit.rate" }),
    ]));
  });

  it("budget nol adalah batas sah dan bukan tanpa batas", () => {
    const input = {
      ...emptyDraft(), name: "Promo", minSubtotal: "0",
      benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "9999999999999" },
      capacity: { quotaCount: 2147483647, budgetAmount: "0", perClientLimit: 2147483647 },
    };
    const parsed = parseDiscountDraftConfiguration(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Konfigurasi pada batas domain harus diterima");
    expect(validateDiscountDraftForPublish(parsed.configuration)).toEqual([]);
  });
  it("menyimpan draft parsial tanpa mengarang nominal, nama, atau kapasitas", () => {
    expect(parseDiscountDraftConfiguration(emptyDraft())).toEqual({
      success: true,
      configuration: emptyDraft(),
    });
    expect(validateDiscountDraftForPublish(emptyDraft()).map((issue) => issue.path)).toEqual([
      "name", "benefit", "minSubtotal", "capacity",
    ]);
  });
});
