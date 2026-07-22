import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  homepageSections,
  homepageSectionProducts,
  products,
} from "@/db";
import { asc, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { withPermission } from "@/lib/auth-guard";

export const GET = withPermission(async () => {
  try {
    const sections = await db
      .select()
      .from(homepageSections)
      .orderBy(asc(homepageSections.displayOrder));

    const carouselSectionIds = sections
      .filter((s) => s.type === "carousel_product")
      .map((s) => s.id);

    const productsBySection = new Map<
      string,
      { id: string; name: string; slug: string; displayOrder: number }[]
    >();

    if (carouselSectionIds.length > 0) {
      const junctionRows = await db
        .select()
        .from(homepageSectionProducts)
        .where(inArray(homepageSectionProducts.sectionId, carouselSectionIds))
        .orderBy(asc(homepageSectionProducts.displayOrder));

      const productIds = Array.from(
        new Set(junctionRows.map((r) => r.productId))
      );

      const productRows = productIds.length
        ? await db
            .select({ id: products.id, name: products.name, slug: products.slug })
            .from(products)
            .where(inArray(products.id, productIds))
        : [];

      const productNameMap = new Map(productRows.map((p) => [p.id, p]));

      for (const row of junctionRows) {
        const arr = productsBySection.get(row.sectionId) ?? [];
        const p = productNameMap.get(row.productId);
        arr.push({
          id: row.productId,
          name: p?.name ?? "",
          slug: p?.slug ?? "",
          displayOrder: row.displayOrder,
        });
        productsBySection.set(row.sectionId, arr);
      }
    }

    const data = sections.map((section) => {
      if (section.type === "carousel_product") {
        return { ...section, products: productsBySection.get(section.id) ?? [] };
      }
      if (section.type === "store_banner") {
        return { ...section };
      }
      return section;
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching homepage sections:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch homepage sections" },
      { status: 500 }
    );
  }
}, "homepage", "view");

// --- Zod schemas for content validation ---

const productFilterSchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(), // category slug
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

/**
 * Per-type content validator. Returns the validated content or throws a
 * ZodError-derived object the caller can pass back to the client.
 */
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

const createSectionSchema = z.object({
  type: z.enum([
    "banner",
    "carousel_product",
    "promo_cards",
    "announcement_bar",
    "store_banner",
  ]),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  content: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
  productIds: z.array(z.string()).optional(),
});

export const POST = withPermission(async (_ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = createSectionSchema.safeParse(body);

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
    const sectionId = crypto.randomUUID();

    // Validate content shape per-type. On failure, return a 400 with details.
    let validatedContent: unknown = data.content;
    try {
      validatedContent = validateContent(data.type, data.content);
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

    const maxOrderResult = await db
      .select()
      .from(homepageSections)
      .orderBy(desc(homepageSections.displayOrder))
      .limit(1);
    const nextOrder =
      maxOrderResult.length > 0 ? maxOrderResult[0].displayOrder + 1 : 1;

    await db.insert(homepageSections).values({
      id: sectionId,
      type: data.type,
      title: data.title ?? null,
      subtitle: data.subtitle ?? null,
      content: validatedContent,
      displayOrder: nextOrder,
      isActive: data.isActive,
    });

    if (data.type === "carousel_product" && data.productIds && data.productIds.length > 0) {
      // Only store junction rows when the carousel is in manual mode.
      const carouselContent = (validatedContent as { mode?: string }) ?? {};
      if (carouselContent.mode !== "filter") {
        for (let i = 0; i < data.productIds.length; i++) {
          await db.insert(homepageSectionProducts).values({
            sectionId,
            productId: data.productIds[i],
            displayOrder: i + 1,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { id: sectionId },
    });
  } catch (error) {
    console.error("Error creating homepage section:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create section" },
      { status: 500 }
    );
  }
}, "homepage", "edit");