import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, orders } from "@/db";
import { sql, desc, gte, and, eq, count as countFn } from "drizzle-orm";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { serializeError } from "@/lib/logger";

// GET /api/admin/analytics   [analytics:view]
//
// Branch Analytics aggregates are limited to the Authorized Branch from the
// Current Policy:
//   - own scope  → order count, paid revenue, statuses, recent activity, and
//     distinct transacting customers are filtered to the Home Branch; Orders
//     without a Branch are excluded.
//   - all scope  → every Order is included, including Orders without a
//     Branch.
// A distinct customer counts only after transacting through an Order in the
// authorized scope (the Customer Directory is global, but analytics counts
// transactors, not directory entries).
export async function GET(request: NextRequest) {
  const guardResult = await guard("analytics", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const scope = branchScopeFromAuthorization(ctx.authorization);
    if (!scope) {
      logger.warn("analytics.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const branchCondition =
      scope.mode === "own" ? eq(orders.branchId, scope.branchId) : undefined;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Total revenue (all time)
    const totalRevenue = await db
      .select({ sum: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL)), 0)` })
      .from(orders)
      .where(
        branchCondition
          ? and(eq(orders.paymentStatus, "paid"), branchCondition)
          : eq(orders.paymentStatus, "paid")
      );

    // Revenue this month
    const monthlyRevenue = await db
      .select({ sum: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL)), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.paymentStatus, "paid"),
          gte(orders.createdAt, thirtyDaysAgo),
          branchCondition
        )
      );

    // Total orders
    const totalOrders = await db
      .select({ count: countFn() })
      .from(orders)
      .where(branchCondition);

    // Orders this week
    const weeklyOrders = await db
      .select({ count: countFn() })
      .from(orders)
      .where(and(gte(orders.createdAt, sevenDaysAgo), branchCondition));

    // Distinct transacting customers in the authorized scope: a customer
    // counts only after transacting through an Order in scope (null-branch
    // Orders are excluded under own scope and included under all scope).
    const totalCustomers = await db
      .select({ count: countFn(sql`DISTINCT ${orders.userId}`) })
      .from(orders)
      .where(branchCondition);

    // Orders by status
    const ordersByStatus = await db
      .select({
        status: orders.status,
        count: countFn(),
      })
      .from(orders)
      .where(branchCondition)
      .groupBy(orders.status);

    // Recent orders (joined with clients)
    const recentOrders = await db
      .select({
        id: orders.id,
        total: orders.total,
        status: orders.status,
        createdAt: orders.createdAt,
        customer: clients.name,
      })
      .from(orders)
      .innerJoin(clients, eq(orders.userId, clients.id))
      .where(branchCondition)
      .orderBy(desc(orders.createdAt))
      .limit(5);

    logger.info("analytics.summary", {
      outcome: "success",
      scope: scope.mode,
    });
    return NextResponse.json({
      success: true,
      data: {
        totalRevenue: parseFloat(totalRevenue[0]?.sum || "0"),
        monthlyRevenue: parseFloat(monthlyRevenue[0]?.sum || "0"),
        totalOrders: Number(totalOrders[0]?.count || 0),
        weeklyOrders: Number(weeklyOrders[0]?.count || 0),
        totalCustomers: Number(totalCustomers[0]?.count || 0),
        ordersByStatus: ordersByStatus.map((o) => ({
          status: o.status,
          count: Number(o.count),
        })),
        recentOrders,
      },
    });
  } catch (error) {
    logger.error("analytics.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}