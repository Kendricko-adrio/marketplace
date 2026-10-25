import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  setDiscountOfferState,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// PATCH /api/admin/discounts/[id]/state                  [discounts:edit]
// =========================================================
// Enable / pause / archive with an optimistic version guard. Pausing never
// cancels holds and never resets usage; archiving is not a hard delete, so the
// identity, published revisions and audit trail are retained.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-state");

type RouteContext = { params: Promise<{ id: string }> };

const stateSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedVersion: z.number().int().positive(),
  state: z.enum(["enabled", "paused", "archived"]),
});

async function setState(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = stateSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      log.warn("discounts state ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts state ditolak"
      );
    }

    const { id } = await params;
    const result = await setDiscountOfferState(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    log.info(
      `discounts state (offer ${id}, state ${result.data.state}, version ${result.data.version}, replayed ${result.replayed}, actor ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return discountSuccessResponse(result.data);
  } catch (error) {
    return discountFailureResponse(error, "discounts state gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const PATCH = withRequestContext(setState, "admin-discount-state");
