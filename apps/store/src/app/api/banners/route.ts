import { NextResponse } from "next/server";
import { db } from "@/db";
import { banners } from "@/db";
import { eq, asc } from "drizzle-orm";

export async function GET() {
  try {
    const activeBanners = await db
      .select()
      .from(banners)
      .where(eq(banners.isActive, true))
      .orderBy(asc(banners.displayOrder));

    return NextResponse.json({
      success: true,
      data: activeBanners,
    });
  } catch (error) {
    console.error("Error fetching banners:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch banners" },
      { status: 500 }
    );
  }
}
