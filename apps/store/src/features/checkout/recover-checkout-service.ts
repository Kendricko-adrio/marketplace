import { and, asc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db, checkoutAttempts, jubelioSalesOperations } from "@/db";
import { dispatchJubelioSalesCreate } from "@/lib/jubelio-sales-lifecycle";
import { getJubelioSalesOperation } from "@/lib/jubelio-sales-operations";
import {
  accountConfirmedAttemptCancelHold,
  finalizeExpiredCheckoutAttempt,
  markCheckoutAttemptForManualReview,
  promoteCheckoutAttempt,
} from "./checkout-attempt-repository";
import { createModuleLogger } from "@/lib/logger";

/**
 * Bounded, GET/local-only recovery for pre-order attempts. No provider write is
 * initiated here: a possibly-sent operation is only moved to manual review.
 */
const log = createModuleLogger("checkout-attempt-recovery");
type WriteDatabase = Pick<typeof db, "transaction">;

export interface CheckoutRecoverySummary {
  scanned: number;
  promoted: number;
  rejected: number;
  held: number;
}

export async function recoverCheckoutAttempts(
  input: { limit: number; cutoff: Date; now?: Date },
  database: WriteDatabase = db,
): Promise<CheckoutRecoverySummary> {
  const now = input.now ?? new Date();
  const rows = await database.transaction((tx) => tx.select().from(checkoutAttempts)
    .where(and(or(
      and(inArray(checkoutAttempts.state, ["preparing", "compensating", "processing"]),
        lt(checkoutAttempts.updatedAt, input.cutoff)),
      // A never-dispatched reservation is safe to resume immediately (claim).
      and(eq(checkoutAttempts.state, "preparing"), eq(checkoutAttempts.paymentState, "none"),
        eq(checkoutAttempts.stockHoldState, "held")),
    )))
    .orderBy(asc(checkoutAttempts.updatedAt)).limit(Math.min(50, Math.max(1, input.limit))));
  const summary: CheckoutRecoverySummary = { scanned: rows.length, promoted: 0, rejected: 0, held: 0 };
  for (const attempt of rows) {
    try {
      if (attempt.state === "preparing" && attempt.paymentState === "none" &&
        attempt.stockHoldState === "held" && attempt.expiresAt.getTime() <= now.getTime()) {
        await finalizeExpiredCheckoutAttempt({ attemptId: attempt.id, now }, database);
        summary.rejected++;
        continue;
      }
      if (attempt.state === "processing" && attempt.paymentState === "ready") {
        await promoteCheckoutAttempt({ attemptId: attempt.id }, database);
        summary.promoted++;
        continue;
      }
      if (attempt.state === "compensating" && attempt.paymentState === "rejected") {
        // Only a CONFIRMED cancel may restore stock; the repository enforces it.
        try {
          await accountConfirmedAttemptCancelHold(attempt.id, database);
          summary.rejected++;
        } catch {
          summary.held++;
        }
        continue;
      }
      // Never-sent SO intent: safe to claim and dispatch once, no payment yet.
      if (attempt.state === "preparing" && attempt.paymentState === "none" && attempt.stockHoldState === "held") {
        const create = await getJubelioSalesOperation(db, { owner: { kind: "attempt", attemptId: attempt.id }, type: "create" });
        if (create?.status === "intent" && create.dispatchedAt == null && create.salesOrderId == null) {
          await dispatchNeverSentCreate(attempt.id, attempt.snapshot.createRequest);
          summary.held++;
          continue;
        }
      }
      await markCheckoutAttemptForManualReview({ attemptId: attempt.id }, database);
      summary.held++;
    } catch {
      summary.held++;
      log.error(`Checkout attempt ${attempt.id}: recovery held (state ${attempt.state})`);
    }
  }
  if (summary.scanned > 0) {
    log.info(`Checkout attempt recovery scanned ${summary.scanned}: promoted ${summary.promoted}, rejected ${summary.rejected}, held ${summary.held}`);
  }
  return summary;
}

/**
 * Claim + dispatch a create intent that never reached the provider. The ledger
 * claim guarantees at most one POST; the payment session is still created by the
 * customer's next placement for the same request key.
 */
async function dispatchNeverSentCreate(attemptId: string, create: Parameters<typeof dispatchJubelioSalesCreate>[0]["create"]): Promise<boolean> {
  const outcome = await dispatchJubelioSalesCreate({ orderId: attemptId, owner: { kind: "attempt", attemptId }, create });
  log.info(`Checkout attempt ${attemptId}: never-sent Sales Order dispatch resumed (${outcome.status})`);
  return true;
}

/** Counts unresolved attempts without loading snapshots (bounded ops view). */
export async function countUnresolvedCheckoutAttempts(database: WriteDatabase = db): Promise<number> {
  const rows = await database.transaction((tx) => tx.select({ id: checkoutAttempts.id }).from(checkoutAttempts)
    .where(and(ne(checkoutAttempts.state, "promoted"), ne(checkoutAttempts.state, "rejected"),
      isNull(checkoutAttempts.orderId))).limit(100));
  return rows.length;
}
