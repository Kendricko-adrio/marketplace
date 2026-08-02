/**
 * import-soh — one-shot first-load migration of the third-party SOH CSV into
 * the marketplace DB. Re-runnable (idempotent upserts) so it doubles as a
 * "refresh from full snapshot" tool.
 *
 * Usage (from repo root):
 *   npm run db:import-soh                              # default CSV path
 *   npm run db:import-soh -- path/to/file.csv         # custom CSV path
 *
 * Run from packages/db (the npm script cd's here), so the default CSV path is
 * `../../Dummy data SOH ALL Outlet.csv` (repo root) and env is `../../.env`.
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import * as schema from "./schema";
import { upsertSohRecords, csvRowToSohRecord } from "./soh-sync";

async function main() {
  const csvPath = process.argv[2] ?? "../../Dummy data SOH ALL Outlet.csv";
  console.log(`📖 Reading CSV: ${csvPath}`);

  // Strip a leading UTF-8 BOM if present (readFileSync utf8 may include it).
  const raw = readFileSync(csvPath, "utf8").replace(/^﻿/, "");

  console.log("📋 Parsing CSV...");
  const rows = parse(raw, {
    columns: (cols: string[]) => cols.map((c) => (c ?? "").trim()),
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const records = rows.map(csvRowToSohRecord);
  const valid = records.filter((r) => r.art.trim() && r.namaGudang.trim());
  console.log(
    `Parsed ${records.length} rows (${valid.length} valid, ${
      records.length - valid.length
    } skipped — missing ART/NamaGudang).`
  );

  if (!valid.length) {
    console.error("❌ No valid rows to import. Aborting.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const summary = await upsertSohRecords(db, valid, {
      onProgress: (m) => console.log("  " + m),
    });
    console.log("✅ Import complete:", JSON.stringify(summary, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ Import failed:", e);
  process.exit(1);
});