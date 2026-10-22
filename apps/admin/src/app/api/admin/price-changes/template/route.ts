import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { getPriceChangeTemplate } from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceWorkbookResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// GET /api/admin/price-changes/template   [prices:view + products:view all_branches]
// =========================================================
// Blank versioned workbook: sheet `Harga`, A1 `OKCIR_MARKDOWN_V1`, row 2
// `sku`/`action`/`new_price`, data from row 3. The domain layer enforces the
// current grants (a direct API call cannot bypass the UI), and the response is
// no-store so a shared machine cannot serve a stale template.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guardResult = await guard("prices", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const bytes = await getPriceChangeTemplate(requirePriceActorId(ctx.user.id));
    logger.info("price_changes.template", {
      outcome: "success",
      bytes: bytes.length,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return priceWorkbookResponse(logger, {
      filename: "template-harga.xlsx",
      bytes,
    });
  } catch (error) {
    return priceChangeFailureResponse(
      logger,
      error,
      "price_changes.template.failure"
    );
  }
}
