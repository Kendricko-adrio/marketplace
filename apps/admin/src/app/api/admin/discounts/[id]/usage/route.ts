import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { readDiscountOfferUsage } from "@/lib/discount-operations-read";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// GET /api/admin/discounts/[id]/usage                    [discounts:view]
// =========================================================
// One response carries two clearly separated things:
//   - the GLOBAL capacity projection (consumed + held + available);
//   - a SCOPED Redemption entry list, which additionally requires
//     Orders:view and follows that grant's branch scope. Without Orders:view
//     the entries are absent (aggregate only) — never a half-identity row.
//
// Filters: `page`, `limit` (≤50), `status`, `activationKind`, `branchId`
// (all-branch Orders only; own-branch is pinned), `entryId` (direct lookup is
// scoped like every other entry and 404s outside the scope). A scoped count is
// returned alongside the global aggregate so the two are never conflated.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-usage");

type RouteContext = { params: Promise<{ id: string }> };

async function discountUsage(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const result = await readDiscountOfferUsage({
      offerId: id,
      actorUserId: requireActorId(ctx.user.id),
      filters: {
        page: searchParams.get("page"),
        limit: searchParams.get("limit"),
        status: searchParams.get("status"),
        activationKind: searchParams.get("activationKind"),
        branchId: searchParams.get("branchId"),
        entryId: searchParams.get("entryId"),
      },
    });
    // Identitas client di entry tidak pernah masuk log; hanya agregat.
    log.info(
      `discounts usage (offer ${id}, basis ${result.availability.basis}, heldCount ${result.availability.heldCount}, consumedCount ${result.availability.consumedCount}, entriesAccess ${result.entriesAccess}, scopeMode ${result.scope?.mode ?? "none"}, entryTotal ${result.entries?.total ?? 0}, driftDetected ${result.drift.detected}, outcome success)`
    );
    return discountSuccessResponse(result);
  } catch (error) {
    return discountFailureResponse(error, "discounts usage gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(discountUsage, "admin-discount-usage");
