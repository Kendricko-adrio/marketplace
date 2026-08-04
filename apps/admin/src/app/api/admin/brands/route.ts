import { NextResponse } from "next/server";
import { db } from "@/db";
import { brands } from "@/db";
import { withPermission } from "@/lib/auth-guard";

export const GET = withPermission(async () => {
  try {
    const allBrands = await db
      .select({ id: brands.id, name: brands.name, slug: brands.slug })
      .from(brands)
      .orderBy(brands.name);

    return NextResponse.json({ success: true, data: allBrands });
  } catch (error) {
    console.error("Error fetching brands:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch brands" },
      { status: 500 }
    );
  }
}, "products", "view");