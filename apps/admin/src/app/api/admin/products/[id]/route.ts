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
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard, crossBranchNotFound } from "@/lib/rbac/guard";
import { branchScopeFromAuthorization } from "@/lib/rbac/branch-scope";
import { groupBranchStock, type BranchStockInputRow } from "@/lib/branch-stock";
import { projectMarkdownPrice } from "@marketplace/db/src/markdown-pricing";
import { readAdminVariantProjections } from "@/lib/variant-price-read";

export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-product-detail");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class ProductDetailLogError extends Error {
  constructor() {
    super("products detail gagal");
    this.name = "ProductDetailLogError";
  }
}

type RouteContext = { params: Promise<{ id: string }> };

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
async function productDetail(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("products", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let productId: string | null = null;
  try {
    const { id } = await params;
    productId = id;
    const authorization = branchScopeFromAuthorization(ctx.authorization);
    if (!authorization) {
      log.warn(
        `products.detail scope tidak dapat ditentukan (userId ${ctx.user.id}, productId ${id}, reason missing_home_branch, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "DENIED" },
        { status: 403 }
      );
    }

    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (product.length === 0) {
      crossBranchNotFound();
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
        crossBranchNotFound();
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

    const projections = await readAdminVariantProjections(variantIds);

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
          // Markdown projection for the price panel: source and effective are
          // explicit, the target stays stored on fallback.
          price: projections.get(variant.id)?.effectiveUnitPrice ?? variant.price,
          sourcePrice: projections.get(variant.id)?.sourceUnitPrice ?? variant.price,
          storedTarget: projections.get(variant.id)?.storedTarget ?? null,
          markdownActive: projections.get(variant.id)?.markdownActive ?? false,
          markdownRevisionId:
            projections.get(variant.id)?.markdownRevisionId ?? null,
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
          availableStock: branchStocks.availableStock,
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

    log.info(
      `products.detail (productId ${id}, scope ${authorization.mode}, variantCount ${variants.length}, outcome success)`
    );

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
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      `products.detail gagal (productId ${productId ?? "unknown"}, outcome error)`,
      new ProductDetailLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(productDetail, "admin-product-detail");
