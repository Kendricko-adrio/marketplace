import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { refreshMappedJubelioStock } from "@marketplace/db/src/jubelio-stock-refresh";
import { requestLogger, serializeError, withRequestId } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const log = requestLogger(request, { module: "refresh-jubelio-stock" });
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("stock refresh unavailable: cron secret missing");
    return withRequestId(NextResponse.json({ success: false, error: "Cron not configured" }, { status: 503 }), log);
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    log.warn("stock refresh unauthorized");
    return withRequestId(NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }), log);
  }
  try {
    const result = await refreshMappedJubelioStock(db);
    if (result.failed || result.missing) {
      log.error("stock refresh incomplete", result);
      return withRequestId(NextResponse.json({ success: false, ...result }, { status: 503 }), log);
    }
    log.info("stock refresh completed", result);
    return withRequestId(NextResponse.json({ success: true, ...result }), log);
  } catch (error) {
    log.error("stock refresh failed", { error: serializeError(error) });
    return withRequestId(NextResponse.json({ success: false, error: "Stock refresh failed" }, { status: 503 }), log);
  }
}
