import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import {
  MAX_STAGE_ROWS_HARD_LIMIT,
  PriceChangeError,
  stagePriceChangeBatch,
} from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceChangeSuccessResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// POST /api/admin/price-changes   [prices:edit + products:view all_branches]
// =========================================================
// Stages 1..N Markdown rows (`source: "manual" | "bulk"`, default derived from
// the row count) for review/apply on /api/admin/price-changes/{id}/apply. The
// preview is non-authoritative: apply re-reads the latest source and current
// Markdown, so a stale preview never blocks a still-valid target (spec §4.1).
//
// The static body bound is `MAX_STAGE_ROWS_HARD_LIMIT`; the EFFECTIVE bound is
// `discount.import.maxRows`, read uncached in the domain layer (400
// ROW_LIMIT_EXCEEDED, nothing staged) so an operator change applies immediately.
//
// `requestKey` (UUID) is the command key: same key + same validated command
// returns the SAME staged batch (200); a different command under a used key is
// 409 REQUEST_KEY_CONFLICT.
export const dynamic = "force-dynamic";

const stageSchema = z.strictObject({
  requestKey: z.uuid(),
  source: z.enum(["manual", "bulk"]).nullish(),
  reason: z.string().max(500).nullish(),
  rows: z
    .array(
      z.strictObject({
        sku: z.string().min(1).max(128),
        action: z.enum(["set_price", "restore_base"]),
        targetUnitPrice: z.string().max(32).nullish(),
        discountPercent: z.string().max(32).nullish(),
      })
    )
    .min(1)
    .max(MAX_STAGE_ROWS_HARD_LIMIT),
});

export async function POST(request: NextRequest) {
  const guardResult = await guard("prices", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = stageSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("price_changes.stage.invalid_body", { outcome: "denied" });
      return priceChangeFailureResponse(
        logger,
        new PriceChangeError(400, "INPUT_INVALID", "Invalid request body"),
        "price_changes.stage.denied"
      );
    }
    const result = await stagePriceChangeBatch(
      {
        requestKey: parsed.data.requestKey,
        source: parsed.data.source ?? undefined,
        reason: parsed.data.reason ?? null,
        rows: parsed.data.rows,
      },
      requirePriceActorId(ctx.user.id)
    );
    logger.info("price_changes.stage", {
      outcome: "success",
      batchId: result.data.id,
      state: result.data.state,
      rowCount: result.data.rowCount,
      replayed: result.status === 200,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return priceChangeSuccessResponse(logger, result.data, result.status);
  } catch (error) {
    return priceChangeFailureResponse(
      logger,
      error,
      "price_changes.stage.failure"
    );
  }
}
