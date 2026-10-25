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

// POST /api/admin/orders/[id]/delivery/packing   [orders:edit]
//
// Marks a verified-paid delivery order as packed. The body is STRICTLY empty
// ({}): these endpoints take no input. The Home Branch must EXACTLY equal the
// order's branch (even for an all-branch editor); an unknown or cross-branch
// order id hides behind 404. The eligibility/claim/audit logic lives in
// shipment-fulfillment (orders-service seam) with its order-row lock.
const emptyBodySchema = z.object({}).strict();

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-delivery-packing");

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
          : // NOT_ELIGIBLE and BOOKING_AMBIGUOUS are both retriable-at-the-
            // surface refusals with no state damage.
            409;
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

async function packDelivery(
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
        `delivery packing ditolak: body tidak valid (order ${id}, outcome denied)`
      );
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

    log.info(`delivery packing sukses (order ${id}, outcome success)`);
    return NextResponse.json({ success: true });
  } catch (error) {
    return failure(error, orderId, "delivery packing gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  packDelivery,
  "admin-order-delivery-packing"
);
