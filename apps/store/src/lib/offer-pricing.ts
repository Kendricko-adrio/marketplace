/**
 * Satu tempat menerapkan pilihan Offer (goods ATAU shipping) ke baseline
 * pricing delivery/pickup yang sudah dibangun dari sumber authoritative.
 *
 * Dipakai preview dan place-order supaya:
 * - bentuk benefit asli (fixed/percentage/shipping) yang dihitung, bukan nominal
 *   yang sudah dibulatkan (rate/cap tidak hilang);
 * - nominal yang direservasi (candidate.benefitAmount) WAJIB sama dengan
 *   komponen snapshot yang benar: `goodsDiscount` untuk goods, `shippingSubsidy`
 *   untuk subsidi ongkir. Selisih sekecil apa pun menggagalkan permintaan.
 *
 * Pure: tanpa DB/HTTP/config, tanpa mutasi. Baseline tidak boleh sudah membawa
 * diskon/subsidi (evaluatePricing menolak subsidi kedua).
 */
import {
  evaluatePricing,
  type OfferBenefitInput,
} from "@marketplace/db/src/discount-pricing";
import type { PricingSnapshot } from "./versioned-pricing";

export interface OfferBenefitCandidate {
  benefit: OfferBenefitInput;
  benefitAmount: string;
}

export function applyOfferBenefitToPricing(
  baseline: PricingSnapshot,
  candidate: OfferBenefitCandidate
): PricingSnapshot {
  const snapshot = evaluatePricing({
    fulfillmentMethod: baseline.fulfillmentMethod,
    ppnRatePercent: baseline.ppnRatePercent,
    lines: baseline.lines.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      sourceUnitPrice: line.sourceUnitPrice,
      effectiveUnitPrice: line.effectiveUnitPrice,
      markdownRevisionId: line.markdownRevisionId,
    })),
    shippingBeforeSubsidy: baseline.shippingBeforeSubsidy,
    providerQuotedShippingCost: baseline.providerQuotedShippingCost,
    // Tax context provider3 HARUS ikut: rebuild benefit tidak boleh menjatuhkan
    // payable provider ke kontrak provider2 (PPN hilang dari SO/invoice).
    providerTax:
      baseline.providerContractVersion === 3 ? baseline.providerTax : undefined,
    benefit: candidate.benefit,
  });
  const actual =
    candidate.benefit.kind === "shipping"
      ? snapshot.shippingSubsidy
      : snapshot.goodsDiscount;
  if (actual !== candidate.benefitAmount) {
    throw new Error(
      "promo benefit amount disagrees with the authoritative pricing snapshot"
    );
  }
  return snapshot;
}
