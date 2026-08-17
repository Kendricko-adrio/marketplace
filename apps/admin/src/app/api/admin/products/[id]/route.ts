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
import { withPermission, getBranchScope } from "@/lib/auth-guard";
import { groupBranchStock, type BranchStockInputRow } from "@/lib/branch-stock";

/**
 * Admin product detail (read-only). Jubelio is the source of truth for
 * products, so create/update/delete are removed from the admin API — a product
 * is refreshed from Jubelio via POST /api/admin/products/[id]/sync instead.
 * See packages/db/src/jubelio-sync.ts + docs/features/jubelio-sync.md.
 */
export const GET = withPermission(async (
  ctx,
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const scope = getBranchScope(ctx.user);

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

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productData.id))
      .orderBy(asc(productVariants.isDefault));
    const variantIds = variants.map((v) => v.id);

    // Branch admins can only view products their branch carries (has any
    // branch_stock row for one of the product's variants at their branch). This
    // mirrors the products-list visibility filter so a branch admin can't reach
    // a non-carried product by navigating to its detail URL directly. HQ (scope
    // "all") is unaffected.
    if (scope.mode === "own") {
      const carried =
        variantIds.length > 0
          ? await db
              .select({ id: branchStocks.productVariantId })
              .from(branchStocks)
              .where(
                and(
                  inArray(branchStocks.productVariantId, variantIds),
                  eq(branchStocks.branchId, scope.branchId)
                )
              )
              .limit(1)
          : [];
      if (carried.length === 0) {
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
    //   - HQ / branchless admin → every branch.
    //   - Branch admin          → only their branch.
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
            scope.mode === "own"
              ? eq(branchStocks.branchId, scope.branchId)
              : undefined
          )
        );

      branchStockBranches = groupBranchStock(
        scope,
        stockRows as BranchStockInputRow[]
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...productData,
        categories: productCategories,
        variants: variantsWithImages,
        branchStock: {
          scope: scope.mode,
          branches: branchStockBranches,
        },
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
