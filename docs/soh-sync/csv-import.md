# CSV Import Tool (one-shot / full-snapshot refresh)

## When to use

- **First load** of the third-party SOH master data into the marketplace DB.
- **Refresh from a full snapshot** — the script is idempotent (re-runnable), so
  you can re-import a full CSV anytime to overwrite product/stock values.

For recurring incremental pushes, use the [webhook](./webhook.md) instead.
Mapping rules, invariants, and the `SohRecord` shape live in the
[README](./README.md).

## Commands (run from repo root)

### 1. Dry-run scan (writes nothing)

Aggregates the CSV exactly like the import does and reports entity counts +
natural-key collisions, so you can verify the slug/sku/id scheme **before** the
first real import:

```
npx tsx packages/db/src/soh-scan.ts                       # default CSV path
npx tsx packages/db/src/soh-scan.ts path/to/file.csv      # custom path
```

Output: `rows` / `valid` counts, then `branches / categories / products /
variants / stock rows / totalQty`, and any `SLUG` / `SKU` / `ART` / `CODE`
duplicates plus a sample of each entity. **Expect zero duplicates** for a clean
master file (the one known benign barcode collision is absorbed by
stock-summing).

### 2. Import

```
npm run db:import-soh                                 # default CSV path
npm run db:import-soh -- path/to/file.csv            # custom CSV path
```

`npm run db:import-soh` (root) → `cd packages/db && npm run db:import-soh` →
`npx tsx src/import-soh.ts`.

## Default CSV

`Dummy data SOH ALL Outlet.csv` at the **repo root**. The script runs from
`packages/db`, so the default path resolves to
`../../Dummy data SOH ALL Outlet.csv`. Override with a positional arg.

## What it does

1. Loads env from `../../.env` (needs `DATABASE_URL`).
2. Reads the CSV (strips a leading UTF-8 BOM; `relax_column_count: true` for
   ragged rows).
3. Maps each row to a `SohRecord` via `SOH_CSV_HEADER_MAP`.
4. Drops rows missing `ART` or `NamaGudang` (the two natural keys) — reports
   parsed / valid / skipped counts.
5. Calls `upsertSohRecords(db, validRecords)` → aggregate → batched upsert (see
   [README](./README.md) for the mapping & invariants).
6. Prints a JSON summary.

## Output summary

```
✅ Import complete: {
  "branches": 20,
  "categories": 5,
  "brands": 3,
  "genders": 3,
  "products": 10208,
  "variants": 37420,
  "stockRows": 71147,
  "totalQty": 197983
}
```

(Counts reflect the sample `Dummy data SOH ALL Outlet.csv`; your file may
differ.)

## Idempotency / re-runs

All upserts are keyed on natural keys and IDs are deterministic, so re-importing
the same CSV produces identical counts with no duplicates. Branch status is
**preserved** on re-import (a `nonaktif` branch is not reset). This makes the
script double as a "refresh from full snapshot" tool.

## Operational notes

- **No outer transaction** — upserts run in batches of 500 per entity, in FK
  order: branches → categories → brands → genders → products →
  `product_to_category` → `product_variants` → `branch_stock`. A mid-run failure
  leaves partial state, but re-running is safe (idempotent).
- New branches are created `nonaktif` (disabled). Stock is still imported for
  them but hidden from customers (storefront filters `status='aktif'`). Enable a
  branch via admin Cabang to expose its stock.
- After import, edit each branch's `city` / `address` / lat-lng / operating
  hours via admin Cabang — the import only sets placeholders
  (`city="Belum dikonfigurasi"`, `address=namaGudang`).
- `branch_stock.reservedStock` is never touched.

## Verification (after import)

- Spot-check a known product via psql / Drizzle Studio (example from the sample
  file): product with `article_number='HP2001'` → 2 variants (M, XS), each with
  a `barcode`, `price=600000`, `discount` (raw disc%), `basePrice=5250000`,
  `brand_id` → a `brand` row named `ADIDAS`, `gender_id` → a `gender` row named
  `Unisex` (CSV `sex`), `collection='RUNNING APP WOMEN'`.
- A branch like "ADFSport OUTLET SERPONG" → `status='nonaktif'`, has stock rows.
- `branch_stock.reserved_stock = 0` for all imported rows.
- Re-run the import → counts unchanged, no duplicate rows, branch status still
  `nonaktif`.