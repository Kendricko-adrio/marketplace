import { db } from "@/db";
import type { JubelioSalesGateway } from "@/lib/jubelio-sales-client";
import { dispatchJubelioSalesCancel, dispatchJubelioSalesCreate } from "@/lib/jubelio-sales-lifecycle";
import { getJubelioSalesOperation } from "@/lib/jubelio-sales-operations";
import { createCheckoutPayment } from "@/lib/midtrans";
import { buildPaymentItemDetails } from "@/lib/payment-item-details";
import { createModuleLogger } from "@/lib/logger";
import {
  claimCheckoutPayment,
  accountConfirmedAttemptCancelHold,
  finalizeRejectedCheckoutAttempt,
  findCheckoutAttemptIdentity,
  loadResumableCheckoutAttempt,
  markCheckoutAttemptForManualReview,
  promoteCheckoutAttempt,
  readCheckoutAttemptProgress,
  readOwnedCheckoutAttempt,
  recordCheckoutPaymentEvidence,
  reserveCheckoutAttempt,
  type WriteDatabase,
} from "./checkout-attempt-repository";
import { CheckoutAttemptReservationError } from "./checkout-attempt";
import type {
  CheckoutAttemptResult, CheckoutAttemptSnapshot, CheckoutPaymentOutcome, ReserveCheckoutAttemptInput,
} from "./checkout-attempt";

/**
 * One new-checkout use case: reserve → confirmed SO → ready payment → promotion.
 * Provider calls stay outside transactions; no order exists before promotion.
 */
const log = createModuleLogger("checkout-place-order");

export interface PlaceCheckoutDependencies {
  database?: WriteDatabase;
  salesGateway?: Pick<JubelioSalesGateway, "createSalesOrder" | "cancelSalesOrder">;
  initializePayment?: (input: Parameters<typeof createCheckoutPayment>[0]) => Promise<CheckoutPaymentOutcome>;
}

export type PlaceCheckoutResult = CheckoutAttemptResult & {
  /** HTTP-only: tells the route whether this call created the order or replayed it. */
  replayed: boolean;
};

interface AttemptWork {
  attemptId: string;
  clientId: string;
  requestKey: string;
  snapshot: CheckoutAttemptSnapshot;
  paymentStartedAt: Date;
  expiresAt: Date;
}

/** Shared pipeline after the reservation exists (new placement, replay, recovery). */
async function continuePlacement(
  work: AttemptWork,
  dependencies: PlaceCheckoutDependencies,
  database: WriteDatabase,
  replayed: boolean,
): Promise<PlaceCheckoutResult> {
  const owner = { kind: "attempt" as const, attemptId: work.attemptId };
  const read = async () => {
    const result = await readOwnedCheckoutAttempt({ clientId: work.clientId, requestKey: work.requestKey }, database as never);
    if (!result) throw new Error("Checkout attempt disappeared during placement");
    return result;
  };
  // Bounded wait: a concurrent caller may be the one holding the payment claim.
  const settled = async (ms = 1500) => {
    const deadline = Date.now() + ms;
    let result = await read();
    while (!["promoted", "rejected", "manual_review"].includes(result.state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      result = await read();
    }
    return result;
  };
  const current = await read();
  if (["rejected", "manual_review", "promoted"].includes(current.state)) {
    return { ...current, replayed };
  }

  // ===== SO create: never a second POST once a claim exists =====
  const createOp = await getJubelioSalesOperation(database as never, { owner, type: "create" });
  if (createOp?.status === "rejected") {
    await finalizeRejectedCheckoutAttempt({ attemptId: work.attemptId, reason: "SALES_ORDER_REJECTED" }, database);
    return { ...(await read()), replayed };
  }
  if (createOp?.status === "dispatched_unknown" && createOp.dispatchedAt &&
    Date.now() - createOp.dispatchedAt.getTime() < 60_000) {
    // A fresh claim belongs to a concurrent caller still awaiting the provider;
    // only an AGED unknown outcome needs an operator.
    return { ...(await settled()), replayed };
  }
  if (createOp?.status === "manual_review" || createOp?.status === "dispatched_unknown") {
    await markCheckoutAttemptForManualReview({ attemptId: work.attemptId }, database);
    return { ...(await read()), replayed };
  }
  if (createOp?.status !== "confirmed") {
    let outcome: Awaited<ReturnType<typeof dispatchJubelioSalesCreate>>;
    try {
      outcome = await dispatchJubelioSalesCreate({ orderId: work.attemptId, owner,
        create: work.snapshot.createRequest, gateway: dependencies.salesGateway });
    } catch {
      // The local claim failed before any provider call: retryable, never an order.
      log.error(`Checkout attempt ${work.attemptId}: Sales Order dispatch could not start`);
      return { ...(await read()), replayed };
    }
    if (outcome.status === "rejected") {
      await finalizeRejectedCheckoutAttempt({ attemptId: work.attemptId, reason: "SALES_ORDER_REJECTED" }, database);
      return { ...(await read()), replayed };
    }
    if (outcome.status !== "confirmed") {
      if (outcome.status === "manual_review") await markCheckoutAttemptForManualReview({ attemptId: work.attemptId }, database);
      return { ...(await read()), replayed };
    }
  }

  // A previously persisted ready session only needs the local promotion; never
  // claim or create a second payment session for it.
  const progress = await readCheckoutAttemptProgress({ clientId: work.clientId, requestKey: work.requestKey }, database as never);
  if (progress?.paymentState === "ready") {
    try { await promoteCheckoutAttempt({ attemptId: work.attemptId }, database); }
    catch { log.warn(`Checkout attempt ${work.attemptId}: promotion still pending recovery`); }
    return { ...(await read()), replayed };
  }
  if (progress?.paymentState === "dispatched_unknown") return { ...(await settled()), replayed };

  // ===== Payment session: claim first, classify the outcome honestly =====
  const itemDetails = buildPaymentItemDetails({
    items: work.snapshot.items.map((item) => ({ id: item.variantId, name: item.productName,
      price: item.price, quantity: item.quantity })),
    discount: work.snapshot.order.discount ?? "0",
    shippingCost: work.snapshot.order.shippingCost ?? "0",
    serviceFee: work.snapshot.order.serviceFee ?? "0",
    ppnRatePercent: work.snapshot.order.ppnRate ?? "0",
    ppnAmount: work.snapshot.order.ppnAmount ?? "0",
    total: work.snapshot.order.total,
  });
  const claim = await claimCheckoutPayment({ attemptId: work.attemptId }, database);
  if (!claim.claimed) {
    log.warn(`Checkout attempt ${work.attemptId}: payment dispatch not claimed (${claim.reason})`);
    return { ...(await settled()), replayed };
  }
  const expiryMinutes = Math.max(1, Math.ceil((claim.expiresAt.getTime() - claim.paymentStartedAt.getTime()) / 60_000));
  const initialize = dependencies.initializePayment ?? createCheckoutPayment;
  const payment = await initialize({
    orderId: claim.reference, grossAmount: Number(work.snapshot.order.total),
    customerDetails: { first_name: work.snapshot.createRequest.customerName,
      email: String(work.snapshot.order.contactEmail), phone: String(work.snapshot.order.contactPhone) },
    itemDetails, expiryMinutes, paymentStartedAt: claim.paymentStartedAt,
  });
  await recordCheckoutPaymentEvidence({ attemptId: work.attemptId, outcome: payment }, database);
  if (payment.kind !== "ready") {
    if (payment.kind === "definitive_rejection") {
      const cancel = await dispatchJubelioSalesCancel({ orderId: work.attemptId, owner,
        reason: "Payment initialization definitively rejected before any session existed",
        gateway: dependencies.salesGateway });
      if (cancel.status === "confirmed") await accountConfirmedAttemptCancelHold(work.attemptId, database);
      else {
        log.warn(`Checkout attempt ${work.attemptId}: SO compensation not confirmed (${cancel.status})`);
        await markCheckoutAttemptForManualReview({ attemptId: work.attemptId }, database);
      }
    }
    return { ...(await read()), replayed };
  }

  try {
    await promoteCheckoutAttempt({ attemptId: work.attemptId }, database);
  } catch {
    // External success already exists. Never claim failure: keep the attempt
    // under recovery so the local commit can finish without a second write.
    log.error(`Checkout attempt ${work.attemptId}: promotion interrupted; retained for recovery`);
  }
  return { ...(await read()), replayed };
}

export async function placeCheckout(
  input: ReserveCheckoutAttemptInput,
  dependencies: PlaceCheckoutDependencies = {},
): Promise<PlaceCheckoutResult> {
  const database = dependencies.database ?? db;
  let reserved: { attemptId: string; created: boolean };
  try {
    reserved = await reserveCheckoutAttempt(input, database);
  } catch (error) {
    // Concurrent same-key race: the competing caller may still be committing
    // its attempt, so look for it briefly before treating this as stale input.
    let identity = await findCheckoutAttemptIdentity({ clientId: input.clientId, requestKey: input.requestKey }, database as never);
    for (let attempt = 0; !identity && attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      identity = await findCheckoutAttemptIdentity({ clientId: input.clientId, requestKey: input.requestKey }, database as never);
    }
    if (!identity) throw error;
    if (identity.fingerprint !== input.fingerprint) throw new CheckoutAttemptReservationError("REQUEST_KEY_CONFLICT");
    reserved = { attemptId: identity.attemptId, created: false };
  }
  log.info(`Checkout attempt ${reserved.attemptId}: placement started (new ${reserved.created})`);
  return continuePlacement({
    attemptId: reserved.attemptId, clientId: input.clientId, requestKey: input.requestKey,
    snapshot: input.snapshot, paymentStartedAt: input.paymentStartedAt, expiresAt: input.expiresAt,
  }, dependencies, database, !reserved.created);
}

/**
 * Answers a replay BEFORE stock/pricing re-checks: the retained attempt is the
 * authority, so an already-consumed hold cannot turn a success into a failure.
 */
export async function replayCheckoutAttempt(
  input: { clientId: string; requestKey: string; fingerprint: string; database?: WriteDatabase },
  dependencies: Omit<PlaceCheckoutDependencies, "database"> = {},
): Promise<PlaceCheckoutResult | null> {
  const database = input.database ?? db;
  const identity = await findCheckoutAttemptIdentity({ clientId: input.clientId, requestKey: input.requestKey }, database as never);
  if (!identity) return null;
  if (identity.fingerprint !== input.fingerprint) throw new CheckoutAttemptReservationError("REQUEST_KEY_CONFLICT");
  const resumable = await loadResumableCheckoutAttempt({ clientId: input.clientId, requestKey: input.requestKey }, database as never);
  if (!resumable) {
    const result = await readOwnedCheckoutAttempt({ clientId: input.clientId, requestKey: input.requestKey }, database as never);
    if (!result) throw new Error("Checkout attempt disappeared during replay");
    return { ...result, replayed: true };
  }
  return continuePlacement(resumable, { ...dependencies, database }, database, true);
}
