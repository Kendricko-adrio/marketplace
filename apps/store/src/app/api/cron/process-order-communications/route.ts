import { NextRequest, NextResponse } from "next/server";
import { sweepOrderCommunications } from "@/features/order-communications/order-communication-sweep-service";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Cron komunikasi order (spec: penyelarasan status, notifikasi, dan email).
 *
 *   curl -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://<store-host>/api/cron/process-order-communications
 *
 * Endpoint adalah HTTP adapter: auth header secret, parse batch terbatas,
 * panggil satu service sweep, kembalikan counters aman tanpa PII. Tidak ada
 * query database atau provider call di route ini. Body tidak pernah membawa
 * recipient, HTML, order override, status pembayaran, atau instruksi provider
 * write.
 *
 * Jadwal yang diajukan setiap menit; polling mengambil batch terbatas dengan
 * urutan due-time/id stabil dan mengecualikan pekerjaan selesai.
 */

const log = createModuleLogger("process-order-communications");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Budget internal request: worker berhenti memulai tugas baru sebelum habis. */
const REQUEST_BUDGET_MS = 45_000;

class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

function parseLimit(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get("limit");
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

async function processOrderCommunications(
  request: NextRequest
): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("order communication sweep unavailable — CRON_SECRET is not configured");
    return NextResponse.json(
      { success: false, error: "Cron not configured" },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-cron-secret");
  if (!provided || provided !== expected) {
    log.warn("order communication sweep unauthorized");
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const limit = parseLimit(request);
  try {
    const summary = await sweepOrderCommunications({
      limit,
      now: new Date(),
      deadline: new Date(Date.now() + REQUEST_BUDGET_MS),
    });
    return NextResponse.json({
      success: true,
      limit,
      projected: summary.projected,
      emailJobsCreated: summary.emailJobsCreated,
      notificationsCreated: summary.notificationsCreated,
      claimed: summary.claimed,
      sent: summary.sent,
      retry: summary.retry,
      failed: summary.failed,
      superseded: summary.superseded,
    });
  } catch {
    log.error(
      "order communication sweep failed",
      new RouteLogError("order communication sweep failed")
    );
    return NextResponse.json(
      { success: false, error: "Sweep unavailable" },
      { status: 503 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik. */
export const POST = withRequestContext(
  processOrderCommunications,
  "process-order-communications"
);
