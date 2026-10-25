# Log Deployment

Container `store`, `admin`, `caddy`, dan service pendukung mengirim stdout/stderr
ke logging driver Docker `journald`. Log mengikuti konfigurasi systemd journal
yang sudah ada di VPS: retensi maksimum 7 hari, kompresi aktif, dan batas disk
1 GB. Deployment **tidak** memasang drop-in atau mengubah konfigurasi journald
host.

Aplikasi store dan admin menulis log backend sebagai satu objek JSON per baris.
Detail format dan field tersedia di
[`../features/logging.md`](../features/logging.md).

## Format target dan filter severity

Kontrak (skill `maintainable-code` §7.2): satu objek JSON per baris ke
**stdout**, dengan field tetap `timestamp`, `level`, `app`, `requestId`,
`module`, `message`, plus field opsional `error` dan `executionId` (khusus job).

**Severity dibaca dari field JSON `level` (`trace`…`fatal`), bukan dari priority
journald atau console method.** Karena itu jangan memakai `-p err`/`-p warning`
sebagai cara menghitung error; filter JSON-nya. `-o cat` mengeluarkan body
message apa adanya (baris JSON aplikasi).

```bash
# Hanya error/fatal hari ini (baris non-JSON dilewati)
journalctl -t staging-store-1 -o cat --since today \
  | jq -R 'fromjson? | select(.level == "error" or .level == "fatal")'

# Seluruh baris satu request (UUID dari header x-request-id)
journalctl -t staging-store-1 -o cat --since "24 hours ago" \
  | jq -R 'fromjson? | select(.requestId == "<uuid>")'

# Completion HTTP 5xx pada satu entry (module = nama entry yang diberikan ke wrapper)
journalctl -t staging-admin-1 -o cat \
  | jq -R 'fromjson? | select(.module == "admin-orders-detail" and .level == "error")'
```

`jq -R 'fromjson?'` dipakai karena output container masih memuat baris non-JSON
(output `next dev`, pesan framework, output fungsional script CLI) — baris
seperti itu dilewati, bukan membuat query gagal. Bila hanya ada baris JSON,
`jq -c 'select(...)'` biasa juga cukup.

Bila memakai `journalctl -o json`, baris aplikasi terbungkus metadata journald,
sehingga perlu diekstrak dulu:

```bash
journalctl -t staging-store-1 -o json --since today \
  | jq -r '.MESSAGE' | jq -R 'fromjson? | select(.level == "error")'
```

`LOG_LEVEL` (default `info`) memfilter level sebelum ditulis. Nilai yang tidak
dikenal jatuh ke `info` dan dilaporkan satu kali lewat diagnostic aman; jangan
mengandalkan env ini untuk sampling atau menaikkan verbosity per request.

### Satu format untuk seluruh log aplikasi backend

Seluruh logging backend first-party store/admin — route handler, webhook, cron
HTTP, service/repository, provider client, helper, dan guard RBAC — menulis
envelope JSON yang sama lewat facade `apps/<app>/src/lib/logger.ts`; engine
legacy (`createLogger`, `requestLogger`, `withRequestId`, `serializeError`) sudah
dihapus dari kedua app. Konsekuensi untuk operator:

- Filter `level` berlaku untuk **seluruh** baris aplikasi, bukan hanya endpoint
  pilot. Hitungan error/fatal dari `level` sejak sini mencerminkan semua
  endpoint first-party.
- Baris non-JSON yang masih terlihat di journal berasal dari output framework
  (`next dev`, pesan startup) dan output fungsional script CLI (`db:seed`,
  `db:reset`, `import-jubelio`, `bootstrap-owner` memakai `console.*` sebagai
  output perintah, bukan application log). Baris seperti itu tidak memuat field
  `level`/`requestId`, jadi tetap dilewati `jq -R 'fromjson?'`.
- Baris dari pekerjaan non-HTTP (script internal, kerja background detached)
  ber-`requestId` `null` sesuai desain. Entry job/CLI yang membuka
  `withExecutionContext`/`withDetachedExecutionContext` akan menambahkan
  `executionId`; saat ini belum ada entry runtime yang membukanya, jadi baris
  non-HTTP umumnya hanya punya `requestId` `null`. Untuk menelusuri pekerjaan
  semacam itu, cari dari `message`.
- Cakupan wrapper pada jalur HTTP sudah penuh: store 33 dari 34 `route.ts` dan
  admin 71 dari 72, dengan satu-satunya pengecualian `auth/[...all]/route.ts`
  (catch-all Better Auth) — termasuk `/api/addresses`, `/api/addresses/[id]`,
  `/api/addresses/[id]/default`, dan `/api/onboarding/sync`, sehingga baris
  endpoint itu memakai `requestId` kanonik (`/api/onboarding/sync` hanya menulis
  baris completion, tanpa log bisnis). Angka cakupan wrapper ada di
  [`../features/logging.md`](../features/logging.md#pengecualian-yang-harus-dibaca-bersama-tabel).
- `/api/auth/[...all]` (Better Auth) dan `/uploads/[...path]` tidak menulis
  application log first-party, sehingga tidak muncul di stream ini kecuali dari
  lapisan framework.
- Format envelope tidak menambah collector/endpoint/volume baru; isi record dan
  pemetaan levelnya dijelaskan di
  [`../features/logging.md`](../features/logging.md).

Dokumen ini hanya mencatat format/filter. Ia **tidak** mengubah logging
driver Compose (tetap `journald`), retensi/kuota journald host, atau menambah
collector/endpoint/volume; tidak ada command host yang dijalankan oleh perubahan
dokumentasi ini.

## Verifikasi konfigurasi host

Periksa konfigurasi efektif tanpa mengubahnya:

```bash
systemd-analyze cat-config systemd/journald.conf \
  | grep -E '^[[:space:]]*(Storage|Compress|MaxRetentionSec|SystemMaxUse|SystemKeepFree)='
journalctl --disk-usage
```

Konfigurasi VPS saat dokumentasi ini ditulis menghasilkan:

```text
SystemMaxUse=1G
MaxRetentionSec=7day
Compress=yes
```

Retensi aktual dapat lebih pendek ketika batas disk tercapai. Perubahan
kebijakan journald merupakan operasi host terpisah dan bukan bagian dari deploy
aplikasi.

## Terapkan logging driver

Buat ulang container agar logging driver `journald` pada Compose diterapkan:

```bash
cd deployment/staging
docker compose -p staging --env-file .env up -d --build --force-recreate
```

Untuk production, jalankan command yang sama dari `deployment/production`
dengan project `-p production`.

Verifikasi driver pada container:

```bash
docker inspect -f '{{.HostConfig.LogConfig.Type}}' staging-store-1
docker inspect -f '{{.HostConfig.LogConfig.Type}}' staging-admin-1
```

Keduanya harus menghasilkan `journald`.

## Membaca log

Tag journal menggunakan nama container Compose, misalnya
`staging-store-1` dan `staging-admin-1`.

```bash
# Ikuti log store secara real-time
journalctl -f -t staging-store-1

# Log admin sejak hari ini
journalctl -t staging-admin-1 --since today

# Log seluruh container staging selama 24 jam terakhir
journalctl --since "24 hours ago" \
  -t staging-store-1 \
  -t staging-admin-1 \
  -t staging-caddy-1 \
  -t staging-jubelio-mock-1

# Export log store dalam jendela retensi host
journalctl -t staging-store-1 --since "7 days ago" -o json \
  > staging-store.jsonl
```

`docker compose logs` tetap dapat digunakan untuk pemeriksaan biasa:

```bash
docker compose -p staging --env-file .env logs -f store admin
```

Jangan membaca atau memodifikasi file internal di `/var/log/journal/` secara
langsung; gunakan `journalctl` untuk query dan export.

## Pemeriksaan retensi

```bash
journalctl --disk-usage
journalctl --since "7 days ago" -t staging-store-1 --no-pager
```

Dokumentasi ini sengaja tidak menyertakan command `systemctl restart
systemd-journald`, pemasangan file `/etc/systemd/journald.conf.d/*`, atau
`journalctl --vacuum-*` karena deploy aplikasi harus mempertahankan kebijakan
journald VPS yang sudah ada.