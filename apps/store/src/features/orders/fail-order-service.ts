import { createModuleLogger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";
import {
  paymentFailedEmailHTML,
  paymentFailedEmailText,
} from "@/lib/email-templates-order";
import { dispatchJubelioSalesCancel } from "@/lib/jubelio-sales-lifecycle";
import { projectOrderCommunications } from "@/features/order-communications/project-order-communications-service";
import {
  describeFailureEvidence,
  type FailureEvidence,
} from "@/features/payments/payment-evidence";
import {
  commitOrderFailureObligation,
  readFailureCommunicationContext,
  type FailureCommitOutcome,
  type PaymentFailureAttributes,
  type WriteDatabase,
} from "./failure-obligation-repository";

/**
 * TX-05 — use case gagal bayar.
 *
 * Urutan yang dijaga:
 * 1. Satu transaksi lokal: transisi `failed_payment` + cancel intent durable +
 *    satu fakta komunikasi (`commitOrderFailureObligation`).
 * 2. Setelah commit, dispatcher existing memakai conditional `intent →
 *    dispatched_unknown` untuk satu-satunya cancel POST.
 * 3. Fakta email diproyeksikan dari transaksi yang sudah committed (bukan dari
 *    hasil provider), sehingga replay tidak menulis fakta kedua.
 *
 * Provider HTTP tidak pernah berjalan di dalam transaksi DB.
 */

const log = createModuleLogger("fail-order");

class FailOrderLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FailOrderLogError";
  }
}

export type FailureOutcome =
  | {
      kind: "failed";
      cancelStatus: "none" | "intent" | "dispatched" | "confirmed" | "rejected" | "manual_review" | "in_flight";
      communicationQueued: boolean;
    }
  | { kind: "already_paid" }
  | { kind: "not_eligible"; status: string }
  | { kind: "payment_active" }
  | { kind: "not_found" }
  | { kind: "evidence_mismatch" };

export interface FailOrderDependencies {
  database?: WriteDatabase;
  dispatchCancel?: typeof dispatchJubelioSalesCancel;
  now?: Date;
}

function mapCommitOutcome(outcome: FailureCommitOutcome): FailureOutcome | null {
  switch (outcome.outcome) {
    case "already_paid":
      return { kind: "already_paid" };
    case "not_eligible":
      return { kind: "not_eligible", status: outcome.status };
    case "payment_active":
      return { kind: "payment_active" };
    case "not_found":
      return { kind: "not_found" };
    case "evidence_mismatch":
      return { kind: "evidence_mismatch" };
    case "committed":
      return null;
  }
}

/**
 * Commit failure lokal dari evidence durable, lalu jalankan kewajiban cancel.
 *
 * `evidence_mismatch` / `payment_active` / `already_paid` returned as-is: caller
 * must re-observe the provider instead of failing the order.
 */
export async function failOrderWithEvidence(
  input: {
    orderId: string;
    evidence: FailureEvidence;
    reasonCode?: string;
    paymentAttributes?: PaymentFailureAttributes;
  },
  dependencies: FailOrderDependencies = {}
): Promise<FailureOutcome> {
  const now = dependencies.now ?? new Date();
  const commit = await commitOrderFailureObligation(
    {
      orderId: input.orderId,
      evidence: input.evidence,
      now,
      paymentAttributes: input.paymentAttributes,
    },
    dependencies.database
  );
  const rejected = mapCommitOutcome(commit);
  if (rejected) {
    log.info(
      `Order ${input.orderId}: failure not committed (${rejected.kind}${
        rejected.kind === "not_eligible" ? `: ${rejected.status}` : ""
      })`
    );
    return rejected;
  }
  if (commit.outcome !== "committed") {
    return { kind: "not_eligible", status: "unknown" };
  }

  const reason = describeFailureEvidence(input.evidence);
  let cancelStatus: Extract<FailureOutcome, { kind: "failed" }>["cancelStatus"] = "none";
  if (commit.cancelObligationPending || commit.cancelObligationCreated) {
    try {
      const outcome = await (dependencies.dispatchCancel ?? dispatchJubelioSalesCancel)({
        orderId: input.orderId,
        reason,
      });
      cancelStatus =
        outcome.status === "skipped"
          ? "none"
          : outcome.status === "confirmed"
            ? "confirmed"
            : outcome.status === "rejected"
              ? "rejected"
              : outcome.status === "manual_review"
                ? "manual_review"
                : "in_flight";
      if (outcome.status === "manual_review") {
        // The obligation stays durable; recovery and the review queue own the
        // follow-up. Nothing here may release the hold or invent a paid state.
        log.warn(
          `Order ${input.orderId}: Sales-Order cancel unresolved after payment failure — manual review retained`
        );
      } else {
        log.info(
          `Order ${input.orderId}: Sales-Order cancel dispatched on payment failure (status ${outcome.status})`
        );
      }
    } catch {
      cancelStatus = "in_flight";
      log.error(
        `Order ${input.orderId}: Sales-Order cancel dispatch failed; obligation retained`,
        new FailOrderLogError("sales order cancel dispatch failed")
      );
    }
  }

  const communicationQueued = await projectFailureCommunication(
    input.orderId,
    commit.orderCommunicationVersion,
    reason
  );

  log.info(
    `Order ${input.orderId}: failed_payment committed (evidence ${input.reasonCode ?? input.evidence.kind}, cancel ${cancelStatus})`
  );
  return { kind: "failed", cancelStatus, communicationQueued };
}

/**
 * Failure communication is projected from the committed fact:
 * version ≥ 1 → durable email job; version 0 → legacy direct send.
 */
async function projectFailureCommunication(
  orderId: string,
  orderCommunicationVersion: number,
  reason: string
): Promise<boolean> {
  if (orderCommunicationVersion >= 1) {
    try {
      const projection = await projectOrderCommunications({
        limit: 1,
        orderId,
        mirror: false,
      });
      log.info(
        `Order ${orderId}: payment-failed email queued (jobs ${projection.emailJobsCreated})`
      );
      return true;
    } catch {
      log.error(
        `Order ${orderId}: payment-failed email queue projection failed`,
        new FailOrderLogError("payment failure communication projection failed")
      );
      return false;
    }
  }

  try {
    const context = await readFailureCommunicationContext(orderId);
    if (!context) return false;
    await sendEmail({
      to: context.order.contactEmail,
      subject: `Pembayaran Gagal — #${orderId.slice(0, 8).toUpperCase()}`,
      html: paymentFailedEmailHTML({ order: context.order, reason, items: context.items }),
      text: paymentFailedEmailText({ order: context.order, reason, items: context.items }),
    });
    return true;
  } catch {
    log.error(
      `Order ${orderId}: payment-failed email failed`,
      new FailOrderLogError("payment failure email failed")
    );
    return false;
  }
}
