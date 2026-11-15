import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { refreshMappedJubelioStock } from "@marketplace/db/src/jubelio-stock-refresh";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("refresh-jubelio-stock");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini. Kontrak HTTP
 * gagal (status/body) tidak berubah.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/** HTTP adapter cron: cek secret, panggil refresh, map ke status/body existing. */
async function refreshStockCron(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("stock refresh unavailable: cron secret missing");
    return NextResponse.json({ success: false, error: "Cron not configured" }, { status: 503 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    log.warn("stock refresh unauthorized");
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await refreshMappedJubelioStock(db);
    // Observasi parsial adalah kegagalan: angka ringkasan masuk `message`,
    // bukan field log tambahan.
    const summary =
      `pages ${result.pages}, items ${result.items}, observed ${result.observed}, ` +
      `missing ${result.missing}, failed ${result.failed}`;
    if (result.failed || result.missing) {
      log.error(`stock refresh incomplete: ${summary}`);
      return NextResponse.json({ success: false, ...result }, { status: 503 });
    }
    log.info(`stock refresh completed: ${summary}`);
    return NextResponse.json({ success: true, ...result });
  } catch {
    log.error("stock refresh failed", new RouteLogError("stock refresh failed"));
    return NextResponse.json({ success: false, error: "Stock refresh failed" }, { status: 503 });
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(refreshStockCron, "refresh-jubelio-stock");
