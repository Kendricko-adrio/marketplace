import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { branches, checkoutAttempts, clients, jubelioSalesOperations } from "@/db";
import type { BranchPredicateScope } from "@/lib/rbac/branch-scope";

/** Read-only operator projection; never exposes snapshots, contacts or payment tokens. */
export interface CheckoutAttemptReviewRow {
  attemptId: string;
  requestKey: string;
  state: string;
  paymentState: string;
  stockHoldState: string;
  failureCode: string | null;
  stage: "sales_order" | "payment" | "compensation";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  branchName: string | null;
  customerName: string;
  customerEmail: string;
}

/**
 * Unresolved pre-order attempts only: an attempt that already produced an order
 * is visible through Orders, and a rejected attempt needs no operator action.
 * Own-branch scope filters on the attempt's branch, near the data.
 */
export async function listCheckoutAttemptReviews(
  input: { scope: BranchPredicateScope; limit?: number },
): Promise<CheckoutAttemptReviewRow[]> {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const rows = await db.select({
    attemptId: checkoutAttempts.id,
    requestKey: checkoutAttempts.requestKey,
    state: checkoutAttempts.state,
    paymentState: checkoutAttempts.paymentState,
    stockHoldState: checkoutAttempts.stockHoldState,
    failureCode: checkoutAttempts.failureCode,
    createdAt: checkoutAttempts.createdAt,
    updatedAt: checkoutAttempts.updatedAt,
    expiresAt: checkoutAttempts.expiresAt,
    branchName: branches.name,
    customerName: clients.name,
    customerEmail: clients.email,
  }).from(checkoutAttempts)
    .leftJoin(branches, eq(branches.id, checkoutAttempts.branchId))
    .innerJoin(clients, eq(clients.id, checkoutAttempts.clientId))
    .where(and(ne(checkoutAttempts.state, "promoted"), ne(checkoutAttempts.state, "rejected"),
      input.scope.mode === "own" ? eq(checkoutAttempts.branchId, input.scope.branchId) : undefined))
    .orderBy(desc(checkoutAttempts.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    attemptId: row.attemptId,
    requestKey: row.requestKey,
    state: row.state,
    paymentState: row.paymentState,
    stockHoldState: row.stockHoldState,
    failureCode: row.failureCode,
    stage: row.paymentState === "rejected" ? "compensation" : row.paymentState === "none" ? "sales_order" : "payment",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    branchName: row.branchName ?? null,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
  }));
}
