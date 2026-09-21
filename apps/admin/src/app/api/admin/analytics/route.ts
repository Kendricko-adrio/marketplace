import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, orders } from "@/db";
import {
  sql,
  desc,
  gte,
  and,
  eq,
  ne,
  count as countFn,
  type SQL,
} from "drizzle-orm";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { serializeError } from "@/lib/logger";
import {
  trendWindowKeys,
  trendWindowStart,
  zeroFilledTrend,
  type TrendRow,
} from "@/lib/analytics-wib";

// =========================================================
// Revenue condition — the single source of truth for EVERY revenue aggregate
// in this route: an order contributes revenue only when it is paid AND not
// cancelled. Late-settled failed_payment orders with paymentStatus 'paid'
// count; the normal failed path (failed_payment + 'failed') is excluded;
// cancelled orders never contribute.
// =========================================================
const revenueCondition: SQL = and(
  eq(orders.paymentStatus, "paid"),
  ne(orders.status, "cancelled")
) as SQL;

// GET /api/admin/analytics   [analytics:view]
//
// Branch Analytics aggregates are limited to the Authorized Branch from the
// Current Policy:
//   - own scope  → revenue, order counts, statuses, trend, recent activity,
//     and distinct transacting customers are filtered to the Home Branch;
//     Orders without a Branch are excluded.
//   - all scope  → every Order is included, including Orders without a
//     Branch.
// A distinct customer counts only after transacting through an Order in the
// authorized scope (the Customer Directory is global, but analytics counts
// transactors, not directory entries).
//
// Exactly four queries are started (before Promise.all) per request:
//   1. consolidated KPI with FILTER aggregates (revenue, qualifying order
//      count, rolling 30d revenue, rolling 7d orders, total orders, distinct
//      transactors);
//   2. 30-day WIB calendar-day trend grouped by
//      to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD');
//   3. order status counts;
//   4. five recent orders joined with their customer.
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

    // One clock reading drives every window: the rolling KPI windows and the
    // WIB trend window must agree on "now".
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const trendStart = trendWindowStart(now);

    // 1) Consolidated KPI — FILTER aggregates keep this a single scan.
    const kpiQuery = db
      .select({
        totalRevenue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)) FILTER (WHERE ${revenueCondition}), 0)`,
        revenueOrderCount: sql<number>`COUNT(*) FILTER (WHERE ${revenueCondition})`.mapWith(
          Number
        ),
        monthlyRevenue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)) FILTER (WHERE ${revenueCondition} AND ${orders.createdAt} >= ${thirtyDaysAgo}), 0)`,
        weeklyOrders:
          sql<number>`COUNT(*) FILTER (WHERE ${orders.createdAt} >= ${sevenDaysAgo})`.mapWith(
            Number
          ),
        totalOrders: sql<number>`COUNT(*)`.mapWith(Number),
        totalCustomers:
          sql<number>`COUNT(DISTINCT ${orders.userId})`.mapWith(Number),
      })
      .from(orders)
      .where(branchCondition);

    // 2) 30-day WIB trend — grouped by WIB calendar day. `orders` counts all
    //    statuses; `revenue` applies the revenue condition via FILTER.
    const trendDayKey = sql`to_char(${orders.createdAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;
    const trendQuery = db
      .select({
        day: sql<string>`${trendDayKey}`,
        orders: sql<number>`COUNT(*)`.mapWith(Number),
        revenue: sql<string>`COALESCE(SUM(CAST(${orders.total} AS DECIMAL)) FILTER (WHERE ${revenueCondition}), 0)`,
      })
      .from(orders)
      .where(and(branchCondition, gte(orders.createdAt, trendStart)))
      .groupBy(trendDayKey);

    // 3) Order status counts (all statuses).
    const statusQuery = db
      .select({
        status: orders.status,
        count: countFn(),
      })
      .from(orders)
      .where(branchCondition)
      .groupBy(orders.status);

    // 4) Recent orders (joined with clients).
    const recentQuery = db
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

    const [kpiRows, trendRows, statusRows, recentOrders] = await Promise.all([
      kpiQuery.execute(),
      trendQuery.execute(),
      statusQuery.execute(),
      recentQuery.execute(),
    ]);

    const kpi = kpiRows[0];
    const qualifyingRevenue = parseFloat(kpi?.totalRevenue ?? "0");
    const qualifyingOrderCount = Number(kpi?.revenueOrderCount ?? 0);

    logger.info("analytics.summary", {
      outcome: "success",
      scope: scope.mode,
    });
    return NextResponse.json({
      success: true,
      data: {
        // All-time revenue under the revenue condition.
        totalRevenue: qualifyingRevenue,
        // Rolling 30×24h revenue (not the WIB calendar window).
        monthlyRevenue: parseFloat(kpi?.monthlyRevenue ?? "0"),
        totalOrders: Number(kpi?.totalOrders ?? 0),
        weeklyOrders: Number(kpi?.weeklyOrders ?? 0),
        totalCustomers: Number(kpi?.totalCustomers ?? 0),
        // All-time qualifying revenue ÷ qualifying order count; 0 when none.
        averageOrderValue:
          qualifyingOrderCount > 0
            ? qualifyingRevenue / qualifyingOrderCount
            : 0,
        ordersByStatus: statusRows.map((o) => ({
          status: o.status,
          count: Number(o.count),
        })),
        recentOrders,
        // Exactly 30 WIB calendar days, oldest → newest, zero-filled.
        trend: zeroFilledTrend(trendRows as TrendRow[], trendWindowKeys(now)),
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