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

// POST /api/admin/orders/[id]/delivery/reconcile   [orders:edit]
//
// Reactive GET-ONLY reconciliation of the KNOWN AWB (one GET, outside any
// transaction; the returned shipment_id/awb/ref_no must match the order before
// anything is applied). No polling cron exists; this is the manual button's
// endpoint (plus the customer-visible display refresh).
const emptyBodySchema = z.object({}).strict();

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-delivery-reconcile");

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

async function reconcileDelivery(
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
        `delivery reconcile ditolak: body tidak valid (order ${id}, outcome denied)`
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
    const reconciled = await tracking.reconcile(id, {
      id: ctx.user.id,
      homeBranchId: ctx.policy.user.homeBranchId ?? null,
      canEditOrders: true,
      policyVersion: ctx.policy.policyVersion,
    });

    log.info(
      `delivery reconcile sukses (order ${id}, appliedStatus ${reconciled.latestStatus}, outcome success)`
    );
    return NextResponse.json({ success: true, data: reconciled });
  } catch (error) {
    return trackingFailure(error, orderId, "delivery reconcile gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  reconcileDelivery,
  "admin-order-delivery-reconcile"
);
