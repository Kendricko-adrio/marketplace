import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import {
  setDiscountOfferPolicy,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// PATCH /api/admin/discounts/[id]/policy                 [discounts:edit]
// =========================================================
// Capacity policy: quota/budget/per-account limit, versioned against both the
// Offer and the policy. Enlarging a limit (initial assignment, increase, or
// removal of a bound) additionally requires the `discount_capacity` grant.
// A live Offer must keep at least one global bound, and no limit may drop below
// the reserved + consumed commitments.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const policySchema = z.strictObject({
  requestKey: z.uuid(),
  expectedOfferVersion: z.number().int().positive(),
  expectedPolicyVersion: z.number().int().positive(),
  quotaCount: z.number().int().positive().nullable(),
  budgetAmount: z.union([z.string(), z.number()]).nullable(),
  perClientLimit: z.number().int().positive(),
});

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = policySchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("discounts.policy.invalid_body", { outcome: "denied" });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts.policy.denied"
      );
    }

    const { id } = await params;
    const result = await setDiscountOfferPolicy(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.policy", {
      outcome: "success",
      offerId: id,
      quotaCount: result.data.quotaCount,
      hasBudget: result.data.budgetAmount !== null,
      perClientLimit: result.data.perClientLimit,
      policyVersion: result.data.policyVersion,
      replayed: result.replayed,
      actorId: ctx.user.id,
    });
    return discountSuccessResponse(logger, result.data);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.policy.failure");
  }
}
