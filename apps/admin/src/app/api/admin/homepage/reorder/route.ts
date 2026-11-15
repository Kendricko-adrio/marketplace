import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { homepageSections } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPermission } from "@/lib/rbac/route-guards";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-homepage-reorder");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap (kemungkinan memuat SQL) tidak pernah masuk log; kontrak HTTP
 * tetap sama.
 */
class HomepageReorderLogError extends Error {
  constructor() {
    super("admin homepage reorder: gagal menyimpan urutan section");
    this.name = "HomepageReorderLogError";
  }
}

const reorderSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      displayOrder: z.number(),
    })
  ),
});

async function reorderSections(
  _ctx: unknown,
  request: NextRequest
): Promise<Response> {
  try {
    const body = await request.json();
    const parsed = reorderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parsed.error,
        },
        { status: 400 }
      );
    }

    const { items } = parsed.data;

    for (const item of items) {
      await db
        .update(homepageSections)
        .set({ displayOrder: item.displayOrder, updatedAt: new Date() })
        .where(eq(homepageSections.id, item.id));
    }

    return NextResponse.json({ success: true });
  } catch {
    log.error(
      "Urutan section homepage gagal disimpan (outcome error)",
      new HomepageReorderLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to reorder sections" },
      { status: 500 }
    );
  }
}

export const PATCH = withRequestContext(
  withPermission(reorderSections, "homepage", "edit"),
  "admin-homepage-reorder"
);
