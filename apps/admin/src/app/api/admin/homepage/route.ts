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
import { validateContent } from "@/lib/homepage-content";

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