import type { AvailableOfferDto, AvailableOfferFulfillmentContext } from "@/lib/discount-availability";
import type { OfferBenefitInput } from "@marketplace/db/src/discount-pricing";

export type PromoDraft =
  | { kind: "none" }
  | { kind: "public"; offerId: string }
  | { kind: "manual"; code: string };

export interface AvailablePromoCandidate extends AvailableOfferDto {
  benefit: OfferBenefitInput | null;
}
export interface RankedPromoDto extends AvailableOfferDto {
  estimatedSavings: string | null;
  estimatedTotal: string | null;
  recommended: boolean;
}
export interface PromoPageRequest {
  selectedItemIds: readonly string[];
  fulfillment: AvailableOfferFulfillmentContext;
  page: number;
  selectedOfferId?: string;
}
export interface PromoPageResult {
  items: RankedPromoDto[];
  page: number;
  pageSize: 10;
  totalItems: number;
  totalPages: number;
  selectedOffer: AvailableOfferDto | null;
  selectedOfferUnavailable: boolean;
}
export type PromoCandidateResult =
  | { kind: "ready"; name: string; benefitAmount: string }
  | { kind: "increase_confirmation"; previousTotal: string; candidateTotal: string; deltaTotal: string }
  | { kind: "error" | "context_changed"; message: string };
