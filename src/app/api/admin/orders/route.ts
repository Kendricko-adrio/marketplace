import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, orderItems, users, addresses } from "@/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";

// Middleware to check admin role
async function checkAdmin() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized", status: 401 };
  }

  if (session.user.role !== "admin" && session.user.role !== "staff") {
    return { error: "Forbidden", status: 403 };
  }

  return { user: session.user };
}

export async function GET(request: NextRequest) {
  try {
    const adminCheck = await checkAdmin();
    if ("error" in adminCheck) {
      return NextResponse.json(
        { success: false, error: adminCheck.error },
        { status: adminCheck.status }
      );
    }

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
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(orders)
      .innerJoin(users, eq(orders.userId, users.id))
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
}
