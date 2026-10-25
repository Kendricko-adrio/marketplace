import { NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { eq } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("store-branch");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap tidak pernah masuk log; kontrak HTTP tetap sama.
 */
class BranchDetailLogError extends Error {
  constructor() {
    super("store branch: gagal memuat detail branch");
    this.name = "BranchDetailLogError";
  }
}

async function getBranch(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params;

    const branch = await db
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
      .where(eq(branches.id, id))
      .limit(1);

    if (branch.length === 0) {
      return NextResponse.json(
        { success: false, error: "Branch not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: branch[0],
    });
  } catch {
    log.error(
      "Detail branch gagal dimuat (outcome error)",
      new BranchDetailLogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to fetch branch" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(getBranch, "store-branch");
