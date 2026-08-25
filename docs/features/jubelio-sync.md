# Jubelio Master-Data Sync

Jubelio (`https://api2.jubelio.com`) is the third-party source of truth for the
product catalog, prices, images, and per-branch stock. This document describes
how the marketplace syncs from Jubelio, replacing the older CSV-based SOH sync
(see memory `soh-sync-design`). OpenAPI spec:
`docs/jubelio-api/dist.yaml`.

## Data model (verified live)

| Jubelio | Our table | Natural key (our side) | Notes |
|---|---|---|---|
| `item_group` (`item_group_id`, `item_group_name`, `sell_price`, `description`, `selected_brand_name`, `thumbnail`, `images[]`) | `product` | `jubelio_item_group_id` (unique) | `base_price` = group `sell_price`; `thumbnail` = card image; `images` JSONB = gallery from `/inventory/catalog/{id}` |
| `item` / sku (`item_id`, `item_code`, `sell_price`, `barcode`, `variation_values`) | `product_variant` | `jubelio_item_id` (unique) | `sku` = `item_code` (GTIN); `price` = variant `sell_price`; `size`/`color` from `variation_values` (`Ukuran`→size, `Warna`→color) |
| `location` (`location_id`, `location_code`, `location_name`) | `branch` | `jubelio_location_id` (unique) | Source: `GET /locations/list` (NOT `/locations/`, which returns only the webstore). `code` = `location_code`. **This is the branch** — not the channel. |
| stock: `(item_id, location_id)` `on_hand`/`available` | `branch_stock` | composite `(branchId, productVariantId)` | `stock` = `on_hand`. Catalog sync never writes checkout counters (`reservedStock`, `pendingRemoteStock`). |
| `category` (`category_id`, `category_name`) | `category` | `jubelio_category_id` (unique) | Created **on demand** — only categories used by synced products (see decision 8). Upserted by slug (merges with CSV-SOH categories). |
| `selected_brand_name` | `brand` | `slug` | Upserted by slug per product (create if new, link if existing). |

**Branches are locations, not channels.** Jubelio `channel_id` (64 = Shopee,
128 = Tokopedia, 32 = Blibli, 4 = Lazada) is a sales channel, not a branch.
Stock is tracked per location (physical outlet). `GET /locations/` returns only
the webstore ("WEBSITE ADF"); use `GET /locations/list` to get all ~25 outlets.
Non-outlet staging locations (Transit, MONO/MULTI *, WEBSITE ADF) are skipped —
see `JUBELIO_SKIP_LOCATIONS` env.

## Architecture (mirrors SOH sync)

Three entry points share `packages/db/src/jubelio-sync.ts`:

1. **One-shot full pull** — `npm run db:import-jubelio`
   (`packages/db/src/import-jubelio.ts`). Paginates `/inventory/items/masters`,
   enriches each product via `/inventory/catalog/{item_group_id}`, fetches
   per-branch stock via `POST /inventory/items/all-stocks/`, upserts
   page-by-page. Re-runnable (idempotent upserts).
2. **Webhook (recurring deltas)** — `POST /api/webhooks/jubelio`
   (`apps/store/src/app/api/webhooks/jubelio/route.ts`). Jubelio pushes
   `update-product` / `update-price` / `update-qty` events; the handler
   re-fetches the affected entity and upserts. Signature-verified.
3. **Admin per-product sync** — `POST /api/admin/products/{id}/sync`
   (`apps/admin/src/app/api/admin/products/[id]/sync/route.ts`), triggered by
   the "Sync dari Jubelio" button on the admin product detail page. Calls
   `syncOneProduct(db, item_group_id)`.

## Checkout stock adjustments

Checkout writes use a separate gateway in
`apps/store/src/lib/jubelio-stock-client.ts`:

- `POST /inventory/adjustments/` with negative `qty_in_base` reserves stock.
- The same endpoint with positive `qty_in_base` compensates a failed or
  expired payment.
- `GET /inventory/items/to-stock/{location_id}` supplies unit/cost metadata.
- `GET /wms/default-bin/{location_id}` supplies `bin_id`.
- `POST /inventory/items/all-stocks/` confirms absolute on-hand after a write.
- `GET /inventory/adjustments/` is searched by the unique operation note after
  ambiguous timeouts.

The marketplace does not retry an ambiguous POST blindly. Durable operation
state and the unique note make crash recovery and reconciliation fail-closed.
See `docs/features/stock-reservation.md`.

## Auth

`POST /login` `{email, password}` → `{token}` (12h expiry). The client caches
the token and auto re-logins on 401. Env: `JUBELIO_EMAIL`, `JUBELIO_PASSWORD`,
`JUBELIO_API_BASE_URL` (default `https://api2.jubelio.com`).

## Invariants (do NOT violate)

- `branch_stock.reservedStock` and `pendingRemoteStock` are **never** written by
  catalog sync (checkout-managed only).
- New branches upsert as `status:"nonaktif"`; existing branches keep status.
  Exception: the **import script** (`db:import-jubelio`) forces `status:"aktif"`
  + fixed operating hours (Mon–Sun 07:00–22:00) on every pulled branch, and
  skips the "Dago 123" location (see `upsertJubelioBranches` options).
- Upserts keyed on Jubelio natural keys → idempotent re-runs.
- Brand/category linked by **slug lookup** (not a computed prefixed id) so
  Jubelio rows coexist with pre-existing CSV-SOH rows.
- Sync is upsert-only — never deletes products/stock. The product gallery
  (`product.images` JSONB) is overwritten per product on sync.
- Image URLs are **hotlinked** from the Jubelio CDN — never downloaded to local
  storage.
- `product.status` is set only on insert; admin edits to status are preserved
  on re-sync. `isDefault` on variants is preserved on re-sync.

## Decisions (locked)

1. Branch = Jubelio location outlet (`/locations/list`; `location_code` → `branch.code`).
2. Product-level images: `product.thumbnail` (card) + `product.images` JSONB
   (gallery from `/inventory/catalog/{id}` `images[]`). Legacy variant-level
   `product_image` table kept but no longer read/written by new code.
3. Price: `product.base_price` = group `sell_price`; `product_variant.price` =
   variant `sell_price` (no discount / `hasDiscount` = false).
4. `gender` / `season` / `collection`: not populated by Jubelio (stay null).
5. Brand: upsert per-product by slug (create if new, link if existing).
6. `JUBELIO_SYNC_MAX_PRODUCTS` env caps the import for fast dev testing
   (empty = all).
7. Admin product CRUD removed (Jubelio is source of truth); replaced by the
   per-product Sync button.
8. Categories are created **on demand**, not bulk-imported: the import script
   and webhook only ensure the categories used by the products they sync
   (`ensureJubelioCategories`). The full ~1.6k Jubelio tree is never imported
   wholesale, so our `category` table stays in sync with the products we
   carry. The webhook path checks our DB first and only fetches the Jubelio
   tree when the product's category is actually missing.

## Env

| Var | Purpose | Default |
|---|---|---|
| `JUBELIO_API_BASE_URL` | API base | `https://api2.jubelio.com` |
| `JUBELIO_EMAIL` / `JUBELIO_PASSWORD` | login creds | — |
| `JUBELIO_CHANNEL_ID` | reserved (Shopee=64) | `64` |
| `JUBELIO_WEBHOOK_SECRET` | webhook signature secret | — |
| `JUBELIO_SYNC_CONCURRENCY` | parallel catalog fetches during import | `5` |
| `JUBELIO_SYNC_MAX_PRODUCTS` | cap products synced (empty = all) | empty |
| `JUBELIO_SYNC_START_PAGE` | masters page to start/resume from | `1` |
| `JUBELIO_SKIP_LOCATIONS` | comma-sep non-outlet location names to skip as branches | `Transit,WEBSITE ADF,MONO *,MULTI *` |
| `APP_ENV` | safety boundary for stock writes (`production` is the only live value) | `NODE_ENV` |
| `JUBELIO_MOCK_API_BASE_URL` | stateful mock used by every non-production environment | `http://127.0.0.1:3002` |
| `JUBELIO_STOCK_WRITES_ENABLED` | explicit production live-write kill switch | `false` |
| `JUBELIO_ADJUSTMENT_ACCOUNT_ID` | Jubelio account id in adjustment line items | `75` |
| `JUBELIO_STOCK_TIMEOUT_MS` | HTTP timeout; a POST timeout is treated as ambiguous | `8000` |

## Webhook setup (operational)

1. Generate a secret: `openssl rand -hex 32`. Set it as `JUBELIO_WEBHOOK_SECRET`
   in `.env` (store app) and as the **Webhook Secret Key** in Jubelio.
2. In Jubelio UI: **Pengaturan → Developer → Webhook**. Add the callback URL
   `https://<store-domain>/api/webhooks/jubelio` for actions `update-product`,
   `update-price`, `update-qty`.
3. Jubelio sends `HMAC-SHA256(rawBody + secret, secret)` in the `Sign` header. The handler
   also accepts the legacy `webhook-signature` and `x-jubelio-signature`
   aliases. Jubelio retries up to 3× if the endpoint returns non-200. The
   handler returns 500 on upsert failure (so Jubelio retries), 401 on bad
   signature, and 503 if the secret is unset.

## Schema

Additive only: `product.jubelio_item_group_id` + `product.thumbnail` +
`product.images` (jsonb) + `product_variant.jubelio_item_id` +
`branch.jubelio_location_id` + `category.jubelio_category_id` (each integer
unique nullable). The legacy variant-level `product_image` table is kept
untouched. The seeder now also sets `product.thumbnail` + `product.images` for
sample products.

Migration `0013_absurd_vampiro.sql` adds
`branch_stock.pending_remote_stock` and `jubelio_stock_operation`. The latter
stores the reserve/release type, unique note, item mapping, remote adjustment
id, retry state, and diagnostic error.

## Verification

- `npm run db:generate` → review `0010_*.sql`, `npm run db:push`.
- `JUBELIO_SYNC_MAX_PRODUCTS=20 npm run db:import-jubelio` → check
  `product`/`product_variant`/`branch`/`branch_stock` rows + `product.thumbnail`
  + `product.images`.
- `npm run dev:store` → `/products` cards + product detail gallery show Jubelio
  images.
- `npm run dev:admin` → product list (read-only) + detail page Sync button.
- POST a signed `update-qty` payload to `/api/webhooks/jubelio` → 200 + audit
  row + `branch_stock` update.
