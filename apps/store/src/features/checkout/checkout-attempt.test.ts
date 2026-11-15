import { describe, expect, it } from "vitest";
import { presentCheckoutAttempt, type CheckoutAttemptView } from "./checkout-attempt";

const now = new Date("2026-10-25T10:00:00Z");
const attempt: CheckoutAttemptView = {
  id: "attempt-owned", requestKey: "b1200000-0000-4000-8000-000000000023",
  state: "rejected", orderId: null, failureCode: "SALES_ORDER_REJECTED",
  expiresAt: new Date("2026-10-25T10:15:00Z"),
  paymentStatus: null, orderStatus: null, redirectUrl: null,
};

describe("checkout attempt public outcome", () => {
  it("keeps a definitive SO rejection in checkout without an order or payment link", () => {
    expect(presentCheckoutAttempt(attempt, now)).toEqual({
      version: 2, requestKey: "b1200000-0000-4000-8000-000000000023",
      attemptId: "attempt-owned", state: "rejected", orderId: null,
      paymentAvailable: false, redirectUrl: null, retryAllowed: true,
      failureCode: "SALES_ORDER_REJECTED",
      message: "Pesanan belum dibuat. Produk belum dapat dipesan. Periksa ulang pesanan lalu coba lagi.",
      expiresAt: "2026-10-25T10:15:00.000Z",
    });
  });

  it("refuses a promoted result without a committed order", () => {
    expect(() => presentCheckoutAttempt({ ...attempt, state: "promoted" }, now))
      .toThrow("Promoted checkout requires an order");
  });

  it.each(["preparing", "processing", "compensating", "manual_review"] as const)(
    "never exposes a payment or retry link while %s, even with stray payment metadata", (state) => {
      expect(presentCheckoutAttempt({ ...attempt, state, failureCode: null,
        orderId: "reserved-not-an-order", redirectUrl: "https://payment.example.test/session",
        orderStatus: "pending_payment", paymentStatus: "pending" }, now))
        .toMatchObject({ state, orderId: null, paymentAvailable: false, redirectUrl: null, retryAllowed: false });
    },
  );

  it("allows retry only after a definitive payment rejection is compensated", () => {
    expect(presentCheckoutAttempt({ ...attempt, failureCode: "PAYMENT_INITIALIZATION_REJECTED" }, now))
      .toMatchObject({ orderId: null, retryAllowed: true,
        message: "Pembayaran belum dapat disiapkan. Pesanan belum dibuat. Periksa ulang pesanan lalu coba lagi." });
  });

  it("offers the persisted session only for an eligible promoted order", () => {
    expect(presentCheckoutAttempt({ ...attempt, state: "promoted", failureCode: null,
      orderId: "committed-order", orderStatus: "pending_payment", paymentStatus: "pending",
      redirectUrl: "https://payment.example.test/session" }, now))
      .toMatchObject({ orderId: "committed-order", paymentAvailable: true,
        redirectUrl: "https://payment.example.test/session", retryAllowed: false });
  });

  it.each([
    { paymentStatus: "paid", orderStatus: "processing", at: now },
    { paymentStatus: "pending", orderStatus: "pending_payment", at: new Date("2026-10-25T10:15:00Z") },
    { paymentStatus: "failed", orderStatus: "failed_payment", at: now },
  ])("does not reopen a paid, failed or expired payment: %o", ({ at, ...order }) => {
    expect(presentCheckoutAttempt({ ...attempt, ...order, state: "promoted", failureCode: null,
      orderId: "committed-order", redirectUrl: "https://payment.example.test/session" }, at))
      .toMatchObject({ orderId: "committed-order", paymentAvailable: false, redirectUrl: null, retryAllowed: false });
  });
});
