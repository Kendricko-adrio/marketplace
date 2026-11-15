import { NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db";
import { withPermission } from "@/lib/rbac/route-guards";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("admin-brands");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap (kemungkinan memuat SQL) tidak pernah masuk log; kontrak HTTP
 * tetap sama.
 */
class BrandsListLogError extends Error {
  constructor() {
    super("admin brands: gagal memuat daftar brand");
    this.name = "BrandsListLogError";
  }
}

async function listBrands(): Promise<Response> {
  try {
    const allBrands = await db
      .select({ id: brands.id, name: brands.name, slug: brands.slug })
      .from(brands)
      .orderBy(brands.name);

    return NextResponse.json({ success: true, data: allBrands });
  } catch {
    log.error("Daftar brand gagal dimuat (outcome error)", new BrandsListLogError());
    return NextResponse.json(
      { success: false, error: "Failed to fetch brands" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(
  withPermission(listBrands, "products", "view"),
  "admin-brands"
);
