/**
 * Evidence pembayaran yang sudah dinormalisasi (spec TX-01 §7.1).
 *
 * Modul ini murni: tidak ada HTTP, DB, maupun logger. Adapter provider
 * (`midtrans-payment-client.ts`) memakai `validatePaymentObservation` untuk
 * mengubah body provider menjadi observation bertipe, dan use case
 * (`reconcile-pending-payment-service.ts`, `fail-order-service.ts`) memakai
 * `FailureEvidence` untuk memutuskan transisi lokal.
 *
 * Aturan mengikat yang dikodekan di sini:
 * - `paid`/`expired` hanya sah bila reference DAN amount cocok dengan order.
 * - Respons malformed, identity/amount mismatch, serta status yang tidak dikenal
 *   menjadi `unknown`, bukan `paid`, bukan `expired`, dan bukan failure.
 * - `capture` tanpa fraud `accept` bukan paid.
 * - `deny`/`cancel`/`failure` tetap non-terminal (multi-attempt Snap): adapter
 *   menandainya `attempt_failed`, bukan failure order.
 */

export type PaymentUnknownReason =
  | "provider_unavailable"
  | "malformed_response"
  | "reference_mismatch"
  | "amount_mismatch"
  | "status_unrecognized"
  | "expire_conflict"
  | "authentication_rejected";

export interface PaymentObservationBase {
  /** Local order reference (the provider order id we sent). */
  reference: string;
  verifiedAt: Date;
}

export type PaymentObservation =
  | (PaymentObservationBase & {
      kind: "paid";
      amount: string;
      transactionId: string | null;
      paymentType: string | null;
    })
  | (PaymentObservationBase & {
      kind: "expired";
      amount: string;
      transactionId: string | null;
    })
  | (PaymentObservationBase & {
      kind: "pending";
      amount: string;
      transactionId: string | null;
      paymentType: string | null;
    })
  | (PaymentObservationBase & {
      kind: "attempt_failed";
      amount: string;
      status: "deny" | "cancel" | "failure";
    })
  | (PaymentObservationBase & { kind: "not_found" })
  | (PaymentObservationBase & { kind: "unknown"; reason: PaymentUnknownReason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Amount comparison without floating-point drift (serialization noise allowed). */
export function moneyMatches(expected: string | number, actual: string | number): boolean {
  const left = Number(expected);
  const right = Number(actual);
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.round(left * 100) === Math.round(right * 100)
  );
}

/**
 * Normalize a provider status/expire body into a typed observation.
 *
 * The caller has already decided that the transport succeeded; anything that
 * cannot be proven from this body becomes `unknown` so no financial mutation
 * (failure, cancel, release) can be derived from a guess.
 */
export function validatePaymentObservation(input: {
  expectedReference: string;
  expectedAmount: string;
  observation: unknown;
  verifiedAt?: Date;
}): PaymentObservation {
  const verifiedAt = input.verifiedAt ?? new Date();
  const reference = input.expectedReference;
  const body = input.observation;
  if (!isRecord(body)) {
    return { kind: "unknown", reason: "malformed_response", reference, verifiedAt };
  }

  const providerReference = text(body.order_id);
  if (providerReference !== reference) {
    return { kind: "unknown", reason: "reference_mismatch", reference, verifiedAt };
  }

  const amount = text(body.gross_amount);
  if (!amount || !moneyMatches(input.expectedAmount, amount)) {
    return { kind: "unknown", reason: "amount_mismatch", reference, verifiedAt };
  }

  const status = text(body.transaction_status)?.toLowerCase() ?? null;
  if (!status) {
    return { kind: "unknown", reason: "malformed_response", reference, verifiedAt };
  }
  const transactionId = text(body.transaction_id);
  const paymentType = text(body.payment_type);
  const fraudStatus = text(body.fraud_status)?.toLowerCase() ?? null;

  switch (status) {
    case "settlement":
      return { kind: "paid", amount, transactionId, paymentType, reference, verifiedAt };
    case "capture":
      // A capture that FDS did not accept is not a paid order.
      return fraudStatus === "accept"
        ? { kind: "paid", amount, transactionId, paymentType, reference, verifiedAt }
        : { kind: "pending", amount, transactionId, paymentType, reference, verifiedAt };
    case "expire":
      return { kind: "expired", amount, transactionId, reference, verifiedAt };
    case "pending":
    case "authorize":
      return { kind: "pending", amount, transactionId, paymentType, reference, verifiedAt };
    case "deny":
    case "cancel":
    case "failure":
      return { kind: "attempt_failed", amount, status, reference, verifiedAt };
    default:
      return { kind: "unknown", reason: "status_unrecognized", reference, verifiedAt };
  }
}

/**
 * Durable evidence that justifies a local failure transition (spec §10.1/§10.3).
 *
 * - `provider_expired` — a fresh provider observation proved `expire` for the
 *   matching order/amount.
 * - `payment_initialization_rejected` — the claim owner received a definitive
 *   pre-apply rejection, so no session was ever created.
 * - `never_sent_expired` — a durable, never-claimed payment intent whose
 *   deadline passed: no writer ever obtained dispatch permission.
 *
 * A bare `initialization_error`/timeout/HTTP 4xx is NOT representable here;
 * those are `unknown` and must stay held.
 */
export type FailureEvidence =
  | {
      kind: "provider_expired";
      reference: string;
      amount: string;
      verifiedAt: Date;
    }
  | {
      kind: "payment_initialization_rejected";
      reference: string;
      code: string;
      claimedAt: Date;
    }
  | {
      kind: "never_sent_expired";
      reference: string;
      expiresAt: Date;
    };

/** Final `orders.paymentFailureReason` for durable evidence (never a raw body). */
export function describeFailureEvidence(evidence: FailureEvidence): string {
  switch (evidence.kind) {
    case "provider_expired":
      return "Payment expired — order timed out (verified provider status)";
    case "payment_initialization_rejected":
      return "Payment initialization rejected by provider";
    case "never_sent_expired":
      return "Payment expired — order timed out (payment was never started)";
  }
}

/**
 * `orders.midtransFailureStatus` token for durable evidence. Allowlisted so the
 * column can never hold an arbitrary provider string or raw payload.
 */
export function failureStatusToken(evidence: FailureEvidence): string {
  switch (evidence.kind) {
    case "provider_expired":
      return "expire";
    case "payment_initialization_rejected":
      return "initialization_rejected";
    case "never_sent_expired":
      return "not_sent";
  }
}

/**
 * Guard used before a failure commit: evidence must belong to this order, and
 * provider expiry must carry an amount that still matches the order total.
 */
export function failureEvidenceMatches(
  evidence: FailureEvidence,
  expected: { reference: string; amount?: string | null }
): boolean {
  if (evidence.reference !== expected.reference) return false;
  if (evidence.kind !== "provider_expired") return true;
  if (typeof expected.amount !== "string" || !expected.amount.trim()) return false;
  return moneyMatches(expected.amount, evidence.amount);
}

/** Observation kinds that may never justify a failure transition. */
export function isSafeFailureEvidenceKind(kind: FailureEvidence["kind"]): boolean {
  return (
    kind === "provider_expired" ||
    kind === "payment_initialization_rejected" ||
    kind === "never_sent_expired"
  );
}

/**
 * Outcome of ONE payment initialization dispatch (spec TX-02 §8.2).
 *
 * - `ready`              — a session exists and its redirect handle is durable.
 * - `definitive_rejection` — allowlisted proof the provider created nothing.
 * - `unknown`            — timeout/lost response/ambiguous answer; never a failure.
 */
export type PaymentInitializationOutcome =
  | { kind: "ready"; token: string; redirectUrl: string }
  | { kind: "definitive_rejection"; code: string }
  | { kind: "unknown"; code: string };
