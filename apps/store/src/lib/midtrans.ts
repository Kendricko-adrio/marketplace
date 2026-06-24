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

  snapClient = new Snap({
    isProduction,
    serverKey,
    clientKey: clientKey || undefined,
  });

  return snapClient;
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

export interface CreateQrisPaymentResult {
  redirectUrl: string;
  token: string;
}

/**
 * Create a Midtrans Snap transaction restricted to QRIS payment.
 * Returns the redirect_url (Snap payment page) and token.
 */
export async function createQrisPayment(
  orderId: string,
  grossAmount: number,
  customerDetails: QrisCustomerDetails,
  itemDetails?: QrisItemDetail[]
): Promise<CreateQrisPaymentResult> {
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