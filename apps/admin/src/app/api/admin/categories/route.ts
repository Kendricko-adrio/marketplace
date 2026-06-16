import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db";
import { eq } from "drizzle-orm";
import { withAuth } from "@/lib/auth-guard";

export const GET = withAuth(async () => {
  try {
    const allCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(categories.name);

    return NextResponse.json({ success: true, data: allCategories });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}, ["admin", "staff"]);
