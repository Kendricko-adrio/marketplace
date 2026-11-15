import { applyOfferBenefitToPricing } from "@/lib/offer-pricing";
import type { PricingSnapshot } from "@/lib/versioned-pricing";
import type { AvailablePromoCandidate, RankedPromoDto } from "./promo-picker-contract";

function compareMoney(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}
export function rankAvailablePromos(input: {
  baseline: PricingSnapshot;
  candidates: readonly AvailablePromoCandidate[];
}): RankedPromoDto[] {
  const ranked = input.candidates.map(({ benefit, ...offer }): RankedPromoDto => {
    if (!offer.eligible) return { ...offer, estimatedSavings: null, estimatedTotal: null, recommended: false };
    if (!benefit) throw new Error("eligible promo is missing its benefit");
    const pricing = applyOfferBenefitToPricing(input.baseline, { benefit, benefitAmount: offer.benefitAmount });
    return { ...offer, estimatedTotal: pricing.total,
      estimatedSavings: (BigInt(input.baseline.total) - BigInt(pricing.total)).toString(), recommended: false };
  });
  ranked.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.eligible) {
      const total = compareMoney(a.estimatedTotal!, b.estimatedTotal!);
      if (total) return total;
      const benefit = compareMoney(b.benefitAmount, a.benefitAmount);
      if (benefit) return benefit;
      const expiry = (a.endsAt ? Date.parse(a.endsAt) : Infinity) - (b.endsAt ? Date.parse(b.endsAt) : Infinity);
      if (expiry && !Number.isNaN(expiry)) return expiry;
    }
    return a.name.localeCompare(b.name, "id") || a.offerId.localeCompare(b.offerId);
  });
  if (ranked[0]?.eligible) ranked[0].recommended = true;
  return ranked;
}
