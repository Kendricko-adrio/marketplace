import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { staticPages } from "@/db";
import { eq, and, ne } from "drizzle-orm";
import { z } from "zod";
import { withPermission } from "@/lib/auth-guard";

// -----------------------------
// GET /api/admin/pages/[id] — single page (HQ only)
// -----------------------------
export const GET = withPermission(
  async (
    _ctx,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    void _request;
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

      return NextResponse.json({ success: true, data: rows[0] });
    } catch (error) {
      console.error("Error fetching static page:", error);
      return NextResponse.json(
        { success: false, error: "Failed to fetch page" },
        { status: 500 }
      );
    }
  },
  "pages",
  "view"
);

// -----------------------------
// PUT /api/admin/pages/[id] — update page (HQ only)
// Body: { slug?, title?, content?, isPublished?, displayOrder? }
// -----------------------------
const updatePageSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  isPublished: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const PUT = withPermission(
  async (
    _ctx,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const parsed = updatePageSchema.safeParse(body);
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

      return NextResponse.json({ success: true, data: { id } });
    } catch (error) {
      console.error("Error updating static page:", error);
      return NextResponse.json(
        { success: false, error: "Failed to update page" },
        { status: 500 }
      );
    }
  },
  "pages",
  "edit"
);

// -----------------------------
// DELETE /api/admin/pages/[id] — delete page (HQ only)
// -----------------------------
export const DELETE = withPermission(
  async (
    _ctx,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    void _request;
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

      return NextResponse.json({ success: true, data: { id } });
    } catch (error) {
      console.error("Error deleting static page:", error);
      return NextResponse.json(
        { success: false, error: "Failed to delete page" },
        { status: 500 }
      );
    }
  },
  "pages",
  "delete"
);