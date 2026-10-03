import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { serializeError } from "@/lib/logger";
import {
  createDeliveryFollowUp,
  DeliveryFollowUpError,
  PACKING_FAILURE_REASONS,
} from "@/lib/delivery-follow-up";

// POST /api/admin/orders/[id]/delivery/packing-failure   [orders:edit]
//
// "Tandai tidak dapat dipenuhi" — the reason Code is MANDATORY and must be
// one of the three spec codes; the order keeps processing/paid; the failure
// flag blocks the normal packing/booking/handoff CTAs and services. No
// refund/cancel-SO/communication happens here.
const bodySchema = z
  .object({
    reasonCode: z.enum(PACKING_FAILURE_REASONS),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("orders", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;
  const orderLog = logger.child({ module: "delivery-packing-failure" });

  try {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      orderLog.warn("delivery.packing-failure.invalid_input", { outcome: "denied" });
      return NextResponse.json(
        {
          success: false,
          error: "Alasan pemenuhan wajib dipilih dari alasan baku yang tersedia.",
        },
        { status: 400 }
      );
    }

    const data = await createDeliveryFollowUp(db).failPacking(
      id,
      {
        id: ctx.user.id,
        homeBranchId: ctx.policy.user.homeBranchId ?? null,
        canEditOrders: true,
        policyVersion: ctx.policy.policyVersion,
      },
      parsed.data.reasonCode
    );
    orderLog.info("delivery.packing-failure.success", { outcome: "success" });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof DeliveryFollowUpError) {
      orderLog.warn("delivery.packing-failure.failed", { outcome: "denied", code: error.code });
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 409 }
      );
    }
    orderLog.error("delivery.packing-failure.failed", {
      outcome: "error",
      error: serializeError(error),
    });
    return NextResponse.json(
      { success: false, error: "Gagal memproses pemenuhan pengiriman." },
      { status: 500 }
    );
  }
}