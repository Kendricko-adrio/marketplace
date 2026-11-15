import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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
//
// The route guard only checks `prices:view`; the `products:view all_branches`
// grant is enforced by the administration layer where the batch is read, so the
// 404 for an out-of-grant batch stays identical.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-price-changes-detail");

type RouteContext = { params: Promise<{ id: string }> };

async function priceChangeDetail(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("prices", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

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
        new PriceChangeError(
          404,
          "NOT_FOUND",
          "Price-change batch not found"
        ),
        "price_changes.detail.denied"
      );
    }
    log.info(
      `price_changes.detail (batch ${result.id}, state ${result.state}, rowCount ${result.rowCount}, page ${result.pagination.page}, actingUserId ${ctx.user.id}, outcome success)`
    );
    return priceChangeSuccessResponse(result);
  } catch (error) {
    return priceChangeFailureResponse(error, "price_changes.detail.failure");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(
  priceChangeDetail,
  "admin-price-changes-detail"
);
