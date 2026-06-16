import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, orders, orderItems } from "@/db";
import { eq, desc, sql } from "drizzle-orm";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(async (_ctx, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    // Build query
    let query = db
      .select({
        order: orders,
        user: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
        },
      })
      .from(orders)
      .innerJoin(clients, eq(orders.userId, clients.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);

    if (status) {
      query = query.where(eq(orders.status, status)) as typeof query;
    }

    const allOrders = await query;

    // Get order items count
    const ordersWithDetails = await Promise.all(
      allOrders.map(async (row) => {
        const items = await db
          .select({ count: sql<number>`count(*)` })
          .from(orderItems)
          .where(eq(orderItems.orderId, row.order.id));

        return {
          ...row.order,
          customer: row.user,
          itemCount: Number(items[0]?.count || 0),
        };
      })
    );

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders);
    const total = Number(countResult[0]?.count || 0);

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
    console.error("Error fetching admin orders:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}, ["admin", "hq"]);
