import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import {
  PriceChangeError,
  getPriceChangeReport,
} from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceWorkbookResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// GET /api/admin/price-changes/{id}/report?subset=all|failed
//   [prices:view + products:view all_branches]
// =========================================================
// Download the report or the failed subset as `.xlsx`, built from the durable
// batch rows (the uploaded workbook is never archived). `subset=failed` is the
// linked-retry input: it keeps the official marker/header and adds the
// non-authoritative `origin_row` reference, which the server re-validates
// against FINAL failed rows of this batch before accepting a correction.
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guardResult = await guard("prices", "view", { request });
  if (!guardResult.ok) return guardResult.response;
  const { logger, ctx } = guardResult;

  try {
    const { id } = await params;
    const subset = request.nextUrl.searchParams.get("subset") ?? "all";
    const file = await getPriceChangeReport(
      id,
      subset,
      requirePriceActorId(ctx.user.id)
    );
    if (!file) {
      return priceChangeFailureResponse(
        logger,
        new PriceChangeError(404, "NOT_FOUND", "Price-change batch not found"),
        "price_changes.report.denied"
      );
    }
    logger.info("price_changes.report", {
      outcome: "success",
      batchId: id,
      subset,
      bytes: file.bytes.length,
      actorId: ctx.user.id,
      policyVersion: ctx.policy.policyVersion,
    });
    return priceWorkbookResponse(logger, file);
  } catch (error) {
    return priceChangeFailureResponse(logger, error, "price_changes.report.failure");
  }
}
