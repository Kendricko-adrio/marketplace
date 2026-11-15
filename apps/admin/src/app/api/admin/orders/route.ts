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
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { parsePagination } from "@/lib/pagination";
import { listDeliveryWork, DELIVERY_QUEUES, type DeliveryQueue } from "@/lib/delivery-work-list";
import { DELIVERY_STAGE_LABELS } from "@/lib/delivery-workflow";

export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-orders-list");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

// GET /api/admin/orders   [orders:view]
//
// Branch scope comes from the Current Policy: own-branch view is pinned to
// the Home Branch (a client `branchId` param cannot widen it); all-branch
// view may optionally filter by `branchId`.
async function listOrders(request: NextRequest): Promise<Response> {
  const guardResult = await guard("orders", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      log.warn(
        `orders list ditolak: branch scope tidak dapat ditentukan (userId ${ctx.user.id}, reason missing_home_branch, outcome denied)`
      );
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
        log.warn(
          `orders list ditolak: filter pengiriman tidak valid (scope ${authorization.mode}, outcome denied)`
        );
        return NextResponse.json({ success: false, error: "Invalid delivery filters" }, { status: 400 });
      }
      const result = await listDeliveryWork(db, {
        scope: authorization, queue: queue as DeliveryQueue, stage,
        branchId: searchParams.get("branchId"), search: searchParams.get("search"),
        from: dates[0], to: dates[1], page: parsePagination(searchParams.get("page"), "20").page,
      });
      log.info(
        `orders list delivery served (scope ${authorization.mode}, page ${result.pagination.page}, total ${result.pagination.total}, baseTotal ${result.pagination.baseTotal}, outcome success)`
      );
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

    log.info(
      `orders list served (scope ${authorization.mode}, page ${page}, limit ${limit}, total ${total}, baseTotal ${baseTotal}, outcome success)`
    );
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
  } catch {
    log.error(
      "orders list gagal (outcome error)",
      new RouteLogError("orders list gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(listOrders, "admin-orders-list");