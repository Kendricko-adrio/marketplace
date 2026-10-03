import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { createLogger, serializeError } from "@/lib/logger";
import {
  createShipmentTracking,
  ShipmentTrackingError,
} from "@marketplace/db/src/shipment-tracking";
import { createJubelioShipmentGateway } from "@/lib/jubelio-shipment-client";

// POST /api/admin/orders/[id]/delivery/handoff   [orders:edit]
//
// Records the PHYSICAL serah-terima of the packed/ booked delivery shipment
// (ticket 06). The body is STRICTLY empty; the Home Branch must EXACTLY equal
// the order's CURRENT DB branch — even for an all-branch editor/owner. NO
// provider POST happens here and the order is NOT completed (an AWB is not a
// handoff; only tracking's DELIVERED completes). Idempotent stamp.
const emptyBodySchema = z.object({}).strict();

function trackingFailure(error: unknown, logger: ReturnType<typeof createLogger>, event: string): NextResponse {
  if (error instanceof ShipmentTrackingError) {
    logger.warn(event, { outcome: "denied", code: error.code });
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "FORBIDDEN"
          ? 403
          : error.code === "INVALID_SIGNATURE"
            ? 401
            : 409; // NOT_ELIGIBLE / SHIPMENT_* surface as refusals
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status }
    );
  }
  logger.error(event, { outcome: "error", error: serializeError(error) });
  return NextResponse.json(
    { success: false, error: "Gagal memproses pemenuhan pengiriman." },
    { status: 500 }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("orders", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;
  const orderLog = logger.child({ module: "delivery-handoff" });

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = emptyBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      orderLog.warn("delivery.handoff.invalid_input", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const tracking = createShipmentTracking(db, createJubelioShipmentGateway(), {
      logger: {
        info: (event, data) => orderLog.info(event, data ?? {}),
        error: (event, data) => orderLog.error(event, data ?? {}),
      },
    });
    const handed = await tracking.handoff(id, {
      id: ctx.user.id,
      homeBranchId: ctx.policy.user.homeBranchId ?? null,
      canEditOrders: true,
      policyVersion: ctx.policy.policyVersion,
    });

    orderLog.info("delivery.handoff.success", {
      outcome: "success",
      alreadyStamped: handed.status === "already_handed",
    });
    return NextResponse.json({ success: true, data: handed });
  } catch (error) {
    return trackingFailure(error, orderLog, "delivery.handoff.failed");
  }
}