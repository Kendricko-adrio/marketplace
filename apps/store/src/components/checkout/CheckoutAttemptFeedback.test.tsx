import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckoutAttemptFeedback } from "./CheckoutAttemptFeedback";
import type { CheckoutAttemptResult } from "@/features/checkout/checkout-attempt";

const promoted: CheckoutAttemptResult = {
  version: 2, requestKey: "request", attemptId: "attempt", state: "promoted",
  orderId: "order", paymentAvailable: true, redirectUrl: "https://payment.example.test",
  retryAllowed: false, failureCode: null, message: "Mengarahkan ke pembayaran...",
  expiresAt: "2040-01-02T12:10:00Z",
};

function render(result: CheckoutAttemptResult, busy = false) {
  return renderToStaticMarkup(createElement(CheckoutAttemptFeedback, {
    result, busy, onCheckStatus: () => {}, onReviewAgain: () => {},
  }));
}

describe("CheckoutAttemptFeedback", () => {
  it("does not flash an error panel for a successful checkout, including while navigating", () => {
    expect(render(promoted, true)).toBe("");
    expect(render(promoted)).toBe("");
    expect(render({ ...promoted, paymentAvailable: false, redirectUrl: null })).toBe("");
  });

  it("keeps genuine rejection feedback and its recovery action visible", () => {
    const html = render({ ...promoted, state: "rejected", orderId: null,
      paymentAvailable: false, redirectUrl: null, retryAllowed: true,
      message: "Pesanan belum dibuat. Periksa ulang pesanan lalu coba lagi." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Pesanan belum dibuat.");
    expect(html).toContain("Periksa ulang pesanan");
  });

  it("keeps unresolved checkout feedback and status lookup visible", () => {
    const html = render({ ...promoted, state: "processing", orderId: null,
      paymentAvailable: false, redirectUrl: null, message: "Checkout masih diproses." });
    expect(html).toContain('role="status"');
    expect(html).toContain("Checkout masih diproses.");
    expect(html).toContain("Periksa status checkout");
  });
});
