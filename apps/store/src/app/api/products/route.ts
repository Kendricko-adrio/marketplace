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
import { eq, ilike, and, or, sql, desc, asc, gte, lte, inArray } from "drizzle-orm";
import { hasAvailableStock } from "@/lib/stock";
import { parseListParams } from "@/lib/list-params";

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

export async function GET(request: NextRequest) {
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

    // Cheapest variant net price per product — the price shown on cards and the
    // basis for the price-range filter, the "has discount" filter, and price
    // sort. Joined (avoids N+1). Products without variants are excluded.
    const minPriceSq = db
      .select({
        productId: productVariants.productId,
        minPrice: sql<string>`min(${productVariants.price})`.as("minPrice"),
      })
      .from(productVariants)
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
      // Discount = RRP (base_price) above the cheapest variant net price.
      conditions.push(sql`${products.basePrice} > ${minPriceSq.minPrice}`);
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

    // Branch filter (branch id) via a subquery: the product must have at least
    // one variant with available stock (stock - pendingRemoteStock > 0) at that
    // branch. Composes with the other conditions and applies to the count
    // query too, so pagination.total reflects the branch-filtered set.
    if (branchId) {
      conditions.push(
        inArray(
          products.id,
          db
            .select({ productId: productVariants.productId })
            .from(productVariants)
            .innerJoin(
              branchStocks,
              eq(branchStocks.productVariantId, productVariants.id)
            )
            .where(
              and(
                eq(branchStocks.branchId, branchId),
                sql`${branchStocks.stock} - ${branchStocks.pendingRemoteStock} > 0`
              )
            )
        )
      );
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

    const orderBy =
      sortBy === "price"
        ? sortOrder === "asc"
          ? asc(minPriceSq.minPrice)
          : desc(minPriceSq.minPrice)
        : sortOrder === "asc"
        ? asc(products.createdAt)
        : desc(products.createdAt);

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
      .orderBy(orderBy)
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
      .select({ id: productVariants.id, productId: productVariants.productId })
      .from(productVariants)
      .where(
        inArray(
          productVariants.productId,
          queryResults.map((p) => p.id)
        )
      );

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
          })
          .from(branchStocks)
          .innerJoin(branches, eq(branchStocks.branchId, branches.id))
          .where(and(...stockConditions))
      : [];

    const variantToProduct = new Map(
      pageVariantRows.map((v) => [v.id, v.productId])
    );
    const stockByProduct = new Map<
      string,
      { stock: number; pendingRemoteStock: number }[]
    >();
    for (const row of pageStockRows) {
      const productId = variantToProduct.get(row.productVariantId);
      if (!productId) continue;
      const list = stockByProduct.get(productId) ?? [];
      list.push({
        stock: row.stock,
        pendingRemoteStock: row.pendingRemoteStock,
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

        return {
          ...product,
          price: product.price ?? product.basePrice,
          image,
          hasStock: hasAvailableStock(stockByProduct.get(product.id) ?? []),
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: productsWithImages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}
