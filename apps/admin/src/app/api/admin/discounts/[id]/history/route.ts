import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-history");

type RouteContext = { params: Promise<{ id: string }> };

async function discountHistory(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const { id } = await params;
    const limit = new URL(request.url).searchParams.get("limit");
    const history = await readDiscountOfferHistory({
      offerId: id,
      actorUserId: requireActorId(ctx.user.id),
      limit,
    });
    log.info(
      `discounts history (offer ${id}, entryCount ${history.length}, outcome success)`
    );
    return discountSuccessResponse(history);
  } catch (error) {
    return discountFailureResponse(error, "discounts history gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(discountHistory, "admin-discount-history");
