import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  products,
  productVariants,
  productToCategory,
  categories,
  productImages,
} from "@/db";
import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { unlink } from "fs/promises";
import path from "path";
import { withAuth } from "@/lib/auth-guard";

async function deleteImageFiles(urls: string[]) {
  for (const url of urls) {
    if (!url.startsWith("/uploads/")) continue;
    const filePath = path.join(process.cwd(), "public", url);
    try {
      await unlink(filePath);
    } catch {
      // file may already be gone — ignore
    }
  }
}

export const GET = withAuth(async (
  _ctx,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;

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

    const productCategories = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
      })
      .from(productToCategory)
      .innerJoin(categories, eq(productToCategory.categoryId, categories.id))
      .where(eq(productToCategory.productId, productData.id));

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
          images: images.map((img) => ({ id: img.id, url: img.url, displayOrder: img.displayOrder })),
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        ...productData,
        categories: productCategories,
        variants: variantsWithImages,
      },
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}, ["admin", "hq"]);

const variantSchema = z.object({
  id: z.string().optional(),
  color: z.string().optional(),
  size: z.string().optional(),
  price: z.string(),
  stock: z.number().int().nonnegative(),
  sku: z.string(),
  isDefault: z.boolean().default(false),
  images: z
    .array(
      z.object({
        id: z.string().optional(),
        url: z.string(),
        displayOrder: z.number().int().default(0),
      })
    )
    .default([]),
});

const updateProductSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  basePrice: z.string(),
  status: z.enum(["aktif", "habis", "arsip"]).default("aktif"),
  categoryIds: z.array(z.string()),
  variants: z.array(variantSchema),
});

export const PUT = withAuth(async (
  _ctx,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;

    const existing = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = updateProductSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parsed.error },
        { status: 400 }
      );
    }

    const { name, slug, description, basePrice, status, categoryIds, variants } =
      parsed.data;

    // Update product fields
    await db
      .update(products)
      .set({ name, slug, description, basePrice, status, updatedAt: new Date() })
      .where(eq(products.id, id));

    // Sync categories: delete old, insert new
    await db.delete(productToCategory).where(eq(productToCategory.productId, id));
    for (const catId of categoryIds) {
      await db.insert(productToCategory).values({ productId: id, categoryId: catId });
    }

    // Get existing variants to determine which to update vs delete
    const existingVariants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id));

    const existingVariantIds = new Set(existingVariants.map((v) => v.id));
    const requestVariantIds = new Set(
      variants.filter((v) => v.id).map((v) => v.id!)
    );

    // Delete variants that are no longer in request (cascade deletes images)
    for (const existingId of existingVariantIds) {
      if (!requestVariantIds.has(existingId)) {
        // Clean up image files before DB delete
        const imgs = await db
          .select({ url: productImages.url })
          .from(productImages)
          .where(eq(productImages.variantId, existingId));
        await deleteImageFiles(imgs.map((r) => r.url));

        await db.delete(productVariants).where(eq(productVariants.id, existingId));
      }
    }

    // Upsert variants
    for (const variant of variants) {
      let variantId = variant.id;

      if (variantId && existingVariantIds.has(variantId)) {
        // Update existing variant
        await db
          .update(productVariants)
          .set({
            color: variant.color,
            size: variant.size,
            price: variant.price,
            stock: variant.stock,
            sku: variant.sku,
            isDefault: variant.isDefault,
            updatedAt: new Date(),
          })
          .where(eq(productVariants.id, variantId));
      } else {
        // Create new variant
        variantId = crypto.randomUUID();
        await db.insert(productVariants).values({
          id: variantId,
          productId: id,
          color: variant.color,
          size: variant.size,
          price: variant.price,
          stock: variant.stock,
          sku: variant.sku,
          isDefault: variant.isDefault,
        });
      }

      // Sync images for this variant: delete orphaned files, update DB
      const oldImages = await db
        .select({ url: productImages.url })
        .from(productImages)
        .where(eq(productImages.variantId, variantId));

      const newUrls = new Set(variant.images.map((img) => img.url));
      const orphanedUrls = oldImages
        .map((r) => r.url)
        .filter((url) => !newUrls.has(url));
      await deleteImageFiles(orphanedUrls);

      await db.delete(productImages).where(eq(productImages.variantId, variantId));

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

    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    console.error("Error updating product:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update product" },
      { status: 500 }
    );
  }
}, ["admin", "hq"]);

export const DELETE = withAuth(async (
  _ctx,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;

    const existing = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    // Collect all image URLs before cascade delete
    const variantRows = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, id));

    if (variantRows.length > 0) {
      const variantIds = variantRows.map((v) => v.id);
      const imageRows = await db
        .select({ url: productImages.url })
        .from(productImages)
        .where(inArray(productImages.variantId, variantIds));
      await deleteImageFiles(imageRows.map((r) => r.url));
    }

    await db.delete(products).where(eq(products.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting product:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete product" },
      { status: 500 }
    );
  }
}, ["admin", "hq"]);
