import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { listPriceChangeCandidates } from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceChangeSuccessResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// GET /api/admin/price-changes/candidates
//   [prices:view + products:view all_branches]
// =========================================================
// SKU picker for the bulk price UI: search is a case-insensitive match on SKU
// and product name, ordered `sku asc` so pagination is stable, default 25 per
// page (max 100). Rows whose source price is invalid are returned with
// `basePrice`/`effectiveUnitPrice` null and still counted, so the list and total
// never disagree. No-store: prices are mutable data.
//
// Logging never includes the SKU list itself (only the total).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guardResult = await guard("prices", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const result = await listPriceChangeCandidates(
      {
        search: searchParams.get("search") ?? undefined,
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
      },
      requirePriceActorId(ctx.user.id)
    );
    logger.info("price_changes.candidates", {
      outcome: "success",
      total: result.pagination.total,
      page: result.pagination.page,
      limit: result.pagination.limit,
      actorId: ctx.user.id,
    });
    return priceChangeSuccessResponse(logger, result);
  } catch (error) {
    return priceChangeFailureResponse(
      logger,
      error,
      "price_changes.candidates.failure"
    );
  }
}
