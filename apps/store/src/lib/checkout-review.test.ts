import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCheckoutReviewContextFingerprint,
  createCheckoutReviewToken,
  promoSelectionDigest,
  verifyCheckoutReviewToken,
  type CheckoutReviewContext,
  type CheckoutReviewPromo,
} from "./checkout-review";

process.env.BETTER_AUTH_SECRET = "checkout-review-test-secret-0123456789abcdef";

function context(overrides: Partial<CheckoutReviewContext> = {}): CheckoutReviewContext {
  return {
    clientId: "client-1",
    contactPhone: "08123456789",
    contactEmail: "customer@example.test",
    pickupDate: "2026-10-22",
    pickupTime: "10:00",
    branchId: "branch-1",
    fulfillmentMethod: "pickup",
    promo: { kind: "none" },
    pricing: {
      subtotal: "250000",
      discount: "0",
      taxableBase: "250000",
      shippingBeforeSubsidy: "0",
      shippingSubsidy: "0",
      shippingCost: "0",
      serviceFee: "0",
      ppnRatePercent: "11",
      ppnAmount: "27500",
      total: "277500",
      currency: "IDR",
      pricingContractVersion: 1,
      pricingEngineVersion: 1,
      providerContractVersion: 2,
    },
    lines: [
      {
        cartItemId: "item-a",
        variantId: "variant-a",
        branchId: "branch-1",
        quantity: 1,
        sourceUnitPrice: "150000",
      },
      {
        cartItemId: "item-b",
        variantId: "variant-b",
        branchId: "branch-1",
        quantity: 1,
        sourceUnitPrice: "100000",
      },
    ],
    ...overrides,
  };
}

const PUBLIC_PROMO = {
  kind: "public",
  offerId: "offer-1",
  revisionId: "revision-1",
  benefitId: "benefit-1",
  benefitAmount: "25000",
} as const;

describe("buildCheckoutReviewContextFingerprint — promo binding", () => {
  it("konteks sama menghasilkan fingerprint sama, urutan baris tidak berpengaruh", () => {
    const base = buildCheckoutReviewContextFingerprint(context());
    const reversed = buildCheckoutReviewContextFingerprint(
      context({ lines: [...context().lines].reverse() })
    );
    expect(reversed).toBe(base);
    expect(base).toMatch(/^[a-f0-9]{64}$/);
  });

  it("mengubah Offer/revision/benefit/nominal mengubah fingerprint", () => {
    const none = buildCheckoutReviewContextFingerprint(context());
    const selected = buildCheckoutReviewContextFingerprint(
      context({ promo: PUBLIC_PROMO })
    );
    expect(selected).not.toBe(none);
    for (const overrides of [
      { ...PUBLIC_PROMO, offerId: "offer-2" },
      { ...PUBLIC_PROMO, revisionId: "revision-2" },
      { ...PUBLIC_PROMO, benefitId: "benefit-2" },
      { ...PUBLIC_PROMO, benefitAmount: "20000" },
    ]) {
      expect(
        buildCheckoutReviewContextFingerprint(context({ promo: overrides }))
      ).not.toBe(selected);
    }
  });

  it("token hanya membawa hash/versi/expiry, tanpa PII atau identity promo literal", () => {
    const fp = buildCheckoutReviewContextFingerprint(
      context({ promo: PUBLIC_PROMO })
    );
    const issued = createCheckoutReviewToken({ contextFingerprint: fp, promo: PUBLIC_PROMO });
    expect(verifyCheckoutReviewToken(issued.reviewToken).fingerprint).toBe(fp);
    const payload = Buffer.from(issued.reviewToken.split(".")[0], "base64url").toString("utf8");
    expect(payload).not.toContain("customer@example.test");
    expect(payload).not.toContain("08123456789");
    expect(payload).not.toContain("offer-1");
    expect(JSON.parse(payload)).toEqual({
      v: 1,
      fp,
      p: promoSelectionDigest(PUBLIC_PROMO),
      exp: expect.any(Number),
    });
  });
});

describe("review token — persetujuan penggantian promo (ticket 08)", () => {
  const fingerprint = buildCheckoutReviewContextFingerprint(
    context({ promo: PUBLIC_PROMO })
  );

  function issue(extra: { increase?: boolean; continueWithout?: boolean } = {}) {
    return createCheckoutReviewToken({
      contextFingerprint: fingerprint,
      promo: PUBLIC_PROMO,
      requiresPromoIncreaseAcknowledgement: extra.increase,
      requiresContinueWithoutPromoAcknowledgement: extra.continueWithout,
    });
  }

  function payloadOf(token: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
  }

  it("menandai kenaikan total dan lanjut-tanpa-promo sebagai persyaratan bertanda tangan", () => {
    expect(verifyCheckoutReviewToken(issue().reviewToken)).toEqual({
      fingerprint,
      promoDigest: promoSelectionDigest(PUBLIC_PROMO),
      requiresPromoIncreaseAcknowledgement: false,
      requiresContinueWithoutPromoAcknowledgement: false,
    });
    expect(verifyCheckoutReviewToken(issue({ increase: true }).reviewToken)).toEqual({
      fingerprint,
      promoDigest: promoSelectionDigest(PUBLIC_PROMO),
      requiresPromoIncreaseAcknowledgement: true,
      requiresContinueWithoutPromoAcknowledgement: false,
    });
    expect(verifyCheckoutReviewToken(issue({ continueWithout: true }).reviewToken)).toEqual({
      fingerprint,
      promoDigest: promoSelectionDigest(PUBLIC_PROMO),
      requiresPromoIncreaseAcknowledgement: false,
      requiresContinueWithoutPromoAcknowledgement: true,
    });
  });

  it("flag kenaikan hanya diterima dari payload bertanda tangan, bukan ditambahkan browser", () => {
    const issued = issue();
    const [encoded, signature] = issued.reviewToken.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...payloadOf(issued.reviewToken), inc: 1 }),
      "utf8"
    ).toString("base64url");
    expect(() => verifyCheckoutReviewToken(`${tampered}.${signature}`)).toThrowError(
      /Periksa kembali/
    );
    expect(encoded).not.toBe(tampered);
  });

  it("digest promo mengikat pilihan: Coupon lain / none punya digest berbeda", () => {
    const digests = new Set([
      promoSelectionDigest(PUBLIC_PROMO),
      promoSelectionDigest({ ...PUBLIC_PROMO, offerId: "offer-2" }),
      promoSelectionDigest({ kind: "none" }),
    ]);
    expect(digests.size).toBe(3);
    // Nominal/revisi bukan bagian identitas: keduanya diikat fingerprint konteks.
    const reBenefit: CheckoutReviewPromo = { ...PUBLIC_PROMO, benefitAmount: "20000" };
    expect(promoSelectionDigest(reBenefit)).toBe(promoSelectionDigest(PUBLIC_PROMO));
    for (const digest of digests) expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("dua persyaratan sekaligus tidak pernah ditandatangani", () => {
    expect(() => issue({ increase: true, continueWithout: true })).toThrowError(
      /persyaratan/i
    );
  });
});

describe("verifyCheckoutReviewToken — expiry", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "checkout-review-test-secret-0123456789abcdef";
  });

  it("menolak token kedaluwarsa dan menerima sebelum expiry", () => {
    const fp = buildCheckoutReviewContextFingerprint(context());
    const issued = createCheckoutReviewToken({ contextFingerprint: fp, promo: { kind: "none" } });
    const exp = JSON.parse(
      Buffer.from(issued.reviewToken.split(".")[0], "base64url").toString("utf8")
    ).exp as number;
    expect(
      verifyCheckoutReviewToken(issued.reviewToken, new Date(exp * 1000 - 1)).fingerprint
    ).toBe(fp);
    expect(() =>
      verifyCheckoutReviewToken(issued.reviewToken, new Date(exp * 1000))
    ).toThrowError(/Periksa kembali/);
  });
});
