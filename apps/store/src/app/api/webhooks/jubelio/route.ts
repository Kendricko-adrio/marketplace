import { NextRequest, NextResponse } from "next/server";
import { db, auditLogs } from "@/db";
import {
  syncOneProduct,
  fetchStocks,
  flattenStock,
  upsertJubelioStock,
} from "@marketplace/db/src/jubelio-sync";
import {
  getJubelioSignature,
  inspectJubelioSignature,
} from "@/lib/jubelio-webhook";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

/**
 * Module logger untuk route ini: dibuat sekali di module scope, sedangkan
 * `requestId` dibaca dari scope HTTP yang aktif setiap kali log ditulis
 * (`withRequestContext` di export handler membuka scope tersebut).
 */
const log = createModuleLogger("jubelio-webhook");

/**
 * Proyeksi teknis statis untuk field `error`: pesan asli dari DB/Jubelio/Next
 * tidak pernah masuk log, hanya pesan yang ditulis module ini.
 */
class RouteLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteLogError";
  }
}

/**
 * Jubelio webhook — menerima push event dari Jubelio (source of truth) saat
 * produk/harga/stok berubah. Jubelio mengirim payload minimal yang menyebut
 * entity yang berubah; kita mengambil ulang state terkini dari Jubelio lalu
 * upsert.
 *
 * Setup: di Jubelio UI, Pengaturan → Developer → Webhook, set URL ini sebagai
 * callback untuk `update-product`, `update-price`, `update-qty` dan isi
 * Webhook Secret Key (harus sama dengan JUBELIO_WEBHOOK_SECRET). Lihat docs/features/jubelio-sync.md.
 *
 * Auth: Jubelio menandatangani `HMAC-SHA256(rawBodyString + secret, secret)`; kita hitung
 * ulang dari raw request body dan bandingkan. 503 bila secret belum
 * dikonfigurasi, 401 bila tidak cocok (pola sama dengan X-Cron-Secret pada
 * cron sweep).
 *
 * Payloads (per docs/jubelio-api/dist.yaml):
 *   update-product / update-price: { action, item_group_id, item_group_name }
 *   update-qty: { action, item_group_id, item_group_name, item_ids[], location_id }
 *
 * Bila upsert gagal kita balas 500 supaya Jubelio retry (maksimal 3×); kegagalan
 * signature dibalas 401. Satu baris audit log (JUBELIO_SYNC_WEBHOOK) mencatat
 * outcome setiap panggilan yang diterima. Raw body/header tidak pernah masuk log.
 */

/** HTTP adapter webhook: verifikasi HMAC, refetch entity, upsert, audit. */
async function jubelioWebhook(request: NextRequest): Promise<Response> {
  const secret = process.env.JUBELIO_WEBHOOK_SECRET;
  if (!secret) {
    log.error("Jubelio webhook is not configured");
    return NextResponse.json(
      { success: false, error: "Webhook not configured" },
      { status: 503 }
    );
  }

  const rawBody = await request.text();

  // Signature: HMAC-SHA256(rawBody + secret, secret), hex, sent in `Sign`.
  // Keep the historical aliases for compatibility with existing integrations.
  const provided = getJubelioSignature(request.headers);
  const { valid: signatureValid, ...signatureDiagnostics } =
    inspectJubelioSignature(rawBody, secret, provided);
  if (!signatureValid) {
    // Hanya diagnostik teknis ber-prefix (tidak ada secret/signature utuh/body).
    const signatureHeader = request.headers.has("sign")
      ? "sign"
      : request.headers.has("webhook-signature")
        ? "webhook-signature"
        : request.headers.has("x-jubelio-signature")
          ? "x-jubelio-signature"
          : null;
    log.error(
      `Jubelio webhook signature rejected (reason ${signatureDiagnostics.reason}, header ${
        signatureHeader ?? "none"
      }, bodyBytes ${signatureDiagnostics.bodyBytes}, bodyHashPrefix ${
        signatureDiagnostics.bodyHashPrefix
      }, expectedSignaturePrefix ${signatureDiagnostics.expectedSignaturePrefix}, providedSignaturePrefix ${
        signatureDiagnostics.providedSignaturePrefix ?? "none"
      }, secretFingerprint ${signatureDiagnostics.secretFingerprint}, contentLength ${
        request.headers.get("content-length") ?? "none"
      })`
    );
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    log.error("Jubelio webhook body is invalid JSON");
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const payload = body as {
    action?: string;
    item_group_id?: number;
    item_ids?: number[];
  };
  const action = payload.action ?? "";
  const itemGroupId = payload.item_group_id;

  try {
    let summary: Record<string, unknown> = { action };
    // Ringkasan log yang aman: angka + id numerik, bukan teks provider.
    let logSummary = "action tidak dikenal";

    if (action === "update-product" || action === "update-price") {
      if (!itemGroupId) {
        log.error(`Jubelio webhook is missing item_group_id (action ${action})`);
        return NextResponse.json(
          { success: false, error: "Missing item_group_id" },
          { status: 400 }
        );
      }
      const res = await syncOneProduct(db, itemGroupId);
      summary = { action, itemGroupId, ...res };
      logSummary = `action ${action}, itemGroupId ${itemGroupId}, variants ${res.variants}, stockRows ${res.stockRows}`;
    } else if (action === "update-qty") {
      const itemIds = payload.item_ids ?? [];
      if (itemIds.length === 0) {
        log.error("Jubelio webhook is missing item_ids (action update-qty)");
        return NextResponse.json(
          { success: false, error: "Missing item_ids" },
          { status: 400 }
        );
      }
      const stockResp = await fetchStocks(itemIds);
      const rows = flattenStock(stockResp);
      const upserted = await upsertJubelioStock(db, rows);
      summary = { action, itemIds, stockRows: upserted };
      logSummary = `action update-qty, items ${itemIds.length}, stockRows ${upserted}`;
    } else {
      // Unknown action — acknowledge so Jubelio doesn't retry, but log it.
      // Nilai `action` dari provider tidak pernah masuk `message`.
      log.warn("Jubelio webhook action ignored (unknown action)");
      summary = { action, ignored: true };
      logSummary = "action diabaikan (unknown action)";
    }

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: null,
      action: "JUBELIO_SYNC_WEBHOOK",
      entityType: "product",
      entityId: itemGroupId != null ? String(itemGroupId) : null,
      changes: summary,
      ipAddress: request.headers.get("x-forwarded-for") ?? null,
    });

    log.info(`Jubelio webhook processed: ${logSummary}`);
    return NextResponse.json({ success: true, ...summary });
  } catch {
    log.error("Jubelio webhook sync failed", new RouteLogError("Jubelio webhook sync failed"));
    // 500 → Jubelio will retry (up to 3×).
    return NextResponse.json(
      { success: false, error: "Sync failed" },
      { status: 500 }
    );
  }
}

/** HTTP entry: wrapper menambahkan `x-request-id` kanonik + satu baris completion. */
export const POST = withRequestContext(jubelioWebhook, "jubelio-webhook");
