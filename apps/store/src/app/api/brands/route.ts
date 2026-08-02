import { NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db";
import { asc } from "drizzle-orm";

export async function GET() {
  try {
    const allBrands = await db
      .select({ id: brands.id, name: brands.name, slug: brands.slug })
      .from(brands)
      .orderBy(asc(brands.name));

    return NextResponse.json({
      success: true,
      data: allBrands,
    });
  } catch (error) {
    console.error("Error fetching brands:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch brands" },
      { status: 500 }
    );
  }
}