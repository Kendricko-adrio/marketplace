import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  createDeliveryFollowUp,
  DeliveryFollowUpError,
  PACKING_FAILURE_REASONS,
} from "@/lib/delivery-follow-up";

// POST /api/admin/orders/[id]/delivery/packing-failure   [orders:edit]
//
// "Tandai tidak dapat dipenuhi" — the reason Code is MANDATORY and must be
// one of the three spec codes; the order keeps processing/paid; the failure
// flag blocks the normal packing/booking/handoff CTAs and services. No
// refund/cancel-SO/communication happens here.
const bodySchema = z
  .object({
    reasonCode: z.enum(PACKING_FAILURE_REASONS),
  })
  .strict();

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-delivery-packing-failure");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB tidak pernah
 * masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

async function failPacking(
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
        `delivery packing-failure ditolak: reasonCode tidak dikenal (order ${id}, outcome denied)`
      );
      return NextResponse.json(
        {
          success: false,
          error: "Alasan pemenuhan wajib dipilih dari alasan baku yang tersedia.",
        },
        { status: 400 }
      );
    }

    const data = await createDeliveryFollowUp(db).failPacking(
      id,
      {
        id: ctx.user.id,
        homeBranchId: ctx.policy.user.homeBranchId ?? null,
        canEditOrders: true,
        policyVersion: ctx.policy.policyVersion,
      },
      parsed.data.reasonCode
    );
    log.info(
      `delivery packing-failure sukses (order ${id}, reason ${parsed.data.reasonCode}, outcome success)`
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof DeliveryFollowUpError) {
      log.warn(
        `delivery packing-failure gagal (order ${orderId ?? "unknown"}, code ${error.code}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 409 }
      );
    }
    log.error(
      `delivery packing-failure gagal (order ${orderId ?? "unknown"}, outcome error)`,
      new RouteLogError("delivery packing-failure gagal")
    );
    return NextResponse.json(
      { success: false, error: "Gagal memproses pemenuhan pengiriman." },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  failPacking,
  "admin-order-delivery-packing-failure"
);
