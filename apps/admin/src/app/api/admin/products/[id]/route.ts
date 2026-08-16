import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
} from "@/db";
import { eq, asc } from "drizzle-orm";
import { withPermission } from "@/lib/auth-guard";

/**
 * Admin product detail (read-only). Jubelio is the source of truth for
 * products, so create/update/delete are removed from the admin API — a product
 * is refreshed from Jubelio via POST /api/admin/products/[id]/sync instead.
 * See packages/db/src/jubelio-sync.ts + docs/jubelio-sync.md.
 */
export const GET = withPermission(async (
  _ctx,
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;

    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (product.length === 0) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    const productData = product[0];

    const productCategories = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
      })
      .from(productToCategory)
      .innerJoin(categories, eq(productToCategory.categoryId, categories.id))
      .where(eq(productToCategory.productId, productData.id));

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productData.id))
      .orderBy(asc(productVariants.isDefault));

    const variantsWithImages = await Promise.all(
      variants.map(async (variant) => {
        const variantImages = await db
          .select()
          .from(productImages)
          .where(eq(productImages.variantId, variant.id))
          .orderBy(asc(productImages.displayOrder));
        // Gallery: variant-level images (legacy/admin uploads) when present,
        // otherwise the product-level gallery (Jubelio catalog `images[]` —
        // hotlinked from the Jubelio CDN).
        const images =
          variantImages.length > 0
            ? variantImages.map((img) => ({
                id: img.id,
                url: img.url,
                displayOrder: img.displayOrder,
              }))
            : (productData.images ?? []).map((img, i) => ({
                id: `pimg-${i}`,
                url: img.url,
                displayOrder: img.displayOrder,
              }));

        return {
          ...variant,
          images,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        ...productData,
        categories: productCategories,
        variants: variantsWithImages,
      },
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}, "products", "view");