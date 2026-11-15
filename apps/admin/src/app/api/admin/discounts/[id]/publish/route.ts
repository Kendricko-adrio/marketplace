import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { DiscountAdministrationError } from "@/lib/discounts-administration";
import { publishDiscountConfiguration } from "@/features/discounts/publish-discount-configuration-service";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// POST /api/admin/discounts/[id]/publish                 [discounts:edit]
// =========================================================
// ONE transaction: lock the Offer, re-read policy, re-validate versions, the
// review fingerprint, capacity permission and commitments, then materialise
// terms + benefit + capacity + per-customer limit + staged codes + pointer +
// audit + receipt. The payload is a review token, never new configuration.
export const dynamic = "force-dynamic";

const log = createModuleLogger("admin-discount-publish");

type RouteContext = { params: Promise<{ id: string }> };

const publishSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedOfferVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
  expectedPolicyVersion: z.number().int().positive(),
  reviewFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

async function publishOffer(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = publishSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      log.warn("discounts publish ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts publish ditolak"
      );
    }

    const { id } = await params;
    const result = await publishDiscountConfiguration(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    // Request key, fingerprint, dan literal kode tidak pernah masuk log.
    log.info(
      `discounts publish (offer ${id}, replayed ${result.replayed}, state ${result.data.state}, currentRevisionId ${result.data.currentRevisionId ?? "none"}, version ${result.data.version}, actor ${ctx.user.id}, outcome success)`
    );
    return discountSuccessResponse(result.data);
  } catch (error) {
    return discountFailureResponse(error, "discounts publish gagal");
  }
}

export const POST = withRequestContext(publishOffer, "admin-discount-publish");
