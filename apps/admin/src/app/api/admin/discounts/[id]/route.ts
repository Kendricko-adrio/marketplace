import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-detail");

type RouteContext = { params: Promise<{ id: string }> };

async function discountDetail(
  _request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const { id } = await params;
    const detail = await getDiscountOfferDetail(
      id,
      requireActorId(ctx.user.id)
    );
    if (!detail) {
      log.warn(
        `discounts detail ditolak: offer tidak ditemukan (offer ${id}, outcome denied)`
      );
      return discountFailureResponse(
        new DiscountAdministrationError(404, "NOT_FOUND", "Offer not found"),
        "discounts detail ditolak"
      );
    }

    log.info(
      `discounts detail (offer ${detail.id}, state ${detail.state}, currentRevisionId ${detail.currentRevisionId ?? "none"}, version ${detail.version}, draftVersion ${detail.draftVersion}, outcome success)`
    );
    return discountSuccessResponse(detail);
  } catch (error) {
    return discountFailureResponse(error, "discounts detail gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(discountDetail, "admin-discount-detail");
