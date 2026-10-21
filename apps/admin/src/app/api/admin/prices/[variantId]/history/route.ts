import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import {
  getVariantPriceHistory,
  PriceChangeError,
} from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceChangeSuccessResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// GET /api/admin/prices/{variantId}/history
//   [prices:view + products:view all_branches]
// =========================================================
// Immutable revisions (newest first) + the current projection/version. Money is
// returned as whole-Rupiah decimal strings; no target of another SKU or any
// request key/fingerprint is exposed.
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ variantId: string }> }
) {
  const guardResult = await guard("prices", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { variantId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const result = await getVariantPriceHistory(
      variantId,
      {
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
      },
      requirePriceActorId(ctx.user.id)
    );
    if (!result) {
      return priceChangeFailureResponse(
        logger,
        new PriceChangeError(404, "NOT_FOUND", "Variant not found"),
        "prices.history.denied"
      );
    }
    logger.info("prices.history", {
      outcome: "success",
      variantId: result.variantId,
      total: result.pagination.total,
      actorId: ctx.user.id,
    });
    return priceChangeSuccessResponse(logger, result);
  } catch (error) {
    return priceChangeFailureResponse(
      logger,
      error,
      "prices.history.failure"
    );
  }
}
