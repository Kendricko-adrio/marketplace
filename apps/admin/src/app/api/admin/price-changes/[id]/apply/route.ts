import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import {
  applyPriceChangeBatch,
  PriceChangeError,
} from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceChangeSuccessResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// POST /api/admin/price-changes/{id}/apply
//   [prices:edit + products:view all_branches]
// =========================================================
// Foreground chunk: maksimum 25 row atau 5 detik per response (whichever comes
// first). Each row is one bounded transaction — policy re-read, batch→row lock,
// variant source lock, latest-source validation, immutable revision + current
// pointer + durable row result + audit. A replayed key returns the stored result
// without a second revision/audit; a no-op becomes `unchanged` (no fake
// revision). `previewDigest` is recorded for the review trail but a changed
// source/target never forces a re-review (spec §4.1).
//
// 202 means "not final yet": rows remain pending and the client resumes with a
// NEW request key. 200 means the batch reached a final state.
export const dynamic = "force-dynamic";

const applySchema = z.strictObject({
  requestKey: z.uuid(),
  previewDigest: z.string().min(1).max(128).nullish(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("prices", "edit", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = applySchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      logger.warn("price_changes.apply.invalid_body", { outcome: "denied" });
      return priceChangeFailureResponse(
        logger,
        new PriceChangeError(400, "INPUT_INVALID", "Invalid request body"),
        "price_changes.apply.denied"
      );
    }
    const { id } = await params;
    const result = await applyPriceChangeBatch(
      id,
      parsed.data,
      requirePriceActorId(ctx.user.id)
    );
    logger.info("price_changes.apply", {
      outcome: result.status === 202 ? "partial" : "success",
      batchId: result.data.id,
      state: result.data.state,
      appliedCount: result.data.appliedCount,
      unchangedCount: result.data.unchangedCount,
      failedCount: result.data.failedCount,
      pendingCount: result.data.pendingCount,
      haltReason: result.data.haltReason,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return priceChangeSuccessResponse(logger, result.data, result.status);
  } catch (error) {
    return priceChangeFailureResponse(
      logger,
      error,
      "price_changes.apply.failure"
    );
  }
}
