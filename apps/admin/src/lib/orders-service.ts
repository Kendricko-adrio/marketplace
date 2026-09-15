import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  jubelioStockOperations,
  orders,
  type orders as ordersSchema,
} from "@/db";
import { writeAuditEvent } from "@/lib/rbac/audit-writer";

// =========================================================
// RBAC: transactional order mutation service
// =========================================================
// Two transactional seams shared by the admin order routes:
//
// - `claimStockRecheck` (stock-review route): the atomic manual_review →
//   reconciling claim and its RECHECK_JUBELIO_STOCK audit event run in ONE
//   local DB transaction. The claim itself is a conditional UPDATE, so a
//   concurrent claim cannot double-fire; when no row matches, nothing is
//   written at all (no audit for a claim that did not happen).
//
// - `finalizePickupCompletion` (verify-pickup route): the local finalization
//   after the external store `order-complete` call — attempt reset, lock
//   clear, and the VERIFY_PICKUP_CODE audit event — runs in ONE transaction
//   behind a locked (`SELECT … FOR UPDATE`) status re-check. This is the
//   reconciliation/idempotency seam for the unavoidable external HTTP
//   boundary: the route calls it BOTH on the happy path and after an
//   ambiguous external failure (see the verify-pickup route). It deliberately
//   does NOT write the order status itself — `completed` is owned by the
//   store endpoint; this service only finalizes the admin-side state.
//
// Failures are typed as `OrderServiceError` with stable codes; the routes map
// them to the same responses the inline implementations used to produce.

export type OrderServiceErrorCode = "NOT_FOUND";

export class OrderServiceError extends Error {
  readonly code: OrderServiceErrorCode;

  constructor(code: OrderServiceErrorCode, message: string) {
    super(message);
    this.name = "OrderServiceError";
    this.code = code;
  }
}

export interface OrderMutationContext {
  /** Acting admin id (audit actor). */
  actorId: string | null;
  /** Current Policy version in force when the event is written. */
  policyVersion: number | null;
  /** Order's branch (audit branch tag for branch-owned data). */
  branchId: string;
}

export type StockReviewClaimResult = { claimed: true } | { claimed: false };

/**
 * Atomically claims a manual_review Jubelio stock operation for
 * reconciliation and writes the audit event in the same transaction.
 * Returns `claimed: false` when the operation is no longer in manual_review
 * (the route turns this into the stable 409).
 */
export async function claimStockRecheck(
  orderId: string,
  operationId: string,
  ctx: OrderMutationContext
): Promise<StockReviewClaimResult> {
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(jubelioStockOperations)
      .set({
        status: "reconciling",
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jubelioStockOperations.id, operationId),
          eq(jubelioStockOperations.orderId, orderId),
          eq(jubelioStockOperations.status, "manual_review")
        )
      )
      .returning({ id: jubelioStockOperations.id });
    if (changed.length === 0) {
      return { claimed: false } as const;
    }

    await writeAuditEvent(tx, {
      actorId: ctx.actorId,
      action: "RECHECK_JUBELIO_STOCK",
      entityType: "order",
      entityId: orderId,
      changes: {
        operationId,
        status: { from: "manual_review", to: "reconciling" },
      },
      policyVersion: ctx.policyVersion,
      branchScope: "single_branch",
      branchId: ctx.branchId,
    });

    return { claimed: true } as const;
  });
}

export type PickupFinalizeResult =
  | { finalized: true }
  | { finalized: false; status: string };

/**
 * Finalizes the admin-side state of a completed pickup verification in ONE
 * transaction: locks the order row, re-checks its status, resets the pickup
 * attempt counter and lock, and writes the VERIFY_PICKUP_CODE audit event.
 *
 * The order status itself is owned by the store's order-complete endpoint; an
 * order that is not `completed` is reported as `not finalized` so the route
 * can return a stable 502 without mutating anything (no attempt reset, no
 * audit) — the verification stays retryable.
 */
export async function finalizePickupCompletion(
  orderId: string,
  ctx: OrderMutationContext
): Promise<PickupFinalizeResult> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);
    if (locked.length === 0) {
      throw new OrderServiceError("NOT_FOUND", "Order not found");
    }
    const order = locked[0] as typeof ordersSchema.$inferSelect;

    if (order.status !== "completed") {
      return { finalized: false, status: order.status } as const;
    }

    await tx
      .update(orders)
      .set({
        pickupVerificationAttempts: 0,
        pickupLockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    await writeAuditEvent(tx, {
      actorId: ctx.actorId,
      action: "VERIFY_PICKUP_CODE",
      entityType: "order",
      entityId: orderId,
      changes: { status: { from: "ready_for_pickup", to: "completed" } },
      policyVersion: ctx.policyVersion,
      branchScope: "single_branch",
      branchId: ctx.branchId,
    });

    return { finalized: true } as const;
  });
}