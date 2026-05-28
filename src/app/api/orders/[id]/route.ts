import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, orderItems, productVariants, productImages, addresses } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const order = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, session.user.id)))
      .limit(1);

    if (order.length === 0) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const orderData = order[0];

    // Get address
    let address = null;
    if (orderData.addressId) {
      const addr = await db
        .select()
        .from(addresses)
        .where(eq(addresses.id, orderData.addressId))
        .limit(1);
      address = addr[0] ?? null;
    }

    // Get items with productId and images
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
      .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .where(eq(orderItems.orderId, orderData.id));

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

    return NextResponse.json({
      success: true,
      data: {
        ...orderData,
        address,
        items: itemsWithImages,
      },
    });
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch order" },
      { status: 500 }
    );
  }
}
