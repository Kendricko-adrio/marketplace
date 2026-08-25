import { describe, it, expect, afterEach } from "vitest";
import crypto from "crypto";
import {
  amountsMatch,
  getMockPaymentResult,
  resolveMidtransBaseUrl,
  validateMidtransWebhookPayload,
  verifyMidtransSignature,
} from "./midtrans";

// Backs POST /api/webhooks/midtrans signature verification.
// Expected values computed independently with node:crypto (the same SHA512
// construction the Midtrans docs specify, written out in the test).

const SERVER_KEY = "test-server-key-123";

afterEach(() => {
  delete process.env.MIDTRANS_SERVER_KEY;
});

describe("verifyMidtransSignature", () => {
  it("accepts a valid signature", () => {
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    const orderId = "order-123";
    const statusCode = "200";
    const grossAmount = "100000.00";
    const expected = crypto
      .createHash("sha512")
      .update(orderId + statusCode + grossAmount + SERVER_KEY)
      .digest("hex");

    expect(
      verifyMidtransSignature(orderId, statusCode, grossAmount, expected)
    ).toBe(true);
  });

  it("rejects a tampered signature", () => {
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    expect(
      verifyMidtransSignature("order-123", "200", "100000.00", "deadbeef")
    ).toBe(false);
  });

  it("rejects when the server key is not configured", () => {
    delete process.env.MIDTRANS_SERVER_KEY;
    expect(
      verifyMidtransSignature("order-123", "200", "100000.00", "deadbeef")
    ).toBe(false);
  });

  it("is sensitive to each input component", () => {
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    const orderId = "order-123";
    const statusCode = "200";
    const grossAmount = "100000.00";
    const expected = crypto
      .createHash("sha512")
      .update(orderId + statusCode + grossAmount + SERVER_KEY)
      .digest("hex");

    // Same signature with a different order id must not match.
    expect(
      verifyMidtransSignature("order-124", statusCode, grossAmount, expected)
    ).toBe(false);
    // Same signature with a different gross amount must not match.
    expect(
      verifyMidtransSignature(orderId, statusCode, "99999.00", expected)
    ).toBe(false);
  });
});

describe("validateMidtransWebhookPayload", () => {
  it("rejects a notification without a signature", () => {
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    expect(
      validateMidtransWebhookPayload({
        order_id: "order-123",
        transaction_status: "settlement",
        status_code: "200",
        gross_amount: "100000.00",
      })
    ).toEqual({ ok: false, error: "Invalid notification", status: 400 });
  });

  it("accepts a complete notification with a valid signature", () => {
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    const signature = crypto
      .createHash("sha512")
      .update("order-123200100000.00" + SERVER_KEY)
      .digest("hex");
    expect(
      validateMidtransWebhookPayload({
        order_id: "order-123",
        transaction_status: "settlement",
        status_code: "200",
        gross_amount: "100000.00",
        signature_key: signature,
      })
    ).toMatchObject({ ok: true });
  });
});

describe("amountsMatch", () => {
  it("compares currency values at cent precision", () => {
    expect(amountsMatch("100000", "100000.00")).toBe(true);
    expect(amountsMatch("100000.01", "100000.00")).toBe(false);
    expect(amountsMatch("not-a-number", "100000.00")).toBe(false);
  });
});

describe("resolveMidtransBaseUrl", () => {
  it("allows the local status boundary only outside production", () => {
    expect(
      resolveMidtransBaseUrl({
        NODE_ENV: "development",
        MIDTRANS_MOCK_API_BASE_URL: "http://127.0.0.1:3002/",
      })
    ).toBe("http://127.0.0.1:3002");
    expect(
      resolveMidtransBaseUrl({
        NODE_ENV: "production",
        MIDTRANS_MOCK_API_BASE_URL: "http://127.0.0.1:3002",
        MIDTRANS_IS_PRODUCTION: "true",
      })
    ).toBe("https://api.midtrans.com");
  });
});

describe("getMockPaymentResult", () => {
  it("is available only outside production when explicitly enabled", () => {
    expect(
      getMockPaymentResult("order-123", {
        MIDTRANS_E2E_MOCK: "true",
        NODE_ENV: "test",
      })
    ).toEqual({
      redirectUrl: "http://localhost:3000/checkout/payment-test?orderId=order-123",
      token: "e2e-order-123",
    });
    expect(
      getMockPaymentResult("order-123", {
        MIDTRANS_E2E_MOCK: "true",
        NODE_ENV: "production",
      })
    ).toBeNull();
  });
});
