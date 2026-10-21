import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import {
  getPriceChangeBatch,
  PriceChangeError,
} from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceChangeSuccessResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// GET /api/admin/price-changes/{id}   [prices:view + products:view all_branches]
// =========================================================
// Review/detail read: current authorized viewer only, no-store. Counts always
// describe the WHOLE batch; `rows` is the requested page (default page 1, limit
// 25, max 100) optionally filtered by row state (`all|pending|applied|unchanged|
// failed`; an unknown value is a domain 400 INPUT_INVALID). A batch outside the
// viewer's grants is a plain 404 (existence is not disclosed).
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("prices", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const searchParams = request.nextUrl.searchParams;
    const result = await getPriceChangeBatch(
      id,
      requirePriceActorId(ctx.user.id),
      {
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
        state: searchParams.get("state") ?? undefined,
      }
    );
    if (!result) {
      return priceChangeFailureResponse(
        logger,
        new PriceChangeError(
          404,
          "NOT_FOUND",
          "Price-change batch not found"
        ),
        "price_changes.detail.denied"
      );
    }
    logger.info("price_changes.detail", {
      outcome: "success",
      batchId: result.id,
      state: result.state,
      rowCount: result.rowCount,
      page: result.pagination.page,
      actorId: ctx.user.id,
    });
    return priceChangeSuccessResponse(logger, result);
  } catch (error) {
    return priceChangeFailureResponse(
      logger,
      error,
      "price_changes.detail.failure"
    );
  }
}
