import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { getDiscountOfferHistory } from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// GET /api/admin/discounts/[id]/history                  [discounts:view]
// =========================================================
// Immutable audit trail for one Offer (create/draft/publish/state/policy).
// A public Offer has no customer code, so nothing here needs masking; the
// reader still projects only the stored audit payload and never joins live
// session/provider data.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "view", {});
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const history = await getDiscountOfferHistory(
      id,
      requireActorId(ctx.user.id)
    );
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
