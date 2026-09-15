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
import { eq, desc, sql, inArray, asc, ilike, or, and } from "drizzle-orm";
import { serializeError } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import {
  computeScopedTotals,
  type ScopedTotalsInputRow,
} from "@/lib/branch-stock";
import { parsePagination } from "@/lib/pagination";

export const dynamic = "force-dynamic";

// GET /api/admin/products   [products:view]
//
// Branch scope comes from the Current Policy (not the legacy Role):
//   - own-branch view  → only products carried by the Home Branch, with stock
//     summed across that branch only.
//   - all-branch view  → all products, stock summed across branches.
// The SQL `where` is the real access control; computeScopedTotals (pure) is
// the tested filter+sum. See lib/branch-stock.ts.
export async function GET(request: NextRequest) {
  const guardResult = await guard("products", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      logger.warn("products.list.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePagination(
      searchParams.get("page"),
      searchParams.get("limit")
    );
    const search = searchParams.get("search")?.trim() || "";
    const offset = (page - 1) * limit;

    // Server-side search: match against name or slug. Empty search returns all.
    const searchCondition = search
      ? or(
          ilike(products.name, `%${search}%`),
          ilike(products.slug, `%${search}%`)
        )
      : undefined;

    // Own-branch scope is restricted to products their branch carries. Resolve
    // the carried product ids once (bounded catalog) and combine with the
    // search filter so both the list and the count query stay in sync for
    // pagination.
    let visibilityCondition = undefined;
    if (authorization.mode === "own") {
      const carried = await db
        .selectDistinct({ pid: productVariants.productId })
        .from(productVariants)
        .innerJoin(
          branchStocks,
          eq(branchStocks.productVariantId, productVariants.id)
        )
        .where(eq(branchStocks.branchId, authorization.branchId));
      const carriedIds = carried.map((r) => r.pid);
      // A branch with no stock rows carries nothing → empty result, not "all".
      visibilityCondition = inArray(
        products.id,
        carriedIds.length > 0 ? carriedIds : [""]
      );
    }

    const whereCondition = and(searchCondition, visibilityCondition) ?? undefined;

    const allProducts = await db
      .select()
      .from(products)
      .where(whereCondition)
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

    // Get total count (respect the same search + visibility filter so pagination matches)
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(whereCondition);
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
          // Fetch the raw per-branch rows for this product's variants, scoped in
          // SQL to the caller's branch under own-branch scope, then sum through
          // the pure helper (tested guarantee; SQL where is the real control).
          const stockRows = await db
            .select({
              branchId: branchStocks.branchId,
              stock: branchStocks.stock,
              reservedStock: branchStocks.reservedStock,
              pendingRemoteStock: branchStocks.pendingRemoteStock,
            })
            .from(branchStocks)
            .where(
              and(
                inArray(branchStocks.productVariantId, variantIds),
                authorization.mode === "own"
                  ? eq(branchStocks.branchId, authorization.branchId)
                  : undefined
              )
            );
          const totals = computeScopedTotals(
            authorization,
            stockRows as ScopedTotalsInputRow[]
          );
          totalStock = totals.totalStock;
          totalReserved = totals.totalReserved;
          totalAvailable = totals.totalAvailable;
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

    logger.info("products.list", {
      outcome: "success",
      total,
      page,
      limit,
      scope: authorization.mode,
    });

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
    logger.error("products.list.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}