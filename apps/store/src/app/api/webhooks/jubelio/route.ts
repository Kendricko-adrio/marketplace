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
import { requestLogger, serializeError } from "@/lib/logger";

/**
 * Jubelio webhook — receives push events from Jubelio (source of truth) when a
 * product/price/stock changes. Jubelio sends a minimal payload identifying the
 * changed entity; we re-fetch the current state from Jubelio and upsert.
 *
 * Setup: in Jubelio UI, Pengaturan → Developer → Webhook, set this URL as the
 * callback for `update-product`, `update-price`, `update-qty` and fill in the
 * Webhook Secret Key (must equal JUBELIO_WEBHOOK_SECRET). See docs/features/jubelio-sync.md.
 *
 * Auth: Jubelio signs `HMAC-SHA256(rawBodyString + secret, secret)`; we recompute from the
 * raw request body and compare. 503 if the secret is not configured, 401 on
 * mismatch (same pattern as the sweep cron's X-Cron-Secret).
 *
 * Payloads (per docs/jubelio-api/dist.yaml):
 *   update-product / update-price: { action, item_group_id, item_group_name }
 *   update-qty: { action, item_group_id, item_group_name, item_ids[], location_id }
 *
 * On upsert failure we return 500 so Jubelio retries (up to 3×); signature
 * failures return 401. An audit log row (JUBELIO_SYNC_WEBHOOK) records each
 * accepted call's outcome.
 */
export async function POST(request: NextRequest) {
  const log = requestLogger(request, { module: "jubelio-webhook" });
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
    log.error("Jubelio webhook signature rejected", {
      ...signatureDiagnostics,
      signatureHeader: request.headers.has("sign")
        ? "sign"
        : request.headers.has("webhook-signature")
          ? "webhook-signature"
          : request.headers.has("x-jubelio-signature")
            ? "x-jubelio-signature"
            : null,
      contentLength: request.headers.get("content-length"),
    });
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

    if (action === "update-product" || action === "update-price") {
      if (!itemGroupId) {
        log.error("Jubelio webhook is missing item_group_id", { action });
        return NextResponse.json(
          { success: false, error: "Missing item_group_id" },
          { status: 400 }
        );
      }
      const res = await syncOneProduct(db, itemGroupId);
      summary = { action, itemGroupId, ...res };
    } else if (action === "update-qty") {
      const itemIds = payload.item_ids ?? [];
      if (itemIds.length === 0) {
        log.error("Jubelio webhook is missing item_ids", { action });
        return NextResponse.json(
          { success: false, error: "Missing item_ids" },
          { status: 400 }
        );
      }
      const stockResp = await fetchStocks(itemIds);
      const rows = flattenStock(stockResp);
      const upserted = await upsertJubelioStock(db, rows);
      summary = { action, itemIds, stockRows: upserted };
    } else {
      // Unknown action — acknowledge so Jubelio doesn't retry, but log it.
      log.warn("Jubelio webhook action ignored", { action });
      summary = { action, ignored: true };
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

    log.info("Jubelio webhook processed", summary);
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    log.error("Jubelio webhook sync failed", {
      action,
      itemGroupId,
      error: serializeError(error),
    });
    // 500 → Jubelio will retry (up to 3×).
    return NextResponse.json(
      { success: false, error: "Sync failed" },
      { status: 500 }
    );
  }
}