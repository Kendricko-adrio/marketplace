# Sync Jubelio (import + webhook)

Jubelio adalah source of truth untuk katalog produk, harga, gambar, dan stok
per-cabang. Lihat `docs/features/jubelio-sync.md` untuk detail lengkap (data model,
invariant, mapping). Tiga entry point berbagi `packages/db/src/jubelio-sync.ts`:
one-shot import script, webhook push, dan tombol Sync per-produk di admin.

## A. Env yang diperlukan (service `store` + `admin`)

```
JUBELIO_API_BASE_URL=https://api2.jubelio.com
JUBELIO_EMAIL=<email-jubelio>
JUBELIO_PASSWORD=<password-jubelio>
JUBELIO_WEBHOOK_SECRET=<openssl rand -hex 32>
JUBELIO_SYNC_CONCURRENCY=5
JUBELIO_SYNC_MAX_PRODUCTS=      # kosong = fetch semua; integer = cap untuk testing
```

> Wire semua `JUBELIO_*` ke service `store` dan `admin` di `docker-compose.yml`
> (mirip `CRON_SECRET`).

## A.1 Stock adjustment safety

Checkout now uses the Sales Order gateway exclusively. The adjustment checkout
and stock-write account mapping below are historical, not active checkout
settings; see [Jubelio Sales Orders](../features/jubelio-sales-orders.md)
for the current runtime gates and settlement.

Staging runs `jubelio-mock` as a private Compose service
(`JUBELIO_MOCK_API_BASE_URL=http://jubelio-mock:3002`). Repo default untuk
staging:

```env
APP_ENV=staging
JUBELIO_MOCK_API_BASE_URL=http://jubelio-mock:3002
JUBELIO_STOCK_WRITES_ENABLED=false
JUBELIO_ADJUSTMENT_PLUS_ACCOUNT_ID=
JUBELIO_ADJUSTMENT_MINUS_ACCOUNT_ID=
JUBELIO_STOCK_TIMEOUT_MS=8000
JUBELIO_STOCK_MAX_REQUESTS_PER_MINUTE=450
JUBELIO_STOCK_CONCURRENCY=10
JUBELIO_STOCK_MAX_QUEUED=1000
JUBELIO_STOCK_QUEUE_TIMEOUT_MS=5000
```

> **KONFIGURASI VPS STAGING SAAT INI (sengaja menyimpang dari default
> repo):** di server, `deployment/staging/docker-compose.yml` di-set
> `APP_ENV=production` + `JUBELIO_STOCK_WRITES_ENABLED=true` — keputusan
> operasional karena operator **diizinkan memotong stok langsung ke
> Jubelio live** dari environment ini. Konsekuensinya: checkout di staging
> mengurangi stok Jubelio **nyata**; perlakukan staging seperti production
> untuk alur stok (uji data disposable jangan menyentuh alur checkout
> stok). Gateway live tetap menuntut `NODE_ENV=production` + host HTTPS
> `https://api2.jubelio.com` — keduanya terpenuhi. Mock tetap jalan sebagai
> service untuk keperluan lain.

Production sets `APP_ENV=production`, but live writes remain disabled until
this explicit value is changed and the store container is restarted:

```env
JUBELIO_STOCK_WRITES_ENABLED=true
```

The gateway resolves `adjp_acct_id` and `adjm_acct_id` from
`GET /systemsetting/account-mapping`. The plus/minus env values are optional
emergency overrides and should normally remain empty. The gateway also requires
`NODE_ENV=production` and the exact HTTPS host `https://api2.jubelio.com`. If
any check fails, checkout stops before Midtrans.

### A.2 Sales Order gateway (active checkout)

`apps/store/src/lib/jubelio-sales-client.ts` has **no mock runtime** and is
wired to every new checkout. In non-production it throws before any request unless the
explicit `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true` opt-in is configured with
`JUBELIO_API_BASE_URL=https://api2.jubelio.com` and real credentials belonging
to an independently verified isolated test account. The production branch
requires both `APP_ENV=production` and `NODE_ENV=production`, the explicit
pinned URL and `JUBELIO_STOCK_WRITES_ENABLED=true`; the test-account flag
cannot bypass the production branch. Do **not** add the test-account flag to
production Compose. Staging Compose does not forward it; staging currently
uses production-mode stock settings (see warning above), so do not mistake
its running mock service for a Sales gateway safety boundary.

These configuration gates do not constitute go-live approval. Test-account
isolation is by owner-confirmed credentials, not by the shared hostname. The
mock still serves unrelated legacy consumers; the Sales gateway never calls it.
After migration 0022, bootstrap real Jubelio stock for the catalog:
`branch_stock.provider_stock_synced_at` is NULL on legacy rows. Browsing uses
last-known availability provisionally; every new checkout reads selected
item/location stock directly from Jubelio, then atomically holds it before SO
create. Missing, inconsistent, or unreachable provider reads block checkout.
Local hold writes must never refresh the provider observation clock.
A periodic stock reconciliation job is outside this Sales-Order cutover.
The live checkout read remains mandatory during a provider outage.

The stock HTTP scheduler is process-wide. It spaces request starts to stay at
or below `JUBELIO_STOCK_MAX_REQUESTS_PER_MINUTE`, caps simultaneous requests at
`JUBELIO_STOCK_CONCURRENCY`, and gives release work priority over new checkout
reserve work. The default 450/minute intentionally leaves headroom below
Jubelio's documented 600/minute account limit for reconciliation and unrelated
API traffic. The default gateway is also shared per store process, so login,
account mapping, and default-bin single-flight caches are reused across
concurrent checkout, release, and reconciliation work.

When `JUBELIO_STOCK_MAX_QUEUED` is reached, or a request waits longer than
`JUBELIO_STOCK_QUEUE_TIMEOUT_MS`, the scheduler rejects it before invoking
`fetch`. The configured queue timeout is capped below the HTTP timeout.
Therefore an adjustment queue rejection is definitive—not an ambiguous write.
Reserve operations release their local hold and checkout
returns `503`; release operations remain reconciling for a later retry.
Before enabling production, apply all migrations through
`0015_fixed_hiroim.sql`, verify all sellable variants have `jubelio_item_id`,
verify active branches have `jubelio_location_id`, and create a database
backup. Follow the complete operator procedure in
[stock-adjustment-rollout.md](stock-adjustment-rollout.md); do not enable the
switch from an ad-hoc shell session.

The stateful mock supports `success`, `insufficient-stock`, `server-error`,
`rate-limit-once`, `unauthorized-once`, `timeout-before-apply`,
`timeout-after-apply`, and `malformed-success`. Control it with
`PUT /__control/scenario` and reset it with `POST /__control/reset`.

## B. One-shot import (full pull pertama / refresh)

```bash
# dari repo root — pakai env .env
npm run db:import-jubelio
# untuk testing cepat, cap jumlah produk:
JUBELIO_SYNC_MAX_PRODUCTS=20 npm run db:import-jubelio
```

Mempaginasi `/inventory/items/masters` (~38rb produk), enrich per produk via
`/inventory/catalog/{id}`, fetch stok per-location via `/inventory/items/all-stocks/`,
lalu upsert per halaman. Idempoten — aman dijalankan ulang.

## C. Webhook (delta berulang)

1. Generate secret: `openssl rand -hex 32` → set sebagai `JUBELIO_WEBHOOK_SECRET`
   dan sebagai **Webhook Secret Key** di Jubelio.
2. Di Jubelio UI: **Pengaturan → Developer → Webhook**. Daftarkan callback URL
   `https://<store-domain>/api/webhooks/jubelio` untuk action `update-product`,
   `update-price`, `update-qty`.
3. Jubelio menandatangani `HMAC-SHA256(rawBody + secret, secret)` (hex) di header `Sign`.
   Handler juga menerima alias lama `webhook-signature` dan
   `x-jubelio-signature`, lalu memverifikasi raw body — 503 jika secret unset,
   401 jika signature salah, 500 jika upsert gagal (Jubelio retry sampai 3×).

Payload minimal (cuma `item_group_id` + action) → handler re-fetch state
terbaru dari Jubelio lalu upsert. Tiap call dicatat di `audit_log`
(`action: "JUBELIO_SYNC_WEBHOOK"`).

## D. Verifikasi pasca-import (psql)

```sql
SELECT COUNT(*) FROM product WHERE jubelio_item_group_id IS NOT NULL;
SELECT COUNT(*) FROM product_variant WHERE jubelio_item_id IS NOT NULL;
SELECT jubelio_location_id, code, name, status FROM branch WHERE jubelio_location_id IS NOT NULL;
-- master-data sync never makes runtime checkout counters negative
SELECT COUNT(*) FROM branch_stock WHERE pending_remote_stock < 0 OR reserved_stock < 0;
-- thumbnail + gallery terisi
SELECT name, thumbnail IS NOT NULL, jsonb_array_length(images) FROM product WHERE jubelio_item_group_id IS NOT NULL LIMIT 5;
```
