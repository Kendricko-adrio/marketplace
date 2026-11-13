import { describe, expect, it, vi } from "vitest";
import type { FailureEvidence, PaymentObservation } from "./payment-evidence";
import {
  decidePaymentReconciliation,
  reconcilePendingPayment,
  type ReconcilePaymentDependencies,
} from "./reconcile-pending-payment-service";
import type { PendingPaymentWork } from "@/features/orders/transaction-recovery-repository";

const now = new Date("2040-01-01T00:20:00Z");
const deadline = new Date("2040-01-01T00:15:00Z");

function work(overrides: Partial<PendingPaymentWork> = {}): PendingPaymentWork {
  return {
    id: "order-1",
    status: "pending_payment",
    paymentStatus: "pending",
    total: "111000",
    expiresAt: deadline,
    hasReadyRedirect: false,
    paymentEvidence: "unknown",
    ...overrides,
  };
}

function paid(overrides: Partial<Extract<PaymentObservation, { kind: "paid" }>> = {}): PaymentObservation {
  return {
    kind: "paid",
    reference: "order-1",
    amount: "111000.00",
    transactionId: "tx-1",
    paymentType: "qris",
    verifiedAt: now,
    ...overrides,
  };
}

function pending(): PaymentObservation {
  return {
    kind: "pending",
    reference: "order-1",
    amount: "111000.00",
    transactionId: null,
    paymentType: null,
    verifiedAt: now,
  };
}

function expired(): PaymentObservation {
  return {
    kind: "expired",
    reference: "order-1",
    amount: "111000.00",
    transactionId: null,
    verifiedAt: now,
  };
}

function unknown(reason: Extract<PaymentObservation, { kind: "unknown" }>["reason"]): PaymentObservation {
  return { kind: "unknown", reason, reference: "order-1", verifiedAt: now };
}

function deps(observations: PaymentObservation[], expireOutcome: PaymentObservation) {
  const observePayment = vi.fn();
  for (const observation of observations) observePayment.mockResolvedValueOnce(observation);
  observePayment.mockResolvedValue(observations[observations.length - 1]);
  const expirePayment = vi.fn(async () => expireOutcome);
  const claimPaid = vi.fn(async () => ({ claimed: true, settled: true }));
  const failOrder = vi.fn<NonNullable<ReconcilePaymentDependencies["failOrder"]>>(async () => ({
    kind: "failed",
    cancelStatus: "confirmed",
    communicationQueued: true,
  }));
  const dependencies: ReconcilePaymentDependencies = {
    gateway: { observePayment, expirePayment },
    claimPaid,
    failOrder,
  };
  return { dependencies, observePayment, expirePayment, claimPaid, failOrder };
}

describe("decidePaymentReconciliation", () => {
  it("never derives failure from unknown, non-terminal statuses or a live deadline", () => {
    expect(
      decidePaymentReconciliation({
        observation: unknown("provider_unavailable"),
        deadlinePassed: true,
        durablePaymentEvidence: "possibly_sent",
      })
    ).toEqual({ action: "defer", reason: "provider_unknown" });
    expect(
      decidePaymentReconciliation({
        observation: {
          kind: "attempt_failed",
          reference: "order-1",
          amount: "111000.00",
          status: "deny",
          verifiedAt: now,
        },
        deadlinePassed: true,
        durablePaymentEvidence: "possibly_sent",
      })
    ).toEqual({ action: "defer", reason: "non_terminal_attempt_status" });
    expect(
      decidePaymentReconciliation({
        observation: pending(),
        deadlinePassed: false,
        durablePaymentEvidence: "possibly_sent",
      })
    ).toEqual({ action: "defer", reason: "deadline_not_reached" });
  });

  it("requires durable never-sent proof before a not-found result may fail an order", () => {
    expect(
      decidePaymentReconciliation({
        observation: { kind: "not_found", reference: "order-1", verifiedAt: now },
        deadlinePassed: true,
        durablePaymentEvidence: "unknown",
      })
    ).toEqual({ action: "manual_review", reason: "not_found_without_never_sent_proof" });
    expect(
      decidePaymentReconciliation({
        observation: { kind: "not_found", reference: "order-1", verifiedAt: now },
        deadlinePassed: true,
        durablePaymentEvidence: "never_sent",
      })
    ).toEqual({ action: "fail_never_sent" });
  });
});

describe("reconcilePendingPayment", () => {
  it("re-verifies a raced expire conflict and keeps a settled order paid instead of failing it", async () => {
    const harness = deps([pending(), paid()], unknown("expire_conflict"));

    const result = await reconcilePendingPayment(
      { orderId: "order-1", now },
      { ...harness.dependencies, loadWork: async () => work() }
    );

    expect(harness.expirePayment).toHaveBeenCalledOnce();
    expect(harness.observePayment).toHaveBeenCalledTimes(2);
    expect(harness.claimPaid).toHaveBeenCalledOnce();
    expect(harness.failOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "paid", settled: true });
  });

  it("finalizes an order only when the expire answer is an authoritative expire", async () => {
    const harness = deps([pending()], expired());

    const result = await reconcilePendingPayment(
      { orderId: "order-1", now },
      { ...harness.dependencies, loadWork: async () => work() }
    );

    expect(harness.failOrder).toHaveBeenCalledOnce();
    const failureInput = harness.failOrder.mock.calls[0][0] as unknown as {
      evidence: FailureEvidence;
    };
    expect(failureInput.evidence).toEqual({
      kind: "provider_expired",
      reference: "order-1",
      amount: "111000.00",
      verifiedAt: now,
    });
    expect(result).toEqual({ kind: "expired" });
  });

  it("reschedules a still-pending order without extending the deadline or expiring it", async () => {
    const harness = deps([pending()], expired());

    const result = await reconcilePendingPayment(
      { orderId: "order-1", now: new Date("2040-01-01T00:10:00Z") },
      { ...harness.dependencies, loadWork: async () => work() }
    );

    expect(harness.expirePayment).not.toHaveBeenCalled();
    expect(harness.failOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "deferred", reason: "deadline_not_reached" });
  });

  it("keeps an unknown provider answer held without any financial mutation", async () => {
    const harness = deps([unknown("provider_unavailable")], unknown("provider_unavailable"));

    const result = await reconcilePendingPayment(
      { orderId: "order-1", now },
      { ...harness.dependencies, loadWork: async () => work() }
    );

    expect(harness.expirePayment).not.toHaveBeenCalled();
    expect(harness.failOrder).not.toHaveBeenCalled();
    expect(harness.claimPaid).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "deferred", reason: "provider_unknown" });
  });

  it("routes a not-found session without never-sent proof to manual review, not to failure", async () => {
    const harness = deps([{ kind: "not_found", reference: "order-1", verifiedAt: now }], expired());

    const result = await reconcilePendingPayment(
      { orderId: "order-1", now },
      {
        ...harness.dependencies,
        loadWork: async () => work({ hasReadyRedirect: true }),
      }
    );

    expect(harness.failOrder).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "manual_review",
      reason: "not_found_without_never_sent_proof",
    });
  });

  it("never touches the provider for an order that is already paid or moved on", async () => {
    const harness = deps([paid()], expired());

    const result = await reconcilePendingPayment(
      { orderId: "order-1", now },
      {
        ...harness.dependencies,
        loadWork: async () => work({ status: "processing", paymentStatus: "paid" }),
      }
    );

    expect(harness.observePayment).not.toHaveBeenCalled();
    expect(harness.expirePayment).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "already_handled", status: "processing" });
  });
});
