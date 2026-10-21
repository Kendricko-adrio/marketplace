import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import {
  setDiscountOfferState,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// PATCH /api/admin/discounts/[id]/state                  [discounts:edit]
// =========================================================
// Enable / pause / archive with an optimistic version guard. Pausing never
// cancels holds and never resets usage; archiving is not a hard delete, so the
// identity, published revisions and audit trail are retained.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const stateSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedVersion: z.number().int().positive(),
  state: z.enum(["enabled", "paused", "archived"]),
});

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = stateSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("discounts.state.invalid_body", { outcome: "denied" });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts.state.denied"
      );
    }

    const { id } = await params;
    const result = await setDiscountOfferState(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.state", {
      outcome: "success",
      offerId: id,
      state: result.data.state,
      version: result.data.version,
      replayed: result.replayed,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return discountSuccessResponse(logger, result.data);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.state.failure");
  }
}
