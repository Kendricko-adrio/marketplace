import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
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

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const guardResult = await guard("discounts", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

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
    logger.info("discounts.usage", {
      outcome: "success",
      offerId: id,
      basis: result.availability.basis,
      heldCount: result.availability.heldCount,
      consumedCount: result.availability.consumedCount,
      entriesAccess: result.entriesAccess,
      scopeMode: result.scope?.mode ?? null,
      entryTotal: result.entries?.total ?? 0,
      driftDetected: result.drift.detected,
    });
    return discountSuccessResponse(logger, result);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.usage.failure");
  }
}
