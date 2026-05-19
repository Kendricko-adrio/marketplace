import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { carts, cartItems, productVariants } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";

const addItemSchema = z.object({
  variantId: z.string(),
  quantity: z.number().int().positive().default(1),
});

// Helper to get or create cart
async function getOrCreateCart(userId: string) {
  const existingCart = await db
    .select()
    .from(carts)
    .where(eq(carts.userId, userId))
    .limit(1);

  if (existingCart.length > 0) {
    return existingCart[0];
  }

  const newCartId = crypto.randomUUID();
  await db.insert(carts).values({
    id: newCartId,
    userId,
  });

  return { id: newCartId, userId, updatedAt: new Date() };
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const parsed = addItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { variantId, quantity } = parsed.data;

    // Check if variant exists and has stock
    const variant = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);

    if (variant.length === 0) {
      return NextResponse.json(
        { success: false, error: "Variant not found" },
        { status: 404 }
      );
    }

    if (variant[0].stock < quantity) {
      return NextResponse.json(
        { success: false, error: "Insufficient stock" },
        { status: 400 }
      );
    }

    const cart = await getOrCreateCart(session.user.id);

    // Check if item already in cart
    const existingItem = await db
      .select()
      .from(cartItems)
      .where(
        and(eq(cartItems.cartId, cart.id), eq(cartItems.variantId, variantId))
      )
      .limit(1);

    if (existingItem.length > 0) {
      // Update quantity
      const newQuantity = existingItem[0].quantity + quantity;

      if (newQuantity > variant[0].stock) {
        return NextResponse.json(
          { success: false, error: "Insufficient stock" },
          { status: 400 }
        );
      }

      await db
        .update(cartItems)
        .set({ quantity: newQuantity, updatedAt: new Date() })
        .where(eq(cartItems.id, existingItem[0].id));

      return NextResponse.json({
        success: true,
        message: "Cart item updated",
      });
    } else {
      // Add new item
      await db.insert(cartItems).values({
        id: crypto.randomUUID(),
        cartId: cart.id,
        variantId,
        quantity,
      });

      return NextResponse.json({
        success: true,
        message: "Item added to cart",
      });
    }
  } catch (error) {
    console.error("Error adding to cart:", error);
    return NextResponse.json(
      { success: false, error: "Failed to add to cart" },
      { status: 500 }
    );
  }
}
