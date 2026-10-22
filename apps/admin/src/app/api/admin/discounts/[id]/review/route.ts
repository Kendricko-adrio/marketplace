import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import {
  reviewDiscountOffer,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/review                  [discounts:edit]
// =========================================================
// Read-only server-bound review: returns the live-vs-draft diff, every
// publication validation and a fingerprint over the exact versions/terms/
// benefit/capacity that publish will recompute. No mutation, no hold, no
// provider call, and explicitly not a quote or an order.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const reviewSchema = z.strictObject({
  expectedOfferVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
  // Usulan kode yang direservasi saat publish berhasil (terikat fingerprint).
  proposedCodes: z.array(z.string().min(1).max(128)).max(50).optional(),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = reviewSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("discounts.review.invalid_body", { outcome: "denied" });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts.review.denied"
      );
    }

    const { id } = await params;
    const result = await reviewDiscountOffer(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.review", {
      outcome: "success",
      offerId: id,
      canPublish: result.canPublish,
      offerVersion: result.offerVersion,
      draftVersion: result.draftVersion,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return discountSuccessResponse(logger, result);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.review.failure");
  }
}
