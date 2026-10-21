/**
 * checkout-review — narrow server-side helper for the checkout REVIEW PREVIEW
 * (ticket 02, stage 1). It owns exactly two things:
 *
 *   1. the canonical review CONTEXT and its SHA-256 `contextFingerprint`
 *      (sorted selection, stable keys, normalized money), and
 *   2. the signed, versioned review TOKEN bound to that fingerprint.
 *
 * The token payload carries ONLY hashes, versions and an absolute expiry: no
 * phone, email, address, cart price list, promo code or token is ever part of
 * it. The signing key is derived from the existing `BETTER_AUTH_SECRET` with
 * its own domain separation, so no new environment variable and no new
 * dependency is introduced, and this token is never an auth/permission
 * credential. A missing secret FAILS CLOSED (`CheckoutReviewUnavailableError`)
 * instead of producing a blank/unsigned token.
 *
 * Verifikasi signature dan expiry dilakukan sebelum placement baru; caller
 * membandingkan fingerprint dengan context authoritative milik client saat ini.
 * Accepted replay tidak memverifikasi ulang token yang mungkin telah expired.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DeliverySnapshotPayload } from "@marketplace/db/src/schema";

/** Version of the canonical review context (fingerprint input). */
export const CHECKOUT_REVIEW_CONTEXT_VERSION = 1;
/** Version of the signed review token payload. */
export const CHECKOUT_REVIEW_TOKEN_VERSION = 1;
/** Review token lifetime: 10 minutes (spec §5.3). */
export const CHECKOUT_REVIEW_TTL_MS = 10 * 60_000;

/**
 * Domain separation for the review signing key. The derived key is used for
 * review tokens ONLY, so the same server secret can never be replayed across
 * the internal order-complete HMAC or another signing purpose.
 */
const REVIEW_SIGNING_DOMAIN = "okcir:discounts:checkout-review:v1";

/** Thrown when the review token cannot be signed (missing server secret). */
export class CheckoutReviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutReviewUnavailableError";
  }
}

/** The authoritative money shown to the customer, plus the pricing versions. */
export interface CheckoutReviewPricing {
  subtotal: string;
  discount: string;
  taxableBase: string;
  shippingCost: string;
  serviceFee: string;
  ppnRatePercent: string;
  ppnAmount: string;
  total: string;
  currency: string;
  pricingContractVersion: number;
  pricingEngineVersion: number;
  providerContractVersion: number;
}

/** One priced selection line; money/quantity already normalized by the engine. */
export interface CheckoutReviewSelectionLine {
  cartItemId: string;
  variantId: string;
  branchId: string;
  quantity: number;
  sourceUnitPrice: string;
}

export interface CheckoutReviewContext {
  /** Owner identity — bound as a digest, never stored raw in the payload. */
  clientId: string;
  contactPhone: string;
  contactEmail: string;
  pickupDate: string | null;
  pickupTime: string | null;
  branchId: string;
  fulfillmentMethod: "pickup" | "delivery";
  deliverySnapshot?: DeliverySnapshotPayload | null;
  /** Satu slot promo: tanpa promo atau satu Coupon publik (ticket 07). */
  promo: CheckoutReviewPromo;
  pricing: CheckoutReviewPricing;
  lines: readonly CheckoutReviewSelectionLine[];
}

/**
 * Promo choice bound by the review token. The public variant carries the SAME
 * identity the order will persist (Offer/revision/benefit/actual amount), so a
 * token cannot be replayed for another Coupon or a changed benefit.
 */
export type CheckoutReviewPromo =
  | { kind: "none" }
  | {
      kind: "public";
      offerId: string;
      revisionId: string;
      benefitId: string;
      benefitAmount: string;
    };

function canonicalReviewValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalReviewValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, v]) => [key, canonicalReviewValue(v)]));
  return value;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Contact is bound as a digest so no raw phone/email enters the payload. */
function contactDigest(phone: string, email: string): string {
  return sha256Hex(JSON.stringify({ email: email.trim(), phone: phone.trim() }));
}

/**
 * Canonical SHA-256 fingerprint of the review context. Selection lines are
 * sorted by cart item id and every object uses a fixed key order, so the same
 * context always produces the same fingerprint and any change to the owned
 * selection, branch, slot, contact, promo choice, pricing rules or displayed
 * breakdown changes it.
 */
export function buildCheckoutReviewContextFingerprint(
  context: CheckoutReviewContext
): string {
  const selection = [...context.lines]
    .sort((a, b) =>
      a.cartItemId < b.cartItemId ? -1 : a.cartItemId > b.cartItemId ? 1 : 0
    )
    .map((line) => ({
      cartItemId: line.cartItemId,
      variantId: line.variantId,
      branchId: line.branchId,
      quantity: line.quantity,
      sourceUnitPrice: line.sourceUnitPrice,
    }));

  return sha256Hex(
    JSON.stringify({
      contextVersion: CHECKOUT_REVIEW_CONTEXT_VERSION,
      client: sha256Hex(context.clientId),
      contact: contactDigest(context.contactPhone, context.contactEmail),
      fulfillmentMethod: context.fulfillmentMethod,
      branchId: context.branchId,
      pickup: { date: context.pickupDate, time: context.pickupTime },
      // ETA bukan persetujuan harga; destination/origin/parcel/service wajib sama.
      ...(context.fulfillmentMethod === "delivery" ? {
        delivery: sha256Hex(JSON.stringify(canonicalReviewValue({
          address: context.deliverySnapshot?.address, origin: context.deliverySnapshot?.origin,
          parcel: context.deliverySnapshot?.parcel,
          courierId: context.deliverySnapshot?.service.courierId,
          serviceId: context.deliverySnapshot?.service.serviceId,
        }))),
      } : {}),
      promo: context.promo.kind === "none"
        ? { kind: "none" }
        : {
            kind: "public",
            offerId: context.promo.offerId,
            revisionId: context.promo.revisionId,
            benefitId: context.promo.benefitId,
            benefitAmount: context.promo.benefitAmount,
          },
      pricing: {
        pricingContractVersion: context.pricing.pricingContractVersion,
        pricingEngineVersion: context.pricing.pricingEngineVersion,
        providerContractVersion: context.pricing.providerContractVersion,
        currency: context.pricing.currency,
        subtotal: context.pricing.subtotal,
        discount: context.pricing.discount,
        taxableBase: context.pricing.taxableBase,
        shippingCost: context.pricing.shippingCost,
        serviceFee: context.pricing.serviceFee,
        ppnRatePercent: context.pricing.ppnRatePercent,
        ppnAmount: context.pricing.ppnAmount,
        total: context.pricing.total,
      },
      selection,
    })
  );
}

export class CheckoutReviewRequiredError extends Error {
  readonly code = "CHECKOUT_REVIEW_REQUIRED";
  constructor() {
    super("Periksa kembali rincian pesanan dan konfirmasikan checkout terbaru.");
    this.name = "CheckoutReviewRequiredError";
  }
}

/** Membaca hanya token canonical bertanda tangan; tidak menerima harga browser. */
export function verifyCheckoutReviewToken(token: string, now = new Date()): string {
  const secret = (process.env.BETTER_AUTH_SECRET ?? "").trim();
  if (!secret) throw new CheckoutReviewUnavailableError("Review checkout belum tersedia.");
  if (typeof token !== "string" || token.length > 2048) throw new CheckoutReviewRequiredError();
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    throw new CheckoutReviewRequiredError();
  }
  const [encoded, signature] = parts;
  const expected = createHmac("sha256", reviewSigningKey(secret)).update(encoded).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.toString("base64url") !== signature || received.length !== expected.length ||
      !timingSafeEqual(received, expected)) throw new CheckoutReviewRequiredError();
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { throw new CheckoutReviewRequiredError(); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CheckoutReviewRequiredError();
  const value = payload as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "exp,fp,v" || value.v !== CHECKOUT_REVIEW_TOKEN_VERSION ||
      typeof value.fp !== "string" || !/^[a-f0-9]{64}$/.test(value.fp) ||
      !Number.isSafeInteger(value.exp) || (value.exp as number) * 1000 <= now.getTime() ||
      (value.exp as number) * 1000 > now.getTime() + CHECKOUT_REVIEW_TTL_MS) {
    throw new CheckoutReviewRequiredError();
  }
  return value.fp;
}

export interface CheckoutReviewToken {
  /** `<base64url(payload)>.<base64url(HMAC-SHA256)>` — opaque to the client. */
  reviewToken: string;
  /** Absolute expiry as ISO8601 with an explicit timezone (UTC `Z`). */
  expiresAt: string;
}

function reviewSigningKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(REVIEW_SIGNING_DOMAIN).digest();
}

/**
 * Signs the review token for a context fingerprint. Fail closed: a blank
 * `BETTER_AUTH_SECRET` never yields a token.
 */
export function createCheckoutReviewToken(input: {
  contextFingerprint: string;
  now?: Date;
}): CheckoutReviewToken {
  const secret = (process.env.BETTER_AUTH_SECRET ?? "").trim();
  if (!secret) {
    throw new CheckoutReviewUnavailableError(
      "BETTER_AUTH_SECRET tidak tersedia untuk menandatangani review checkout."
    );
  }
  if (!/^[a-f0-9]{64}$/.test(input.contextFingerprint)) {
    throw new Error("contextFingerprint harus berupa SHA-256 hex");
  }

  const issuedAt = input.now ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHECKOUT_REVIEW_TTL_MS);

  const payload = Buffer.from(
    JSON.stringify({
      v: CHECKOUT_REVIEW_TOKEN_VERSION,
      fp: input.contextFingerprint,
      exp: Math.floor(expiresAt.getTime() / 1000),
    }),
    "utf8"
  ).toString("base64url");
  const signature = createHmac("sha256", reviewSigningKey(secret))
    .update(payload)
    .digest("base64url");

  return { reviewToken: `${payload}.${signature}`, expiresAt: expiresAt.toISOString() };
}
