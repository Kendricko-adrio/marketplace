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
  variantPriceCurrent,
  variantPriceRevisions,
} from "@/db";
import { eq, ilike, and, or, sql, desc, asc, gte, lte, inArray } from "drizzle-orm";
import { hasAvailableStock } from "@/lib/stock";
import { sellableVariantSql } from "@/lib/storefront-stock";
import {
  effectivePriceSql,
  markdownActiveSql,
  projectRow,
} from "@/lib/variant-price-projection";
import { parseListParams } from "@/lib/list-params";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("products-list");

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

type ProductResult = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  status: string;
  createdAt: Date;
  price: string | null;
  collection: string | null;
  gender: string | null;
  thumbnail: string | null;
};

/** HTTP adapter: baca filter, query halaman produk, map ke status/body existing. */
async function listProducts(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);

    // Query parameters
    const search = searchParams.get("search") || "";
    const categorySlug = searchParams.get("category");
    const brandSlug = searchParams.get("brand");
    const branchId = searchParams.get("branch");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const status = searchParams.get("status") || "aktif";
    const hasDiscount = searchParams.get("hasDiscount") === "true";
    const { page, limit, offset, sortBy, sortOrder } = parseListParams(
      searchParams
    );

    // Cheapest variant EFFECTIVE price per product — the price shown on cards
    // and the single basis for the price-range filter, the "has Markdown" filter
    // and price sort. The projection is identical to the JS one
    // (lib/variant-price-projection): a target counts only while it is below the
    // variant's CURRENT source. Joined (avoids N+1); products without variants
    // are excluded.
    const minPriceSq = db
      .select({
        productId: productVariants.productId,
        minPrice: sql<string>`min(${effectivePriceSql(
          productVariants.price,
          variantPriceRevisions.targetUnitPrice
        )})`.as("minPrice"),
        hasMarkdown: sql<boolean>`bool_or(${markdownActiveSql(
          productVariants.price,
          variantPriceRevisions.targetUnitPrice
        )})`.as("hasMarkdown"),
      })
      .from(productVariants)
      .leftJoin(
        variantPriceCurrent,
        eq(variantPriceCurrent.variantId, productVariants.id)
      )
      .leftJoin(
        variantPriceRevisions,
        and(
          eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
          eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
        )
      )
      .where(sellableVariantSql(branchId))
      .groupBy(productVariants.productId)
      .as("vp");

    // Build conditions (applied to BOTH the list query and the count query so
    // the pagination total stays correct under every filter, including brand /
    // category).
    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(products.name, `%${search}%`),
          ilike(products.description, `%${search}%`)
        )
      );
    }

    if (status) {
      conditions.push(eq(products.status, status));
    }

    if (hasDiscount) {
      // "Diskon" means an ACTIVE Markdown on a relevant variant — never the
      // legacy RRP (product.base_price) above the cheapest variant.
      conditions.push(sql`${minPriceSq.hasMarkdown}`);
    }

    if (minPrice) {
      conditions.push(gte(minPriceSq.minPrice, minPrice));
    }

    if (maxPrice) {
      conditions.push(lte(minPriceSq.minPrice, maxPrice));
    }

    // Brand filter (slug → brandId). Unknown slug → no results.
    if (brandSlug) {
      const brand = await db
        .select({ id: brands.id })
        .from(brands)
        .where(eq(brands.slug, brandSlug))
        .limit(1);
      conditions.push(brand.length ? eq(products.brandId, brand[0].id) : sql`false`);
    }

    // Category filter (slug → id) via a subquery on the junction table, so it
    // composes with the other conditions and applies to the count query too.
    if (categorySlug) {
      const category = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, categorySlug))
        .limit(1);
      if (category.length) {
        conditions.push(
          inArray(
            products.id,
            db
              .select({ productId: productToCategory.productId })
              .from(productToCategory)
              .where(eq(productToCategory.categoryId, category[0].id))
          )
        );
      } else {
        conditions.push(sql`false`);
      }
    }

    const chosenSort =
      sortBy === "price"
        ? sortOrder === "asc"
          ? asc(minPriceSq.minPrice)
          : desc(minPriceSq.minPrice)
        : sortOrder === "asc"
        ? asc(products.createdAt)
        : desc(products.createdAt);

    // Produk habis sudah dieliminasi sebelum pagination dan count.
    const orderBy = [chosenSort];

    const selectCols = {
      id: products.id,
      name: products.name,
      slug: products.slug,
      description: products.description,
      basePrice: products.basePrice,
      status: products.status,
      createdAt: products.createdAt,
      price: minPriceSq.minPrice,
      collection: products.collection,
      gender: genders.name,
      thumbnail: products.thumbnail,
    };

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const queryResults: ProductResult[] = await db
      .select(selectCols)
      .from(products)
      .innerJoin(minPriceSq, eq(products.id, minPriceSq.productId))
      .leftJoin(genders, eq(products.genderId, genders.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    // Get total count for pagination (same conditions as the list query).
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .innerJoin(minPriceSq, eq(products.id, minPriceSq.productId))
      .where(where);

    const total = Number(countResult[0]?.count || 0);

    // Per-product stock availability — used to grey out cards whose product
    // has no sellable stock in any branch. Two queries (no N+1): variants of
    // the page's products, then their branch-stock rows restricted to active
    // branches (same rule as the product-detail API).
    const pageVariantRows = await db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        jubelioItemId: productVariants.jubelioItemId,
        price: productVariants.price,
        targetUnitPrice: variantPriceRevisions.targetUnitPrice,
        markdownRevisionId: variantPriceRevisions.id,
        revisionVariantId: variantPriceRevisions.variantId,
      })
      .from(productVariants)
      .leftJoin(
        variantPriceCurrent,
        eq(variantPriceCurrent.variantId, productVariants.id)
      )
      .leftJoin(
        variantPriceRevisions,
        and(
          eq(variantPriceRevisions.id, variantPriceCurrent.revisionId),
          eq(variantPriceRevisions.variantId, variantPriceCurrent.variantId)
        )
      )
      .where(
        and(
          inArray(productVariants.productId, queryResults.map((p) => p.id)),
          sellableVariantSql(branchId)
        )
      );

    // Card display: the cheapest EFFECTIVE variant, its own source for the
    // strikethrough, and the stable tie-break by variant id (spec §4.1).
    type DisplayPrice = {
      effective: bigint;
      source: bigint;
      active: boolean;
      revisionId: string | null;
      variantId: string;
    };
    const displayByProduct = new Map<string, DisplayPrice>();
    for (const row of pageVariantRows) {
      const projection = projectRow({
        variantId: row.id,
        sourceUnitPrice: row.price,
        storedTargetUnitPrice: row.targetUnitPrice,
        markdownRevisionId:
          row.revisionVariantId === null ? null : row.markdownRevisionId,
      });
      const candidate: DisplayPrice = {
        effective: BigInt(projection.effectiveUnitPrice),
        source: BigInt(projection.sourceUnitPrice),
        active: projection.markdownActive,
        revisionId: projection.markdownRevisionId,
        variantId: row.id,
      };
      const current = displayByProduct.get(row.productId);
      if (
        !current ||
        candidate.effective < current.effective ||
        (candidate.effective === current.effective &&
          candidate.variantId < current.variantId)
      ) {
        displayByProduct.set(row.productId, candidate);
      }
    }

    // When a branch filter is active, hasStock reflects availability at that
    // branch only (products shown are all in-stock there anyway — this keeps
    // the grey-out logic consistent with the filtered set).
    const stockConditions = [
      inArray(
        branchStocks.productVariantId,
        pageVariantRows.map((v) => v.id)
      ),
      eq(branches.status, "aktif"),
    ];
    if (branchId) stockConditions.push(eq(branchStocks.branchId, branchId));

    const pageStockRows = pageVariantRows.length
      ? await db
          .select({
            productVariantId: branchStocks.productVariantId,
            stock: branchStocks.stock,
            pendingRemoteStock: branchStocks.pendingRemoteStock,
            availableStock: branchStocks.availableStock,
            jubelioLocationId: branches.jubelioLocationId,
          })
          .from(branchStocks)
          .innerJoin(branches, eq(branchStocks.branchId, branches.id))
          .where(and(...stockConditions))
      : [];

    const variantToProduct = new Map(
      pageVariantRows.map((v) => [v.id, v.productId])
    );
    const mappedVariantIds = new Set(
      pageVariantRows.filter((v) => v.jubelioItemId != null).map((v) => v.id)
    );
    const stockByProduct = new Map<
      string,
      { stock: number; pendingRemoteStock: number; availableStock: number | null }[]
    >();
    for (const row of pageStockRows) {
      const productId = variantToProduct.get(row.productVariantId);
      if (!productId || row.jubelioLocationId == null ||
          !mappedVariantIds.has(row.productVariantId)) continue;
      const list = stockByProduct.get(productId) ?? [];
      list.push({
        stock: row.stock,
        pendingRemoteStock: row.pendingRemoteStock,
        availableStock: row.availableStock,
      });
      stockByProduct.set(productId, list);
    }

    // Attach the card image. Prefer the product-level `thumbnail` (set by the
    // Jubelio sync / seeder — a Jubelio CDN URL, hotlinked). Fall back to the
    // default variant's first variant-level image for legacy products that
    // predate the product-level thumbnail column.
    const productsWithImages = await Promise.all(
      queryResults.map(async (product) => {
        let image = product.thumbnail ?? null;
        if (!image) {
          const defaultVariant = await db
            .select()
            .from(productVariants)
            .where(
              and(
                eq(productVariants.productId, product.id),
                eq(productVariants.isDefault, true)
              )
            )
            .limit(1);
          const variant = defaultVariant[0];
          if (variant) {
            const images = await db
              .select()
              .from(productImages)
              .where(eq(productImages.variantId, variant.id))
              .orderBy(asc(productImages.displayOrder))
              .limit(1);
            image = images[0]?.url || null;
          }
        }

        const display = displayByProduct.get(product.id);
        return {
          ...product,
          price: display
            ? display.effective.toString()
            : (product.price ?? product.basePrice),
          // Original/coretan always comes from the SAME variant that supplies
          // the effective price — never the group RRP or another variant.
          sourcePrice: display
            ? display.source.toString()
            : (product.price ?? product.basePrice),
          markdownActive: display?.active ?? false,
          markdownRevisionId: display?.revisionId ?? null,
          image,
          hasStock: hasAvailableStock(stockByProduct.get(product.id) ?? []),
          lastKnownInStock: hasAvailableStock(stockByProduct.get(product.id) ?? []),
        };
      })
    );

    const response = NextResponse.json({
      success: true,
      data: productsWithImages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
    // Nilai query mentah (search/category/brand/branch/harga) tidak masuk log;
    // hanya fakta bisnis halaman + boolean filter yang aman.
    log.info(
      `products list loaded: page ${page}, limit ${limit}, returned ${productsWithImages.length}, total ${total}, sortBy ${sortBy}, sortOrder ${sortOrder}, hasDiscount ${hasDiscount}`
    );
    return response;
  } catch {
    log.error("products list failed", new RouteLogError("products list failed"));
    return NextResponse.json(
      { success: false, error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(listProducts, "products-list");
