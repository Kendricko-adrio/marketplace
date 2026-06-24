import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { z } from "zod";
import { validatePickupSlot } from "@/lib/pickup-validation";

const validateStep2Schema = z.object({
  branchId: z.string(),
  pickupDate: z.string(), // YYYY-MM-DD
  pickupTime: z.string(), // HH:mm
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = validateStep2Schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const { branchId, pickupDate, pickupTime } = parsed.data;

    // Fetch the branch to get its operating hours
    const branch = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);

    if (branch.length === 0) {
      return NextResponse.json(
        { success: false, error: "Branch not found" },
        { status: 404 }
      );
    }

    if (branch[0].status !== "aktif") {
      return NextResponse.json(
        { success: false, error: "Branch is not available" },
        { status: 400 }
      );
    }

    const result = validatePickupSlot(
      branch[0].operatingHours,
      pickupDate,
      pickupTime
    );

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Pickup slot is valid",
    });
  } catch (error) {
    console.error("Error validating pickup step:", error);
    return NextResponse.json(
      { success: false, error: "Failed to validate pickup slot" },
      { status: 500 }
    );
  }
}