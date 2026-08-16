import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  orders,
  orderItems,
  productVariants,
  products,
  branches,
} from "@/db";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userOrders = await db
      .select({
        order: orders,
        branch: {
          id: branches.id,
          name: branches.name,
          city: branches.city,
          address: branches.address,
        },
      })
      .from(orders)
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .where(eq(orders.userId, session.user.id))
      .orderBy(desc(orders.createdAt));

    const ordersWithItems = await Promise.all(
      userOrders.map(async ({ order, branch }) => {
        const items = await db
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            variantId: orderItems.variantId,
            productName: orderItems.productName,
            variantInfo: orderItems.variantInfo,
            price: orderItems.price,
            quantity: orderItems.quantity,
            createdAt: orderItems.createdAt,
            productId: productVariants.productId,
            thumbnail: products.thumbnail,
          })
          .from(orderItems)
          .innerJoin(
            productVariants,
            eq(orderItems.variantId, productVariants.id)
          )
          .innerJoin(products, eq(productVariants.productId, products.id))
          .where(eq(orderItems.orderId, order.id));

        const itemsWithImages = items.map((item) => ({
          ...item,
          imageUrl: item.thumbnail ?? null,
        }));

        return {
          ...order,
          branch,
          items: itemsWithImages,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: ordersWithItems,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}