import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  branches,
  clients,
  jubelioSalesOperations,
  orders,
} from "@/db";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { serializeError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/reviews/sales-operations   [orders:view]
//
// Read-only ops review queue for the Jubelio Sales-Order flow: lists
// `manual_review` SO/invoice/payment operations AND paid-but-blocked orders
// (payment kept, fulfillment blocked). Exposes the known remote ids
// (sales order / invoice / payment), the reason and timestamps. There are NO
// write actions here by design: operators investigate in Jubelio and resolve
// deliberately; a blind write could duplicate a remote operation.
export async function GET(request: NextRequest) {
  const guardResult = await guard("orders", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      logger.warn("sales-review.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    // ---- manual_review operations ----
    const opRows = await db
      .select({
        id: jubelioSalesOperations.id,
        orderId: jubelioSalesOperations.orderId,
        type: jubelioSalesOperations.type,
        status: jubelioSalesOperations.status,
        reference: jubelioSalesOperations.reference,
        salesOrderId: jubelioSalesOperations.salesOrderId,
        invoiceId: jubelioSalesOperations.invoiceId,
        paymentId: jubelioSalesOperations.paymentId,
        attemptCount: jubelioSalesOperations.attemptCount,
        dispatchedAt: jubelioSalesOperations.dispatchedAt,
        confirmedAt: jubelioSalesOperations.confirmedAt,
        lastError: jubelioSalesOperations.lastError,
        updatedAt: jubelioSalesOperations.updatedAt,
        orderStatus: orders.status,
        orderPaymentStatus: orders.paymentStatus,
        orderTotal: orders.total,
        orderBranchId: orders.branchId,
        branchName: branches.name,
        customerName: clients.name,
        customerEmail: clients.email,
      })
      .from(jubelioSalesOperations)
      .innerJoin(orders, eq(jubelioSalesOperations.orderId, orders.id))
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .innerJoin(clients, eq(orders.userId, clients.id))
      .where(eq(jubelioSalesOperations.status, "manual_review"))
      .orderBy(desc(jubelioSalesOperations.updatedAt))
      .limit(100);

    // ---- paid-but-blocked orders (no manual_review op required) ----
    const blockedRows = await db
      .select({
        orderId: orders.id,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        paymentMethod: orders.paymentMethod,
        paymentFailureReason: orders.paymentFailureReason,
        total: orders.total,
        jubelioSalesOrderId: orders.jubelioSalesOrderId,
        jubelioInvoiceId: orders.jubelioInvoiceId,
        jubelioPaymentId: orders.jubelioPaymentId,
        fulfillmentBlockedReason: orders.fulfillmentBlockedReason,
        updatedAt: orders.updatedAt,
        branchId: orders.branchId,
        branchName: branches.name,
        customerName: clients.name,
        customerEmail: clients.email,
      })
      .from(orders)
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .innerJoin(clients, eq(orders.userId, clients.id))
      .where(
        and(
          eq(orders.paymentStatus, "paid"),
          or(
            isNotNull(orders.fulfillmentBlockedReason),
            // Paid but never settled to a verified invoice: fulfillment is
            // implicitly blocked (no pickup code can exist for it).
            and(
              eq(orders.status, "processing"),
              eq(orders.paymentStatus, "paid")
            )
          )
        )
      )
      .orderBy(desc(orders.updatedAt))
      .limit(100);

    // Own-branch scope: filter both lists to the Home Branch.
    const scopedOps =
      authorization.mode === "own"
        ? opRows.filter((row) => row.orderBranchId === authorization.branchId)
        : opRows;
    const scopedBlocked =
      authorization.mode === "own"
        ? blockedRows.filter((row) => row.branchId === authorization.branchId)
        : blockedRows;

    logger.info("sales-review.listed", {
      outcome: "success",
      operations: scopedOps.length,
      blockedOrders: scopedBlocked.length,
      mode: authorization.mode,
    });

    return NextResponse.json({
      success: true,
      data: {
        operations: scopedOps,
        blockedOrders: scopedBlocked,
      },
    });
  } catch (error) {
    logger.error("sales-review.list_failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Failed to load review queue" },
      { status: 500 }
    );
  }
}