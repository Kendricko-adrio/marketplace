/**
 * Adapter pengiriman email order (spec §6.3 `sendOrderEmail`).
 *
 * Satu-satunya tempat yang menerjemahkan hasil transport menjadi klasifikasi
 * yang aman disimpan: `accepted` / `temporary` / `uncertain` / `permanent`.
 * Raw transport error, credential, dan body provider TIDAK pernah keluar dari
 * modul ini — hanya kode token stabil.
 */

import { sendEmailMessage } from "@/lib/email";
import type {
  OrderEmailContent,
  OrderEmailSendOutcome,
} from "@marketplace/db/src/order-communications/order-communication-contract";

export type OrderEmailSendResult = {
  outcome: OrderEmailSendOutcome;
  code: string | null;
};

export type OrderEmailSender = (
  content: OrderEmailContent
) => Promise<OrderEmailSendResult>;

/** Kode definitif: mengulang tanpa perbaikan konfigurasi/pesan tidak berguna. */
const PERMANENT_TRANSPORT_CODES = new Set([
  "EAUTH",
  "ENOAUTH",
  "EOAUTH2",
  "EENVELOPE",
  "EMESSAGE",
  "ECONFIG",
  "ETLS",
  "EREQUIRETLS",
]);

/** Kode gangguan koneksi: aman diulang pada run berikutnya. */
const TEMPORARY_TRANSPORT_CODES = new Set([
  "ECONNECTION",
  "EDNS",
  "ESOCKET",
  "ECONNRESET",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function transportErrorCode(error: unknown): string | null {
  try {
    if (typeof error !== "object" || error === null) return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)
      ? code
      : null;
  } catch {
    return null;
  }
}

/**
 * Klasifikasi hasil transport.
 *
 * `ETIMEDOUT`/error tak dikenal sengaja menjadi `uncertain` (bukan `temporary`
 * dan bukan sukses): server email mungkin sudah menerima pesan, sehingga
 * diulang dalam sisa batas retry — risiko email ganda disengaja dan
 * didokumentasikan, bukan exactly-once.
 */
export function classifyEmailTransportResult(input: {
  accepted: string[];
  rejected: string[];
}): OrderEmailSendResult {
  if (input.accepted.length > 0) {
    return { outcome: "accepted", code: null };
  }
  if (input.rejected.length > 0) {
    return { outcome: "permanent", code: "RECIPIENT_REJECTED" };
  }
  return { outcome: "uncertain", code: "NO_RECIPIENT_ACCEPTED" };
}

export function classifyEmailTransportError(error: unknown): OrderEmailSendResult {
  const code = transportErrorCode(error);
  if (code && PERMANENT_TRANSPORT_CODES.has(code)) {
    return { outcome: "permanent", code: `SMTP_${code}` };
  }
  if (code && TEMPORARY_TRANSPORT_CODES.has(code)) {
    return { outcome: "temporary", code: `SMTP_${code}` };
  }
  if (code === "ETIMEDOUT") {
    return { outcome: "uncertain", code: "SMTP_ETIMEDOUT" };
  }
  return { outcome: "uncertain", code: "SMTP_UNKNOWN" };
}

/** Pengirim default yang dipakai worker (bisa diganti di test). */
export const sendOrderEmail: OrderEmailSender = async (content) => {
  try {
    const receipt = await sendEmailMessage({
      to: content.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    return classifyEmailTransportResult(receipt);
  } catch (error) {
    return classifyEmailTransportError(error);
  }
};
