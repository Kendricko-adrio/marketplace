import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
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

type RouteContext = { params: Promise<{ id: string }> };

const addCodeSchema = z.strictObject({
  requestKey: z.uuid(),
  code: z.string().min(1).max(128),
  expectedOfferVersion: z.number().int().positive(),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = addCodeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      logger.warn("discounts.codes.create.invalid_body", { outcome: "denied" });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts.codes.create.denied"
      );
    }

    const { id } = await params;
    const result = await addDiscountCode(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.codes.create", {
      outcome: "success",
      offerId: id,
      codeCount: result.data.codes.length,
      version: result.data.version,
      replayed: result.replayed,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return discountSuccessResponse(logger, result.data, result.status);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.codes.create.failure");
  }
}
