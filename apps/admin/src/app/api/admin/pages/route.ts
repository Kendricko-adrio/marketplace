import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { staticPages } from "@/db";
import { eq } from "drizzle-orm";
import { withPermission } from "@/lib/rbac/route-guards";
import { createPageSchema } from "@/lib/static-pages";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-pages");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap (kemungkinan memuat SQL) tidak pernah masuk log; kontrak HTTP
 * tetap sama.
 */
class PagesLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PagesLogError";
  }
}

// -----------------------------
// GET /api/admin/pages — list pages (HQ only)
// -----------------------------
async function listPages(): Promise<Response> {
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
  } catch {
    log.error(
      "Daftar static page gagal dimuat (outcome error)",
      new PagesLogError("admin pages: gagal memuat daftar page")
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch pages" },
      { status: 500 }
    );
  }
}

// -----------------------------
// POST /api/admin/pages — create page (HQ only)
// Body: { slug, title, content, isPublished?, displayOrder? }
// -----------------------------
async function createPage(
  _ctx: unknown,
  request: NextRequest
): Promise<Response> {
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
  } catch {
    log.error(
      "Static page gagal dibuat (outcome error)",
      new PagesLogError("admin pages: gagal membuat page")
    );
    return NextResponse.json(
      { success: false, error: "Failed to create page" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(
  withPermission(listPages, "pages", "view"),
  "admin-pages"
);
export const POST = withRequestContext(
  withPermission(createPage, "pages", "edit"),
  "admin-pages"
);
