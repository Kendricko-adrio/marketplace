import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { DiscountAdministrationError } from "@/lib/discounts-administration";
import { reviewDiscountConfiguration } from "@/features/discounts/review-discount-configuration-service";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/review                  [discounts:edit]
// =========================================================
// Server-bound review of the SAVED draft snapshot: human diff, publish issues,
// capacity permission delta, commitment/usage drift, code conflicts and a
// fingerprint over the exact versions the publish will recompute under lock.
// No mutation, no hold, not a quote.
export const dynamic = "force-dynamic";

const log = createModuleLogger("admin-discount-review");

type RouteContext = { params: Promise<{ id: string }> };

const reviewSchema = z.strictObject({
  expectedOfferVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
});

async function reviewOffer(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      log.warn("discounts review ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts review ditolak"
      );
    }

    const { id } = await params;
    const result = await reviewDiscountConfiguration(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    log.info(
      `discounts review (offer ${id}, issueCount ${result.issues.length}, changeCount ${result.changes.length}, offerVersion ${result.offerVersion}, draftVersion ${result.draftVersion}, actor ${ctx.user.id}, outcome success)`
    );
    return discountSuccessResponse(result);
  } catch (error) {
    return discountFailureResponse(error, "discounts review gagal");
  }
}

export const POST = withRequestContext(reviewOffer, "admin-discount-review");
