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
import { eq, desc, sql, inArray, sum, asc } from "drizzle-orm";
import { z } from "zod";
import { withPermission } from "@/lib/auth-guard";

export const GET = withPermission(async (_ctx, request: NextRequest) => {
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
        let totalReserved = 0;
        let totalAvailable = 0;
        if (variantIds.length > 0) {
          // totalStock = all units on hand; totalReserved = units held by
          // pending_payment orders; totalAvailable = units actually buyable.
          const stockRows = await db
            .select({
              total: sum(branchStocks.stock),
              reserved: sum(branchStocks.reservedStock),
            })
            .from(branchStocks)
            .where(inArray(branchStocks.productVariantId, variantIds));
          totalStock = Number(stockRows[0]?.total || 0);
          totalReserved = Number(stockRows[0]?.reserved || 0);
          totalAvailable = Math.max(0, totalStock - totalReserved);
        }

        // Fetch images for each variant
        let images: { url: string }[] = [];
        if (variantIds.length > 0) {
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
}, "products", "view");

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

export const POST = withPermission(async (_ctx, request: NextRequest) => {
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
}, "products", "edit");
