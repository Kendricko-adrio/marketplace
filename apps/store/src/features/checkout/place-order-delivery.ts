import {
  loadQuoteOriginBranch,
  loadRevalidatedDestination,
  loadRevalidatedNewDestination,
  loadShipmentParcelConfig,
} from "@/lib/delivery-quote-data";
import { QuoteDeliveryError, quoteDelivery } from "@/lib/delivery-quote";
import { buildShipmentParcel } from "@/lib/shipment-parcel";
import { compareDeliveryApproval, createDeliverySnapshot } from "@/lib/delivery-order";
import { normalizeCheckoutApproval } from "@/lib/checkout-request";
import { createJubelioShipmentGateway } from "@/lib/jubelio-shipment-client";
import { createModuleLogger } from "@/lib/logger";
import type { OrderPricing } from "@/lib/order-pricing";
import type { PricingSnapshot } from "@/lib/versioned-pricing";
import type { DeliverySnapshotPayload } from "@marketplace/db/src/schema";
import type { ValidatedProviderTax } from "@marketplace/db/src/provider-tax";
import type { PublicOfferCandidate } from "@/lib/discount-selection";
import type { CheckoutReviewPromo } from "@/lib/checkout-review";
import { evaluatePromoSelection } from "./place-order-promo";
import { buildDeliveryBaselineSnapshot } from "./place-order-pricing";
import { RouteLogError, classifyPlaceOrderError } from "./place-order-errors";
import { loadClientEmailVerified, type PlaceOrderSelectedItem } from "./place-order-repository";
import type { DeliveryPlaceOrderData } from "./place-order-input";

const log = createModuleLogger("checkout-place-order");

export interface PlaceDeliveryInput {
  contractVersion: 0 | 1; branchId: string; branch: { id: string }; deliveryBody: DeliveryPlaceOrderData;
  sessionUserId: string; selectedItems: PlaceOrderSelectedItem[]; ppnRatePercent: number | string;
  providerTax: ValidatedProviderTax | null;
  effectiveOf: (item: { variantId: string; variantPrice: string }) => string;
  markdownRevisionOf: (item: { variantId: string }) => string | null;
}

export async function placeDeliveryQuote({
  contractVersion,
  branchId,
  branch,
  deliveryBody,
  sessionUserId,
  selectedItems,
  ppnRatePercent,
  providerTax,
  effectiveOf,
  markdownRevisionOf,
}: PlaceDeliveryInput) {
  let pricing: OrderPricing;
  let deliverySnapshot: DeliverySnapshotPayload | null = null;
  let pricingSnapshot: PricingSnapshot | null = null;
  let verifiedNewAddress: Awaited<ReturnType<typeof loadRevalidatedNewDestination>> | null = null;
  let offerCandidate: PublicOfferCandidate | null = null;
  let promo: CheckoutReviewPromo = { kind: "none" };
  // Fresh authoritative requote BEFORE anything local (no order, no
  // reservation, no SO, no Snap on a refused approval): ownership +
  // origin + the region revalidation + the IT parcel config (read per
  // quote, not from a cache) + the provider `rates`.
  try {
    const originBranch = await loadQuoteOriginBranch(branchId);
    const destination = "addressId" in deliveryBody!
      ? await loadRevalidatedDestination(sessionUserId, deliveryBody.addressId)
      : await loadRevalidatedNewDestination(deliveryBody!.newAddress);
    if ("newAddress" in deliveryBody!) verifiedNewAddress = destination;
    const parcelConfig = await loadShipmentParcelConfig();
    const quote = await quoteDelivery(
      {
        pricingContractVersion: contractVersion,
        branch: originBranch,
        items: selectedItems.map((item) => ({
          variantId: item.variantId,
          branchId: item.branchId as string,
          itemName: `${item.productName}${
            [item.variantColor, item.variantSize].filter(Boolean).join(" / ")
              ? ` ${[item.variantColor, item.variantSize].filter(Boolean).join(" / ")}`
              : ""
          }`.trim(),
          quantity: item.quantity,
          value: item.variantPrice,
          dimensions: item.parcelDimensions,
        })),
        destination: {
          postalCode: destination.postalCode,
          areaId: destination.areaId,
        },
        fallback: parcelConfig.fallback,
        packagingWeight: parcelConfig.packagingWeightGrams,
        ppnRatePercent,
      },
      createJubelioShipmentGateway()
    );
    const chosen = quote.services.find(
      (service) =>
        service.courierId === deliveryBody!.courierId &&
        service.serviceId === deliveryBody!.serviceId
    );
    // Missing approved service → forces a step-2 reselect/retry; a moved
    // approval → the user re-approves the NEW money. Either way NOTHING
    // local has been created yet.
    if (!chosen || chosen.originFingerprint !== deliveryBody!.originFingerprint) {
      log.warn(
        `delivery quote must be re-approved (changed service ${!chosen}, branch ${branchId})`
      );
      return { ok: false as const, failure: { kind: "reprice" as const, services: quote.services } };
    }
    // Baseline quote fresh: ongkir customer SEBELUM subsidi. Quote cost
    // provider disimpan apa adanya; booking memakai nilai ORIGINAL ini,
    // bukan net customer. Tidak ada shipping0 palsu saat quote gagal.
    const deliveryBaseline = contractVersion === 1 ? buildDeliveryBaselineSnapshot({
      selectedItems, ppnRatePercent, providerTax, effectiveOf, markdownRevisionOf, shippingCost: chosen.shippingCost,
    }) : null;       pricingSnapshot = deliveryBaseline;
    // Satu slot promo yang sama dengan pickup: Coupon publik/manual goods
    // ATAU subsidi ongkir. Eligibility dievaluasi pada subtotal/ongkir quote
    // fresh; kapasitas tetap dievaluasi ulang di bawah lock transaksi.
    const selection = deliveryBody!.promoSelection;
    if (selection && selection.kind !== "none" && deliveryBaseline) {
      const [clientRow] = await loadClientEmailVerified(sessionUserId);
      if (!clientRow) {
        return { ok: false as const, failure: { kind: "account-missing" as const } };
      }
      const evaluation = await evaluatePromoSelection({ selection, clientId: sessionUserId,
        verifiedEmail: clientRow.emailVerified, pricingSnapshot: deliveryBaseline, fulfillmentMethod: "delivery",
        shippingBeforeSubsidy: String(chosen.shippingCost) });
      if (!evaluation.ok) {
        log.warn(
          `delivery promo rejected before commit (outcome promo_ineligible, ${evaluation.reason})`
        );
        return { ok: false as const, failure: { kind: "promo" as const, evaluation } };
      }
      offerCandidate = evaluation.candidate;
      pricingSnapshot = evaluation.pricingSnapshot;
      promo = evaluation.promo;
    }
    // Approval dibandingkan dengan NET customer (subsidi sudah diterapkan),
    // bukan harga quote original; perubahan quote/benefit memaksa approve ulang.
    const netPricing = pricingSnapshot
      ? {
          subtotal: pricingSnapshot.subtotal,
          discount: pricingSnapshot.goodsDiscount,
          taxableBase: pricingSnapshot.taxableBase,
          shippingCost: pricingSnapshot.shippingCost,
          serviceFee: pricingSnapshot.serviceFee,
          ppnRatePercent: pricingSnapshot.ppnRatePercent,
          ppnAmount: pricingSnapshot.ppnAmount,
          total: pricingSnapshot.total,
        }
      : chosen.pricing;
    if (!compareDeliveryApproval(
      (contractVersion === 1 ? normalizeCheckoutApproval(deliveryBody!.approvedPricing) : deliveryBody!.approvedPricing) as unknown as OrderPricing,
      netPricing
    ).approved) {
      log.warn("delivery quote must be re-approved (changed pricing)");
      return { ok: false as const, failure: { kind: "reprice" as const, services: quote.services } };
    }
    pricing = netPricing;
    const parcel = buildShipmentParcel({
      items: selectedItems.map((item) => ({
        itemName: `${item.productName}${[item.variantColor, item.variantSize].filter(Boolean).length ? ` ${[item.variantColor, item.variantSize].filter(Boolean).join(" / ")}` : ""}`.trim(),
        quantity: item.quantity,
        value: Number(item.variantPrice),
        dimensions: item.parcelDimensions,
      })),
      fallback: parcelConfig.fallback,
      packagingWeight: parcelConfig.packagingWeightGrams,
    });
    deliverySnapshot = createDeliverySnapshot({
      address: {
        ...destination.canonical,
        recipientName: destination.recipientName,
        phone: destination.phone,
        fullAddress: destination.fullAddress,
      },
      origin: {
        branchId: branch.id,
        name: originBranch.name,
        phone: originBranch.shippingPhone,
        address: originBranch.shippingAddress,
        zipcode: originBranch.shippingPostalCode,
        areaId: originBranch.shippingAreaId,
      },
      parcel,
      service: {
        courierId: chosen.courierId,
        serviceId: chosen.serviceId,
        name: chosen.name,
        shippingCost: chosen.shippingCost,
        ...(chosen.validEta ? { validEta: chosen.validEta } : {}),
      },
      pricing,
    });
    return { ok: true as const, pricing, deliverySnapshot, pricingSnapshot, verifiedNewAddress, offerCandidate, promo };
  } catch (requoteError) {
    const decision = classifyPlaceOrderError("delivery", requoteError);
    if (decision.kind === "delivery-data") {
      const requoteError = decision.error;
      log.error(
        `delivery placement data failed (code ${requoteError.code})`,
        new RouteLogError("delivery placement data failed")
      );
      return { ok: false as const, failure: { kind: "data" as const, error: requoteError } };
    }
    const reprice = requoteError instanceof QuoteDeliveryError;
    log.error(
      `delivery placement quote failed (code ${reprice ? requoteError.code : "PROVIDER"})`
    );
    // A failed/empty/no-service quote NEVER proceeds with a zero or stale
    // ongkir: the same 409 reprice contract forces the fresh selection.
    return { ok: false as const, failure: { kind: "reprice" as const, services: [] } };
  }
}

export type PlaceDeliveryResult = Awaited<ReturnType<typeof placeDeliveryQuote>>;
