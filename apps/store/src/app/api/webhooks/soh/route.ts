import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, auditLogs } from "@/db";
import {
  upsertSohRecords,
  type SohRecord,
} from "@marketplace/db/src/soh-sync";

/**
 * SOH (Stock-On-Hand) webhook — receives recurring product/stock master-data
 * updates pushed by the third-party supplier system (where the master data
 * lives). The first full load is done via the one-shot `db:import-soh` script;
 * this endpoint handles subsequent deltas/snapshots.
 *
 * Auth: header `X-SOH-Webhook-Secret` must equal `process.env.SOH_WEBHOOK_SECRET`
 * (same pattern as the `X-Cron-Secret` sweep endpoint). 503 if the secret is not
 * configured on the server, 401 on mismatch.
 *
 * Body: `{ "records": [ { ...SohRecord fields... } ] }` — field names mirror the
 * CSV columns (see SOH_CSV_HEADER_MAP in soh-sync.ts). Every field is coerced to
 * a string; missing/null/undefined → "". Rows missing ART or NamaGudang (the two
 * natural keys) are dropped before upsert.
 *
 * Semantics: upsert-only (additive / overwrite per record). This endpoint NEVER
 * deletes products/stock — retiring SKUs is a separate concern. branch_stock
 * reservedStock is never touched; new branches are created disabled ("nonaktif").
 *
 * An audit log row (action `SOH_SYNC_WEBHOOK`) records each call's summary.
 */

// Accept anything per field; coerce to string with "" for null/undefined/missing.
const flexString = z.preprocess(
  (v) => (v == null ? "" : v),
  z.coerce.string()
);

const sohRecordSchema = z.object({
  barcode: flexString,
  namaGudang: flexString,
  toko: flexString,
  brand: flexString,
  prdsgroup: flexString,
  sex: flexString,
  art: flexString,
  namaArtikel: flexString,
  size: flexString,
  rrp: flexString,
  disc: flexString,
  nett: flexString,
  status: flexString,
  season: flexString,
  total: flexString,
});

const payloadSchema = z.object({
  records: z.array(sohRecordSchema),
});

export async function POST(request: NextRequest) {
  const expected = process.env.SOH_WEBHOOK_SECRET;
  if (!expected) {
    console.error("soh-webhook: SOH_WEBHOOK_SECRET is not set on the server");
    return NextResponse.json(
      { success: false, error: "Webhook not configured" },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-soh-webhook-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const records = parsed.data.records.filter(
    (r) => r.art.trim() && r.namaGudang.trim()
  ) as SohRecord[];

  try {
    const summary = await upsertSohRecords(db, records);

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: null,
      action: "SOH_SYNC_WEBHOOK",
      entityType: "branch_stock",
      entityId: null,
      changes: { summary, recordCount: records.length },
      ipAddress: request.headers.get("x-forwarded-for") ?? null,
    });

    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error("soh-webhook: upsert failed:", error);
    return NextResponse.json(
      { success: false, error: "Sync failed" },
      { status: 500 }
    );
  }
}