import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db, auditLogs } from "@/db";
import {
  syncOneProduct,
  fetchStocks,
  flattenStock,
  upsertJubelioStock,
} from "@marketplace/db/src/jubelio-sync";

/**
 * Jubelio webhook — receives push events from Jubelio (source of truth) when a
 * product/price/stock changes. Jubelio sends a minimal payload identifying the
 * changed entity; we re-fetch the current state from Jubelio and upsert.
 *
 * Setup: in Jubelio UI, Pengaturan → Developer → Webhook, set this URL as the
 * callback for `update-product`, `update-price`, `update-qty` and fill in the
 * Webhook Secret Key (must equal JUBELIO_WEBHOOK_SECRET). See docs/jubelio-sync.md.
 *
 * Auth: Jubelio signs `SHA256(rawBodyString + secret)`; we recompute from the
 * raw request body and compare. 503 if the secret is not configured, 401 on
 * mismatch (mirrors the X-SOH-Webhook-Secret pattern).
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
  const secret = process.env.JUBELIO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("jubelio-webhook: JUBELIO_WEBHOOK_SECRET is not set on the server");
    return NextResponse.json(
      { success: false, error: "Webhook not configured" },
      { status: 503 }
    );
  }

  const rawBody = await request.text();

  // Signature: SHA256(rawBody + secret), hex. Jubelio sends it in a header
  // (accept either common name since the spec shows it only in a screenshot).
  const provided =
    request.headers.get("webhook-signature") ||
    request.headers.get("x-jubelio-signature");
  const expected = createHash("sha256").update(rawBody + secret).digest("hex");
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
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
      console.warn("jubelio-webhook: unknown action:", action);
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

    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error("jubelio-webhook: sync failed:", error);
    // 500 → Jubelio will retry (up to 3×).
    return NextResponse.json(
      { success: false, error: "Sync failed" },
      { status: 500 }
    );
  }
}