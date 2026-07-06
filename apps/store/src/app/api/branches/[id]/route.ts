import { NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { eq } from "drizzle-orm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  } catch (error) {
    console.error("Error fetching branch:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch branch" },
      { status: 500 }
    );
  }
}