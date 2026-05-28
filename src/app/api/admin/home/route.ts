import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { homepageSections } from "@/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(async () => {
  try {
    const sections = await db
      .select()
      .from(homepageSections)
      .orderBy(asc(homepageSections.displayOrder));

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(homepageSections);
    const total = Number(countResult[0]?.count || 0);

    const activeCount = sections.filter((s) => s.isActive).length;

    return NextResponse.json({
      success: true,
      data: sections,
      meta: { total, active: activeCount, inactive: total - activeCount },
    });
  } catch (error) {
    console.error("Error fetching admin homepage sections:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch sections" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);

const sectionTypes = [
  "banner",
  "carousel_product",
  "category_grid",
  "promo_cards",
  "countdown_flash_sale",
  "image_text_block",
  "announcement_bar",
  "product_grid",
  "brand_strip",
  "video_embed",
] as const;

const createSectionSchema = z.object({
  type: z.enum(sectionTypes),
  title: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
});

export const POST = withAuth(async (_ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = createSectionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parsed.error },
        { status: 400 }
      );
    }

    const { type, title, config } = parsed.data;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(homepageSections);
    const displayOrder = Number(countResult[0]?.count || 0);

    const id = crypto.randomUUID();
    await db.insert(homepageSections).values({
      id,
      type,
      title,
      displayOrder,
      config,
      isActive: true,
    });

    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    console.error("Error creating section:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create section" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);

const reorderSchema = z.array(
  z.object({
    id: z.string(),
    displayOrder: z.number().int(),
  })
);

export const PUT = withAuth(async (_ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = reorderSchema.safeParse(body.sections);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parsed.error },
        { status: 400 }
      );
    }

    for (const item of parsed.data) {
      await db
        .update(homepageSections)
        .set({ displayOrder: item.displayOrder, updatedAt: new Date() })
        .where(eq(homepageSections.id, item.id));
    }

    return NextResponse.json({
      success: true,
      data: { updated: parsed.data.length },
    });
  } catch (error) {
    console.error("Error reordering sections:", error);
    return NextResponse.json(
      { success: false, error: "Failed to reorder sections" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);
