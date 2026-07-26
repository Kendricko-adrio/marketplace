import { Snap } from "midtrans-client";
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

  // Sanity check: Midtrans key prefix must match the configured environment.
  // Sandbox keys start with "SB-Mid-server-" / "SB-Mid-client-".
  // Production keys start with "Mid-server-" / "Mid-client-".
  if (isProduction && !serverKey.startsWith("Mid-server")) {
    throw new Error(
      "MIDTRANS_IS_PRODUCTION=true but MIDTRANS_SERVER_KEY is not a production key (expected prefix 'Mid-server'). Check your .env."
    );
  }
  if (!isProduction && !serverKey.startsWith("SB-Mid-server")) {
    throw new Error(
      "MIDTRANS_IS_PRODUCTION=false (sandbox) but MIDTRANS_SERVER_KEY is not a sandbox key (expected prefix 'SB-Mid-server'). Check your .env."
    );
  }

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
 */
export async function createSnapQrisPayment(
  orderId: string,
  grossAmount: number,
  customerDetails: QrisCustomerDetails,
  itemDetails?: QrisItemDetail[]
): Promise<CreateSnapPaymentResult> {
  const snap = getSnapClient();

  const parameter = {
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
  itemDetails?: QrisItemDetail[]
): Promise<CreateSnapPaymentResult> {
  return createSnapQrisPayment(
    orderId,
    grossAmount,
    customerDetails,
    itemDetails
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