import { NextRequest } from "next/server";
import { z } from "zod";

import { guard } from "@/lib/rbac/guard";
import { createModuleLogger, withRequestContext } from "@/lib/logger";
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
//
// The route guard only checks `prices:view`; the `products:view all_branches`
// grant is enforced by the administration layer where the variants are read.
export const dynamic = "force-dynamic";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("admin-price-changes-export");

const exportSchema = z.strictObject({
  variantIds: z.array(z.string().min(1).max(128)).min(1).max(5000),
});

async function exportPriceChanges(request: NextRequest): Promise<Response> {
  const guardResult = await guard("prices", "view");
  if (!guardResult.ok) return guardResult.response;
  const { ctx } = guardResult;

  try {
    const parsed = exportSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      log.warn("price_changes.export.invalid_body (outcome denied)");
      return priceChangeFailureResponse(
        new PriceChangeError(400, "INPUT_INVALID", "Invalid request body"),
        "price_changes.export.denied"
      );
    }
    const file = await exportPriceChangeWorkbook(
      { variantIds: parsed.data.variantIds },
      requirePriceActorId(ctx.user.id)
    );
    // Daftar variant id dan isi workbook tidak masuk log: hanya jumlah dan
    // ukuran byte.
    log.info(
      `price_changes.export (variants ${parsed.data.variantIds.length}, bytes ${file.bytes.length}, actingUserId ${ctx.user.id}, policyVersion ${ctx.policy.policyVersion}, outcome success)`
    );
    return priceWorkbookResponse(file);
  } catch (error) {
    return priceChangeFailureResponse(error, "price_changes.export.failure");
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(
  exportPriceChanges,
  "admin-price-changes-export"
);
