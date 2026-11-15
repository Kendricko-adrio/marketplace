import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { staticPages } from "@/db";
import { eq, and, ne } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { updatePageSchema } from "@/lib/static-pages";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-page-detail");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class PageDetailLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageDetailLogError";
  }
}

type RouteContext = { params: Promise<{ id: string }> };

// -----------------------------
// GET /api/admin/pages/[id] — single page [pages:view]
// -----------------------------
async function pageDetail(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("pages", "view");
  if (!guardResult.ok) return guardResult.response;

  let pageId: string | null = null;
  try {
    const { id } = await params;
    pageId = id;
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
      log.warn(
        `pages.detail ditolak: halaman tidak ditemukan (pageId ${id}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Halaman tidak ditemukan." },
        { status: 404 }
      );
    }

    log.info(`pages.detail (pageId ${id}, outcome success)`);
    return NextResponse.json({ success: true, data: rows[0] });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      `pages.detail gagal (pageId ${pageId ?? "unknown"}, outcome error)`,
      new PageDetailLogError("pages detail gagal")
    );
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
async function updatePage(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("pages", "edit");
  if (!guardResult.ok) return guardResult.response;

  let pageId: string | null = null;
  try {
    const { id } = await params;
    pageId = id;
    const body = await request.json();
    const parsed = updatePageSchema.safeParse(body);
    if (!parsed.success) {
      log.warn(
        `pages.update ditolak: body tidak valid (pageId ${id}, outcome denied)`
      );
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
      log.warn(
        `pages.update ditolak: halaman tidak ditemukan (pageId ${id}, outcome denied)`
      );
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
        log.warn(
          `pages.update ditolak: slug sudah digunakan (pageId ${id}, outcome denied)`
        );
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

    log.info(`pages.update (pageId ${id}, outcome success)`);
    return NextResponse.json({ success: true, data: { id } });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      `pages.update gagal (pageId ${pageId ?? "unknown"}, outcome error)`,
      new PageDetailLogError("pages update gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to update page" },
      { status: 500 }
    );
  }
}

// -----------------------------
// DELETE /api/admin/pages/[id] — delete page [pages:delete]
// -----------------------------
async function deletePage(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("pages", "delete");
  if (!guardResult.ok) return guardResult.response;

  let pageId: string | null = null;
  try {
    const { id } = await params;
    pageId = id;
    const existing = await db
      .select({ id: staticPages.id })
      .from(staticPages)
      .where(eq(staticPages.id, id))
      .limit(1);
    if (!existing.length) {
      log.warn(
        `pages.delete ditolak: halaman tidak ditemukan (pageId ${id}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Halaman tidak ditemukan." },
        { status: 404 }
      );
    }

    await db.delete(staticPages).where(eq(staticPages.id, id));

    log.info(`pages.delete (pageId ${id}, outcome success)`);
    return NextResponse.json({ success: true, data: { id } });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      `pages.delete gagal (pageId ${pageId ?? "unknown"}, outcome error)`,
      new PageDetailLogError("pages delete gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to delete page" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(pageDetail, "admin-page-detail");
export const PUT = withRequestContext(updatePage, "admin-page-detail");
export const DELETE = withRequestContext(deletePage, "admin-page-detail");
