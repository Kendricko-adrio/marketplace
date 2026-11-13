import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPricingSnapshot } from "@/lib/versioned-pricing";
import type { PublicOfferCandidate } from "@/lib/discount-selection";
import { evaluatePromoSelection } from "./place-order-promo";
const mocks = vi.hoisted(() => ({ publicOffer: vi.fn(), manualCode: vi.fn() }));
vi.mock("@/lib/discount-selection", async (original) => ({
  ...await original<typeof import("@/lib/discount-selection")>(), evaluateSelectedPublicOffer: mocks.publicOffer, evaluateSelectedManualCode: mocks.manualCode,
}));
const candidate: PublicOfferCandidate = { offerId: "offer", offerName: "Offer", activationKind: "public", codeId: null, revisionId: "revision", benefitId: "benefit", policyVersion: 1,
  benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "200" }, benefitAmount: "200", minSubtotal: "0", startAt: null, endAt: null };
const baseline = (delivery = false) => buildPricingSnapshot({ fulfillmentMethod: delivery ? "delivery" : "pickup", ppnRatePercent: 11,
  providerTax: { taxId: -2, ratePercent: "11" }, shippingBeforeSubsidy: delivery ? "500" : undefined,
  lines: [{ variantId: "variant", quantity: 2, sourceUnitPrice: "1000", effectiveUnitPrice: "1000", markdownRevisionId: null }] });
beforeEach(() => { mocks.publicOffer.mockReset(); mocks.manualCode.mockReset(); });
describe("place-order single-slot promo evaluation", () => {
  it("keeps pickup eligibility parameters omitted and returns public identity plus final pricing", async () => {
    mocks.publicOffer.mockResolvedValue({ ok: true, candidate });
    const result = await evaluatePromoSelection({ selection: { kind: "public", offerId: "offer" }, clientId: "client", verifiedEmail: true, pricingSnapshot: baseline(), fulfillmentMethod: "pickup" });
    expect(mocks.publicOffer).toHaveBeenCalledWith({ offerId: "offer", clientId: "client", verifiedEmail: true, subtotalAfterMarkdown: "2000" });
    expect(result).toMatchObject({ ok: true, candidate, promo: { kind: "public", offerId: "offer", revisionId: "revision", benefitId: "benefit", benefitAmount: "200" }, pricingSnapshot: { goodsDiscount: "200", total: "1998" } });
  });
  it("keeps manual identity and original shipping context for delivery", async () => {
    mocks.manualCode.mockResolvedValue({ ok: true, candidate: { ...candidate, activationKind: "manual_only", codeId: "code" } });
    const result = await evaluatePromoSelection({ selection: { kind: "manual", code: "SAVE" }, clientId: "client", verifiedEmail: true, pricingSnapshot: baseline(true), fulfillmentMethod: "delivery", shippingBeforeSubsidy: "500" });
    expect(mocks.manualCode).toHaveBeenCalledWith({ code: "SAVE", clientId: "client", verifiedEmail: true, subtotalAfterMarkdown: "2000", fulfillmentMethod: "delivery", shippingBeforeSubsidy: "500" });
    expect(result).toMatchObject({ ok: true, promo: { kind: "manual", codeId: "code" }, pricingSnapshot: { total: "2498", goodsDiscount: "200" } });
  });
  it("does not turn eligibility rejection into a quote exception", async () => {
    mocks.publicOffer.mockResolvedValue({ ok: false, reason: "OFFER_UNAVAILABLE", message: "Unused provider copy" });
    expect(await evaluatePromoSelection({ selection: { kind: "public", offerId: "offer" }, clientId: "client", verifiedEmail: false, pricingSnapshot: baseline(), fulfillmentMethod: "pickup" })).toEqual({ ok: false, reason: "OFFER_UNAVAILABLE", mapped: { code: "PROMO_UNAVAILABLE", status: 409 }, message: "Promo ini sedang tidak tersedia." });
  });
});
