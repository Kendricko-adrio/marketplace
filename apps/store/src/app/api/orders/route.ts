import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  orders,
  orderItems,
  productVariants,
  productImages,
  branches,
} from "@/db";
import { eq, asc, desc } from "drizzle-orm";
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
          })
          .from(orderItems)
          .innerJoin(
            productVariants,
            eq(orderItems.variantId, productVariants.id)
          )
          .where(eq(orderItems.orderId, order.id));

        const itemsWithImages = await Promise.all(
          items.map(async (item) => {
            const images = await db
              .select({ url: productImages.url })
              .from(productImages)
              .where(eq(productImages.variantId, item.variantId))
              .orderBy(asc(productImages.displayOrder))
              .limit(1);

            return {
              ...item,
              imageUrl: images[0]?.url ?? null,
            };
          })
        );

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