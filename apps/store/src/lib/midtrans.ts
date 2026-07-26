import { Snap, type TransactionParameter } from "midtrans-client";
import crypto from "crypto";

let snapClient: Snap | null = null;

function getSnapClient(): Snap {
  if (snapClient) return snapClient;

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const clientKey = process.env.MIDTRANS_CLIENT_KEY;

  if (!serverKey) {
    throw new Error(
      "MIDTRANS_SERVER_KEY is not configured. Set it in your .env file."
    );
  }

  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";

  snapClient = new Snap({
    isProduction,
    serverKey,
    clientKey: clientKey || undefined,
  });

  return snapClient;
}

function getMidtransBaseUrl(): string {
  return process.env.MIDTRANS_IS_PRODUCTION === "true"
    ? "https://api.midtrans.com"
    : "https://api.sandbox.midtrans.com";
}

export interface QrisCustomerDetails {
  first_name: string;
  email: string;
  phone: string;
}

export interface QrisItemDetail {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface CreateSnapPaymentResult {
  redirectUrl: string;
  token: string;
}

/**
 * Create a Snap transaction restricted to QRIS payment.
 * Returns the redirect_url (Snap payment page) and token.
 * The customer is redirected to Midtrans' hosted Snap page.
 *
 * @param expiryMinutes Optional order expiry in minutes. When set, Midtrans
 *   will auto-expire the transaction and send an `expire` webhook at this
 *   duration — the primary release path for the stock reservation. Should
 *   match `reservation.ttlMinutes` from system_config. Note: Midtrans
 *   recommends expiry >= 15 min (shorter durations may be delayed by their
 *   scheduler).
 */
export async function createSnapQrisPayment(
  orderId: string,
  grossAmount: number,
  customerDetails: QrisCustomerDetails,
  itemDetails?: QrisItemDetail[],
  expiryMinutes?: number
): Promise<CreateSnapPaymentResult> {
  const snap = getSnapClient();

  const parameter: TransactionParameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    payment_methods: ["qris"],
    customer_details: {
      first_name: customerDetails.first_name,
      email: customerDetails.email,
      phone: customerDetails.phone,
    },
    item_details: itemDetails,
    credit_card: { secure: true },
    ...(expiryMinutes && expiryMinutes > 0
      ? {
          expiry: {
            unit: "minute" as const,
            duration: Math.floor(expiryMinutes),
          },
        }
      : {}),
  };

  try {
    const transaction = await snap.createTransaction(parameter);

    return {
      redirectUrl: transaction.redirect_url,
      token: transaction.token,
    };
  } catch (error) {
    // Midtrans client throws MidtransError with:
    // .message, .httpStatusCode, .ApiResponse, .rawHttpClientData
    const err = error as {
      message?: string;
      httpStatusCode?: number;
      ApiResponse?: unknown;
    };
    console.error("Midtrans Snap createTransaction failed:", {
      orderId,
      grossAmount,
      message: err.message,
      httpStatusCode: err.httpStatusCode,
      apiResponse: err.ApiResponse,
    });
    throw error;
  }
}

/**
 * Unified payment creation. Always uses Midtrans Snap (redirect flow).
 * Returns redirectUrl + token for the Snap payment page.
 */
export async function createPayment(
  orderId: string,
  grossAmount: number,
  customerDetails: QrisCustomerDetails,
  itemDetails?: QrisItemDetail[],
  expiryMinutes?: number
): Promise<CreateSnapPaymentResult> {
  return createSnapQrisPayment(
    orderId,
    grossAmount,
    customerDetails,
    itemDetails,
    expiryMinutes
  );
}

/**
 * Verify a Midtrans webhook notification's signature_key.
 * Classic Snap signature = SHA512(order_id + status_code + gross_amount + serverKey).
 */
export function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  signatureKey: string
): boolean {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) return false;

  const expected = crypto
    .createHash("sha512")
    .update(orderId + statusCode + grossAmount + serverKey)
    .digest("hex");

  return expected === signatureKey;
}

/**
 * Shape of the Midtrans /v2/{order_id}/status response.
 * Only the fields we care about are typed here.
 */
export interface MidtransTransactionStatus {
  transaction_status: string;
  status_code: string;
  status_message?: string;
  fraud_status?: string;
  payment_type?: string;
  order_id?: string;
  transaction_id?: string;
  gross_amount?: string;
  settlement_time?: string;
  expiry_time?: string;
}

/**
 * Re-verify a transaction's status directly with Midtrans.
 * Calls GET /v2/{order_id}/status using Basic Auth (server-key:).
 *
 * Best practice per Midtrans docs: after receiving a webhook notification,
 * always fetch the authoritative status from Midtrans before mutating your
 * database, to defend against spoofed callbacks.
 */
export async function getMidtransTransactionStatus(
  orderId: string
): Promise<MidtransTransactionStatus | null> {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    throw new Error(
      "MIDTRANS_SERVER_KEY is not configured. Set it in your .env file."
    );
  }

  const baseUrl = getMidtransBaseUrl();
  const auth = Buffer.from(`${serverKey}:`).toString("base64");

  const res = await fetch(`${baseUrl}/v2/${encodeURIComponent(orderId)}/status`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      // Transaction not found at Midtrans
      return null;
    }
    const text = await res.text();
    throw new Error(
      `Midtrans status check failed (${res.status}): ${text}`
    );
  }

  return (await res.json()) as MidtransTransactionStatus;
}

/**
 * Best-effort attempt to expire a pending Midtrans transaction.
 * Used by the sweep cron when a pending_payment order's reservation TTL has
 * elapsed but no `expire` webhook has arrived yet. Safe to call on a
 * transaction that is already expired/settled — a Midtrans 400 in that case is
 * logged and swallowed (we proceed to fail the order locally regardless).
 *
 * Uses the Snap client's `transaction.expire(orderId)` helper.
 */
export async function expireMidtransTransaction(
  orderId: string
): Promise<void> {
  try {
    const snap = getSnapClient();
    await snap.transaction.expire(orderId);
  } catch (error) {
    const err = error as { message?: string; httpStatusCode?: number };
    // 400 "Transaction status has expired"/"already settled" etc. is expected
    // when the sweep races the Midtrans scheduler or the webhook. Log and move on.
    console.warn("Midtrans expire call failed (best-effort, ignoring):", {
      orderId,
      message: err.message,
      httpStatusCode: err.httpStatusCode,
    });
  }
}