import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { DiscountAdministrationError } from "@/lib/discounts-administration";
import { saveDiscountConfiguration } from "@/features/discounts/save-discount-configuration-service";
import {
  discountFailureResponse,
  discountSuccessResponse,
  requireActorId,
} from "@/lib/discounts-http";

// =========================================================
// PUT /api/admin/discounts/[id]/draft                    [discounts:edit]
// =========================================================
// ONE atomic full-replacement snapshot for the whole configuration: identity,
// benefit, schedule, quota/budget/per-customer limit and staged code changes.
// There is no per-tab save. A partial draft is accepted (publish completeness
// is validated on review/publish); live terms, capacity, code eligibility and
// usage never change here. Both Offer and draft versions are optimistic guards.
export const dynamic = "force-dynamic";

const log = createModuleLogger("admin-discount-draft");

type RouteContext = { params: Promise<{ id: string }> };

const money = z.union([z.string(), z.null()]);
const draftSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedOfferVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive(),
  configuration: z.strictObject({
    draftSchemaVersion: z.literal(1),
    name: z.union([z.string().max(120), z.null()]),
    currency: z.literal("IDR"),
    minSubtotal: money,
    startAt: z.union([z.string(), z.null()]),
    endAt: z.union([z.string(), z.null()]),
    benefit: z.union([
      z.strictObject({ kind: z.literal("fixed_goods"), paramsVersion: z.literal(1), fixedAmount: money }),
      z.strictObject({ kind: z.literal("shipping"), paramsVersion: z.literal(1), capAmount: money }),
      z.strictObject({ kind: z.literal("percentage_goods"), paramsVersion: z.literal(1), rate: money, capAmount: money }),
      z.null(),
    ]),
    capacity: z.strictObject({
      quotaCount: z.union([z.number().int(), z.null()]),
      budgetAmount: money,
      perClientLimit: z.union([z.number().int(), z.null()]),
    }),
    codeChanges: z.strictObject({
      proposedCodes: z.array(z.string()).max(50),
      states: z.array(z.strictObject({
        codeId: z.string().min(1).max(128),
        expectedCodeVersion: z.number().int().positive(),
        state: z.enum(["active", "inactive", "archived"]),
      })).max(500),
    }),
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
    const parsed = draftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      log.warn("discounts draft ditolak: body tidak valid (outcome denied)");
      return discountFailureResponse(
        new DiscountAdministrationError(400, "INPUT_INVALID", "Invalid request body"),
        "discounts draft ditolak"
      );
    }

    const { id } = await params;
    const detail = await saveDiscountConfiguration(
      {
        offerId: id,
        requestKey: parsed.data.requestKey,
        expectedOfferVersion: parsed.data.expectedOfferVersion,
        expectedDraftVersion: parsed.data.expectedDraftVersion,
        configuration: parsed.data.configuration,
      },
      requireActorId(ctx.user.id)
    );

    // Konfigurasi, usulan kode, request key, dan fingerprint tidak masuk log.
    log.info(
      `discounts draft saved (offer ${detail.id}, draftVersion ${detail.draftVersion}, codeProposalCount ${detail.draftConfiguration.codeChanges.proposedCodes.length}, actor ${ctx.user.id}, outcome success)`
    );
    return discountSuccessResponse(detail);
  } catch (error) {
    return discountFailureResponse(error, "discounts draft gagal");
  }
}

export const PUT = withRequestContext(saveDraft, "admin-discount-draft");
