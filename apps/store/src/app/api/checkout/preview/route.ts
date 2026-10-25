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
import { previewDeliveryReview, deliveryReviewSchema, DeliveryPreviewPromoError } from "@/lib/checkout-delivery-review";
import { DeliveryQuoteDataError } from "@/lib/delivery-quote-data";
import { QuoteDeliveryError } from "@/lib/delivery-quote";
import {
  admitCheckoutRequest,
  carriesManualPromoCode,
  CheckoutAdmissionError,
} from "@/lib/checkout-admission";
import { CheckoutInputError, readCheckoutJson } from "@/lib/checkout-input";
import { validatePickupSlot } from "@/lib/pickup-validation";
import { getDiscountsContractVersion, getPpnRatePercent } from "@/lib/config";
import { buildPricingSnapshot, PricingContractError, type PricingSnapshot } from "@/lib/versioned-pricing";
import { evaluatePricing } from "@marketplace/db/src/discount-pricing";
import type { OfferEligibilityReason } from "@marketplace/db/src/discount-eligibility";
import {
  evaluateSelectedManualCode,
  evaluateSelectedOffer,
  evaluateSelectedPublicOffer,
  mapOfferReasonToHttp,
  offerReasonMessage,
} from "@/lib/discount-selection";
import { readVariantProjections } from "@/lib/variant-price-projection";
import {
  buildCheckoutReviewContextFingerprint,
  CheckoutReviewRequiredError,
  CheckoutReviewUnavailableError,
  createCheckoutReviewToken,
  promoSelectionDigest,
  verifyCheckoutReviewToken,
  type CheckoutReviewPricing,
  type CheckoutReviewPromo,
} from "@/lib/checkout-review";
import {
  comparePromoReplacement,
  promoSelectionOf,
  type PromoReplacementState,
} from "@/lib/promo-replacement";
import {
  createModuleLogger,
  getRequestId,
  withRequestContext,
} from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("checkout-preview");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

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
  | "EMAIL_VERIFICATION_REQUIRED"
  | "CHECKOUT_REVIEW_REQUIRED";

/** Akun hilang di tengah preview: bukan data customer, tanpa bocor existence. */
class PreviewNotFoundError extends Error {
  constructor() {
    super("Akun tidak ditemukan.");
    this.name = "PreviewNotFoundError";
  }
}

function previewFailure(
  status: number,
  code: PreviewErrorCode,
  error: string,
  data?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      code,
      error,
      requestId: getRequestId(),
      ...(data ? { data } : {}),
    },
    { status, headers: { "Cache-Control": "no-store" } }
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
 * Satu slot promo: tanpa promo, satu Coupon publik, atau satu Manual Promo Code
 * (ticket 09). Pilihan "previous" memakai identitas tersimpan (codeId), bukan
 * literal kode, sehingga token tidak pernah membawa kode.
 */
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

/**
 * Penggantian (ticket 08): pilihan promo sebelumnya beserta review token-nya.
 * Token mengikat fingerprint konteks + digest pilihan, jadi klaim promo/total
 * lama tetap divalidasi server dan tidak bisa mengakali dialog kenaikan.
 */
const previousReviewSchema = z.strictObject({
  reviewToken: z.string().min(1).max(2048),
  promoSelection: previousSelectionSchema,
});

const previewRequestSchema = z
  .strictObject({
    phone: z.string().min(8, "Phone number is required").max(20, "Phone number is too long"),
    email: z.string().email("Valid email is required"),
    pickupDate: z.string(), // YYYY-MM-DD
    pickupTime: z.string(), // HH:mm
    selectedItemIds: selectedIdsSchema,
    promoSelection: promoSelectionSchema,
    previous: previousReviewSchema.optional(),
    /** "Lanjut tanpa promo" eksplisit setelah promo yang direview gugur. */
    acknowledgeInvalidation: z.boolean().optional(),
  })
  .refine((value) => value.acknowledgeInvalidation !== true || value.previous != null, {
    message: "acknowledgeInvalidation requires the previous review",
    path: ["acknowledgeInvalidation"],
  });

async function previewCheckout(request: NextRequest): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    // ===== Required versioned-pricing gate (never a silent legacy fallback) ==
    let contractVersion: 0 | 1 | null = null;
    try {
      contractVersion = await getDiscountsContractVersion();
    } catch {
      log.error(
        "checkout preview pricing gate unavailable (outcome error)",
        new RouteLogError("checkout preview pricing gate unavailable")
      );
      return previewFailure(
        503,
        "PRICING_UNAVAILABLE",
        "Harga checkout belum dapat diverifikasi. Silakan coba beberapa saat lagi."
      );
    }
    if (contractVersion !== 1) {
      log.warn(
        "checkout preview rejected — versioned pricing gate is off (outcome unsupported_version)"
      );
      return previewFailure(
        400,
        "UNSUPPORTED_VERSION",
        "Preview checkout berversi belum aktif."
      );
    }

    // Body dibaca lebih dulu (bounded 256KiB) supaya admission tahu apakah
    // request ini membawa manual code — termasuk shape invalid — dan dapat
    // menerapkan bucket code 20/120 setelah authenticated admission.
    const body = await readCheckoutJson(request);
    await admitCheckoutRequest({
      clientId: session.user.id,
      kind: "preview",
      headers: request.headers,
      carriesManualCode: carriesManualPromoCode(body),
    });
    if ((body as { fulfillmentMethod?: unknown } | null)?.fulfillmentMethod === "delivery") {
      const delivery = deliveryReviewSchema.safeParse(body);
      if (!delivery.success) {
        log.warn("delivery review input rejected (outcome invalid_input)");
        return previewFailure(400, "INPUT_INVALID", "Data checkout tidak valid.");
      }
      const data = await previewDeliveryReview(session.user.id, delivery.data);
      log.info(
        `delivery review preview succeeded: total ${data.pricing.total}, goodsDiscount ${data.pricing.discount}, shippingBeforeSubsidy ${data.pricing.shippingBeforeSubsidy}, shippingSubsidy ${data.pricing.shippingSubsidy}, shippingCost ${data.pricing.shippingCost}, fingerprint ${data.contextFingerprint}, promo ${data.promo.kind}, replacement ${data.replacement?.direction ?? "-"}`
      );
      return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
    }
    const parsed = previewRequestSchema.safeParse(body);
    if (!parsed.success) {
      log.warn(
        `checkout preview body rejected (outcome invalid_input, ${parsed.error.issues.length} issue)`
      );
      return previewFailure(400, "INPUT_INVALID", "Data checkout tidak valid.");
    }
    const { phone, email, pickupDate, pickupTime, selectedItemIds } = parsed.data;

    // ===== Owned cart rows (current server prices, never browser money) =====
    const cartRows = await db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);
    if (cartRows.length === 0) {
      log.warn(`checkout preview rejected — cart is empty (outcome invalid_input, user ${session.user.id})`);
      return previewFailure(400, "INPUT_INVALID", "Keranjang masih kosong.");
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
      log.warn(
        `checkout preview rejected — selected items not owned (outcome not_found, ${selectedItemIds.length} selected)`
      );
      return previewFailure(404, "NOT_FOUND", "Barang keranjang tidak ditemukan.");
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
      log.warn(
        `checkout preview rejected — selected line has no branch (outcome invalid_input, ${selected.length} item, ${branchlessCount} tanpa cabang)`
      );
      return previewFailure(
        400,
        "INPUT_INVALID",
        "Checkout hanya untuk satu cabang. Pilih barang dari satu cabang saja."
      );
    }
    const branchIds = new Set(
      selected.map((row) => row.branchId).filter((id): id is string => !!id)
    );
    if (branchIds.size !== 1) {
      log.warn(
        `checkout preview rejected — branch unresolved (outcome invalid_input, ${branchIds.size} cabang)`
      );
      return previewFailure(
        400,
        "INPUT_INVALID",
        "Checkout hanya untuk satu cabang. Pilih barang dari satu cabang saja."
      );
    }
    const branchId = [...branchIds][0];

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
      log.warn("checkout preview rejected — branch not found (outcome not_found)");
      return previewFailure(404, "NOT_FOUND", "Cabang tidak ditemukan.");
    }
    // An inactive or provider-unmapped branch is a readiness problem, not a
    // customer input problem: fail closed without pricing it.
    if (branch.status !== "aktif" || branch.jubelioLocationId == null) {
      log.warn(
        `checkout preview rejected — branch not ready (outcome unavailable, status ${branch.status}, mapped ${branch.jubelioLocationId != null})`
      );
      return previewFailure(
        503,
        "PRICING_UNAVAILABLE",
        "Cabang ini belum siap untuk checkout. Silakan coba beberapa saat lagi."
      );
    }

    const slot = validatePickupSlot(branch.operatingHours, pickupDate, pickupTime);
    if (!slot.ok) {
      log.warn(
        `checkout preview rejected — pickup slot invalid (outcome invalid_input, ${pickupDate} ${pickupTime}, branch ${branchId})`
      );
      return previewFailure(
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
    // display-only and never a reservation. Ticket 08 adds replacement and
    // invalidation on the SAME read-only seam: the previous review is priced
    // authoritatively too, so browser money is never the comparison source.
    const cartItemIdByVariant = new Map(
      selected.map((row) => [row.variantId, row.cartItemId] as const)
    );
    const reviewPricingOf = (value: PricingSnapshot): CheckoutReviewPricing => ({
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
    });
    const contextFingerprintOf = (
      value: PricingSnapshot,
      chosenPromo: CheckoutReviewPromo
    ) =>
      buildCheckoutReviewContextFingerprint({
        clientId: session.user.id,
        contactPhone: phone,
        contactEmail: email,
        pickupDate,
        pickupTime,
        branchId,
        fulfillmentMethod: "pickup",
        promo: chosenPromo,
        pricing: reviewPricingOf(value),
        lines: value.lines.map((line) => ({
          cartItemId: cartItemIdByVariant.get(line.variantId) as string,
          variantId: line.variantId,
          branchId,
          quantity: line.quantity,
          sourceUnitPrice: line.sourceUnitPrice,
        })),
      });

    let verifiedEmail: boolean | null = null;
    type PromoEvaluation =
      | { ok: true; snapshot: PricingSnapshot; promo: CheckoutReviewPromo }
      | { ok: false; reason: OfferEligibilityReason; message: string };
    const ensureVerifiedEmail = async (): Promise<boolean> => {
      if (verifiedEmail !== null) return verifiedEmail;
      const [client] = await db
        .select({ emailVerified: clients.emailVerified })
        .from(clients)
        .where(eq(clients.id, session.user.id))
        .limit(1);
      if (!client) throw new PreviewNotFoundError();
      verifiedEmail = client.emailVerified;
      return verifiedEmail;
    };
    const toEvaluation = (
      evaluation: Awaited<ReturnType<typeof evaluateSelectedPublicOffer>>
    ): PromoEvaluation => {
      if (!evaluation.ok) {
        return {
          ok: false,
          reason: evaluation.reason,
          message: offerReasonMessage(evaluation.reason),
        };
      }
      const candidate = evaluation.candidate;
      const snapshot = evaluatePricing({
        fulfillmentMethod: "pickup",
        ppnRatePercent,
        lines: pricedLines,
        // Bentuk benefit asli (fixed atau percentage rate/cap), bukan nominal
        // yang sudah dibulatkan: allocation/rate tidak hilang dari snapshot.
        benefit: candidate.benefit,
      });
      // Guard konsistensi: nominal yang direservasi WAJIB sama dengan yang
      // dihitung pricing pada subtotal yang sama. Selisih sekecil apa pun
      // menggagalkan permintaan, bukan menghasilkan diskon ambigu.
      if (snapshot.goodsDiscount !== candidate.benefitAmount) {
        throw new Error(
          "promo benefit amount disagrees with the authoritative pricing snapshot"
        );
      }
      return {
        ok: true,
        snapshot,
        promo:
          candidate.activationKind === "manual_only" && candidate.codeId
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
              },
      };
    };
    /** Pilihan dari browser: kode manual masih literal, jadi di-resolve server. */
    const evaluateRequestSelection = async (
      selection: z.infer<typeof promoSelectionSchema>
    ): Promise<PromoEvaluation> => {
      if (selection.kind === "none") {
        return { ok: true, snapshot: baseline, promo: { kind: "none" } };
      }
      const emailVerified = await ensureVerifiedEmail();
      if (selection.kind === "manual") {
        return toEvaluation(
          await evaluateSelectedManualCode({
            code: selection.code,
            clientId: session.user.id,
            verifiedEmail: emailVerified,
            subtotalAfterMarkdown: baseline.subtotal,
          })
        );
      }
      return toEvaluation(
        await evaluateSelectedPublicOffer({
          offerId: selection.offerId,
          clientId: session.user.id,
          verifiedEmail: emailVerified,
          subtotalAfterMarkdown: baseline.subtotal,
        })
      );
    };
    /**
     * Pilihan "previous" dari token sudah berbentuk identitas tersimpan
     * (codeId untuk manual). Server mengevaluasi ulang Offer/kode yang SAMA;
     * tidak ada literal kode yang perlu dipercaya dari browser.
     */
    const evaluatePreviousSelection = async (
      selection: z.infer<typeof previousSelectionSchema>
    ): Promise<PromoEvaluation> => {
      if (selection.kind === "none") {
        return { ok: true, snapshot: baseline, promo: { kind: "none" } };
      }
      const emailVerified = await ensureVerifiedEmail();
      if (selection.kind === "manual") {
        return toEvaluation(
          await evaluateSelectedOffer({
            offerId: selection.offerId,
            clientId: session.user.id,
            verifiedEmail: emailVerified,
            subtotalAfterMarkdown: baseline.subtotal,
            channel: "manual",
            codeId: selection.codeId,
          })
        );
      }
      return toEvaluation(
        await evaluateSelectedPublicOffer({
          offerId: selection.offerId,
          clientId: session.user.id,
          verifiedEmail: emailVerified,
          subtotalAfterMarkdown: baseline.subtotal,
        })
      );
    };

    const requested = await evaluateRequestSelection(parsed.data.promoSelection);
    let snapshot = baseline;
    let promo: CheckoutReviewPromo = { kind: "none" };
    let replacement: PromoReplacementState | null = null;
    let requiresIncreaseAcknowledgement = false;
    let requiresContinueWithoutPromoAcknowledgement = false;

    if (parsed.data.previous) {
      const previous = parsed.data.previous;
      const previousVerification = verifyCheckoutReviewToken(previous.reviewToken);
      // Token mengikat pilihan promo sebelumnya: klaim promo lain ditolak.
      if (
        promoSelectionDigest(previous.promoSelection) !== previousVerification.promoDigest
      ) {
        throw new CheckoutReviewRequiredError();
      }
      const previousResult = await evaluatePreviousSelection(previous.promoSelection);
      if (previousResult.ok) {
        // Penggantian hanya dibandingkan pada KONTEKS SAMA. Cart/slot/harga yang
        // berubah membatalkan approval lama dan wajib preview ulang.
        if (
          contextFingerprintOf(previousResult.snapshot, previousResult.promo) !==
          previousVerification.fingerprint
        ) {
          throw new CheckoutReviewRequiredError();
        }
        if (!requested.ok) {
          // Kandidat gagal tidak mengganti pilihan lama yang masih valid.
          const mapped = mapOfferReasonToHttp(requested.reason);
          log.warn(
            `checkout preview candidate rejected — previous selection kept (outcome promo_ineligible, ${requested.reason})`
          );
          return previewFailure(mapped.status, mapped.code, requested.message);
        }
        const previousPricing = reviewPricingOf(previousResult.snapshot);
        const candidatePricing = reviewPricingOf(requested.snapshot);
        const comparison = comparePromoReplacement(
          {
            promo: previousResult.promo,
            total: previousPricing.total,
            discount: previousPricing.discount,
          },
          {
            promo: requested.promo,
            total: candidatePricing.total,
            discount: candidatePricing.discount,
          }
        );
        snapshot = requested.snapshot;
        promo = requested.promo;
        requiresIncreaseAcknowledgement = comparison.direction === "increase";
        replacement = {
          previous: {
            status: "valid",
            promo: promoSelectionOf(previousResult.promo),
            total: comparison.previousTotal,
          },
          candidate: { promo: promoSelectionOf(requested.promo), total: comparison.candidateTotal },
          direction: comparison.direction,
          deltaTotal: comparison.deltaTotal,
          requiresIncreaseConfirmation: requiresIncreaseAcknowledgement,
        };
      } else {
        // Promo yang direview gugur: alasan aman + customer memilih lagi atau
        // secara eksplisit lanjut tanpa promo. Tidak ada diskon palsu dipertahankan.
        if (!requested.ok) {
          const mapped = mapOfferReasonToHttp(requested.reason);
          log.warn(
            `checkout preview replacement rejected — both promos unavailable (outcome promo_ineligible, previous ${previousResult.reason}, candidate ${requested.reason})`
          );
          return previewFailure(mapped.status, mapped.code, requested.message, {
            previous: {
              status: "invalid",
              promo: previous.promoSelection,
              reason: previousResult.reason,
              message: previousResult.message,
            },
          });
        }
        if (requested.promo.kind === "none") {
          if (parsed.data.acknowledgeInvalidation !== true) {
            const mapped = mapOfferReasonToHttp(previousResult.reason);
            log.warn(
              `checkout preview invalidation awaits explicit continue (outcome promo_invalidated, previous ${previousResult.reason})`
            );
            return previewFailure(
              mapped.status,
              mapped.code,
              `${previousResult.message} Pilih promo lain atau lanjut tanpa promo.`,
              {
                previous: {
                  status: "invalid",
                  promo: previous.promoSelection,
                  reason: previousResult.reason,
                  message: previousResult.message,
                },
                requiresContinueWithoutPromoAcknowledgement: true,
              }
            );
          }
          requiresContinueWithoutPromoAcknowledgement = true;
        }
        snapshot = requested.snapshot;
        promo = requested.promo;
        replacement = {
          previous: {
            status: "invalid",
            promo: previous.promoSelection,
            total: null,
            reason: previousResult.reason,
            message: previousResult.message,
          },
          candidate: {
            promo: promoSelectionOf(requested.promo),
            total: reviewPricingOf(requested.snapshot).total,
          },
          direction: null,
          deltaTotal: null,
          requiresIncreaseConfirmation: false,
        };
      }
    } else if (!requested.ok) {
      const mapped = mapOfferReasonToHttp(requested.reason);
      log.warn(
        `checkout preview promo rejected (outcome promo_ineligible, ${requested.reason})`
      );
      return previewFailure(mapped.status, mapped.code, requested.message);
    } else {
      snapshot = requested.snapshot;
      promo = requested.promo;
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

    // Context binds the exact priced selection (normalized money), the branch
    // and slot, the contact digests, the promo choice (none or one public
    // Coupon identity) and the pricing versions — the fingerprint is what the
    // review token signs.
    const contextFingerprint = contextFingerprintOf(snapshot, promo);
    const { reviewToken, expiresAt } = createCheckoutReviewToken({
      contextFingerprint,
      promo,
      requiresPromoIncreaseAcknowledgement: requiresIncreaseAcknowledgement,
      requiresContinueWithoutPromoAcknowledgement,
    });

    log.info(
      `checkout review preview succeeded (outcome ok): contract v${snapshot.pricingContractVersion}, engine v${snapshot.pricingEngineVersion}, provider v${snapshot.providerContractVersion}, ppn ${pricing.ppnAmount} @ ${pricing.ppnRatePercent}%, total ${pricing.total}, promo ${promo.kind === "none" ? "-" : promo.offerId}, fingerprint ${contextFingerprint}, expires ${expiresAt}, replacement ${replacement?.direction ?? "-"}, previous ${replacement?.previous.status ?? "-"}, increaseAck ${requiresIncreaseAcknowledgement}, continueAck ${requiresContinueWithoutPromoAcknowledgement}`
    );
    return NextResponse.json(
      {
        success: true,
        data: {
          pricing,
          promo,
          reviewToken,
          expiresAt,
          contextFingerprint,
          requiresIncreaseConfirmation: requiresIncreaseAcknowledgement,
          requiresContinueWithoutPromoAcknowledgement,
          replacement,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof CheckoutAdmissionError) {
      if (error.status === 503) log.error(`checkout admission unavailable (code ${error.code})`);
      else log.warn(`checkout admission denied (code ${error.code})`);
      return NextResponse.json({ success: false, code: error.code, error: error.message, requestId: getRequestId() },
        { status: error.status, headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
    }
    if (error instanceof DeliveryPreviewPromoError) {
      log.warn(`delivery review promo rejected (code ${error.code}, outcome promo_ineligible)`);
      return previewFailure(error.status, error.code, error.message, error.data);
    }
    if (error instanceof DeliveryQuoteDataError) {
      log.error(`delivery review data unavailable (code ${error.code})`);
      return previewFailure(error.code === "NOT_FOUND" ? 404 : error.code === "INVALID_INPUT" ? 400 : 503,
        error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code === "INVALID_INPUT" ? "INPUT_INVALID" : "PRICING_UNAVAILABLE", error.message);
    }
    if (error instanceof QuoteDeliveryError) {
      log.error(`delivery review quote unavailable (code ${error.code})`);
      return previewFailure(409, "DELIVERY_REPRICE_REQUIRED", "Layanan pengiriman berubah. Periksa kembali ongkir.");
    }
    if (error instanceof CheckoutInputError) {
      // Size breach keeps the approved 413 contract on size alone; malformed
      // or missing JSON stays a shape rejection (400) — never the reverse.
      const limitExceeded = error.status === 413;
      log.warn(
        `checkout preview body rejected (outcome ${
          limitExceeded ? "limit_exceeded" : "invalid_input"
        }, underlying status ${error.status})`
      );
      return limitExceeded
        ? previewFailure(
            413,
            "INPUT_LIMIT_EXCEEDED",
            "Data checkout melebihi batas ukuran."
          )
        : previewFailure(400, "INPUT_INVALID", "Data checkout tidak valid.");
    }
    if (error instanceof PricingContractError) {
      log.warn(
        `checkout preview pricing input rejected (outcome invalid_input, code ${error.code})`
      );
      return previewFailure(400, "INPUT_INVALID", "Data harga atau keranjang tidak valid.");
    }
    if (error instanceof PreviewNotFoundError) {
      log.warn("checkout preview rejected — client not found (outcome not_found)");
      return previewFailure(404, "NOT_FOUND", error.message);
    }
    if (error instanceof CheckoutReviewRequiredError) {
      log.warn("checkout preview review no longer current (outcome review_required)");
      return previewFailure(409, "CHECKOUT_REVIEW_REQUIRED", error.message);
    }
    if (error instanceof CheckoutReviewUnavailableError) {
      log.error("checkout preview review token unavailable (outcome error)");
      return previewFailure(
        503,
        "PRICING_UNAVAILABLE",
        "Preview checkout belum tersedia. Silakan coba beberapa saat lagi."
      );
    }
    log.error(
      "checkout preview failed (outcome error)",
      new RouteLogError("checkout preview failed")
    );
    // Authoritative data could not be read: never price from a stale/empty
    // fallback, keep the client on an explicit retry.
    return previewFailure(
      503,
      "PRICING_UNAVAILABLE",
      "Preview checkout gagal diproses. Silakan coba beberapa saat lagi."
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(previewCheckout, "checkout-preview");
