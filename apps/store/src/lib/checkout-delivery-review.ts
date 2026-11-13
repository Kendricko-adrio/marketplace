import { z } from "zod";
import { and, eq, inArray, asc } from "drizzle-orm";
import { db, carts, cartItems, clients } from "@/db";
import { clientAddressInputSchema } from "./client-addresses";
import { loadOwnedQuoteCartItems, loadQuoteOriginBranch, loadRevalidatedDestination, loadRevalidatedNewDestination, loadShipmentParcelConfig, DeliveryQuoteDataError } from "./delivery-quote-data";
import { getPpnRatePercent } from "./config";
import { quoteDelivery, QuoteDeliveryError } from "./delivery-quote";
import { createJubelioShipmentGateway } from "./jubelio-shipment-client";
import { buildShipmentParcel } from "./shipment-parcel";
import { createDeliverySnapshot } from "./delivery-order";
import { buildPricingSnapshot, type PricingSnapshot } from "./versioned-pricing";
import {
  buildCheckoutReviewContextFingerprint,
  createCheckoutReviewToken,
  promoSelectionDigest,
  verifyCheckoutReviewToken,
  CheckoutReviewRequiredError,
  type CheckoutReviewPricing,
  type CheckoutReviewPromo,
} from "./checkout-review";
import {
  evaluateSelectedManualCode,
  evaluateSelectedOffer,
  evaluateSelectedPublicOffer,
  mapOfferReasonToHttp,
  offerReasonMessage,
} from "./discount-selection";
import {
  comparePromoReplacement,
  promoSelectionOf,
  type PromoReplacementState,
} from "./promo-replacement";
import { applyOfferBenefitToPricing } from "./offer-pricing";
import type { OfferEligibilityReason } from "@marketplace/db/src/discount-eligibility";
import type { ValidatedProviderTax } from "@marketplace/db/src/provider-tax";

/**
 * Gagal promo pada review delivery. Status/code/notifikasi aman dipetakan route
 * tanpa membocorkan kode/Offer lain.
 */
export class DeliveryPreviewPromoError extends Error {
  constructor(
    readonly status: 403 | 409,
    readonly code:
      | "PROMO_UNAVAILABLE"
      | "PROMO_INELIGIBLE"
      | "PROMO_CAPACITY_UNAVAILABLE"
      | "EMAIL_VERIFICATION_REQUIRED",
    readonly safeMessage: string,
    readonly data?: Record<string, unknown>
  ) {
    super(safeMessage);
    this.name = "DeliveryPreviewPromoError";
  }
}

const promoSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("public"),
    offerId: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("manual"),
    code: z.string().min(1).max(128),
  }),
]);

const previousSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("public"),
    offerId: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("manual"),
    offerId: z.string().min(1).max(128),
    codeId: z.string().min(1).max(128),
  }),
]);

const previousReviewSchema = z.strictObject({
  reviewToken: z.string().min(1).max(2048),
  promoSelection: previousSelectionSchema,
});

const base = z.object({
  fulfillmentMethod: z.literal("delivery"),
  itemIds: z.array(z.string().min(1).max(128)).min(1).max(50)
    .refine((ids) => new Set(ids).size === ids.length),
  contactPhone: z.string().min(8).max(20), contactEmail: z.string().email(),
  courierId: z.number().int(), serviceId: z.number().int(),
  originFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  approvedPricing: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** Satu slot yang sama dengan pickup: none, satu Coupon, atau satu kode. */
  promoSelection: promoSelectionSchema,
  /** Penggantian/invalidation (ticket 08) juga berlaku untuk delivery. */
  previous: previousReviewSchema.optional(),
  acknowledgeInvalidation: z.boolean().optional(),
});
export const deliveryReviewSchema = z.union([
  base.extend({ addressId: z.string().min(1).max(128) }).strict(),
  base.extend({ newAddress: clientAddressInputSchema, saveAddress: z.boolean(), saveRequestId: z.string().uuid() }).strict(),
]).refine((value) => value.acknowledgeInvalidation !== true || value.previous != null, {
  message: "acknowledgeInvalidation requires the previous review",
  path: ["acknowledgeInvalidation"],
});

function reviewPricingOf(value: PricingSnapshot): CheckoutReviewPricing {
  return {
    subtotal: value.subtotal,
    discount: value.goodsDiscount,
    taxableBase: value.taxableBase,
    shippingBeforeSubsidy: value.shippingBeforeSubsidy,
    shippingSubsidy: value.shippingSubsidy,
    shippingCost: value.shippingCost,
    serviceFee: value.serviceFee,
    ppnRatePercent: value.ppnRatePercent,
    ppnAmount: value.ppnAmount,
    total: value.total,
    currency: value.currency,
    pricingContractVersion: value.pricingContractVersion,
    pricingEngineVersion: value.pricingEngineVersion,
    providerContractVersion: value.providerContractVersion,
    providerTax: value.providerContractVersion === 3 ? value.providerTax : null,
  };
}

/**
 * Proyeksi HTTP untuk browser: identitas tax provider hanya milik fingerprint
 * server-side, bukan payload customer. Tanpa strip ini, `approvedPricing` yang
 * dikirim balik browser ditolak schema money (spec §5.5: browser tidak menerima
 * tax id internal).
 */
function publicPricingOf(
  value: CheckoutReviewPricing
): Omit<CheckoutReviewPricing, "providerTax"> {
  const { providerTax: _internalTax, ...publicPricing } = value;
  void _internalTax;
  return publicPricing;
}

function promoOf(candidate: {
  activationKind: "public" | "manual_only";
  codeId: string | null;
  offerId: string;
  revisionId: string;
  benefitId: string;
  benefitAmount: string;
}): CheckoutReviewPromo {
  return candidate.activationKind === "manual_only" && candidate.codeId
    ? {
        kind: "manual",
        offerId: candidate.offerId,
        codeId: candidate.codeId,
        revisionId: candidate.revisionId,
        benefitId: candidate.benefitId,
        benefitAmount: candidate.benefitAmount,
      }
    : {
        kind: "public",
        offerId: candidate.offerId,
        revisionId: candidate.revisionId,
        benefitId: candidate.benefitId,
        benefitAmount: candidate.benefitAmount,
      };
}

/**
 * Preview delivery (read/rates-only). Tidak membuat order/hold/address/intent.
 *
 * Sejak ticket 11, satu slot promo yang sama dengan pickup dipakai untuk
 * delivery: Coupon publik/manual dengan benefit goods ATAU shipping.
 * Ongkir quote/booking tetap ORIGINAL (`service.shippingCost`); pricing serta
 * snapshot menyimpan subsidi dan ongkir net customer secara terpisah.
 */
export async function previewDeliveryReview(
  clientId: string,
  input: z.infer<typeof deliveryReviewSchema>,
  providerTax?: ValidatedProviderTax
) {
  const loaded = await loadOwnedQuoteCartItems(clientId, input.itemIds);
  const { branchId } = loaded;
  const items = loaded.items.map((item) => {
    if (!item.variantId) throw new DeliveryQuoteDataError("INVALID_INPUT", "Variant tidak tersedia.");
    return { ...item, variantId: item.variantId };
  });
  items.sort((a, b) => a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0);
  // Preflight pajak (config + master) menentukan rate; fallback config lama
  // hanya untuk pemanggil kompatibilitas tanpa konteks tervalidasi.
  const ppnRatePercent = providerTax?.ratePercent ?? (await getPpnRatePercent());
  // Source bounds sebelum region/rates HTTP.
  const lines = items.map((item) => ({ variantId: item.variantId, quantity: item.quantity,
    sourceUnitPrice: String(item.value),
    effectiveUnitPrice: String(item.effectiveValue ?? item.value),
    markdownRevisionId: item.markdownRevisionId ?? null }));
  buildPricingSnapshot({ fulfillmentMethod: "delivery", ppnRatePercent, lines, providerTax });
  const origin = await loadQuoteOriginBranch(branchId);
  const destination = "addressId" in input ? await loadRevalidatedDestination(clientId, input.addressId)
    : await loadRevalidatedNewDestination(input.newAddress);
  const parcelConfig = await loadShipmentParcelConfig();
  const quote = await quoteDelivery({ pricingContractVersion: 1, branch: origin, items,
    destination: { postalCode: destination.postalCode, areaId: destination.areaId },
    fallback: parcelConfig.fallback, packagingWeight: parcelConfig.packagingWeightGrams, ppnRatePercent,
  }, createJubelioShipmentGateway());
  const chosen = quote.services.find((service) => service.courierId === input.courierId && service.serviceId === input.serviceId);
  if (!chosen || chosen.originFingerprint !== input.originFingerprint) {
    throw new QuoteDeliveryError("INVALID_INPUT", "Layanan pengiriman berubah. Periksa kembali ongkir.");
  }
  const baseline = buildPricingSnapshot({ fulfillmentMethod: "delivery", ppnRatePercent, lines, providerTax,
    // Quote customer sekaligus provider quote cost; booking tetap original.
    shippingBeforeSubsidy: String(chosen.shippingCost), providerQuotedShippingCost: chosen.shippingCost });
  const parcel = buildShipmentParcel({ items: items.map((item) => ({ itemName: item.itemName, quantity: item.quantity,
    value: Number(item.value), dimensions: item.dimensions })), fallback: parcelConfig.fallback,
    packagingWeight: parcelConfig.packagingWeightGrams });
  const deliverySnapshotOf = (pricing: ReturnType<typeof reviewPricingOf>) => createDeliverySnapshot({
    address: { ...destination.canonical, recipientName: destination.recipientName, phone: destination.phone,
      fullAddress: destination.fullAddress },
    origin: { branchId, name: origin.name, phone: origin.shippingPhone, address: origin.shippingAddress,
      zipcode: origin.shippingPostalCode, areaId: origin.shippingAreaId },
    parcel,
    service: { courierId: chosen.courierId, serviceId: chosen.serviceId, name: chosen.name,
      shippingCost: chosen.shippingCost },
    pricing: {
      subtotal: pricing.subtotal, discount: pricing.discount, taxableBase: pricing.taxableBase,
      shippingCost: pricing.shippingCost, serviceFee: pricing.serviceFee,
      ppnRatePercent: pricing.ppnRatePercent, ppnAmount: pricing.ppnAmount, total: pricing.total,
    },
  });
  const selectedRows = await db.select({ cartItemId: cartItems.id, variantId: cartItems.variantId, quantity: cartItems.quantity })
    .from(cartItems).innerJoin(carts, eq(carts.id, cartItems.cartId)).where(and(eq(carts.userId, clientId), inArray(cartItems.id, input.itemIds))).orderBy(asc(cartItems.id));
  if (selectedRows.length !== input.itemIds.length || items.some((item) =>
    !selectedRows.some((row) => row.variantId === item.variantId && row.quantity === item.quantity))) {
    throw new DeliveryQuoteDataError("INVALID_INPUT", "Keranjang berubah. Periksa kembali pesanan.");
  }
  const linesForContext = (snapshot: PricingSnapshot) => snapshot.lines.map((line) => ({
    cartItemId: selectedRows.find((row) => row.variantId === line.variantId)!.cartItemId,
    variantId: line.variantId, branchId, quantity: line.quantity, sourceUnitPrice: line.sourceUnitPrice,
  }));
  const contextFingerprintOf = (snapshot: PricingSnapshot, promo: CheckoutReviewPromo) => {
    const pricing = reviewPricingOf(snapshot);
    return buildCheckoutReviewContextFingerprint({ clientId,
      contactPhone: input.contactPhone, contactEmail: input.contactEmail, branchId,
      fulfillmentMethod: "delivery", pickupDate: null, pickupTime: null,
      deliverySnapshot: deliverySnapshotOf(pricing), promo, pricing, lines: linesForContext(snapshot),
    });
  };

  // ===== Satu slot promo (goods ATAU shipping) ==========================
  let verifiedEmail: boolean | null = null;
  const ensureVerifiedEmail = async (): Promise<boolean> => {
    if (verifiedEmail !== null) return verifiedEmail;
    const [client] = await db.select({ emailVerified: clients.emailVerified }).from(clients)
      .where(eq(clients.id, clientId)).limit(1);
    if (!client) throw new DeliveryQuoteDataError("NOT_FOUND", "Akun tidak ditemukan.");
    verifiedEmail = client.emailVerified;
    return verifiedEmail;
  };
  type PromoEvaluation =
    | { ok: true; snapshot: PricingSnapshot; promo: CheckoutReviewPromo }
    | { ok: false; reason: OfferEligibilityReason; message: string };
  const toEvaluation = (evaluation: Awaited<ReturnType<typeof evaluateSelectedPublicOffer>>): PromoEvaluation => {
    if (!evaluation.ok) {
      return { ok: false, reason: evaluation.reason, message: offerReasonMessage(evaluation.reason) };
    }
    const snapshot = applyOfferBenefitToPricing(baseline, evaluation.candidate);
    return { ok: true, snapshot, promo: promoOf(evaluation.candidate) };
  };
  const evaluateSelection = async (selection: z.infer<typeof promoSelectionSchema>): Promise<PromoEvaluation> => {
    if (selection.kind === "none") return { ok: true, snapshot: baseline, promo: { kind: "none" } };
    const emailVerified = await ensureVerifiedEmail();
    const context = {
      clientId, verifiedEmail: emailVerified, subtotalAfterMarkdown: baseline.subtotal,
      fulfillmentMethod: "delivery" as const, shippingBeforeSubsidy: String(chosen.shippingCost),
    };
    return toEvaluation(selection.kind === "manual"
      ? await evaluateSelectedManualCode({ ...context, code: selection.code })
      : await evaluateSelectedPublicOffer({ ...context, offerId: selection.offerId }));
  };
  const evaluatePrevious = async (selection: z.infer<typeof previousSelectionSchema>): Promise<PromoEvaluation> => {
    if (selection.kind === "none") return { ok: true, snapshot: baseline, promo: { kind: "none" } };
    const emailVerified = await ensureVerifiedEmail();
    const context = {
      clientId, verifiedEmail: emailVerified, subtotalAfterMarkdown: baseline.subtotal,
      fulfillmentMethod: "delivery" as const, shippingBeforeSubsidy: String(chosen.shippingCost),
    };
    return toEvaluation(selection.kind === "manual"
      ? await evaluateSelectedOffer({ ...context, offerId: selection.offerId, channel: "manual", codeId: selection.codeId })
      : await evaluateSelectedPublicOffer({ ...context, offerId: selection.offerId }));
  };

  const requested = await evaluateSelection(input.promoSelection);
  let snapshot = baseline;
  let promo: CheckoutReviewPromo = { kind: "none" };
  let replacement: PromoReplacementState | null = null;
  let requiresIncreaseAcknowledgement = false;
  let requiresContinueWithoutPromoAcknowledgement = false;

  if (input.previous) {
    const previous = input.previous;
    const verification = verifyCheckoutReviewToken(previous.reviewToken);
    if (promoSelectionDigest(previous.promoSelection) !== verification.promoDigest) {
      throw new CheckoutReviewRequiredError();
    }
    const previousResult = await evaluatePrevious(previous.promoSelection);
    if (previousResult.ok) {
      if (contextFingerprintOf(previousResult.snapshot, previousResult.promo) !== verification.fingerprint) {
        throw new CheckoutReviewRequiredError();
      }
      if (!requested.ok) throw promoFailure(requested.reason, requested.message);
      const comparison = comparePromoReplacement(
        { promo: previousResult.promo, total: reviewPricingOf(previousResult.snapshot).total,
          discount: reviewPricingOf(previousResult.snapshot).discount },
        { promo: requested.promo, total: reviewPricingOf(requested.snapshot).total,
          discount: reviewPricingOf(requested.snapshot).discount },
      );
      snapshot = requested.snapshot;
      promo = requested.promo;
      requiresIncreaseAcknowledgement = comparison.direction === "increase";
      replacement = {
        previous: { status: "valid", promo: promoSelectionOf(previousResult.promo), total: comparison.previousTotal },
        candidate: { promo: promoSelectionOf(requested.promo), total: comparison.candidateTotal },
        direction: comparison.direction,
        deltaTotal: comparison.deltaTotal,
        requiresIncreaseConfirmation: requiresIncreaseAcknowledgement,
      };
    } else {
      if (!requested.ok) throw promoFailure(requested.reason, requested.message, {
        previous: { status: "invalid", promo: previous.promoSelection, reason: previousResult.reason,
          message: previousResult.message },
      });
      if (requested.promo.kind === "none") {
        if (input.acknowledgeInvalidation !== true) {
          throw promoFailure(previousResult.reason, `${previousResult.message} Pilih promo lain atau lanjut tanpa promo.`, {
            previous: { status: "invalid", promo: previous.promoSelection, reason: previousResult.reason,
              message: previousResult.message },
            requiresContinueWithoutPromoAcknowledgement: true,
          });
        }
        requiresContinueWithoutPromoAcknowledgement = true;
      }
      snapshot = requested.snapshot;
      promo = requested.promo;
      replacement = {
        previous: { status: "invalid", promo: previous.promoSelection, total: null,
          reason: previousResult.reason, message: previousResult.message },
        candidate: { promo: promoSelectionOf(requested.promo), total: reviewPricingOf(requested.snapshot).total },
        direction: null,
        deltaTotal: null,
        requiresIncreaseConfirmation: false,
      };
    }
  } else if (!requested.ok) {
    throw promoFailure(requested.reason, requested.message);
  } else {
    snapshot = requested.snapshot;
    promo = requested.promo;
  }

  const pricing = reviewPricingOf(snapshot);
  const deliverySnapshot = deliverySnapshotOf(pricing);
  const contextFingerprint = buildCheckoutReviewContextFingerprint({ clientId,
    contactPhone: input.contactPhone, contactEmail: input.contactEmail, branchId,
    fulfillmentMethod: "delivery", pickupDate: null, pickupTime: null, deliverySnapshot, promo,
    pricing, lines: linesForContext(snapshot),
  });
  const { reviewToken, expiresAt } = createCheckoutReviewToken({
    contextFingerprint, promo,
    requiresPromoIncreaseAcknowledgement: requiresIncreaseAcknowledgement,
    requiresContinueWithoutPromoAcknowledgement,
  });
  return {
    pricing: publicPricingOf(pricing),
    promo,
    contextFingerprint,
    reviewToken,
    expiresAt,
    requiresIncreaseConfirmation: requiresIncreaseAcknowledgement,
    requiresContinueWithoutPromoAcknowledgement,
    replacement,
    deliveryService: { ...chosen, pricing: {
      subtotal: pricing.subtotal, discount: pricing.discount, taxableBase: pricing.taxableBase,
      shippingCost: pricing.shippingCost, serviceFee: pricing.serviceFee,
      ppnRatePercent: pricing.ppnRatePercent, ppnAmount: pricing.ppnAmount, total: pricing.total,
    } },
  };
}

function promoFailure(
  reason: OfferEligibilityReason,
  message: string,
  data?: Record<string, unknown>
): DeliveryPreviewPromoError {
  const mapped = mapOfferReasonToHttp(reason);
  return new DeliveryPreviewPromoError(mapped.status, mapped.code, message, data);
}
