/**
 * Seam L — perbandingan penggantian promo dan persetujuan terikat kandidat
 * (ticket 08). Expected money adalah literal independen dari spec §4.4/§5.1,
 * bukan hasil memanggil engine yang diuji:
 *
 *   barang 150000, PPN 11% atas net barang
 *   benefit 25000 → net 125000, PPN 13750, total 138750
 *   benefit 10000 → net 140000, PPN 15400, total 155400
 *   selisih total   = 155400 - 138750 = +16650
 *   selisih diskon  = 10000 - 25000  = -15000 (diskon mengecil)
 */
import { describe, expect, it } from "vitest";
import {
  comparePromoReplacement,
  evaluatePromoAcknowledgements,
  type PromoPricingView,
} from "./promo-replacement";
import type { CheckoutReviewPromo } from "./checkout-review";

const PROMO_25: CheckoutReviewPromo = {
  kind: "public",
  offerId: "offer-25",
  revisionId: "revision-25",
  benefitId: "benefit-25",
  benefitAmount: "25000",
};
const PROMO_10: CheckoutReviewPromo = {
  kind: "public",
  offerId: "offer-10",
  revisionId: "revision-10",
  benefitId: "benefit-10",
  benefitAmount: "10000",
};
const NO_PROMO: CheckoutReviewPromo = { kind: "none" };

function view(
  promo: CheckoutReviewPromo,
  total: string,
  discount: string
): PromoPricingView {
  return { promo, total, discount };
}

const OLD = view(PROMO_25, "138750", "25000");
const LOWER_BENEFIT = view(PROMO_10, "155400", "10000");
const NO_DISCOUNT = view(NO_PROMO, "166500", "0");

describe("comparePromoReplacement — total final, bukan nominal benefit", () => {
  it("benefit 25000 → 10000 menaikkan total final 138750 → 155400", () => {
    const result = comparePromoReplacement(OLD, LOWER_BENEFIT);
    expect(result).toEqual({
      direction: "increase",
      previousTotal: "138750",
      candidateTotal: "155400",
      deltaTotal: "16650",
      previousDiscount: "25000",
      candidateDiscount: "10000",
      deltaDiscount: "-15000",
    });
  });

  it("benefit 10000 → 25000 menurunkan total final dan langsung diganti", () => {
    const result = comparePromoReplacement(LOWER_BENEFIT, OLD);
    expect(result.direction).toBe("decrease");
    expect(result.deltaTotal).toBe("-16650");
    expect(result.deltaDiscount).toBe("15000");
  });

  it("nominal benefit sama di Offer berbeda adalah total sama, bukan kenaikan", () => {
    const sameBenefitOtherOffer = view(
      { ...PROMO_25, offerId: "offer-25-other", revisionId: "revision-other" },
      "138750",
      "25000"
    );
    const result = comparePromoReplacement(OLD, sameBenefitOtherOffer);
    expect(result.direction).toBe("same");
    expect(result.deltaTotal).toBe("0");
    expect(result.deltaDiscount).toBe("0");
  });

  it("promo dimatikan (none) dibanding Coupon: kenaikan total terlihat", () => {
    const result = comparePromoReplacement(OLD, NO_DISCOUNT);
    expect(result.direction).toBe("increase");
    expect(result.previousTotal).toBe("138750");
    expect(result.candidateTotal).toBe("166500");
    expect(result.deltaTotal).toBe("27750");
  });

  it("total bukan angka valid ditolak, tidak diam-diam dianggap 0", () => {
    expect(() =>
      comparePromoReplacement(OLD, view(PROMO_10, "155.400,00", "10000"))
    ).toThrowError(/total/i);
    expect(() =>
      comparePromoReplacement(view(PROMO_25, "138750", "-25000"), LOWER_BENEFIT)
    ).toThrowError(/diskon/i);
  });
});

describe("evaluatePromoAcknowledgements — terikat candidate fingerprint", () => {
  const candidate = "a".repeat(64);
  const otherAccountToken = "b".repeat(64);

  it("tanpa persyaratan: tidak ada acknowledgement yang diminta", () => {
    expect(
      evaluatePromoAcknowledgements({
        candidateFingerprint: candidate,
        requirement: "none",
      })
    ).toEqual({ ok: true });
  });

  it("kenaikan total wajib diakui dengan fingerprint kandidat yang sama", () => {
    expect(
      evaluatePromoAcknowledgements({
        candidateFingerprint: candidate,
        requirement: "promo_increase",
        acknowledgements: { promoIncrease: { candidateFingerprint: candidate } },
      })
    ).toEqual({ ok: true });
  });

  it("acknowledgement hilang, beda kandidat, atau boolean bebas tidak diterima", () => {
    for (const acknowledgements of [
      undefined,
      {},
      { promoIncrease: { candidateFingerprint: otherAccountToken } },
      { promoIncrease: { candidateFingerprint: "" } },
      { continueWithoutPromo: { candidateFingerprint: candidate } },
    ] as const) {
      expect(
        evaluatePromoAcknowledgements({
          candidateFingerprint: candidate,
          requirement: "promo_increase",
          acknowledgements,
        })
      ).toEqual({ ok: false, missing: "promo_increase" });
    }
  });

  it("lanjut tanpa promo wajib diakui dengan fingerprint kandidat yang sama", () => {
    expect(
      evaluatePromoAcknowledgements({
        candidateFingerprint: candidate,
        requirement: "continue_without_promo",
        acknowledgements: {
          continueWithoutPromo: { candidateFingerprint: candidate },
        },
      })
    ).toEqual({ ok: true });
    expect(
      evaluatePromoAcknowledgements({
        candidateFingerprint: candidate,
        requirement: "continue_without_promo",
        acknowledgements: { promoIncrease: { candidateFingerprint: candidate } },
      })
    ).toEqual({ ok: false, missing: "continue_without_promo" });
  });
});
