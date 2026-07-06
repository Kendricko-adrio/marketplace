import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { carts, cartItems, productVariants, branchStocks, branches } from "@/db";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";

const addItemSchema = z.object({
  variantId: z.string(),
  branchId: z.string(),
  quantity: z.number().int().positive().default(1),
  // When true, an existing cart locked to a different branch will be cleared
  // and re-locked to the incoming branchId before adding the item.
  forceReplace: z.boolean().optional().default(false),
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

  return { id: newCartId, userId, branchId: null, updatedAt: new Date() };
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

    const { variantId, branchId, quantity, forceReplace } = parsed.data;

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

    const availableStock = stockRow[0]?.stock ?? 0;

    const cart = await getOrCreateCart(session.user.id);

    // ===== Enforce 1 cart = 1 branch =====
    // If the cart is already locked to a different branch, reject unless the
    // client explicitly requests a force-replace (clears the cart first).
    if (cart.branchId && cart.branchId !== branchId) {
      if (!forceReplace) {
        // Fetch the current branch info so the frontend can show it in the
        // confirmation modal.
        const currentBranch = await db
          .select({
            id: branches.id,
            name: branches.name,
            city: branches.city,
            address: branches.address,
          })
          .from(branches)
          .where(eq(branches.id, cart.branchId!))
          .limit(1);

        return NextResponse.json(
          {
            success: false,
            error: "CART_BRANCH_MISMATCH",
            message:
              "Your cart belongs to a different branch. Adding this item will clear your cart.",
            currentBranch: currentBranch[0] ?? null,
            newBranch: {
              id: branch[0].id,
              name: branch[0].name,
              city: branch[0].city,
              address: branch[0].address,
            },
          },
          { status: 409 }
        );
      }

      // forceReplace: clear all items and re-lock the cart to the new branch
      await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
      await db
        .update(carts)
        .set({ branchId, updatedAt: new Date() })
        .where(eq(carts.id, cart.id));
    } else if (!cart.branchId) {
      // Cart is empty / unlocked → lock it to this branch
      await db
        .update(carts)
        .set({ branchId, updatedAt: new Date() })
        .where(eq(carts.id, cart.id));
    }

    // Check if same (variant + branch) line already in cart
    const existingItem = await db
      .select()
      .from(cartItems)
      .where(
        and(
          eq(cartItems.cartId, cart.id),
          eq(cartItems.variantId, variantId),
          eq(cartItems.branchId, branchId)
        )
      )
      .limit(1);

    if (existingItem.length > 0) {
      const newQuantity = existingItem[0].quantity + quantity;

      if (newQuantity > availableStock) {
        return NextResponse.json(
          { success: false, error: "Insufficient stock at this branch" },
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
      if (quantity > availableStock) {
        return NextResponse.json(
          { success: false, error: "Insufficient stock at this branch" },
          { status: 400 }
        );
      }

      await db.insert(cartItems).values({
        id: crypto.randomUUID(),
        cartId: cart.id,
        variantId,
        branchId,
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