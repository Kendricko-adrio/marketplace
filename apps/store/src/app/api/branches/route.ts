import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { eq, and, asc, ilike } from "drizzle-orm";

export async function GET(request: NextRequest) {
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
  } catch (error) {
    console.error("Error fetching public branches:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch branches" },
      { status: 500 }
    );
  }
}