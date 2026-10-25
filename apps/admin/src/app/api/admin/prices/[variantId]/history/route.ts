import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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
//
// The route guard only checks `prices:view`; the paired `products:view
// all_branches` grant is enforced by the administration layer where the history
// is read, so the 404 for an out-of-grant variant stays identical.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-price-history");

type RouteContext = { params: Promise<{ variantId: string }> };

async function variantPriceHistory(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("prices", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

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
        new PriceChangeError(404, "NOT_FOUND", "Variant not found"),
        "prices.history.denied"
      );
    }
    log.info(
      `prices.history (variant ${result.variantId}, revisionTotal ${result.pagination.total}, page ${result.pagination.page}, actingUserId ${ctx.user.id}, outcome success)`
    );
    return priceChangeSuccessResponse(result);
  } catch (error) {
    return priceChangeFailureResponse(error, "prices.history.failure");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(
  variantPriceHistory,
  "admin-price-history"
);
