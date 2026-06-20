import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { carts, cartItems, branchStocks } from "@/db";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";

const updateItemSchema = z.object({
  quantity: z.number().int().positive(),
});

export async function PUT(
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

      const availableStock = stockRow[0]?.stock ?? 0;
      if (quantity > availableStock) {
        return NextResponse.json(
          { success: false, error: "Insufficient stock at this branch" },
          { status: 400 }
        );
      }
    }

    // Update quantity
    await db
      .update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, id));

    return NextResponse.json({
      success: true,
      message: "Cart item updated",
    });
  } catch (error) {
    console.error("Error updating cart item:", error);
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

    return NextResponse.json({
      success: true,
      message: "Cart item removed",
    });
  } catch (error) {
    console.error("Error removing cart item:", error);
    return NextResponse.json(
      { success: false, error: "Failed to remove cart item" },
      { status: 500 }
    );
  }
}
