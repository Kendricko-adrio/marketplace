import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
  branchStocks,
} from "@/db";
import { eq, desc, sql, inArray, sum } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(async (_ctx, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    const allProducts = await db
      .select()
      .from(products)
      .orderBy(desc(products.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(products);
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
        if (variantIds.length > 0) {
          const stockRows = await db
            .select({ total: sum(branchStocks.stock) })
            .from(branchStocks)
            .where(inArray(branchStocks.productVariantId, variantIds));
          totalStock = Number(stockRows[0]?.total || 0);
        }

        return {
          ...product,
          variants: variants.length,
          totalStock,
          categories: productCategories.map((c) => c.name),
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
}, ["admin", "hq"]);

const createProductSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  basePrice: z.string(),
  status: z.enum(["aktif", "habis", "arsip"]).default("aktif"),
  categoryIds: z.array(z.string()),
  variants: z.array(
    z.object({
      color: z.string().optional(),
      size: z.string().optional(),
      price: z.string(),
      sku: z.string(),
      isDefault: z.boolean().default(false),
      images: z
        .array(
          z.object({
            url: z.string(),
            displayOrder: z.number().int().default(0),
          })
        )
        .default([]),
    })
  ),
});

export const POST = withAuth(async (_ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = createProductSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error,
        },
        { status: 400 }
      );
    }

    const {
      name,
      slug,
      description,
      basePrice,
      status,
      categoryIds,
      variants,
    } = parsed.data;

    // Create product
    const productId = crypto.randomUUID();
    await db.insert(products).values({
      id: productId,
      name,
      slug,
      description,
      basePrice,
      status,
    });

    // Create product-category relations
    for (const catId of categoryIds) {
      await db.insert(productToCategory).values({
        productId,
        categoryId: catId,
      });
    }

    // Create variants
    for (const variant of variants) {
      const variantId = crypto.randomUUID();
        await db.insert(productVariants).values({
          id: variantId,
          productId,
          sku: variant.sku,
          color: variant.color,
          size: variant.size,
          price: variant.price,
          isDefault: variant.isDefault,
        });

      // Create images for this variant
      for (let i = 0; i < variant.images.length; i++) {
        const img = variant.images[i];
        await db.insert(productImages).values({
          id: crypto.randomUUID(),
          variantId,
          url: img.url,
          displayOrder: img.displayOrder ?? i,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: { id: productId },
    });
  } catch (error) {
    console.error("Error creating product:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create product" },
      { status: 500 }
    );
  }
}, ["admin", "hq"]);
