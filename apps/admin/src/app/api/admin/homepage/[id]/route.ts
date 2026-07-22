import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  homepageSections,
  homepageSectionProducts,
  products,
} from "@/db";
import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { withPermission } from "@/lib/auth-guard";
import { deleteFile } from "@/lib/uploads";

export const GET = withPermission(
  async (_ctx, _request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await ctx.params;

      const sectionRows = await db
        .select()
        .from(homepageSections)
        .where(eq(homepageSections.id, id))
        .limit(1);

      if (sectionRows.length === 0) {
        return NextResponse.json(
          { success: false, error: "Section not found" },
          { status: 404 }
        );
      }

      const section = sectionRows[0];
      let linkedProducts: {
        id: string;
        name: string;
        slug: string;
        displayOrder: number;
      }[] = [];

      if (section.type === "carousel_product") {
        const junctionRows = await db
          .select()
          .from(homepageSectionProducts)
          .where(eq(homepageSectionProducts.sectionId, id))
          .orderBy(asc(homepageSectionProducts.displayOrder));

        const productIds = junctionRows.map((r) => r.productId);
        if (productIds.length > 0) {
          const productRows = await db
            .select({
              id: products.id,
              name: products.name,
              slug: products.slug,
            })
            .from(products)
            .where(inArray(products.id, productIds));
          const map = new Map(productRows.map((p) => [p.id, p]));
          linkedProducts = junctionRows.map((r) => ({
            id: r.productId,
            name: map.get(r.productId)?.name ?? "",
            slug: map.get(r.productId)?.slug ?? "",
            displayOrder: r.displayOrder,
          }));
        }
      }

      return NextResponse.json({
        success: true,
        data: { ...section, products: linkedProducts },
      });
    } catch (error) {
      console.error("Error fetching homepage section:", error);
      return NextResponse.json(
        { success: false, error: "Failed to fetch section" },
        { status: 500 }
      );
    }
  },
  "homepage",
  "view"
);

// --- Zod schemas for content validation ---

const productFilterSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
  flashSale: z.boolean().optional(),
  sortOrder: z
    .enum(["newest", "priceAsc", "priceDesc", "bestseller", "rating"])
    .optional(),
});

const bannerSlideSchema = z.object({
  imageUrl: z.string(),
  altText: z.string().optional(),
});

const bannerContentSchema = z.object({
  slides: z.array(bannerSlideSchema).max(5).default([]),
  ctaText: z.string().optional(),
  ctaLink: z.string().optional(),
  autoRotateIntervalSec: z.number().int().min(2).max(30).optional(),
});

const carouselContentSchema = z.object({
  mode: z.enum(["manual", "filter"]),
  filter: productFilterSchema.optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const promoCardItemSchema = z.object({
  id: z.string(),
  imageUrl: z.string(),
  title: z.string(),
  filter: productFilterSchema.optional(),
});

const promoCardsContentSchema = z.object({
  cards: z.array(promoCardItemSchema).max(6).default([]),
});

const announcementBarContentSchema = z.object({
  message: z.string(),
  variant: z.enum(["info", "warning", "success"]).optional(),
});

function validateContent(type: string, content: unknown): unknown {
  if (content === null || content === undefined) return {};
  switch (type) {
    case "banner":
      return bannerContentSchema.parse(content);
    case "carousel_product":
      return carouselContentSchema.parse(content);
    case "promo_cards":
      return promoCardsContentSchema.parse(content);
    case "announcement_bar":
      return announcementBarContentSchema.parse(content);
    case "store_banner":
    default:
      return content;
  }
}

/**
 * Extracts all /uploads/ image URLs stored inside a section's JSONB content.
 * Only banner (slides[].imageUrl) and promo_cards (cards[].imageUrl) store
 * images. Returns an empty array for other section types.
 */
function extractImageUrls(type: string, content: unknown): string[] {
  if (!content || typeof content !== "object") return [];
  const c = content as Record<string, unknown>;
  const urls: string[] = [];

  if (type === "banner" && Array.isArray(c.slides)) {
    for (const slide of c.slides) {
      if (slide && typeof slide === "object") {
        const url = (slide as { imageUrl?: unknown }).imageUrl;
        if (typeof url === "string" && url.startsWith("/uploads/")) {
          urls.push(url);
        }
      }
    }
  } else if (type === "promo_cards" && Array.isArray(c.cards)) {
    for (const card of c.cards) {
      if (card && typeof card === "object") {
        const url = (card as { imageUrl?: unknown }).imageUrl;
        if (typeof url === "string" && url.startsWith("/uploads/")) {
          urls.push(url);
        }
      }
    }
  }

  return urls;
}

/**
 * Deletes every file referenced by the given URLs from disk.
 * Errors per-file are swallowed so one missing file doesn't abort cleanup.
 */
async function deleteImageFiles(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await deleteFile(url);
    } catch (error) {
      console.error("Failed to delete file:", url, error);
    }
  }
}

const updateSectionSchema = z.object({
  type: z
    .enum([
      "banner",
      "carousel_product",
      "promo_cards",
      "announcement_bar",
      "store_banner",
    ])
    .optional(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().optional(),
  productIds: z.array(z.string()).optional(),
});

export const PATCH = withPermission(
  async (_ctx, request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await ctx.params;

      const existing = await db
        .select()
        .from(homepageSections)
        .where(eq(homepageSections.id, id))
        .limit(1);

      if (existing.length === 0) {
        return NextResponse.json(
          { success: false, error: "Section not found" },
          { status: 404 }
        );
      }

      const body = await request.json();
      const parsed = updateSectionSchema.safeParse(body);

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

      const data = parsed.data;
      const { productIds, ...fieldsToUpdate } = data;

      // Validate content shape per-type when content is provided.
      let validatedContent: unknown | undefined = undefined;
      const effectiveType = fieldsToUpdate.type ?? existing[0].type;
      if (fieldsToUpdate.content !== undefined) {
        try {
          validatedContent = validateContent(effectiveType, fieldsToUpdate.content);
        } catch (e) {
          return NextResponse.json(
            {
              success: false,
              error: "Invalid content shape for section type",
              details: e instanceof z.ZodError ? e : String(e),
            },
            { status: 400 }
          );
        }
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (fieldsToUpdate.type !== undefined) updateData.type = fieldsToUpdate.type;
      if (fieldsToUpdate.title !== undefined) updateData.title = fieldsToUpdate.title;
      if (fieldsToUpdate.subtitle !== undefined)
        updateData.subtitle = fieldsToUpdate.subtitle;
      if (validatedContent !== undefined) updateData.content = validatedContent;
      if (fieldsToUpdate.isActive !== undefined)
        updateData.isActive = fieldsToUpdate.isActive;
      if (fieldsToUpdate.displayOrder !== undefined)
        updateData.displayOrder = fieldsToUpdate.displayOrder;

      await db
        .update(homepageSections)
        .set(updateData)
        .where(eq(homepageSections.id, id));

      // Clean up orphaned image files when content changes for banner/promo.
      if (
        validatedContent !== undefined &&
        (effectiveType === "banner" || effectiveType === "promo_cards")
      ) {
        const oldUrls = new Set(extractImageUrls(existing[0].type, existing[0].content));
        const newUrls = new Set(extractImageUrls(effectiveType, validatedContent));
        const orphaned = [...oldUrls].filter((url) => !newUrls.has(url));
        if (orphaned.length > 0) {
          await deleteImageFiles(orphaned);
        }
      }

      if (
        existing[0].type === "carousel_product" ||
        fieldsToUpdate.type === "carousel_product"
      ) {
        if (productIds !== undefined) {
          // Always clear the junction first.
          await db
            .delete(homepageSectionProducts)
            .where(eq(homepageSectionProducts.sectionId, id));

          // Re-insert only if the carousel is NOT in filter mode and ids are present.
          const carouselContent =
            (validatedContent as { mode?: string } | undefined) ??
            (existing[0].content as { mode?: string } | undefined);
          const isFilterMode = carouselContent?.mode === "filter";
          if (!isFilterMode && productIds.length > 0) {
            for (let i = 0; i < productIds.length; i++) {
              await db.insert(homepageSectionProducts).values({
                sectionId: id,
                productId: productIds[i],
                displayOrder: i + 1,
              });
            }
          }
        }
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error updating homepage section:", error);
      return NextResponse.json(
        { success: false, error: "Failed to update section" },
        { status: 500 }
      );
    }
  },
  "homepage",
  "edit"
);

export const DELETE = withPermission(
  async (_ctx, _request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await ctx.params;

      const existing = await db
        .select()
        .from(homepageSections)
        .where(eq(homepageSections.id, id))
        .limit(1);

      if (existing.length === 0) {
        return NextResponse.json(
          { success: false, error: "Section not found" },
          { status: 404 }
        );
      }

      // Delete image files referenced in the section content before DB delete.
      const section = existing[0];
      const imageUrls = extractImageUrls(section.type, section.content);
      if (imageUrls.length > 0) {
        await deleteImageFiles(imageUrls);
      }

      await db.delete(homepageSections).where(eq(homepageSections.id, id));

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting homepage section:", error);
      return NextResponse.json(
        { success: false, error: "Failed to delete section" },
        { status: 500 }
      );
    }
  },
  "homepage",
  "delete"
);