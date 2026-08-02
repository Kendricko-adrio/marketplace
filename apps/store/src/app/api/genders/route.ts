import { NextResponse } from "next/server";
import { db } from "@/db";
import { genders } from "@/db";
import { asc } from "drizzle-orm";

export async function GET() {
  try {
    const allGenders = await db
      .select({ id: genders.id, name: genders.name, slug: genders.slug })
      .from(genders)
      .orderBy(asc(genders.name));

    return NextResponse.json({
      success: true,
      data: allGenders,
    });
  } catch (error) {
    console.error("Error fetching genders:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch genders" },
      { status: 500 }
    );
  }
}