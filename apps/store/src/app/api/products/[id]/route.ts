import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
  branchStocks,
  branches,
  brands,
  genders,
} from "@/db";
import { eq, and, asc, sql } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get product by ID or slug
    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (product.length === 0) {
      // Try finding by slug
      const productBySlug = await db
        .select()
        .from(products)
        .where(eq(products.slug, id))
        .limit(1);

      if (productBySlug.length === 0) {
        return NextResponse.json(
          { success: false, error: "Product not found" },
          { status: 404 }
        );
      }
      product[0] = productBySlug[0];
    }

    const productData = product[0];

    // Get categories
    const productCategories = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
      })
      .from(productToCategory)
      .innerJoin(categories, eq(productToCategory.categoryId, categories.id))
      .where(eq(productToCategory.productId, productData.id));

    // Resolve brand and gender names (sync-managed dimensions).
    // brandId / genderId are nullable FKs; left joins keep products without them.
    const [brandRow] = productData.brandId
      ? await db
          .select({ name: brands.name })
          .from(brands)
          .where(eq(brands.id, productData.brandId))
          .limit(1)
      : [];

    const [genderRow] = productData.genderId
      ? await db
          .select({ name: genders.name })
          .from(genders)
          .where(eq(genders.id, productData.genderId))
          .limit(1)
      : [];

    // Get variants with images
    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productData.id))
      .orderBy(asc(productVariants.isDefault));

    const variantsWithImagesAndStock = await Promise.all(
      variants.map(async (variant) => {
        const variantImages = await db
          .select()
          .from(productImages)
          .where(eq(productImages.variantId, variant.id))
          .orderBy(asc(productImages.displayOrder));
        // Gallery: variant-level images (legacy/admin uploads) when present,
        // otherwise the product-level gallery (Jubelio catalog `images[]`).
        const images =
          variantImages.length > 0
            ? variantImages.map((img) => img.url)
            : (productData.images ?? []).map((img) => img.url);

        // Get branches with available stock for this variant.
        // Confirmed reservations are already reflected in Jubelio on-hand.
        // Branches with zero/negative available are hidden.
        const branchStockRows = await db
          .select({
            branchId: branches.id,
            name: branches.name,
            code: branches.code,
            city: branches.city,
            stock: branchStocks.stock,
            reservedStock: branchStocks.reservedStock,
            pendingRemoteStock: branchStocks.pendingRemoteStock,
          })
          .from(branchStocks)
          .innerJoin(branches, eq(branchStocks.branchId, branches.id))
          .where(
            and(
              eq(branchStocks.productVariantId, variant.id),
              eq(branches.status, "aktif"),
              sql`${branchStocks.stock} - ${branchStocks.pendingRemoteStock} > 0`
            )
          )
          .orderBy(asc(branches.name));

        const branchStock = branchStockRows.map((b) => ({
          ...b,
          available: b.stock - b.pendingRemoteStock,
        }));

        return {
          ...variant,
          images,
          branchStock,
        };
      })
    );

    // Get unique colors and sizes
    const colors = [
      ...new Set(variants.filter((v) => v.color).map((v) => v.color)),
    ];
    const sizes = [
      ...new Set(variants.filter((v) => v.size).map((v) => v.size)),
    ];

    return NextResponse.json({
      success: true,
      data: {
        ...productData,
        brand: brandRow?.name ?? null,
        gender: genderRow?.name ?? null,
        // collection is a plain text column on the product row, already spread
        // above via ...productData — surfaced here for client convenience.
        collection: productData.collection ?? null,
        categories: productCategories,
        variants: variantsWithImagesAndStock,
        colors,
        sizes,
      },
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}
