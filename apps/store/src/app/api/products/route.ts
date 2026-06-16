import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
} from "@/db";
import { eq, ilike, and, or, sql, desc, asc, gte, lte } from "drizzle-orm";

type ProductResult = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: string;
  status: string;
  rating: string | null;
  sold: number;
  isFlashSale: boolean;
  flashSalePrice: string | null;
  flashSaleEndsAt: Date | null;
  createdAt: Date;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Query parameters
    const search = searchParams.get("search") || "";
    const categorySlug = searchParams.get("category");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const status = searchParams.get("status") || "aktif";
    const flashSale = searchParams.get("flashSale") === "true";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "12");
    const offset = (page - 1) * limit;

    // Build conditions
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

    if (flashSale) {
      conditions.push(eq(products.isFlashSale, true));
    }

    if (minPrice) {
      conditions.push(gte(products.basePrice, minPrice));
    }

    if (maxPrice) {
      conditions.push(lte(products.basePrice, maxPrice));
    }

    let queryResults: ProductResult[] = [];

    // Apply category filter if provided
    if (categorySlug) {
      const category = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, categorySlug))
        .limit(1);

      if (category.length > 0) {
        const categoryConditions = [
          eq(productToCategory.categoryId, category[0].id),
          ...conditions,
        ];

        queryResults = await db
          .select({
            id: products.id,
            name: products.name,
            slug: products.slug,
            description: products.description,
            basePrice: products.basePrice,
            status: products.status,
            rating: products.rating,
            sold: products.sold,
            isFlashSale: products.isFlashSale,
            flashSalePrice: products.flashSalePrice,
            flashSaleEndsAt: products.flashSaleEndsAt,
            createdAt: products.createdAt,
          })
          .from(products)
          .innerJoin(
            productToCategory,
            eq(products.id, productToCategory.productId)
          )
          .where(and(...categoryConditions))
          .orderBy(
            sortOrder === "asc"
              ? asc(products.createdAt)
              : desc(products.createdAt)
          )
          .limit(limit)
          .offset(offset);
      }
    } else {
      queryResults = await db
        .select({
          id: products.id,
          name: products.name,
          slug: products.slug,
          description: products.description,
          basePrice: products.basePrice,
          status: products.status,
          rating: products.rating,
          sold: products.sold,
          isFlashSale: products.isFlashSale,
          flashSalePrice: products.flashSalePrice,
          flashSaleEndsAt: products.flashSaleEndsAt,
          createdAt: products.createdAt,
        })
        .from(products)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          sortOrder === "asc"
            ? asc(products.createdAt)
            : desc(products.createdAt)
        )
        .limit(limit)
        .offset(offset);
    }

    // Get total count for pagination
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    // Get default variant for each product
    const productsWithVariants = await Promise.all(
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
          price: variant?.price || product.basePrice,
          image,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: productsWithVariants,
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
