# Sweep Reservasi Stok (cron)

Saat customer place-order, stok Jubelio langsung dikurangi dan dicatat sebagai
`branch_stock.reserved_stock` selama customer di halaman pembayaran Midtrans.
Jika customer tidak bayar
sampai TTL habis (`orders.expires_at`), reservasi harus dilepas. Path utama:
webhook `expire` dari Midtrans. **Safety-net**: cron `sweep-reservations` yang
men-scan order `pending_payment` yang sudah lewat `expires_at`, re-verify
status ke Midtrans, lalu finalize (kalau ternyata sudah bayar) atau fail +
restore stok lewat adjustment positif (kalau belum). Endpoint yang sama juga
mereconcile write Jubelio yang timeout atau terputus setelah request dikirim,
termasuk compensation dan re-acquisition untuk late settlement.

Endpoint: `POST /api/cron/sweep-reservations`, auth via header `X-Cron-Secret`
(nilai = `CRON_SECRET` di `.env`). Endpoint **idempoten** — aman dijalankan
berkali-kali.

> Model reservasi stok dijelaskan lengkap di `docs/features/stock-reservation.md`.

## A. Set `CRON_SECRET`

Generate secret (di VPS atau lokal):
```bash
openssl rand -hex 32
```

Masukkan ke `.env` (staging dan/atau production):
```
CRON_SECRET=<hasil-openssl-di-atas>
```

Restart store supaya env baru terbaca (env di-read saat container start):
```bash
# Staging
docker compose -p staging --env-file .env up -d --build store

# Production
docker compose -p production --env-file .env up -d --build store
```

> `CRON_SECRET` sudah di-wire ke service `store` di `docker-compose.yml`
> (`CRON_SECRET: ${CRON_SECRET}`). Tidak perlu edit compose.

## B. Setup crontab di VPS

Jalankan sebagai user `ops` (bukan root):
```bash
crontab -e
```

Tambahkan baris (jalankan tiap 1 menit agar operasi Jubelio ambigu cepat
direconcile):
```cron
* * * * * curl -fsS -X POST -H "X-Cron-Secret: GANTI_DENGAN_CRON_SECRET_ANDA" https://dev-store.adfsport.cloud/api/cron/sweep-reservations >> /var/log/marketplace-sweep.log 2>&1
```

Ganti:
- `GANTI_DENGAN_CRON_SECRET_ANDA` → nilai `CRON_SECRET` dari `.env`.
- `https://dev-store.adfsport.cloud` → URL store (staging: `dev-store.adfsport.cloud`,
  production: `store.adfsport.cloud`).

Simpan + keluar editor. Cron otomatis aktif.

## C. Verifikasi cron jalan

Tunggu ~1 menit, lalu cek log:
```bash
tail -f /var/log/marketplace-sweep.log
# Expected (tiap 1 menit):
# {"success":true,"scanned":0,"finalized":0,"failed":0,"jubelioSync":{"scanned":0,"applied":0,"failed":0,"pending":0}}
```

Test manual sekali (tanpa tunggu cron):
```bash
curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" https://dev-store.adfsport.cloud/api/cron/sweep-reservations
```

> - `scanned` = jumlah order `pending_payment` yang sudah lewat TTL (batch 100).
> - `finalized` = order yang ternyata sudah dibayar (webhook sukses ketinggalan)
>   → di-finalize jadi `ready_for_pickup`.
> - `failed` = order benar-benar expired → `failed_payment` + reservasi dilepas.
> - `jubelioSync` = operasi adjustment durable yang discan, terkonfirmasi,
>   gagal, atau masih menunggu rekonsiliasi.

## D. Catatan

- **Rate aman tiap 1 menit**: query order memakai `idx_orders_status_expires`
  dan query operation memakai `idx_jubelio_stock_operation_retry`
  (batch kecil, hanya order expired). Tidak beban DB.
- **Idempoten**: claim-guard `UPDATE orders ... WHERE status='pending_payment'`
  memastikan webhook dan cron tidak double-process order yang sama.
- **Kalau `CRON_SECRET` kosong** di server, endpoint return 503 (cron tidak
  akan jalan — cek env: `docker compose -p staging --env-file .env exec store env | grep CRON_SECRET`).
- Operasi `manual_review` tidak otomatis mengirim write ulang. Dari detail
  order admin, **Recheck safely** hanya memindahkannya ke `reconciling`; sweep
  kemudian mencari adjustment berdasarkan note unik sebelum mengubah stok.
- **Kalau cron tidak terpasang**: order yang expired tanpa webhook `expire`
  dari Midtrans akan tetap `pending_payment` + reservasi bocor sampai ada
  yang trigger sweep manual. Cron adalah safety-net wajib untuk produksi.
