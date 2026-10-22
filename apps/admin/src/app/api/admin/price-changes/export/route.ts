import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import {
  PriceChangeError,
  exportPriceChangeWorkbook,
} from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceWorkbookResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// POST /api/admin/price-changes/export  [prices:view + products:view all_branches]
// =========================================================
// Builds a workbook from CURRENT server data for the selected variant ids (max
// 1000 / configured `discount.import.maxRows`). The browser never supplies the
// base/effective price: anything it sends is ignored. Reference columns are
// advisory; `action`/`new_price` are prefilled with `set_price` + the current
// effective price so a re-upload is an explicit no-op until edited.
export const dynamic = "force-dynamic";

const exportSchema = z.strictObject({
  variantIds: z.array(z.string().min(1).max(128)).min(1).max(5000),
});

export async function POST(request: NextRequest) {
  const guardResult = await guard("prices", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const parsed = exportSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      logger.warn("price_changes.export.invalid_body", { outcome: "denied" });
      return priceChangeFailureResponse(
        logger,
        new PriceChangeError(400, "INPUT_INVALID", "Invalid request body"),
        "price_changes.export.denied"
      );
    }
    const file = await exportPriceChangeWorkbook(
      { variantIds: parsed.data.variantIds },
      requirePriceActorId(ctx.user.id)
    );
    logger.info("price_changes.export", {
      outcome: "success",
      variants: parsed.data.variantIds.length,
      bytes: file.bytes.length,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return priceWorkbookResponse(logger, file);
  } catch (error) {
    return priceChangeFailureResponse(logger, error, "price_changes.export.failure");
  }
}
