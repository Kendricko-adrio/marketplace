import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discounts");

const createDraftSchema = z.strictObject({
  requestKey: z.uuid(),
  activationKind: z.string().min(1).max(32),
  // Usulan kode manual; hanya sah untuk manual_only dan direservasi di dalam
  // transaksi create (bukan saat mengetik draft).
  codes: z.array(z.string().min(1).max(128)).max(50).optional(),
});

async function createDiscountDraft(request: NextRequest): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = createDraftSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      log.warn("discounts create ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(
          400,
          "INPUT_INVALID",
          "Invalid request body"
        ),
        "discounts create ditolak"
      );
    }

    const result = await createPublicDraftOffer(
      parsed.data,
      requireActorId(ctx.user.id)
    );

    // Nilai body mentah tidak masuk log; hanya identifier/fakta bisnis.
    log.info(
      `discounts create (offer ${result.data.id}, activationKind ${result.data.activationKind}, state ${result.data.state}, replayed ${result.status === 200}, actor ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return discountSuccessResponse(result.data, result.status);
  } catch (error) {
    return discountFailureResponse(error, "discounts create gagal");
  }
}

async function listDiscounts(request: NextRequest): Promise<Response> {
  const guardResult = await guard("discounts", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

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
      { page, limit, state: state ?? undefined, activationKind: params.get("activationKind") ?? undefined },
      requireActorId(ctx.user.id)
    );

    log.info(
      `discounts list (page ${result.pagination.page}, limit ${result.pagination.limit}, total ${result.pagination.total}, stateFilter ${state ?? "none"}, activationKind ${params.get("activationKind") ?? "none"}, actor ${ctx.user.id}, outcome success)`
    );
    // Same list envelope as the other admin collections: `data` plus a
    // top-level `pagination`, not a nested payload.
    return NextResponse.json(
      { success: true, data: result.data, pagination: result.pagination, countsByActivationKind: result.countsByActivationKind },
      { status: 200, headers: DISCOUNTS_NO_STORE }
    );
  } catch (error) {
    return discountFailureResponse(error, "discounts list gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(createDiscountDraft, "admin-discounts");
export const GET = withRequestContext(listDiscounts, "admin-discounts");
