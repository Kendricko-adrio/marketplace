import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { sql, desc, gte, and, eq, count as countFn } from "drizzle-orm";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(async () => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Total revenue (all time)
    const totalRevenue = await db
      .select({ sum: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL)), 0)` })
      .from(orders)
      .where(eq(orders.paymentStatus, "paid"));

    // Revenue this month
    const monthlyRevenue = await db
      .select({ sum: sql<string>`COALESCE(SUM(CAST(total AS DECIMAL)), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.paymentStatus, "paid"),
          gte(orders.createdAt, thirtyDaysAgo)
        )
      );

    // Total orders
    const totalOrders = await db.select({ count: countFn() }).from(orders);

    // Orders this week
    const weeklyOrders = await db
      .select({ count: countFn() })
      .from(orders)
      .where(gte(orders.createdAt, sevenDaysAgo));

    // Total customers
    const totalCustomers = await db
      .select({ count: countFn() })
      .from(users)
      .where(eq(users.role, "customer"));

    // Orders by status
    const ordersByStatus = await db
      .select({
        status: orders.status,
        count: countFn(),
      })
      .from(orders)
      .groupBy(orders.status);

    // Recent orders
    const recentOrders = await db
      .select({
        id: orders.id,
        total: orders.total,
        status: orders.status,
        createdAt: orders.createdAt,
        customer: users.name,
      })
      .from(orders)
      .innerJoin(users, eq(orders.userId, users.id))
      .orderBy(desc(orders.createdAt))
      .limit(5);

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
    console.error("Error fetching analytics:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);
