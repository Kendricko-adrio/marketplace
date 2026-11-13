import { describe, expect, it } from "vitest";
import { buildPricingSnapshot } from "@/lib/versioned-pricing";
import { rankAvailablePromos } from "./promo-ranking";
import type { AvailablePromoCandidate } from "./promo-picker-contract";

const baseline = buildPricingSnapshot({
  fulfillmentMethod: "delivery", ppnRatePercent: "11",
  lines: [{ variantId: "v", quantity: 1, sourceUnitPrice: "100000", effectiveUnitPrice: "100000" }],
  shippingBeforeSubsidy: "16000",
});
function candidate(id: string, kind: "fixed_goods" | "shipping", amount: string): AvailablePromoCandidate {
  return { offerId: id, name: id, eligible: true, benefitAmount: amount, benefitKind: kind,
    rate: null, capAmount: kind === "shipping" ? amount : null, minSubtotal: "0", endsAt: null,
    reason: null, reasonMessage: null,
    benefit: kind === "shipping" ? { kind, paramsVersion: 1, capAmount: amount } : { kind, paramsVersion: 1, fixedAmount: amount } };
}
describe("rankAvailablePromos", () => {
  it("ranks capped percentage by actual benefit and leaves ineligible offers last", () => {
    const percent = { ...candidate("percent", "fixed_goods", "20000"),
      benefitKind: "percentage_goods" as const, rate: "20", capAmount: "50000",
      benefit: { kind: "percentage_goods" as const, paramsVersion: 1 as const, rate: "20", capAmount: "50000" } };
    const blocked = { ...candidate("aaa", "fixed_goods", "0"), eligible: false, benefit: null };
    const ranked = rankAvailablePromos({ baseline, candidates: [blocked, candidate("goods", "fixed_goods", "10000"), percent] });
    expect(ranked.map(o => o.offerId)).toEqual(["percent", "goods", "aaa"]);
    expect(ranked[0]).toMatchObject({ benefitAmount: "20000", estimatedTotal: "104800", estimatedSavings: "22200" });
    expect(ranked[2]).toMatchObject({ estimatedTotal: null, recommended: false });
  });
  it("keeps deterministic expiry/name/ID ties without mutating input", () => {
    const a = { ...candidate("a", "fixed_goods", "10000"), endsAt: "2027-01-02T00:00:00Z" };
    const b = { ...candidate("b", "fixed_goods", "10000"), endsAt: "2027-01-01T00:00:00Z" };
    const input = [a, b];
    expect(rankAvailablePromos({ baseline, candidates: input }).map(o => o.offerId)).toEqual(["b", "a"]);
    expect(input.map(o => o.offerId)).toEqual(["a", "b"]);
  });
  it("prioritizes total savings including PPN, not the larger nominal shipping benefit", () => {
    const ranked = rankAvailablePromos({ baseline, candidates: [candidate("shipping", "shipping", "11000"), candidate("goods", "fixed_goods", "10000")] });
    expect(ranked.map(o => [o.offerId, o.estimatedTotal, o.estimatedSavings, o.recommended])).toEqual([
      ["goods", "115900", "11100", true], ["shipping", "116000", "11000", false],
    ]);
    expect(ranked[0]).not.toHaveProperty("benefit");
  });
});
