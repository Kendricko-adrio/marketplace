import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jubelioStockOperations, orders } from "@/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { claimStockRecheck } from "@/lib/orders-service";
import { serializeError } from "@/lib/logger";

const requestSchema = z.object({
  operationId: z.string().min(1).max(100),
});

/**
 * Safely asks the store reconciliation cron to re-check a manual-review note.
 * It never submits an adjustment and therefore cannot duplicate a remote write.
 *
 * Branch scope comes from the Current Policy: own-branch edit is pinned to the
 * Home Branch (a cross-branch order id maps to 404 so existence is not
 * disclosed); all-branch edit is unrestricted.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("orders", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id: orderId } = await params;
    const orderLog = logger.child({ orderId });

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      orderLog.warn("stock-review.invalid_input", {
        outcome: "denied",
        issues: parsed.error.issues,
      });
      return NextResponse.json(
        { success: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    const orderRows = await db
      .select({ branchId: orders.branchId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (orderRows.length === 0) {
      crossBranchNotFound(orderLog);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      orderLog.warn("stock-review.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }
    // Own-branch scope can only act on their branch's orders — cross-branch
    // ids hide behind 404.
    if (scope.mode === "own" && orderRows[0].branchId !== scope.branchId) {
      crossBranchNotFound(orderLog);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    // Non-null invariant, established from the loaded order (never asserted):
    // a Jubelio stock operation only exists on a Jubelio-synced order, and
    // synced orders always carry their branch — a branchless order here is a
    // data violation, so the route fails closed before the claim (the
    // operation stays in manual_review and remains retryable).
    const orderBranchId = orderRows[0].branchId;
    if (!orderBranchId) {
      orderLog.warn("stock-review.order_branch_missing", {
        outcome: "denied",
        reason: "missing_order_branch",
        operationId: parsed.data.operationId,
      });
      return NextResponse.json(
        { success: false, error: "Order is not branch-scoped" },
        { status: 409 }
      );
    }

    // The conditional manual_review → reconciling claim and its audit event
    // run in ONE transaction (orders-service): a concurrent claim cannot
    // double-fire, and a failed audit write aborts the claim.
    const claim = await claimStockRecheck(orderId, parsed.data.operationId, {
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
      branchId: orderBranchId,
    });
    if (!claim.claimed) {
      orderLog.warn("stock-review.operation_not_claimable", {
        outcome: "denied",
        operationId: parsed.data.operationId,
      });
      return NextResponse.json(
        { success: false, error: "Operation is no longer in manual review" },
        { status: 409 }
      );
    }

    orderLog.info("stock-review.queued", {
      outcome: "success",
      operationId: parsed.data.operationId,
      scope: scope.mode,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("stock-review.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to queue reconciliation" },
      { status: 500 }
    );
  }
}