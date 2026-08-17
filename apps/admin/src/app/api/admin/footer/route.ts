import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footerConfig } from "@/db";
import { eq } from "drizzle-orm";
import { withAuth } from "@/lib/auth-guard";
import { footerConfigSchema } from "@/lib/footer-config";

// -----------------------------
// GET /api/admin/footer — fetch footer config (HQ only)
// Returns the singleton row's `data` field, or null if no row exists.
// The client falls back to DEFAULT_FOOTER_CONFIG when data is null.
// -----------------------------
export const GET = withAuth(async () => {
  try {
    const rows = await db
      .select({
        id: footerConfig.id,
        data: footerConfig.data,
        updatedAt: footerConfig.updatedAt,
      })
      .from(footerConfig)
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ success: true, data: null });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Error fetching footer config:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch footer config" },
      { status: 500 }
    );
  }
}, ["hq"]);

// -----------------------------
// PUT /api/admin/footer — upsert footer config (HQ only)
// Body: FooterConfigData (validated by zod)
// -----------------------------


export const PUT = withAuth(async (ctx, request: NextRequest) => {
  try {
    const body = await request.json();
    const parsed = footerConfigSchema.safeParse(body);
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

    return NextResponse.json({ success: true, data: { id, data } });
  } catch (error) {
    console.error("Error saving footer config:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save footer config" },
      { status: 500 }
    );
  }
}, ["hq"]);
