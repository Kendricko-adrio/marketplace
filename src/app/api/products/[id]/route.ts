import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
  reviews,
} from "@/db/schema";
import { eq, and, asc, avg, count } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Get variants with images
    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productData.id))
      .orderBy(asc(productVariants.isDefault));

    const variantsWithImages = await Promise.all(
      variants.map(async (variant) => {
        const images = await db
          .select()
          .from(productImages)
          .where(eq(productImages.variantId, variant.id))
          .orderBy(asc(productImages.displayOrder));

        return {
          ...variant,
          images: images.map((img) => img.url),
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

    // Get reviews summary
    const reviewsSummary = await db
      .select({
        avgRating: avg(reviews.rating),
        totalReviews: count(reviews.id),
      })
      .from(reviews)
      .where(eq(reviews.productId, productData.id));

    // Get recent reviews
    const recentReviews = await db
      .select()
      .from(reviews)
      .where(eq(reviews.productId, productData.id))
      .orderBy(asc(reviews.createdAt))
      .limit(5);

    return NextResponse.json({
      success: true,
      data: {
        ...productData,
        categories: productCategories,
        variants: variantsWithImages,
        colors,
        sizes,
        reviews: {
          average: reviewsSummary[0]?.avgRating || 0,
          total: Number(reviewsSummary[0]?.totalReviews || 0),
          recent: recentReviews,
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
}
