import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { carts, cartItems, branchStocks, branches, productVariants } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { z } from "zod";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { sellableUnits } from "@/lib/stock";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("cart-item");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

const updateItemSchema = z.object({
  quantity: z.number().int().positive(),
});

async function updateCartItem(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const { id } = await params;
    const body = await request.json();
    const parsed = updateItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { quantity } = parsed.data;

    // Get user's cart
    const cart = await db
      .select()
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);

    if (cart.length === 0) {
      return NextResponse.json(
        { success: false, error: "Cart not found" },
        { status: 404 }
      );
    }

    // Get cart item (with branchId)
    const item = await db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.id, id), eq(cartItems.cartId, cart[0].id)))
      .limit(1);

    if (item.length === 0) {
      return NextResponse.json(
        { success: false, error: "Cart item not found" },
        { status: 404 }
      );
    }

    const updated = await db.transaction(async (tx) => {
      if (!item[0].branchId) return false;
      const [stockRow] = await tx.select({
        availableStock: branchStocks.availableStock,
        pendingRemoteStock: branchStocks.pendingRemoteStock,
      }).from(branchStocks)
        .innerJoin(branches, eq(branches.id, branchStocks.branchId))
        .innerJoin(productVariants, eq(productVariants.id, branchStocks.productVariantId))
        .where(and(
          eq(branchStocks.branchId, item[0].branchId),
          eq(branchStocks.productVariantId, item[0].variantId),
          eq(branches.status, "aktif"),
          sql`${branches.jubelioLocationId} IS NOT NULL`,
          sql`${productVariants.jubelioItemId} IS NOT NULL`
        )).for("update", { of: branchStocks });
      if (!stockRow || quantity > sellableUnits(stockRow)) return false;
      const changed = await tx.update(cartItems)
        .set({ quantity, updatedAt: new Date() })
        .where(and(eq(cartItems.id, id), eq(cartItems.cartId, cart[0].id)))
        .returning({ id: cartItems.id });
      return changed.length > 0;
    });
    if (!updated) {
      log.warn(
        `cart update rejected — stock unavailable (item ${id}, quantity ${quantity})`
      );
      return NextResponse.json(
        { success: false, error: "Stok produk di cabang ini tidak mencukupi" },
        { status: 400 }
      );
    }

    log.info(`cart item updated: item ${id}, quantity ${quantity}`);
    return NextResponse.json({
      success: true,
      message: "Cart item updated",
    });
  } catch {
    log.error(
      "cart item update failed",
      new RouteLogError("cart item update failed")
    );
    return NextResponse.json(
      { success: false, error: "Failed to update cart item" },
      { status: 500 }
    );
  }
}

async function removeCartItem(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const { id } = await params;

    // Get user's cart
    const cart = await db
      .select()
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);

    if (cart.length === 0) {
      return NextResponse.json(
        { success: false, error: "Cart not found" },
        { status: 404 }
      );
    }

    // Delete cart item
    await db
      .delete(cartItems)
      .where(and(eq(cartItems.id, id), eq(cartItems.cartId, cart[0].id)));

    log.info(`cart item removed: item ${id}`);
    return NextResponse.json({
      success: true,
      message: "Cart item removed",
    });
  } catch {
    log.error(
      "cart item remove failed",
      new RouteLogError("cart item remove failed")
    );
    return NextResponse.json(
      { success: false, error: "Failed to remove cart item" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const PUT = withRequestContext(updateCartItem, "cart-item");
export const DELETE = withRequestContext(removeCartItem, "cart-item");
