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

// POST /api/admin/orders/[id]/delivery/book   [orders:edit]
//
// Books the packed delivery order at the provider with the STORED request
// (one atomic dispatch claim; one POST; an ambiguity is durable and refuses
// repeats). The response carries the AWB + the THREE cost figures (the billed
// stays null/`unknown` when the provider did not answer price_bill — never a
// fabricated 0). No physical handoff/completion happens in ticket 05.
const emptyBodySchema = z.object({}).strict();

function failure(error: unknown, logger: Logger, event: string): NextResponse {
  if (error instanceof ShipmentFulfillmentError) {
    logger.warn(event, { outcome: "denied", code: error.code });
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "FORBIDDEN"
          ? 403
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
  const orderLog = logger.child({ module: "delivery-book" });

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = emptyBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      orderLog.warn("delivery.book.invalid_input", { outcome: "denied" });
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const fulfillment = createShipmentFulfillment(db, createJubelioShipmentGateway());
    const booked = await fulfillment.book(id, {
      id: ctx.user.id,
      homeBranchId: ctx.policy.user.homeBranchId ?? null,
      canEditOrders: true,
      policyVersion: ctx.policy.policyVersion,
    });

    orderLog.info("delivery.book.success", { outcome: "success" });
    return NextResponse.json({
      success: true,
      data: {
        status: booked.status,
        awb: booked.awb,
        shipmentId: booked.shipmentId,
        trackingUrl: booked.trackingUrl,
        quoteRates: booked.quoteRates,
        bookingPrice: booked.bookingPrice,
        billedPrice: booked.billedPrice,
      },
    });
  } catch (error) {
    return failure(error, orderLog, "delivery.book.failed");
  }
}