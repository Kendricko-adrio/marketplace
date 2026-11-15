import { evaluateSelectedManualCode, evaluateSelectedPublicOffer, mapOfferReasonToHttp, offerReasonMessage } from "@/lib/discount-selection";
import { applyOfferBenefitToPricing } from "@/lib/offer-pricing";
import type { PricingSnapshot } from "@/lib/versioned-pricing";
import type { CheckoutReviewPromo } from "@/lib/checkout-review";

export interface PlaceOrderPromoInput {
  selection: { kind: "public"; offerId: string } | { kind: "manual"; code: string };
  clientId: string;
  verifiedEmail: boolean;
  pricingSnapshot: PricingSnapshot;
  fulfillmentMethod: "pickup" | "delivery";
  shippingBeforeSubsidy?: string;
}

export async function evaluatePromoSelection({ selection, clientId, verifiedEmail, pricingSnapshot, fulfillmentMethod, shippingBeforeSubsidy }: PlaceOrderPromoInput) {
  const context = {
    clientId, verifiedEmail, subtotalAfterMarkdown: pricingSnapshot.subtotal,
    ...(fulfillmentMethod === "delivery" ? { fulfillmentMethod, shippingBeforeSubsidy } : {}),
  };
  const evaluation = selection.kind === "manual"
    ? await evaluateSelectedManualCode({ code: selection.code, ...context })
    : await evaluateSelectedPublicOffer({ offerId: selection.offerId, ...context });
  if (!evaluation.ok) return {
    ok: false as const, reason: evaluation.reason,
    mapped: mapOfferReasonToHttp(evaluation.reason), message: offerReasonMessage(evaluation.reason),
  };
  const candidate = evaluation.candidate;
  const finalSnapshot = applyOfferBenefitToPricing(pricingSnapshot, candidate);
  const promo: CheckoutReviewPromo = candidate.activationKind === "manual_only" && candidate.codeId
    ? { kind: "manual", offerId: candidate.offerId, codeId: candidate.codeId,
        revisionId: candidate.revisionId, benefitId: candidate.benefitId, benefitAmount: candidate.benefitAmount }
    : { kind: "public", offerId: candidate.offerId, revisionId: candidate.revisionId,
        benefitId: candidate.benefitId, benefitAmount: candidate.benefitAmount };
  return { ok: true as const, candidate, promo, pricingSnapshot: finalSnapshot };
}
