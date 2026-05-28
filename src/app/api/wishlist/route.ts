import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { wishlists, products, productVariants, productImages } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";

const toggleSchema = z.object({
  productId: z.string(),
});

// GET /api/wishlist — List wishlist user
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

    // Get wishlist items with product info
    const items = await db
      .select({
        id: wishlists.id,
        addedAt: wishlists.createdAt,
        product: {
          id: products.id,
          name: products.name,
          slug: products.slug,
          basePrice: products.basePrice,
          rating: products.rating,
          sold: products.sold,
          isFlashSale: products.isFlashSale,
          flashSalePrice: products.flashSalePrice,
        },
      })
      .from(wishlists)
      .innerJoin(products, eq(wishlists.productId, products.id))
      .where(eq(wishlists.userId, session.user.id))
      .orderBy(sql`${wishlists.createdAt} DESC`);

    // Get cheapest price + first image for each product
    const itemsWithDetails = await Promise.all(
      items.map(async (item) => {
        // Get all variants to find min price and check stock
        const variants = await db
          .select({
            price: productVariants.price,
            stock: productVariants.stock,
          })
          .from(productVariants)
          .where(eq(productVariants.productId, item.product.id));

        const minPrice = variants.length > 0
          ? Math.min(...variants.map((v) => parseFloat(v.price)))
          : parseFloat(item.product.basePrice);

        const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);

        // Get first image
        const firstVariant = await db
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(eq(productVariants.productId, item.product.id))
          .limit(1);

        let imageUrl: string | null = null;
        if (firstVariant.length > 0) {
          const images = await db
            .select()
            .from(productImages)
            .where(eq(productImages.variantId, firstVariant[0].id))
            .orderBy(asc(productImages.displayOrder))
            .limit(1);
          imageUrl = images[0]?.url || null;
        }

        return {
          id: item.id,
          addedAt: item.addedAt,
          product: {
            ...item.product,
            basePrice: minPrice.toString(),
            inStock: totalStock > 0,
          },
          image: imageUrl,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        items: itemsWithDetails,
        count: itemsWithDetails.length,
      },
    });
  } catch (error) {
    console.error("Error fetching wishlist:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch wishlist" },
      { status: 500 }
    );
  }
}

// POST /api/wishlist — Toggle (add jika belum ada, remove jika sudah ada)
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
    const parsed = toggleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { productId } = parsed.data;

    // Check if product exists
    const product = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (product.length === 0) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    // Check if already in wishlist
    const existing = await db
      .select()
      .from(wishlists)
      .where(
        and(
          eq(wishlists.userId, session.user.id),
          eq(wishlists.productId, productId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Remove from wishlist
      await db
        .delete(wishlists)
        .where(eq(wishlists.id, existing[0].id));

      return NextResponse.json({
        success: true,
        action: "removed",
        message: "Removed from wishlist",
      });
    }

    // Add to wishlist
    const newId = crypto.randomUUID();
    await db.insert(wishlists).values({
      id: newId,
      userId: session.user.id,
      productId,
    });

    return NextResponse.json({
      success: true,
      action: "added",
      message: "Added to wishlist",
    });
  } catch (error) {
    console.error("Error toggling wishlist:", error);
    return NextResponse.json(
      { success: false, error: "Failed to toggle wishlist" },
      { status: 500 }
    );
  }
}
