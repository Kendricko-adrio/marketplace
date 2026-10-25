import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db";
import { eq } from "drizzle-orm";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { z } from "zod";
import { validatePickupSlot } from "@/lib/pickup-validation";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis.
 */
const log = createModuleLogger("store-checkout-validate-step-2");

/**
 * Proyeksi teknis statis untuk jalur kegagalan tak terduga. Nilai yang
 * tertangkap tidak pernah masuk log; kontrak HTTP tetap sama.
 */
class ValidateStep2LogError extends Error {
  constructor() {
    super("checkout validate-step-2: gagal memvalidasi slot pickup");
    this.name = "ValidateStep2LogError";
  }
}

const validateStep2Schema = z.object({
  branchId: z.string(),
  pickupDate: z.string(), // YYYY-MM-DD
  pickupTime: z.string(), // HH:mm
});

async function validatePickupStep(request: NextRequest): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;

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
  } catch {
    log.error(
      "Validasi slot pickup gagal (outcome error)",
      new ValidateStep2LogError()
    );
    return NextResponse.json(
      { success: false, error: "Failed to validate pickup slot" },
      { status: 500 }
    );
  }
}

export const POST = withRequestContext(
  validatePickupStep,
  "store-checkout-validate-step-2"
);
