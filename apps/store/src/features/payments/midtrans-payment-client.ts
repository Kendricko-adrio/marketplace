import { createModuleLogger } from "@/lib/logger";
import { resolveMidtransBaseUrl } from "@/lib/midtrans";
import {
  validatePaymentObservation,
  type PaymentObservation,
  type PaymentUnknownReason,
} from "./payment-evidence";

/**
 * Adapter provider Midtrans untuk OBSERVASI transaksi (spec TX-01).
 *
 * Batas kontrak yang dijaga di sini:
 * - GET `/v2/{reference}/status` dan POST `/v2/{reference}/expire` adalah dua
 *   operasi berbeda; adapter tidak pernah membuat sesi/payment baru.
 * - HTTP 2xx tidak cukup: expire `status_code` 412 ("Merchant cannot modify the
 *   status of the transaction") juga dikirim dengan HTTP 200, jadi keberhasilan
 *   expire hanya sah bila body membuktikan `transaction_status = expire`.
 * - Conflict/transport/malformed tidak pernah menjadi sukses dan tidak pernah
 *   menjadi bukti negatif; hasilnya `unknown` agar caller melakukan GET fresh
 *   atau menunda.
 *
 * Context7 checkpoint: `/websites/midtrans_reference` — Expire API (success
 * `status_code` 407 + `transaction_status` expire, business error 412),
 * Get Transaction Status (`order_id`, `gross_amount`, `transaction_status`,
 * `fraud_status`, `transaction_id`), dan installed SDK 1.4.3
 * (`midtrans-client/lib/transaction.js`) yang memakai Core base
 * `/v2/{id}/expire` dengan Basic Auth.
 */

const log = createModuleLogger("midtrans-payment-client");

const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 15_000;

export class PaymentGatewayConfigError extends Error {
  constructor() {
    super("MIDTRANS_SERVER_KEY is not configured");
    this.name = "PaymentGatewayConfigError";
  }
}

export interface PaymentGateway {
  observePayment(input: {
    reference: string;
    expectedAmount: string;
  }): Promise<PaymentObservation>;
  expirePayment(input: {
    reference: string;
    expectedAmount: string;
  }): Promise<PaymentObservation>;
}

function timeoutMs(env: Record<string, string | undefined>): number {
  const raw = Number(env.MIDTRANS_REQUEST_TIMEOUT_MS);
  if (!Number.isSafeInteger(raw)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, raw));
}

function unknown(
  reference: string,
  reason: PaymentUnknownReason,
  verifiedAt: Date
): PaymentObservation {
  return { kind: "unknown", reason, reference, verifiedAt };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * Controlled loopback transport used by mock E2E/provider tests. The base URL
 * resolution itself is owned by `resolveMidtransBaseUrl` (mock only outside
 * production), so no new override path is introduced here.
 */
function requestBase(env: Record<string, string | undefined>): string {
  return resolveMidtransBaseUrl(env);
}

function authorisationHeaders(serverKey: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export function createMidtransPaymentClient(
  env: Record<string, string | undefined> = process.env
): PaymentGateway {
  return {
    async observePayment({ reference, expectedAmount }) {
      const verifiedAt = new Date();
      const serverKey = env.MIDTRANS_SERVER_KEY;
      if (!serverKey) throw new PaymentGatewayConfigError();
      const url = `${requestBase(env)}/v2/${encodeURIComponent(reference)}/status`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          headers: authorisationHeaders(serverKey),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs(env)),
        });
      } catch {
        log.warn(`Payment ${reference}: provider status unavailable`);
        return unknown(reference, "provider_unavailable", verifiedAt);
      }
      if (response.status === 404) {
        return { kind: "not_found", reference, verifiedAt };
      }
      if (response.status === 401 || response.status === 403) {
        log.warn(`Payment ${reference}: provider status rejected the credential`);
        return unknown(reference, "authentication_rejected", verifiedAt);
      }
      if (!response.ok) {
        log.warn(`Payment ${reference}: provider status failed (${response.status})`);
        return unknown(reference, "provider_unavailable", verifiedAt);
      }
      const body = await readJson(response);
      const bodyStatus =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).status_code
          : null;
      // A business-level 404 can arrive with HTTP 200; it is still "no session".
      if (bodyStatus === "404") {
        return { kind: "not_found", reference, verifiedAt };
      }
      return validatePaymentObservation({
        expectedReference: reference,
        expectedAmount,
        observation: body,
        verifiedAt,
      });
    },

    async expirePayment({ reference, expectedAmount }) {
      const verifiedAt = new Date();
      const serverKey = env.MIDTRANS_SERVER_KEY;
      if (!serverKey) throw new PaymentGatewayConfigError();
      const url = `${requestBase(env)}/v2/${encodeURIComponent(reference)}/expire`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: authorisationHeaders(serverKey),
          body: JSON.stringify({}),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs(env)),
        });
      } catch {
        log.warn(`Payment ${reference}: provider expire unavailable`);
        return unknown(reference, "provider_unavailable", verifiedAt);
      }
      if (response.status === 401 || response.status === 403) {
        log.warn(`Payment ${reference}: provider expire rejected the credential`);
        return unknown(reference, "authentication_rejected", verifiedAt);
      }
      if (!response.ok) {
        // Any non-2xx expire answer proves nothing about the transaction state.
        log.warn(`Payment ${reference}: provider expire failed (${response.status})`);
        return unknown(reference, "provider_unavailable", verifiedAt);
      }
      const body = await readJson(response);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return unknown(reference, "malformed_response", verifiedAt);
      }
      const record = body as Record<string, unknown>;
      const status = typeof record.transaction_status === "string"
        ? record.transaction_status.toLowerCase()
        : null;
      const bodyStatus = typeof record.status_code === "string" ? record.status_code : null;
      // Business 412 ("merchant cannot modify the status") is NOT success: a
      // paid/settled transaction answers this way. The caller must re-GET.
      if (bodyStatus === "412" && status !== "expire") {
        log.info(`Payment ${reference}: provider expire answered 412 — re-verification required`);
        return unknown(reference, "expire_conflict", verifiedAt);
      }
      // Success requires the BODY to name the expired transaction/order we own.
      if (status === "expire" || bodyStatus === "407") {
        const observation = validatePaymentObservation({
          expectedReference: reference,
          expectedAmount,
          observation: record,
          verifiedAt,
        });
        return observation.kind === "expired"
          ? observation
          : unknown(reference, "expire_conflict", verifiedAt);
      }
      if (status) {
        // Some channels answer with the CURRENT status instead of failing.
        return validatePaymentObservation({
          expectedReference: reference,
          expectedAmount,
          observation: record,
          verifiedAt,
        });
      }
      return unknown(reference, "malformed_response", verifiedAt);
    },
  };
}

export const midtransPaymentClient: PaymentGateway = createMidtransPaymentClient();
