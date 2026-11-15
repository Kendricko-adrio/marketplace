import { createModuleLogger } from "@/lib/logger";
import { failOrderWithEvidence } from "@/features/orders/fail-order-service";
import type { FailureEvidence, PaymentInitializationOutcome } from "./payment-evidence";
import type { PaymentGateway } from "./midtrans-payment-client";
import {
  claimOrderPaymentInitialization,
  loadSnapSessionRequest,
  recordOrderPaymentOutcome,
  type OrderPaymentClaim,
  type OrderPaymentWriteDatabase,
} from "./order-payment-repository";
import { createCheckoutPayment } from "@/lib/midtrans";
import type { CheckoutPaymentOutcome } from "@/features/checkout/checkout-attempt";

/**
 * TX-02 — satu workflow initialisasi pembayaran per order (spec §8.2).
 *
 * Legacy initial payment dan repayment memakai klaim durable yang SAMA
 * (`order_payment_session`), sehingga dua pemanggil paralel tidak bisa
 * menciptakan dua sesi Snap. Provider HTTP selalu berada di luar transaksi.
 *
 * Outcome:
 * - `ready`   → redirect/token tersimpan atomik bersama pointer order.
 * - `unknown` → tidak ada compensation, tidak ada cancel SO; caller
 *               mengembalikan status processing yang jujur.
 * - `definitive_rejection` → bukti claim-owned disimpan, lalu failure +
 *               cancel obligation atomik lewat use case TX-05.
 */

const log = createModuleLogger("initialize-order-payment");

export type OrderPaymentResult =
  | { kind: "ready"; redirectUrl: string; token: string | null; replayed: boolean }
  | { kind: "processing"; reason: "dispatched_unknown" | "initialization_unknown" }
  | { kind: "manual_review"; reason: string }
  | { kind: "rejected"; reason: string }
  | { kind: "paid" }
  | { kind: "expired" }
  | { kind: "not_eligible"; orderStatus: string; paymentStatus: string }
  | { kind: "not_found" };

export interface InitializeOrderPaymentDependencies {
  database?: OrderPaymentWriteDatabase;
  gateway?: PaymentGateway;
  now?: Date;
  /** Caller-supplied provider request; default reads the persisted order. */
  createSession?: (claim: {
    providerReference: string;
    expectedAmount: string;
    paymentStartedAt: Date;
    expiresAt: Date;
  }) => Promise<PaymentInitializationOutcome>;
}

/** Map the provider adapter outcome into the durable-initialization contract. */
export function toInitializationOutcome(
  outcome: CheckoutPaymentOutcome
): PaymentInitializationOutcome {
  if (outcome.kind === "ready") {
    return { kind: "ready", token: outcome.token, redirectUrl: outcome.redirectUrl };
  }
  if (outcome.kind === "definitive_rejection") {
    return { kind: "definitive_rejection", code: "provider_rejected" };
  }
  return { kind: "unknown", code: "initialization_unknown" };
}

function expiryMinutes(paymentStartedAt: Date, expiresAt: Date): number {
  const minutes = Math.round((expiresAt.getTime() - paymentStartedAt.getTime()) / 60_000);
  return minutes > 0 ? minutes : 1;
}

function defaultCreateSession(orderId: string) {
  return async (claim: {
    providerReference: string;
    expectedAmount: string;
    paymentStartedAt: Date;
    expiresAt: Date;
  }): Promise<PaymentInitializationOutcome> => {
    const request = await loadSnapSessionRequest(orderId);
    if (!request) return { kind: "unknown", code: "order_unavailable" };
    return toInitializationOutcome(await createCheckoutPayment({
      orderId: claim.providerReference,
      grossAmount: Math.round(Number(claim.expectedAmount)),
      customerDetails: request.customer,
      itemDetails: request.items,
      expiryMinutes: expiryMinutes(claim.paymentStartedAt, claim.expiresAt),
      paymentStartedAt: claim.paymentStartedAt,
    }));
  };
}

function mapClaimLoser(claim: Extract<OrderPaymentClaim, { claimed: false }>): OrderPaymentResult {
  switch (claim.reason) {
    case "ready":
      return { kind: "ready", redirectUrl: claim.redirectUrl, token: null, replayed: true };
    case "already_claimed":
      return { kind: "processing", reason: "dispatched_unknown" };
    case "paid":
      return { kind: "paid" };
    case "expired":
      return { kind: "expired" };
    case "rejected":
      return { kind: "rejected", reason: "payment_rejected" };
    case "legacy_unknown":
    case "manual_review":
      return { kind: "manual_review", reason: "legacy_unknown" };
    case "deadline_passed":
      return { kind: "expired" };
    case "sales_order_not_confirmed":
      return { kind: "manual_review", reason: "sales_order_not_confirmed" };
    case "cancel_active":
      return { kind: "manual_review", reason: "cancel_active" };
    case "not_eligible":
      return {
        kind: "not_eligible",
        orderStatus: claim.orderStatus,
        paymentStatus: claim.paymentStatus,
      };
    case "not_found":
      return { kind: "not_found" };
  }
}

export async function initializeOrderPayment(
  input: {
    orderId: string;
    clientId: string;
    source: "legacy_place" | "repayment";
  },
  dependencies: InitializeOrderPaymentDependencies = {}
): Promise<OrderPaymentResult> {
  const now = dependencies.now ?? new Date();
  const claim = await claimOrderPaymentInitialization(
    {
      orderId: input.orderId,
      clientId: input.clientId,
      now,
      adoptHistoricalRedirect: true,
    },
    dependencies.database
  );
  if (!claim.claimed) {
    const result = mapClaimLoser(claim);
    log.info(
      `Order ${input.orderId}: payment initialization not dispatched (${claim.reason}, source ${input.source})`
    );
    return result;
  }

  const createSession = dependencies.createSession ?? defaultCreateSession(input.orderId);
  let outcome: PaymentInitializationOutcome;
  try {
    outcome = await createSession({
      providerReference: claim.providerReference,
      expectedAmount: claim.expectedAmount,
      paymentStartedAt: claim.paymentStartedAt,
      expiresAt: claim.expiresAt,
    });
  } catch {
    // The dispatch permission is already committed: a thrown provider error is
    // UNKNOWN, never a rejection. The row stays dispatched_unknown.
    outcome = { kind: "unknown", code: "provider_unavailable" };
  }

  const recorded = await recordOrderPaymentOutcome(
    {
      sessionId: claim.sessionId,
      dispatchClaimId: claim.dispatchClaimId,
      outcome,
      now,
    },
    dependencies.database
  );

  if (recorded.kind === "claim_lost") {
    // A concurrent writer recorded the outcome; read nothing, promise nothing.
    return { kind: "processing", reason: "dispatched_unknown" };
  }

  if (recorded.kind === "ready") {
    log.info(
      `Order ${input.orderId}: payment session ready (cart lines removed ${recorded.cartLinesDeleted}, source ${input.source})`
    );
    return {
      kind: "ready",
      redirectUrl: recorded.redirectUrl,
      token: recorded.token,
      replayed: false,
    };
  }

  if (recorded.kind === "rejected") {
    const evidence: FailureEvidence = {
      kind: "payment_initialization_rejected",
      reference: input.orderId,
      code: outcome.kind === "definitive_rejection" ? outcome.code : "provider_rejected",
      claimedAt: now,
    };
    const failure = await failOrderWithEvidence({ orderId: input.orderId, evidence }, {
      database: dependencies.database,
    });
    log.warn(
      `Order ${input.orderId}: payment initialization definitively rejected (failure ${failure.kind})`
    );
    return {
      kind: "rejected",
      reason: failure.kind === "failed" ? "payment_rejected" : failure.kind,
    };
  }

  log.warn(
    `Order ${input.orderId}: payment initialization outcome unknown — order stays pending, no compensation`
  );
  return { kind: "processing", reason: "initialization_unknown" };
}
