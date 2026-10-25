import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  setDiscountCodeState,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// PATCH /api/admin/discounts/[id]/codes/[codeId]         [discounts:edit]
// =========================================================
// Active/inactive/archived only. Perintah ini tidak menerima literal maupun
// owner baru: kode tidak dapat dipindah ke Offer lain, literal publikasi tidak
// berubah, dan usage Offer tidak pernah direset. Arsip bersifat terminal.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-code-state");

type RouteContext = { params: Promise<{ id: string; codeId: string }> };

const codeStateSchema = z.strictObject({
  expectedOfferVersion: z.number().int().positive(),
  expectedCodeVersion: z.number().int().positive(),
  state: z.enum(["active", "inactive", "archived"]),
});

async function setCodeState(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = codeStateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      log.warn("discounts codes state ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts codes state ditolak"
      );
    }

    const { id, codeId } = await params;
    const result = await setDiscountCodeState(
      { offerId: id, codeId, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    // Literal kode tidak pernah masuk log — hanya id kode + versi.
    log.info(
      `discounts codes state (offer ${id}, codeId ${codeId}, version ${result.data.version}, replayed ${result.replayed}, actor ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return discountSuccessResponse(result.data);
  } catch (error) {
    return discountFailureResponse(error, "discounts codes state gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const PATCH = withRequestContext(setCodeState, "admin-discount-code-state");
