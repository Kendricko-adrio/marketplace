import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  orders,
  orderItems,
  branches,
  jubelioStockOperations,
} from "@/db";
import { eq, and, desc, sql, ilike, or, gte, lte } from "drizzle-orm";
import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { parsePagination } from "@/lib/pagination";

export const dynamic = "force-dynamic";

// GET /api/admin/orders   [orders:view]
//
// Branch scope comes from the Current Policy: own-branch view is pinned to
// the Home Branch (a client `branchId` param cannot widen it); all-branch
// view may optionally filter by `branchId`.
export async function GET(request: NextRequest) {
  const guardResult = await guard("orders", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      logger.warn("orders.list.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const branchIdParam = searchParams.get("branchId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const pickupFrom = searchParams.get("pickupFrom");
    const pickupTo = searchParams.get("pickupTo");
    const search = searchParams.get("search");
    const { page, limit } = parsePagination(
      searchParams.get("page"),
      searchParams.get("limit")
    );
    const offset = (page - 1) * limit;

    // Build the where conditions array
    const conditions = [];

    // Branch scoping: own-branch view is pinned to the Home Branch regardless
    // of any client-supplied branchId; all-branch view may filter by param.
    if (authorization.mode === "own") {
      conditions.push(eq(orders.branchId, authorization.branchId));
    } else if (branchIdParam) {
      conditions.push(eq(orders.branchId, branchIdParam));
    }

    if (status) {
      conditions.push(eq(orders.status, status));
    }

    if (from) {
      conditions.push(gte(orders.createdAt, new Date(from)));
    }
    if (to) {
      // Add 1 day to include the full "to" date
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      conditions.push(lte(orders.createdAt, toDate));
    }

    if (pickupFrom) {
      conditions.push(gte(orders.pickupDate, new Date(pickupFrom)));
    }
    if (pickupTo) {
      // Add 1 day to include the full "to" date
      const pickupToDate = new Date(pickupTo);
      pickupToDate.setDate(pickupToDate.getDate() + 1);
      conditions.push(lte(orders.pickupDate, pickupToDate));
    }

    if (search) {
      // Search by order ID, customer name, or contact phone
      conditions.push(
        or(
          ilike(orders.id, `%${search}%`),
          ilike(clients.name, `%${search}%`),
          ilike(orders.contactPhone, `%${search}%`)
        )
      );
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    // ===== Main query =====
    let query = db
      .select({
        order: orders,
        customer: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
        },
        branch: {
          id: branches.id,
          name: branches.name,
          city: branches.city,
        },
        itemCount: sql<number>`(
          select count(*) from ${orderItems}
          where ${orderItems.orderId} = ${orders.id}
        )`,
        stockNeedsReview: sql<boolean>`exists (
          select 1 from ${jubelioStockOperations}
          where ${jubelioStockOperations.orderId} = ${orders.id}
            and ${jubelioStockOperations.status} = 'manual_review'
        )`,
      })
      .from(orders)
      .innerJoin(clients, eq(orders.userId, clients.id))
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    if (whereClause) {
      query = query.where(whereClause) as typeof query;
    }

    const allOrders = await query;

    const ordersWithDetails = allOrders.map((row) => ({
      ...row.order,
      customer: row.customer,
      branch: row.branch,
      itemCount: Number(row.itemCount),
      stockNeedsReview: Boolean(row.stockNeedsReview),
    }));

    // ===== Total count (with the same filters) =====
    let countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .innerJoin(clients, eq(orders.userId, clients.id));

    if (whereClause) {
      countQuery = countQuery.where(whereClause) as typeof countQuery;
    }

    const countResult = await countQuery;
    const total = Number(countResult[0]?.count || 0);

    logger.info("orders.list", {
      outcome: "success",
      total,
      page,
      scope: authorization.mode,
    });
    return NextResponse.json({
      success: true,
      data: ordersWithDetails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("orders.list.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}