import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { carts, cartItems, branchStocks } from "@/db";
import { eq, and } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { z } from "zod";
import { requestLogger, serializeError } from "@/lib/logger";

const updateItemSchema = z.object({
  quantity: z.number().int().positive(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const log = requestLogger(request, { module: "cart-item-update" });
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

    // Check branch stock if the item is tied to a branch
    if (item[0].branchId) {
      const stockRow = await db
        .select()
        .from(branchStocks)
        .where(
          and(
            eq(branchStocks.branchId, item[0].branchId),
            eq(branchStocks.productVariantId, item[0].variantId)
          )
        )
        .limit(1);

      // Last-known stock is provisional. The mapped pair is verified against
      // Jubelio when placing the order, not while editing the cart.
      if (!stockRow.length) {
        log.warn("cart update rejected — branch stock mapping missing", { id });
        return NextResponse.json({ success: false, error: "Stock mapping unavailable" }, { status: 409 });
      }
    }

    // Update quantity
    await db
      .update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, id));

    log.info("cart item updated", { id, quantity });
    return NextResponse.json({
      success: true,
      message: "Cart item updated",
    });
  } catch (error) {
    log.error("cart item update failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Failed to update cart item" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const log = requestLogger(request, { module: "cart-item-remove" });
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

    log.info("cart item removed", { id });
    return NextResponse.json({
      success: true,
      message: "Cart item removed",
    });
  } catch (error) {
    log.error("cart item remove failed", { error: serializeError(error) });
    return NextResponse.json(
      { success: false, error: "Failed to remove cart item" },
      { status: 500 }
    );
  }
}
