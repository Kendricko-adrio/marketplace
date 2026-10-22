/**
 * Seam L — eligibility Offer publik (ticket 07). Literal harapan dihitung
 * manual dari spec §5.1, bukan memanggil engine untuk membangun expected.
 */
import { describe, expect, it } from "vitest";
import {
  describeOfferEligibilityReason,
  evaluateOfferEligibility,
  parseMoney,
  type OfferEligibilityInput,
} from "./discount-eligibility";

const NOW = new Date("2026-10-21T10:00:00.000Z");

function baseOffer(overrides: Partial<OfferEligibilityInput["offer"]> = {}) {
  return {
    activationKind: "public",
    state: "enabled",
    revisionPublished: true,
    startAt: null,
    endAt: null,
    minSubtotal: "0",
    quotaCount: 100,
    budgetAmount: "1000000",
    perClientLimit: 1,
    benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "25000" },
    usage: {
      reservedCount: 0,
      consumedCount: 0,
      reservedAmount: "0",
      consumedAmount: "0",
    },
    clientUsage: null,
    ...overrides,
  } as OfferEligibilityInput["offer"];
}

function input(overrides: Partial<OfferEligibilityInput> = {}): OfferEligibilityInput {
  return {
    now: NOW,
    verifiedEmail: true,
    subtotalAfterMarkdown: "150000",
    offer: baseOffer(),
    ...overrides,
  };
}

function reasonOf(overrides: Partial<OfferEligibilityInput> = {}) {
  return evaluateOfferEligibility(input(overrides)).reason;
}

describe("evaluateOfferEligibility — benefit dan clipping", () => {
  it("subtotal150000 fixed25000 eligible dengan benefitAmount25000", () => {
    expect(evaluateOfferEligibility(input())).toEqual({
      eligible: true,
      reason: null,
      benefitAmount: "25000",
    });
  });

  it("fixed25000 pada subtotal10000 di-clip menjadi10000", () => {
    expect(
      evaluateOfferEligibility(input({ subtotalAfterMarkdown: "10000" }))
    ).toEqual({ eligible: true, reason: null, benefitAmount: "10000" });
  });

  it("subtotal0 tidak pernah eligible (benefit0 tidak dipakai)", () => {
    expect(reasonOf({ subtotalAfterMarkdown: "0" })).toBe("BENEFIT_UNAVAILABLE");
  });

  it("scale2 numeric DB diterima exact, pecahan Rupiah ditolak", () => {
    expect(parseMoney("25000.00")).toBe(25000n);
    expect(parseMoney("25000.5")).toBeNull();
    expect(parseMoney("25000.50")).toBeNull();
    expect(parseMoney(25000)).toBe(25000n);
    expect(parseMoney(25000.5)).toBeNull();
    expect(reasonOf({ subtotalAfterMarkdown: "100.50" })).toBe("INPUT_INVALID");
  });
});

describe("evaluateOfferEligibility — discovery, waktu, minimum, identitas", () => {
  it("paused/archived/draft atau bukan public tidak dapat dipakai", () => {
    expect(reasonOf({ offer: baseOffer({ state: "paused" }) })).toBe("OFFER_UNAVAILABLE");
    expect(reasonOf({ offer: baseOffer({ state: "archived" }) })).toBe("OFFER_UNAVAILABLE");
    expect(reasonOf({ offer: baseOffer({ state: "draft" }) })).toBe("OFFER_UNAVAILABLE");
    expect(reasonOf({ offer: baseOffer({ revisionPublished: false }) })).toBe("OFFER_UNAVAILABLE");
    expect(reasonOf({ offer: baseOffer({ activationKind: "manual_only" }) })).toBe("OFFER_UNAVAILABLE");
  });

  it("start inklusif dan end eksklusif", () => {
    const start = new Date(NOW.getTime());
    const end = new Date(NOW.getTime() + 60_000);
    expect(reasonOf({ offer: baseOffer({ startAt: start, endAt: end }) })).toBeNull();
    expect(
      reasonOf({ offer: baseOffer({ startAt: new Date(NOW.getTime() + 1) }) })
    ).toBe("WINDOW_CLOSED");
    expect(
      reasonOf({ offer: baseOffer({ endAt: new Date(NOW.getTime()) }) })
    ).toBe("WINDOW_CLOSED");
  });

  it("minimum memakai subtotal setelah Markdown: 99999 gagal, 100000 lolos", () => {
    expect(
      reasonOf({ subtotalAfterMarkdown: "99999", offer: baseOffer({ minSubtotal: "100000" }) })
    ).toBe("MINIMUM_NOT_MET");
    expect(
      reasonOf({ subtotalAfterMarkdown: "100000", offer: baseOffer({ minSubtotal: "100000" }) })
    ).toBeNull();
  });

  it("verified email wajib; contact email order bukan pengganti", () => {
    expect(reasonOf({ verifiedEmail: false })).toBe("EMAIL_VERIFICATION_REQUIRED");
  });

  it("unknown benefit kind/paramsVersion atau nominal0 tidak eligible", () => {
    expect(reasonOf({ offer: baseOffer({ benefit: null }) })).toBe("BENEFIT_UNAVAILABLE");
    expect(
      reasonOf({
        offer: baseOffer({
          benefit: { kind: "percentage_goods", paramsVersion: 1, fixedAmount: "10" },
        }),
      })
    ).toBe("BENEFIT_UNAVAILABLE");
    expect(
      reasonOf({
        offer: baseOffer({
          benefit: { kind: "fixed_goods", paramsVersion: 2, fixedAmount: "25000" },
        }),
      })
    ).toBe("BENEFIT_UNAVAILABLE");
    expect(
      reasonOf({
        offer: baseOffer({
          benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "0" },
        }),
      })
    ).toBe("BENEFIT_UNAVAILABLE");
  });
});

describe("evaluateOfferEligibility — kapasitas", () => {
  it("jatah akun default1: pemakaian sebelumnya menolak, belum pernah lolos", () => {
    expect(
      reasonOf({
        offer: baseOffer({
          perClientLimit: 1,
          clientUsage: {
            reservedCount: 0,
            consumedCount: 1,
            reservedAmount: "0",
            consumedAmount: "25000",
          },
        }),
      })
    ).toBe("CAPACITY_UNAVAILABLE");
    expect(
      reasonOf({
        offer: baseOffer({
          perClientLimit: 2,
          clientUsage: {
            reservedCount: 0,
            consumedCount: 1,
            reservedAmount: "0",
            consumedAmount: "25000",
          },
        }),
      })
    ).toBeNull();
  });

  it("kuota global: reserved9+consumed1 dari10 menolak pemakaian berikut", () => {
    expect(
      reasonOf({
        offer: baseOffer({
          quotaCount: 10,
          usage: {
            reservedCount: 9,
            consumedCount: 1,
            reservedAmount: "0",
            consumedAmount: "0",
          },
        }),
      })
    ).toBe("CAPACITY_UNAVAILABLE");
  });

  it("budget sisa15000 untuk benefit20000 ditolak, bukan discount diperkecil", () => {
    expect(
      reasonOf({
        offer: baseOffer({
          budgetAmount: "15000",
          usage: {
            reservedCount: 0,
            consumedCount: 0,
            reservedAmount: "0",
            consumedAmount: "0",
          },
        }),
      })
    ).toBe("CAPACITY_UNAVAILABLE");
    expect(
      reasonOf({
        offer: baseOffer({
          budgetAmount: "25000",
          usage: {
            reservedCount: 1,
            consumedCount: 0,
            reservedAmount: "0",
            consumedAmount: "0",
          },
        }),
      })
    ).toBeNull();
  });

  it("budget memakai nominal aktual: subtotal10000 fixed25000 hanya butuh10000", () => {
    expect(
      reasonOf({
        subtotalAfterMarkdown: "10000",
        offer: baseOffer({
          budgetAmount: "10000",
          usage: {
            reservedCount: 0,
            consumedCount: 0,
            reservedAmount: "0",
            consumedAmount: "0",
          },
        }),
      })
    ).toBeNull();
  });
});

describe("describeOfferEligibilityReason", () => {
  it("memberi pesan aman tanpa menyebut kode/Offer lain", () => {
    expect(describeOfferEligibilityReason("CAPACITY_UNAVAILABLE")).toBe(
      "Kuota promo ini sudah habis."
    );
    expect(describeOfferEligibilityReason("EMAIL_VERIFICATION_REQUIRED")).toBe(
      "Verifikasi email akun Anda untuk memakai promo ini."
    );
    expect(describeOfferEligibilityReason(null)).toBe("Promo ini tidak dapat diverifikasi.");
  });
});

describe("evaluateOfferEligibility — channel manual (ticket 09)", () => {
  const manualOffer = (overrides: Partial<OfferEligibilityInput["offer"]> = {}) =>
    baseOffer({ activationKind: "manual_only", ...overrides });

  it("manual_only + kode resolve aktif memakai engine dan counters yang sama", () => {
    expect(
      evaluateOfferEligibility(
        input({ channel: "manual", manualCodeAccepted: true, offer: manualOffer() })
      )
    ).toEqual({ eligible: true, reason: null, benefitAmount: "25000" });
  });

  it("kode tidak resolve/nonaktif/untung lain = alasan aman yang sama", () => {
    for (const accepted of [false, undefined]) {
      expect(
        evaluateOfferEligibility(
          input({ channel: "manual", manualCodeAccepted: accepted, offer: manualOffer() })
        ).reason
      ).toBe("OFFER_UNAVAILABLE");
    }
    // Channel manual tidak membuka Offer publik, dan channel publik tidak
    // membuka Offer manual-only.
    expect(
      evaluateOfferEligibility(
        input({ channel: "manual", manualCodeAccepted: true, offer: baseOffer() })
      ).reason
    ).toBe("OFFER_UNAVAILABLE");
    expect(reasonOf({ offer: manualOffer() })).toBe("OFFER_UNAVAILABLE");
  });

  it("kapasitas/waktu/minimum/verified tetap memakai pemeriksaan bersama", () => {
    const manual = (
      overrides: Partial<OfferEligibilityInput["offer"]> = {},
      outer: Partial<OfferEligibilityInput> = {}
    ) =>
      evaluateOfferEligibility(
        input({ channel: "manual", manualCodeAccepted: true, offer: manualOffer(overrides), ...outer })
      ).reason;
    expect(manual({ quotaCount: 1 }, { offer: manualOffer({ quotaCount: 1 }) })).toBeNull();
    expect(
      manual(
        { quotaCount: 1 },
        {
          offer: manualOffer({
            quotaCount: 1,
            usage: { reservedCount: 1, consumedCount: 0, reservedAmount: "25000", consumedAmount: "0" },
          }),
        }
      )
    ).toBe("CAPACITY_UNAVAILABLE");
    expect(manual({ state: "paused" })).toBe("OFFER_UNAVAILABLE");
    expect(manual({ endAt: new Date(NOW.getTime()) })).toBe("WINDOW_CLOSED");
    expect(manual({ minSubtotal: "200000" })).toBe("MINIMUM_NOT_MET");
    expect(manual({}, { verifiedEmail: false })).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(manual({ budgetAmount: "10000" })).toBe("CAPACITY_UNAVAILABLE");
    expect(manual({}, { channel: "nonsense" as unknown as "manual" })).toBe("INPUT_INVALID");
  });
});

// =========================================================
// Ticket 10 — percentage goods dengan cap opsional
// =========================================================
// Literal harapan dari spec §4.2/§4.4; bukan memanggil engine pricing.

function percentageOffer(
  rate: string,
  capAmount: string | null,
  overrides: Partial<OfferEligibilityInput> = {}
) {
  return input({
    offer: baseOffer({
      benefit: { kind: "percentage_goods", paramsVersion: 1, rate, capAmount },
    }),
    ...overrides,
  });
}

describe("evaluateOfferEligibility — percentage goods", () => {
  it("subtotal450000 rate10 cap20000 memberi benefitAmount20000 (cap sekali per order)", () => {
    expect(evaluateOfferEligibility(percentageOffer("10", "20000", { subtotalAfterMarkdown: "450000" }))).toEqual({
      eligible: true,
      reason: null,
      benefitAmount: "20000",
    });
  });

  it("subtotal450000 rate10 tanpa cap memberi benefitAmount45000", () => {
    expect(evaluateOfferEligibility(percentageOffer("10", null, { subtotalAfterMarkdown: "450000" }))).toEqual({
      eligible: true,
      reason: null,
      benefitAmount: "45000",
    });
  });

  it("rate10 atas100005 dibulatkan floor menjadi10000", () => {
    expect(evaluateOfferEligibility(percentageOffer("10", null, { subtotalAfterMarkdown: "100005" }))).toEqual({
      eligible: true,
      reason: null,
      benefitAmount: "10000",
    });
  });

  it("subtotal50 rate1 menghasilkan benefit0 sehingga tidak eligible/tanpa usage", () => {
    expect(evaluateOfferEligibility(percentageOffer("1", null, { subtotalAfterMarkdown: "50" })).reason).toBe(
      "BENEFIT_UNAVAILABLE"
    );
  });

  it("budget memakai nominal aktual percentage: sisa15000 untuk benefit20000 ditolak", () => {
    const offer = baseOffer({
      benefit: { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "20000" },
      budgetAmount: "15000",
      usage: {
        reservedCount: 0,
        consumedCount: 0,
        reservedAmount: "0",
        consumedAmount: "0",
      },
    });
    expect(
      evaluateOfferEligibility({ now: NOW, verifiedEmail: true, subtotalAfterMarkdown: "450000", offer }).reason
    ).toBe("CAPACITY_UNAVAILABLE");
  });

  it.each([
    ["rate0", { kind: "percentage_goods", paramsVersion: 1, rate: "0", capAmount: null }],
    ["rate di atas100", { kind: "percentage_goods", paramsVersion: 1, rate: "100.5", capAmount: null }],
    ["rate7 digit", { kind: "percentage_goods", paramsVersion: 1, rate: "10.1234567", capAmount: null }],
    ["cap0", { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "0" }],
    ["kind asing", { kind: "free_goods", paramsVersion: 1, fixedAmount: "1000" }],
    ["paramsVersion2", { kind: "percentage_goods", paramsVersion: 2, rate: "10", capAmount: null }],
  ])("konfigurasi benefit %s tidak eligible (bukan default fixed)", (_label, benefit) => {
    const offer = baseOffer({ benefit: benefit as unknown as ReturnType<typeof baseOffer>["benefit"] });
    expect(reasonOf({ offer })).toBe("BENEFIT_UNAVAILABLE");
  });
});

// Ticket 11 — benefit shipping memakai matriks eligibility yang SAMA, tetapi
// hanya delivery dengan ongkir valid positif. Nominal aktual = min(ongkir, cap).
describe("evaluateOfferEligibility — subsidi ongkir", () => {
  const shippingOffer = baseOffer({
    benefit: { kind: "shipping", paramsVersion: 1, capAmount: "20000" },
  });

  it("delivery ongkir30000 cap20000 eligible dengan benefitAmount20000", () => {
    expect(
      evaluateOfferEligibility(
        input({
          offer: shippingOffer,
          fulfillmentMethod: "delivery",
          shippingBeforeSubsidy: "30000",
        })
      )
    ).toEqual({ eligible: true, reason: null, benefitAmount: "20000" });
  });

  it("delivery ongkir12000 cap20000 memberi benefitAmount12000 (sisa hangus)", () => {
    expect(
      evaluateOfferEligibility(
        input({
          offer: shippingOffer,
          fulfillmentMethod: "delivery",
          shippingBeforeSubsidy: "12000",
        })
      ).benefitAmount
    ).toBe("12000");
  });

  it("pickup dan ongkir0 disabled dengan alasan fulfillment, bukan benefitAmount0", () => {
    for (const context of [
      { fulfillmentMethod: "pickup" as const, shippingBeforeSubsidy: "30000" },
      { fulfillmentMethod: "delivery" as const, shippingBeforeSubsidy: "0" },
      { fulfillmentMethod: undefined, shippingBeforeSubsidy: undefined },
    ]) {
      expect(
        reasonOf({ offer: shippingOffer, ...context })
      ).toBe("FULFILLMENT_NOT_ELIGIBLE");
    }
  });

  it("minimum/budget/kapasitas memakai nominal subsidi aktual, bukan cap", () => {
    expect(
      reasonOf({
        offer: baseOffer({
          benefit: { kind: "shipping", paramsVersion: 1, capAmount: "20000" },
          budgetAmount: "11999",
        }),
        fulfillmentMethod: "delivery",
        shippingBeforeSubsidy: "12000",
      })
    ).toBe("CAPACITY_UNAVAILABLE");
    expect(
      evaluateOfferEligibility(
        input({
          offer: baseOffer({
            benefit: { kind: "shipping", paramsVersion: 1, capAmount: "20000" },
            budgetAmount: "12000",
          }),
          fulfillmentMethod: "delivery",
          shippingBeforeSubsidy: "12000",
        })
      ).eligible
    ).toBe(true);
  });
});
