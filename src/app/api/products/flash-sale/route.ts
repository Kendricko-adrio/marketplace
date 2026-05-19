import { NextResponse } from "next/server";
import { db } from "@/db";
import { products, productVariants, productImages } from "@/db/schema";
import { eq, and, asc, gt } from "drizzle-orm";

export async function GET() {
  try {
    // Get products where isFlashSale is true and flashSaleEndsAt is in the future
    const flashSaleProducts = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.isFlashSale, true),
          eq(products.status, "aktif"),
          gt(products.flashSaleEndsAt, new Date())
        )
      )
      .limit(8);

    // Get default variant and image for each product
    const productsWithDetails = await Promise.all(
      flashSaleProducts.map(async (product) => {
        const defaultVariant = await db
          .select()
          .from(productVariants)
          .where(
            and(
              eq(productVariants.productId, product.id),
              eq(productVariants.isDefault, true)
            )
          )
          .limit(1);

        const variant = defaultVariant[0];
        let image = null;

        if (variant) {
          const images = await db
            .select()
            .from(productImages)
            .where(eq(productImages.variantId, variant.id))
            .orderBy(asc(productImages.displayOrder))
            .limit(1);
          image = images[0]?.url || null;
        }

        return {
          id: product.id,
          name: product.name,
          slug: product.slug,
          originalPrice: product.basePrice,
          price: product.flashSalePrice || product.basePrice,
          rating: product.rating,
          sold: product.sold,
          flashSaleEndsAt: product.flashSaleEndsAt,
          image,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: productsWithDetails,
    });
  } catch (error) {
    console.error("Error fetching flash sale products:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch flash sale products" },
      { status: 500 }
    );
  }
}
