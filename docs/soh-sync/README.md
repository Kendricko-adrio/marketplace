# SOH Third-Party Master-Data Sync

## Overview

The third-party supplier system owns the product & stock **master data**
(Stock-On-Hand / SOH). The marketplace DB is a **push-managed replica**: data
flows supplier → marketplace, never the other way. Two sync paths share one
module (`packages/db/src/soh-sync.ts`):

| Path | When | Entry point | Reads |
|---|---|---|---|
| One-shot import (CSV) | first full load, or refresh from a full snapshot | `npm run db:import-soh` → `packages/db/src/import-soh.ts` | CSV file |
| Recurring updates (webhook) | deltas / snapshots pushed by the supplier | `POST /api/webhooks/soh` (store app) → `apps/store/src/app/api/webhooks/soh/route.ts` | JSON body |

Both call `upsertSohRecords(db, records)` from `soh-sync.ts` (`db` injected by
the caller — the script uses the `packages/db` pool; the store app uses its own
local `db`).

Detailed guides:
- [CSV import tool](./csv-import.md)
- [Webhook endpoint](./webhook.md)
- Endpoint reference (all APIs): [`../api-reference.md`](../api-reference.md)
- Deployment / operational steps: `deployment/README.md` §10.6

## File map

| File | Role |
|---|---|
| `packages/db/src/soh-sync.ts` | Shared pure logic: `SohRecord` type, CSV-row mapping, aggregation, idempotent upsert. `db` injected by caller. |
| `packages/db/src/import-soh.ts` | One-shot CSV import script (CLI). |
| `packages/db/src/soh-scan.ts` | Dry-run CSV scan (counts + collision check, writes nothing). |
| `apps/store/src/app/api/webhooks/soh/route.ts` | Webhook endpoint (store app). |
| `packages/db/src/schema/products.ts` | Schema columns added for SOH (see below). |
| `packages/db/drizzle/0004_adorable_valkyrie.sql` | Migration that added those columns. |

## The SOH record

Both paths ingest the same row shape — `SohRecord` in `soh-sync.ts`.
**Field names are the lowercase `SohRecord` names**, NOT the CSV column names
(e.g. `disc`, not `disc%`; `prdsgroup`, not `PRDSGROUP`). The CSV importer maps
CSV headers → these fields via `SOH_CSV_HEADER_MAP`; the webhook expects these
field names directly.

| SohRecord field | CSV header | Aggregation | DB target |
|---|---|---|---|
| `barcode` | `Barcode` | first non-empty per variant | `product_variant.barcode` |
| `namaGudang` | `NamaGudang` | per-branch name | `branches.name` |
| `toko` | `Toko` | per-branch code (falls back to `namaGudang`) | `branches.code` |
| `brand` | `Brand` | most-frequent per ART → brand slug | `brand.name`/`brand.slug` + `product.brand_id` |
| `prdsgroup` | `PRDSGROUP` | most-frequent per ART → category | `category.name` + `product_to_category` |
| `sex` | `sex` | most-frequent per ART → gender slug | `gender.name`/`gender.slug` + `product.gender_id` |
| `art` | `ART` | **product natural key** | `product.articleNumber` |
| `namaArtikel` | `NamaArtikel` | longest non-empty per ART | `product.name` |
| `size` | `Size` | per-variant | `product_variant.size` |
| `rrp` | `RRP` | first non-empty per ART | `product.basePrice` |
| `disc` | `disc%` | `disc` from the modal `(nett,disc)` pair per variant | `product_variant.discount` |
| `nett` | `Nett` | most-frequent per `(ART, Size)` | `product_variant.price` |
| `status` | `STATUS` | most-frequent per ART | `product.collection` (**NOT** `product.status`) |
| `season` | `Season` | most-frequent per ART | `product.season` |
| `total` | `Total` | **summed** per `(branch, variant)` | `branch_stock.stock` |

Every field is coerced to a string; `null`/`undefined`/missing → `""`. Rows
missing `art` **or** `namaGudang` (the two natural keys) are dropped before
upsert.

## How rows map to DB entities (aggregation)

A single pass over the records groups them:

- **Product** = group by `ART`. Name = longest non-empty `NamaArtikel`
  (fallback: ART). Brand / gender / season / collection / prdsgroup =
  most-frequent non-empty value (mode). Brand & gender are normalized: the modal
  value is upserted into the `brands` / `genders` dimension tables (by slug) and
  the product links via `brandId` / `genderId`; season / collection stay
  free-text. `basePrice` = first non-empty RRP.
- **Variant** = group by `(ART, Size)`. `price` = modal `Nett`; `discount` =
  the `disc` from the modal `(nett, disc)` pair; `barcode` = first non-empty;
  `size` as-is; `isDefault` = first variant per product; `color` = null.
- **Branch** = group by `NamaGudang`; `code` = `Toko`.
- **Category** = from the modal `PRDSGROUP` per product; linked via
  `product_to_category`.
- **Stock** = `Total` **summed** per `(branch, variant)`. Summing is a safety
  net for the one known benign barcode collision (Size `4` vs `4-` on the same
  outlet share one barcode but are distinct variants).

## DB targets (upsert)

| Table | Natural key (conflict target) | Columns SET on upsert | Columns PRESERVED |
|---|---|---|---|
| `branches` | `code` | `name` | `status`, `city`, `address`, lat/lng, `operatingHours`, `googleMapsUrl` |
| `categories` | `slug` | `name` | `isActive`, `icon`, `image`, `description` (defaults) |
| `brands` | `slug` | `name` | (sync-managed dimension, no admin CRUD) |
| `genders` | `slug` | `name` | (sync-managed dimension, no admin CRUD) |
| `products` | `articleNumber` | `name`, `slug`, `basePrice`, `brandId`, `genderId`, `season`, `collection` | `status`, `description`, images |
| `product_to_category` | composite PK | (insert only, do-nothing on conflict) | — |
| `product_variants` | `sku` | `size`, `price`, `barcode`, `discount` | `color`, `isDefault`, images |
| `branch_stock` | `(branchId, productVariantId)` | `stock` | **`reservedStock` (NEVER)** |

Derived values:
- `product.slug` = `slugify(name) + "-" + slugify(ART)`
- `product.status` = `"aktif"` (default — **not** from CSV `STATUS`)
- `product_variant.sku` = `` `${ART}-${Size}` `` (internal whitespace → `-`)
- branch placeholders: `city = "Belum dikonfigurasi"`, `address = namaGudang`
  — fix via admin Cabang after import.

## IDs (deterministic)

`keyId(prefix, key)` = `prefix + sha1(key).slice(0, 24)` — stable across re-runs
so FK links (variant → product, `branch_stock` → variant/branch) don't drift,
and no `returning()` is needed.

- product: `soh:product:` + ART
- variant: `soh:variant:` + (ART + " " + Size)
- branch: `soh:branch:` + toko
- category: `soh:category:` + slug
- brand: `soh:brand:` + slugify(brand name)
- gender: `soh:gender:` + slugify(gender value)

## Invariants (do NOT violate when editing sync code)

- `branch_stock.reservedStock` is **NEVER** written by sync — runtime-managed by
  the checkout flow only (see the stock-reservation design + sweep cron).
- New branches insert as `status="nonaktif"` (disabled) until an admin enables
  them; existing branches keep their status (status is **not** updated on
  conflict). Stock is still imported for disabled branches but hidden from
  customers (storefront filters `status='aktif'`).
- `product.status` is **not** set from CSV `STATUS` — CSV `STATUS` →
  `product.collection` (a text label). `product.status` stays `"aktif"`.
- `disc%` is stored **raw** as text on `product_variant.discount` (mixed
  int/decimal formats preserved as-is; interpretation is a separate task).
- The former `product.rating / sold / isFlashSale / flashSalePrice / flashSaleEndsAt`
  columns have been **removed** from the schema — they were never written by
  sync and are no longer part of the `products` table. `product_variants.discount`
  (raw CSV `disc%`) is still written by sync but is not used for display.
- Sync is **upsert-only — never deletes**. Retiring SKUs that vanish from master
  data is a separate, unimplemented concern.
- `brand` and `gender` are normalized dimensions: the modal `Brand` / `sex` per
  ART is upserted into the `brands` / `genders` tables (by slug, deterministic
  sha1 id via `keyId`) and linked to the product via `brandId` / `genderId`. They
  are **sync-managed** — no admin CRUD. The old free-text `product.brand` /
  `product.gender` columns were dropped (migrations `0006` + `0007`).
- `color` and `isDefault` on existing variants are preserved (admin edits not
  overwritten).

## Env / secret

| Var | Used by | Where to set |
|---|---|---|
| `SOH_WEBHOOK_SECRET` | webhook auth (`X-SOH-Webhook-Secret`) | **Dev**: root `.env` (the store app loads `../../.env` via `next.config.ts`, then `apps/store/.env.local` overrides). **Prod**: `deployment/.env.production` (already wired in `docker-compose.yml` as `SOH_WEBHOOK_SECRET: ${SOH_WEBHOOK_SECRET}`). Generate: `openssl rand -hex 32`. |
| `DATABASE_URL` | import script (`packages/db` pg Pool) | root `.env` (the script loads `../../.env`). |

`SOH_WEBHOOK_SECRET=` is already present in the templates: root `.env.example`,
`deployment/.env.staging.example`, `deployment/.env.production.example`.

## Schema columns added

Migration `packages/db/drizzle/0004_adorable_valkyrie.sql`:
- `product`: `article_number` (unique), `brand`, `gender`, `season`, `collection`
- `product_variant`: `barcode` (indexed `product_variant_barcode_idx`), `discount`

Migrations `packages/db/drizzle/0006_low_snowbird.sql` +
`0007_cuddly_hellion.sql` (normalize brand/gender — see
[product-filters.md](../product-filters.md)):
- new dimension tables `brand` and `gender` (`id`, `name`, `slug` unique, timestamps)
- `product`: `brand_id` and `gender_id` FKs (nullable) → `brand.id` / `gender.id`
- `product`: the free-text `brand` and `gender` columns are **dropped**

> This DB is **`db:push`-managed** (no `__drizzle_migrations` journal) —
> `db:migrate` fails (it replays from 0001). Use `db:push` (interactive) or apply
> the migration SQL directly. See `deployment/README.md`.