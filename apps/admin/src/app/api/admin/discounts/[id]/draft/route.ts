import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { saveDiscountOfferDraft, DiscountAdministrationError } from "@/lib/discounts-administration";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// PUT /api/admin/discounts/[id]/draft                    [discounts:edit]
// =========================================================
// Save ONE complete draft (terms + a single goods benefit: fixed nominal or
// percentage rate/cap). The draft is separate from the published revision, so
// live terms never change here. Both Offer and draft versions are optimistic
// guards: two stale editors get 409 STALE_REVISION and must reload/review
// instead of overwriting each other. Unknown benefit kinds/versions/currencies
// and fields that belong to another kind are refused, never defaulted.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-discount-draft");

type RouteContext = { params: Promise<{ id: string }> };

const draftSchema = z.strictObject({
  expectedOfferVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
  terms: z.strictObject({
    name: z.string().min(1).max(120),
    currency: z.string().min(1).max(8),
    minSubtotal: z.union([z.string(), z.number()]),
    startAt: z.string().nullable().optional(),
    endAt: z.string().nullable().optional(),
    // Exact per-kind shape: a percentage request cannot smuggle a fixed
    // nominal (and vice versa). Precision/bounds stay in the domain validator.
    benefit: z.union([
      z.strictObject({
        kind: z.literal("fixed_goods"),
        paramsVersion: z.literal(1),
        fixedAmount: z.union([z.string(), z.number()]),
      }),
      z.strictObject({
        kind: z.literal("shipping"),
        paramsVersion: z.literal(1),
        capAmount: z.union([z.string(), z.number()]),
      }),
      z.strictObject({
        kind: z.literal("percentage_goods"),
        paramsVersion: z.literal(1),
        rate: z.union([z.string(), z.number()]),
        capAmount: z
          .union([z.string(), z.number(), z.null()])
          .optional(),
      }),
    ]),
  }),
});

async function saveDraft(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("discounts", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = draftSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      log.warn("discounts draft ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts draft ditolak"
      );
    }

    const { id } = await params;
    const detail = await saveDiscountOfferDraft(
      { offerId: id, ...parsed.data },
      requireActorId(ctx.user.id)
    );

    log.info(
      `discounts draft saved (offer ${detail.id}, draftVersion ${detail.draftVersion}, draftRevisionId ${detail.draftRevision?.id ?? "none"}, actor ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return discountSuccessResponse(detail);
  } catch (error) {
    return discountFailureResponse(error, "discounts draft gagal");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const PUT = withRequestContext(saveDraft, "admin-discount-draft");
