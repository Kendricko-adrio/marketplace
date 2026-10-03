import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { serializeError } from "@/lib/logger";
import {
  BOOKING_RELEASE_PROOF_SOURCE,
  createDeliveryFollowUp,
  DeliveryFollowUpError,
} from "@/lib/delivery-follow-up";

// POST /api/admin/orders/[id]/delivery/release-booking   [orders:edit]
//
// "Lepas tahanan booking" — releases ONLY a settled `booking_unknown` ledger
// attempt after the AUTHORIZED HUMAN records Jubelio's explicit confirmation
// that the first operation is CLOSED and NO booking exists. The payload is
// the signed attestation (a mandatory reference/reason/the CURRENT attempt
// number/the two literal booleans) — never an automatic inference. The
// release archives the original dispatch into delivery_booking_reviews,
// keeps the attempt count monotonic, creates NO booking (the manual book is
// separate) and stays silent to the customer.
const bodySchema = z
  .object({
    proof: z
      .object({
        source: z.literal(BOOKING_RELEASE_PROOF_SOURCE),
        reference: z.string().trim().min(1),
        reason: z.string().trim().min(1),
        attemptNumber: z.number().int(),
        absenceConfirmed: z.literal(true),
        operationClosed: z.literal(true),
      })
      .strict(),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("orders", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;
  const orderLog = logger.child({ module: "delivery-release-booking" });

  try {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      orderLog.warn("delivery.release-booking.invalid_input", { outcome: "denied" });
      return NextResponse.json(
        {
          success: false,
          error:
            "Bukti rilis wajib: referensi konfirmasi Jubelio, alasan singkat, dan angka attempt yang saat ini berlaku.",
        },
        { status: 400 }
      );
    }

    const data = await createDeliveryFollowUp(db).releaseBooking(
      id,
      {
        id: ctx.user.id,
        homeBranchId: ctx.policy.user.homeBranchId ?? null,
        canEditOrders: true,
        policyVersion: ctx.policy.policyVersion,
      },
      parsed.data.proof
    );
    orderLog.info("delivery.release-booking.success", { outcome: "success" });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof DeliveryFollowUpError) {
      orderLog.warn("delivery.release-booking.failed", { outcome: "denied", code: error.code });
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 409 }
      );
    }
    orderLog.error("delivery.release-booking.failed", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Gagal memproses pemenuhan pengiriman." },
      { status: 500 }
    );
  }
}