import { NextResponse, type NextRequest } from "next/server";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { readCheckoutResult } from "@/lib/checkout-request";
import { requestLogger, withRequestId } from "@/lib/logger";

/** Lookup milik client saja; tidak memanggil dispatcher atau payment initializer. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ requestKey: string }> }) {
  const log = requestLogger(request, { module: "checkout-request-read" });
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return withRequestId(access.response, log);
    const { requestKey } = await params;
    const result = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)
      ? await readCheckoutResult(access.session.user.id, requestKey.toLowerCase()) : null;
    if (!result) {
      log.warn("checkout result not found", { outcome: "not_found" });
      return withRequestId(NextResponse.json({ success: false, code: "NOT_FOUND", error: "Hasil checkout tidak ditemukan.", requestId: log.requestId },
        { status: 404, headers: { "Cache-Control": "no-store" } }), log);
    }
    log.info("owned checkout result read", { orderId: result.orderId, state: result.state });
    return withRequestId(NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "no-store" } }), log);
  } catch {
    log.error("checkout result read unavailable", { code: "POLICY_UNAVAILABLE" });
    return withRequestId(NextResponse.json({ success: false, code: "POLICY_UNAVAILABLE", error: "Status checkout belum dapat dibaca. Coba lagi dengan request yang sama.", requestId: log.requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } }), log);
  }
}
