import { createModuleLogger } from "@/lib/logger";
import { claimPaidOrder } from "@/lib/order-finalize";
import { settleJubelioSalesOrder } from "@/lib/jubelio-sales-settlement";
import {
  failOrderWithEvidence,
  type FailureOutcome,
} from "@/features/orders/fail-order-service";
import {
  loadPendingPaymentWork,
  type PendingPaymentWork,
} from "@/features/orders/transaction-recovery-repository";
import type { PaymentFailureAttributes } from "@/features/orders/failure-obligation-repository";
import type { FailureEvidence, PaymentObservation } from "./payment-evidence";
import { midtransPaymentClient, type PaymentGateway } from "./midtrans-payment-client";

/**
 * TX-01 — rekonsiliasi pembayaran order `pending_payment` berdasarkan evidence
 * (spec §7.2).
 *
 * Matriks keputusan dipisah sebagai fungsi murni (`decidePaymentReconciliation`)
 * supaya race paid-vs-expire bisa dibuktikan deterministik tanpa PostgreSQL.
 * Workflow-nya hanya menjalankan keputusan itu: satu expire request, satu GET
 * fresh setelah conflict/unknown, dan tidak pernah memindahkan order ke gagal
 * dari timeout/HTTP error/status non-terminal.
 */

const log = createModuleLogger("reconcile-pending-payment");

export type DurablePaymentEvidence = "never_sent" | "possibly_sent" | "unknown";

export type PaymentReconcileDecision =
  | { action: "claim_paid" }
  | { action: "fail_provider_expired" }
  | { action: "expire_then_verify" }
  | { action: "fail_never_sent" }
  | {
      action: "defer";
      reason: "deadline_not_reached" | "provider_unknown" | "non_terminal_attempt_status";
    }
  | { action: "manual_review"; reason: "not_found_without_never_sent_proof" };

/** Pure decision matrix: observation + durable evidence → next local action. */
export function decidePaymentReconciliation(input: {
  observation: PaymentObservation;
  deadlinePassed: boolean;
  durablePaymentEvidence: DurablePaymentEvidence;
}): PaymentReconcileDecision {
  const { observation, deadlinePassed, durablePaymentEvidence } = input;
  switch (observation.kind) {
    case "paid":
      return { action: "claim_paid" };
    case "expired":
      return { action: "fail_provider_expired" };
    case "pending":
      return deadlinePassed
        ? { action: "expire_then_verify" }
        : { action: "defer", reason: "deadline_not_reached" };
    case "attempt_failed":
      // deny/cancel/failure stay non-terminal: Snap allows another attempt on
      // the same order and the local TTL owns compensation.
      return { action: "defer", reason: "non_terminal_attempt_status" };
    case "not_found":
      return deadlinePassed && durablePaymentEvidence === "never_sent"
        ? { action: "fail_never_sent" }
        : { action: "manual_review", reason: "not_found_without_never_sent_proof" };
    case "unknown":
      // Unknown is never failure: no cancel, no hold release, no paid claim.
      return { action: "defer", reason: "provider_unknown" };
  }
}

export type PaymentReconciliationResult =
  | { kind: "paid"; settled: boolean }
  | { kind: "expired" }
  | { kind: "already_handled"; status: string }
  | { kind: "deferred"; reason: string }
  | { kind: "manual_review"; reason: string }
  | { kind: "not_found" };

export interface PaidObservationInput {
  orderId: string;
  amount: string;
  transactionId: string | null;
  paymentType: string | null;
  now: Date;
}

export interface ReconcilePaymentDependencies {
  gateway?: PaymentGateway;
  clock?: { now(): Date };
  loadWork?: (orderId: string) => Promise<PendingPaymentWork | null>;
  claimPaid?: (input: PaidObservationInput) => Promise<{ claimed: boolean; settled: boolean }>;
  failOrder?: (input: {
    orderId: string;
    evidence: FailureEvidence;
    now: Date;
    paymentAttributes?: PaymentFailureAttributes;
  }) => Promise<FailureOutcome>;
}

/** Default paid path: existing claim guard, then the existing settlement gate. */
async function claimAndSettle(input: PaidObservationInput) {
  const claimed = await claimPaidOrder(input.orderId, {
    paymentType: input.paymentType ?? undefined,
    transactionId: input.transactionId ?? undefined,
  });
  if (!claimed.claimed) return { claimed: false, settled: false };
  const settlement = await settleJubelioSalesOrder(input.orderId);
  return { claimed: true, settled: settlement.status === "fulfilled" };
}

function paymentAttributesOf(observation: {
  transactionId: string | null;
  paymentType?: string | null;
}): PaymentFailureAttributes {
  return {
    paymentType: observation.paymentType ?? undefined,
    transactionId: observation.transactionId ?? undefined,
  };
}

export async function reconcilePendingPayment(
  input: { orderId: string; now?: Date },
  dependencies: ReconcilePaymentDependencies = {}
): Promise<PaymentReconciliationResult> {
  const now = input.now ?? dependencies.clock?.now() ?? new Date();
  const gateway = dependencies.gateway ?? midtransPaymentClient;
  const loadWork = dependencies.loadWork ?? ((orderId: string) => loadPendingPaymentWork(orderId));
  const claimPaid = dependencies.claimPaid ?? claimAndSettle;
  const failOrder = dependencies.failOrder ?? ((failure) => failOrderWithEvidence(failure));

  const work = await loadWork(input.orderId);
  if (!work) return { kind: "not_found" };
  if (work.paymentStatus === "paid" || work.status !== "pending_payment") {
    return { kind: "already_handled", status: work.status };
  }

  const observation = await observe(gateway, work, input.orderId);
  const deadlinePassed = work.expiresAt ? work.expiresAt.getTime() <= now.getTime() : false;
  const durablePaymentEvidence: DurablePaymentEvidence = work.paymentEvidence;
  const decision = decidePaymentReconciliation({
    observation,
    deadlinePassed,
    durablePaymentEvidence,
  });

  switch (decision.action) {
    case "claim_paid": {
      if (observation.kind !== "paid") return { kind: "deferred", reason: "unexpected_observation" };
      const result = await claimPaid({
        orderId: input.orderId,
        amount: observation.amount,
        transactionId: observation.transactionId,
        paymentType: observation.paymentType,
        now,
      });
      if (!result.claimed) {
        return { kind: "already_handled", status: "paid_claim_lost" };
      }
      log.info(
        `Order ${input.orderId}: provider observation settled → paid claim committed (settlement ${
          result.settled ? "fulfilled" : "pending"
        })`
      );
      return { kind: "paid", settled: result.settled };
    }
    case "fail_provider_expired": {
      if (observation.kind !== "expired") {
        return { kind: "deferred", reason: "unexpected_observation" };
      }
      return finalizeFailure(
        input.orderId,
        {
          kind: "provider_expired",
          reference: input.orderId,
          amount: observation.amount,
          verifiedAt: observation.verifiedAt,
        },
        now,
        paymentAttributesOf(observation),
        failOrder
      );
    }
    case "fail_never_sent": {
      if (!work.expiresAt) return { kind: "manual_review", reason: "no_deadline_evidence" };
      return finalizeFailure(
        input.orderId,
        { kind: "never_sent_expired", reference: input.orderId, expiresAt: work.expiresAt },
        now,
        {},
        failOrder
      );
    }
    case "expire_then_verify": {
      // Exactly ONE expire request, then a FRESH GET. A conflict (412),
      // transport error or malformed answer never fails the order on its own.
      const expireOutcome = await expire(gateway, work, input.orderId);
      if (expireOutcome.kind === "expired") {
        return finalizeFailure(
          input.orderId,
          {
            kind: "provider_expired",
            reference: input.orderId,
            amount: expireOutcome.amount,
            verifiedAt: expireOutcome.verifiedAt,
          },
          now,
          {},
          failOrder
        );
      }
      const fresh = await observe(gateway, work, input.orderId);
      if (fresh.kind === "paid") {
        const result = await claimPaid({
          orderId: input.orderId,
          amount: fresh.amount,
          transactionId: fresh.transactionId,
          paymentType: fresh.paymentType,
          now,
        });
        if (!result.claimed) return { kind: "already_handled", status: "paid_claim_lost" };
        log.info(`Order ${input.orderId}: expire raced a settlement → paid claim committed`);
        return { kind: "paid", settled: result.settled };
      }
      if (fresh.kind === "expired") {
        return finalizeFailure(
          input.orderId,
          {
            kind: "provider_expired",
            reference: input.orderId,
            amount: fresh.amount,
            verifiedAt: fresh.verifiedAt,
          },
          now,
          {},
          failOrder
        );
      }
      log.info(
        `Order ${input.orderId}: expire outcome unverified (${
          expireOutcome.kind === "unknown" ? expireOutcome.reason : expireOutcome.kind
        }) — deferred`
      );
      return { kind: "deferred", reason: "expire_unverified" };
    }
    case "defer":
      if (decision.reason === "provider_unknown") {
        log.warn(
          `Order ${input.orderId}: provider observation unknown (${
            observation.kind === "unknown" ? observation.reason : "unknown"
          }) — order stays pending_payment`
        );
      }
      return { kind: "deferred", reason: decision.reason };
    case "manual_review":
      log.warn(
        `Order ${input.orderId}: no durable proof the payment session was never sent — manual review`
      );
      return { kind: "manual_review", reason: decision.reason };
  }
}

async function observe(
  gateway: PaymentGateway,
  work: PendingPaymentWork,
  orderId: string
): Promise<PaymentObservation> {
  try {
    return await gateway.observePayment({ reference: orderId, expectedAmount: work.total });
  } catch {
    log.error(
      `Order ${orderId}: provider status observation unavailable`,
      new ProviderLogError("payment provider unavailable")
    );
    return { kind: "unknown", reason: "provider_unavailable", reference: orderId, verifiedAt: new Date() };
  }
}

async function expire(
  gateway: PaymentGateway,
  work: PendingPaymentWork,
  orderId: string
): Promise<PaymentObservation> {
  try {
    return await gateway.expirePayment({ reference: orderId, expectedAmount: work.total });
  } catch {
    log.error(
      `Order ${orderId}: provider expire unavailable`,
      new ProviderLogError("payment provider unavailable")
    );
    return { kind: "unknown", reason: "provider_unavailable", reference: orderId, verifiedAt: new Date() };
  }
}

async function finalizeFailure(
  orderId: string,
  evidence: FailureEvidence,
  now: Date,
  paymentAttributes: PaymentFailureAttributes,
  failOrder: NonNullable<ReconcilePaymentDependencies["failOrder"]>
): Promise<PaymentReconciliationResult> {
  const outcome = await failOrder({ orderId, evidence, now, paymentAttributes });
  switch (outcome.kind) {
    case "failed":
      log.info(`Order ${orderId}: failure committed from verified evidence (cancel ${outcome.cancelStatus})`);
      return { kind: "expired" };
    case "already_paid":
      return { kind: "already_handled", status: "paid" };
    case "payment_active":
      log.warn(`Order ${orderId}: settlement already active — failure refused, manual review`);
      return { kind: "manual_review", reason: "settlement_active" };
    case "evidence_mismatch":
      log.warn(`Order ${orderId}: failure evidence no longer matches the order — deferred`);
      return { kind: "deferred", reason: "evidence_mismatch" };
    case "not_eligible":
      return { kind: "already_handled", status: outcome.status };
    case "not_found":
      return { kind: "not_found" };
  }
}

/** Static technical projection: provider texts never reach the log. */
class ProviderLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderLogError";
  }
}
