import type { CheckoutAttemptState, CheckoutFailureCode, CheckoutAttemptSnapshot } from "@marketplace/db/src/schema/checkout";
import type { PublicOfferCandidate } from "@/lib/discount-selection";
export type { CheckoutAttemptState, CheckoutFailureCode, CheckoutAttemptSnapshot } from "@marketplace/db/src/schema/checkout";

export interface ReserveCheckoutAttemptInput {
  attemptId: string;
  clientId: string;
  branchId: string;
  requestKey: string;
  fingerprint: string;
  reservedOrderId: string;
  snapshot: CheckoutAttemptSnapshot;
  paymentStartedAt: Date;
  expiresAt: Date;
  stockObservedAt: Date;
  offerCandidate: PublicOfferCandidate | null;
  now?: Date;
}

export class CheckoutAttemptReservationError extends Error {
  constructor(readonly code: "REQUEST_KEY_CONFLICT" | "CHECKOUT_ATTEMPT_IN_PROGRESS" | "CHECKOUT_REVIEW_REQUIRED",
    readonly requestKey?: string) {
    super(code === "CHECKOUT_REVIEW_REQUIRED" ? "Periksa kembali pesanan sebelum melanjutkan checkout."
      : code === "REQUEST_KEY_CONFLICT" ? "Request checkout ini sudah digunakan untuk pilihan berbeda."
      : "Checkout sebelumnya belum selesai. Periksa status checkout.");
    this.name = "CheckoutAttemptReservationError";
  }
}

export type CheckoutPaymentOutcome =
  | { kind: "ready"; token: string; redirectUrl: string }
  | { kind: "definitive_rejection" }
  | { kind: "unknown" };

export type ProviderOperationOwner =
  | { kind: "attempt"; attemptId: string }
  | { kind: "order"; orderId: string };

/** Minimal server projection; never pass a full attempt snapshot to a browser. */
export interface CheckoutAttemptView {
  id: string;
  requestKey: string;
  state: CheckoutAttemptState;
  orderId: string | null;
  failureCode: CheckoutFailureCode | null;
  expiresAt: Date;
  paymentStatus: string | null;
  orderStatus: string | null;
  redirectUrl: string | null;
}

export interface CheckoutAttemptResult {
  version: 2;
  requestKey: string;
  attemptId: string;
  state: CheckoutAttemptState;
  orderId: string | null;
  paymentAvailable: boolean;
  redirectUrl: string | null;
  retryAllowed: boolean;
  failureCode: CheckoutFailureCode | null;
  message: string;
  expiresAt: string;
}

const messages: Record<CheckoutAttemptState, string> = {
  preparing: "Menyiapkan pesanan...",
  compensating: "Pembayaran belum dapat disiapkan. Kami sedang menyelesaikan proses checkout sebelumnya.",
  processing: "Checkout masih diproses. Periksa status sebelum mencoba lagi.",
  manual_review: "Status checkout belum dapat dipastikan. Jangan buat checkout baru. Tim kami perlu memeriksa proses ini.",
  rejected: "Pesanan belum dibuat. Produk belum dapat dipesan. Periksa ulang pesanan lalu coba lagi.",
  promoted: "Mengarahkan ke pembayaran...",
};

/** Public status contract shared by POST/GET, without HTTP or persistence. */
export function presentCheckoutAttempt(attempt: CheckoutAttemptView, now: Date): CheckoutAttemptResult {
  const promoted = attempt.state === "promoted";
  if (promoted && !attempt.orderId) throw new Error("Promoted checkout requires an order");
  const paymentAvailable = promoted && !!attempt.orderId && attempt.orderStatus === "pending_payment" &&
    attempt.paymentStatus === "pending" && !!attempt.redirectUrl && attempt.expiresAt.getTime() > now.getTime();
  return {
    version: 2,
    requestKey: attempt.requestKey,
    attemptId: attempt.id,
    state: attempt.state,
    orderId: promoted ? attempt.orderId : null,
    paymentAvailable,
    redirectUrl: paymentAvailable ? attempt.redirectUrl : null,
    retryAllowed: attempt.state === "rejected",
    failureCode: attempt.failureCode,
    message: attempt.failureCode === "CHECKOUT_EXPIRED"
      ? "Checkout sebelumnya sudah kedaluwarsa. Pesanan belum dibuat. Periksa ulang pesanan untuk memulai lagi."
      : attempt.state === "rejected" && attempt.failureCode === "PAYMENT_INITIALIZATION_REJECTED"
      ? "Pembayaran belum dapat disiapkan. Pesanan belum dibuat. Periksa ulang pesanan lalu coba lagi."
      : messages[attempt.state],
    expiresAt: attempt.expiresAt.toISOString(),
  };
}
