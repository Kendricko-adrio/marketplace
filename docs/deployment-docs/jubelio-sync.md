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

Stock writes used by checkout have stricter environment controls than catalog
reads.

Staging runs `jubelio-mock` as a private Compose service and sets:

```env
APP_ENV=staging
JUBELIO_MOCK_API_BASE_URL=http://jubelio-mock:3002
JUBELIO_STOCK_WRITES_ENABLED=false
JUBELIO_ADJUSTMENT_ACCOUNT_ID=75
JUBELIO_STOCK_TIMEOUT_MS=8000
```

Production sets `APP_ENV=production`, but live writes remain disabled until
this explicit value is changed and the store container is restarted:

```env
JUBELIO_STOCK_WRITES_ENABLED=true
```

The gateway also requires `NODE_ENV=production` and the exact HTTPS host
`https://api2.jubelio.com`. If any check fails, checkout stops before Midtrans.
Before enabling production, apply migration `0013_absurd_vampiro.sql`, verify
all sellable variants have `jubelio_item_id`, verify active branches have
`jubelio_location_id`, and create a database backup.

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
