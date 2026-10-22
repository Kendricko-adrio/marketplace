import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { withRequestId } from "@/lib/logger";
import {
  createPublicDraftOffer,
  listDiscountOffers,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  DISCOUNTS_NO_STORE,
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// /api/admin/discounts
//   POST — create ONE public fixed Offer DRAFT            [discounts:edit]
//   GET  — paginated safe Offer list                      [discounts:view]
// =========================================================
// The created draft is intentionally INCOMPLETE: no quota, no budget, no
// published revision, no customer code. Publish/pause/simulate/policy live on
// `/api/admin/discounts/{id}/*` and are separate slices of the same contract.
//
// Idempotency: `requestKey` (UUID) is the command key. The SAME key + SAME
// validated command returns the SAME Offer with 200 (no second Offer, no second
// audit); a different command under a used key is 409 REQUEST_KEY_CONFLICT. The
// receipt, Offer, draft revision, usage projection and audit commit together.
//
// `activationKind` is validated by the domain module (not by a zod literal) so
// an unsupported kind is an explicit 400 INPUT_INVALID (spec §5.4) instead of a
// silent default to public.
export const dynamic = "force-dynamic";

const createDraftSchema = z.strictObject({
  requestKey: z.uuid(),
  activationKind: z.string().min(1).max(32),
  // Usulan kode manual; hanya sah untuk manual_only dan direservasi di dalam
  // transaksi create (bukan saat mengetik draft).
  codes: z.array(z.string().min(1).max(128)).max(50).optional(),
});

export async function POST(request: NextRequest) {
  const guardResult = await guard("discounts", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = createDraftSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("discounts.create.invalid_body", { outcome: "denied" });
      return discountFailureResponse(
        logger,
        new DiscountAdministrationError(
          400,
          "INPUT_INVALID",
          "Invalid request body"
        ),
        "discounts.create.denied"
      );
    }

    const result = await createPublicDraftOffer(
      parsed.data,
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.create", {
      outcome: "success",
      offerId: result.data.id,
      activationKind: result.data.activationKind,
      state: result.data.state,
      replayed: result.status === 200,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return discountSuccessResponse(logger, result.data, result.status);
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.create.failure");
  }
}

export async function GET(request: NextRequest) {
  const guardResult = await guard("discounts", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const params = request.nextUrl.searchParams;
    const page = params.has("page")
      ? Number.parseInt(params.get("page") ?? "", 10)
      : 1;
    const limit = params.has("limit")
      ? Number.parseInt(params.get("limit") ?? "", 10)
      : 10;
    const state = params.get("state") ?? undefined;

    const result = await listDiscountOffers(
      { page, limit, state: state ?? undefined },
      requireActorId(ctx.user.id)
    );

    logger.info("discounts.list", {
      outcome: "success",
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
      stateFilter: state ?? null,
      actorId: ctx.user.id,
    });
    // Same list envelope as the other admin collections: `data` plus a
    // top-level `pagination`, not a nested payload.
    return withRequestId(
      NextResponse.json(
        { success: true, data: result.data, pagination: result.pagination },
        { status: 200, headers: DISCOUNTS_NO_STORE }
      ),
      logger
    );
  } catch (error) {
    return discountFailureResponse(logger, error, "discounts.list.failure");
  }
}
