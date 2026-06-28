import { CoreApi, Snap } from "midtrans-client";
import crypto from "crypto";

let coreApiClient: CoreApi | null = null;
let snapClient: Snap | null = null;

function getCoreApiClient(): CoreApi {
  if (coreApiClient) return coreApiClient;

  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const clientKey = process.env.MIDTRANS_CLIENT_KEY;

  if (!serverKey) {
    throw new Error(
      "MIDTRANS_SERVER_KEY is not configured. Set it in your .env file."
    );
  }

  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";

  coreApiClient = new CoreApi({
    isProduction,
    serverKey,
    clientKey: clientKey || undefined,
  });

  return coreApiClient;
}

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

/** Returns the configured payment mode: "core" (default) or "snap". */
export function getPaymentMode(): "core" | "snap" {
  return process.env.MIDTRANS_PAYMENT_MODE === "snap" ? "snap" : "core";
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

export interface CreateQrisChargeResult {
  transactionId: string;
  qrString: string;
  qrImageUrl: string;
}

export interface CreateSnapPaymentResult {
  redirectUrl: string;
  token: string;
}

export type CreatePaymentResult = (
  | { mode: "core"; transactionId: string; qrString: string; qrImageUrl: string }
  | { mode: "snap"; redirectUrl: string; token: string }
);

/**
 * Create a QRIS transaction via Midtrans Core API (/v2/charge).
 * Returns the transaction_id, qr_string, and qr-code image URL.
 * The QR code is displayed directly in the app — no Snap redirect.
 */
export async function createQrisCharge(
  orderId: string,
  grossAmount: number,
  customerDetails: QrisCustomerDetails,
  itemDetails?: QrisItemDetail[]
): Promise<CreateQrisChargeResult> {
  const core = getCoreApiClient();

  const parameter = {
    payment_type: "qris",
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    customer_details: {
      first_name: customerDetails.first_name,
      email: customerDetails.email,
      phone: customerDetails.phone,
    },
    item_details: itemDetails,
  };

  const response = await core.charge(parameter);

  const qrAction = response.actions?.find(
    (a) => a.name === "generate-qr-code"
  );

  if (!response.transaction_id || !response.qr_string || !qrAction?.url) {
    throw new Error(
      `Midtrans QRIS charge returned incomplete response: ${JSON.stringify(response)}`
    );
  }

  return {
    transactionId: response.transaction_id,
    qrString: response.qr_string,
    qrImageUrl: qrAction.url,
  };
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

  const transaction = await snap.createTransaction(parameter);

  return {
    redirectUrl: transaction.redirect_url,
    token: transaction.token,
  };
}

/**
 * Unified payment creation. Dispatches to Core API (QRIS direct) or Snap
 * (redirect) based on the MIDTRANS_PAYMENT_MODE env var.
 * - "core" (default): QR code shown in-app, returns transactionId/qrString/qrImageUrl
 * - "snap": redirect to Midtrans Snap page, returns redirectUrl/token
 */
export async function createPayment(
  orderId: string,
  grossAmount: number,
  customerDetails: QrisCustomerDetails,
  itemDetails?: QrisItemDetail[]
): Promise<CreatePaymentResult> {
  const mode = getPaymentMode();

  if (mode === "snap") {
    const snapResult = await createSnapQrisPayment(
      orderId,
      grossAmount,
      customerDetails,
      itemDetails
    );
    return { mode: "snap", ...snapResult };
  }

  const coreResult = await createQrisCharge(
    orderId,
    grossAmount,
    customerDetails,
    itemDetails
  );
  return { mode: "core", ...coreResult };
}

/**
 * Verify a Midtrans webhook notification's signature_key.
 * Classic Snap signature = SHA512(order_id + status_code + gross_amount + serverKey).
 * The signature format is identical for both Core API and Snap.
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