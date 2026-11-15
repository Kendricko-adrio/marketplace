import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  createDeliveryFollowUp,
  DeliveryFollowUpError,
} from "@/lib/delivery-follow-up";

// POST /api/admin/orders/[id]/delivery/finish-manually   [orders:edit]
//
// "Selesaikan manual" — completes a booked delivery order whose shipment is
// RETURNED/SHIPMENT_ISSUE or whose physical handoff was recorded, with a
// MANDATORY non-blank reason; the order stays paid, gets NO pickup code, and
// the late callbacks can never reopen it (ticket 06's terminal rules). There
// is NO refund, no Sales-Order cancel, no stock adjustment and no automatic
// communication.
const bodySchema = z
  .object({
    reason: z.string().trim().min(1),
  })
  .strict();

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-delivery-finish-manually");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB tidak pernah
 * masuk log, hanya pesan yang ditulis module ini. Alasan selesai manual adalah
 * teks bebas operator, jadi tidak pernah ditulis sebagai field log.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

async function finishManually(
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
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      log.warn(
        `delivery finish-manual ditolak: alasan wajib diisi (order ${id}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: "Alasan selesai manual wajib diisi." },
        { status: 400 }
      );
    }

    const data = await createDeliveryFollowUp(db).finishManually(
      id,
      {
        id: ctx.user.id,
        homeBranchId: ctx.policy.user.homeBranchId ?? null,
        canEditOrders: true,
        policyVersion: ctx.policy.policyVersion,
      },
      parsed.data.reason
    );
    log.info(`delivery finish-manual sukses (order ${id}, outcome success)`);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof DeliveryFollowUpError) {
      log.warn(
        `delivery finish-manual gagal (order ${orderId ?? "unknown"}, code ${error.code}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 409 }
      );
    }
    log.error(
      `delivery finish-manual gagal (order ${orderId ?? "unknown"}, outcome error)`,
      new RouteLogError("delivery finish-manual gagal")
    );
    return NextResponse.json(
      { success: false, error: "Gagal memproses pemenuhan pengiriman." },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  finishManually,
  "admin-order-delivery-finish-manually"
);
