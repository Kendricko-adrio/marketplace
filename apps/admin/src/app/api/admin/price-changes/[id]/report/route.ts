import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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
//
// The route guard only checks `prices:view`; the `products:view all_branches`
// grant is enforced by the administration layer where the rows are read.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-price-changes-report");

type RouteContext = { params: Promise<{ id: string }> };

async function downloadPriceChangeReport(
  request: NextRequest,
  { params }: RouteContext
): Promise<Response> {
  const guardResult = await guard("prices", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

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
        new PriceChangeError(404, "NOT_FOUND", "Price-change batch not found"),
        "price_changes.report.denied"
      );
    }
    // Nama file dan isi workbook tidak masuk log: hanya identifier batch dan
    // ukuran byte.
    log.info(
      `price_changes.report (batch ${id}, subset ${subset}, bytes ${file.bytes.length}, actingUserId ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return priceWorkbookResponse(file);
  } catch (error) {
    return priceChangeFailureResponse(error, "price_changes.report.failure");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(
  downloadPriceChangeReport,
  "admin-price-changes-report"
);
