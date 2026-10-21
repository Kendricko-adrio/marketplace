import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import {
  getDiscountOfferDetail,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// /api/admin/discounts/[id]
//   GET — safe Offer detail (live + draft + usage)        [discounts:view]
// =========================================================
// Read-only projection of the server-side identity: id, state, activation kind,
// versions, the nullable current revision pointer, the immutable live revision,
// the single unpublished draft revision (with its benefit) and the usage
// projection. It never exposes a customer code (a public Offer has none), never
// calls a provider, and never echoes a Current Policy supplied by the browser.
// An unknown id is 404; the response is never cached.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "view", {});
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const detail = await getDiscountOfferDetail(
      id,
      requireActorId(ctx.user.id)
    );
    if (!detail) {
      logger.warn("discounts.detail.not_found", {
        outcome: "denied",
        offerId: id,
      });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found"),
        "discounts.detail.denied"
      );
    }

    logger.info("discounts.detail", {
      outcome: "success",
      offerId: detail.id,
      state: detail.state,
      currentRevisionId: detail.currentRevisionId,
      version: detail.version,
      draftVersion: detail.draftVersion,
    });
    return discountSuccessResponse(logger, detail);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.detail.failure");
  }
}
