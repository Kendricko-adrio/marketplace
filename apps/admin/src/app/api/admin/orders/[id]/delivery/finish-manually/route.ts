import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { serializeError } from "@/lib/logger";
import {
  createDeliveryFollowUp,
  DeliveryFollowUpError,
} from "@/lib/delivery-follow-up";

// POST /api/admin/orders/[id]/delivery/finish-manually   [orders:edit]
//
// "Selesaikan manual" — completes a booked delivery order whose shipment is
// RETURNED/SHIPMENT_ISSUE or whose physical handoff was recorded, with a
// MANDATORY non-blank reason; the order stays paid, gets NO pickup code, and
// the late callbacks can never reopen it (ticket 06's terminal rules). There
// is NO refund, no Sales-Order cancel, no stock adjustment and no automatic
// communication.
const bodySchema = z
  .object({
    reason: z.string().trim().min(1),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("orders", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;
  const orderLog = logger.child({ module: "delivery-finish-manual" });

  try {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      orderLog.warn("delivery.finish-manual.invalid_input", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Alasan selesai manual wajib diisi." },
        { status: 400 }
      );
    }

    const data = await createDeliveryFollowUp(db).finishManually(
      id,
      {
        id: ctx.user.id,
        homeBranchId: ctx.policy.user.homeBranchId ?? null,
        canEditOrders: true,
        policyVersion: ctx.policy.policyVersion,
      },
      parsed.data.reason
    );
    orderLog.info("delivery.finish-manual.success", { outcome: "success" });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof DeliveryFollowUpError) {
      orderLog.warn("delivery.finish-manual.failed", { outcome: "denied", code: error.code });
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 409 }
      );
    }
    orderLog.error("delivery.finish-manual.failed", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Gagal memproses pemenuhan pengiriman." },
      { status: 500 }
    );
  }
}