import { describe, expect, it } from "vitest";
import { PricingContractError } from "@/lib/versioned-pricing";
import { RedemptionReviewChangedError } from "@/lib/discount-reservation";
import { CheckoutReviewRequiredError } from "@/lib/checkout-review";
import { CheckoutRequestConflictError } from "@/lib/checkout-request";
import { classifyPlaceOrderError, InsufficientStockError, PromoReservationError, RouteLogError } from "./place-order-errors";

describe("place-order phase-aware error decisions", () => {
  it("keeps pricing rejection distinct at legacy and workflow boundaries", () => {
    const error = new PricingContractError("PRICING_INPUT_INVALID", "Changed");
    expect(classifyPlaceOrderError("legacy", error)).toEqual({ kind: "pricing-review", error });
    expect(classifyPlaceOrderError("workflow", error)).toEqual({ kind: "pricing-input", error });
  });
  it("translates redemption drift only at the legacy boundary", () => {
    const error = new RedemptionReviewChangedError();
    const legacy = classifyPlaceOrderError("legacy", error);
    expect(legacy.kind).toBe("translate-review");
    expect(legacy.error).toBeInstanceOf(CheckoutReviewRequiredError);
    expect(legacy.error).toMatchObject({ message: "Periksa kembali rincian pesanan dan konfirmasikan checkout terbaru." });
    expect(classifyPlaceOrderError("workflow", error)).toEqual({ kind: "redemption-review", error });
  });
  it("preserves conflict identity for recovery instead of swallowing it", () => {
    const error = new CheckoutRequestConflictError();
    expect(classifyPlaceOrderError("workflow", error)).toEqual({ kind: "rethrow", error });
    expect(classifyPlaceOrderError("legacy", error)).toEqual({ kind: "rethrow", error });
    expect(classifyPlaceOrderError("recovery", error)).toEqual({ kind: "request-conflict", error });
  });
  it("does not reuse workflow pricing mapping inside delivery", () => {
    const error = new PricingContractError("PRICING_INPUT_INVALID", "Changed");
    expect(classifyPlaceOrderError("delivery", error)).toEqual({ kind: "delivery-reprice", error });
  });
  it.each([new Error("Unknown"), "thrown string", null])("preserves unknown failures for their owning boundary (%s)", (error) => {
    expect(classifyPlaceOrderError("workflow", error)).toEqual({ kind: "unexpected", error });
    expect(classifyPlaceOrderError("legacy", error)).toEqual({ kind: "unexpected", error });
    expect(classifyPlaceOrderError("tax", error)).toEqual({ kind: "rethrow", error });
    expect(classifyPlaceOrderError("attempt", error)).toEqual({ kind: "attempt-unavailable", error });
    expect(classifyPlaceOrderError("delivery", error)).toEqual({ kind: "delivery-reprice", error });
    expect(classifyPlaceOrderError("recovery", error)).toEqual({ kind: "recovery-unavailable", error });
  });
  it("keeps stock snapshot and promo error metadata intact", () => {
    const stock = new InsufficientStockError("Shoes", true);
    expect(stock).toMatchObject({ name: "InsufficientStockError", message: "Insufficient stock for Shoes", productName: "Shoes", missingSnapshot: true });
    expect(classifyPlaceOrderError("legacy", stock)).toEqual({ kind: "stock", error: stock });
    const promo = new PromoReservationError(409, "PROMO_CHANGED", "Changed", "expired");
    expect(promo).toMatchObject({ name: "PromoReservationError", message: "Changed", safeMessage: "Changed", reason: "expired", status: 409 });
    expect(classifyPlaceOrderError("legacy", promo)).toEqual({ kind: "promo-reservation", error: promo });
    expect(classifyPlaceOrderError("workflow", promo)).toEqual({ kind: "promo-reservation", error: promo });
    expect(new RouteLogError("Safe projection")).toMatchObject({ name: "RouteLogError", message: "Safe projection" });
  });
});
