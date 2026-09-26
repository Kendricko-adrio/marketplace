# Sweep Reservasi Stok (cron)

> **Sales-Order cutover (2026-09-24):** cron yang sama sekarang menjalankan
> lifecycle **Jubelio Sales Order** (lihat
> `docs/features/jubelio-sales-orders.md`). Tugasnya: (1) mereconcile
> operasi SO yang masih in-flight via ID remote + GET (cancel terkonfirmasi →
> hold dilepas; invoice/pembayaran → GET-verify), (2) melanjutkan settlement
> untuk order paid yang macet di `processing` (webhook missed/crash/step
> ambigu — `ready_for_pickup` hanya setelah invoice + pembayaran terverifikasi),
> (3) men-expire order `pending_payment` basi (path gagal membatalkan SO
> pre-invoice; hold dilepas hanya setelah cancel dikonfirmasi), dan (4)
> **paling akhir (prioritas terendah, tiket #03/#04/#05/#06)**: mereconcile cermin
> Status Channel — intent *aged* `possibly_sent` (target apa pun)
> direkonsiliasi **GET-only** via SO id tersimpan (order terminal juga;
> tidak pernah re-POST; kegagalan GET 5xx/429 tetap `possibly_sent` untuk
> retry GET-only berikutnya), intent pending yang order lokalnya sudah terminal (completed/cancelled) dispositionskan atomik pending→aborted dengan alasan statis PENDING_TERMINAL_SUPERSEDED (tanpa POST/GET; possibly_sent tidak pernah di-abort; order `failed_payment` TIDAK lagi blanket-terminal — jalur `Gagal Bayar` tiket #05 yang mengatur intent pending-nya; KECUALI tiket #06: intent pending `Selesai` pada order completed yang ledger SO-nya masih terverifikasi penuh itu proyeksi terkini dan didispatch, bukan di-abort) dan order `ready_for_pickup` ATAU `completed` yang terlewat
> (crash sebelum intent / completion sebelum trigger post-commit tiket #06: `Selesai`) didispatch best-effort (cermin `Menunggu Verifikasi` tiket #04 dan `Gagal Bayar`/mismatch cancel-started tiket #05 tetap berjalan pada window-nya masing-masing) — kegagalan cermin tidak
> pernah menyentuh pembayaran/pickup/fulfillment dan tidak pernah
> menggagalkan sweep; langkah cermin berjalan SETELAH langkah kritis
> (settlement/expiry) supaya budget cron (55s) selalu dipakai untuk
> pembayaran/fulfillment lebih dulu. Adjustment
> positif/negatif tidak pernah dikirim lagi. Deployment WAJIB menjalankan
> migrations 0021–0022 (lihat atas) **dan** 0024–0025 (tabel proyeksi cermin
> `jubelio_channel_status_intent` + partial unique index per SO) sebelum
> mengaktifkan cron versi ini. Tidak ada env var baru dan tidak ada perubahan
> jadwal job.

Saat customer place-order, Sales Order dibuat di Jubelio dan stok di-hold
secara lokal (`branch_stock.pending_remote_stock`). Jika customer tidak bayar
sampai TTL habis (`orders.expires_at`), SO harus dibatalkan. Path utama:
webhook `expire` dari Midtrans. **Safety-net**: cron `sweep-reservations`.

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

Cron memanggil wrapper script
`deployment/common/cron/sweep-reservations.sh` (bukan `curl` langsung). Script
ini yang:
- POST ke `/api/cron/sweep-reservations` dengan header `X-Cron-Secret` — secret
  dibaca dari file `.env`, jadi crontab **tidak berisi secret**;
- menulis hasil tiap run ke file log harian di sebuah folder log:
  `<log-dir>/marketplace-sweep-YYYY-MM-DD.log`;
- housekeeping otomatis: file log lebih tua dari **7 hari** dihapus setiap run
  supaya log tidak menumpuk di server (retensi bisa diubah via
  `--retention-days`).

Pastikan script executable (sekali saja, sesudah clone/pull repo):
```bash
chmod +x /home/ops/marketplace/deployment/common/cron/sweep-reservations.sh
```

Jalankan sebagai user `deploy` (bukan root) — di server, crontab sweep
memang milik user `deploy` (bukan `ops`; `deploy` punya akses repo via grup
`ops` dan akses Docker via grup `docker`):
```bash
crontab -e
```

Tambahkan baris (jalankan tiap 1 menit agar operasi Jubelio ambigu cepat
direconcile):
```cron
# Staging (aktif di server)
* * * * * /home/ops/marketplace/deployment/common/cron/sweep-reservations.sh --url https://dev-store.adfsport.cloud --env-file /home/ops/marketplace/deployment/staging/.env --log-dir /home/ops/log/marketplace-sweep/staging

# Production (aktifkan saat go-live)
# * * * * * /home/ops/marketplace/deployment/common/cron/sweep-reservations.sh --url https://store.adfsport.cloud --env-file /home/ops/marketplace/deployment/production/.env --log-dir /home/ops/log/marketplace-sweep/production
```

Ganti:
- `/home/ops/marketplace` → lokasi clone repo di VPS (default deploy:
  `~/marketplace`, lihat [deploy.md](deploy.md)).
- `https://dev-store.adfsport.cloud` → URL store (staging: `dev-store.adfsport.cloud`,
  production: `store.adfsport.cloud`).

Opsi script lainnya: `--retention-days N` (default 7), `--timeout DETIK`
(default 55, `curl --max-time`), atau via env var `SWEEP_URL`, `SWEEP_ENV_FILE`,
`SWEEP_LOG_DIR`, `SWEEP_RETENTION_DAYS`, `SWEEP_CURL_TIMEOUT`. Env
`CRON_SECRET` (kalau di-set) menimpa nilai dari `--env-file`. Kalau
`CRON_SECRET` di-rotate, cukup update `.env` + restart store — crontab tidak
perlu diubah.

Simpan + keluar editor. Cron otomatis aktif.

## C. Verifikasi cron jalan

Tunggu ~1 menit, lalu cek log hari ini:
```bash
tail -f /home/ops/log/marketplace-sweep/staging/marketplace-sweep-$(date +%F).log
# Expected (tiap 1 menit, satu file per hari):
# [2026-01-01T10:00:00+0700] OK {"success":true,"scanned":0,"finalized":0,"failed":0,"jubelioSync":{"scanned":0,"applied":0,"failed":0,"pending":0},"jubelioSalesReview":{"scanned":0,"marked":0,"failed":0},"channelMirrorReview":{"possiblySentScanned":0,"skippedFresh":0,"recovered":0,"investigated":0,"stillUnknown":0,"pendingTerminalScanned":0,"pendingTerminalAborted":0,"pendingTerminalSkipped":0,"missedOrdersScanned":0,"missedDispatched":0,"missedFailed":0,"verifikasiOrdersScanned":0,"verifikasiDispatched":0,"verifikasiFailed":0,"gagalBayarOrdersScanned":0,"gagalBayarDispatched":0,"gagalBayarFailed":0,"failed":0}}
```

Kalau request gagal (mis. endpoint 503, jaringan putus), barisnya berbentuk:
```
# [2026-01-01T10:05:00+0700] FAIL rc=22 curl: (22) The requested URL returned error: 503
```

Test manual sekali (tanpa tunggu cron — keluaran juga tercatat ke file log
harian):
```bash
/home/ops/marketplace/deployment/common/cron/sweep-reservations.sh \
  --url https://dev-store.adfsport.cloud \
  --env-file /home/ops/marketplace/deployment/staging/.env \
  --log-dir /home/ops/log/marketplace-sweep/staging
```

> - `scanned` = jumlah order `pending_payment` yang sudah lewat TTL (batch 100).
> - `finalized` = order yang ternyata sudah dibayar (webhook sukses ketinggalan)
>   → di-finalize jadi `ready_for_pickup`.
> - `failed` = order benar-benar expired → `failed_payment` + reservasi dilepas.
> - `jubelioSync` = operasi adjustment durable yang discan, terkonfirmasi,
>   gagal, atau masih menunggu rekonsiliasi.
> - `jubelioSalesReview` = up to 50 SO create/cancel claims older than 15 minutes
>   and still `dispatched_unknown`, atomically moved to `manual_review`.
>   `failed` counts DB scan/mark errors; check structured error logs even when
>   the cron returns HTTP 200. This **never** repeats a Jubelio POST, releases
>   a stock hold, or proves the write failed. SO checkout and the admin SO
>   review queue are not yet enabled. Deploy migration 0020 before deploying
>   the updated cron route, otherwise the scan logs an error on every run.

## D. Catatan

- **Rate aman tiap 1 menit**: query order memakai `idx_orders_status_expires`
  dan query operation memakai `idx_jubelio_stock_operation_retry`
  (batch kecil, hanya order expired). Tidak beban DB.
- **Idempoten**: claim-guard `UPDATE orders ... WHERE status='pending_payment'`
  memastikan webhook dan cron tidak double-process order yang sama.
- **Kalau `CRON_SECRET` kosong** di server, endpoint return 503 (cron tidak
  akan jalan — cek env: `docker compose -p staging --env-file .env exec store env | grep CRON_SECRET`).
  Di sisi cron, kondisi ini terlihat sebagai baris `FAIL rc=22 ... 503` di log
  harian.
- **Log & retensi**: satu file log per hari di `<log-dir>`
  (`marketplace-sweep-YYYY-MM-DD.log`); housekeeping script menghapus file
  lebih tua dari 7 hari (default) setiap kali cron jalan. Cek ukuran:
  `du -sh /home/ops/log/marketplace-sweep/*`.
- Operasi `manual_review` tidak otomatis mengirim write ulang. Dari detail
  order admin, **Recheck safely** hanya memindahkannya ke `reconciling`; sweep
  kemudian mencari adjustment berdasarkan note unik sebelum mengubah stok.
- **Kalau cron tidak terpasang**: order yang expired tanpa webhook `expire`
  dari Midtrans akan tetap `pending_payment` + reservasi bocor sampai ada
  yang trigger sweep manual. Cron adalah safety-net wajib untuk produksi.
- **Webhook `deny`/`cancel` non-terminal**: sejak multi-payment, webhook
  `deny`/`cancel`/`pending`/`failure` tidak mem-fail order (customer boleh
  mencoba metode lain di Snap). Sweep tetap satu-satunya otoritas TTL: order
  yang lewat `expiresAt` dengan status non-settled apa pun tetap di-fail dan
  reservasinya dilepas.
