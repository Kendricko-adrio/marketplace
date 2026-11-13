import { describe, expect, it } from "vitest";
import {
  describeFailureEvidence,
  failureEvidenceMatches,
  failureStatusToken,
  moneyMatches,
  validatePaymentObservation,
  type FailureEvidence,
} from "./payment-evidence";

const verifiedAt = new Date("2040-01-01T00:00:00Z");
const reference = "order-123";

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    order_id: reference,
    gross_amount: "111000.00",
    transaction_status: "settlement",
    status_code: "200",
    transaction_id: "tx-1",
    payment_type: "qris",
    fraud_status: "accept",
    ...overrides,
  };
}

describe("validatePaymentObservation", () => {
  it("treats an authoritative settlement for the matching order and amount as paid", () => {
    const observation = validatePaymentObservation({
      expectedReference: reference,
      expectedAmount: "111000",
      observation: providerBody(),
      verifiedAt,
    });

    expect(observation).toEqual({
      kind: "paid",
      reference,
      amount: "111000.00",
      transactionId: "tx-1",
      paymentType: "qris",
      verifiedAt,
    });
  });

  it("accepts capture only when fraud status is accept", () => {
    const accepted = validatePaymentObservation({
      expectedReference: reference,
      expectedAmount: "111000.00",
      observation: providerBody({ transaction_status: "capture" }),
      verifiedAt,
    });
    const challenged = validatePaymentObservation({
      expectedReference: reference,
      expectedAmount: "111000.00",
      observation: providerBody({ transaction_status: "capture", fraud_status: "challenge" }),
      verifiedAt,
    });

    expect(accepted.kind).toBe("paid");
    expect(challenged).toMatchObject({ kind: "pending", amount: "111000.00" });
  });

  it("reads an authoritative expire as expired", () => {
    const observation = validatePaymentObservation({
      expectedReference: reference,
      expectedAmount: "111000.00",
      observation: providerBody({ transaction_status: "expire" }),
      verifiedAt,
    });

    expect(observation).toMatchObject({ kind: "expired", reference, amount: "111000.00" });
  });

  it("never turns a mismatched amount, reference or malformed body into paid or expired", () => {
    const wrongAmount = validatePaymentObservation({
      expectedReference: reference,
      expectedAmount: "111000",
      observation: providerBody({ gross_amount: "1.00" }),
      verifiedAt,
    });
    const wrongReference = validatePaymentObservation({
      expectedReference: reference,
      expectedAmount: "111000",
      observation: providerBody({ order_id: "someone-else" }),
      verifiedAt,
    });
    const malformed = validatePaymentObservation({
      expectedReference: reference,
      expectedAmount: "111000",
      observation: "not-json",
      verifiedAt,
    });
    const missingStatus = validatePaymentObservation({
      expectedReference: reference,
      expectedAmount: "111000",
      observation: { order_id: reference, gross_amount: "111000.00" },
      verifiedAt,
    });

    expect(wrongAmount).toMatchObject({ kind: "unknown", reason: "amount_mismatch" });
    expect(wrongReference).toMatchObject({ kind: "unknown", reason: "reference_mismatch" });
    expect(malformed).toMatchObject({ kind: "unknown", reason: "malformed_response" });
    expect(missingStatus).toMatchObject({ kind: "unknown", reason: "malformed_response" });
  });

  it("keeps deny/cancel/failure non-terminal and unknown statuses unknown", () => {
    expect(
      validatePaymentObservation({
        expectedReference: reference,
        expectedAmount: "111000.00",
        observation: providerBody({ transaction_status: "deny" }),
        verifiedAt,
      })
    ).toMatchObject({ kind: "attempt_failed", status: "deny" });
    expect(
      validatePaymentObservation({
        expectedReference: reference,
        expectedAmount: "111000.00",
        observation: providerBody({ transaction_status: "refund_pending" }),
        verifiedAt,
      })
    ).toMatchObject({ kind: "unknown", reason: "status_unrecognized" });
  });
});

describe("failure evidence", () => {
  const providerExpired: FailureEvidence = {
    kind: "provider_expired",
    reference,
    amount: "111000.00",
    verifiedAt,
  };

  it("maps each durable kind to a fixed reason and allowlisted status token", () => {
    const rejected: FailureEvidence = {
      kind: "payment_initialization_rejected",
      reference,
      code: "auth",
      claimedAt: verifiedAt,
    };
    const neverSent: FailureEvidence = {
      kind: "never_sent_expired",
      reference,
      expiresAt: new Date("2040-01-01T00:15:00Z"),
    };

    expect(describeFailureEvidence(providerExpired)).toBe(
      "Payment expired — order timed out (verified provider status)"
    );
    expect(describeFailureEvidence(rejected)).toBe(
      "Payment initialization rejected by provider"
    );
    expect(describeFailureEvidence(neverSent)).toBe(
      "Payment expired — order timed out (payment was never started)"
    );
    expect(failureStatusToken(providerExpired)).toBe("expire");
    expect(failureStatusToken(rejected)).toBe("initialization_rejected");
    expect(failureStatusToken(neverSent)).toBe("not_sent");
  });

  it("rejects expiry evidence for another order or another amount", () => {
    expect(failureEvidenceMatches(providerExpired, { reference, amount: "111000" })).toBe(true);
    expect(failureEvidenceMatches(providerExpired, { reference: "other", amount: "111000" })).toBe(
      false
    );
    expect(failureEvidenceMatches(providerExpired, { reference, amount: "111001" })).toBe(false);
    expect(failureEvidenceMatches(providerExpired, { reference })).toBe(false);
  });

  it("compares amounts without floating point drift", () => {
    expect(moneyMatches("111000", "111000.00")).toBe(true);
    expect(moneyMatches("0.1", "0.10")).toBe(true);
    expect(moneyMatches("111000", "111000.01")).toBe(false);
    expect(moneyMatches("abc", "111000")).toBe(false);
  });
});
