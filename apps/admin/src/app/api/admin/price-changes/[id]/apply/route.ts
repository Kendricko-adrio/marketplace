import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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
//
// The route guard only checks `prices:edit`; the `products:view all_branches`
// grant and the writer gate are re-read per row inside the transaction.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-price-changes-apply");

const applySchema = z.strictObject({
  requestKey: z.uuid(),
  previewDigest: z.string().min(1).max(128).nullish(),
});

type RouteContext = { params: Promise<{ id: string }> };

async function applyPriceChanges(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("prices", "edit");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = applySchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      log.warn("price_changes.apply.invalid_body (outcome denied)");
      return priceChangeFailureResponse(
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
    log.info(
      `price_changes.apply (batch ${result.data.id}, state ${result.data.state}, appliedCount ${result.data.appliedCount}, unchangedCount ${result.data.unchangedCount}, failedCount ${result.data.failedCount}, pendingCount ${result.data.pendingCount}, haltReason ${result.data.haltReason ?? "none"}, actingUserId ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome ${result.status === 202 ? "partial" : "success"})`
    );
    return priceChangeSuccessResponse(result.data, result.status);
  } catch (error) {
    return priceChangeFailureResponse(error, "price_changes.apply.failure");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  applyPriceChanges,
  "admin-price-changes-apply"
);
