import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckoutAttemptFeedback, type CheckoutCheckState } from "./CheckoutAttemptFeedback";
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

function renderState(result: CheckoutAttemptResult, checkState: CheckoutCheckState) {
  return renderToStaticMarkup(createElement(CheckoutAttemptFeedback, {
    result, busy: checkState === "checking", checkState,
    onCheckStatus: () => {}, onReviewAgain: () => {},
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

  it("uses an attention tone, not destructive, for an uncertain attempt", () => {
    const html = render({ ...promoted, state: "manual_review", orderId: null,
      paymentAvailable: false, redirectUrl: null, message: "Checkout sedang diperiksa." });
    expect(html).not.toContain("border-destructive/40");
    expect(html).toContain("border-amber-300");
  });

  it("reports the read-only lookup result inline without claiming failure", () => {
    const unchanged = renderState({ ...promoted, state: "processing", orderId: null,
      paymentAvailable: false, redirectUrl: null }, "unchanged");
    expect(unchanged).toContain("Status belum berubah. Silakan periksa lagi nanti.");
    expect(unchanged).not.toContain("Pembayaran gagal");

    const error = renderState({ ...promoted, state: "processing", orderId: null,
      paymentAvailable: false, redirectUrl: null }, "error");
    expect(error).toContain("Status belum dapat diperiksa. Coba lagi.");
  });

  it("renders nothing for the idle lookup state", () => {
    const html = renderState({ ...promoted, state: "processing", orderId: null,
      paymentAvailable: false, redirectUrl: null }, "idle");
    expect(html).not.toContain("Status belum berubah");
    expect(html).not.toContain("Status belum dapat diperiksa");
  });
});
