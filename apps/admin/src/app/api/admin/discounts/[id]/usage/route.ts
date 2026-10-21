import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { getDiscountOfferUsage } from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// GET /api/admin/discounts/[id]/usage                    [discounts:view]
// =========================================================
// Aggregate global projection + remaining capacity. Per-customer redemption
// identities are deliberately absent in this slice (redemption is not active),
// and the response says so instead of returning fake entries.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "view", {});
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const result = await getDiscountOfferUsage(
      id,
      requireActorId(ctx.user.id)
    );
    logger.info("discounts.usage", {
      outcome: "success",
      offerId: id,
      reservedCount: result.usage?.reservedCount ?? 0,
      consumedCount: result.usage?.consumedCount ?? 0,
    });
    return discountSuccessResponse(logger, result);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.usage.failure");
  }
}
