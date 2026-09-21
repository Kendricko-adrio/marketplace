import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { staticPages } from "@/db";
import { eq, and, ne } from "drizzle-orm";
import { guard } from "@/lib/rbac/guard";
import { serializeError } from "@/lib/logger";
import { updatePageSchema } from "@/lib/static-pages";

// -----------------------------
// GET /api/admin/pages/[id] — single page [pages:view]
// -----------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("pages", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const { id } = await params;
    const rows = await db
      .select({
        id: staticPages.id,
        slug: staticPages.slug,
        title: staticPages.title,
        content: staticPages.content,
        isPublished: staticPages.isPublished,
        displayOrder: staticPages.displayOrder,
        createdAt: staticPages.createdAt,
        updatedAt: staticPages.updatedAt,
      })
      .from(staticPages)
      .where(eq(staticPages.id, id))
      .limit(1);

    if (!rows.length) {
      return NextResponse.json(
        { success: false, error: "Halaman tidak ditemukan." },
        { status: 404 }
      );
    }

    logger.info("pages.detail", { outcome: "success", pageId: id });
    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error("pages.detail.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to fetch page" },
      { status: 500 }
    );
  }
}

// -----------------------------
// PUT /api/admin/pages/[id] — update page [pages:edit]
// Body: { slug?, title?, content?, isPublished?, displayOrder? }
// -----------------------------
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("pages", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updatePageSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("pages.update.invalid_body", { outcome: "denied" });
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Verify the page exists
    const existing = await db
      .select({ id: staticPages.id })
      .from(staticPages)
      .where(eq(staticPages.id, id))
      .limit(1);
    if (!existing.length) {
      return NextResponse.json(
        { success: false, error: "Halaman tidak ditemukan." },
        { status: 404 }
      );
    }

    // If slug is being changed, ensure uniqueness (excluding self)
    if (data.slug) {
      const clash = await db
        .select({ id: staticPages.id })
        .from(staticPages)
        .where(and(eq(staticPages.slug, data.slug), ne(staticPages.id, id)))
        .limit(1);
      if (clash.length) {
        return NextResponse.json(
          { success: false, error: "Slug sudah digunakan." },
          { status: 409 }
        );
      }
    }

    await db
      .update(staticPages)
      .set({
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.isPublished !== undefined && { isPublished: data.isPublished }),
        ...(data.displayOrder !== undefined && {
          displayOrder: data.displayOrder,
        }),
        updatedAt: new Date(),
      })
      .where(eq(staticPages.id, id));

    logger.info("pages.update", { outcome: "success", pageId: id });
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    logger.error("pages.update.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to update page" },
      { status: 500 }
    );
  }
}

// -----------------------------
// DELETE /api/admin/pages/[id] — delete page [pages:delete]
// -----------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("pages", "delete", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const { id } = await params;
    const existing = await db
      .select({ id: staticPages.id })
      .from(staticPages)
      .where(eq(staticPages.id, id))
      .limit(1);
    if (!existing.length) {
      return NextResponse.json(
        { success: false, error: "Halaman tidak ditemukan." },
        { status: 404 }
      );
    }

    await db.delete(staticPages).where(eq(staticPages.id, id));

    logger.info("pages.delete", { outcome: "success", pageId: id });
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    logger.error("pages.delete.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to delete page" },
      { status: 500 }
    );
  }
}