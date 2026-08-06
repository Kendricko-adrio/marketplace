import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
  brands,
  genders,
} from "@/db";
import { eq, ilike, and, or, sql, desc, asc, gte, lte, inArray } from "drizzle-orm";

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
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Query parameters
    const search = searchParams.get("search") || "";
    const categorySlug = searchParams.get("category");
    const brandSlug = searchParams.get("brand");
    const genderSlug = searchParams.get("gender");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const status = searchParams.get("status") || "aktif";
    const hasDiscount = searchParams.get("hasDiscount") === "true";
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "12");
    const offset = (page - 1) * limit;

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
    // gender / category).
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

    // Gender filter (slug → genderId).
    if (genderSlug) {
      const gender = await db
        .select({ id: genders.id })
        .from(genders)
        .where(eq(genders.slug, genderSlug))
        .limit(1);
      conditions.push(gender.length ? eq(products.genderId, gender[0].id) : sql`false`);
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

    // Attach the default-variant image. Price (cheapest variant net) already
    // comes from the joined subquery above; image deliberately comes from the
    // default/first variant — kept separate from the price source.
    const productsWithImages = await Promise.all(
      queryResults.map(async (product) => {
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
        let image = null;

        if (variant) {
          const images = await db
            .select()
            .from(productImages)
            .where(eq(productImages.variantId, variant.id))
            .orderBy(asc(productImages.displayOrder))
            .limit(1);
          image = images[0]?.url || null;
        }

        return {
          ...product,
          price: product.price ?? product.basePrice,
          image,
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