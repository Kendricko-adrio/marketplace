import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import {
  setDiscountOfferPolicy,
  DiscountAdministrationError,
} from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// PATCH /api/admin/discounts/[id]/policy                 [discounts:edit]
// =========================================================
// Capacity policy: quota/budget/per-account limit, versioned against both the
// Offer and the policy. Enlarging a limit (initial assignment, increase, or
// removal of a bound) additionally requires the `discount_capacity` grant.
// A live Offer must keep at least one global bound, and no limit may drop below
// the reserved + consumed commitments.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-policy");

type RouteContext = { params: Promise<{ id: string }> };

const policySchema = z.strictObject({
  requestKey: z.uuid(),
  expectedOfferVersion: z.number().int().positive(),
  expectedPolicyVersion: z.number().int().positive(),
  quotaCount: z.number().int().positive().nullable(),
  budgetAmount: z.union([z.string(), z.number()]).nullable(),
  perClientLimit: z.number().int().positive(),
});

async function setPolicy(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = policySchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      log.warn("discounts policy ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts policy ditolak"
      );
    }

    const { id } = await params;
    const result = await setDiscountOfferPolicy(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    // Nominal budget tidak masuk log — hanya boolean keberadaannya.
    log.info(
      `discounts policy (offer ${id}, quotaCount ${result.data.quotaCount ?? "none"}, hasBudget ${result.data.budgetAmount !== null}, perClientLimit ${result.data.perClientLimit}, policyVersion ${result.data.policyVersion}, replayed ${result.replayed}, actor ${ctx.user.id}, outcome success)`
    );
    return discountSuccessResponse(result.data);
  } catch (error) {
    return discountFailureResponse(error, "discounts policy gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const PATCH = withRequestContext(setPolicy, "admin-discount-policy");
