import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/db";
import {
  carts,
  cartItems,
  branches,
  branchStocks,
  orders,
  orderItems,
  productVariants,
  products,
  addresses,
  clients,
  checkoutRequests,
  variantPriceCurrent,
  variantPriceRevisions,
} from "@/db";
import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { z } from "zod";
import { readCheckoutJson, CheckoutInputError } from "@/lib/checkout-input";
import {
  admitCheckoutRequest,
  carriesManualPromoCode,
  CheckoutAdmissionError,
} from "@/lib/checkout-admission";
import { buildCheckoutReviewContextFingerprint, verifyCheckoutReviewToken, CheckoutReviewRequiredError, CheckoutReviewUnavailableError, type CheckoutReviewVerification } from "@/lib/checkout-review";
import {
  evaluatePromoAcknowledgements,
  type PromoAcknowledgements,
} from "@/lib/promo-replacement";
import { pickupDateToInstant, validatePickupSlot } from "@/lib/pickup-validation";
import { createPayment, getMockPaymentResult } from "@/lib/midtrans";
import { getConfigNumber, getConfigString, getPpnRatePercent, getDiscountsContractVersion } from "@/lib/config";
import { buildPricingSnapshot, PricingContractError, type PricingSnapshot } from "@/lib/versioned-pricing";
import { evaluatePricing } from "@marketplace/db/src/discount-pricing";
import {
  evaluateSelectedManualCode,
  evaluateSelectedPublicOffer,
  mapOfferReasonToHttp,
  offerReasonMessage,
  type PublicOfferCandidate,
} from "@/lib/discount-selection";
import {
  insertRedemptionReservation,
  lockAndEvaluateOfferReservation,
  RedemptionReviewChangedError,
  writeOrderDiscountAllocations,
} from "@/lib/discount-reservation";
import { readVariantProjections } from "@/lib/variant-price-projection";
import { projectMarkdownPrice } from "@marketplace/db/src/markdown-pricing";
import {
  calculateLineItemSubtotal,
  calculateOrderPricing,
} from "@/lib/order-pricing";
import { buildPaymentItemDetails } from "@/lib/payment-item-details";
import { createModuleLogger, getRequestId, withRequestContext } from "@/lib/logger";
import { claimAndFailOrder } from "@/lib/order-finalize";
import { initializeReservedOrderPayment } from "@/lib/payment-initialization";
import { verifyCheckoutStock } from "@marketplace/db/src/checkout-live-stock";
import { persistCheckoutStockAdjustments, checkoutStockAdjustmentMessage } from "@/lib/checkout-stock-adjustment";
import {
  DeliveryQuoteDataError,
  loadQuoteOriginBranch,
  loadRevalidatedDestination,
  loadRevalidatedNewDestination,
  loadShipmentParcelConfig,
} from "@/lib/delivery-quote-data";
import { buildShipmentParcel } from "@/lib/shipment-parcel";
import { clientAddressInputSchema } from "@/lib/client-addresses";
import { QuoteDeliveryError, quoteDelivery } from "@/lib/delivery-quote";
import {
  compareDeliveryApproval,
  createDeliverySnapshot,
} from "@/lib/delivery-order";
import type { DeliverySnapshotPayload } from "@marketplace/db/src/schema";
import type { OrderPricing } from "@/lib/order-pricing";
import { createJubelioShipmentGateway } from "@/lib/jubelio-shipment-client";
import {
  dispatchJubelioSalesCreate,
} from "@/lib/jubelio-sales-lifecycle";
import { recordJubelioSalesIntent } from "@/lib/jubelio-sales-operations";
import type { JubelioSalesOrderCreateRequest } from "@marketplace/db/src/schema";
import { runCheckoutTransaction } from "@/lib/checkout-transaction";
import { finalizeRejectedCheckoutCreate } from "@/lib/checkout-recovery";
import { AcceptedCheckoutReplay, CheckoutRequestConflictError, normalizeCheckoutApproval, checkoutIntentFingerprint, findAcceptedCheckout, checkoutResultResponse, type CheckoutRecovery } from "@/lib/checkout-request";
import type { CheckoutReviewPromo } from "@/lib/checkout-review";
import { applyOfferBenefitToPricing } from "@/lib/offer-pricing";
import { placeCheckout, replayCheckoutAttempt } from "@/features/checkout/place-order-service";
import { CheckoutAttemptReservationError } from "@/features/checkout/checkout-attempt";
import { createCheckoutPayment } from "@/lib/midtrans";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("checkout-place-order");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari Midtrans,
 * Jubelio, atau DB tidak pernah masuk log — hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/**
 * Promo kandidat ditolak authoritative di dalam transaksi (kapasitas/minimum/
 * waktu/identitas berubah sesudah preview). Tidak membuat order/hold parsial
 * dan tidak pernah membuat order tanpa promo secara diam-diam.
 */
class PromoReservationError extends Error {
  constructor(
    readonly status: 403 | 409,
    readonly code: string,
    readonly safeMessage: string,
    readonly reason: string
  ) {
    super(safeMessage);
    this.name = "PromoReservationError";
  }
}

/**
 * Thrown inside the place-order transaction when the atomic SO-hold UPDATE
 * matches 0 rows (another concurrent checkout took the last sellable unit, or
 * no provider `available` snapshot exists). The catch block translates it
 * into a 400/503 so the customer can retry; the whole transaction rolls back.
 */
class InsufficientStockError extends Error {
  constructor(
    public productName: string,
    public missingSnapshot = false
  ) {
    super(`Insufficient stock for ${productName}`);
    this.name = "InsufficientStockError";
  }
}

const selectedIdsSchema = z.array(z.string().min(1).max(128))
  .min(1, "Select at least one item to checkout").max(50)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate selected cart item IDs");

const reviewFields = {
  requestKey: z.string().uuid().transform((key) => key.toLowerCase()).optional(),
  reviewToken: z.string().min(1).max(2048).optional(),
  /**
   * Persetujuan penggantian/invalidation (ticket 08): selalu menunjuk candidate
   * fingerprint review token, bukan boolean bebas. Hanya persetujuan yang
   * ditandai token yang diperiksa; flag tambahan tidak memberi izin apa pun.
   */
  acknowledgements: z
    .strictObject({
      promoIncrease: z
        .strictObject({ candidateFingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
        .optional(),
      continueWithoutPromo: z
        .strictObject({ candidateFingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
        .optional(),
    })
    .optional(),
  // Satu slot promo: tanpa promo, satu Coupon publik, atau satu Manual Promo
  // Code (ticket 09). Promo delivery dimiliki ticket 11.
  promoSelection: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("none") }),
      z.strictObject({
        kind: z.literal("public"),
        offerId: z.string().min(1).max(128),
      }),
      z.strictObject({
        kind: z.literal("manual"),
        code: z.string().min(1).max(128),
      }),
    ])
    .optional(),
};

const placeOrderSchema = z.object({
  ...reviewFields,
  phone: z
    .string()
    .min(8, "Phone number is required")
    .max(20, "Phone number is too long"),
  email: z.string().email("Valid email is required"),
  pickupDate: z.string(), // YYYY-MM-DD
  pickupTime: z.string(), // HH:mm
  // Cart item ids the customer chose to checkout in this order.
  selectedItemIds: selectedIdsSchema,
}).strict();

// Ticket 04 — the delivery approval body. ONLY an approval: every money
// field is re-derived server-side (fresh quote) and compared; `pickupDate`/
// `pickupTime` are deliberately absent from a delivery submission.
const REPRICE_REQUIRED_MESSAGE =
  "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan.";

const deliveryPlaceOrderBase = z
  .object({
    ...reviewFields,
    itemIds: selectedIdsSchema,
    contactPhone: z
      .string()
      .min(8, "Phone number is required")
      .max(20, "Phone number is too long"),
    contactEmail: z.string().email("Valid email is required"),
    fulfillmentMethod: z.literal("delivery"),
    courierId: z.number().int(),
    serviceId: z.number().int(),
    approvedPricing: z.record(z.string(), z.union([z.string(), z.number()])),
    originFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  });
const deliveryPlaceOrderSchema = z.union([
  deliveryPlaceOrderBase.extend({ addressId: z.string().min(1).max(128) }).strict(),
  deliveryPlaceOrderBase.extend({ newAddress: clientAddressInputSchema, saveAddress: z.boolean(), saveRequestId: z.string().uuid() }).strict(),
]);

type DeliveryPlaceOrderData = z.infer<typeof deliveryPlaceOrderSchema>;

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

/** HTTP mapping for the version-2 attempt contract (no order means no redirect). */
function checkoutAttemptResponse(result: Awaited<ReturnType<typeof placeCheckout>>): Response {
  const { replayed, ...data } = result;
  if (result.state === "promoted") {
    log.info(`checkout attempt promoted: order ${data.orderId}, attempt ${data.attemptId}, replay ${replayed}`);
    return NextResponse.json({ success: true, data, orderId: data.orderId, redirectUrl: data.redirectUrl },
      { status: replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  }
  if (result.state === "rejected") {
    log.warn(`checkout rejected before order creation (attempt ${data.attemptId}, ${data.failureCode})`);
    return NextResponse.json({ success: false, code: data.failureCode, error: data.message, data,
      orderId: null, requestId: getRequestId() },
      { status: data.failureCode === "SALES_ORDER_REJECTED" ? 409 : 502, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ success: false,
    code: data.state === "manual_review" ? "CHECKOUT_MANUAL_REVIEW" : "CHECKOUT_PROCESSING",
    error: data.message, data, orderId: null, requestId: getRequestId() },
    { status: 202, headers: { "Cache-Control": "no-store" } });
}

async function postPlaceOrder(request: NextRequest): Promise<Response> {
  const recovery: CheckoutRecovery = {};
  try {
    const response = await placeOrder(request, recovery);
    if (response.status >= 400 && recovery.identity) {
      // Dua live-read concurrent dapat mengganti observation stamp sebelum
      // salah satu commit. Guard stock tetap ketat; tunggu sebentar hanya
      // hasil key yang sama, tanpa mengulang placement atau provider request.
      const waits = response.status === 503 ? [0, 25, 75, 150, 250] : [0];
      for (const wait of waits) {
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
        const accepted = await findAcceptedCheckout(recovery.identity);
        if (accepted) return checkoutResultResponse(accepted, !recovery.committed);
      }
    }
    return response;
  } catch (error) {
    if (error instanceof CheckoutRequestConflictError) {
      log.warn(`checkout request key conflict (code ${error.code})`);
      return NextResponse.json({ success: false, code: error.code, error: error.message, requestId: getRequestId() }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    log.error(
      `checkout result recovery unavailable (committed ${!!recovery.committed})`,
      new RouteLogError("checkout result recovery unavailable")
    );
    return NextResponse.json({ success: false, code: "POLICY_UNAVAILABLE", error: "Status checkout belum dapat dibaca. Coba lagi dengan request yang sama.", requestId: getRequestId() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

async function placeOrder(request: NextRequest, recovery: CheckoutRecovery) {
  log.info("place order requested");
  // E2E-only payment seam shared by the creator and replay paths.
  const initializeCheckoutPayment = (paymentInput: Parameters<typeof createCheckoutPayment>[0]) => {
    const mockRequested = process.env.NODE_ENV !== "production" &&
      request.headers.get("x-e2e-payment-mock") === "true";
    const mock = mockRequested
      ? getMockPaymentResult(paymentInput.orderId, { MIDTRANS_E2E_MOCK: "true", NODE_ENV: "test" })
      : null;
    return mock ? Promise.resolve({ kind: "ready" as const, ...mock }) : createCheckoutPayment(paymentInput);
  };
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const body = await readCheckoutJson(request);
    const requestedMethod = (body as { fulfillmentMethod?: unknown } | null)?.fulfillmentMethod;

    // ===== Method-aware body handling: pickup stays the legacy shape; a
    // delivery submission carries ONLY the approval (never money/slots). =====
    const isDelivery = requestedMethod === "delivery";
    const parsed = isDelivery
      ? deliveryPlaceOrderSchema.safeParse(body)
      : placeOrderSchema.safeParse(body);

    if (!parsed.success) {
      log.warn(`invalid request body (${parsed.error.issues.length} issue)`);
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    // Replay mendahului cart/master/config terbaru, termasuk pause dan expiry token.
    if (parsed.data.requestKey && parsed.data.reviewToken) {
      recovery.identity = { clientId: session.user.id, requestKey: parsed.data.requestKey,
        fingerprint: checkoutIntentFingerprint(parsed.data) };
      const accepted = await findAcceptedCheckout(recovery.identity);
      if (accepted) return checkoutResultResponse(accepted, true);
      // Pre-order replay is answered before any stock/pricing re-check: the
      // retained attempt owns that outcome. Same key + different intent is 409.
      const replayedAttempt = await replayCheckoutAttempt({ clientId: recovery.identity.clientId,
        requestKey: recovery.identity.requestKey, fingerprint: recovery.identity.fingerprint },
        { initializePayment: initializeCheckoutPayment });
      if (replayedAttempt) return checkoutAttemptResponse(replayedAttempt);
    }
    if (await isCheckoutPaused()) {
      log.warn("checkout rejected — new checkouts are paused");
      return NextResponse.json({ success: false, code: "POLICY_UNAVAILABLE", error: "Checkout sedang dijeda sementara." }, { status: 503 });
    }
    const contractVersion = await getDiscountsContractVersion();
    if (contractVersion === 0 && (parsed.data.requestKey || parsed.data.reviewToken || parsed.data.promoSelection)) {
      return NextResponse.json({ success: false, code: "UNSUPPORTED_VERSION", error: "Checkout berversi belum aktif." }, { status: 400 });
    }
    let reviewed: CheckoutReviewVerification | null = null;
    if (contractVersion === 1) {
      if (!parsed.data.requestKey || !parsed.data.reviewToken || !parsed.data.promoSelection) {
        throw new CheckoutReviewRequiredError();
      }
      // Place-order baru dengan manual code juga tunduk batas kode 20/120.
      await admitCheckoutRequest({
        clientId: session.user.id,
        kind: "place",
        headers: request.headers,
        carriesManualCode: carriesManualPromoCode(parsed.data),
      });
      reviewed = verifyCheckoutReviewToken(parsed.data.reviewToken);
    }

    const deliveryBody = isDelivery
      ? (parsed.data as DeliveryPlaceOrderData)
      : null;
    const phone = isDelivery
      ? deliveryBody!.contactPhone
      : (parsed.data as { phone: string }).phone;
    const email = isDelivery
      ? deliveryBody!.contactEmail
      : (parsed.data as { email: string }).email;
    const selectedItemIds = isDelivery
      ? deliveryBody!.itemIds
      : (parsed.data as { selectedItemIds: string[] }).selectedItemIds;
    const pickupDate = isDelivery ? null : (parsed.data as { pickupDate: string }).pickupDate;
    const pickupTime = isDelivery ? null : (parsed.data as { pickupTime: string }).pickupTime;

    // ===== Load the user's cart =====
    const cartRows = await db
      .select()
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);

    if (cartRows.length === 0) {
      log.warn(`checkout rejected — cart is empty (user ${session.user.id})`);
      return NextResponse.json(
        { success: false, error: "Cart is empty" },
        { status: 400 }
      );
    }

    const cart = cartRows[0];

    // ===== Load the selected cart items with variant + product + branch =====
    const items = await db
      .select({
        cartItemId: cartItems.id,
        cartItemUpdatedAt: cartItems.updatedAt,
        quantity: cartItems.quantity,
        variantId: productVariants.id,
        variantColor: productVariants.color,
        variantSize: productVariants.size,
        variantPrice: productVariants.price,
        parcelDimensions: productVariants.parcelDimensions,
        jubelioItemId: productVariants.jubelioItemId,
        productId: products.id,
        productName: products.name,
        branchId: cartItems.branchId,
      })
      .from(cartItems)
      .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(cartItems.cartId, cart.id));

    const selectedItems = items.filter((item) =>
      selectedItemIds.includes(item.cartItemId)
    );

    // Ticket 04: a delivery approval that references items outside the
    // caller's cart (or none at all) is not the caller's data — presented as
    // not found. The legacy pickup checkout keeps its 400 contract.
    if ((isDelivery || contractVersion === 1) && selectedItems.length !== selectedItemIds.length) {
      log.warn(
        `delivery checkout rejected — selected items not owned (${selectedItemIds.length} selected, user ${session.user.id})`
      );
      return NextResponse.json(
        { success: false, error: "Barang keranjang tidak ditemukan." },
        { status: 404 }
      );
    }
    if (selectedItems.length === 0) {
      log.warn("checkout rejected — no selected cart items");
      return NextResponse.json(
        { success: false, error: "No selected items to checkout" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { success: false, error: "Selected items have no branch assigned" },
        { status: 400 }
      );
    }
    if (branchIds.size > 1) {
      log.warn(
        `multi-branch checkout rejected (${branchIds.size} branch, user ${session.user.id})`
      );
      return NextResponse.json(
        {
          success: false,
          error:
            "Tidak bisa checkout barang di branch yang berbeda. Pilih barang dari satu cabang saja.",
        },
        { status: 400 }
      );
    }

    const branchId = Array.from(branchIds)[0];

    // ===== Load the branch and validate operating hours =====
    const branch = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (branch.length === 0 || branch[0].status !== "aktif") {
      log.warn(`checkout rejected — branch unavailable (branch ${branchId})`);
      return NextResponse.json(
        { success: false, error: "Branch is no longer available" },
        { status: 400 }
      );
    }
    if (branch[0].jubelioLocationId == null) {
      log.warn(`checkout rejected — branch is not linked to Jubelio (branch ${branchId})`);
      return NextResponse.json(
        { success: false, error: "Branch is not linked to Jubelio inventory" },
        { status: 409 }
      );
    }
    const unmappedItem = selectedItems.find((item) => item.jubelioItemId == null);
    if (unmappedItem) {
      log.warn(
        `checkout rejected — product is not linked to Jubelio (variant ${unmappedItem.variantId}, product ${unmappedItem.productName})`
      );
      return NextResponse.json(
        {
          success: false,
          error: `${unmappedItem.productName} is not linked to Jubelio inventory`,
        },
        { status: 409 }
      );
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
        return NextResponse.json(
          { success: false, error: slotValidation.error },
          { status: 400 }
        );
      }
    }

    const ppnRatePercent = await getPpnRatePercent();
    // Validate source/quantity/aggregate bounds exactly BEFORE live stock or
    // shipping HTTP. This preliminary snapshot is replaced by the fresh quote
    // snapshot below for delivery; neither path trusts browser money.
    let pricingSnapshot: PricingSnapshot | null = contractVersion === 1
      ? buildPricingSnapshot({
          fulfillmentMethod: isDelivery ? "delivery" : "pickup", ppnRatePercent,
          lines: selectedItems.map((item) => ({
            variantId: item.variantId, quantity: item.quantity,
            sourceUnitPrice: item.variantPrice, effectiveUnitPrice: effectiveOf(item),
            markdownRevisionId: markdownRevisionOf(item),
          })),
        })
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
      parsed.data.promoSelection &&
      parsed.data.promoSelection.kind !== "none"
    ) {
      const requestedSelection = parsed.data.promoSelection;
      const [clientRow] = await db
        .select({ emailVerified: clients.emailVerified })
        .from(clients)
        .where(eq(clients.id, session.user.id))
        .limit(1);
      if (!clientRow) {
        return NextResponse.json({ success: false, code: "NOT_FOUND", error: "Akun tidak ditemukan.", requestId: getRequestId() }, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      const evaluation =
        requestedSelection.kind === "manual"
          ? await evaluateSelectedManualCode({
              code: requestedSelection.code,
              clientId: session.user.id,
              verifiedEmail: clientRow.emailVerified,
              subtotalAfterMarkdown: pricingSnapshot.subtotal,
            })
          : await evaluateSelectedPublicOffer({
              offerId: requestedSelection.offerId,
              clientId: session.user.id,
              verifiedEmail: clientRow.emailVerified,
              subtotalAfterMarkdown: pricingSnapshot.subtotal,
            });
      if (!evaluation.ok) {
        const mapped = mapOfferReasonToHttp(evaluation.reason);
        log.warn(
          `checkout promo rejected before commit (outcome promo_ineligible, ${evaluation.reason})`
        );
        return NextResponse.json(
          { success: false, code: mapped.code, error: offerReasonMessage(evaluation.reason), requestId: getRequestId() },
          { status: mapped.status, headers: { "Cache-Control": "no-store" } }
        );
      }
      offerCandidate = evaluation.candidate;
      pricingSnapshot = applyOfferBenefitToPricing(pricingSnapshot, evaluation.candidate);
      promo =
        evaluation.candidate.activationKind === "manual_only" &&
        evaluation.candidate.codeId
          ? {
              kind: "manual",
              offerId: evaluation.candidate.offerId,
              codeId: evaluation.candidate.codeId,
              revisionId: evaluation.candidate.revisionId,
              benefitId: evaluation.candidate.benefitId,
              benefitAmount: evaluation.candidate.benefitAmount,
            }
          : {
              kind: "public",
              offerId: evaluation.candidate.offerId,
              revisionId: evaluation.candidate.revisionId,
              benefitId: evaluation.candidate.benefitId,
              benefitAmount: evaluation.candidate.benefitAmount,
            };
    }
    if (pricingSnapshot && !isDelivery) {
      const currentFingerprint = buildCheckoutReviewContextFingerprint({
        clientId: session.user.id, contactPhone: phone, contactEmail: email,
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
        (parsed.data as { acknowledgements?: PromoAcknowledgements }).acknowledgements
      );
    }

    // Read the local mirror first, then verify ALL selected pairs against the
    // provider before creating an SO. A stale/zero local cache is advisory:
    // the provider is the stock source of truth. The atomic hold below still
    // protects against concurrent checkouts on this site.
    const stockCheck = await verifyCheckoutStock(db, selectedItems.map((item) => ({
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
      return NextResponse.json({
        success: false,
        error: stockCheck.reason === "insufficient"
          ? `Stok ${stockCheck.productName} di cabang ini tidak mencukupi. Silakan kurangi jumlah atau pilih barang lain.`
          : "Stok Jubelio belum dapat diverifikasi. Silakan coba beberapa saat lagi.",
      }, { status: stockCheck.reason === "insufficient" ? 409 : 503 });
    }
    log.info(`Jubelio stock verified before Sales Order (${selectedItems.length} item)`);

    // ===== Calculate totals (method-aware) =====
    const subtotal = pricingSnapshot?.subtotal ?? calculateLineItemSubtotal(
      selectedItems.map((item) => ({ price: item.variantPrice, quantity: item.quantity }))
    );
    let pricing: ReturnType<typeof calculateOrderPricing>;
    let deliverySnapshot: DeliverySnapshotPayload | null = null;
    let verifiedNewAddress: Awaited<ReturnType<typeof loadRevalidatedNewDestination>> | null = null;
    if (isDelivery) {
      // Fresh authoritative requote BEFORE anything local (no order, no
      // reservation, no SO, no Snap on a refused approval): ownership +
      // origin + the region revalidation + the IT parcel config (read per
      // quote, not from a cache) + the provider `rates`.
      try {
        const originBranch = await loadQuoteOriginBranch(branchId);
        const destination = "addressId" in deliveryBody!
          ? await loadRevalidatedDestination(session.user.id, deliveryBody.addressId)
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
          return NextResponse.json(
            {
              success: false,
              error: REPRICE_REQUIRED_MESSAGE,
              code: "DELIVERY_REPRICE_REQUIRED",
              data: { services: quote.services },
            },
            { status: 409 }
          );
        }
        // Baseline quote fresh: ongkir customer SEBELUM subsidi. Quote cost
        // provider disimpan apa adanya; booking memakai nilai ORIGINAL ini,
        // bukan net customer. Tidak ada shipping0 palsu saat quote gagal.
        const deliveryBaseline = contractVersion === 1 ? buildPricingSnapshot({
          fulfillmentMethod: "delivery",
          ppnRatePercent,
          lines: selectedItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            sourceUnitPrice: item.variantPrice,
            effectiveUnitPrice: effectiveOf(item),
            markdownRevisionId: markdownRevisionOf(item),
          })),
          shippingBeforeSubsidy: String(chosen.shippingCost),
          providerQuotedShippingCost: String(chosen.shippingCost),
        }) : null;
        pricingSnapshot = deliveryBaseline;
        // Satu slot promo yang sama dengan pickup: Coupon publik/manual goods
        // ATAU subsidi ongkir. Eligibility dievaluasi pada subtotal/ongkir quote
        // fresh; kapasitas tetap dievaluasi ulang di bawah lock transaksi.
        const selection = deliveryBody!.promoSelection;
        if (selection && selection.kind !== "none" && deliveryBaseline) {
          const [clientRow] = await db
            .select({ emailVerified: clients.emailVerified })
            .from(clients)
            .where(eq(clients.id, session.user.id))
            .limit(1);
          if (!clientRow) {
            return NextResponse.json({ success: false, code: "NOT_FOUND", error: "Akun tidak ditemukan.", requestId: getRequestId() }, { status: 404, headers: { "Cache-Control": "no-store" } });
          }
          const evaluation = selection.kind === "manual"
            ? await evaluateSelectedManualCode({
                code: selection.code,
                clientId: session.user.id,
                verifiedEmail: clientRow.emailVerified,
                subtotalAfterMarkdown: deliveryBaseline.subtotal,
                fulfillmentMethod: "delivery",
                shippingBeforeSubsidy: String(chosen.shippingCost),
              })
            : await evaluateSelectedPublicOffer({
                offerId: selection.offerId,
                clientId: session.user.id,
                verifiedEmail: clientRow.emailVerified,
                subtotalAfterMarkdown: deliveryBaseline.subtotal,
                fulfillmentMethod: "delivery",
                shippingBeforeSubsidy: String(chosen.shippingCost),
              });
          if (!evaluation.ok) {
            const mapped = mapOfferReasonToHttp(evaluation.reason);
            log.warn(
              `delivery promo rejected before commit (outcome promo_ineligible, ${evaluation.reason})`
            );
            return NextResponse.json(
              { success: false, code: mapped.code, error: offerReasonMessage(evaluation.reason), requestId: getRequestId() },
              { status: mapped.status, headers: { "Cache-Control": "no-store" } }
            );
          }
          offerCandidate = evaluation.candidate;
          pricingSnapshot = applyOfferBenefitToPricing(deliveryBaseline, evaluation.candidate);
          promo =
            evaluation.candidate.activationKind === "manual_only" && evaluation.candidate.codeId
              ? {
                  kind: "manual",
                  offerId: evaluation.candidate.offerId,
                  codeId: evaluation.candidate.codeId,
                  revisionId: evaluation.candidate.revisionId,
                  benefitId: evaluation.candidate.benefitId,
                  benefitAmount: evaluation.candidate.benefitAmount,
                }
              : {
                  kind: "public",
                  offerId: evaluation.candidate.offerId,
                  revisionId: evaluation.candidate.revisionId,
                  benefitId: evaluation.candidate.benefitId,
                  benefitAmount: evaluation.candidate.benefitAmount,
                };
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
          return NextResponse.json(
            {
              success: false,
              error: REPRICE_REQUIRED_MESSAGE,
              code: "DELIVERY_REPRICE_REQUIRED",
              data: { services: quote.services },
            },
            { status: 409 }
          );
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
            branchId: branch[0].id,
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
      } catch (requoteError) {
        if (requoteError instanceof DeliveryQuoteDataError) {
          const status =
            requoteError.code === "NOT_FOUND"
              ? 404
              : requoteError.code === "UNAVAILABLE"
                ? 502
                : 400;
          log.error(
            `delivery placement data failed (code ${requoteError.code})`,
            new RouteLogError("delivery placement data failed")
          );
          return NextResponse.json(
            { success: false, error: requoteError.message },
            { status }
          );
        }
        const reprice = requoteError instanceof QuoteDeliveryError;
        log.error(
          `delivery placement quote failed (code ${reprice ? requoteError.code : "PROVIDER"})`
        );
        // A failed/empty/no-service quote NEVER proceeds with a zero or stale
        // ongkir: the same 409 reprice contract forces the fresh selection.
        return NextResponse.json(
          {
            success: false,
            error: REPRICE_REQUIRED_MESSAGE,
            code: "DELIVERY_REPRICE_REQUIRED",
            data: { services: [] },
          },
          { status: 409 }
        );
      }
    } else {
      pricing = calculateOrderPricing({
        fulfillmentMethod: "pickup",
        subtotal,
        discount: 0,
        shippingCost: 0,
        serviceFee: 0,
        ppnRatePercent,
      });
    }
    if (pricingSnapshot) {
      // Snapshot sudah final: delivery dibangun dari quote fresh + benefit, pickup
      // dari baseline + benefit. Jangan pernah membangun ulang dari net shipping
      // (itu akan mengurangi subsidi dua kali).
      pricing = {
        subtotal: pricingSnapshot.subtotal, discount: pricingSnapshot.goodsDiscount,
        shippingCost: pricingSnapshot.shippingCost, taxableBase: pricingSnapshot.taxableBase,
        serviceFee: pricingSnapshot.serviceFee, ppnRatePercent: pricingSnapshot.ppnRatePercent,
        ppnAmount: pricingSnapshot.ppnAmount, total: pricingSnapshot.total,
      };
      if (deliverySnapshot) deliverySnapshot = { ...deliverySnapshot, pricing };
    }
    if (pricingSnapshot && isDelivery) {
      const currentFingerprint = buildCheckoutReviewContextFingerprint({
        clientId: session.user.id, contactPhone: phone, contactEmail: email,
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
        (parsed.data as { acknowledgements?: PromoAcknowledgements }).acknowledgements
      );
    }
    const total = Number(pricing.total);
    const paymentItemDetails = buildPaymentItemDetails({
      items: selectedItems.map((item) => ({
        id: item.variantId,
        name: item.productName,
        // Midtrans goods use the EFFECTIVE unit amounts (Markdown already
        // deducted once) plus the goods-discount adjustment; the detail total
        // must equal the stored customer total exactly.
        price: pricingSnapshot ? effectiveOf(item) : item.variantPrice,
        quantity: item.quantity,
      })),
      ...pricing,
    });

    // ===== Reservation TTL (minutes) from system_config (cached at boot) =====
    const ttlMinutes = await getConfigNumber("reservation.ttlMinutes", 15);

    // ===== Persist order + SO hold + create intent atomically, then run the
    // ===== SO create and Midtrans OUTSIDE the transaction =====
    const orderId = crypto.randomUUID();
    // Unique provider-facing create note/reference.
    const createReference = `OKCIR_SO_CREATE:${orderId}:${crypto.randomUUID()}`;
    // Single anchor for both the local hold clock and the Midtrans expiry
    // countdown (`expiry.start_time`) so async methods (VA/GoPay) cannot outlive
    // the reservation TTL.
    const paymentStartedAt = new Date();
    const expiresAt = new Date(paymentStartedAt.getTime() + ttlMinutes * 60_000);
    log.info(
      `creating order: order ${orderId}, total ${pricing.total}, ppn ${pricing.ppnAmount} @ ${pricing.ppnRatePercent}%, ttl ${ttlMinutes} menit`
    );

    const createRequest: JubelioSalesOrderCreateRequest = {
      ...(pricingSnapshot ? {
        providerContractVersion: 2 as const,
        originalShipmentCost: Number(pricingSnapshot.shippingBeforeSubsidy),
        shippingCost: Number(pricingSnapshot.shippingCost),
        expectedProviderPayable: Number(pricingSnapshot.expectedProviderPayable),
      } : {}),
      // The verified generic Jubelio customer contact.
      contactId: -1,
      customerName: session.user.name || "Customer",
      locationId: branch[0].jubelioLocationId!,
      note: createReference,
      refNo: orderId,
      channelStatus: "Belum Bayar",
      items: selectedItems.map((item) => ({
        itemId: item.jubelioItemId!,
        quantity: item.quantity,
        // Provider price stays the SOURCE unit; the whole-line Markdown is a
        // line discount, never a lowered source price or a raised payment.
        price: Number(item.variantPrice),
        discAmount: pricingSnapshot
          ? (() => {
              // Provider line discount = Markdown whole-line + Coupon allocation
              // (whole-line, NEVER multiplied by quantity again). The snapshot's
              // source/net line amounts are the independent authority.
              const line = pricingSnapshot.lines.find(
                (row) => row.variantId === item.variantId
              );
              if (!line) return 0;
              return (
                Math.round(Number(line.sourceLineAmount)) -
                Math.round(Number(line.netLineAmount))
              );
            })()
          : 0,
        taxAmount: 0,
        unit: process.env.JUBELIO_ITEM_UNIT?.trim() || "Buah",
        // The provider FK-rejects tax_id 0; the account's "No Tax" record id
        // (sandbox 2026-09-24: 1, rate 0.00) is the safe default.
        taxId: Number(process.env.JUBELIO_ITEM_TAX_ID) || 1,
      })),
    };

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
          attemptId: crypto.randomUUID(), clientId: session.user.id, branchId,
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
        return checkoutAttemptResponse(attemptResult);
      } catch (attemptError) {
        if (attemptError instanceof CheckoutAttemptReservationError) {
          log.warn(`checkout attempt rejected (code ${attemptError.code})`);
          return NextResponse.json({ success: false, code: attemptError.code, error: attemptError.message,
            requestId: getRequestId(), ...(attemptError.requestKey ? { data: { requestKey: attemptError.requestKey } } : {}) },
            { status: 409, headers: { "Cache-Control": "no-store" } });
        }
        // Infrastructure failure before any provider write: retry the SAME key.
        log.error("checkout attempt unavailable (code POLICY_UNAVAILABLE)",
          new RouteLogError("checkout attempt unavailable"));
        return NextResponse.json({ success: false, code: "POLICY_UNAVAILABLE",
          error: "Checkout belum dapat diselesaikan. Coba kembali dengan request yang sama.", requestId: getRequestId() },
          { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }

    try {
      await runCheckoutTransaction(!!pricingSnapshot, async (tx, step) => {
        if (pricingSnapshot) {
          // Owner → sorted source variants → order → sorted stock → intent.
          // No provider HTTP while locks are held. Re-read after the quote:
          // stale source/parcel/cart inputs require a fresh customer review.
          await step(() => tx.select({ id: clients.id }).from(clients)
            .where(eq(clients.id, session.user.id)).for("update"));
          if (recovery.identity) {
            const identity = recovery.identity;
            const [accepted] = await step(() => tx.select().from(checkoutRequests).where(and(
              eq(checkoutRequests.clientId, identity.clientId),
              eq(checkoutRequests.requestKey, identity.requestKey),
            )).limit(1));
            if (accepted) {
              if (accepted.fingerprint !== recovery.identity.fingerprint) throw new CheckoutRequestConflictError();
              throw new AcceptedCheckoutReplay();
            }
          }
          if (offerCandidate) {
            // Lock group 3 BEFORE group 4/5: Offer identity → global usage →
            // client usage, then authoritative re-evaluation under those locks.
            // Two reservations for the SAME Offer serialize on the Offer row,
            // so the second sees the first commit's capacity instead of
            // overselling. The insert happens after the order exists (FK).
            const candidate = offerCandidate;
            const [freshClient] = await step(() => tx.select({ emailVerified: clients.emailVerified })
              .from(clients).where(eq(clients.id, session.user.id)).limit(1));
            const decision = await lockAndEvaluateOfferReservation(tx, {
              clientId: session.user.id,
              verifiedEmail: freshClient?.emailVerified ?? false,
              candidate: candidate,
              subtotalAfterMarkdown: pricingSnapshot.subtotal,
              fulfillmentMethod: isDelivery ? "delivery" : "pickup",
              shippingBeforeSubsidy: isDelivery ? pricingSnapshot.shippingBeforeSubsidy : "0",
            });
            if (!decision.ok) {
              const mapped = mapOfferReasonToHttp(decision.reason);
              throw new PromoReservationError(
                mapped.status, mapped.code, decision.message, decision.reason
              );
            }
          }
          const freshVariants = await step(() => tx.select().from(productVariants)
            .where(inArray(productVariants.id, selectedItems.map((item) => item.variantId)))
            .orderBy(asc(productVariants.id)).for("update"));
          // Lock order group 4 continues: variant/source rows first, then the
          // current Markdown pointer. A concurrent apply/source sync therefore
          // serializes against this commit instead of slipping a different
          // price into an order reviewed under the old projection.
          const freshMarkdownRows = await step(() => tx
            .select({
              variantId: variantPriceCurrent.variantId,
              revisionId: variantPriceRevisions.id,
              targetUnitPrice: variantPriceRevisions.targetUnitPrice,
            })
            .from(variantPriceCurrent)
            .innerJoin(
              variantPriceRevisions,
              and(
                eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
                eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
              )
            )
            .where(inArray(variantPriceCurrent.variantId, selectedItems.map((item) => item.variantId)))
            .orderBy(asc(variantPriceCurrent.variantId))
            .for("update"));
          const freshMarkdown = new Map(
            freshMarkdownRows.map((row) => [row.variantId, row] as const)
          );
          const [freshBranch] = await step(() => tx.select().from(branches).where(eq(branches.id, branchId)).for("share"));
          if (!freshBranch || freshBranch.status !== "aktif" || freshBranch.jubelioLocationId !== branch[0].jubelioLocationId ||
              (!isDelivery && !validatePickupSlot(freshBranch.operatingHours, pickupDate!, pickupTime!).ok)) {
            throw new CheckoutReviewRequiredError();
          }
          if (deliverySnapshot) {
            const origin = deliverySnapshot.origin;
            if (freshBranch.name !== origin.name || freshBranch.shippingPhone !== origin.phone ||
                freshBranch.shippingAddress !== origin.address || freshBranch.shippingPostalCode !== origin.zipcode ||
                freshBranch.shippingAreaId !== origin.areaId) throw new CheckoutReviewRequiredError();
            if (deliveryBody && "addressId" in deliveryBody) {
              const addressId = deliveryBody.addressId;
              const [currentAddress] = await step(() => tx.select().from(addresses).where(and(eq(addresses.id, addressId), eq(addresses.userId, session.user.id))).for("share"));
              const address = deliverySnapshot.address;
              if (!currentAddress || currentAddress.firstName !== address.recipientName || currentAddress.phone !== address.phone ||
                  currentAddress.fullAddress !== address.fullAddress || currentAddress.provinceId !== address.provinceId ||
                  currentAddress.cityId !== address.cityId || currentAddress.districtId !== address.districtId ||
                  currentAddress.areaId !== address.areaId || currentAddress.postalCode !== address.postalCode) throw new CheckoutReviewRequiredError();
            }
          }
          const freshCart = await step(() => tx.select().from(cartItems)
            .where(and(eq(cartItems.cartId, cart.id), inArray(cartItems.id, selectedItemIds)))
            .orderBy(asc(cartItems.id)).for("update"));
          for (const item of selectedItems) {
            const variant = freshVariants.find((row) => row.id === item.variantId);
            const selected = freshCart.find((row) => row.id === item.cartItemId);
            if (!variant || variant.price !== item.variantPrice || variant.jubelioItemId !== item.jubelioItemId ||
                JSON.stringify(variant.parcelDimensions) !== JSON.stringify(item.parcelDimensions) ||
                !selected || selected.variantId !== item.variantId || selected.branchId !== item.branchId || selected.quantity !== item.quantity) {
              throw new PricingContractError("PRICING_INPUT_INVALID", "Harga atau keranjang berubah. Periksa kembali pesanan.");
            }
            // Reviewed Markdown must still be the current one. A source change
            // alone can keep the same target active; the effective price and
            // revision identity both have to match the review.
            const current = freshMarkdown.get(item.variantId);
            let freshEffective = variant.price;
            let freshRevisionId: string | null = null;
            try {
              const projection = projectMarkdownPrice({
                sourceUnitPrice: variant.price,
                storedTargetUnitPrice: current?.targetUnitPrice ?? null,
                markdownRevisionId: current?.revisionId ?? null,
              });
              freshEffective = projection.effectiveUnitPrice;
              freshRevisionId = projection.markdownRevisionId;
            } catch {
              throw new CheckoutReviewRequiredError();
            }
            if (freshEffective !== effectiveOf(item) || freshRevisionId !== markdownRevisionOf(item)) {
              throw new CheckoutReviewRequiredError();
            }
          }
        }
        // Save only after the final quote has been approved, atomically with
        // the order. A failed quote never mutates the address book.
        let savedAddressId: string | null = null;
        if (isDelivery && deliveryBody && "newAddress" in deliveryBody && deliveryBody.saveAddress && verifiedNewAddress) {
          const [owner] = await step(() => tx.select({ id: clients.id }).from(clients)
            .where(eq(clients.id, session.user.id)).for("update").limit(1));
          if (!owner) throw new Error("Address owner no longer exists");
          // A stable, scoped ID makes a repeated accepted save request reuse
          // its own address instead of creating duplicate book entries.
          savedAddressId = `checkout:${createHash("sha256")
            .update(`${session.user.id}:${deliveryBody.saveRequestId}`).digest("hex")}`;
          const canonical = verifiedNewAddress.canonical;
          const stableAddressId = savedAddressId;
          const [prior] = await step(() => tx.select().from(addresses).where(eq(addresses.id, stableAddressId)).limit(1));
          if (prior) {
            const identical = prior.userId === session.user.id && prior.firstName === verifiedNewAddress.recipientName &&
              prior.phone === verifiedNewAddress.phone && prior.fullAddress === verifiedNewAddress.fullAddress &&
              prior.provinceId === canonical.provinceId && prior.cityId === canonical.cityId &&
              prior.districtId === canonical.districtId && prior.areaId === canonical.areaId &&
              prior.postalCode === canonical.postalCode;
            if (!identical) throw new Error("Checkout address save request reused with a different destination");
          } else {
            if (deliveryBody.newAddress.isDefault) {
              await step(() => tx.update(addresses).set({ isDefault: false, updatedAt: new Date() })
                .where(and(eq(addresses.userId, session.user.id), eq(addresses.isDefault, true))));
            }
            await step(() => tx.insert(addresses).values({
              id: stableAddressId,
              userId: session.user.id,
              firstName: verifiedNewAddress.recipientName,
              lastName: "",
              phone: verifiedNewAddress.phone,
              fullAddress: verifiedNewAddress.fullAddress,
              provinceId: canonical.provinceId,
              province: canonical.province,
              cityId: canonical.cityId,
              city: canonical.city,
              districtId: canonical.districtId,
              district: canonical.district,
              areaId: canonical.areaId,
              area: canonical.area,
              postalCode: canonical.postalCode,
              isDefault: deliveryBody.newAddress.isDefault,
            }));
          }
        }
        // ===== Create the order =====
        await step(() => tx.insert(orders).values({
          id: orderId,
          userId: session.user.id,
          branchId,
          addressId: savedAddressId ?? (isDelivery && deliveryBody && "addressId" in deliveryBody ? deliveryBody.addressId : null),
          status: "pending_payment",
          paymentMethod: null,
          paymentStatus: "pending",
          // Delivery rows carry NO pickup slots and their immutable snapshot;
          // pickup rows keep the legacy columns (default method: pickup).
          fulfillmentMethod: isDelivery ? "delivery" : "pickup",
          deliverySnapshot: isDelivery ? deliverySnapshot : null,
          pickupDate: isDelivery ? null : pickupDateToInstant(pickupDate!),
          pickupTime: isDelivery ? null : pickupTime!,
          contactPhone: phone,
          contactEmail: email,
          subtotal: pricing.subtotal,
          shippingCost: pricing.shippingCost,
          discount: pricing.discount,
          serviceFee: pricing.serviceFee,
          ppnRate: pricing.ppnRatePercent,
          ppnAmount: pricing.ppnAmount,
          total: pricing.total,
          ...(pricingSnapshot ? {
            pricingContractVersion: pricingSnapshot.pricingContractVersion,
            pricingEngineVersion: pricingSnapshot.pricingEngineVersion,
            providerContractVersion: pricingSnapshot.providerContractVersion,
            pricingCurrency: pricingSnapshot.currency,
            sourceGoodsSubtotal: pricingSnapshot.sourceGoodsSubtotal,
            markdownTotal: pricingSnapshot.markdownTotal,
            netGoods: pricingSnapshot.netGoods,
            shippingBeforeSubsidy: pricingSnapshot.shippingBeforeSubsidy,
            shippingSubsidy: pricingSnapshot.shippingSubsidy,
            merchantFunding: pricingSnapshot.merchantFunding,
            taxableBase: pricingSnapshot.taxableBase,
            expectedProviderPayable: pricingSnapshot.expectedProviderPayable,
            providerQuotedShippingCost: pricingSnapshot.providerQuotedShippingCost,
            providerBilledShippingCost: pricingSnapshot.providerBilledShippingCost,
            pricingSnapshot,
          } : {}),
          expiresAt,
        }));

        // ===== One Redemption for this order (reserved), atomic with the
        // order/items/stock/intent/receipt. The Offer lock acquired above is
        // still held, so counters and capacity move together in ONE commit. =====
        let reservedRedemptionId: string | null = null;
        if (offerCandidate && pricingSnapshot) {
          const candidate = offerCandidate;
          const inserted = await step(() => insertRedemptionReservation(tx, {
            orderId,
            clientId: session.user.id,
            candidate,
            deadline: expiresAt,
            pricing: pricingSnapshot!,
          }));
          reservedRedemptionId = inserted.redemptionId;
          log.info(
            `redemption reserved atomically with order: redemption ${inserted.redemptionId}, offer ${candidate.offerId}, benefit ${candidate.benefitAmount}`
          );
        }

        // ===== Create order items (with real product names) =====
        const orderItemIdByVariant = new Map<string, string>();
        for (const item of [...selectedItems].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
          const line = pricingSnapshot?.lines.find((line) => line.variantId === item.variantId);
          const orderItemId = crypto.randomUUID();
          orderItemIdByVariant.set(item.variantId, orderItemId);
          await step(() => tx.insert(orderItems).values({
            id: orderItemId,
            orderId,
            variantId: item.variantId,
            productName: item.productName,
            variantInfo: `${item.variantColor || ""} ${item.variantSize || ""}`.trim(),
            price: line?.effectiveUnitPrice ?? item.variantPrice,
            quantity: item.quantity,
            ...(line ? {
              pricingContractVersion: 1,
              sourceUnitPrice: line.sourceUnitPrice,
              markdownAmount: line.markdownAmount,
              goodsDiscountAmount: line.goodsDiscountAmount,
              netLineAmount: line.netLineAmount,
              markdownRevisionId: line.markdownRevisionId,
            } : {}),
          }));
        }

        // ===== Per-line allocation evidence: Markdown is a SEPARATE component
        // from the Offer slot, and a zero allocation is never stored. =====
        if (pricingSnapshot) {
          if (offerCandidate && !reservedRedemptionId) {
            throw new Error("Redemption missing while writing offer allocations");
          }
          await writeOrderDiscountAllocations(tx, {
            orderId,
            orderItemIdByVariant,
            pricing: pricingSnapshot,
            redemption:
              reservedRedemptionId && offerCandidate
                ? { id: reservedRedemptionId, benefitId: offerCandidate.benefitId }
                : null,
          });
        }

        // ===== Atomically hold stock BEFORE the SO POST =====
        // Conditional UPDATE: only increments pending_remote_stock if enough
        // sellable stock remains (provider available − holds ≥ qty) and a
        // provider snapshot exists (fail closed). 0 rows means another
        // concurrent checkout took the last units → throw to roll back.
        for (const item of [...selectedItems].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
          const held = await step(() => tx
            .update(branchStocks)
            .set({
              pendingRemoteStock: sql`${branchStocks.pendingRemoteStock} + ${item.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(branchStocks.branchId, branchId),
                eq(branchStocks.productVariantId, item.variantId),
                // Never hold against a snapshot superseded by a concurrent
                // webhook, checkout, or provider refresh.
                eq(branchStocks.providerStockSyncedAt, stockCheck.observedAt),
                sql`COALESCE(${branchStocks.availableStock}, 0) - ${branchStocks.pendingRemoteStock} >= ${item.quantity}`
              )
            )
            .returning({ branchId: branchStocks.branchId }));
          if (held.length === 0) {
            const snapshot = await step(() => tx
              .select({ availableStock: branchStocks.availableStock, providerStockSyncedAt: branchStocks.providerStockSyncedAt })
              .from(branchStocks)
              .where(
                and(
                  eq(branchStocks.branchId, branchId),
                  eq(branchStocks.productVariantId, item.variantId)
                )
              )
              .limit(1));
            throw new InsufficientStockError(
              item.productName,
              snapshot[0]?.availableStock == null || snapshot[0]?.providerStockSyncedAt?.getTime() !== stockCheck.observedAt.getTime()
            );
          }
          log.info(
            `local SO hold created: variant ${item.variantId}, quantity ${item.quantity}, order ${orderId}`
          );
        }

        // ===== Persist the create intent BEFORE any provider POST =====
        await step(() => recordJubelioSalesIntent(tx, {
          orderId,
          type: "create",
          reference: createReference,
          payload: { type: "create", create: createRequest },
        }));
        if (recovery.identity) {
          const identity = recovery.identity;
          await step(() => tx.insert(checkoutRequests).values({
            id: crypto.randomUUID(), clientId: identity.clientId,
            requestKey: identity.requestKey, fingerprint: identity.fingerprint,
            orderId, result: { version: 1, orderId },
          }));
        }
      });
      recovery.committed = true;

      // Provider call stays OUTSIDE the DB transaction: exactly one SO create
      // POST, confirmed via GET before Midtrans is involved.
      log.info(`Jubelio sales order create dispatched (order ${orderId})`);
      const createOutcome = await dispatchJubelioSalesCreate({
        orderId,
        create: createRequest,
      });
      log.info(`Jubelio sales order create completed (order ${orderId}, status ${createOutcome.status})`);

      if (createOutcome.status !== "confirmed") {
        if (createOutcome.status === "rejected") {
          // Definitive pre-apply rejection: release the hold, fail the order.
          if (recovery.identity) await finalizeRejectedCheckoutCreate(orderId);
          else await db.transaction(async (tx) => {
            const orderRows = await tx
              .select({ branchId: orders.branchId })
              .from(orders)
              .where(eq(orders.id, orderId))
              .limit(1);
            const orderBranchId = orderRows[0]?.branchId;
            if (orderBranchId) {
              for (const item of selectedItems) {
                await tx
                  .update(branchStocks)
                  .set({
                    pendingRemoteStock: sql`GREATEST(0, ${branchStocks.pendingRemoteStock} - ${item.quantity})`,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(branchStocks.branchId, orderBranchId),
                      eq(branchStocks.productVariantId, item.variantId)
                    )
                  );
              }
            }
            await tx
              .update(orders)
              .set({
                status: "failed_payment",
                paymentStatus: "failed",
                paymentFailureReason: createOutcome.message,
                midtransFailureStatus: "sales_order_rejected",
                updatedAt: new Date(),
              })
              .where(
                and(eq(orders.id, orderId), eq(orders.status, "pending_payment"))
              );
          });
          return NextResponse.json(
            {
              success: false,
              error:
                "Stock produk berubah atau tidak mencukupi. Silakan periksa keranjang Anda.",
            },
            { status: 409 }
          );
        }
        // manual_review / in_flight: the create may have been applied or is
        // still unknown. Keep the hold, keep the order pending, never retry.
        const message =
          "Pesanan sedang diproses. Tim kami akan mengonfirmasi ketersediaan stok — silakan cek status pesanan atau hubungi kami.";
        return NextResponse.json(
          { success: false, error: message },
          { status: 503 }
        );
      }

      const initialized = await initializeReservedOrderPayment({
        create: () => {
          const mockRequested =
            process.env.NODE_ENV !== "production" &&
            request.headers.get("x-e2e-payment-mock") === "true";
          const mock = mockRequested
            ? getMockPaymentResult(orderId, {
                MIDTRANS_E2E_MOCK: "true",
                NODE_ENV: "test",
              })
            : null;
          return mock
            ? Promise.resolve(mock)
            : createPayment(
            orderId,
            total,
            {
              first_name: session.user.name || "Customer",
              email,
              phone,
            },
            paymentItemDetails,
            ttlMinutes,
            paymentStartedAt
          );
        },
        persist: async (paymentResult) => {
          await db.transaction(async (tx) => {
            await tx
              .update(orders)
              .set({
                snapRedirectUrl: paymentResult.redirectUrl,
                updatedAt: new Date(),
              })
              .where(eq(orders.id, orderId));

            for (const itemId of selectedItemIds) {
              await tx
                .delete(cartItems)
                .where(
                  and(eq(cartItems.id, itemId), eq(cartItems.cartId, cart.id))
                );
            }
          });
        },
        compensate: async () => {
          await claimAndFailOrder(
            orderId,
            "Payment initialization failed",
            "initialization_error"
          );
          log.error(
            `order ${orderId}: payment initialization failed; sales-order cancel dispatched`,
            new RouteLogError("payment initialization failed")
          );
        },
      });

      const midtransResult = initialized.payment;
      if (initialized.persistenceError) {
        log.error(
          `order ${orderId}: payment created but local metadata needs reconciliation`,
          new RouteLogError("payment metadata persistence failed")
        );
      }

      log.info(
        `order placed successfully: order ${orderId}, total ${pricing.total}, ppn ${pricing.ppnAmount} @ ${pricing.ppnRatePercent}%, redirect ${midtransResult.redirectUrl ? "ada" : "kosong"}`
      );
      if (recovery.identity) {
        const accepted = await findAcceptedCheckout(recovery.identity);
        if (!accepted) throw new Error("Accepted checkout tidak ditemukan setelah commit.");
        return checkoutResultResponse(accepted, false);
      }
      return NextResponse.json({ success: true, orderId, redirectUrl: midtransResult.redirectUrl, token: midtransResult.token });
    } catch (checkoutError) {
      if (recovery.identity && (recovery.committed || checkoutError instanceof AcceptedCheckoutReplay)) {
        log.error(
          `checkout completion interrupted; reading retained result (committed ${!!recovery.committed})`
        );
        const accepted = await findAcceptedCheckout(recovery.identity);
        if (accepted) return checkoutResultResponse(accepted, !recovery.committed);
        throw checkoutError;
      }
      if (checkoutError instanceof CheckoutRequestConflictError || checkoutError instanceof CheckoutReviewRequiredError) throw checkoutError;
      if (checkoutError instanceof RedemptionReviewChangedError) throw new CheckoutReviewRequiredError();
      if (checkoutError instanceof PromoReservationError) {
        log.warn(
          `checkout promo rejected at commit (code ${checkoutError.code}, reason ${checkoutError.reason})`
        );
        return NextResponse.json(
          {
            success: false,
            code: checkoutError.code,
            error: checkoutError.safeMessage,
            requestId: getRequestId(),
          },
          { status: checkoutError.status, headers: { "Cache-Control": "no-store" } }
        );
      }
      if (checkoutError instanceof PricingContractError) {
        log.warn(`checkout source changed before commit (code ${checkoutError.code})`);
        return NextResponse.json({ success: false, code: "CHECKOUT_REVIEW_REQUIRED", error: checkoutError.message }, { status: 409 });
      }
      // Insufficient stock → 400 (customer can retry / pick fewer units).
      if (checkoutError instanceof InsufficientStockError) {
        log.warn(
          `insufficient stock — checkout transaction rolled back (product ${checkoutError.productName}, missingSnapshot ${checkoutError.missingSnapshot})`
        );
        return NextResponse.json(
          {
            success: false,
            error: checkoutError.missingSnapshot
              ? "Stok berubah saat checkout. Silakan coba lagi."
              : checkoutError.message,
          },
          { status: checkoutError.missingSnapshot ? 503 : 400 }
        );
      }
      if (recovery.identity) {
        log.error("checkout transaction unavailable (code POLICY_UNAVAILABLE)");
        return NextResponse.json({ success: false, code: "POLICY_UNAVAILABLE",
          error: "Checkout belum dapat diselesaikan. Coba kembali dengan request yang sama.", requestId: getRequestId() },
          { status: 503, headers: { "Cache-Control": "no-store" } });
      }
      const err = checkoutError as {
        message?: string;
        httpStatusCode?: number;
        ApiResponse?: unknown;
      };
      log.error(
        `Midtrans payment creation failed (http status ${err.httpStatusCode ?? "-"})`,
        new RouteLogError("midtrans payment creation failed")
      );
      // The compensation path marks the order failed and cancels the SO;
      // checked-out cart rows are preserved so the customer can retry.
      return NextResponse.json(
        {
          success: false,
          error:
            err.message ||
            "Failed to initiate payment. Your cart is preserved — please try again.",
        },
        { status: 502 }
      );
    }
  } catch (error) {
    if (error instanceof CheckoutRequestConflictError) throw error;
    if (error instanceof CheckoutAdmissionError) {
      if (error.status === 503) log.error(`checkout admission unavailable (code ${error.code})`);
      else log.warn(`checkout admission denied (code ${error.code})`);
      return NextResponse.json({ success: false, code: error.code, error: error.message, requestId: getRequestId() },
        { status: error.status, headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
    }
    if (error instanceof CheckoutReviewRequiredError) {
      log.warn(
        `checkout review rejected (code ${error.code}, requiresAcknowledgement ${error.requiresAcknowledgement ?? "-"})`
      );
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          error: error.message,
          requestId: getRequestId(),
          ...(error.requiresAcknowledgement
            ? { data: { requiresAcknowledgement: error.requiresAcknowledgement } }
            : {}),
        },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof CheckoutReviewUnavailableError) {
      log.error("checkout review unavailable (code PRICING_UNAVAILABLE)");
      return NextResponse.json({ success: false, code: "PRICING_UNAVAILABLE", error: "Review checkout belum tersedia.", requestId: getRequestId() }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof PromoReservationError) {
      log.warn(`checkout promo rejected (code ${error.code}, reason ${error.reason})`);
      return NextResponse.json(
        { success: false, code: error.code, error: error.safeMessage, requestId: getRequestId() },
        { status: error.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (error instanceof RedemptionReviewChangedError) {
      log.warn("checkout promo review changed (code CHECKOUT_REVIEW_REQUIRED)");
      return NextResponse.json(
        { success: false, code: "CHECKOUT_REVIEW_REQUIRED", error: error.message, requestId: getRequestId() },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (error instanceof CheckoutInputError) {
      log.warn(`checkout body rejected (status ${error.status})`);
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    if (error instanceof PricingContractError) {
      log.warn(`checkout pricing input rejected (code ${error.code})`);
      return NextResponse.json({ success: false, error: "Data harga atau keranjang tidak valid.", code: error.code }, { status: 400 });
    }
    log.error(
      `place order failed (${error instanceof Error ? error.name : "UnknownError"})`,
      new RouteLogError("place order failed")
    );
    return NextResponse.json(
      { success: false, error: "Failed to place order" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(postPlaceOrder, "checkout-place-order");