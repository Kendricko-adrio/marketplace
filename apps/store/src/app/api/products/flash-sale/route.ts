import { NextResponse } from "next/server";
import { db } from "@/db";
import { products, productVariants, productImages } from "@/db";
import { eq, and, asc, gt, inArray } from "drizzle-orm";

export async function GET() {
  try {
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

    if (flashSaleProducts.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const productIds = flashSaleProducts.map((p) => p.id);

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

    const data = flashSaleProducts.map((product) => {
      const variant = variantMap.get(product.id);
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        originalPrice: product.basePrice,
        price: product.flashSalePrice || product.basePrice,
        rating: product.rating,
        sold: product.sold,
        flashSaleEndsAt: product.flashSaleEndsAt,
        image: variant ? imageMap.get(variant.id) || null : null,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching flash sale products:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch flash sale products" },
      { status: 500 }
    );
  }
}
