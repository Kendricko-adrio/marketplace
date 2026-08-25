import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, jubelioStockOperations, orders } from "@/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withPermission, getBranchScope } from "@/lib/auth-guard";
import { requestLogger, serializeError } from "@/lib/logger";

const requestSchema = z.object({
  operationId: z.string().min(1).max(100),
});

/** Safely asks the store reconciliation cron to re-check a manual-review note.
 * It never submits an adjustment and therefore cannot duplicate a remote write. */
export const POST = withPermission(async (
  { user },
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  let log = requestLogger(request, {
    module: "admin-orders",
    action: "recheck-jubelio-stock",
    userId: user.id,
    role: user.role,
  });
  try {
    const { id: orderId } = await params;
    log = log.child({ orderId });
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      log.warn("invalid stock-review request", { issues: parsed.error.issues });
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
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }
    const scope = getBranchScope(user);
    if (scope.mode === "own" && orderRows[0].branchId !== scope.branchId) {
      log.warn("stock-review forbidden for another branch", {
        orderBranchId: orderRows[0].branchId,
        adminBranchId: scope.branchId,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const changed = await db
      .update(jubelioStockOperations)
      .set({
        status: "reconciling",
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jubelioStockOperations.id, parsed.data.operationId),
          eq(jubelioStockOperations.orderId, orderId),
          eq(jubelioStockOperations.status, "manual_review")
        )
      )
      .returning({ id: jubelioStockOperations.id });
    if (changed.length === 0) {
      log.warn("manual-review operation was not claimable", {
        operationId: parsed.data.operationId,
      });
      return NextResponse.json(
        { success: false, error: "Operation is no longer in manual review" },
        { status: 409 }
      );
    }

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: user.id,
      action: "RECHECK_JUBELIO_STOCK",
      entityType: "order",
      entityId: orderId,
      changes: {
        operationId: parsed.data.operationId,
        status: { from: "manual_review", to: "reconciling" },
      },
      ipAddress: null,
    });
    log.info("manual-review stock operation queued for safe reconciliation", {
      operationId: parsed.data.operationId,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("stock-review request failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Failed to queue reconciliation" },
      { status: 500 }
    );
  }
}, "orders", "edit");
