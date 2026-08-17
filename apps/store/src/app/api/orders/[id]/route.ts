import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  orders,
  orderItems,
  productVariants,
  products,
  branches,
} from "@/db";
import { eq, and } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const { id } = await params;

    const order = await db
      .select({
        order: orders,
        branch: branches,
      })
      .from(orders)
      .leftJoin(branches, eq(orders.branchId, branches.id))
      .where(and(eq(orders.id, id), eq(orders.userId, session.user.id)))
      .limit(1);

    if (order.length === 0) {
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const orderData = order[0].order;
    const branchData = order[0].branch;

    // Only expose pickup code when order is ready_for_pickup or completed
    const pickupCode =
      orderData.status === "ready_for_pickup" || orderData.status === "completed"
        ? orderData.pickupCode
        : null;

    // Get items with productId + product thumbnail (Jubelio CDN image).
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
        slug: products.slug,
      })
      .from(orderItems)
      .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(orderItems.orderId, orderData.id));

    const itemsWithImages = items.map((item) => ({
      ...item,
      imageUrl: item.thumbnail ?? null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        ...orderData,
        pickupCode,
        branch: branchData,
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
