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

// POST /api/admin/orders/[id]/delivery/reconcile   [orders:edit]
//
// Reactive GET-ONLY reconciliation of the KNOWN AWB (one GET, outside any
// transaction; the returned shipment_id/awb/ref_no must match the order before
// anything is applied). No polling cron exists; this is the manual button's
// endpoint (plus the customer-visible display refresh).
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
            : 409;
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
  const orderLog = logger.child({ module: "delivery-reconcile" });

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = emptyBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      orderLog.warn("delivery.reconcile.invalid_input", { outcome: "denied" });
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
    const reconciled = await tracking.reconcile(id, {
      id: ctx.user.id,
      homeBranchId: ctx.policy.user.homeBranchId ?? null,
      canEditOrders: true,
      policyVersion: ctx.policy.policyVersion,
    });

    orderLog.info("delivery.reconcile.success", {
      outcome: "success",
      appliedStatus: reconciled.latestStatus,
    });
    return NextResponse.json({ success: true, data: reconciled });
  } catch (error) {
    return trackingFailure(error, orderLog, "delivery.reconcile.failed");
  }
}