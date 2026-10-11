import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  orders,
  orderItems,
  branches,
  jubelioStockOperations,
} from "@/db";
import { eq, and, asc, sql, ilike, or, gte, lte } from "drizzle-orm";
import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { parsePagination } from "@/lib/pagination";
import { listDeliveryWork, DELIVERY_QUEUES, type DeliveryQueue } from "@/lib/delivery-work-list";
import { DELIVERY_STAGE_LABELS } from "@/lib/delivery-workflow";

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
    const fulfillment = searchParams.get("fulfillment");
    if (fulfillment && !["delivery", "pickup"].includes(fulfillment)) return NextResponse.json({ success: false, error: "Invalid fulfillment" }, { status: 400 });
    if (fulfillment === "delivery") {
      const queue = searchParams.get("queue") ?? "actionable";
      const stage = searchParams.get("stage");
      const dates = [searchParams.get("from"), searchParams.get("to")];
      if (!DELIVERY_QUEUES.includes(queue as DeliveryQueue) || (stage && !DELIVERY_STAGE_LABELS.includes(stage)) || dates.some((date) => date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))))) {
        logger.warn("orders.list.invalid_filters", { outcome: "denied" });
        return NextResponse.json({ success: false, error: "Invalid delivery filters" }, { status: 400 });
      }
      const result = await listDeliveryWork(db, {
        scope: authorization, queue: queue as DeliveryQueue, stage,
        branchId: searchParams.get("branchId"), search: searchParams.get("search"),
        from: dates[0], to: dates[1], page: parsePagination(searchParams.get("page"), "20").page,
      });
      logger.info("orders.list.delivery", { outcome: "success", scope: authorization.mode, ...result.pagination });
      return NextResponse.json({ success: true, ...result });
    }
    const status = searchParams.get("status");
    const branchIdParam = searchParams.get("branchId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const pickupFrom = searchParams.get("pickupFrom");
    const pickupTo = searchParams.get("pickupTo");
    const search = searchParams.get("search");
    const { page: requestedPage, limit } = parsePagination(searchParams.get("page"), "20");

    // Build the where conditions array
    const conditions = [];
    const dateConditions = [];
    if (fulfillment === "pickup") conditions.push(eq(orders.fulfillmentMethod, "pickup"));

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
      dateConditions.push(gte(orders.createdAt, new Date(from)));
    }
    if (to) {
      // Add 1 day to include the full "to" date
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      dateConditions.push(lte(orders.createdAt, toDate));
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
      conditions.length + dateConditions.length > 0 ? and(...conditions, ...dateConditions) : undefined;

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(orders).innerJoin(clients, eq(orders.userId, clients.id)).where(whereClause);
    const total = Number(countResult[0]?.count ?? 0);
    const baseResult = await db.select({ count: sql<number>`count(*)` }).from(orders).innerJoin(clients, eq(orders.userId, clients.id)).where(conditions.length ? and(...conditions) : undefined);
    const baseTotal = Number(baseResult[0]?.count ?? 0);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / limit)));
    const offset = (page - 1) * limit;

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
      .orderBy(asc(orders.createdAt), asc(orders.id))
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
        baseTotal,
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