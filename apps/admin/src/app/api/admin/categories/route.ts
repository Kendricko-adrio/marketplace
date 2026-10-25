import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db";
import { eq } from "drizzle-orm";
import { withPermission } from "@/lib/rbac/route-guards";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-categories");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap (kemungkinan memuat SQL) tidak pernah masuk log; kontrak HTTP
 * tetap sama.
 */
class CategoriesListLogError extends Error {
  constructor() {
    super("admin categories: gagal memuat daftar kategori");
    this.name = "CategoriesListLogError";
  }
}

async function listCategories(): Promise<Response> {
  try {
    const allCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(categories.name);

    return NextResponse.json({ success: true, data: allCategories });
  } catch {
    log.error(
      "Daftar kategori gagal dimuat (outcome error)",
      new CategoriesListLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(
  withPermission(listCategories, "products", "view"),
  "admin-categories"
);
