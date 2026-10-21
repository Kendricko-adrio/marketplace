/**
 * POST /api/checkout/preview — authoritative checkout REVIEW PREVIEW
 * (ticket 02, stage 1: pickup without promo).
 *
 * The browser NEVER supplies identity, branch, source price or money: the body
 * is exactly the existing pickup checkout fields plus an explicit promo
 * choice `{ kind: "none" }`. The server loads the OWNED cart rows with current
 * variant prices, the single active + mapped pickup branch, its operating
 * hours and the configured PPN rate, derives the displayed breakdown with the
 * same versioned pricing engine the order will persist, then returns the
 * fingerprint-bound signed review token.
 *
 * Hard boundaries of this endpoint:
 * - READ ONLY: no order, no stock hold, no Redemption/usage row, no payment and
 *   no provider HTTP (Jubelio sales/midtrans are never called here);
 * - the versioned pricing gate is REQUIRED: gate 0 answers an explicit
 *   400 `UNSUPPORTED_VERSION` — there is no silent legacy fallback;
 * - body bounds keep their approved precedence: a body over 256 KiB answers
 *   413 `INPUT_LIMIT_EXCEEDED` on size alone, before shape validation, while
 *   missing/malformed JSON stays a 400 `INPUT_INVALID`;
 * - the selection is loaded with one bounded `WHERE cart AND id IN (≤50)`, so
 *   no whole-cart read ever leaves the database;
 * - a selected cart line without a branch is rejected as 400 `INPUT_INVALID`
 *   on the raw rows (before the branch set is built), so the branchless line is
 *   never silently dropped into a priced remainder;
 * - the response carries `Cache-Control: no-store`;
 * - logging is PII-safe: ids, counts, version numbers, safe money and the
 *   fingerprint hash only — never phone/email/token.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branches, cartItems, carts, clients, productVariants } from "@/db";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { previewDeliveryReview, deliveryReviewSchema } from "@/lib/checkout-delivery-review";
import { DeliveryQuoteDataError } from "@/lib/delivery-quote-data";
import { QuoteDeliveryError } from "@/lib/delivery-quote";
import { admitCheckoutRequest, CheckoutAdmissionError } from "@/lib/checkout-admission";
import { CheckoutInputError, readCheckoutJson } from "@/lib/checkout-input";
import { validatePickupSlot } from "@/lib/pickup-validation";
import { getDiscountsContractVersion, getPpnRatePercent } from "@/lib/config";
import { buildPricingSnapshot, PricingContractError } from "@/lib/versioned-pricing";
import { evaluatePricing } from "@marketplace/db/src/discount-pricing";
import {
  evaluateSelectedPublicOffer,
  mapOfferReasonToHttp,
  offerReasonMessage,
} from "@/lib/discount-selection";
import { readVariantProjections } from "@/lib/variant-price-projection";
import {
  buildCheckoutReviewContextFingerprint,
  CheckoutReviewUnavailableError,
  createCheckoutReviewToken,
  type CheckoutReviewPricing,
  type CheckoutReviewPromo,
} from "@/lib/checkout-review";
import {
  requestLogger,
  serializeError,
  withRequestId,
  type Logger,
} from "@/lib/logger";

type PreviewErrorCode =
  | "INPUT_INVALID"
  | "INPUT_LIMIT_EXCEEDED"
  | "NOT_FOUND"
  | "UNSUPPORTED_VERSION"
  | "PRICING_UNAVAILABLE"
  | "DELIVERY_REPRICE_REQUIRED"
  | "PROMO_UNAVAILABLE"
  | "PROMO_INELIGIBLE"
  | "PROMO_CAPACITY_UNAVAILABLE"
  | "EMAIL_VERIFICATION_REQUIRED";

function previewFailure(
  log: Logger,
  status: number,
  code: PreviewErrorCode,
  error: string
): NextResponse {
  return withRequestId(
    NextResponse.json(
      { success: false, code, error, requestId: log.requestId },
      { status, headers: { "Cache-Control": "no-store" } }
    ),
    log
  );
}

const selectedIdsSchema = z
  .array(z.string().min(1).max(128))
  .min(1, "Select at least one item to checkout")
  .max(50)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Duplicate selected cart item IDs"
  );

/**
 * Strict pickup preview body: the existing pickup checkout fields plus the
 * explicit promo choice this contract version supports. Ticket 07 enables ONE
 * public Coupon selection; delivery promo selection belongs to ticket 11, and
 * manual codes to ticket 09.
 */
const previewRequestSchema = z.strictObject({
  phone: z.string().min(8, "Phone number is required").max(20, "Phone number is too long"),
  email: z.string().email("Valid email is required"),
  pickupDate: z.string(), // YYYY-MM-DD
  pickupTime: z.string(), // HH:mm
  selectedItemIds: selectedIdsSchema,
  promoSelection: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      kind: z.literal("public"),
      offerId: z.string().min(1).max(128),
    }),
  ]),
});

export async function POST(request: NextRequest) {
  let log = requestLogger(request, { module: "checkout-preview" });
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return withRequestId(access.response, log);
    const { session } = access;
    log = log.child({ userId: session.user.id });

    // ===== Required versioned-pricing gate (never a silent legacy fallback) ==
    let contractVersion: 0 | 1 | null = null;
    try {
      contractVersion = await getDiscountsContractVersion();
    } catch (gateError) {
      log.error("checkout preview pricing gate unavailable", {
        outcome: "error",
        error: serializeError(gateError),
      });
      return previewFailure(
        log,
        503,
        "PRICING_UNAVAILABLE",
        "Harga checkout belum dapat diverifikasi. Silakan coba beberapa saat lagi."
      );
    }
    if (contractVersion !== 1) {
      log.warn("checkout preview rejected — versioned pricing gate is off", {
        outcome: "unsupported_version",
      });
      return previewFailure(
        log,
        400,
        "UNSUPPORTED_VERSION",
        "Preview checkout berversi belum aktif."
      );
    }

    await admitCheckoutRequest({ clientId: session.user.id, kind: "preview", headers: request.headers });
    const body = await readCheckoutJson(request);
    if ((body as { fulfillmentMethod?: unknown } | null)?.fulfillmentMethod === "delivery") {
      const delivery = deliveryReviewSchema.safeParse(body);
      if (!delivery.success) {
        log.warn("delivery review input rejected", { outcome: "invalid_input" });
        return previewFailure(log, 400, "INPUT_INVALID", "Data checkout tidak valid.");
      }
      const data = await previewDeliveryReview(session.user.id, delivery.data);
      log.info("delivery review preview succeeded", { total: data.pricing.total, contextFingerprint: data.contextFingerprint });
      return withRequestId(NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } }), log);
    }
    const parsed = previewRequestSchema.safeParse(body);
    if (!parsed.success) {
      log.warn("checkout preview body rejected", {
        outcome: "invalid_input",
        issueCount: parsed.error.issues.length,
      });
      return previewFailure(log, 400, "INPUT_INVALID", "Data checkout tidak valid.");
    }
    const { phone, email, pickupDate, pickupTime, selectedItemIds } = parsed.data;

    // ===== Owned cart rows (current server prices, never browser money) =====
    const cartRows = await db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);
    if (cartRows.length === 0) {
      log.warn("checkout preview rejected — cart is empty", { outcome: "invalid_input" });
      return previewFailure(log, 400, "INPUT_INVALID", "Keranjang masih kosong.");
    }
    const cartId = cartRows[0].id;

    // Scoped, bounded read: only the caller's cart AND the requested (≤50)
    // ids are fetched — the cart is never read in full.
    const selected = await db
      .select({
        cartItemId: cartItems.id,
        quantity: cartItems.quantity,
        variantId: productVariants.id,
        variantPrice: productVariants.price,
        branchId: cartItems.branchId,
      })
      .from(cartItems)
      .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
      .where(
        and(eq(cartItems.cartId, cartId), inArray(cartItems.id, selectedItemIds))
      );

    // Ids outside the caller's cart are not the caller's data → not found.
    if (selected.length !== selectedItemIds.length) {
      log.warn("checkout preview rejected — selected items not owned", {
        outcome: "not_found",
        selectedCount: selectedItemIds.length,
      });
      return previewFailure(log, 404, "NOT_FOUND", "Barang keranjang tidak ditemukan.");
    }

    // ===== Exactly one branch (pickup origin) ==============================
    // A selected cart line WITHOUT a branch cannot be priced for pickup. This
    // is checked on the raw rows BEFORE any set is built over the non-null
    // ids: filtering the branchless rows out first would silently price the
    // remainder and hand the browser a review token for a selection the order
    // path cannot honour. The whole selection is rejected instead — never a
    // silent null→some-branch mapping, never a partial price.
    const branchlessCount = selected.reduce(
      (count, row) => (row.branchId ? count : count + 1),
      0
    );
    if (branchlessCount > 0) {
      log.warn("checkout preview rejected — selected line has no branch", {
        outcome: "invalid_input",
        itemCount: selected.length,
        branchlessCount,
      });
      return previewFailure(
        log,
        400,
        "INPUT_INVALID",
        "Checkout hanya untuk satu cabang. Pilih barang dari satu cabang saja."
      );
    }
    const branchIds = new Set(
      selected.map((row) => row.branchId).filter((id): id is string => !!id)
    );
    if (branchIds.size !== 1) {
      log.warn("checkout preview rejected — branch unresolved", {
        outcome: "invalid_input",
        branchCount: branchIds.size,
      });
      return previewFailure(
        log,
        400,
        "INPUT_INVALID",
        "Checkout hanya untuk satu cabang. Pilih barang dari satu cabang saja."
      );
    }
    const branchId = [...branchIds][0];
    log = log.child({ branchId, itemCount: selected.length });

    const branchRows = await db
      .select({
        status: branches.status,
        operatingHours: branches.operatingHours,
        jubelioLocationId: branches.jubelioLocationId,
      })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);
    const branch = branchRows[0];
    if (!branch) {
      log.warn("checkout preview rejected — branch not found", { outcome: "not_found" });
      return previewFailure(log, 404, "NOT_FOUND", "Cabang tidak ditemukan.");
    }
    // An inactive or provider-unmapped branch is a readiness problem, not a
    // customer input problem: fail closed without pricing it.
    if (branch.status !== "aktif" || branch.jubelioLocationId == null) {
      log.warn("checkout preview rejected — branch not ready", {
        outcome: "unavailable",
        branchStatus: branch.status,
        mapped: branch.jubelioLocationId != null,
      });
      return previewFailure(
        log,
        503,
        "PRICING_UNAVAILABLE",
        "Cabang ini belum siap untuk checkout. Silakan coba beberapa saat lagi."
      );
    }

    const slot = validatePickupSlot(branch.operatingHours, pickupDate, pickupTime);
    if (!slot.ok) {
      log.warn("checkout preview rejected — pickup slot invalid", {
        outcome: "invalid_input",
        pickupDate,
        pickupTime,
      });
      return previewFailure(
        log,
        400,
        "INPUT_INVALID",
        slot.error ?? "Jadwal pickup tidak valid."
      );
    }

    // One Markdown projection read for the selected lines; the review context
    // binds these effective prices, so any later source/target change is caught
    // before an order is committed.
    const projections = await readVariantProjections(
      selected.map((line) => line.variantId)
    );

    // ===== Authoritative breakdown from the versioned pricing engine ======
    const ppnRatePercent = await getPpnRatePercent();
    const pricedLines = [...selected]
      .sort((a, b) =>
        a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0
      )
      .map((line) => {
        const projection = projections.get(line.variantId);
        return {
          variantId: line.variantId,
          quantity: line.quantity,
          sourceUnitPrice: line.variantPrice,
          effectiveUnitPrice: projection?.effectiveUnitPrice ?? line.variantPrice,
          markdownRevisionId: projection?.markdownRevisionId ?? null,
        };
      });
    const baseline = buildPricingSnapshot({
      fulfillmentMethod: "pickup",
      ppnRatePercent,
      lines: pricedLines,
    });

    // ===== One public Coupon in the single promo slot (ticket 07) ==========
    // Eligibility is evaluated against the subtotal AFTER Markdown; a capacity
    // decision is re-checked under the Offer lock at place-order, so this is
    // display-only and never a reservation.
    let snapshot = baseline;
    let promo: CheckoutReviewPromo = { kind: "none" };
    if (parsed.data.promoSelection.kind === "public") {
      const [client] = await db
        .select({ emailVerified: clients.emailVerified })
        .from(clients)
        .where(eq(clients.id, session.user.id))
        .limit(1);
      if (!client) {
        return previewFailure(log, 404, "NOT_FOUND", "Akun tidak ditemukan.");
      }
      const evaluation = await evaluateSelectedPublicOffer({
        offerId: parsed.data.promoSelection.offerId,
        clientId: session.user.id,
        verifiedEmail: client.emailVerified,
        subtotalAfterMarkdown: baseline.subtotal,
      });
      if (!evaluation.ok) {
        const mapped = mapOfferReasonToHttp(evaluation.reason);
        log.warn("checkout preview promo rejected", {
          outcome: "promo_ineligible",
          reason: evaluation.reason,
        });
        return previewFailure(
          log,
          mapped.status,
          mapped.code,
          offerReasonMessage(evaluation.reason)
        );
      }
      const candidate = evaluation.candidate;
      snapshot = evaluatePricing({
        fulfillmentMethod: "pickup",
        ppnRatePercent,
        lines: pricedLines,
        benefit: {
          kind: "fixed_goods",
          paramsVersion: 1,
          fixedAmount: candidate.benefitAmount,
        },
      });
      promo = {
        kind: "public",
        offerId: candidate.offerId,
        revisionId: candidate.revisionId,
        benefitId: candidate.benefitId,
        benefitAmount: candidate.benefitAmount,
      };
      log = log.child({ offerId: candidate.offerId });
    }

    // Existing checkout wire names; `discount` is the v1 goods discount. The
    // Markdown totals are additive so the UI can show the coretan breakdown.
    const pricing = {
      subtotal: snapshot.subtotal,
      discount: snapshot.goodsDiscount,
      sourceGoodsSubtotal: snapshot.sourceGoodsSubtotal,
      markdownTotal: snapshot.markdownTotal,
      taxableBase: snapshot.taxableBase,
      shippingCost: snapshot.shippingCost,
      serviceFee: snapshot.serviceFee,
      ppnRatePercent: snapshot.ppnRatePercent,
      ppnAmount: snapshot.ppnAmount,
      total: snapshot.total,
    };
    const reviewPricing: CheckoutReviewPricing = {
      ...pricing,
      currency: snapshot.currency,
      pricingContractVersion: snapshot.pricingContractVersion,
      pricingEngineVersion: snapshot.pricingEngineVersion,
      providerContractVersion: snapshot.providerContractVersion,
    };

    // Context binds the exact priced selection (normalized money), the branch
    // and slot, the contact digests, the promo choice (none or one public
    // Coupon identity) and the pricing versions — the fingerprint is what the
    // review token signs.
    const cartItemIdByVariant = new Map(
      selected.map((row) => [row.variantId, row.cartItemId] as const)
    );
    const contextFingerprint = buildCheckoutReviewContextFingerprint({
      clientId: session.user.id,
      contactPhone: phone,
      contactEmail: email,
      pickupDate,
      pickupTime,
      branchId,
      fulfillmentMethod: "pickup",
      promo,
      pricing: reviewPricing,
      lines: snapshot.lines.map((line) => ({
        cartItemId: cartItemIdByVariant.get(line.variantId) as string,
        variantId: line.variantId,
        branchId,
        quantity: line.quantity,
        sourceUnitPrice: line.sourceUnitPrice,
      })),
    });
    const { reviewToken, expiresAt } = createCheckoutReviewToken({ contextFingerprint });

    log.info("checkout review preview succeeded", {
      outcome: "ok",
      pricingContractVersion: snapshot.pricingContractVersion,
      pricingEngineVersion: snapshot.pricingEngineVersion,
      providerContractVersion: snapshot.providerContractVersion,
      ppnRatePercent: pricing.ppnRatePercent,
      ppnAmount: pricing.ppnAmount,
      total: pricing.total,
      contextFingerprint,
      expiresAt,
    });
    return withRequestId(
      NextResponse.json(
        { success: true, data: { pricing, promo, reviewToken, expiresAt, contextFingerprint } },
        { headers: { "Cache-Control": "no-store" } }
      ),
      log
    );
  } catch (error) {
    if (error instanceof CheckoutAdmissionError) {
      if (error.status === 503) log.error("checkout admission unavailable", { code: error.code });
      else log.warn("checkout admission denied", { code: error.code });
      return withRequestId(NextResponse.json({ success: false, code: error.code, error: error.message, requestId: log.requestId },
        { status: error.status, headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } }), log);
    }
    if (error instanceof DeliveryQuoteDataError) {
      log.error("delivery review data unavailable", { code: error.code });
      return previewFailure(log, error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_INPUT" ? 400 : 503,
        error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code === "INVALID_INPUT" ? "INPUT_INVALID" : "PRICING_UNAVAILABLE", error.message);
    }
    if (error instanceof QuoteDeliveryError) {
      log.error("delivery review quote unavailable", { code: error.code });
      return previewFailure(log, 409, "DELIVERY_REPRICE_REQUIRED", "Layanan pengiriman berubah. Periksa kembali ongkir.");
    }
    if (error instanceof CheckoutInputError) {
      // Size breach keeps the approved 413 contract on size alone; malformed
      // or missing JSON stays a shape rejection (400) — never the reverse.
      const limitExceeded = error.status === 413;
      log.warn("checkout preview body rejected", {
        outcome: limitExceeded ? "limit_exceeded" : "invalid_input",
        underlyingStatus: error.status,
      });
      return limitExceeded
        ? previewFailure(
            log,
            413,
            "INPUT_LIMIT_EXCEEDED",
            "Data checkout melebihi batas ukuran."
          )
        : previewFailure(log, 400, "INPUT_INVALID", "Data checkout tidak valid.");
    }
    if (error instanceof PricingContractError) {
      log.warn("checkout preview pricing input rejected", {
        outcome: "invalid_input",
        code: error.code,
      });
      return previewFailure(log, 400, "INPUT_INVALID", "Data harga atau keranjang tidak valid.");
    }
    if (error instanceof CheckoutReviewUnavailableError) {
      log.error("checkout preview review token unavailable", { outcome: "error" });
      return previewFailure(
        log,
        503,
        "PRICING_UNAVAILABLE",
        "Preview checkout belum tersedia. Silakan coba beberapa saat lagi."
      );
    }
    log.error("checkout preview failed", {
      outcome: "error",
      error: serializeError(error),
    });
    // Authoritative data could not be read: never price from a stale/empty
    // fallback, keep the client on an explicit retry.
    return previewFailure(
      log,
      503,
      "PRICING_UNAVAILABLE",
      "Preview checkout gagal diproses. Silakan coba beberapa saat lagi."
    );
  }
}
