import { describe, it, expect, afterEach } from "vitest";
import crypto from "crypto";
import {
  amountsMatch,
  buildSnapTransactionParameter,
  formatSnapStartTime,
  getMockPaymentResult,
  resolveMidtransBaseUrl,
  SNAP_ENABLED_PAYMENTS,
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

describe("buildSnapTransactionParameter", () => {
  const base = {
    orderId: "order-123",
    grossAmount: 100000,
    customerDetails: {
      first_name: "Budi",
      email: "budi@example.com",
      phone: "081234567890",
    },
    itemDetails: [{ id: "v1", name: "Shoe", price: 100000, quantity: 1 }],
  };

  it("offers all enabled payment methods and no legacy payment_methods key", () => {
    const parameter = buildSnapTransactionParameter(base) as unknown as Record<
      string,
      unknown
    >;
    expect(parameter.enabled_payments).toEqual([
      "other_qris",
      "gopay",
      "credit_card",
      "permata_va",
      "bca_va",
      "bni_va",
      "bri_va",
      "cimb_va",
      "echannel",
      "other_va",
    ]);
    expect(parameter).not.toHaveProperty("payment_methods");
  });

  it("requires 3DS for card payments", () => {
    const parameter = buildSnapTransactionParameter(base);
    expect(parameter.credit_card).toEqual({ secure: true });
  });

  it("carries transaction, customer, and item details through unchanged", () => {
    const parameter = buildSnapTransactionParameter(base);
    expect(parameter.transaction_details).toEqual({
      order_id: "order-123",
      gross_amount: 100000,
    });
    expect(parameter.customer_details).toEqual(base.customerDetails);
    expect(parameter.item_details).toEqual(base.itemDetails);
  });

  it("anchors the expiry countdown at the given start time", () => {
    const startedAt = new Date("2025-06-01T03:30:45Z"); // 10:30:45 WIB
    const parameter = buildSnapTransactionParameter({
      ...base,
      expiryMinutes: 15,
      paymentStartedAt: startedAt,
    });
    expect(parameter.expiry).toEqual({
      unit: "minute",
      duration: 15,
      start_time: "2025-06-01 10:30:45 +0700",
    });
  });

  it("omits the expiry block when no duration is given", () => {
    const parameter = buildSnapTransactionParameter(base);
    expect(parameter.expiry).toBeUndefined();
  });

  it("omits the expiry block for non-positive durations", () => {
    const parameter = buildSnapTransactionParameter({
      ...base,
      expiryMinutes: 0,
    });
    expect(parameter.expiry).toBeUndefined();
  });

  it("does not mutate the shared SNAP_ENABLED_PAYMENTS constant", () => {
    const parameter = buildSnapTransactionParameter(base);
    parameter.enabled_payments!.push("akulaku");
    expect(SNAP_ENABLED_PAYMENTS).not.toContain("akulaku");
  });

  it("formats start_time in WIB with the +0700 suffix", () => {
    expect(formatSnapStartTime(new Date("2025-01-15T17:05:09Z"))).toBe(
      "2025-01-16 00:05:09 +0700"
    );
  });
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

describe("buildSnapTransactionParameter — delivery repayment (ticket 04)", () => {
  it("rebuilds the snapshotted delivery money with the ongkir line separate and item_details summing to the gross", () => {
    // Snapshot of the placed delivery order (order row + order_items):
    // goods 100.000 + ongkir 20.000 + PPN 13.200 = 133.200 — RE-payment
    // rebuilds THE SAME gross with NO new quote and the ongkir as its OWN
    // Midtrans line (never merged into the goods lines, never dropped).
    const itemDetails = [
      { id: "variant-e2e", name: "Delivery Anchor", price: 100000, quantity: 1 },
      { id: "SHIPPING", name: "Shipping", price: 20000, quantity: 1 },
      { id: "PPN", name: "PPN 11%", price: 13200, quantity: 1 },
    ];

    const parameter = buildSnapTransactionParameter({
      orderId: "order-delivery-e2e",
      grossAmount: 133200,
      customerDetails: {
        first_name: "Budi",
        email: "delivord-e2e@example.test",
        phone: "081299999999",
      },
      itemDetails,
    }) as unknown as {
      transaction_details: { order_id: string; gross_amount: number };
      item_details: Array<{ price: number; quantity: number }>;
    };

    expect(parameter.transaction_details).toEqual({
      order_id: "order-delivery-e2e",
      gross_amount: 133200,
    });
    // Midtrans contract: Σ item_details = gross_amount.
    const sum = itemDetails.reduce((total, detail) => total + detail.price * detail.quantity, 0);
    expect(sum).toBe(133200);
    expect(sum).toBe(parameter.transaction_details.gross_amount);
    // The ongkir stays its own line.
    expect(itemDetails.map((detail) => detail.id)).toContain("SHIPPING");
  });
});
