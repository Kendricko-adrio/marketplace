import { NextRequest } from "next/server";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
import { getPriceChangeTemplate } from "@/lib/price-changes-administration";
import {
  priceChangeFailureResponse,
  priceWorkbookResponse,
  requirePriceActorId,
} from "@/lib/price-changes-http";

// =========================================================
// GET /api/admin/price-changes/template   [prices:view + products:view all_branches]
// =========================================================
// Blank versioned workbook: sheet `Harga`, A1 `markdown_v1`, row 2
// `sku`/`action`/`new_price`, data from row 3. The domain layer enforces the
// current grants (a direct API call cannot bypass the UI), and the response is
// no-store so a shared machine cannot serve a stale template.
//
// The route guard only checks `prices:view`; the `products:view all_branches`
// grant is enforced by the administration layer that builds the template.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-price-changes-template");

async function downloadPriceChangeTemplate(
  _request: NextRequest
): Promise<Response> {
  const guardResult = await guard("prices", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const bytes = await getPriceChangeTemplate(requirePriceActorId(ctx.user.id));
    log.info(
      `price_changes.template (bytes ${bytes.length}, actingUserId ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return priceWorkbookResponse({
      filename: "template-harga.xlsx",
      bytes,
    });
  } catch (error) {
    return priceChangeFailureResponse(error, "price_changes.template.failure");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(
  downloadPriceChangeTemplate,
  "admin-price-changes-template"
);
