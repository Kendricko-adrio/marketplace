# Deployment staging fase 2 — tenant sandbox, data baru

Runbook ini khusus SSH alias `remote-server`, user `deploy`, repository `/home/ops/marketplace`, Compose project `staging`, DB `qadfstore`, role `qmarketplace`. **Bukan runbook production.** Spec dan register evidence berada di [spec staging](../../.scratch/production-deployment/plan/deployment-staging-fase-2.md) dan [verifikasi staging](../../.scratch/production-deployment/ticket/verifikasi-deployment-staging-fase-2.md).

## Konfigurasi Google terpasang dan scheduled stock terbukti — 18 November 2026

Pasangan Google staging yang diberikan pemilik diterapkan hanya ke `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` pada `.env` dan `.env.staging`. Store direcreate dari image ID yang sama, kembali healthy15:11 UTC; runtime pair match, semua non-Google env/admin/Caddy/mounts tetap, checkout masihfalse. Auth healthHTTP200/oktrue dengan TLS normal; tidak build/test suite atau menjalankan Google sign-in/token exchange. Konfigurasi dashboard/callback dan login end-to-end belum dianggap lulus. [Evidence Google](../../.scratch/production-deployment/ticket/setup-google-oauth-staging.md).

Pembacaan log/journal existing juga memastikan actual stock cron02:00 UTC18November3/3 sukses,59.730 IDs/165.021 observations, missing0/failed0. Query read-only15:16 UTC timestamp kosong/stale24h/negative holds0. Tidak memanggil job baru untuk membuat bukti; [evidence scheduler](../../.scratch/production-deployment/ticket/verifikasi-stock-terjadwal-staging.md). U01/A01/A05 Verified, full unit gate dan readiness operator lainnya tetap Pending.

## Checkout dibuka atas permintaan pemilik — 17 November 2026 13:24 UTC

Pemilik meminta staging dibuka meskipun readiness belum seluruhnya lengkap. `checkout.paused=false` telah dibaca kembali dan store direcreate dari **image ID yang sama**, kembali healthy; admin/Caddy/volumes dan seluruh env termasuk Google/provider tetap. Tidak build, test tambahan atau transaksi percobaan. Ini mengecualikan gate readiness awal hanya untuk staging ini, bukan menyatakan semua konfigurasi/flow transaksi siap atau memberi izin agent melakukan canary provider.

Lihat [outstanding Anda/agent](../../.scratch/production-deployment/ticket/checklist-outstanding-staging.md). Jangan pause ulang otomatis karena input/operator/full verification masih Pending. Pembukaan checkout tidak berarti delivery/payment pasti bisa tuntas ketika origin/callback belum lengkap.

## Histori checkpoint pasca-import — 17 November 2026

Penarikan mencapai akhir halaman196, exit0. Rekonsiliasi independen cocok dengan39.045 group ID/108.503 SKU, termasuk2 SKU yang ada pada catalog detail tetapi tidak pada master listing. Tidak perlu mengulang import untuk melanjutkan deployment.

Checkpoint12:12 UTC: **ketiga cron telah terpasang**, sweep/email setiap menit dan stock02:00 UTC host dengan `--runs 3` untuk59.730 eligible IDs. Normalisasi negative availability yang konsisten sudah diterapkan seperti importer (available0, tetap tidak sellable), tanpa melonggarkan malformed/missing/duplicate data. Actual chain3 exit0 memperbarui165.021 mapped rows, missing0/failed0, local holds tidak berubah. Bukti **scheduled** stock baru dapat diperiksa setelah jadwal berikutnya18November02:00 UTC/09:00 WIB; jangan menganggap manual pass sebagai scheduled pass.

Discount contract/manifest1, checkout tetap paused. **Full unit gate masih Pending**: test cancel-race dan cleanup rehearsal di luar perubahan gagal; pemilik secara eksplisit memilih deploy terarah, bukan menyatakan full suite pass. Tidak mengisi row nol untuk pasangan cabang yang tidak dikirim provider atau memalsukan timestamp. Lihat [evidence normalisasi](../../.scratch/production-deployment/ticket/penyelarasan-stock-refresh-staging.md) dan [AC terkini](../../.scratch/production-deployment/ticket/verifikasi-deployment-staging-fase-2.md).

**Google OAuth adalah pengecualian source env:** pemilik mengoreksi17November bahwa dua key Google harus memakai credential staging terkonfirmasi, bukan lokal. File privat belum disuplai; pasangan legacy yang ditemukan belum disetujui untuk dipakai. Jangan menjalankan ulang transfer env lama yang menyalin Google lokal, rollback seluruh env atau rotasi secret Google otomatis. Origin/jam cabang, konten dan callback masih menunggu operator; tidak ada aktivasi checkout.

## Batas izin dan risiko

- Data staging lama boleh hilang tanpa backup. Tidak tersedia restore/rollback data lama.
- Credential Jubelio server lama adalah production: **jangan login, GET, import, atau test menggunakan credential tersebut**. Sandbox berasal dari root `.env` lalu override `apps/store/.env.local`/`apps/admin/.env.local` sesuai app. Kesamaan hostname API tidak membuktikan kesamaan tenant.
- Provider hanya boleh authentication POST, master/region GET, serta **POST read-only `/inventory/items/all-stocks/` dengan batch `{ids}`** untuk import/verifikasi/stock refresh (izin eksplisit pemilik 2026-11-15). Spec awal keliru menyebut stock GET; implementasi client memakai POST. Tidak ada quote `POST /rates/all`, SO, invoice, payment, adjustment, booking, cancel/refund/delete, SMTP delivery test atau Google OAuth end-to-end oleh agent.
- Jangan menjalankan `seed.ts`, `reset.ts`, `db:push`, `down -v`, prune, atau mengubah migration SQL/journal. Jangan menyentuh production.
- Cutover menyebabkan downtime store/admin; Caddy bisa mengembalikan 502. Uploads dan sertifikat tetap dipertahankan.
- Master sandbox saat preflight melaporkan 39.045 product groups. Import terakhir memakai override `JUBELIO_SYNC_REQUESTS_PER_MINUTE=600` atas permintaan pemilik, sama dengan maksimum [dokumentasi Jubelio](https://docs.jubelio.com/dist.yaml), tanpa headroom untuk client lain. Ini budget client, bukan jaminan throughput600. Script existing memakai window budget, retry/backoff existing, dan full-mode concurrency efektif2; jangan mengklaim pacing merata, cooldown global baru, atau concurrency5. Setiap SKU tetap memerlukan GET parcel. Jangan menjalankan stock refresh, import kedua atau lookup Jubelio tambahan bersamaan dengan import600.
- Keputusan pemilik sesi 2026-11-15: origin/jam cabang, konten dan evidence callback boleh dilengkapi **setelah cutover**, dengan `checkout.paused=true`. Ini bukan penerimaan delivery/readiness, bukan pengurangan scope menjadi pickup-only, dan bukan izin membuka checkout.

## 1. Persiapan tanpa downtime

1. Pastikan worktree target bersih dan pin base SHA yang disetujui. Default tanpa commit/push: `APP_RELEASE=<base-sha>+<patch-sha256>`. Patch hanya file allowlist blueprint; file baru disertakan. Tidak membawa `.scratch`, env, secret, output testing, atau dirty changes lain.
2. Verifikasi checksum patch dan file manifest aman; `git apply --check` harus sukses sebelum apply. Mode wrapper stock/email harus `100755`.
3. Validasi candidate env dalam proses privat, **jangan** `source .env` atau mencetak `docker compose config` mentah. DB/role/domain tetap staging; jangan menyalin DSN/localhost lokal. Transfer allowlist melalui SSH stdin, file mode 600 dan parent secret 700. Simpan Owner di file read-only, bukan argv.
4. `NODE_ENV=production`, `APP_ENV=staging`, Sales test-account `true`, direct stock adjustment `false`, Midtrans sandbox. Tidak ada provider mocks. Auth secret store/admin identik. Pastikan semua credentials sandbox dibandingkan dengan sumber lokal sebelum provider request.
5. Manifest aktual `deployment/staging/bootstrap.config.json` harus berisi `version`, `expectedDatabase=qadfstore` dan config yang sah. Template sengaja tidak memberikan TTL/pajak/parcel fiktif: isi `reservationTtlMinutes`, `taxPpnRatePercent`, `jubelioSalesTaxId`, `discountsContractVersion=0`, batas discount import, dan `shipment`. Fallback disetujui pemilik: 250 gram, 30×20×10 cm per unit; packaging 15 gram. Cocokkan tax rate/output mapping dan payment account melalui master sandbox. Payment type harus numerik dari evidence tenant; `transfer` bukan angka yang sah.
6. Periksa history migration hash **dan timestamp**, privileges/schema ownership, dependency FK/partisi luar `public`, disk/RAM, project/volume host, writable report/log path dan crontab deploy. Baseline audit: 16 migration; release `6c57338` memiliki 59, bukan angka untuk semua release berikutnya.
7. Uji lokal pada PostgreSQL **disposable**, bukan DB development/staging: resolved Compose/context dummy, wrapper mock-curl, upgrade baseline 0015 → release, SQL guard/rollback/no-op/reseed, runtime resolver dan CLI bootstrap. Lihat commands §7.

Dari `/home/ops/marketplace/deployment/staging`:

```bash
docker compose -p staging --env-file .env --profile tools build store
docker compose -p staging --env-file .env --profile tools build admin
docker compose -p staging --env-file .env --profile tools build migrate bootstrap
```

Build **tidak** menyalakan app baru. Pastikan tools dapat menjalankan `npx tsx src/production-bootstrap.ts`, Owner CLI, import CLI dan migrator. Secret tidak boleh masuk build args/context/image. `APP_RELEASE` harus sama pada store/admin/migrate/bootstrap. Jangan menganggap image lama masih tersedia sebagai rollback data.

## 2. Maintenance, migration dan reset

1. Umumkan downtime. Hilangkan sementara seluruh cron marketplace staging; preserve baris non-marketplace. Tunggu proses wrapper lama berhenti, kemudian stop writer store/admin dan mock staging lama. Jangan stop Caddy atau project lain.
2. Jalankan tools preflight before-migrate, lalu migrator tanpa seed dan preflight after-migrate:

```bash
docker compose -p staging --env-file .env stop admin store
docker compose -p staging --env-file .env --profile tools run --rm bootstrap preflight --config /bootstrap/bootstrap.config.json --phase before-migrate
docker compose -p staging --env-file .env --profile tools run --rm migrate
docker compose -p staging --env-file .env --profile tools run --rm bootstrap preflight --config /bootstrap/bootstrap.config.json --phase after-migrate
```

Expected: `PREFLIGHT_OK`, migrator exit 0, journal sesuai release lengkap. Bila migration gagal, tetap tahan writers; jangan start binary lama atau edit journal/generated SQL.

3. Gunakan `psql -X -v ON_ERROR_STOP=1` dengan koneksi staging yang disuplai privat, tanpa password pada argv. SQL aktual `deployment/staging/reset-data.sql` memerlukan session settings berikut pada **session yang sama**:

```sql
SELECT set_config('app.deployment_environment', 'staging', false);
SELECT set_config('app.staging_reset_expected_database', 'qadfstore', false);
SELECT set_config('app.staging_reset_expected_role', 'qmarketplace', false);
SELECT set_config('app.staging_reset_confirmation', 'qadfstore', false);
```

Kemudian `\i /home/ops/marketplace/deployment/staging/reset-data.sql`. Expected `STAGING_DATA_RESET_APPLIED`. SQL menolak superuser, target bernama production, setting kosong/salah, journal hilang, dependency luar schema; memakai satu transaction, lock/statement timeout, dan `TRUNCATE ... RESTRICT`, bukan cascade lintas schema. Struktur/index/journal tetap; semua base table aplikasi `public` harus kosong. Periksa aggregate counts dan fingerprint journal/objek sebelum-sesudah. Rerun migrator harus no-op.

## 3. Reference seed dan Owner

```bash
docker compose -p staging --env-file .env --profile tools run --rm bootstrap seed --config /bootstrap/bootstrap.config.json
```

Expected `REFERENCE_SEED_APPLIED`; rerun `REFERENCE_SEED_ALREADY_APPLIED`. Tidak ada akun demo/client/order/product/promo/recovery dummy. HQ administratif lokal tidak memiliki mapping Jubelio dan bukan origin delivery.

Bootstrap Owner melalui tools release yang sama, mount file password read-only dari direktori privat host:

```bash
docker compose -p staging --env-file .env --profile tools run --rm \
  -v /path/privat/owner.password:/run/secrets/owner.password:ro \
  migrate npx tsx src/bootstrap-owner.ts \
  --expected-database qadfstore --name '<nama pemilik>' \
  --email '<email pemilik>' --username '<username pemilik>' \
  --password-file /run/secrets/owner.password
```

Expected satu Owner aktif, `must_reset_password=true`; rerun menghasilkan `OWNER_EXISTS` tanpa mengganti password/menambah Owner. File identity/password dan raw auth response tidak masuk laporan. Pemilik menyelesaikan forced reset sebelum mengakses admin; jangan bypass flag via SQL atau mengganti password pribadi tanpa instruksi.

## 4. Full import sandbox

### Histori resume dari halaman23 — 2026-11-16

Run600 dari halaman1 berhenti otomatis pada HTTP408 di detail item66068, sesudah22 halaman selesai. Pemilik mengizinkan resume23 dengan penyesuaian minimal `--preserve-branch-hours`, agar jalur start-page existing tidak mengisi jam dummy07:00–22:00. Mode ini **tidak menggunakan `--full`**, tidak cap/filter, concurrency2 dan budget600. Source/override/image yang dipin direkam di `import-restart.json`; aplikasi dan `.env` tidak direstart/diubah untuk resume.

Resume dimulai `2026-11-16T17:00:59.082177+00:00`. Monitor **`resume-progress.json`**: `currentPage` adalah halaman yang sedang dikerjakan; `lastCompletedPage` hanya halaman dengan produk/SKU/stok selesai. `written` adalah counter resume saja; `logicalProcessed` menambahkan prefix22 halaman, bukan total unik DB. Laporan akhir **`import-resume.json`** tidak menggantikan full report dari halaman1. Hasil dan ID/count DB tetap harus direkonsiliasi setelah tail selesai.

Tidak ada retry408 baru; bila error berulang, baca alasan aktual dan checkpoint baru. Jangan menjalankan importer kedua atau memulai ulang dari1 tanpa keputusan pemilik.

### Histori run dari halaman1: source existing tetap dipertahankan

Run600 dimulai `2026-11-16T15:23:32.030705+00:00` pada container `staging-full-import-phase2`, melalui `nohup` dan wrapper `release/import-full.sh` di direktori laporan. Full mode dimulai halaman1 tanpa cap/filter. Setiap restart mengulang pembacaan, bukan melanjutkan page terakhir; upsert mempertahankan data yang sudah tersimpan, tetapi counter report kembali dari awal.

Konfigurasi aktual berada di `/home/ops/marketplace/deployment/staging/.env`, bukan template `.env.example` (default conservatif120). Full-mode existing menggunakan concurrency2 walaupun ENV berisi5. Tidak ada setting untuk melewati GET parcel per SKU. Tidak menerapkan kode optimisasi yang dibatalkan pemilik.

Resume terakhir mempertahankan source existing melalui bind-mount read-only. Path source dan Compose override **wajib dibaca dari** `/home/ops/log/marketplace-bootstrap/staging/import-restart.json`; jangan menghapus direktori `existing-importer-source-*` atau override `import-config450-*.yml` selama dipakai. Nama file override450 adalah histori; nilai runtime sekarang600 berasal dari `.env`. Base image yang tersedia bukan image digest lama; source existing yang dipasang read-only adalah acuan kode importer.

**Jangan menjalankan Compose default dari tag `latest` sebagai pengganti run ini.** Kandidat image/source optimisasi sebelumnya tidak diaktifkan dan tag build bukan bukti release aktif. Setelah import, distribusi release standar harus kembali dipin dan diperiksa sebelum ada rebuild/recreate app; bukan operasi paralel saat import.

### Monitoring tanpa request provider tambahan

Jalankan di server melalui SSH alias yang sudah disetujui:

```bash
docker ps --filter name=staging-full-import-phase2 --format '{{.Names}} {{.State}}'
python3 - <<'PY'
from pathlib import Path
import json
p = Path('/home/ops/log/marketplace-bootstrap/staging')
for name in ['import-resume.json', 'resume-progress.json', 'import.json', 'import.json.partial']:
    f = p / name
    if f.exists():
        r = json.loads(f.read_text())
        print(json.dumps({'file': name, 'status': r.get('status'),
          'pages': r.get('pagesVisited'), 'reachedEnd': r.get('reachedEnd'),
          'written': r.get('written'), 'lastCompletedPage': r.get('lastCompletedPage'),
          'currentPage': r.get('currentPage'), 'scope': r.get('scope'),
          'errors': len(r.get('errors', [])), 'lastHttpError': r.get('lastHttpError'),
          'reasons': r.get('reasons')}))
print('exit=' + ((p / 'import.exit').read_text().strip()
  if (p / 'import.exit').exists() else 'running/pending'))
PY
```

Monitoring membaca Docker/report saja, bukan lookup API baru. `written` adalah counter run saat ini, bukan total unik di DB; total DB perlu query read-only terpisah. Jangan mencetak raw env, credentials, token, atau seluruh daftar source IDs.

Parser memakai `--expected-database=qadfstore`/`--report-file=/reports/import.json` inline. Jangan mengubah flag, source atau budget proses aktif. Bila restart benar-benar diperlukan dan sudah diizinkan, gunakan wrapper dan Compose override dalam `import-restart.json`, tunggu wrapper sebelumnya selesai lalu simpan report/log/exit sebagai histori terlebih dahulu; tidak truncate/seed ulang.

Sukses pengambilan seluruh data harus dibuktikan `reachedEnd=true`, ID/count sumber versus DB, dan kondisi stock yang benar-benar teramati. Checker existing menghitung SKU×semua cabang; asumsi ini tidak sesuai cabang khusus brand. `MISSING_STOCK_OBSERVATIONS` akibat asumsi itu bukan bukti data Jubelio rusak, bukan alasan menghentikan import secara manual, dan bukan izin membuat stok nol. Simpan hasil akhir apa adanya; pembenahan checker memerlukan scope terpisah. Partial report atau ketidakjelasan lainnya tetap bukan bukti seluruh import selesai.

```bash
docker compose -p staging --env-file .env --profile tools run --rm bootstrap verify \
  --config /bootstrap/bootstrap.config.json --import-report /reports/import.json
```

`BOOTSTRAP_VERIFIED` bukan bukti transaksi/provider siap. Klasifikasikan **setiap** launch blocker: actual readiness failure versus tools-only mismatch. Bootstrap hanya mendapat master-read credentials, sehingga cek SMTP/payment dari tools bukan cek runtime store. Jangan menyalakan production stock-write hanya demi menghilangkan warning verifier pada test-account staging.

## 5. Aplikasi dan cron

Release normalisasi membangun ulang store/admin/migrate/bootstrap dari snapshot immutable32 files pada base+patch3256bdb3, tanpa importer percobaan. Default aliases telah diselaraskan, tetapi operasi berikutnya tetap memakai **runtime override dengan image IDs**, bukan percaya `latest` yang mutable. Source/override/digests actual tersedia di `/home/ops/log/marketplace-bootstrap/staging/active-release.json`. Snapshot immutable adalah source build canonical; dokumentasi operasional live dapat diperbarui sesudah build.

Dari direktori staging, untuk recreate yang memang diizinkan:

```bash
OVERRIDE="$(python3 -c 'import json; print(json.load(open("/home/ops/log/marketplace-bootstrap/staging/active-release.json"))["composeOverride"])')"
docker compose -p staging --env-file .env \
  -f docker-compose.yml -f "$OVERRIDE" \
  up -d --no-deps --no-build --pull never store admin
```

Jangan memakai `import-restart.json` sebagai override release baru: itu histori resume importer yang sudah berakhir. Pergantian dua key Google berikutnya hanya memerlukan env terkonfirmasi dan recreate store dari image terpin, **bukan** build ulang atau rollback seluruh env.

Pastikan Caddy existing tetap berjalan, store/admin healthy, domain HTTPS/TLS valid. Hapus orphan `staging-jubelio-mock-1` secara terarah tanpa volume setelah tidak diperlukan, bukan `down -v`.

Hitung distinct eligible item IDs memakai join scanner: `product_variant` → `branch_stock` → `branch` bermapping Jubelio. `N=max(1,ceil(eligibleIds/20000))`, maksimal 12. Wrapper stock menjalankan `--runs N` serial, satu `flock` seluruh rangkaian, 540 detik per request, berhenti pada HTTP/incomplete. Periksa seluruh mapped observations/freshness ≤1 hari, bukan hanya penjumlahan count per invocation.

**Saat import masih berjalan, jangan memasang/mengaktifkan block ini atau memanggil endpoint jobs.** Review wrapper/permission dan siapkan folder log boleh dilakukan tanpa request provider. Draft nonaktif ada di `/home/ops/log/marketplace-bootstrap/staging/cron-staging-pending.txt`; seluruh baris jadwal harus tetap dikomentari sampai import selesai, N final diketahui dan aktivasi jobs disetujui.

Setelah gate tersebut terpenuhi, pasang tepat satu managed block staging pada crontab `deploy`, dari:

- `deployment/staging/sweep-reservations.cron`: setiap menit.
- `deployment/staging/order-communications.cron`: setiap menit.
- `deployment/staging/stock-refresh.cron`: 02:00 UTC host; sesuaikan `--runs` dengan N aktual.

Preserve semua entri non-marketplace. Wrapper stock/email executable; log di `/home/ops/log/marketplace-{sweep,order-comms,stock-refresh}/staging`, report di `/home/ops/log/marketplace-bootstrap/staging`. Tidak ada literal secret di crontab. Baru jalankan endpoint jobs setelah sandbox dan database bersih terbukti; jangan menanam order/email dummy. Periksa body/substep/log/journald, bukan HTTP200 saja. Dua run scheduler sweep/email dan satu manual + satu scheduled stock diperlukan; sebelum stock terjadwal berjalan, AC11 tetap Pending.

## 6. Smoke dan handover tertutup

```bash
STAGING_SMOKE=true \
STAGING_OWNER_FILE=/path/privat/owner.json \
STAGING_CATALOG_EVIDENCE_FILE=/path/proyeksi-master-sandbox.json \
  npx playwright test --config=playwright.staging.config.ts --reporter=line
```

Config hanya menerima dua origin staging yang dipin, tanpa webServer/auth setup legacy/mock. Guard image hanya memperbolehkan public Jubelio CDN dan `www.static-src.com` pada prefix `/wcsstore/Indraprastha/images/catalog/` yang terverifikasi pada2 thumbnail sumber; GET/HEAD resource image saja, bukan script/API. Specs membatasi browser ke GET/HEAD dan satu POST login admin. Tidak mengirim quote/order/payment/booking atau mengubah password Owner otomatis. Expected `name`/`sku` berasal dari GET master sandbox independen. Store desktop 1440/mobile 390, katalog/detail/search/halaman lanjut; admin login/forced reset dan realm isolation. Foto sukses boleh diinspeksi untuk rendered review; diagnosis kegagalan dari Markdown, bukan image. Semua output di `playwright/{results,reports}/staging`.

Jika Owner masih forced-reset, akses list admin memang tertahan; jangan klaim seluruh surface admin diuji. Pemilik melengkapi origin/jam cabang, konten wajib dan callback/provider dashboard. Diskon contract diaktifkan ke `1` hanya setelah readiness kontrak diskon (paired reader, typed limits, proxy dan preflight data) valid; checkpoint17November sudah mengaktifkannya sesuai plan. Gate ini uncached sehingga tidak perlu restart. Ini bukan pemenuhan readiness origin/stock/Google atau izin membuka checkout. Untuk perubahan config lain yang dicache, recreate store dari image yang dipin.

Default plan menahan checkout sampai readiness dan konfirmasi pemilik. **Pengecualian staging17November13:24 UTC: pemilik secara eksplisit meminta dibuka meskipun readiness Pending; flagfalse sudah diterapkan.** Jangan mengembalikannya ke paused tanpa instruksi/kondisi keselamatan baru yang dijelaskan. Tidak ada canary provider dalam scope ini. Evidence akhir harus memisahkan deployment tertutup yang berjalan dari AC08/AC13 dan bukti scheduler/admin yang masih Pending.

## 7. Commands verifikasi lokal

```bash
node --test deployment/staging/deployment-config.test.mjs
bash deployment/common/cron/refresh-jubelio-stock.test.sh
bash deployment/common/cron/process-order-communications.test.sh
npm run verify:unit:slice -- packages/db/src/migrations/staging-data-reset.db.test.ts packages/db/src/production-bootstrap/production-bootstrap-cli.db.test.ts apps/store/src/lib/jubelio-sales-client.test.ts
```

DB tests memakai `TEST_DATABASE_URL` disposable yang namanya mengandung test; pastikan bukan skipped. Test SQL membangun baseline 16 migration dengan migrator asli, meng-upgrade ke 59, menguji target/role/env/confirmation, dependency luar schema, rollback dan no-op/reseed. Ulangi wrapper di Linux untuk bukti `flock` aktual; Git Bash hanya menguji HTTP/argumen dengan fallback fixture lock.

Untuk perubahan logic/deployment baru yang diimplementasikan, ikuti final integrated gate di spec: full unit dengan DB disposable, affected typechecks dan opt-in smoke bila relevan. **Tidak mengulang suite untuk audit read-only, dokumentasi, atau restorasi byte-identik ke source existing yang sudah diverifikasi.** Cleanup ini tidak mengaktifkan patch optimisasi. Jangan menjalankan legacy E2E tanpa izin atau mewariskan credentials provider nyata ke unit suite.

## 8. Recovery dan batas klaim

Sebelum reset, kegagalan persiapan tidak memerlukan downtime. Setelah migration/reset, pertahankan binary/config yang kompatibel, checkout paused dan tenant sandbox; perbaiki forward. **Jangan kembali ke credential production lama.** Tidak tersedia restore data lama. Jika provider write terlarang terdeteksi, hentikan aktivitas/scheduler terkait dan eskalasi; jangan cancel/refund sebagai kompensasi otomatis.

Walkthrough aktual, identitas release, checksum, command/results, AC Verified/Pending dan keterbatasan dipelihara dalam [register evidence](../../.scratch/production-deployment/ticket/verifikasi-deployment-staging-fase-2.md). Runbook ini tidak menggantikan evidence eksekusi. Checkpoint normalisasi:14 focused tests pass, types store/DB pass, empat image build pass, live smoke3/3 dan rendered review pass; full suite tetap Pending karena207/208 files pass,2493 pass/1 fail/12 skipped dan1 cleanup error. Tidak menjalankan ulang broad suite tanpa perubahan relevan atau mengubah test unrelated untuk mengejar hijau.
