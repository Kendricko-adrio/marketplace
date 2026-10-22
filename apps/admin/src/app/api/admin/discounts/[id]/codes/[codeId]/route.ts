import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
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

type RouteContext = { params: Promise<{ id: string; codeId: string }> };

const codeStateSchema = z.strictObject({
  expectedOfferVersion: z.number().int().positive(),
  expectedCodeVersion: z.number().int().positive(),
  state: z.enum(["active", "inactive", "archived"]),
});

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = codeStateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      logger.warn("discounts.codes.state.invalid_body", { outcome: "denied" });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts.codes.state.denied"
      );
    }

    const { id, codeId } = await params;
    const result = await setDiscountCodeState(
      { offerId: id, codeId, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.codes.state", {
      outcome: "success",
      offerId: id,
      codeId,
      version: result.data.version,
      replayed: result.replayed,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return discountSuccessResponse(logger, result.data);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.codes.state.failure");
  }
}
