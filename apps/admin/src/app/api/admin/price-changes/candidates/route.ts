import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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
// page (max 100). Optional markdownStatus=configured/unconfigured filters by
// current stored target presence (including inactive targets and excluding
// restored targets). markdownStatus=inactive filters targets whose valid current
// source is <= target. Rows/count share the same global status/search predicate.
// Without that filter, rows whose source price is invalid are returned with
// `basePrice`/`effectiveUnitPrice` null and still counted, so the list and total
// never disagree. No-store: prices are mutable data.
//
// The route guard only checks `prices:view`; the `products:view all_branches`
// grant is enforced by the administration layer together with the current
// policy, so the 403/404 mapping stays where the data is read.
//
// Logging never includes the SKU list itself (only the total) and never the
// free-text search term.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-price-changes-candidates");

async function listCandidates(request: NextRequest): Promise<Response> {
  const guardResult = await guard("prices", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const searchParams = request.nextUrl.searchParams;
    const markdownStatus = searchParams.get("markdownStatus") ?? undefined;
    const result = await listPriceChangeCandidates(
      {
        markdownStatus,
        search: searchParams.get("search") ?? undefined,
        page: searchParams.get("page") ?? undefined,
        limit: searchParams.get("limit") ?? undefined,
      },
      requirePriceActorId(ctx.user.id)
    );
    log.info(
      `price_changes.candidates (markdownStatus ${markdownStatus ?? "all"}, total ${result.pagination.total}, page ${result.pagination.page}, limit ${result.pagination.limit}, actingUserId ${ctx.user.id}, outcome success)`
    );
    return priceChangeSuccessResponse(result);
  } catch (error) {
    return priceChangeFailureResponse(
      error,
      "price_changes.candidates.failure"
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(
  listCandidates,
  "admin-price-changes-candidates"
);
