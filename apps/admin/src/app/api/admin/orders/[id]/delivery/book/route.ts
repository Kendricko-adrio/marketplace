import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-delivery-book");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Jubelio tidak
 * pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/**
 * Map a service outcome onto the SAME status/envelope as before. The failed
 * order id is a business identifier, so it travels in the `message`; the caught
 * value is never logged (it can carry provider body/URL text).
 */
function failure(
  error: unknown,
  orderId: string | null,
  event: string
): NextResponse {
  const order = orderId ?? "unknown";
  if (error instanceof ShipmentFulfillmentError) {
    log.warn(`${event} (order ${order}, code ${error.code}, outcome denied)`);
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
  log.error(
    `${event} (order ${order}, outcome error)`,
    new RouteLogError(event)
  );
  return NextResponse.json(
    { success: false, error: "Gagal memproses pemenuhan pengiriman." },
    { status: 500 }
  );
}

async function bookDelivery(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const guardResult = await guard("orders", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  let orderId: string | null = null;
  try {
    const { id } = await params;
    orderId = id;
    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = emptyBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      log.warn(
        `delivery book ditolak: body tidak valid (order ${id}, outcome denied)`
      );
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

    log.info(
      `delivery book sukses (order ${id}, shipment ${booked.shipmentId}, awb ${booked.awb}, outcome success)`
    );
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
    return failure(error, orderId, "delivery book gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(bookDelivery, "admin-order-delivery-book");
