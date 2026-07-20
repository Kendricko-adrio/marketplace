import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { footerConfig } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/auth-guard";

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
const footerConfigSchema = z.object({
  brandName: z.string().min(1, "Nama brand wajib diisi").max(100),
  tagline: z.string().max(300, "Tagline maksimal 300 karakter").default(""),
  copyrightText: z
    .string()
    .min(1, "Teks copyright wajib diisi")
    .max(200, "Copyright maksimal 200 karakter"),
  columns: z
    .array(
      z.object({
        title: z.string().min(1, "Judul kolom wajib diisi").max(100),
        links: z
          .array(
            z.object({
              label: z.string().min(1, "Label wajib diisi").max(100),
              href: z.string().min(1, "Link wajib diisi").max(500),
            })
          )
          .max(5, "Maksimal 5 link per kolom"),
      })
    )
    .max(3, "Maksimal 3 kolom")
    .default([]),
  socialMedia: z
    .array(
      z.object({
        platform: z.enum([
          "instagram",
          "facebook",
          "twitter",
          "tiktok",
          "youtube",
          "linkedin",
          "whatsapp",
        ]),
        url: z.string().max(500).default(""),
        enabled: z.boolean().default(false),
      })
    )
    .default([]),
});

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