import { describe, expect, it } from "vitest";

import {
  DiscountAdministrationError,
  assertCreateInput,
  classifyCapacityChange,
  normalizeCodeProposals,
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
      benefit: {
        kind: "fixed_goods" as const,
        paramsVersion: 1 as const,
        fixedAmount: "17000",
      },
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

describe("validateDraftTerms — one typed goods benefit, IDR only", () => {
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
        benefit: { kind: "percentage_goods", paramsVersion: 1, capAmount: null },
      })
    ).toThrow(/benefit\.rate/);
    // Fixed field yang ikut terkirim pada percentage bukan diabaikan diam-diam.
    expect(() =>
      validateDraftTerms({
        ...valid,
        benefit: { ...valid.benefit, kind: "percentage_goods" },
      })
    ).toThrow(/does not belong/);
    expect(() =>
      validateDraftTerms({
        ...valid,
        benefit: {
          kind: "free_goods",
          paramsVersion: 1,
          fixedAmount: "1000",
        },
      })
    ).toThrow(/does not belong/);
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
    ).toThrow(/positive Rupiah/);
  });

  it("accepts percentage goods with rate up to6 fractional digits and nullable cap", () => {
    const terms = validateDraftTerms({
      ...valid,
      benefit: {
        kind: "percentage_goods",
        paramsVersion: 1,
        rate: "10.000000",
        capAmount: "20000",
      },
    });
    expect(terms.benefit).toEqual({
      kind: "percentage_goods",
      paramsVersion: 1,
      rate: "10",
      capAmount: "20000",
    });
    expect(
      validateDraftTerms({
        ...valid,
        benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "12.345678", capAmount: null },
      }).benefit
    ).toEqual({
      kind: "percentage_goods",
      paramsVersion: 1,
      rate: "12.345678",
      capAmount: null,
    });
    // Cap yang tidak diisi form = tanpa cap eksplisit, bukan default nominal.
    expect(
      validateDraftTerms({
        ...valid,
        benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "5" },
      }).benefit
    ).toEqual({ kind: "percentage_goods", paramsVersion: 1, rate: "5", capAmount: null });
  });

  it("refuses invalid percentage rate/cap and mixed fixed fields instead of rounding", () => {
    for (const benefit of [
      { kind: "percentage_goods", paramsVersion: 1, rate: "0", capAmount: null },
      { kind: "percentage_goods", paramsVersion: 1, rate: "100.000001", capAmount: null },
      { kind: "percentage_goods", paramsVersion: 1, rate: "10.1234567", capAmount: null },
      { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "0" },
      { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "20000.5" },
      { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: null, fixedAmount: "17000" },
    ]) {
      expect(() => validateDraftTerms({ ...valid, benefit }), JSON.stringify(benefit)).toThrow(
        DiscountAdministrationError
      );
    }
  });

  it("publish fingerprint binds the exact percentage rate and cap", () => {
    const base = publishReviewFingerprint(fingerprintInput());
    const percentage = publishReviewFingerprint({
      ...fingerprintInput(),
      terms: {
        ...fingerprintInput().terms,
        benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "20000" },
      },
    });
    const uncapped = publishReviewFingerprint({
      ...fingerprintInput(),
      terms: {
        ...fingerprintInput().terms,
        benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: null },
      },
    });
    expect(percentage).not.toBe(base);
    expect(percentage).not.toBe(uncapped);
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
        terms: {
          ...fingerprintInput().terms,
          benefit: {
            kind: "fixed_goods" as const,
            paramsVersion: 1 as const,
            fixedAmount: "25000",
          },
        },
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
  it("accepts only a UUID request key and a supported activation kind", () => {
    const key = "3f0c4a1e-9b1e-4d5a-8f2b-1c2d3e4f5a6b";
    expect(assertCreateInput({ requestKey: key, activationKind: "public" })).toBe(
      key
    );
    expect(
      assertCreateInput({ requestKey: key, activationKind: "manual_only" })
    ).toBe(key);
    expect(() =>
      assertCreateInput({ requestKey: "not-a-uuid", activationKind: "public" })
    ).toThrow(DiscountAdministrationError);
    // Nama jalur salah tidak pernah "diperbaiki" diam-diam menjadi manual_only.
    expect(() =>
      assertCreateInput({ requestKey: key, activationKind: "manual" })
    ).toThrow(/public or manual_only/);
  });
});

describe("normalizeCodeProposals — canonical, unique, channel-bound (ticket 09)", () => {
  it("trims/uppercases and keeps order", () => {
    expect(
      normalizeCodeProposals([" hemat17agustus ", "promo_2026-ok"], "manual_only")
    ).toEqual(["HEMAT17AGUSTUS", "PROMO_2026-OK"]);
    expect(normalizeCodeProposals(undefined, "manual_only")).toEqual([]);
  });

  it("rejects aliases, internal spaces, and duplicates AFTER canonicalization", () => {
    expect(() => normalizeCodeProposals(["ABCDEF1", "abcdef1"], "manual_only")).toThrow(
      /duplicate canonical/
    );
    expect(() => normalizeCodeProposals(["HEMAT 17"], "manual_only")).toThrow(
      /3-64 ASCII/
    );
    expect(() => normalizeCodeProposals(["hémät17"], "manual_only")).toThrow(
      /3-64 ASCII/
    );
    expect(() => normalizeCodeProposals(["AB"], "manual_only")).toThrow(/3-64 ASCII/);
    expect(() => normalizeCodeProposals("HEMAT17", "manual_only")).toThrow(
      /array/
    );
    expect(() =>
      normalizeCodeProposals(Array.from({ length: 51 }, (_, i) => `CODE${i}`), "manual_only")
    ).toThrow(/too many/);
  });

  it("never attaches a code proposal to a public Offer", () => {
    expect(normalizeCodeProposals([], "public")).toEqual([]);
    expect(() => normalizeCodeProposals(["HEMAT17"], "public")).toThrow(
      DiscountAdministrationError
    );
    expect(() => normalizeCodeProposals(["HEMAT17"], "public")).toThrow(
      /public Offer has no customer code/
    );
  });

  it("publish fingerprint binds the proposed codes", () => {
    const base = publishReviewFingerprint(fingerprintInput());
    const withCodes = publishReviewFingerprint({
      ...fingerprintInput(),
      proposedCodes: ["HEMAT17AGUSTUS"],
    });
    expect(withCodes).not.toBe(base);
    expect(withCodes).toBe(
      publishReviewFingerprint({
        ...fingerprintInput(),
        proposedCodes: ["HEMAT17AGUSTUS"],
      })
    );
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
    activationKind: "public",
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

// Ticket 11 — subsidi ongkir memakai form/draft/fingerprint yang sama, tetapi
// hanya cap positif (tanpa rate/fixed goods).
describe("validateDraftTerms — benefit shipping hanya cap positif", () => {
  const valid = {
    name: "Subsidi Ongkir",
    currency: "IDR",
    minSubtotal: "0",
    startAt: "2026-10-01T00:00:00+07:00",
    endAt: "2026-11-01T00:00:00+07:00",
    benefit: { kind: "shipping", paramsVersion: 1, capAmount: "20000" },
  };

  it("normalizes a valid shipping cap and binds it into the publish fingerprint", () => {
    expect(validateDraftTerms(valid).benefit).toEqual({
      kind: "shipping",
      paramsVersion: 1,
      capAmount: "20000",
    });
    const base = publishReviewFingerprint(fingerprintInput());
    const shipping = publishReviewFingerprint({
      ...fingerprintInput(),
      terms: {
        ...fingerprintInput().terms,
        benefit: { kind: "shipping", paramsVersion: 1, capAmount: "20000" },
      },
    });
    const otherCap = publishReviewFingerprint({
      ...fingerprintInput(),
      terms: {
        ...fingerprintInput().terms,
        benefit: { kind: "shipping", paramsVersion: 1, capAmount: "25000" },
      },
    });
    expect(shipping).not.toBe(base);
    expect(shipping).not.toBe(otherCap);
  });

  it("refuses missing/zero/fractional cap, rate and fixed goods fields", () => {
    for (const benefit of [
      { kind: "shipping", paramsVersion: 1 },
      { kind: "shipping", paramsVersion: 1, capAmount: "0" },
      { kind: "shipping", paramsVersion: 1, capAmount: "20000.5" },
      { kind: "shipping", paramsVersion: 1, capAmount: "20000", rate: "10" },
      { kind: "shipping", paramsVersion: 1, capAmount: "20000", fixedAmount: "10000" },
      { kind: "shipping", paramsVersion: 2, capAmount: "20000" },
    ]) {
      expect(() => validateDraftTerms({ ...valid, benefit }), JSON.stringify(benefit)).toThrow(
        DiscountAdministrationError
      );
    }
  });
});
