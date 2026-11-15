import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  homepageSections,
  homepageSectionProducts,
  products,
} from "@/db";
import { eq, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { deleteFile } from "@/lib/uploads";
import { validateContent } from "@/lib/homepage-content";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-homepage-section");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/filesystem
 * tidak pernah masuk log.
 */
class HomepageSectionLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HomepageSectionLogError";
  }
}

type RouteContext = { params: Promise<{ id: string }> };

// =========================================================
// RBAC: global Homepage module — GET homepage:view, PATCH
// homepage:edit, DELETE homepage:delete (Current Policy).
// =========================================================
async function sectionDetail(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("homepage", "view");
  if (!guardResult.ok) return guardResult.response;

  let sectionId: string | null = null;
  try {
    const { id } = await params;
    sectionId = id;

    const sectionRows = await db
      .select()
      .from(homepageSections)
      .where(eq(homepageSections.id, id))
      .limit(1);

    if (sectionRows.length === 0) {
      log.warn(
        `homepage.detail ditolak: section tidak ditemukan (sectionId ${id}, outcome denied)`
      );
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

    log.info(`homepage.detail (sectionId ${id}, outcome success)`);
    return NextResponse.json({
      success: true,
      data: { ...section, products: linkedProducts },
    });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      `homepage.detail gagal (sectionId ${sectionId ?? "unknown"}, outcome error)`,
      new HomepageSectionLogError("homepage detail gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch section" },
      { status: 500 }
    );
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
 *
 * Pesan asli dari filesystem tidak pernah masuk log; yang dicatat hanya path
 * aset internal dan proyeksi statis.
 */
async function deleteImageFiles(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await deleteFile(url);
    } catch {
      log.error(
        `homepage.cleanup_image gagal (assetPath ${url}, outcome error)`,
        new HomepageSectionLogError("hapus file gambar section gagal")
      );
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

async function updateSection(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("homepage", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx: policyCtx } = guardResult;

  let sectionId: string | null = null;
  try {
    const { id } = await params;
    sectionId = id;

    const existing = await db
      .select()
      .from(homepageSections)
      .where(eq(homepageSections.id, id))
      .limit(1);

    if (existing.length === 0) {
      log.warn(
        `homepage.update ditolak: section tidak ditemukan (sectionId ${id}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Section not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const parsed = updateSectionSchema.safeParse(body);

    if (!parsed.success) {
      log.warn(
        `homepage.update ditolak: body tidak valid (sectionId ${id}, outcome denied)`
      );
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
        log.warn(
          `homepage.update ditolak: content tidak sesuai tipe section (sectionId ${id}, sectionType ${effectiveType}, outcome denied)`
        );
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

    log.info(
      `homepage.update (sectionId ${id}, actingUserId ${policyCtx.user.id}, outcome success)`
    );
    return NextResponse.json({ success: true });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      `homepage.update gagal (sectionId ${sectionId ?? "unknown"}, outcome error)`,
      new HomepageSectionLogError("homepage update gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to update section" },
      { status: 500 }
    );
  }
}

async function removeSection(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("homepage", "delete");
  if (!guardResult.ok) return guardResult.response;
  const { ctx: policyCtx } = guardResult;

  let sectionId: string | null = null;
  try {
    const { id } = await params;
    sectionId = id;

    const existing = await db
      .select()
      .from(homepageSections)
      .where(eq(homepageSections.id, id))
      .limit(1);

    if (existing.length === 0) {
      log.warn(
        `homepage.delete ditolak: section tidak ditemukan (sectionId ${id}, outcome denied)`
      );
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

    log.info(
      `homepage.delete (sectionId ${id}, actingUserId ${policyCtx.user.id}, outcome success)`
    );
    return NextResponse.json({ success: true });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      `homepage.delete gagal (sectionId ${sectionId ?? "unknown"}, outcome error)`,
      new HomepageSectionLogError("homepage delete gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to delete section" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(sectionDetail, "admin-homepage-section");
export const PATCH = withRequestContext(updateSection, "admin-homepage-section");
export const DELETE = withRequestContext(removeSection, "admin-homepage-section");
