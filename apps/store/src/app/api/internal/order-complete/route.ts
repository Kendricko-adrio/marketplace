import { after, NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import crypto from "crypto";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { reconcileJubelioChannelStatusForOrder } from "@/lib/jubelio-channel-mirror";
import { completePickupOrder } from "@/features/orders/complete-pickup-service";

// Internal endpoint called by the admin app to mark a pickup order as
// completed and to commit its communication fact (Email #2 is produced from
// that fact for communication-version-1 orders). Guarded by an HMAC secret
// derived from BETTER_AUTH_SECRET so only the admin app (which shares the
// secret) can call it. This file stays an HTTP/HMAC adapter: no query and no
// business rule lives here.

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("order-complete");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/SMTP/
 * provider tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

function computeExpectedSecret(orderId: string): string {
  const authSecret = process.env.BETTER_AUTH_SECRET;
  if (!authSecret) return "";
  return crypto
    .createHmac("sha256", authSecret)
    .update(orderId)
    .digest("hex");
}

/** HTTP adapter internal: verifikasi HMAC, jalankan service, jadwalkan mirror. */
async function completeOrder(request: NextRequest): Promise<Response> {
  let orderId: string | undefined;
  try {
    const body = await request.json();
    orderId = body.orderId;
    const { secret } = body;

    if (!orderId) {
      log.warn("missing orderId");
      return NextResponse.json(
        { success: false, error: "orderId is required" },
        { status: 400 }
      );
    }
    const completedOrderId = orderId;

    // Verify the shared secret
    const expectedSecret = computeExpectedSecret(orderId);
    if (!expectedSecret || secret !== expectedSecret) {
      // `orderId` belum terverifikasi di titik ini (input klien): tidak masuk log.
      log.error("invalid shared secret — unauthorized");
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 403 }
      );
    }

    const outcome = await completePickupOrder({ orderId });

    if (outcome.status === "not_found") {
      log.error(`Order ${orderId}: order not found`);
      return NextResponse.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }
    if (outcome.status === "not_ready") {
      log.warn(
        `Order ${orderId}: order not in ready_for_pickup (status ${outcome.orderStatus})`
      );
      return NextResponse.json(
        {
          success: false,
          error: `Order must be ready_for_pickup (current: ${outcome.orderStatus})`,
        },
        { status: 400 }
      );
    }

    log.info(`Order ${orderId}: order completed`);

    // Ticket #06 — best-effort channel mirror trigger, scheduled via `after()`
    // so the admin's pickup-verification request never waits on the Jubelio
    // edit. The `Selesai` projection is derived from the COMMITTED local
    // state — never from the verification-code success or the store->admin
    // HTTP outcome alone. A mirror failure cannot undo the completion.
    after(async () => {
      try {
        const mirror = await reconcileJubelioChannelStatusForOrder(db, {
          orderId: completedOrderId,
        });
        log.info(
          `Order ${completedOrderId}: channel-status mirror reconciled after completion (outcome ${mirror.status})`
        );
      } catch {
        log.error(
          `Order ${completedOrderId}: channel-status mirror reconciliation failed after completion`,
          new RouteLogError("channel-status mirror reconciliation failed")
        );
      }
    });

    return NextResponse.json({
      success: true,
      completedAt: outcome.completedAt.toISOString(),
    });
  } catch {
    log.error(
      `complete order failed (order ${orderId ?? "tidak diketahui"})`,
      new RouteLogError("complete order failed")
    );
    return NextResponse.json(
      { success: false, error: "Failed to complete order" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(completeOrder, "order-complete");
