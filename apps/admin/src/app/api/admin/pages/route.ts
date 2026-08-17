import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { staticPages } from "@/db";
import { eq } from "drizzle-orm";
import { withPermission } from "@/lib/auth-guard";
import { createPageSchema } from "@/lib/static-pages";

// -----------------------------
// GET /api/admin/pages — list pages (HQ only)
// -----------------------------
export const GET = withPermission(async () => {
  try {
    const rows = await db
      .select({
        id: staticPages.id,
        slug: staticPages.slug,
        title: staticPages.title,
        content: staticPages.content,
        isPublished: staticPages.isPublished,
        displayOrder: staticPages.displayOrder,
        updatedAt: staticPages.updatedAt,
      })
      .from(staticPages)
      .orderBy(staticPages.displayOrder, staticPages.updatedAt);

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching static pages:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch pages" },
      { status: 500 }
    );
  }
}, "pages", "view");

// -----------------------------
// POST /api/admin/pages — create page (HQ only)
// Body: { slug, title, content, isPublished?, displayOrder? }
// -----------------------------


export const POST = withPermission(async (_ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = createPageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { slug, title, content, isPublished, displayOrder } = parsed.data;

    // Check slug uniqueness
    const existing = await db
      .select({ id: staticPages.id })
      .from(staticPages)
      .where(eq(staticPages.slug, slug))
      .limit(1);
    if (existing.length) {
      return NextResponse.json(
        { success: false, error: "Slug sudah digunakan." },
        { status: 409 }
      );
    }

    const id = crypto.randomUUID();
    await db.insert(staticPages).values({
      id,
      slug,
      title,
      content,
      isPublished,
      displayOrder,
    });

    return NextResponse.json({
      success: true,
      data: { id, slug, title, isPublished, displayOrder },
    });
  } catch (error) {
    console.error("Error creating static page:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create page" },
      { status: 500 }
    );
  }
}, "pages", "edit");
