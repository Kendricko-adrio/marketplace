import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { carts, cartItems, productVariants, branchStocks, branches } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { z } from "zod";

const addItemSchema = z.object({
  variantId: z.string(),
  branchId: z.string(),
  quantity: z.number().int().positive().default(1),
});

// Helper to get or create cart
async function getOrCreateCart(userId: string) {
  const newCartId = crypto.randomUUID();
  await db
    .insert(carts)
    .values({ id: newCartId, userId })
    .onConflictDoNothing({ target: carts.userId });
  const [cart] = await db
    .select()
    .from(carts)
    .where(eq(carts.userId, userId))
    .limit(1);
  if (!cart) throw new Error("Failed to create cart");
  return cart;
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { session } = access;

    const body = await request.json();
    const parsed = addItemSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { variantId, branchId, quantity } = parsed.data;

    // Check if variant exists
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

    // Check if branch exists and is active
    const branch = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (branch.length === 0 || branch[0].status !== "aktif") {
      return NextResponse.json(
        { success: false, error: "Branch not available" },
        { status: 400 }
      );
    }

    // Check branch stock for this variant
    const stockRow = await db
      .select()
      .from(branchStocks)
      .where(
        and(
          eq(branchStocks.branchId, branchId),
          eq(branchStocks.productVariantId, variantId)
        )
      )
      .limit(1);

    // Available = stock - reservedStock (units held by pending_payment orders).
    const availableStock =
      (stockRow[0]?.stock ?? 0) - (stockRow[0]?.reservedStock ?? 0);

    const cart = await getOrCreateCart(session.user.id);

    if (quantity > availableStock) {
      return NextResponse.json(
        { success: false, error: "Insufficient stock at this branch" },
        { status: 400 }
      );
    }

    const changed = await db
      .insert(cartItems)
      .values({
        id: crypto.randomUUID(),
        cartId: cart.id,
        variantId,
        branchId,
        quantity,
      })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.variantId, cartItems.branchId],
        set: {
          quantity: sql`${cartItems.quantity} + ${quantity}`,
          updatedAt: new Date(),
        },
        setWhere: sql`${cartItems.quantity} + ${quantity} <= ${availableStock}`,
      })
      .returning({ id: cartItems.id });

    if (changed.length === 0) {
      return NextResponse.json(
        { success: false, error: "Insufficient stock at this branch" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, message: "Item added to cart" });
  } catch (error) {
    console.error("Error adding to cart:", error);
    return NextResponse.json(
      { success: false, error: "Failed to add to cart" },
      { status: 500 }
    );
  }
}
