import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jubelioStockOperations, orders } from "@/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { claimStockRecheck } from "@/lib/orders-service";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

const requestSchema = z.object({
  operationId: z.string().min(1).max(100),
});

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-stock-review");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB tidak pernah
 * masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/**
 * Safely asks the store reconciliation cron to re-check a manual-review note.
 * It never submits an adjustment and therefore cannot duplicate a remote write.
 *
 * Branch scope comes from the Current Policy: own-branch edit is pinned to the
 * Home Branch (a cross-branch order id maps to 404 so existence is not
 * disclosed); all-branch edit is unrestricted.
 */
async function stockReview(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guardResult = await guard("orders", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let orderId: string | null = null;
  try {
    const { id } = await params;
    orderId = id;

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      log.warn(
        `stock-review ditolak: body tidak valid (order ${orderId}, outcome denied)`
      );
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
      crossBranchNotFound();
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      log.warn(
        `stock-review ditolak: branch scope tidak dapat ditentukan (order ${orderId}, userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }
    // Own-branch scope can only act on their branch's orders — cross-branch
    // ids hide behind 404.
    if (scope.mode === "own" && orderRows[0].branchId !== scope.branchId) {
      crossBranchNotFound();
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
      log.warn(
        `stock-review ditolak: order tanpa branch (order ${orderId}, operation ${parsed.data.operationId}, reason missing_order_branch, outcome denied)`
      );
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
      log.warn(
        `stock-review ditolak: operation tidak lagi manual_review (order ${orderId}, operation ${parsed.data.operationId}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Operation is no longer in manual review" },
        { status: 409 }
      );
    }

    log.info(
      `stock-review queued (order ${orderId}, operation ${parsed.data.operationId}, scope ${scope.mode}, outcome success)`
    );
    return NextResponse.json({ success: true });
  } catch {
    log.error(
      `stock-review gagal (order ${orderId ?? "unknown"}, outcome error)`,
      new RouteLogError("stock-review gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to queue reconciliation" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(stockReview, "admin-order-stock-review");
