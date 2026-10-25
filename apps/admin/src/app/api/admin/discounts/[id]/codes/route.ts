import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  addDiscountCode,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/codes                   [discounts:edit]
// =========================================================
// Menambah SATU Manual Promo Code ke Offer manual_only. Canonical direservasi
// pada commit ini (trim+uppercase, ASCII 3–64, unik global). Request key menjaga
// lost response tidak menggandakan code/audit; version guard menolak edit stale.
// Literal tidak pernah ditulis ke log; response memuatnya hanya karena aktor
// adalah promo editor.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-codes");

type RouteContext = { params: Promise<{ id: string }> };

const addCodeSchema = z.strictObject({
  requestKey: z.uuid(),
  code: z.string().min(1).max(128),
  expectedOfferVersion: z.number().int().positive(),
});

async function addCode(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = addCodeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      log.warn("discounts codes create ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts codes create ditolak"
      );
    }

    const { id } = await params;
    const result = await addDiscountCode(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    // Literal kode tidak pernah masuk log — hanya jumlah kode + versi.
    log.info(
      `discounts codes create (offer ${id}, codeCount ${result.data.codes.length}, version ${result.data.version}, replayed ${result.replayed}, actor ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return discountSuccessResponse(result.data, result.status);
  } catch (error) {
    return discountFailureResponse(error, "discounts codes create gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(addCode, "admin-discount-codes");
