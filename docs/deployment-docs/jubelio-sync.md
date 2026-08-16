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
3. Jubelio menandatangani `SHA256(rawBody + secret)` (hex) di header
   `webhook-signature`. Handler verify dari raw body — 503 jika secret unset,
   401 jika signature salah, 500 jika upsert gagal (Jubelio retry sampai 3×).

Payload minimal (cuma `item_group_id` + action) → handler re-fetch state
terbaru dari Jubelio lalu upsert. Tiap call dicatat di `audit_log`
(`action: "JUBELIO_SYNC_WEBHOOK"`).

## D. Verifikasi pasca-import (psql)

```sql
SELECT COUNT(*) FROM product WHERE jubelio_item_group_id IS NOT NULL;
SELECT COUNT(*) FROM product_variant WHERE jubelio_item_id IS NOT NULL;
SELECT jubelio_location_id, code, name, status FROM branch WHERE jubelio_location_id IS NOT NULL;
-- reserved_stock tetap 0 untuk row import
SELECT COUNT(*) FROM branch_stock WHERE reserved_stock <> 0;
-- thumbnail + gallery terisi
SELECT name, thumbnail IS NOT NULL, jsonb_array_length(images) FROM product WHERE jubelio_item_group_id IS NOT NULL LIMIT 5;
```
