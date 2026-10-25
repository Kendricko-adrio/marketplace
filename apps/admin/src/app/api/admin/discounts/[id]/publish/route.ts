import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  publishDiscountOffer,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/publish                 [discounts:edit]
// =========================================================
// Atomic publication: re-validate under lock, recompute the review fingerprint
// from the locked rows, move the current pointer, set published_at, audit and
// write the request receipt in ONE commit. A lost response replays the same
// result (same request key); a changed command under that key is a conflict.
// A public Offer has no code, and no provider is called.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-publish");

type RouteContext = { params: Promise<{ id: string }> };

const publishSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedOfferVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
  expectedPolicyVersion: z.number().int().positive(),
  reviewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  proposedCodes: z.array(z.string().min(1).max(128)).max(50).optional(),
});

async function publishOffer(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = publishSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      log.warn("discounts publish ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts publish ditolak"
      );
    }

    const { id } = await params;
    const result = await publishDiscountOffer(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    // Request key, fingerprint, dan usulan kode tidak pernah masuk log.
    log.info(
      `discounts publish (offer ${id}, replayed ${result.replayed}, state ${result.data.state}, currentRevisionId ${result.data.currentRevisionId ?? "none"}, version ${result.data.version}, actor ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return discountSuccessResponse(result.data);
  } catch (error) {
    return discountFailureResponse(error, "discounts publish gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(publishOffer, "admin-discount-publish");
