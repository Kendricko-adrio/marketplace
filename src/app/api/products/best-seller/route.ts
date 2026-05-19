import { NextResponse } from "next/server";
import { db } from "@/db";
import { products, productVariants, productImages } from "@/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";

export async function GET() {
  try {
    // Get best selling products (sorted by sold count)
    const bestSellerProducts = await db
      .select()
      .from(products)
      .where(eq(products.status, "aktif"))
      .orderBy(desc(products.sold))
      .limit(8);

    // Get default variant and image for each product
    const productsWithDetails = await Promise.all(
      bestSellerProducts.map(async (product) => {
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
          price: variant?.price || product.basePrice,
          rating: product.rating,
          sold: product.sold,
          image,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: productsWithDetails,
    });
  } catch (error) {
    console.error("Error fetching best seller products:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch best seller products" },
      { status: 500 }
    );
  }
}
