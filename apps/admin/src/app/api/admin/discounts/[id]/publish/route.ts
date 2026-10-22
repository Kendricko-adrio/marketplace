import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import {
  publishDiscountOffer,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/publish                 [discounts:edit]
// =========================================================
// Atomic publication: re-validate under lock, recompute the review fingerprint
// from the locked rows, move the current pointer, set published_at, audit and
// write the request receipt in ONE commit. A lost response replays the same
// result (same request key); a changed command under that key is a conflict.
// A public Offer has no code, and no provider is called.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const publishSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedOfferVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
  expectedPolicyVersion: z.number().int().positive(),
  reviewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  proposedCodes: z.array(z.string().min(1).max(128)).max(50).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = publishSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("discounts.publish.invalid_body", { outcome: "denied" });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts.publish.denied"
      );
    }

    const { id } = await params;
    const result = await publishDiscountOffer(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.publish", {
      outcome: "success",
      offerId: id,
      replayed: result.replayed,
      state: result.data.state,
      currentRevisionId: result.data.currentRevisionId,
      version: result.data.version,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return discountSuccessResponse(logger, result.data);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.publish.failure");
  }
}
