import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-delivery-handoff");

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
 * Seam `createShipmentTracking` menerima logger bergaya `event + data` (paket
 * app-local `@marketplace/db`, di luar perubahan ini). Adapter di bawah
 * memproyeksikan HANYA nama event statis + `orderId` bisnis ke `message`;
 * tidak ada field bebas, raw error, atau payload provider yang diteruskan.
 */
function trackingLogMessage(event: string, data?: Record<string, unknown>): string {
  const orderId = data?.orderId;
  return typeof orderId === "string" ? `${event} (order ${orderId})` : event;
}

/** Map a tracking outcome onto the SAME status/envelope as before. */
function trackingFailure(
  error: unknown,
  orderId: string | null,
  event: string
): NextResponse {
  const order = orderId ?? "unknown";
  if (error instanceof ShipmentTrackingError) {
    log.warn(`${event} (order ${order}, code ${error.code}, outcome denied)`);
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
  log.error(
    `${event} (order ${order}, outcome error)`,
    new RouteLogError(event)
  );
  return NextResponse.json(
    { success: false, error: "Gagal memproses pemenuhan pengiriman." },
    { status: 500 }
  );
}

async function handoffDelivery(
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
        `delivery handoff ditolak: body tidak valid (order ${id}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const tracking = createShipmentTracking(db, createJubelioShipmentGateway(), {
      logger: {
        info: (event, data) =>
          log.info(`${trackingLogMessage(event, data)} (outcome success)`),
        error: (event, data) =>
          log.error(`${trackingLogMessage(event, data)} (outcome error)`),
      },
    });
    const handed = await tracking.handoff(id, {
      id: ctx.user.id,
      homeBranchId: ctx.policy.user.homeBranchId ?? null,
      canEditOrders: true,
      policyVersion: ctx.policy.policyVersion,
    });

    log.info(
      `delivery handoff sukses (order ${id}, alreadyStamped ${handed.status === "already_handed"}, outcome success)`
    );
    return NextResponse.json({ success: true, data: handed });
  } catch (error) {
    return trackingFailure(error, orderId, "delivery handoff gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  handoffDelivery,
  "admin-order-delivery-handoff"
);
