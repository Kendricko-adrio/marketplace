import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { readDiscountOfferHistory } from "@/lib/discount-operations-read";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// GET /api/admin/discounts/[id]/history                  [discounts:view]
// =========================================================
// Immutable audit trail for one Offer (draft/publish/state/policy/code). Each
// entry reports the actual revision/draft/code references, policy version and
// a safe actor attribution that survives the Admin User FK becoming NULL. Code
// literals are never part of this payload (masked label + code id only);
// `audit_log:view` alone is not a literal channel — the protected editor detail
// remains the only place an authorized promo editor sees a literal.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const limit = new URL(request.url).searchParams.get("limit");
    const history = await readDiscountOfferHistory({
      offerId: id,
      actorUserId: requireActorId(ctx.user.id),
      limit,
    });
    logger.info("discounts.history", {
      outcome: "success",
      offerId: id,
      entryCount: history.length,
    });
    return discountSuccessResponse(logger, history);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.history.failure");
  }
}
