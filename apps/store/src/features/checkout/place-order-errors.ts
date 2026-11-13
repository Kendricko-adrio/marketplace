import { CheckoutAdmissionError } from "@/lib/checkout-admission";
import { CheckoutInputError } from "@/lib/checkout-input";
import { CheckoutReviewRequiredError, CheckoutReviewUnavailableError } from "@/lib/checkout-review";
import { CheckoutRequestConflictError } from "@/lib/checkout-request";
import { PricingContractError } from "@/lib/versioned-pricing";
import { RedemptionReviewChangedError } from "@/lib/discount-reservation";
import { DeliveryQuoteDataError } from "@/lib/delivery-quote-data";
import { CheckoutAttemptReservationError } from "./checkout-attempt";
import { CheckoutTaxUnavailableError } from "./prepare-checkout-tax-service";

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari Midtrans,
 * Jubelio, atau DB tidak pernah masuk log — hanya pesan yang ditulis module ini.
 */
export class RouteLogError extends Error {
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
export class PromoReservationError extends Error {
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
export class InsufficientStockError extends Error {
  constructor(
    public productName: string,
    public missingSnapshot = false
  ) {
    super(`Insufficient stock for ${productName}`);
    this.name = "InsufficientStockError";
  }
}

export type PlaceOrderFailurePhase = "delivery" | "tax" | "attempt" | "legacy" | "workflow" | "recovery";

export type PlaceOrderErrorDecision =
  | { kind: "rethrow" | "unexpected" | "delivery-reprice" | "attempt-unavailable" | "recovery-unavailable"; error: unknown }
  | { kind: "translate-review" | "review-required"; error: CheckoutReviewRequiredError }
  | { kind: "request-conflict"; error: CheckoutRequestConflictError }
  | { kind: "admission"; error: CheckoutAdmissionError }
  | { kind: "review-unavailable"; error: CheckoutReviewUnavailableError }
  | { kind: "promo-reservation"; error: PromoReservationError }
  | { kind: "redemption-review"; error: RedemptionReviewChangedError }
  | { kind: "input"; error: CheckoutInputError }
  | { kind: "pricing-review" | "pricing-input"; error: PricingContractError }
  | { kind: "stock"; error: InsufficientStockError }
  | { kind: "delivery-data"; error: DeliveryQuoteDataError }
  | { kind: "tax-unavailable"; error: CheckoutTaxUnavailableError }
  | { kind: "attempt-reservation"; error: CheckoutAttemptReservationError };

export type PlaceOrderFailure = { phase: PlaceOrderFailurePhase; decision: PlaceOrderErrorDecision };

/** Keputusan hanya berlaku setelah pemilik boundary menjalankan recovery berbasis state. */
export function classifyPlaceOrderError(phase: PlaceOrderFailurePhase, error: unknown): PlaceOrderErrorDecision {
  if (phase === "delivery") {
    return error instanceof DeliveryQuoteDataError
      ? { kind: "delivery-data", error }
      : { kind: "delivery-reprice", error };
  }
  if (phase === "tax") {
    return error instanceof CheckoutTaxUnavailableError
      ? { kind: "tax-unavailable", error }
      : { kind: "rethrow", error };
  }
  if (phase === "attempt") {
    return error instanceof CheckoutAttemptReservationError
      ? { kind: "attempt-reservation", error }
      : { kind: "attempt-unavailable", error };
  }
  if (phase === "recovery") {
    return error instanceof CheckoutRequestConflictError
      ? { kind: "request-conflict", error }
      : { kind: "recovery-unavailable", error };
  }
  if (error instanceof CheckoutRequestConflictError) return { kind: "rethrow", error };
  if (phase === "legacy") {
    if (error instanceof CheckoutReviewRequiredError) return { kind: "rethrow", error };
    if (error instanceof RedemptionReviewChangedError) return { kind: "translate-review", error: new CheckoutReviewRequiredError() };
    if (error instanceof PromoReservationError) return { kind: "promo-reservation", error };
    if (error instanceof PricingContractError) return { kind: "pricing-review", error };
    if (error instanceof InsufficientStockError) return { kind: "stock", error };
    return { kind: "unexpected", error };
  }
  if (error instanceof CheckoutAdmissionError) return { kind: "admission", error };
  if (error instanceof CheckoutReviewRequiredError) return { kind: "review-required", error };
  if (error instanceof CheckoutReviewUnavailableError) return { kind: "review-unavailable", error };
  if (error instanceof PromoReservationError) return { kind: "promo-reservation", error };
  if (error instanceof RedemptionReviewChangedError) return { kind: "redemption-review", error };
  if (error instanceof CheckoutInputError) return { kind: "input", error };
  if (error instanceof PricingContractError) return { kind: "pricing-input", error };
  return { kind: "unexpected", error };
}
