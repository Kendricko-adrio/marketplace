/**
 * soh-scan — dry-run diagnostic: aggregate the SOH CSV the same way import-soh
 * does, but write nothing. Reports entity counts + natural-key collisions so
 * the slug/sku/id scheme can be verified BEFORE the first real import.
 *
 *   npx tsx src/soh-scan.ts [path/to/file.csv]
 */

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { aggregateSohRecords, csvRowToSohRecord } from "./soh-sync";

const csvPath = process.argv[2] ?? "../../Dummy data SOH ALL Outlet.csv";
const raw = readFileSync(csvPath, "utf8").replace(/^﻿/, "");
const rows = parse(raw, {
  columns: (cols: string[]) => cols.map((c) => (c ?? "").trim()),
  trim: true,
  skip_empty_lines: true,
  relax_column_count: true,
}) as Record<string, string>[];

const records = rows
  .map(csvRowToSohRecord)
  .filter((r) => r.art.trim() && r.namaGudang.trim());
console.log(`rows: ${rows.length}, valid: ${records.length}`);

const agg = aggregateSohRecords(records);

function dups(keys: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].filter(([, c]) => c > 1);
}

const slugDups = dups(agg.products.map((p) => p.slug));
const skuDups = dups(agg.variants.map((v) => v.sku));
const artDups = dups(agg.products.map((p) => p.articleNumber));
const codeDups = dups(agg.branches.map((b) => b.code));
const catSlugDups = dups(agg.categories.map((c) => c.slug));
const brandSlugDups = dups(agg.brands.map((b) => b.slug));
const genderSlugDups = dups(agg.genders.map((g) => g.slug));

console.log("=== SOH aggregation scan ===");
console.log(`branches: ${agg.branches.length} (code dups: ${codeDups.length})`);
console.log(
  `categories: ${agg.categories.length} (slug dups: ${catSlugDups.length})`
);
console.log(`brands: ${agg.brands.length} (slug dups: ${brandSlugDups.length})`);
console.log(`genders: ${agg.genders.length} (slug dups: ${genderSlugDups.length})`);
console.log(
  `products: ${agg.products.length} (articleNumber dups: ${artDups.length}, slug dups: ${slugDups.length})`
);
console.log(`variants: ${agg.variants.length} (sku dups: ${skuDups.length})`);
console.log(`stock rows: ${agg.stock.length}`);
console.log(`totalQty: ${agg.stock.reduce((a, s) => a + s.stock, 0)}`);
if (slugDups.length) console.log("SLUG DUPS:", slugDups.slice(0, 10));
if (skuDups.length) console.log("SKU DUPS:", skuDups.slice(0, 10));
if (artDups.length) console.log("ART DUPS:", artDups.slice(0, 10));
if (codeDups.length) console.log("CODE DUPS:", codeDups.slice(0, 10));
console.log("sample branch:", agg.branches[0]);
console.log("sample category:", agg.categories[0]);
console.log("sample product:", agg.products[0]);
console.log("sample variant:", agg.variants[0]);