import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, orders, orderItems, branches } from "@/db";
import { eq, and, desc, sql, ilike, or, gte, lte } from "drizzle-orm";
import { withPermission, getBranchScope } from "@/lib/auth-guard";
import { requestLogger, serializeError } from "@/lib/logger";
import { parsePagination } from "@/lib/pagination";

export const GET = withPermission(async (_ctx, request: NextRequest) => {
  const log = requestLogger(request, {
    module: "admin-orders",
    action: "list",
    userId: _ctx.user.id,
    role: _ctx.user.role,
  });
  try {
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

    log.info("orders list requested", { status, branchIdParam, page, limit });

    // ===== RBAC: determine branch scope =====
    const scope = getBranchScope(_ctx.user);

    // Build the where conditions array
    const conditions = [];

    // Branch scoping: branch admins always filtered to their branch;
    // HQ can optionally filter by branchId param.
    if (scope.mode === "own") {
      conditions.push(eq(orders.branchId, scope.branchId));
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

    log.info("orders list served", { total, page });
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
    log.error("fetch admin orders failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}, "orders", "view");
