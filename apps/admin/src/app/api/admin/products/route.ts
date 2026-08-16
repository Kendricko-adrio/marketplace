import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
  branchStocks,
  genders,
} from "@/db";
import { eq, desc, sql, inArray, sum, asc, ilike, or } from "drizzle-orm";
import { withPermission } from "@/lib/auth-guard";

export const GET = withPermission(async (_ctx, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search")?.trim() || "";
    const offset = (page - 1) * limit;

    // Server-side search: match against name or slug. Empty search returns all.
    const searchCondition = search
      ? or(
          ilike(products.name, `%${search}%`),
          ilike(products.slug, `%${search}%`)
        )
      : undefined;

    const allProducts = await db
      .select()
      .from(products)
      .where(searchCondition)
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset);

    // Resolve gender names for this page (product row only carries genderId).
    // genderId is nullable; map id -> name so consumers (e.g. the carousel
    // manual-mode preview) can render the gender label without a second hit.
    const genderIds = [
      ...new Set(
        allProducts.map((p) => p.genderId).filter((g): g is string => !!g)
      ),
    ];
    const genderNameMap = new Map<string, string>();
    if (genderIds.length > 0) {
      const genderRows = await db
        .select({ id: genders.id, name: genders.name })
        .from(genders)
        .where(inArray(genders.id, genderIds));
      for (const g of genderRows) genderNameMap.set(g.id, g.name);
    }

    // Get total count (respect the same search filter so pagination matches)
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(searchCondition);
    const total = Number(countResult[0]?.count || 0);

    // Get variants and categories for each product
    const productsWithDetails = await Promise.all(
      allProducts.map(async (product) => {
        const variants = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.productId, product.id));

        const productCategories = await db
          .select({ name: categories.name })
          .from(productToCategory)
          .innerJoin(
            categories,
            eq(productToCategory.categoryId, categories.id)
          )
          .where(eq(productToCategory.productId, product.id));

        const variantIds = variants.map((v) => v.id);
        let totalStock = 0;
        let totalReserved = 0;
        let totalAvailable = 0;
        if (variantIds.length > 0) {
          // totalStock = all units on hand; totalReserved = units held by
          // pending_payment orders; totalAvailable = units actually buyable.
          const stockRows = await db
            .select({
              total: sum(branchStocks.stock),
              reserved: sum(branchStocks.reservedStock),
            })
            .from(branchStocks)
            .where(inArray(branchStocks.productVariantId, variantIds));
          totalStock = Number(stockRows[0]?.total || 0);
          totalReserved = Number(stockRows[0]?.reserved || 0);
          totalAvailable = Math.max(0, totalStock - totalReserved);
        }

        // Image: prefer the product-level thumbnail (Jubelio CDN); fall back to
        // the variant-level images for legacy products.
        let images: { url: string }[] = [];
        if (product.thumbnail) {
          images = [{ url: product.thumbnail }];
        } else if (variantIds.length > 0) {
          const variantImages = await db
            .select({ url: productImages.url })
            .from(productImages)
            .where(inArray(productImages.variantId, variantIds))
            .orderBy(asc(productImages.displayOrder));
          images = variantImages;
        }

        return {
          ...product,
          gender: product.genderId
            ? genderNameMap.get(product.genderId) ?? null
            : null,
          variants: variants.map((v) => ({
            id: v.id,
            price: v.price,
            isDefault: v.isDefault,
          })),
          variantCount: variants.length,
          totalStock,
          totalReserved,
          totalAvailable,
          categories: productCategories.map((c) => c.name),
          images,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: productsWithDetails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching admin products:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}, "products", "view");
