import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCheckoutReviewContextFingerprint,
  createCheckoutReviewToken,
  verifyCheckoutReviewToken,
  type CheckoutReviewContext,
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
    const issued = createCheckoutReviewToken({ contextFingerprint: fp });
    expect(verifyCheckoutReviewToken(issued.reviewToken)).toBe(fp);
    const payload = Buffer.from(issued.reviewToken.split(".")[0], "base64url").toString("utf8");
    expect(payload).not.toContain("customer@example.test");
    expect(payload).not.toContain("08123456789");
    expect(payload).not.toContain("offer-1");
    expect(JSON.parse(payload)).toEqual({
      v: 1,
      fp,
      exp: expect.any(Number),
    });
  });
});

describe("verifyCheckoutReviewToken — expiry", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "checkout-review-test-secret-0123456789abcdef";
  });

  it("menolak token kedaluwarsa dan menerima sebelum expiry", () => {
    const fp = buildCheckoutReviewContextFingerprint(context());
    const issued = createCheckoutReviewToken({ contextFingerprint: fp });
    const exp = JSON.parse(
      Buffer.from(issued.reviewToken.split(".")[0], "base64url").toString("utf8")
    ).exp as number;
    expect(verifyCheckoutReviewToken(issued.reviewToken, new Date(exp * 1000 - 1))).toBe(fp);
    expect(() =>
      verifyCheckoutReviewToken(issued.reviewToken, new Date(exp * 1000))
    ).toThrowError(/Periksa kembali/);
  });
});
