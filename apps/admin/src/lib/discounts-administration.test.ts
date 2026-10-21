import { describe, expect, it } from "vitest";

import {
  DiscountAdministrationError,
  assertCreateInput,
  classifyCapacityChange,
  parseOptionalInstant,
  parseWholeRupiah,
  publicDraftCommandFingerprint,
  publishReviewFingerprint,
  validateDraftTerms,
  validatePublishable,
  type CapacitySnapshot,
  type ReviewValidationCode,
} from "./discounts-administration";

// =========================================================
// Seam L — pure discount-administration rules (spec §5.4, §7.1, §8.1–§8.2)
// =========================================================
// No DB, no HTTP, no clock: every expectation below is a literal taken from
// the approved spec (money bounds, IDR-only, one fixed benefit, start<end,
// capacity direction, publication completeness).

function codes(
  validations: ReadonlyArray<{ code: ReviewValidationCode; ok: boolean }>
) {
  return validations.filter((row) => !row.ok).map((row) => row.code);
}

const CAPACITY: CapacitySnapshot = {
  quotaCount: 10,
  budgetAmount: null,
  perClientLimit: 1,
};

function fingerprintInput() {
  return {
    offerId: "offer-1",
    offerVersion: 3,
    draftVersion: 2,
    policyVersion: 1,
    liveRevisionId: "rev-1",
    draftRevisionId: "rev-2",
    stateAfter: "enabled",
    terms: {
      name: "Diskon Rp17.000 Sepatu",
      currency: "IDR" as const,
      minSubtotal: "100000",
      startAt: "2026-10-01T00:00:00+07:00",
      endAt: "2026-11-01T00:00:00+07:00",
      benefitFixedAmount: "17000",
    },
    capacity: CAPACITY,
  };
}

describe("parseWholeRupiah — money input", () => {
  it("accepts whole Rupiah and canonicalizes leading zeros", () => {
    expect(parseWholeRupiah("0", "minSubtotal")).toBe("0");
    expect(parseWholeRupiah("25000", "fixedAmount")).toBe("25000");
    expect(parseWholeRupiah("00017000", "fixedAmount")).toBe("17000");
    expect(parseWholeRupiah(17000, "fixedAmount")).toBe("17000");
    expect(parseWholeRupiah("9999999999999", "budgetAmount")).toBe(
      "9999999999999"
    );
  });

  it("refuses fractional, negative, malformed and out-of-bound amounts", () => {
    for (const value of ["1.5", "-1", "1e3", "", " 12 000 ", "abc", 12.5]) {
      expect(() => parseWholeRupiah(value, "amount"), String(value)).toThrow(
        DiscountAdministrationError
      );
    }
    expect(() => parseWholeRupiah("10000000000000", "amount")).toThrow(
      /money bound/
    );
    expect(() =>
      parseWholeRupiah("0", "benefit.fixedAmount", { allowZero: false })
    ).toThrow(/greater than zero/);
  });
});

describe("parseOptionalInstant — WIB input with explicit offset", () => {
  it("keeps null optional and normalizes an offset instant", () => {
    expect(parseOptionalInstant(null, "startAt")).toBeNull();
    expect(parseOptionalInstant(undefined, "startAt")).toBeNull();
    const instant = parseOptionalInstant(
      "2026-10-01T07:30:00+07:00",
      "startAt"
    );
    expect(instant?.toISOString()).toBe("2026-10-01T00:30:00.000Z");
  });

  it("refuses an instant without an offset instead of guessing a timezone", () => {
    expect(() =>
      parseOptionalInstant("2026-10-01T07:30:00", "startAt")
    ).toThrow(DiscountAdministrationError);
    expect(() =>
      parseOptionalInstant("2026-13-01T07:30:00+07:00", "startAt")
    ).toThrow(DiscountAdministrationError);
  });
});

describe("validateDraftTerms — one fixed-goods benefit, IDR only", () => {
  const valid = {
    name: "  Diskon Rp17.000 Sepatu  ",
    currency: "IDR",
    minSubtotal: "100000",
    startAt: "2026-10-01T00:00:00+07:00",
    endAt: "2026-11-01T00:00:00+07:00",
    benefit: {
      kind: "fixed_goods",
      paramsVersion: 1,
      fixedAmount: "17000",
    },
  };

  it("normalizes a valid draft", () => {
    const terms = validateDraftTerms(valid);
    expect(terms.name).toBe("Diskon Rp17.000 Sepatu");
    expect(terms.currency).toBe("IDR");
    expect(terms.minSubtotal).toBe("100000");
    expect(terms.benefit).toEqual({
      kind: "fixed_goods",
      paramsVersion: 1,
      fixedAmount: "17000",
    });
  });

  it("refuses unknown benefit kind/version instead of defaulting to fixed", () => {
    expect(() =>
      validateDraftTerms({
        ...valid,
        benefit: { ...valid.benefit, kind: "percentage_goods" },
      })
    ).toThrow(/not supported/);
    expect(() =>
      validateDraftTerms({
        ...valid,
        benefit: { ...valid.benefit, paramsVersion: 2 },
      })
    ).toThrow(/paramsVersion/);
  });

  it("refuses a non-IDR currency and an empty name", () => {
    expect(() => validateDraftTerms({ ...valid, currency: "USD" })).toThrow(
      /IDR/
    );
    expect(() => validateDraftTerms({ ...valid, name: "   " })).toThrow(
      /1\.\.120/
    );
  });

  it("refuses start >= end (start is inclusive, end exclusive)", () => {
    expect(() =>
      validateDraftTerms({
        ...valid,
        startAt: "2026-11-01T00:00:00+07:00",
        endAt: "2026-11-01T00:00:00+07:00",
      })
    ).toThrow(/earlier/);
  });

  it("refuses a zero fixed benefit", () => {
    expect(() =>
      validateDraftTerms({
        ...valid,
        benefit: { ...valid.benefit, fixedAmount: "0" },
      })
    ).toThrow(/greater than zero/);
  });
});

describe("publishReviewFingerprint — server-bound review identity", () => {
  it("is a stable SHA-256 over the same command", () => {
    const first = publishReviewFingerprint(fingerprintInput());
    const second = publishReviewFingerprint(fingerprintInput());
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it("changes when any reviewed term, version or capacity changes", () => {
    const base = publishReviewFingerprint(fingerprintInput());
    const mutations = [
      { ...fingerprintInput(), offerVersion: 4 },
      { ...fingerprintInput(), draftVersion: 3 },
      { ...fingerprintInput(), policyVersion: 2 },
      { ...fingerprintInput(), liveRevisionId: null },
      { ...fingerprintInput(), draftRevisionId: "rev-9" },
      { ...fingerprintInput(), stateAfter: "paused" },
      {
        ...fingerprintInput(),
        terms: { ...fingerprintInput().terms, minSubtotal: "0" },
      },
      {
        ...fingerprintInput(),
        terms: { ...fingerprintInput().terms, benefitFixedAmount: "25000" },
      },
      {
        ...fingerprintInput(),
        capacity: { ...CAPACITY, quotaCount: 11 },
      },
    ];
    for (const mutated of mutations) {
      expect(publishReviewFingerprint(mutated)).not.toBe(base);
    }
  });

  it("a create command fingerprint is stable and independent of transport", () => {
    expect(publicDraftCommandFingerprint()).toBe(publicDraftCommandFingerprint());
    expect(publicDraftCommandFingerprint()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("assertCreateInput — activation kind is never defaulted", () => {
  it("accepts only a UUID request key and the public activation kind", () => {
    const key = "3f0c4a1e-9b1e-4d5a-8f2b-1c2d3e4f5a6b";
    expect(assertCreateInput({ requestKey: key, activationKind: "public" })).toBe(
      key
    );
    expect(() =>
      assertCreateInput({ requestKey: "not-a-uuid", activationKind: "public" })
    ).toThrow(DiscountAdministrationError);
    expect(() =>
      assertCreateInput({ requestKey: key, activationKind: "manual" })
    ).toThrow(/Only public/);
  });
});

describe("classifyCapacityChange — grant and commitment direction", () => {
  it("treats initial assignment, increase and bound removal as enlarging", () => {
    expect(
      classifyCapacityChange(
        { ...CAPACITY, quotaCount: null },
        { ...CAPACITY, quotaCount: 10 }
      ).direction
    ).toBe("enlarge");
    expect(
      classifyCapacityChange(
        { ...CAPACITY, quotaCount: 10 },
        { ...CAPACITY, quotaCount: 11 }
      ).direction
    ).toBe("enlarge");
    expect(
      classifyCapacityChange(
        { ...CAPACITY, budgetAmount: "100000" },
        { ...CAPACITY, budgetAmount: null }
      ).direction
    ).toBe("enlarge");
    expect(
      classifyCapacityChange(
        { ...CAPACITY, perClientLimit: 1 },
        { ...CAPACITY, perClientLimit: 2 }
      ).direction
    ).toBe("enlarge");
  });

  it("treats a lower limit as a reduction and an identical policy as same", () => {
    expect(
      classifyCapacityChange(
        { ...CAPACITY, quotaCount: 10 },
        { ...CAPACITY, quotaCount: 5 }
      ).direction
    ).toBe("reduce");
    expect(
      classifyCapacityChange(CAPACITY, { ...CAPACITY }).direction
    ).toBe("same");
  });
});

describe("validatePublishable — draft is incomplete until publish requirements hold", () => {
  type Draft = Parameters<typeof validatePublishable>[0]["draft"];
  type Benefit = Parameters<typeof validatePublishable>[0]["benefit"];

  const completeDraft = {
    name: "Diskon",
    currency: "IDR",
    minSubtotal: "0",
    startAt: null,
    endAt: null,
    publishedAt: null,
  } as unknown as Draft;
  const completeBenefit = {
    kind: "fixed_goods",
    scope: "goods",
    paramsVersion: 1,
    fixedAmount: "17000",
  } as unknown as Benefit;
  const offer = {
    state: "draft",
    quotaCount: 10,
    budgetAmount: null,
    perClientLimit: 1,
    currentRevisionId: null,
  };

  it("accepts a complete draft with one capacity bound", () => {
    expect(
      codes(
        validatePublishable({
          offer,
          draft: completeDraft,
          benefit: completeBenefit,
        })
      )
    ).toEqual([]);
  });

  it("reports every missing publication requirement", () => {
    expect(
      codes(
        validatePublishable({
          offer: { ...offer, quotaCount: null, budgetAmount: null },
          draft: null,
          benefit: null,
        })
      )
    ).toEqual(
      expect.arrayContaining([
        "TERMS_COMPLETE",
        "BENEFIT_VALID",
        "CAPACITY_BOUND",
      ])
    );
  });

  it("refuses a zero or fractional fixed benefit", () => {
    for (const fixedAmount of ["0", "1000.50"]) {
      expect(
        codes(
          validatePublishable({
            offer,
            draft: completeDraft,
            benefit: { ...completeBenefit, fixedAmount } as Benefit,
          })
        )
      ).toContain("BENEFIT_VALID");
    }
  });

  it("refuses a non-IDR currency and an inverted window", () => {
    expect(
      codes(
        validatePublishable({
          offer,
          draft: { ...completeDraft, currency: "USD" } as Draft,
          benefit: completeBenefit,
        })
      )
    ).toContain("TERMS_COMPLETE");
    expect(
      codes(
        validatePublishable({
          offer,
          draft: {
            ...completeDraft,
            startAt: new Date("2026-11-01T00:00:00Z"),
            endAt: new Date("2026-10-01T00:00:00Z"),
          } as Draft,
          benefit: completeBenefit,
        })
      )
    ).toContain("WINDOW_ORDERED");
  });
});
