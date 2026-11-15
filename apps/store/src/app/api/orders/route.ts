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
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("store-orders");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap tidak pernah masuk log; kontrak HTTP tetap sama.
 */
class OrdersListLogError extends Error {
  constructor() {
    super("store orders: gagal memuat daftar order");
    this.name = "OrdersListLogError";
  }
}

async function listOrders(): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

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
          // Ticket 07 — the internal manual/actor evidence never leaves the
          // admin surface; the failure CODE stays (a safe customer state).
          deliveryManualReason: undefined,
          deliveryManualAt: undefined,
          deliveryManualBy: undefined,
          deliveryFailureBy: undefined,
          branch,
          items: itemsWithImages,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: ordersWithItems,
    });
  } catch {
    log.error("Daftar order gagal dimuat (outcome error)", new OrdersListLogError());
    return NextResponse.json(
      { success: false, error: "Failed to fetch orders" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(listOrders, "store-orders");
