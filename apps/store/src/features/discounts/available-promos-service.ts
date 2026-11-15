import { db } from "@/db";
import { parseMoney } from "@marketplace/db/src/discount-eligibility";
import { MAX_MONEY_RUPIAH } from "@/lib/versioned-pricing";
import { DiscountAvailabilityError, readAvailablePromoCandidates } from "@/lib/discount-availability";
import { rankAvailablePromos } from "./promo-ranking";
import type { PromoPageRequest, PromoPageResult } from "./promo-picker-contract";

export async function readAvailablePromoPage(
  input: PromoPageRequest & { clientId: string; now?: Date },
  database: typeof db = db
): Promise<PromoPageResult> {
  if (!Number.isSafeInteger(input.page) || input.page < 1) {
    throw new DiscountAvailabilityError("INPUT_INVALID", "Halaman promo tidak valid.");
  }
  if (input.fulfillment.fulfillmentMethod === "delivery") {
    const shipping = parseMoney(input.fulfillment.shippingBeforeSubsidy ?? "0");
    if (shipping === null || shipping > MAX_MONEY_RUPIAH) {
      throw new DiscountAvailabilityError("INPUT_INVALID", "Ongkir promo tidak valid.");
    }
  }
  const { baseline, candidates } = await readAvailablePromoCandidates(input, database);
  const ranked = rankAvailablePromos({ baseline, candidates });
  const totalPages = Math.ceil(ranked.length / 10);
  const page = Math.min(input.page, Math.max(1, totalPages));
  const selectedOffer = ranked.find(o => o.offerId === input.selectedOfferId) ?? null;
  return {
    items: ranked.slice((page - 1) * 10, page * 10),
    page, pageSize: 10, totalItems: ranked.length, totalPages, selectedOffer,
    selectedOfferUnavailable: Boolean(input.selectedOfferId && !selectedOffer),
  };
}
