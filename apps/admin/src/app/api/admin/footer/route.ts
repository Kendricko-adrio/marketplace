import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footerConfig } from "@/db";
import { eq } from "drizzle-orm";
import { guard } from "@/lib/rbac/guard";
import { serializeError } from "@/lib/logger";
import { footerConfigSchema } from "@/lib/footer-config";

// -----------------------------
// GET /api/admin/footer — fetch footer config [footer:view]
// Returns the singleton row's `data` field, or null if no row exists.
// The client falls back to DEFAULT_FOOTER_CONFIG when data is null.
// -----------------------------
export async function GET(request: NextRequest) {
  const guardResult = await guard("footer", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger } = guardResult;

  try {
    const rows = await db
      .select({
        id: footerConfig.id,
        data: footerConfig.data,
        updatedAt: footerConfig.updatedAt,
      })
      .from(footerConfig)
      .limit(1);

    logger.info("footer.get", { outcome: "success" });
    return NextResponse.json({ success: true, data: rows[0] ?? null });
  } catch (error) {
    logger.error("footer.get.failure", {
      outcome: "error",
      error: serializeError(error),
    });
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
export async function PUT(request: NextRequest) {
  const guardResult = await guard("footer", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const body = await request.json();
    const parsed = footerConfigSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn("footer.update.invalid_body", { outcome: "denied" });
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

      logger.info("footer.update", {
        outcome: "success",
        footerConfigId: existing[0].id,
        userId: ctx.user.id,
      });
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

    logger.info("footer.create", {
      outcome: "success",
      footerConfigId: id,
      userId: ctx.user.id,
    });
    return NextResponse.json({ success: true, data: { id, data } });
  } catch (error) {
    logger.error("footer.update.failure", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Failed to save footer config" },
      { status: 500 }
    );
  }
}