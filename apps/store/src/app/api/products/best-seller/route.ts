import { NextResponse } from "next/server";
import { db } from "@/db";
import { products, productVariants, productImages } from "@/db";
import { eq, and, asc, desc, inArray } from "drizzle-orm";

export async function GET() {
  try {
    const bestSellerProducts = await db
      .select()
      .from(products)
      .where(eq(products.status, "aktif"))
      .orderBy(desc(products.sold))
      .limit(8);

    if (bestSellerProducts.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const productIds = bestSellerProducts.map((p) => p.id);

    const defaultVariants = await db
      .select()
      .from(productVariants)
      .where(
        and(
          inArray(productVariants.productId, productIds),
          eq(productVariants.isDefault, true)
        )
      );

    const variantIds = defaultVariants.map((v) => v.id);

    const images =
      variantIds.length > 0
        ? await db
            .select()
            .from(productImages)
            .where(inArray(productImages.variantId, variantIds))
            .orderBy(asc(productImages.displayOrder))
        : [];

    const variantMap = new Map(defaultVariants.map((v) => [v.productId, v]));
    const imageMap = new Map<string, string>();
    for (const img of images) {
      if (!imageMap.has(img.variantId)) {
        imageMap.set(img.variantId, img.url);
      }
    }

    const data = bestSellerProducts.map((product) => {
      const variant = variantMap.get(product.id);
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        price: variant?.price || product.basePrice,
        rating: product.rating,
        sold: product.sold,
        image: variant ? imageMap.get(variant.id) || null : null,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching best seller products:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch best seller products" },
      { status: 500 }
    );
  }
}
