import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
  branches,
  branchStocks,
} from "@/db";
import { eq, asc, inArray, and } from "drizzle-orm";
import { serializeError } from "@/lib/logger";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { groupBranchStock, type BranchStockInputRow } from "@/lib/branch-stock";

export const dynamic = "force-dynamic";

/**
 * Admin product detail (read-only)   [products:view]
 *
 * Jubelio is the source of truth for products, so create/update/delete are
 * removed from the admin API — a product is refreshed from Jubelio via
 * POST /api/admin/products/[id]/sync instead. See
 * packages/db/src/jubelio-sync.ts + docs/features/jubelio-sync.md.
 *
 * Own-branch scope can only view products their branch carries (has any
 * branch_stock row for one of the product's variants at their branch); a
 * non-carried id is a cross-branch reference and 404s so existence is not
 * disclosed. All-branch scope is unaffected.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("products", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      logger.warn("products.detail.scope_unresolvable", {
        outcome: "denied",
        reason: "missing_home_branch",
        userId: ctx.user.id,
        productId: id,
      });
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }
    const productLog = logger.child({ productId: id });

    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (product.length === 0) {
      crossBranchNotFound(productLog);
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    const productData = product[0];

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productData.id))
      .orderBy(asc(productVariants.isDefault));
    const variantIds = variants.map((v) => v.id);

    // Own-branch scope mirrors the products-list visibility filter so a
    // branch operator can't reach a non-carried product by navigating to its
    // detail URL directly — mapped to 404 (not 403) so existence is not
    // disclosed.
    if (authorization.mode === "own") {
      const carried =
        variantIds.length > 0
          ? await db
              .select({ id: branchStocks.productVariantId })
              .from(branchStocks)
              .where(
                and(
                  inArray(branchStocks.productVariantId, variantIds),
                  eq(branchStocks.branchId, authorization.branchId)
                )
              )
              .limit(1)
          : [];
      if (carried.length === 0) {
        crossBranchNotFound(productLog);
        return NextResponse.json(
          { success: false, error: "Product not found" },
          { status: 404 }
        );
      }
    }

    const productCategories = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
      })
      .from(productToCategory)
      .innerJoin(categories, eq(productToCategory.categoryId, categories.id))
      .where(eq(productToCategory.productId, productData.id));

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

    // Per-variant stock at each branch, scoped by the caller's branch access:
    //   - all-branch view → every branch.
    //   - own-branch view → only their Home Branch.
    // The SQL `where` is the real access control; groupBranchStock (pure) is
    // the tested filter+group+available-compute. See lib/branch-stock.ts.
    let branchStockBranches: ReturnType<typeof groupBranchStock> = [];
    if (variantIds.length > 0) {
      const stockRows = await db
        .select({
          branchId: branches.id,
          branchName: branches.name,
          branchCode: branches.code,
          branchCity: branches.city,
          branchStatus: branches.status,
          variantId: branchStocks.productVariantId,
          sku: productVariants.sku,
          size: productVariants.size,
          color: productVariants.color,
          stock: branchStocks.stock,
          reservedStock: branchStocks.reservedStock,
          pendingRemoteStock: branchStocks.pendingRemoteStock,
        })
        .from(branchStocks)
        .innerJoin(branches, eq(branchStocks.branchId, branches.id))
        .innerJoin(
          productVariants,
          eq(branchStocks.productVariantId, productVariants.id)
        )
        .where(
          and(
            inArray(branchStocks.productVariantId, variantIds),
            authorization.mode === "own"
              ? eq(branchStocks.branchId, authorization.branchId)
              : undefined
          )
        );

      branchStockBranches = groupBranchStock(
        authorization,
        stockRows as BranchStockInputRow[]
      );
    }

    productLog.info("products.detail", {
      outcome: "success",
      scope: authorization.mode,
      variantCount: variants.length,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...productData,
        categories: productCategories,
        variants: variantsWithImages,
        branchStock: {
          scope: authorization.mode,
          branches: branchStockBranches,
        },
      },
    });
  } catch (error) {
    logger.error("products.detail.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}