import { afterEach, describe, expect, it, vi } from "vitest";
import { createMidtransPaymentClient, PaymentGatewayConfigError } from "./midtrans-payment-client";

const reference = "order-123";
const expectedAmount = "111000";
const sandbox = { MIDTRANS_SERVER_KEY: "fixture-server-key" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function providerStatus(overrides: Record<string, unknown> = {}) {
  return {
    order_id: reference,
    gross_amount: "111000.00",
    transaction_status: "settlement",
    status_code: "200",
    transaction_id: "tx-1",
    payment_type: "qris",
    fraud_status: "accept",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createMidtransPaymentClient.observePayment", () => {
  it("reads an authoritative GET status for a matching order as paid", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, providerStatus()));
    vi.stubGlobal("fetch", fetchMock);

    const observation = await createMidtransPaymentClient(sandbox).observePayment({
      reference,
      expectedAmount,
    });

    expect(observation).toMatchObject({ kind: "paid", reference, amount: "111000.00" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sandbox.midtrans.com/v2/order-123/status");
    expect(init.method).toBe("GET");
  });

  it("separates 404 (no session) from transport failures and mismatched payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { status_code: "404" })));
    const notFound = await createMidtransPaymentClient(sandbox).observePayment({
      reference,
      expectedAmount,
    });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    const unreachable = await createMidtransPaymentClient(sandbox).observePayment({
      reference,
      expectedAmount,
    });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, providerStatus({ order_id: "other" }))));
    const mismatched = await createMidtransPaymentClient(sandbox).observePayment({
      reference,
      expectedAmount,
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 200 })));
    const malformed = await createMidtransPaymentClient(sandbox).observePayment({
      reference,
      expectedAmount,
    });

    expect(notFound.kind).toBe("not_found");
    expect(unreachable).toMatchObject({ kind: "unknown", reason: "provider_unavailable" });
    expect(mismatched).toMatchObject({ kind: "unknown", reason: "reference_mismatch" });
    expect(malformed).toMatchObject({ kind: "unknown", reason: "malformed_response" });
  });

  it("refuses to run without a server key instead of guessing a status", async () => {
    await expect(
      createMidtransPaymentClient({}).observePayment({ reference, expectedAmount })
    ).rejects.toBeInstanceOf(PaymentGatewayConfigError);
  });
});

describe("createMidtransPaymentClient.expirePayment", () => {
  it("treats a 200 answer with status_code 407 and transaction_status expire as expired", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        status_code: "407",
        status_message: "Success, transaction has expired",
        order_id: reference,
        gross_amount: "111000.00",
        transaction_status: "expire",
        transaction_id: "tx-1",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const observation = await createMidtransPaymentClient(sandbox).expirePayment({
      reference,
      expectedAmount,
    });

    expect(observation).toMatchObject({ kind: "expired", reference, amount: "111000.00" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sandbox.midtrans.com/v2/order-123/expire");
    expect(init.method).toBe("POST");
  });

  it("does not swallow a business 412 into success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          status_code: "412",
          status_message: "Merchant cannot modify the status of the transaction",
        })
      )
    );

    const observation = await createMidtransPaymentClient(sandbox).expirePayment({
      reference,
      expectedAmount,
    });

    expect(observation).toMatchObject({ kind: "unknown", reason: "expire_conflict" });
  });

  it("keeps a timeout, non-2xx answer and malformed body unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const timeout = await createMidtransPaymentClient(sandbox).expirePayment({
      reference,
      expectedAmount,
    });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { status_code: "500" })));
    const serverError = await createMidtransPaymentClient(sandbox).expirePayment({
      reference,
      expectedAmount,
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const malformed = await createMidtransPaymentClient(sandbox).expirePayment({
      reference,
      expectedAmount,
    });

    expect(timeout).toMatchObject({ kind: "unknown", reason: "provider_unavailable" });
    expect(serverError).toMatchObject({ kind: "unknown", reason: "provider_unavailable" });
    expect(malformed).toMatchObject({ kind: "unknown", reason: "malformed_response" });
  });

  it("reports the current status when the channel answers with it instead of expiring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, providerStatus({ transaction_status: "settlement" }))
      )
    );

    const observation = await createMidtransPaymentClient(sandbox).expirePayment({
      reference,
      expectedAmount,
    });

    expect(observation).toMatchObject({ kind: "paid" });
  });
});
