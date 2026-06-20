import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  carts,
  cartItems,
  productVariants,
  products,
  productImages,
  branches,
} from "@/db";
import { eq, and, asc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

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

    const cart = await getOrCreateCart(session.user.id);

    // Get cart items with product details
    const items = await db
      .select({
        id: cartItems.id,
        quantity: cartItems.quantity,
        variantId: cartItems.variantId,
        branchId: cartItems.branchId,
        variant: {
          id: productVariants.id,
          sku: productVariants.sku,
          color: productVariants.color,
          size: productVariants.size,
          price: productVariants.price,
        },
        branch: {
          id: branches.id,
          name: branches.name,
          city: branches.city,
        },
        product: {
          id: products.id,
          name: products.name,
          slug: products.slug,
        },
      })
      .from(cartItems)
      .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(branches, eq(cartItems.branchId, branches.id))
      .where(eq(cartItems.cartId, cart.id));

    // Get images for each item
    const itemsWithImages = await Promise.all(
      items.map(async (item) => {
        const images = await db
          .select()
          .from(productImages)
          .where(eq(productImages.variantId, item.variantId))
          .orderBy(asc(productImages.displayOrder))
          .limit(1);

        return {
          ...item,
          image: images[0]?.url || null,
        };
      })
    );

    // Calculate totals
    const subtotal = itemsWithImages.reduce((sum, item) => {
      return sum + parseFloat(item.variant.price) * item.quantity;
    }, 0);

    return NextResponse.json({
      success: true,
      data: {
        id: cart.id,
        items: itemsWithImages,
        itemCount: itemsWithImages.length,
        subtotal,
      },
    });
  } catch (error) {
    console.error("Error fetching cart:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch cart" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
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

    const cart = await db
      .select()
      .from(carts)
      .where(eq(carts.userId, session.user.id))
      .limit(1);

    if (cart.length > 0) {
      await db.delete(cartItems).where(eq(cartItems.cartId, cart[0].id));
    }

    return NextResponse.json({
      success: true,
      message: "Cart cleared",
    });
  } catch (error) {
    console.error("Error clearing cart:", error);
    return NextResponse.json(
      { success: false, error: "Failed to clear cart" },
      { status: 500 }
    );
  }
}
