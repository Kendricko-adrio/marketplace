import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { eq, and, asc, ilike } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("store-branches");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap tidak pernah masuk log; kontrak HTTP tetap sama.
 */
class BranchesListLogError extends Error {
  constructor() {
    super("store branches: gagal memuat daftar branch");
    this.name = "BranchesListLogError";
  }
}

async function listPublicBranches(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city");

    const rows = await db
      .select({
        id: branches.id,
        name: branches.name,
        code: branches.code,
        city: branches.city,
        address: branches.address,
        latitude: branches.latitude,
        longitude: branches.longitude,
        operatingHours: branches.operatingHours,
        googleMapsUrl: branches.googleMapsUrl,
        status: branches.status,
      })
      .from(branches)
      .where(
        city
          ? and(eq(branches.status, "aktif"), ilike(branches.city, `%${city}%`))
          : eq(branches.status, "aktif")
      )
      .orderBy(asc(branches.name));

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch {
    log.error(
      "Daftar branch publik gagal dimuat (outcome error)",
      new BranchesListLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch branches" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(listPublicBranches, "store-branches");
