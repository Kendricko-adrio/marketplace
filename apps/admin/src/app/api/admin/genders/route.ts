import { NextResponse } from "next/server";
import { db } from "@/db";
import { genders } from "@/db";
import { withPermission } from "@/lib/auth-guard";

export const GET = withPermission(async () => {
  try {
    const allGenders = await db
      .select({ id: genders.id, name: genders.name, slug: genders.slug })
      .from(genders)
      .orderBy(genders.name);

    return NextResponse.json({ success: true, data: allGenders });
  } catch (error) {
    console.error("Error fetching genders:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch genders" },
      { status: 500 }
    );
  }
}, "products", "view");