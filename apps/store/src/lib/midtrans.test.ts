import { describe, it, expect, afterEach } from "vitest";
import crypto from "crypto";
import { verifyMidtransSignature } from "./midtrans";

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
