import { placeOrderLegacy } from "@/features/checkout/place-order-legacy-service";
import { placeDeliveryQuote } from "@/features/checkout/place-order-delivery";
import { loadCart, loadCartItems, loadBranch, loadClientEmailVerified } from "@/features/checkout/place-order-repository";
import { RouteLogError, classifyPlaceOrderError } from "@/features/checkout/place-order-errors";
import { db } from "@/db";
import { extractPlaceOrderFields } from "@/features/checkout/place-order-input";
import { carriesManualPromoCode } from "@/lib/checkout-admission";
import {
  buildCheckoutReviewContextFingerprint,
  verifyCheckoutReviewToken,
  CheckoutReviewRequiredError,
  type CheckoutReviewVerification,
} from "@/lib/checkout-review";
import { evaluatePromoAcknowledgements, type PromoAcknowledgements } from "@/lib/promo-replacement";
import { pickupDateToInstant, validatePickupSlot } from "@/lib/pickup-validation";
import { getConfigNumber, getConfigString, getPpnRatePercent, getDiscountsContractVersion } from "@/lib/config";
import { prepareCheckoutTax } from "@/features/checkout/prepare-checkout-tax-service";
import type { ValidatedProviderTax } from "@marketplace/db/src/provider-tax";
import { type PricingSnapshot } from "@/lib/versioned-pricing";
import { type PublicOfferCandidate } from "@/lib/discount-selection";
import { readVariantProjections } from "@/lib/variant-price-projection";
import type { OrderPricing } from "@/lib/order-pricing";
import {
  buildPickupPricingSnapshot,
  finalizePricingFromSnapshot,
  buildPlacePaymentItemDetails,
  calculatePlaceOrderSubtotal,
  buildLegacyPickupPricing,
} from "@/features/checkout/place-order-pricing";
import { createModuleLogger } from "@/lib/logger";
import { verifyAndAdjustCheckoutStock } from "@/features/checkout/verify-checkout-stock-service";
import { checkoutStockAdjustmentMessage } from "@/lib/checkout-stock-adjustment";
import { loadRevalidatedNewDestination } from "@/lib/delivery-quote-data";
import type { DeliverySnapshotPayload } from "@marketplace/db/src/schema";
import { buildJubelioSalesCreateRequest } from "@/features/checkout/place-order-jubelio-request";
import { checkoutIntentFingerprint, findAcceptedCheckout, type CheckoutRecovery } from "@/lib/checkout-request";
import type { CheckoutReviewPromo } from "@/lib/checkout-review";
import { evaluatePromoSelection } from "@/features/checkout/place-order-promo";
import { placeCheckout, replayCheckoutAttempt } from "@/features/checkout/place-order-service";
import type { createCheckoutPayment } from "@/lib/midtrans";

import type { PlaceOrderData } from "./place-order-input";

const log = createModuleLogger("checkout-place-order");

/**
 * Persetujuan penggantian/invalidation (ticket 08) diperiksa SEBELUM order,
 * Redemption/usage, stock hold, atau provider intent dibuat. Persyaratannya
 * berasal dari payload token bertanda tangan, dan acknowledgement harus
 * menunjuk candidate fingerprint yang sama — bukan boolean `confirmed` bebas.
 */
function requirePromoAcknowledgements(
  reviewed: CheckoutReviewVerification,
  candidateFingerprint: string,
  acknowledgements: PromoAcknowledgements | undefined
): void {
  const requirement = reviewed.requiresPromoIncreaseAcknowledgement
    ? "promo_increase" as const
    : reviewed.requiresContinueWithoutPromoAcknowledgement
      ? "continue_without_promo" as const
      : "none" as const;
  const decision = evaluatePromoAcknowledgements({
    candidateFingerprint,
    requirement,
    acknowledgements,
  });
  if (!decision.ok) throw new CheckoutReviewRequiredError(decision.missing);
}

/**
 * Emergency pause switch (plan feature 4): when `checkout.paused` is set,
 * NEW checkouts are blocked — never with an adjustment fallback. Fail closed:
 * if the config cannot be read, checkouts stay blocked until it can be.
 */
export async function isCheckoutPaused(): Promise<boolean> {
  try {
    const value = await getConfigString("checkout.paused", "false");
    return value.trim().toLowerCase() === "true";
  } catch {
    return true;
  }
}

export interface PlaceCheckoutOrderInput {
  actor: { id: string; name?: string | null }; input: PlaceOrderData; isDelivery: boolean; recovery: CheckoutRecovery;
  initializeCheckoutPayment: typeof createCheckoutPayment;
  admit: (carriesManualCode: boolean) => Promise<unknown>;
}

export async function placeCheckoutOrder({
  actor,
  input,
  isDelivery,
  recovery,
  initializeCheckoutPayment,
  admit,
}: PlaceCheckoutOrderInput) {
  // Replay mendahului cart/master/config terbaru, termasuk pause dan expiry token.
  if (input.requestKey && input.reviewToken) {
    recovery.identity = { clientId: actor.id, requestKey: input.requestKey,
      fingerprint: checkoutIntentFingerprint(input) };
    const accepted = await findAcceptedCheckout(recovery.identity);
    if (accepted) return { kind: "accepted" as const, result: accepted, replay: true };
    // Pre-order replay is answered before any stock/pricing re-check: the
    // retained attempt owns that outcome. Same key + different intent is 409.
    const replayedAttempt = await replayCheckoutAttempt({ clientId: recovery.identity.clientId,
      requestKey: recovery.identity.requestKey, fingerprint: recovery.identity.fingerprint },
      { initializePayment: initializeCheckoutPayment });
    if (replayedAttempt) return { kind: "attempt" as const, result: replayedAttempt };
  }
  if (await isCheckoutPaused()) {
    log.warn("checkout rejected — new checkouts are paused");
    return { kind: "rejected" as const, reason: "paused" as const, data: { success: false, code: "POLICY_UNAVAILABLE", error: "Checkout sedang dijeda sementara." } };
  }
  const contractVersion = await getDiscountsContractVersion();
  if (contractVersion === 0 && (input.requestKey || input.reviewToken || input.promoSelection)) {
    return { kind: "rejected" as const, reason: "unsupported-version" as const, data: { success: false, code: "UNSUPPORTED_VERSION", error: "Checkout berversi belum aktif." } };
  }
  let reviewed: CheckoutReviewVerification | null = null;
  if (contractVersion === 1) {
    if (!input.requestKey || !input.reviewToken || !input.promoSelection) {
      throw new CheckoutReviewRequiredError();
    }
    // Place-order baru dengan manual code juga tunduk batas kode 20/120.
    await admit(carriesManualPromoCode(input));
    reviewed = verifyCheckoutReviewToken(input.reviewToken);
  }

  const { phone, email, selectedItemIds, pickupDate, pickupTime, deliveryBody } =
    extractPlaceOrderFields(input, isDelivery);

  // ===== Load the user's cart =====
  const cartRows = await loadCart(actor.id);

  if (cartRows.length === 0) {
    log.warn(`checkout rejected — cart is empty (user ${actor.id})`);
    return { kind: "rejected" as const, reason: "cart-empty" as const, data: { success: false, error: "Cart is empty" } };
  }

  const cart = cartRows[0];

  // ===== Load the selected cart items with variant + product + branch =====
  const items = await loadCartItems(cart.id);

  const selectedItems = items.filter((item) =>
    selectedItemIds.includes(item.cartItemId)
  );

  // Ticket 04: a delivery approval that references items outside the
  // caller's cart (or none at all) is not the caller's data — presented as
  // not found. The legacy pickup checkout keeps its 400 contract.
  if ((isDelivery || contractVersion === 1) && selectedItems.length !== selectedItemIds.length) {
    log.warn(
      `delivery checkout rejected — selected items not owned (${selectedItemIds.length} selected, user ${actor.id})`
    );
    return { kind: "rejected" as const, reason: "items-not-owned" as const, data: { success: false, error: "Barang keranjang tidak ditemukan." } };
  }
  if (selectedItems.length === 0) {
    log.warn("checkout rejected — no selected cart items");
    return { kind: "rejected" as const, reason: "no-items" as const, data: { success: false, error: "No selected items to checkout" } };
  }

  selectedItems.sort((a, b) => a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0);
  // Markdown projection read once for the whole selection. Only contract v1
  // consumers apply it; the legacy (gate 0) path keeps source prices.
  const markdownProjections = contractVersion === 1
    ? await readVariantProjections(selectedItems.map((item) => item.variantId))
    : new Map<string, { effectiveUnitPrice: string; markdownRevisionId: string | null }>();
  const effectiveOf = (item: { variantId: string; variantPrice: string }) =>
    markdownProjections.get(item.variantId)?.effectiveUnitPrice ?? item.variantPrice;
  const markdownRevisionOf = (item: { variantId: string }) =>
    markdownProjections.get(item.variantId)?.markdownRevisionId ?? null;
  // ===== Enforce single-branch checkout =====
  const branchIds = new Set(
    selectedItems.map((i) => i.branchId).filter((b): b is string => !!b)
  );
  if (branchIds.size === 0 || selectedItems.some((item) => !item.branchId)) {
    log.warn("checkout rejected — selected items have no branch");
    return { kind: "rejected" as const, reason: "no-branch" as const, data: { success: false, error: "Selected items have no branch assigned" } };
  }
  if (branchIds.size > 1) {
    log.warn(
      `multi-branch checkout rejected (${branchIds.size} branch, user ${actor.id})`
    );
    return { kind: "rejected" as const, reason: "multiple-branches" as const, data: {
        success: false,
        error:
          "Tidak bisa checkout barang di branch yang berbeda. Pilih barang dari satu cabang saja.",
      } };
  }

  const branchId = Array.from(branchIds)[0];

  // ===== Load the branch and validate operating hours =====
  const branch = await loadBranch(branchId);

  if (branch.length === 0 || branch[0].status !== "aktif") {
    log.warn(`checkout rejected — branch unavailable (branch ${branchId})`);
    return { kind: "rejected" as const, reason: "branch-unavailable" as const, data: { success: false, error: "Branch is no longer available" } };
  }
  if (branch[0].jubelioLocationId == null) {
    log.warn(`checkout rejected — branch is not linked to Jubelio (branch ${branchId})`);
    return { kind: "rejected" as const, reason: "branch-unlinked" as const, data: { success: false, error: "Branch is not linked to Jubelio inventory" } };
  }
  const unmappedItem = selectedItems.find((item) => item.jubelioItemId == null);
  if (unmappedItem) {
    log.warn(
      `checkout rejected — product is not linked to Jubelio (variant ${unmappedItem.variantId}, product ${unmappedItem.productName})`
    );
    return { kind: "rejected" as const, reason: "product-unlinked" as const, data: {
        success: false,
        error: `${unmappedItem.productName} is not linked to Jubelio inventory`,
      } };
  }

  // The delivery method needs NO pickup slot validation; the pickup flow
  // keeps its client/server slot gates unchanged.
  if (!isDelivery) {
    const slotValidation = validatePickupSlot(
      branch[0].operatingHours,
      pickupDate!,
      pickupTime!
    );
    if (!slotValidation.ok) {
      return { kind: "rejected" as const, reason: "pickup-slot" as const, data: { success: false, error: slotValidation.error } };
    }
  }

  // ===== Preflight pajak untuk writer baru (gate1) =====================
  // Replay di atas SUDAH menjawab attempt tersimpan tanpa membaca config/
  // master ini, sehingga order lama tetap dapat dilanjutkan saat pajak outage.
  // Untuk attempt baru, kegagalan apa pun diblokir sebelum hold/SO/Midtrans.
  let providerTax: ValidatedProviderTax | null = null;
  if (contractVersion === 1) {
    try {
      providerTax = await prepareCheckoutTax();
    } catch (error) {
      const decision = classifyPlaceOrderError("tax", error);
      if (decision.kind === "tax-unavailable") {
        const error = decision.error;
        log.error(
          `checkout rejected — pajak belum tersedia (reason ${error.reason})`,
          new RouteLogError("checkout tax preflight unavailable")
        );
        return { kind: "rejected" as const, reason: "tax-unavailable" as const, data: {
            success: false,
            code: "CHECKOUT_TAX_UNAVAILABLE",
            error: "Checkout belum dapat diproses karena konfigurasi pajak belum sesuai. Silakan coba lagi nanti.",
            } };
      }
      throw error;
    }
  }
  const ppnRatePercent = providerTax?.ratePercent ?? (await getPpnRatePercent());
  // Validate source/quantity/aggregate bounds exactly BEFORE live stock or
  // shipping HTTP. This preliminary snapshot is replaced by the fresh quote
  // snapshot below for delivery; neither path trusts browser money.
  let pricingSnapshot: PricingSnapshot | null = contractVersion === 1
    ? buildPickupPricingSnapshot({ isDelivery, ppnRatePercent, providerTax, selectedItems, effectiveOf, markdownRevisionOf })
    : null;

  // ===== One public Coupon in the single promo slot (ticket 07) ========
  // Delivery promo selection belongs to ticket 11; a delivery body carrying a
  // public selection is rejected instead of silently ignored. Pickup
  // evaluates eligibility against the subtotal AFTER Markdown. This result is
  // advisory: the authoritative capacity check runs again inside the
  // transaction under the Offer lock.
  let offerCandidate: PublicOfferCandidate | null = null;
  let promo: CheckoutReviewPromo = { kind: "none" };
  if (
    pricingSnapshot &&
    !isDelivery &&
    input.promoSelection &&
    input.promoSelection.kind !== "none"
  ) {
    const requestedSelection = input.promoSelection;
    const [clientRow] = await loadClientEmailVerified(actor.id);
    if (!clientRow) {
      return { kind: "rejected" as const, reason: "account-missing" as const, data: { success: false, code: "NOT_FOUND", error: "Akun tidak ditemukan.", } };
    }
    const evaluation = await evaluatePromoSelection({ selection: requestedSelection, clientId: actor.id,
      verifiedEmail: clientRow.emailVerified, pricingSnapshot, fulfillmentMethod: "pickup" });
    if (!evaluation.ok) {
      const mapped = evaluation.mapped;
      log.warn(
        `checkout promo rejected before commit (outcome promo_ineligible, ${evaluation.reason})`
      );
      return { kind: "rejected" as const, reason: "promo-ineligible" as const, data: { success: false, code: mapped.code, error: evaluation.message, }, eligibility: mapped };
    }
    offerCandidate = evaluation.candidate;
    pricingSnapshot = evaluation.pricingSnapshot;
    promo = evaluation.promo;
  }
  if (pricingSnapshot && !isDelivery) {
    const currentFingerprint = buildCheckoutReviewContextFingerprint({
      clientId: actor.id, contactPhone: phone, contactEmail: email,
      pickupDate: pickupDate!, pickupTime: pickupTime!, branchId,
      fulfillmentMethod: "pickup", promo,
      pricing: { ...pricingSnapshot, discount: pricingSnapshot.goodsDiscount },
      lines: pricingSnapshot.lines.map((line) => ({
        cartItemId: selectedItems.find((item) => item.variantId === line.variantId)!.cartItemId,
        variantId: line.variantId, branchId, quantity: line.quantity,
        sourceUnitPrice: line.sourceUnitPrice,
      })),
    });
    if (!reviewed || reviewed.fingerprint !== currentFingerprint) throw new CheckoutReviewRequiredError();
    requirePromoAcknowledgements(
      reviewed,
      currentFingerprint,
      (input as { acknowledgements?: PromoAcknowledgements }).acknowledgements
    );
  }

  // Read the local mirror first, then verify ALL selected pairs against the
  // provider before creating an SO. A stale/zero local cache is advisory:
  // the provider is the stock source of truth. The atomic hold below still
  // protects against concurrent checkouts on this site.
  const stockCheck = await verifyAndAdjustCheckoutStock(db, cart.id, selectedItems.map((item) => ({
    cartItemId: item.cartItemId,
    branchId,
    variantId: item.variantId,
    itemId: item.jubelioItemId!,
    locationId: branch[0].jubelioLocationId!,
    quantity: item.quantity,
    productName: item.productName,
  })));
  if (!stockCheck.ok) {
    if (stockCheck.reason === "unavailable") {
      log.error(
        `checkout rejected — Jubelio stock unavailable (reason ${stockCheck.reason}, detail ${stockCheck.detail ?? "-"}, branch ${branchId})`
      );
    } else {
      log.warn(
        `checkout rejected — Jubelio stock insufficient (product ${stockCheck.productName}, branch ${branchId})`
      );
    }
    if (stockCheck.reason === "insufficient") {
      return { kind: "rejected" as const, reason: "stock-adjusted" as const, data: {
        success: false,
        code: "CHECKOUT_STOCK_ADJUSTED",
        adjustments: stockCheck.adjustments,
        error: checkoutStockAdjustmentMessage(stockCheck.adjustments),
      } };
    }
    return { kind: "rejected" as const, reason: "stock-unavailable" as const, data: {
      success: false,
      error: "Stok Jubelio belum dapat diverifikasi. Silakan coba beberapa saat lagi.",
    } };
  }
  log.info(`Jubelio stock verified before Sales Order (${selectedItems.length} item)`);

  // ===== Calculate totals (method-aware) =====
  const subtotal = calculatePlaceOrderSubtotal(selectedItems, pricingSnapshot);
  let pricing: OrderPricing;
  let deliverySnapshot: DeliverySnapshotPayload | null = null;
  let verifiedNewAddress: Awaited<ReturnType<typeof loadRevalidatedNewDestination>> | null = null;
  if (isDelivery) {
    const delivery = await placeDeliveryQuote({ contractVersion, branchId, branch: branch[0], deliveryBody: deliveryBody!,
      sessionUserId: actor.id, selectedItems, ppnRatePercent, providerTax, effectiveOf, markdownRevisionOf });
    if (!delivery.ok) return { kind: "delivery-failure" as const, result: delivery };
    ({ pricing, deliverySnapshot, pricingSnapshot, verifiedNewAddress, offerCandidate, promo } = delivery);
  } else {
    pricing = buildLegacyPickupPricing(subtotal, ppnRatePercent);
  }
  if (pricingSnapshot) {
    // Snapshot sudah final: delivery dibangun dari quote fresh + benefit, pickup
    // dari baseline + benefit. Jangan pernah membangun ulang dari net shipping
    // (itu akan mengurangi subsidi dua kali).
    ({ pricing, deliverySnapshot } = finalizePricingFromSnapshot(pricingSnapshot, deliverySnapshot));
  }
  if (pricingSnapshot && isDelivery) {
    const currentFingerprint = buildCheckoutReviewContextFingerprint({
      clientId: actor.id, contactPhone: phone, contactEmail: email,
      pickupDate: null, pickupTime: null, branchId, fulfillmentMethod: "delivery",
      deliverySnapshot, promo, pricing: { ...pricingSnapshot, discount: pricingSnapshot.goodsDiscount },
      lines: pricingSnapshot.lines.map((line) => ({
        cartItemId: selectedItems.find((item) => item.variantId === line.variantId)!.cartItemId,
        variantId: line.variantId, branchId, quantity: line.quantity, sourceUnitPrice: line.sourceUnitPrice,
      })),
    });
    if (!reviewed || reviewed.fingerprint !== currentFingerprint) throw new CheckoutReviewRequiredError();
    requirePromoAcknowledgements(
      reviewed,
      currentFingerprint,
      (input as { acknowledgements?: PromoAcknowledgements }).acknowledgements
    );
  }
  const total = Number(pricing.total);
  const paymentItemDetails = buildPlacePaymentItemDetails({ selectedItems, pricingSnapshot, effectiveOf, pricing });

  // ===== Reservation TTL (minutes) from system_config (cached at boot) =====
  const ttlMinutes = await getConfigNumber("reservation.ttlMinutes", 15);

  // ===== Persist order + SO hold + create intent atomically, then run the
  // ===== SO create and Midtrans OUTSIDE the transaction =====
  const orderId = crypto.randomUUID();
  // Unique provider-facing create note/reference.
  const createReference = `SO_CREATE:${orderId}:${crypto.randomUUID()}`;
  // Single anchor for both the local hold clock and the Midtrans expiry
  // countdown (`expiry.start_time`) so async methods (VA/GoPay) cannot outlive
  // the reservation TTL.
  const paymentStartedAt = new Date();
  const expiresAt = new Date(paymentStartedAt.getTime() + ttlMinutes * 60_000);
  log.info(
    `creating order: order ${orderId}, total ${pricing.total}, ppn ${pricing.ppnAmount} @ ${pricing.ppnRatePercent}%, ttl ${ttlMinutes} menit`
  );

  // Kontrak provider3: PPN customer dicatat pada SO (tanpa tagihan kedua).
  // Pajak dibekukan dari snapshot attempt; tidak ada pembacaan config/master
  // di sini, sehingga replay/recovery memakai angka yang sama.
  const legacyProviderTaxId = Number(process.env.JUBELIO_ITEM_TAX_ID) || 1;
  const createRequest = buildJubelioSalesCreateRequest({
    selectedItems, pricingSnapshot, branch: branch[0], sessionUserName: actor.name,
    orderId, createReference, legacyProviderTaxId,
  });

  // ===== New checkout lifecycle: reserve → SO → payment → promotion =====
  // No order exists until the Sales Order and the payment session are ready.
  const lifecycleSnapshot = pricingSnapshot as PricingSnapshot | null;
  const attemptIdentity = recovery.identity as { fingerprint: string; requestKey: string } | undefined;
  if (lifecycleSnapshot && attemptIdentity) {
    const snapshot = lifecycleSnapshot;
    const snapshotItems = [...selectedItems]
      .sort((a, b) => a.variantId.localeCompare(b.variantId))
      .map((item) => {
        const line = snapshot.lines.find((row) => row.variantId === item.variantId);
        return { id: crypto.randomUUID(), variantId: item.variantId, productName: item.productName,
          variantInfo: `${item.variantColor || ""} ${item.variantSize || ""}`.trim(),
          price: line?.effectiveUnitPrice ?? effectiveOf(item), quantity: item.quantity,
          pricingContractVersion: 1, sourceUnitPrice: line?.sourceUnitPrice ?? item.variantPrice,
          markdownAmount: line?.markdownAmount ?? "0", goodsDiscountAmount: line?.goodsDiscountAmount ?? "0",
          netLineAmount: line?.netLineAmount ?? String(Number(item.variantPrice) * item.quantity),
          markdownRevisionId: line?.markdownRevisionId ?? null };
      });
    try {
      const attemptResult = await placeCheckout({
        attemptId: crypto.randomUUID(), clientId: actor.id, branchId,
        requestKey: attemptIdentity.requestKey, fingerprint: attemptIdentity.fingerprint,
        reservedOrderId: orderId, paymentStartedAt, expiresAt, stockObservedAt: stockCheck.observedAt,
        offerCandidate, now: paymentStartedAt,
        snapshot: {
          version: 1,
          order: {
            branchId,
            addressId: deliveryBody && "addressId" in deliveryBody ? deliveryBody.addressId : null,
            contactPhone: phone, contactEmail: email,
            subtotal: pricing.subtotal, shippingCost: pricing.shippingCost, discount: pricing.discount,
            serviceFee: pricing.serviceFee, ppnRate: pricing.ppnRatePercent, ppnAmount: pricing.ppnAmount,
            total: pricing.total, fulfillmentMethod: isDelivery ? "delivery" : "pickup",
            deliverySnapshot: isDelivery ? deliverySnapshot : null,
            pickupDate: isDelivery ? null : pickupDateToInstant(pickupDate!).toISOString(),
            pickupTime: isDelivery ? null : pickupTime!,
            pricingContractVersion: snapshot.pricingContractVersion,
            pricingEngineVersion: snapshot.pricingEngineVersion,
            providerContractVersion: snapshot.providerContractVersion,
            pricingCurrency: snapshot.currency, sourceGoodsSubtotal: snapshot.sourceGoodsSubtotal,
            markdownTotal: snapshot.markdownTotal, netGoods: snapshot.netGoods,
            shippingBeforeSubsidy: snapshot.shippingBeforeSubsidy,
            shippingSubsidy: snapshot.shippingSubsidy, merchantFunding: snapshot.merchantFunding,
            taxableBase: snapshot.taxableBase, expectedProviderPayable: snapshot.expectedProviderPayable,
            providerQuotedShippingCost: snapshot.providerQuotedShippingCost,
            providerBilledShippingCost: snapshot.providerBilledShippingCost,
            pricingSnapshot: snapshot,
          },
          items: snapshotItems,
          cart: selectedItems.map((item) => ({ itemId: item.cartItemId, cartId: cart.id, variantId: item.variantId,
            branchId: item.branchId!, quantity: item.quantity, updatedAt: item.cartItemUpdatedAt.toISOString() })),
          createRequest,
          addressToSave: isDelivery && deliveryBody && "newAddress" in deliveryBody && deliveryBody.saveAddress && verifiedNewAddress
            ? { firstName: verifiedNewAddress.recipientName, lastName: "", phone: verifiedNewAddress.phone,
                fullAddress: verifiedNewAddress.fullAddress, provinceId: verifiedNewAddress.canonical.provinceId,
                province: verifiedNewAddress.canonical.province, cityId: verifiedNewAddress.canonical.cityId,
                city: verifiedNewAddress.canonical.city, districtId: verifiedNewAddress.canonical.districtId,
                district: verifiedNewAddress.canonical.district, areaId: verifiedNewAddress.canonical.areaId,
                area: verifiedNewAddress.canonical.area, postalCode: verifiedNewAddress.canonical.postalCode,
                isDefault: deliveryBody.newAddress.isDefault }
            : null,
        },
      }, {
        initializePayment: initializeCheckoutPayment,
      });
      return { kind: "attempt" as const, result: attemptResult };
    } catch (attemptError) {
      const decision = classifyPlaceOrderError("attempt", attemptError);
      if (decision.kind === "attempt-reservation") {
        const attemptError = decision.error;
        log.warn(`checkout attempt rejected (code ${attemptError.code})`);
        return { kind: "rejected" as const, reason: "attempt-reservation" as const, data: { success: false, code: attemptError.code, error: attemptError.message,
          ...(attemptError.requestKey ? { data: { requestKey: attemptError.requestKey } } : {}) } };
      }
      // Infrastructure failure before any provider write: retry the SAME key.
      log.error("checkout attempt unavailable (code POLICY_UNAVAILABLE)",
        new RouteLogError("checkout attempt unavailable"));
      return { kind: "rejected" as const, reason: "attempt-unavailable" as const, data: { success: false, code: "POLICY_UNAVAILABLE",
        error: "Checkout belum dapat diselesaikan. Coba kembali dengan request yang sama.", } };
    }
  }

  return placeOrderLegacy({
    actor,
    recovery,
    selectedItems,
    selectedItemIds,
    cart,
    branchId,
    branch,
    pricingSnapshot,
    pricing,
    offerCandidate,
    isDelivery,
    deliverySnapshot,
    deliveryBody,
    verifiedNewAddress,
    pickupDate,
    pickupTime,
    phone,
    email,
    effectiveOf,
    markdownRevisionOf,
    orderId,
    createReference,
    createRequest,
    paymentStartedAt,
    expiresAt,
    ttlMinutes,
    total,
    paymentItemDetails,
    stockCheck,
    initializeCheckoutPayment,
  });
}

export type PlaceCheckoutOutcome = Awaited<ReturnType<typeof placeCheckoutOrder>>;
