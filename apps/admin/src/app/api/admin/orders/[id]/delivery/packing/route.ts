import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { serializeError, type Logger } from "@/lib/logger";
import {
  createShipmentFulfillment,
  ShipmentFulfillmentError,
} from "@/lib/shipment-fulfillment";
import { createJubelioShipmentGateway } from "@/lib/jubelio-shipment-client";

// POST /api/admin/orders/[id]/delivery/packing   [orders:edit]
//
// Marks a verified-paid delivery order as packed. The body is STRICTLY empty
// ({}): these endpoints take no input. The Home Branch must EXACTLY equal the
// order's branch (even for an all-branch editor); an unknown or cross-branch
// order id hides behind 404. The eligibility/claim/audit logic lives in
// shipment-fulfillment (orders-service seam) with its order-row lock.
const emptyBodySchema = z.object({}).strict();

function failure(error: unknown, logger: Logger, event: string): NextResponse {
  if (error instanceof ShipmentFulfillmentError) {
    logger.warn(event, { outcome: "denied", code: error.code });
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "FORBIDDEN"
          ? 403
          : // NOT_ELIGIBLE and BOOKING_AMBIGUOUS are both retriable-at-the-
            // surface refusals with no state damage.
            409;
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
  const orderLog = logger.child({ module: "delivery-packing" });

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = emptyBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      orderLog.warn("delivery.packing.invalid_input", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const fulfillment = createShipmentFulfillment(db, createJubelioShipmentGateway());
    await fulfillment.pack(id, {
      id: ctx.user.id,
      homeBranchId: ctx.policy.user.homeBranchId ?? null,
      canEditOrders: true,
      policyVersion: ctx.policy.policyVersion,
    });

    orderLog.info("delivery.packing.success", { outcome: "success" });
    return NextResponse.json({ success: true });
  } catch (error) {
    return failure(error, orderLog, "delivery.packing.failed");
  }
}