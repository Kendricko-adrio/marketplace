import {
  MAX_MONEY_RUPIAH,
  buildPricingSnapshot,
} from "@marketplace/db/src/versioned-pricing";
import {
  evaluatePricing,
  offerBenefitAmount,
  parseOfferBenefit,
  type OfferBenefitInput,
} from "@marketplace/db/src/discount-pricing";
import type { DiscountDraftConfiguration } from "@marketplace/db/src/discount-draft";
import {
  DiscountAdministrationError,
  readPpnRatePercent,
  requireActiveContract,
  toBreakdown,
  type SimulateDiscountOfferInput,
  type SimulateDiscountOfferResult,
} from "@/lib/discounts-administration";
import { createModuleLogger } from "@/lib/logger";
import { withLockedDiscountConfiguration } from "./discount-configuration-repository";

const log = createModuleLogger("discount-configuration-simulate");

/** Benefit snapshot -> bentuk pricing versioned; null bila snapshot belum lengkap. */
function benefitFromConfiguration(
  configuration: DiscountDraftConfiguration
): OfferBenefitInput | null {
  const benefit = configuration.benefit;
  if (!benefit) return null;
  if (benefit.kind === "fixed_goods") {
    if (benefit.fixedAmount === null) return null;
    return { kind: "fixed_goods", paramsVersion: 1, fixedAmount: benefit.fixedAmount };
  }
  if (benefit.kind === "shipping") {
    if (benefit.capAmount === null) return null;
    return { kind: "shipping", paramsVersion: 1, capAmount: benefit.capAmount };
  }
  if (benefit.rate === null) return null;
  return {
    kind: "percentage_goods",
    paramsVersion: 1,
    rate: benefit.rate,
    capAmount: benefit.capAmount,
  };
}

/**
 * Simulasi memakai SATU versi draft tersimpan yang eksplisit (`expectedDraftVersion`),
 * bukan state browser dan bukan live. Tidak ada hold, order, atau janji kuota.
 * Draft yang belum lengkap diarahkan ke field terkait, bukan diam-diam memakai
 * nilai live lama.
 */
export async function simulateDiscountConfiguration(
  input: SimulateDiscountOfferInput,
  actorUserId: string,
): Promise<SimulateDiscountOfferResult> {
  try {
    await requireActiveContract();
    if (input.fulfillmentMethod !== "pickup" && input.fulfillmentMethod !== "delivery") {
      throw new DiscountAdministrationError(400, "INPUT_INVALID", "Pilih metode pengiriman");
    }
    const result = await withLockedDiscountConfiguration(
      { offerId: input.offerId, actorUserId },
      async (session) => {
        const detail = session.detail;
        if (detail.draftVersion !== input.expectedDraftVersion) {
          throw new DiscountAdministrationError(
            409,
            "STALE_REVISION",
            "Draft berubah sejak dimuat. Simpan dan muat versi terbaru sebelum simulasi.",
          );
        }
        const configuration = detail.draftConfiguration;
        const benefit = benefitFromConfiguration(configuration);
        const issues: { path: string; message: string }[] = [];
        if (!benefit) issues.push({ path: "benefit", message: "Pilih jenis potongan dan isi parameternya" });
        if (configuration.minSubtotal === null) {
          issues.push({ path: "minSubtotal", message: "Isi minimum belanja" });
        }
        if (issues.length || !benefit) {
          throw new DiscountAdministrationError(
            409,
            "OFFER_NOT_PUBLISHABLE",
            "Lengkapi konfigurasi sebelum simulasi",
            issues,
          );
        }
        const minSubtotal = configuration.minSubtotal;
        if (minSubtotal === null) {
          throw new DiscountAdministrationError(
            409,
            "OFFER_NOT_PUBLISHABLE",
            "Isi minimum belanja",
            [{ path: "minSubtotal", message: "Isi minimum belanja" }],
          );
        }
        const parsedBenefit = parseOfferBenefit(benefit);
        const shipping =
          input.fulfillmentMethod === "pickup" ? "0" : (input.shippingCost ?? "0").toString();
        if (BigInt(shipping) > MAX_MONEY_RUPIAH) {
          throw new DiscountAdministrationError(400, "INPUT_INVALID", "Ongkir melebihi batas nominal");
        }
        const ppnRatePercent = await readPpnRatePercent();
        const pricingLines = input.lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          sourceUnitPrice: line.unitPrice,
          effectiveUnitPrice: line.unitPrice,
          markdownRevisionId: null,
        }));
        const baseline = buildPricingSnapshot({
          fulfillmentMethod: input.fulfillmentMethod,
          ppnRatePercent,
          lines: pricingLines,
          shippingBeforeSubsidy: shipping,
          providerQuotedShippingCost: shipping,
        });
        const minSubtotalText = minSubtotal;
        const subtotal = BigInt(baseline.subtotal);
        const minimumMet = subtotal >= BigInt(minSubtotalText);
        let benefitAmount = BigInt(0);
        try {
          benefitAmount = offerBenefitAmount(parsedBenefit, {
            subtotal,
            fulfillmentMethod: input.fulfillmentMethod,
            shippingBeforeSubsidy: shipping,
          });
        } catch {
          benefitAmount = BigInt(0);
        }
        const eligible = minimumMet && benefitAmount > BigInt(0);
        const snapshot = eligible
          ? evaluatePricing({
              fulfillmentMethod: input.fulfillmentMethod,
              ppnRatePercent,
              lines: pricingLines,
              shippingBeforeSubsidy: shipping,
              providerQuotedShippingCost: shipping,
              benefit,
            })
          : baseline;
        return {
          simulation: true as const,
          offerId: detail.id,
          draftRevisionId: detail.draftRevision?.id ?? "",
          draftVersion: detail.draftVersion,
          benefit,
          applied: eligible,
          eligible,
          minSubtotal: minSubtotalText,
          breakdown: toBreakdown(snapshot),
          notice:
            "Simulasi admin: bukan quote, bukan order, tidak menahan stok atau kapasitas, dan tidak menjanjikan ketersediaan kuota/budget.",
        };
      },
    );
    log.info(
      `Simulasi konfigurasi diskon ${result.offerId} dihitung dari draftVersion ${result.draftVersion}`,
    );
    return result;
  } catch (error) {
    const code = error instanceof DiscountAdministrationError ? error.code : "UNEXPECTED";
    log.error(`Simulasi konfigurasi diskon gagal (${code})`);
    throw error;
  }
}

export { benefitFromConfiguration };
