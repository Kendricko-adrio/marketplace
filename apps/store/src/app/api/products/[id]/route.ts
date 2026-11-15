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
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { readVariantProjections } from "@/lib/variant-price-projection";
import { sellableVariantSql } from "@/lib/storefront-stock";
import { sellableUnits } from "@/lib/stock";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("product-detail");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/** HTTP adapter: baca produk + varian + stok cabang, map ke status/body existing. */
async function getProductDetail(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
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
      .where(and(eq(productVariants.productId, productData.id), sellableVariantSql()))
      .orderBy(asc(productVariants.isDefault));

    // One query for every variant's Markdown projection (no N+1); a fallback
    // (target >= source) reads as "no coretan" while the target stays stored.
    const projections = await readVariantProjections(variants.map((v) => v.id));

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

        // Hanya cabang dengan sellable > 0 yang dapat dipilih.
        const branchStockRows = variant.jubelioItemId == null ? [] : await db
          .select({
            branchId: branches.id,
            name: branches.name,
            code: branches.code,
            city: branches.city,
            stock: branchStocks.stock,
            reservedStock: branchStocks.reservedStock,
            pendingRemoteStock: branchStocks.pendingRemoteStock,
            availableStock: branchStocks.availableStock,
          })
          .from(branchStocks)
          .innerJoin(branches, eq(branchStocks.branchId, branches.id))
          .where(
            and(
              eq(branchStocks.productVariantId, variant.id),
              eq(branches.status, "aktif"),
              sql`${branches.jubelioLocationId} is not null`,
              sql`COALESCE(${branchStocks.availableStock}, 0) - ${branchStocks.pendingRemoteStock} > 0`
            )
          )
          .orderBy(asc(branches.name));

        const branchStock = branchStockRows.map((b) => ({
          ...b,
          available: sellableUnits(b),
        }));

        const projection = projections.get(variant.id);
        return {
          ...variant,
          // `price` stays the display/effective price the UI already reads; the
          // source price and Markdown state are explicit for the strikethrough.
          price: projection?.effectiveUnitPrice ?? variant.price,
          sourcePrice: projection?.sourceUnitPrice ?? variant.price,
          storedTarget: projection?.storedTarget ?? null,
          markdownActive: projection?.markdownActive ?? false,
          markdownRevisionId: projection?.markdownRevisionId ?? null,
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

    log.info(`product detail loaded: product ${productData.id}`);
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
  } catch {
    log.error("product detail failed", new RouteLogError("product detail failed"));
    return NextResponse.json(
      { success: false, error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(getProductDetail, "product-detail");
