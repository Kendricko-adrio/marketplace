import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  reviewDiscountOffer,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/review                  [discounts:edit]
// =========================================================
// Read-only server-bound review: returns the live-vs-draft diff, every
// publication validation and a fingerprint over the exact versions/terms/
// benefit/capacity that publish will recompute. No mutation, no hold, no
// provider call, and explicitly not a quote or an order.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-review");

type RouteContext = { params: Promise<{ id: string }> };

const reviewSchema = z.strictObject({
  expectedOfferVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
  // Usulan kode yang direservasi saat publish berhasil (terikat fingerprint).
  proposedCodes: z.array(z.string().min(1).max(128)).max(50).optional(),
});

async function reviewOffer(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = reviewSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      log.warn("discounts review ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts review ditolak"
      );
    }

    const { id } = await params;
    const result = await reviewDiscountOffer(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    // Usulan kode (literal) tidak pernah masuk log.
    log.info(
      `discounts review (offer ${id}, canPublish ${result.canPublish}, offerVersion ${result.offerVersion}, draftVersion ${result.draftVersion}, actor ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return discountSuccessResponse(result);
  } catch (error) {
    return discountFailureResponse(error, "discounts review gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(reviewOffer, "admin-discount-review");
