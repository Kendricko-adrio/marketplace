import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footerConfig } from "@/db";
import { eq } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { guard } from "@/lib/rbac/guard";
import { footerConfigSchema } from "@/lib/footer-config";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-footer");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/driver tidak
 * pernah masuk log.
 */
class FooterLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FooterLogError";
  }
}

// -----------------------------
// GET /api/admin/footer — fetch footer config [footer:view]
// Returns the singleton row's `data` field, or null if no row exists.
// The client falls back to DEFAULT_FOOTER_CONFIG when data is null.
// -----------------------------
async function getFooterConfig(_request: NextRequest): Promise<Response> {
  const guardResult = await guard("footer", "view");
  if (!guardResult.ok) return guardResult.response;

  try {
    const rows = await db
      .select({
        id: footerConfig.id,
        data: footerConfig.data,
        updatedAt: footerConfig.updatedAt,
      })
      .from(footerConfig)
      .limit(1);

    log.info(`footer.get (hasConfig ${rows.length > 0}, outcome success)`);
    return NextResponse.json({ success: true, data: rows[0] ?? null });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      "footer.get gagal (outcome error)",
      new FooterLogError("footer get gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch footer config" },
      { status: 500 }
    );
  }
}

// -----------------------------
// PUT /api/admin/footer — upsert footer config [footer:edit]
// Body: FooterConfigData (validated by zod)
// -----------------------------
async function saveFooterConfig(request: NextRequest): Promise<Response> {
  const guardResult = await guard("footer", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const body = await request.json();
    const parsed = footerConfigSchema.safeParse(body);
    if (!parsed.success) {
      log.warn("footer.update ditolak: body tidak valid (outcome denied)");
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

    // Upsert: there is at most one row. If it exists, update; else insert.
    const existing = await db
      .select({ id: footerConfig.id })
      .from(footerConfig)
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(footerConfig)
        .set({
          data,
          updatedAt: new Date(),
          updatedBy: ctx.user.id,
        })
        .where(eq(footerConfig.id, existing[0].id));

      log.info(
        `footer.update (footerConfigId ${existing[0].id}, actingUserId ${ctx.user.id}, outcome success)`
      );
      return NextResponse.json({
        success: true,
        data: { id: existing[0].id, data },
      });
    }

    const id = crypto.randomUUID();
    await db.insert(footerConfig).values({
      id,
      data,
      updatedBy: ctx.user.id,
    });

    log.info(
      `footer.create (footerConfigId ${id}, actingUserId ${ctx.user.id}, outcome success)`
    );
    return NextResponse.json({ success: true, data: { id, data } });
  } catch {
    // Nilai yang tertangkap tidak pernah masuk log: bisa memuat SQL/nilai baris.
    log.error(
      "footer.update gagal (outcome error)",
      new FooterLogError("footer update gagal")
    );
    return NextResponse.json(
      { success: false, error: "Failed to save footer config" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(getFooterConfig, "admin-footer");
export const PUT = withRequestContext(saveFooterConfig, "admin-footer");
