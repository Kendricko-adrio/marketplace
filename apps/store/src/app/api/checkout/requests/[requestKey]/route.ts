import { NextResponse, type NextRequest } from "next/server";
import { requireOnboardedApiSession } from "@/lib/route-access";
import { readCheckoutResult } from "@/lib/checkout-request";
import {
  createModuleLogger,
  getRequestId,
  withRequestContext,
} from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("checkout-request-read");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Next/provider
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/** Lookup milik client saja; tidak memanggil dispatcher atau payment initializer. */
async function readOwnedCheckoutResult(
  _request: NextRequest,
  { params }: { params: Promise<{ requestKey: string }> }
): Promise<Response> {
  try {
    const access = await requireOnboardedApiSession();
    if (!access.ok) return access.response;
    const { requestKey } = await params;
    const result = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)
      ? await readCheckoutResult(access.session.user.id, requestKey.toLowerCase()) : null;
    if (!result) {
      // Path param tidak pernah masuk log: nilainya input klien dan bisa
      // berisi teks bebas di luar bentuk UUID.
      log.warn("checkout result not found");
      return NextResponse.json({ success: false, code: "NOT_FOUND", error: "Hasil checkout tidak ditemukan.", requestId: getRequestId() },
        { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    log.info(`owned checkout result read: order ${result.orderId}, state ${result.state}`);
    return NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    log.error(
      "checkout result read unavailable (POLICY_UNAVAILABLE)",
      new RouteLogError("checkout result read unavailable")
    );
    return NextResponse.json({ success: false, code: "POLICY_UNAVAILABLE", error: "Status checkout belum dapat dibaca. Coba lagi dengan request yang sama.", requestId: getRequestId() },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const GET = withRequestContext(
  readOwnedCheckoutResult,
  "checkout-request-read"
);
