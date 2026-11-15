import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  BOOKING_RELEASE_PROOF_SOURCE,
  createDeliveryFollowUp,
  DeliveryFollowUpError,
} from "@/lib/delivery-follow-up";

// POST /api/admin/orders/[id]/delivery/release-booking   [orders:edit]
//
// "Lepas tahanan booking" — releases ONLY a settled `booking_unknown` ledger
// attempt after the AUTHORIZED HUMAN records Jubelio's explicit confirmation
// that the first operation is CLOSED and NO booking exists. The payload is
// the signed attestation (a mandatory reference/reason/the CURRENT attempt
// number/the two literal booleans) — never an automatic inference. The
// release archives the original dispatch into delivery_booking_reviews,
// keeps the attempt count monotonic, creates NO booking (the manual book is
// separate) and stays silent to the customer.
const bodySchema = z
  .object({
    proof: z
      .object({
        source: z.literal(BOOKING_RELEASE_PROOF_SOURCE),
        reference: z.string().trim().min(1),
        reason: z.string().trim().min(1),
        attemptNumber: z.number().int(),
        absenceConfirmed: z.literal(true),
        operationClosed: z.literal(true),
      })
      .strict(),
  })
  .strict();

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-order-delivery-release-booking");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB tidak pernah
 * masuk log, hanya pesan yang ditulis module ini. Referensi/alasan bukti rilis
 * adalah teks bebas operator, jadi tidak pernah ditulis sebagai field log.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

async function releaseBooking(
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
        `delivery release-booking ditolak: bukti rilis tidak lengkap (order ${id}, outcome denied)`
      );
      return NextResponse.json(
        {
          success: false,
          error:
            "Bukti rilis wajib: referensi konfirmasi Jubelio, alasan singkat, dan angka attempt yang saat ini berlaku.",
        },
        { status: 400 }
      );
    }

    const data = await createDeliveryFollowUp(db).releaseBooking(
      id,
      {
        id: ctx.user.id,
        homeBranchId: ctx.policy.user.homeBranchId ?? null,
        canEditOrders: true,
        policyVersion: ctx.policy.policyVersion,
      },
      parsed.data.proof
    );
    log.info(
      `delivery release-booking sukses (order ${id}, attempt ${data.attemptNumber}, outcome success)`
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof DeliveryFollowUpError) {
      log.warn(
        `delivery release-booking gagal (order ${orderId ?? "unknown"}, code ${error.code}, outcome denied)`
      );
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 409 }
      );
    }
    log.error(
      `delivery release-booking gagal (order ${orderId ?? "unknown"}, outcome error)`,
      new RouteLogError("delivery release-booking gagal")
    );
    return NextResponse.json(
      { success: false, error: "Gagal memproses pemenuhan pengiriman." },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  releaseBooking,
  "admin-order-delivery-release-booking"
);
