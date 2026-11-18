# Spec dan plan deployment staging fase 2 ke Jubelio sandbox

> Status keseluruhan plan dan approval hanya dicatat di [index fitur](../index.md).
> Dokumen ini disusun atas permintaan pemilik setelah scope dikonfirmasi melalui percakapan dan dua pilihan klarifikasi. Belum menjadi izin implementasi atau eksekusi server.
> Referensi utama: [audit staging dan keputusan lanjutannya](../research/audit-upgrade-staging-fase-2-2026-11-15.md).

## 1. Masalah dan tujuan

Staging masih menjalankan release lama, dengan katalog/stock dari tenant Jubelio sebelumnya dan konfigurasi runtime mode production. Pemilik ingin seluruh fitur terbaru pada `main` tersedia di staging, memakai credentials sandbox yang sama dengan development lokal, dengan katalog dan stok ditarik ulang seluruhnya.

Infrastruktur existing tetap digunakan: PostgreSQL bare-metal, Docker Compose project `staging`, Caddy, domain store/admin existing, dan named volumes. Deployment mencakup aplikasi **dan** background/cron jobs, bukan pipeline CI/CD otomatis.

**Hasil yang dituju:** schema terbaru, data aplikasi bersih, satu System Owner baru, katalog/stock lengkap dari sandbox, konfigurasi fitur fase 2 tersedia, store/admin berjalan di HTTPS staging, serta tiga cron jobs terpasang dan terverifikasi. Bukti transaksi provider bukan bagian dari hasil yang boleh diklaim pada scope izin saat ini.

### 1.1 Baseline yang sudah diketahui

| Identitas | Nilai audit |
|---|---|
| SSH / repo | Alias `remote-server`, user `deploy`, `/home/ops/marketplace` |
| Release source | `main` lokal/origin `6c5733833af09635de4a4990e5b1ca4ca5a8f9b5` pada saat audit |
| Repo server | `93d12d89f5b0ab892db27c01def352bdba96af83`; 52 commit tertinggal |
| Target DB / role | `qadfstore` / `qmarketplace` |
| History migration | 16 entries sampai `0015`; hash/timestamp cocok dengan release |
| Upgrade schema | 43 migration pending sampai `0058_abandoned_leader`; total target 59 pada baseline ini |
| Store / admin | `https://dev-store.adfsport.cloud` / `https://dev-admin.adfsport.cloud` |
| Sumber env lokal | `.env`, `apps/store/.env.local`, `apps/admin/.env.local`; `.env.local` root tidak ada |
| Jobs existing | Hanya reservation sweep pada crontab `deploy` |

Baseline wajib diperiksa ulang sebelum eksekusi. Perubahan release bukan alasan mengambil `main` terbaru secara buta; catat SHA final dan evaluasi delta. Audit bukan bukti peak build, credentials valid, atau transaksi target berfungsi.

## 2. Kesepakatan, approval, dan batas izin

### 2.1 Keputusan pemilik yang sudah disepakati

1. Seluruh data database staging lama boleh dibuang, termasuk akun, order, katalog, stock, konfigurasi, dan konten DB lama.
2. Tidak membuat backup data/deployment staging lama. Kehilangan data lama diterima; tidak menjanjikan restore.
3. Schema memakai migration resmi repository, bukan `db:push` atau edit SQL generated.
4. Produk, variant, branch Jubelio, dan stock di-refetch penuh dari sandbox, bukan mengambil subset lokal atau menyalin database development.
5. Credentials sandbox mengacu konfigurasi lokal yang tersedia. Domain dan koneksi DB tetap milik staging.
6. Izinkan authentication POST Omnichannel/Shipment sesuai kebutuhan, pembacaan master/region melalui GET, dan penyimpanan hasil ke DB staging.
7. Tidak mengizinkan agent membuat SO/invoice/payment, booking kurir, refund/cancel/delete transaksi provider, atau mengubah transaksi lama.
8. Deployment mencakup reservation sweep, order communications, dan stock refresh.
9. Koreksi pemilik17November2026: Google OAuth staging **bukan** credential lokal. Pemilik memilih pasangan staging terkonfirmasi melalui file privat; file belum disuplai. File legacy yang ditemukan tidak boleh dipakai otomatis. Ini pengecualian source env, bukan izin rollback seluruh env, rotasi provider atau Google sign-in end-to-end.
10. Pemilik17November13:24 UTC meminta checkout dibuka karena masih staging, meskipun readiness/config/operator dan full verification Pending. Agent mengubah flagfalse dan merecreate store dari image yang sama, tanpa build/test/transaksi. Ini pengecualian staging terhadap gate readiness awal, bukan waiver terhadap pencatatan limitations atau izin canary provider.

**Non-backup tidak berarti penghapusan provider:** mengosongkan DB lokal staging tidak membatalkan order, invoice, pembayaran, adjustment, atau kewajiban apa pun di tenant lama. Tidak ada cleanup provider lama pada plan ini.

### 2.2 Approval dan batas eksekusi

- Kesepahaman scope: dikonfirmasi melalui rangkuman percakapan, pilihan **Data baru** dan **Login dan import**, serta konfirmasi jobs staging.
- Penulisan spec: diizinkan melalui permintaan “oke tolong buatkan spec plannya”.
- Complete plan, technical decisions, acceptance criteria AC01–AC14, dan seams testing: **disetujui pemilik pada 2026-11-15** melalui “oke saya approve”, setelah tautan complete spec dan rangkuman step-by-step diberikan. Tidak ada perubahan scope pada pencatatan approval ini.
- Implementasi lokal, eksekusi remote/destruktif, dan transfer source/secret: memerlukan perintah eksekusi eksplisit setelah plan disetujui. Approval dokumen tidak otomatis memberikan izin tersebut.
- Commit, push, production deployment, dan subagent: tidak diizinkan oleh permintaan penulisan spec ini.

Review pemilik terhadap §5, §6, §8–§12 sekaligus mengonfirmasi seams testing yang diusulkan. Tidak menerbitkan tiket agent-ready atau breakdown multi-session dalam pekerjaan penulisan spec ini.

## 3. Scope dan user stories

1. Sebagai pemilik staging, saya ingin source fitur terbaru berjalan pada domain staging existing agar dapat direview tanpa mengganggu production.
2. Sebagai pemilik staging, saya ingin data tenant sebelumnya tidak bercampur dengan sandbox meskipun ID provider antar-tenant dapat bertabrakan.
3. Sebagai operator, saya ingin schema dimigrate dengan runner resmi dan history tetap valid agar upgrade berikutnya reproducible.
4. Sebagai operator, saya ingin target DB/role dikonfirmasi sebelum reset agar database lokal atau production tidak ikut terhapus.
5. Sebagai operator, saya ingin credentials diambil dari env lokal secara selektif tanpa bocor ke Git, image, logs, atau laporan.
6. Sebagai System Owner, saya ingin akun baru dengan password pribadi, forced reset, dan akses RBAC yang benar, tanpa akun demo bawaan.
7. Sebagai customer tester, saya ingin katalog, variant, harga, dan stock berasal dari sandbox yang sama, termasuk data di luar halaman pertama.
8. Sebagai operator, saya ingin PPN, diskon, payment account, origin branch, dan parameter parcel valid sebelum fitur terkait dibuka.
9. Sebagai operator, saya ingin antrean komunikasi dan recovery diproses job yang benar, memakai secret dan release yang sama dengan aplikasi.
10. Sebagai operator, saya ingin stock refresh mencakup semua item sandbox, bukan hanya 20.000 item pertama.
11. Sebagai pemilik, saya ingin mengetahui mana yang sudah dibuktikan di server dan mana yang belum diuji karena batas izin provider.
12. Sebagai operator, saya ingin recovery kegagalan berhenti dengan aman tanpa mengaktifkan kembali credentials production lama.

### Non-scope

- Deployment atau perubahan credentials/database/domain production.
- CI/CD otomatis, perubahan port/topologi VPS, atau penggantian stack.
- Menyalin database dev, fixture demo, katalog lokal, order/customer lama, atau sample recovery ledger ke staging baru.
- Backup/restore data staging lama dan janji rollback ke state sebelum reset.
- Penghapusan uploads, sertifikat Caddy, Docker volume, database/role PostgreSQL.
- Redesign UI, perubahan business rules, API contract, schema definition, atau migration generated baru.
- Canary transaksi, live quote `POST /rates/all`, booking, Midtrans transaction creation, webhook dashboard mutation oleh agent, SMTP email test ke penerima nyata, dan Google OAuth sign-in end-to-end tanpa izin tambahan yang sesuai.

## 4. Keputusan implementasi utama

### 4.1 Migrate dahulu, kosongkan data aplikasi sesudahnya

Gunakan database existing `qadfstore`, bukan membuat database baru. Ini menghindari kebutuhan `CREATEDB` yang tidak dimiliki role existing.

Urutan: hentikan seluruh writer staging → preflight history → jalankan 43 migration pending → pastikan history 59 entries sesuai release → **truncate seluruh base table aplikasi dalam schema `public` dalam satu transaksi** → isi ulang referensi/Owner → full import sandbox.

Reset hanya data; struktur schema, constraint/index, dan journal `drizzle.__drizzle_migrations` dipertahankan. Setelah truncate, migrator berikutnya harus menjadi no-op. Roles/grants yang mungkin dibuat migration juga di-truncate, lalu diprovisi kembali oleh seed referensi.

**Tidak memakai `packages/db/src/reset.ts`:** script itu drop tabel `public`, sedangkan journal berada pada schema `drizzle`. Memakainya lalu menjalankan migrator dapat meninggalkan schema kosong tetapi history tetap menyatakan migration sudah diterapkan.

Reset baru berupa SQL operasional khusus staging, bukan general-purpose API. Sebelum mutation, SQL memeriksa expected database/role, confirmation, environment staging, bukan superuser, dan history schema yang sudah lengkap telah diperiksa caller. Target server yang disetujui tetap tepat `qadfstore`/`qmarketplace`; nilai target bukan disimpulkan dari env lokal.

SQL mengumpulkan daftar tabel sebelum truncate dan memeriksa bahwa FK cascade tidak menarget tabel/journal di luar `public`; bila ditemukan dependency keluar scope, **STOP**, jangan memperluas cascade. Reset memakai transaction, statement/lock timeout, dan error menyebabkan rollback. Tidak menggunakan `DROP SCHEMA`, `DROP DATABASE`, atau `down -v`.

### 4.2 Reuse bootstrap referensi existing

Gunakan CLI existing `packages/db/src/production-bootstrap.ts` untuk preflight, seed referensi, dan verify. Walau nama modul mengandung “production”, target sesungguhnya berasal dari manifest dan guard `current_database()`; parser menerima `NODE_ENV=production` bersamaan dengan `APP_ENV=staging`.

Tambah service `bootstrap` staging dengan image tooling existing, entrypoint `npx tsx src/production-bootstrap.ts`, manifest staging read-only dan report directory. Tidak merombak modul bootstrap atau melonggarkan guard production.

Seed referensi ini membuat Initial Roles/grants, HQ administratif lokal tanpa Jubelio mapping, system config, dan marker bootstrap. Tidak membuat akun demo, pelanggan, order, diskon aktif, footer palsu, atau produk dummy. Marker existing bernama `production.bootstrapReferenceVersion` tetap digunakan karena merupakan kontrak CLI, bukan pemilih tenant atau izin production.

**Jangan menjalankan `db:seed`, `seed.ts`, atau `db:reset` sebagai shortcut.** `SEED_MODE=jubelio` pada seeder demo bukan pengganti reference-only bootstrap.

### 4.3 Runtime staging bukan production tenant

- `NODE_ENV=production` tetap dipakai untuk build/runtime Next.js dan secure cookies.
- Store dan admin menerima `APP_ENV=staging`.
- Store menerima `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true` secara eksplisit setelah credentials sandbox cocok dengan sumber lokal yang dikonfirmasi pemilik.
- Hapus hardcode mode stock-write production dari staging. Tidak menyalakan direct-adjustment production sebagai fallback. Gateway SO staging menggunakan jalur test-account existing.
- `JUBELIO_API_BASE_URL` dan Shipment host tetap host resmi sesuai source lokal; hostname yang sama tidak membuktikan tenant sama. Jangan mengganti host menjadi URL fiktif yang mengandung kata sandbox.
- `E2E_PROVIDER_MOCKS` dan semua override provider mock tidak boleh masuk `.env`/container staging.
- `CHECKOUT_TRUST_PROXY=true` dipertahankan hanya karena store/admin tidak membuka port publik dan Caddy menimpa forwarded IP.
- Production Compose dan template production tidak diubah. Perubahan wrapper bersama wajib backward-compatible dan bukan izin redeploy production.

### 4.4 Identitas release dan distribusi perubahan

Source final tidak cukup disebut “main”: konfigurasi deployment yang diperbaiki belum ada pada commit audit.

Default tanpa commit/push: release dicatat sebagai **base SHA + checksum bundle patch allowlist**, termasuk file baru. Bundle berisi hanya file implementasi yang disetujui, tidak seluruh dirty worktree, env, secrets, `.scratch`, atau output testing. Setelah izin eksekusi/transfer eksplisit, server checkout base yang dipin dan menerima patch yang lolos `git apply --check`; file baru diverifikasi melalui manifest checksum. Jika cara transfer/akses Git tidak tersedia, STOP dan minta izin jalur alternatif, bukan commit/push otomatis.

Tetapkan `APP_RELEASE` dengan identitas tersebut, simpan manifest aman, dan build store/admin/migrate/bootstrap dari tree yang sama. Tidak mengklaim SHA murni bila binary menyertakan patch. Bila pemilik kemudian mengizinkan commit/push, gunakan SHA final sebagai pengganti bundle, tanpa memperluas scope otomatis.

## 5. Kontrak konfigurasi dan secret

### 5.1 Matriks sumber env

| Kelompok | Sumber/acuan | Aturan staging |
|---|---|---|
| `DATABASE_URL`, DB role/name | Server staging existing | Tetap DB `qadfstore`, role `qmarketplace`, container memakai host gateway. Jangan copy DSN lokal. |
| Public URLs, auth URLs | Domain staging existing | Store/admin tetap domain staging, internal URL `http://store:3000`; tidak ada `localhost` pada link publik. |
| Better Auth secret | Env lokal yang efektif | Harus identik store/admin; bila sumber berbeda, STOP. Session lama memang dibuang bersama data. |
| Jubelio Omnichannel/channel/webhook | `.env` lokal | Transfer secret secara aman dan konfirmasi kesamaan tanpa mencetak nilai; tidak memakai credentials server lama sebagai fallback. |
| Shipment credentials/host/callback secret | Env lokal | Terpisah dari Omnichannel; callback secret khusus tidak diganti secret API umum. |
| Midtrans keys/mode | Env lokal | Sandbox, `MIDTRANS_IS_PRODUCTION=false`; pertahankan Snap default bila tidak ada override valid. |
| SMTP | Env lokal efektif | Passthrough tervalidasi; keberadaan secret bukan bukti email delivery. |
| Google OAuth | Credential staging terkonfirmasi dari pemilik | Pengecualian yang dikoreksi17November: jangan menyalin dua key Google dari lokal atau memilih legacy otomatis. Tunggu file privat; callback domain staging diperiksa. Bukan bukti OAuth end-to-end. |
| Cron secret | Env lokal | Sama untuk store dan file wrapper; tidak ditulis sebagai literal di crontab/log. |
| Import cap/filter | Bukan konfigurasi development | Bootstrap memaksa cap/start-page kosong dan tanpa `--item-name`; full import dimulai dari halaman 1. |
| `APP_RELEASE`, report directory | Release staging ini | Nilai aman, bukan credentials, terikat manifest release. |

Load candidate lokal mengikuti root env kemudian override app-local yang relevan. Transfer hanya key allowlist; jangan mengeksekusi file env sebagai shell script. Pengecualian DB/URL/mode staging di atas mengalahkan copy mentah. Jangan mengubah `.env` atau database development pengguna.

`.env` aktual, manifest terisi, dan password Owner di-ignore Git dan Docker context. Gunakan SSH terenkripsi dan stdin/file mode ketat tanpa secret pada argv, history, chat, atau raw `compose config`. Sebelum build, periksa `.dockerignore` juga melindungi env **di subfolder**, staging secrets, dan manifest aktual. Registry image dan artifact test tidak boleh membawa secret.

### 5.2 Konfigurasi PPN, pembayaran, dan pengiriman

Manifest `deployment/staging/bootstrap.config.json` merupakan input aktual yang tidak di-commit. Template tanpa secret disediakan di repository.

| Input | Kontrak |
|---|---|
| `expectedDatabase` | Tepat `qadfstore` pada server ini. |
| `reservationTtlMinutes` | Nilai kebijakan existing yang diverifikasi; tidak menebak TTL baru. |
| `taxPpnRatePercent` + `jubelioSalesTaxId` | Pasangan website/master sandbox yang sama rate, signed tax ID nonnol, output account valid; periksa GET master. Jangan hardcode ID tenant riset. |
| `discountsContractVersion` | Seed `0` untuk fase tertutup; ubah ke `1` setelah seluruh config/readiness tervalidasi, sebelum smoke checkout read-only yang relevan. Manifest verifikasi diselaraskan pada aktivasi; rerun seed tidak digunakan untuk overwrite. |
| `discountImport.*` | Batas default existing: 1.000 baris, 5 MiB compressed, 25 MiB expanded; tipe/value valid. |
| `shipment.parcelFallback` | Gram/cm per unit dari nilai operasional yang sah; data contoh seed bukan otomatis ukuran nyata. |
| `shipment.packagingWeightGrams` | Integer positif sesuai kontrak manifest bootstrap; jangan memaksakan nilai 0 yang parser bootstrap tidak menerima. |
| `checkout.paused` | Seed `true`. Selama cutover/testing agent yang berisiko tetap tertutup. Perubahan SQL perlu recreate/restart store karena cache proses. |
| `JUBELIO_PAYMENT_ACCOUNT_ID` | Positive safe integer yang tersedia di master akun sandbox; diteruskan ke store. |
| `JUBELIO_PAYMENT_TYPE` | Integer nonnegatif sesuai kontrak provider. Nilai lokal `transfer` tidak disalin apa adanya karena reader mengharapkan angka; kode final harus diverifikasi dari sumber provider/evidence tenant. |
| Origin branch | Hierarki wilayah/Area ID/postcode sah, sender phone/address; tidak diisi dari dummy seed. |
| Jam operasi/pickup | Kebijakan branch yang sah; lokasi Jubelio saja tidak menyediakan keputusan jam operasi. |

Config yang tidak ada di env (misalnya pajak, parcel, jam branch, konten legal) bukan alasan menyalin seluruh DB lokal. Boleh mencari source/evidence existing dan membaca kandidat config allowlist secara read-only saat implementasi bila diperlukan; nilai operasional yang belum terverifikasi menjadi input pemilik atau blocker, bukan diisi dengan tebakan.

### 5.3 Provisioning akun dan konten

- Bootstrap tepat satu System Owner pertama melalui `src/bootstrap-owner.ts`, `--expected-database qadfstore`, dan `--password-file` mount read-only. Identity/secret baru diberikan pemilik lewat jalur aman; tidak memakai akun/password demo lama.
- First sign-in wajib forced password reset. Akun customer tidak dibuat oleh seeder dan sesi admin bukan sesi client store.
- Footer/contact, kebijakan yang harus published, dan konten homepage yang diperlukan menggunakan konten yang disetujui pemilik. Jangan mengarang legal copy atau menganggap hasil import membuat semua konten website otomatis tersedia.
- HQ lokal tidak dipakai sebagai origin delivery atau sumber stock.
- Branch eligible pickup/delivery harus dilengkapi sebelum dinyatakan siap. Tidak menurunkan scope menjadi pickup-only diam-diam bila origin delivery belum tersedia.

## 6. Jobs deployment staging

Semua scheduler dipasang pada crontab **user `deploy`**, menggunakan source release yang sama, URL store staging, dan `.env` staging. Preserve seluruh baris non-marketplace. Jangan memasang duplikat; gunakan managed block staging agar pemasangan ulang mengganti hanya block tersebut.

| Job | Jadwal/kontrak | Endpoint | Log host |
|---|---|---|---|
| Reservation sweep | Setiap menit, wrapper existing | `POST /api/cron/sweep-reservations` | `/home/ops/log/marketplace-sweep/staging` |
| Order communications | Setiap menit | `POST /api/cron/process-order-communications` | `/home/ops/log/marketplace-order-comms/staging` |
| Stock refresh | Mulai 02:00 **UTC host**, satu rangkaian harian bounded | `POST /api/cron/refresh-jubelio-stock` | `/home/ops/log/marketplace-stock-refresh/staging` |

Ketiga POST di atas menuju aplikasi sendiri, bukan izin write provider. Stock refresh membaca provider melalui GET lalu memperbarui mirror lokal. Sweep pada binary baru dapat memproses settlement/mirror ketika order ada; karena itu hanya dijalankan setelah tenant sandbox dan database bersih terbukti. Tidak menyisipkan order/job email dummy untuk “membuktikan” cron.

### 6.1 Coverage stock

Satu HTTP invocation membaca maksimal 200 halaman × 100 item ID. Angka tenant lama 39.833 ID tidak dipakai sebagai angka sandbox.

1. Hitung distinct mapped item IDs sandbox dengan join yang sama seperti scanner.
2. Tentukan `N = max(1, ceil(eligibleIds / 20000))`.
3. Wrapper stock ditambah argumen opsional `--runs N`, default `1` untuk backward compatibility. N harus integer positif dengan batas aman maksimal 12 per rangkaian; bila data melebihi kapasitas tersebut atau time budget tidak cukup, STOP dan ajukan penyesuaian kapasitas, jangan menyatakan coverage penuh.
4. Satu lock `flock` melindungi seluruh rangkaian. Jalankan invocation berurutan, bukan paralel. Timeout 540 detik berlaku per invocation; gagal HTTP/incomplete menghentikan rangkaian dengan exit nonzero dan log yang jujur.
5. Pasang N aktual pada cron staging. Jumlah hasil per run bukan bukti coverage unik: verifikasi timestamp semua pasangan mapped, tidak ada missing observation, tidak ada hold negatif, dan freshness maksimal satu hari.
6. Re-evaluasi N saat katalog bertambah; catat jumlah eligible, N, durasi, oldest observation, dan hasil coverage. Pertumbuhan melampaui kapasitas merupakan kondisi operasional yang perlu ditangani, bukan auto-success.

Wrapper email/stock memiliki Git executable mode `100755`. Direktori log dibuat di bawah `/home/ops/log` yang writable oleh `deploy`; bukan `/home/ops/logs` yang belum ada. Retensi harian tetap mengikuti kontrak wrapper existing. Jangan mengubah journald/firewall host.

### 6.2 Maintenance dan verifikasi jobs

Sebelum reset/migration, hilangkan sementara seluruh entri cron marketplace staging yang aktif; hentikan writer store/admin dan mock lama. Caddy boleh tetap berjalan dan menghasilkan 502 sementara. Tunggu proses job lama selesai atau identifikasi/hentikan hanya proses staging yang pasti; jangan mematikan proses lain.

Pasang kembali managed block hanya setelah bootstrap/import/smoke awal lulus. Untuk setiap job, periksa minimal dua eksekusi scheduler yang berbeda; stock boleh memiliki satu rangkaian manual dan satu rangkaian cron terjadwal bila jadwal 02:00 belum tiba. **Sebelum ada bukti run terjadwal, acceptance scheduler stock tetap Pending**, meskipun manual run sukses.

Periksa body/result metrics, queue/recovery errors, log wrapper, serta journald; HTTP 200 saja tidak membuktikan semua substep sweep sukses. Pada DB bersih, sweep/email no-op yang sehat diterima sebagai bukti scheduler/transport, bukan bukti email delivery atau settlement.

## 7. Blueprint teknis tingkat file

Path berikut merupakan scope implementasi yang diusulkan, **belum dibuat/diubah oleh penulisan spec**. Layer deployment/SQL/test berbeda dari HTTP route; tidak menambah query pada route aplikasi.

| Path lengkap dari root repo | Aksi | Tanggung jawab / layer | Public seam dan prior art |
|---|---|---|---|
| `deployment/staging/docker-compose.yml` | Modify | Runtime staging sandbox; payment/Shipment/env passthrough; `APP_RELEASE`; service bootstrap + mount manifest/report. Deployment config. | Resolved `docker compose config` menggunakan env dummy; public CLI tooling container. Pembanding service bootstrap production. |
| `deployment/staging/.env.example` | Modify | Semua key relevan tanpa secret, payment type numerik, flag test-account, import cap kosong, report path. Deployment template. | Resolved Compose + runbook preflight. |
| `deployment/staging/bootstrap.config.example.json` | Create | Manifest referensi non-secret dengan required inputs eksplisit dan target staging. Deployment input. | `production-bootstrap.ts preflight/seed` pada DB disposable. |
| `deployment/staging/reset-data.sql` | Create | Guard target/role/confirmation dan truncate data `public` atomik; journal/schema tetap utuh. SQL operasional, bukan migration generated. | Eksekusi berkas SQL yang sama pada DB disposable; unknown target/role/confirmation tidak menghapus canary rows. |
| `deployment/staging/sweep-reservations.cron` | Create | Jadwal sweep staging resmi yang sebelumnya hanya ada di server. Scheduler config. | Managed block terpasang + log cron; fixture wrapper existing. |
| `deployment/staging/order-communications.cron` | Modify | Path log `/home/ops/log`, user dan dokumentasi konsisten. Scheduler config. | Wrapper mock-curl + eksekusi terjadwal server. |
| `deployment/staging/stock-refresh.cron` | Modify | Jadwal harian UTC, argumen bounded runs; komentar tidak lagi menyebut setiap lima menit. Scheduler config. | Test wrapper/template dan coverage di server. |
| `deployment/common/cron/refresh-jubelio-stock.sh` | Modify | Tambah `--runs`, validasi, satu lock seluruh rangkaian, error propagation; default tetap satu run. Host CLI wrapper. | `bash deployment/common/cron/refresh-jubelio-stock.test.sh`. |
| `deployment/common/cron/refresh-jubelio-stock.test.sh` | Modify | Expected request count literal untuk N=1/N=2, input invalid, fail-run, lock/no overlap di Linux, path endpoint/secret, template. Test CLI mock-curl. | Tidak menghubungi provider. |
| `deployment/common/cron/process-order-communications.sh` | Modify metadata/copy | Executable bit dan contoh lokasi log/user konsisten; tidak mengubah retry bisnis. Host CLI wrapper. | `bash deployment/common/cron/process-order-communications.test.sh`. |
| `deployment/common/cron/process-order-communications.test.sh` | Modify bila perlu | Tambah assertions executable/path log yang berubah; perilaku HTTP tetap. Test CLI. | Mock curl, log temporary. |
| `deployment/staging/deployment-config.test.mjs` | Create | Uji config Compose yang dirender dengan credentials dummy; tolak source/runtime/mock salah dan validasi mount/secret boundaries. Integration config test. | `node --test deployment/staging/deployment-config.test.mjs`; bukan regex atas komentar saja. |
| `packages/db/src/migrations/staging-data-reset.db.test.ts` | Create | Test public SQL reset, transaksi, data kosong, rerun migrator no-op, journal hashes tetap, reference-only reseed berhasil. DB integration test. | Helper `packages/db/src/testing/disposable-database.ts`; berkas SQL aktual, bukan implementasi reset duplikat. |
| `packages/db/src/production-bootstrap/production-bootstrap-cli.db.test.ts` | Modify | Tambah skenario env `APP_ENV=staging` + `NODE_ENV=production`, target staging disposable, tanpa perubahan implementasi CLI existing. Public CLI test. | CLI real + PostgreSQL disposable. |
| `apps/store/src/lib/jubelio-sales-client.test.ts` | Modify test bila coverage belum ada | Kunci runtime `NODE_ENV=production`, `APP_ENV=staging`, opt-in test-account, dan mock tetap ditolak; tidak mengubah implementation gateway. Test public runtime resolver. | `resolveJubelioSalesRuntime()` melalui focused unit test. |
| `playwright.staging.config.ts` | Create | Opt-in smoke target allowlist dua origin staging, tanpa auto-start server/provider mocks/legacy auth setup; output seluruhnya di `playwright/`. Browser test config. | `npx playwright test --config=playwright.staging.config.ts --reporter=line`. |
| `e2e/store/staging-deployment.spec.ts` | Create | Smoke katalog/detail/login tanpa submit order/quote; fail bila aksi terlarang akan dikirim. Browser public seam. | Prior art `e2e/store/production-catalog-mock.spec.ts`, tetapi pakai kontrak aktual page size 20 dan kolom `status`, bukan asumsi `is_active`/12 pada spec lama. |
| `e2e/admin/staging-deployment.spec.ts` | Create | Login Owner/forced reset, realm isolation, baca katalog/branch/jobs-related surfaces dengan state kosong yang jujur; tanpa fulfillment action. Browser public seam. | Prior art `e2e/admin/production-bootstrap-mock.spec.ts`. |
| `deployment/.gitignore` | Modify | Ignore manifest/secrets staging aktual; template tetap tracked. Deployment hygiene. | Git ignore checks dengan filename dummy. |
| `.dockerignore` | Modify | Tolak env/secrets/manifest aktual semua subfolder dari build context; tidak menghapus source/package manifests yang diperlukan. Build hygiene. | Negative fixture secret tidak ada pada image/context yang dipakai build. |
| `docs/deployment-docs/staging-phase-2-deployment.md` | Create | Runbook staging disposable: source/env → maintenance → migrate → truncate → reference seed → Owner → full import → jobs → smoke → handover; recovery tanpa backup. Dokumentasi operasional. | Walkthrough command aktual setelah implementasi, expected output/STOP/evidence. |
| `docs/deployment-docs/README.md` | Modify | Navigasi runbook staging baru dan peringatan quick-start lama bukan alur cutover ini. Dokumentasi. | Link check. |
| `docs/deployment-docs/operations.md` | Modify terbatas | Tautkan alur staging baru agar operator tidak menyalakan app sebelum schema/config siap. Dokumentasi. | Review konsistensi runbook. |
| `docs/deployment-docs/jubelio-sync.md` | Modify terbatas | Bedakan env sandbox staging baru dari catatan staging-live historis; coverage bounded runs dan izin provider. Dokumentasi. | Cocok dengan resolved Compose/wrapper. |
| `docs/deployment-docs/order-communications.md` | Modify terbatas | Path log/user staging actual dan batas bukti no-op job. Dokumentasi. | Cocok dengan template/hasil cron. |
| `.scratch/production-deployment/ticket/verifikasi-deployment-staging-fase-2.md` | Create saat implementasi | Evidence register AC → command/result, release manifest aman, izin, limitations. Bukan breakdown tiket baru. | Main agent mengisi hanya hasil yang benar-benar dijalankan. |

File actual server non-tracked: `.env`, `bootstrap.config.json`, secret Owner read-only, crontab `deploy`, log/report host di `/home/ops/log/…`. File secret tidak ditampilkan dalam blueprint sebagai artefak yang akan dipublikasikan.

### 7.1 Kontrak baru/berubah tanpa body implementasi

- `reset-data.sql`: dijalankan melalui `psql -X -v ON_ERROR_STOP=1 -f deployment/staging/reset-data.sql` dengan session settings `app.deployment_environment=staging`, `app.staging_reset_expected_database`, `app.staging_reset_expected_role`, dan `app.staging_reset_confirmation`. Expected/actual DB dan role wajib sama, confirmation sama dengan nama DB, semua input nonblank, role bukan superuser. Caller memasok target server yang dipin, bukan env lokal. Database bernama production dilarang. Test hanya menggunakan DB disposable yang helper validasi. Successful reset menyisakan struktur/journal dan mengosongkan semua tabel aplikasi. Session missing/invalid atau dependency di luar scope menyebabkan failure sebelum commit.
- `refresh-jubelio-stock.sh --url <https-origin> --env-file <file> --log-dir <dir> [--runs <1..12>]`: default runs=1, serial, satu lock, satu HTTP timeout per run; exit nonzero pada input invalid/overlap/HTTP/incomplete.
- `bootstrap` staging: `docker compose -p staging --env-file .env --profile tools run --rm bootstrap <preflight|seed|verify> --config /bootstrap/bootstrap.config.json [--phase …|--import-report /reports/import.json]`. Kontrak CLI existing tidak berubah; `verify` exit 0 bukan bukti transaksi/provider readiness.
- `playwright.staging.config.ts`: opt-in `STAGING_SMOKE=true`; `STAGING_STORE_URL`/`STAGING_ADMIN_URL` hanya menerima origin staging yang dipin; credentials lewat kanal environment/file privat, tidak di-commit. Reporter/artifact pada `playwright/reports/staging/` dan `playwright/results/staging/`.
- Tidak ada exported business API atau endpoint aplikasi baru. SQL reset bukan penambahan schema owner di app; tidak mendefinisikan tabel di luar `packages/db/src/schema/`.

### 7.2 Keputusan struktur dan alternatif yang ditolak

- Reuse bootstrap existing, bukan seeder demo atau framework deployment baru: public CLI sudah mempunyai target guard, reference-only seed dan verifier.
- Migrate + truncate data dengan journal tetap, bukan drop DB atau `reset.ts`: sesuai izin data baru tanpa membutuhkan privilege provisioning database atau merusak history.
- Smoke staging dipisah dari mock/legacy config: mencegah setup seeded user, E2E provider mocks, atau test mutatif tak sengaja dijalankan ke server.
- Tidak menyunting spec smoke production lama sebagai syarat deployment staging; hanya mengambil prior art yang valid. Defect spec lama dicatat, bukan ditutupi oleh test count.
- Tidak menambah generic deploy orchestrator/autonomous loop atau backend service baru untuk mengabstraksi beberapa command operator.

## 8. Blueprint UX dan kontrak browser

**Perubahan desain UI: N/A** — tidak ada page/component/style/token/business flow yang didesain ulang. Tujuan browser review adalah memastikan UI release yang sudah disetujui tampil dan dapat dipakai setelah deployment/config/data berubah.

Referensi: halaman release `main`, spec [checkout fase 2](../../checkout-simplification/plan/audit-findings-phase-2.md), [alamat tersimpan](../../checkout-delivery-address/plan/alamat-tersimpan-sebelum-order-spec.md), dan pola komponen existing di `packages/ui`. Tidak menyalin data fixture ke server demi membuat tampilan terlihat penuh.

| Surface / tugas | State dan copy / perilaku yang dipertahankan | Bukti yang diizinkan |
|---|---|---|
| Store `/`, `/products`, product detail | Katalog berasal dari sandbox; “Semua Produk”, jumlah/stock/harga tidak error; skeleton/empty/error mengikuti UI existing. Tidak mengganti empty menjadi data demo. | Desktop 1440 dan mobile 390; screenshot sukses/DOM aman; tidak ada pageerror/5xx. |
| List/filter/search | Backend API existing; SSR awal 20 item, pagination/infinite load mengikuti `InfiniteProductGrid`; filter/sort/URL state existing tidak diubah. Tidak memakai client filtering current page sebagai pengganti backend search. | Baca response pagination; pilih literal produk/variant dari GET sandbox sebagai expected value independen; uji halaman lanjut bila dataset mencukupi. |
| Admin login dan Owner | Forced reset existing, kemudian current policy System Owner. Admin cookie tidak menjadi store client session. Tidak memunculkan default credential. | Login lokal staging dan reset password yang disetujui; tidak menjalankan Google OAuth. |
| Admin orders/discounts/recovery | Empty state wajar pada DB baru; tidak ada ledger/order/promo dummy. Akses sesuai current policy. | Baca/list saja; tidak klik fulfillment/payment/booking/retry-provider. |
| Checkout hasil/status/alamat | Flow release fase 2 tidak diubah. State loading/owner-scoped error/login return berasal dari implementasi existing; tidak memalsukan order hasil pembayaran untuk screenshot server. | Regression mock yang sudah ada pada fixture lokal; state yang memerlukan order nyata tetap di luar bukti staging saat ini. |
| Delivery origin/regions | Dropdown/hierarki existing, validasi server dan read-only postcode; tidak mengarang Area ID/alamat cabang. | Region GET dan review branch config; hindari quote yang otomatis mengirim provider POST. |
| Maintenance | Store/admin berhenti sementara; Caddy dapat mengembalikan 502. Ini downtime terencana, bukan halaman maintenance baru. | Operator diberi tahu awal/akhir downtime; tidak menjanjikan zero downtime. |

Component reuse: semua komponen tetap existing, antara lain `apps/store/src/components/InfiniteProductGrid.tsx`, `apps/store/src/components/ProductFilters.tsx`, komponen order/checkout release, dan shared UI. Tidak ada komponen baru atau prototype.

Accessibility review terarah: keyboard login/filter, focus terlihat, layout tanpa overflow pada 390 px, contrast/status tone tetap sesuai release. State matrix/copy baru, permission baru, atau perubahan list contract tidak termasuk scope; temuan memerlukan keputusan terpisah, bukan perbaikan UI diam-diam.

## 9. Urutan eksekusi yang diusulkan

Tahapan berikut adalah urutan operasional dalam **satu deliverable staging**, bukan tiket atau klaim delivery backend-only. Tidak dijalankan pada sesi penulisan spec.

### Tahap A — Persiapan tanpa downtime

1. Dapatkan approval complete plan dan izin eksekusi yang menyebut host, DB, reset tanpa backup, transfer source/secret, login provider/import, restart, Owner, cron, dan batas non-canary.
2. Recheck baseline/working trees, DB target/role/schema ownership, domain, disk/RAM, tool versions, container/project lain, dan proses cron. Jangan menyentuh production yang mungkin telah muncul sesudah audit.
3. Tuntaskan input §12, termasuk identitas Owner dan data operasional branch/config. Tidak memulai destructive window bila input fundamental belum tersedia.
4. Implementasikan perubahan deployment/tests/docs yang disetujui, satu public seam RED → GREEN. Context7 inquiry dilakukan sebelum external API code pertama; signature yang dikonfirmasi dicatat pada evidence.
5. Distribusikan release pinned sesuai §4.4 dan susun env staging allowlist; lakukan resolved Compose validation tanpa output secret.
6. Build image store/admin/migrate/bootstrap **tanpa menyalakan container aplikasi baru**. Build serial bila diperlukan untuk menjaga RAM. Verifikasi tools container bisa menjalankan CLI dan memuat source/packages/migration.
7. Login sandbox untuk master/region GET yang diizinkan; verifikasi tax/account/config dan simpan hanya evidence aman. Credentials mismatch, tenant meragukan, atau target DB salah → STOP sebelum reset.

### Tahap B — Maintenance, migration, dan data baru

1. Umumkan downtime; nonaktifkan jobs staging, stop store/admin serta mock lama. Caddy dan seluruh volumes dipertahankan. Pastikan tidak ada proses job lama tersisa atau client connection aplikasi yang masih menulis.
2. Jalankan preflight before-migrate dari tools release target dengan manifest staging. Bandingkan applied hashes/timestamps terhadap manifest release; jangan “memperbaiki” journal manual.
3. Jalankan `migrate` **tanpa seed**; expected exit 0. Preflight after-migrate dan pemeriksaan objek schema fase 2 harus lulus. History target 59 entries pada baseline ini.
4. Jalankan SQL reset data §7.1 dengan target/confirmation yang eksplisit. Pastikan tabel `public` kosong, journal/hash/constraint/index tetap ada. Tidak membawa order lama ke processor baru.
5. Seed referensi via `bootstrap seed`; expected `REFERENCE_SEED_APPLIED`. Rerun seed sebagai pemeriksaan no-op harus tidak menambah/mengubah data referensi.
6. Bootstrap System Owner dengan file password; rerun harus `OWNER_EXISTS`, bukan membuat Owner kedua atau mengganti password.
7. Isi config/konten/origin/jam operasional yang telah tervalidasi secara terarah. Catat sumber dan scope; jangan melakukan import fixture/dummy `seed.ts`.

### Tahap C — Full import dan integritas sandbox

1. Jalankan `npx tsx src/import-jubelio.ts --full --expected-database=qadfstore --report-file=/reports/import.json` menggunakan tooling sandbox. Argumen `--expected-database=`/`--report-file=` mengikuti parser existing yang membaca bentuk inline; bukan menyalin contoh space-separated yang belum didukung.
2. Env import hanya memuat DB staging, credentials master-read sandbox, release, dan tuning yang diizinkan. Cap/start-page kosong, tanpa filter. Report host durable di `/home/ops/log/marketplace-bootstrap/staging/`.
3. Expected `FULL_IMPORT_COMPLETE`, status report `complete`, source ID sets/counts sesuai hasil DB, seluruh mapped SKU/branch pair mempunyai observation timestamp; local holds awal nol. HQ lokal dikecualikan dari provider branch.
4. Error/partial/missing master atau stock → jangan lanjut. Perbaiki penyebab, rerun full import dari halaman 1; upsert idempotent tidak memerlukan truncate ulang. Jangan menandai partial sebagai sukses hanya karena katalog sudah muncul.
5. Jalankan verifier existing dan pemeriksaan tambahan staging: journal lengkap, roles/grants, Owner, config types/values, tidak ada order/client/discount/provider operation dummy, origin readiness, import cap tidak terbawa, oldest stock age dan coverages.
6. `BOOTSTRAP_VERIFIED` hanya satu bukti; baca juga `launchBlockers`. Verifier existing memuat check stock-write produksi yang tidak persis mewakili gateway test-account staging. Jangan menyalakan switch production hanya untuk menghilangkan warning tersebut; gunakan runtime resolution staging dan verifikasi terarah, dengan penjelasan pada evidence. Service bootstrap minimal hanya membawa master-read credentials; warning SMTP/Midtrans/settlement yang muncul karena credentials sengaja tidak dipasang pada tools tidak boleh disamakan dengan runtime store yang kosong. Verifikasi keberadaan/tipe/identitas pada resolved runtime store/admin secara aman dan petakan **setiap** blocker sebagai actual failure atau tooling-only mismatch dengan bukti; jangan mengabaikan seluruh daftar.

### Tahap D — Aplikasi, jobs, dan handover

1. Start/recreate paired store/admin dari release final yang sama, masih dengan `checkout.paused=true`; container healthy dan HTTPS benar.
2. Verifikasi Owner/forced reset, realm isolation, public catalog/detail, admin read-only surfaces dan konfigurasi. Readiness delivery tidak boleh ditutupi sebagai pickup-only.
3. Set diskon contract `1` setelah guard/config valid; manifest/evidence mencerminkan config aktif. Restart/recreate proses yang cache config-nya perlu refresh.
4. Pasang managed cron block staging dan jalankan no-op sweep/email serta bounded stock refresh. Verifikasi run scheduler sesuai §6.2; jangan menanam order/email job provider untuk test.
5. Jalankan smoke browser staging dan rendered regression review §8 dengan network/action guard. Jangan menjalankan broad legacy E2E atau provider canary ke server.
6. **Pembukaan checkout diusulkan sebagai gate handover operator:** setelah seluruh readiness config lulus, pemilik memberi konfirmasi aktivasi sebelum `checkout.paused=false` dan recreate store. Izin login/import tidak diasumsikan mengizinkan agent mengirim order percobaan. Jika konfirmasi aktivasi belum ada, checkout tetap paused dan acceptance aktivasi dinyatakan Pending secara eksplisit.
   **Pengecualian yang disetujui17November2026:** pemilik meminta staging dibuka meskipun gate readiness belum seluruhnya lulus. Flagfalse diterapkan13:24 UTC dan store direcreate. Jangan menyatakan origin/callback/Google/full verification lulus atau menjalankan canary provider karena pengecualian ini.
7. Serahkan identitas release, akses Owner melalui kanal privat, inventory jobs/jadwal, evidence AC, serta batas provider yang belum diuji. Tidak memberi label “seluruh transaksi teruji” dari hasil mock/no-op jobs.

## 10. Strategi testing dan bukti

### 10.1 Seams yang diajukan untuk disetujui bersama spec

Utamakan public operational boundary: **resolved Compose → CLI tools/migrator/SQL reset → public HTTPS/browser**. Tidak menguji fungsi private atau membuat assertions berdasarkan regex komentar saja. Expected catalog/tax/account berasal dari GET master yang independen, bukan hanya report importer. Fixture deterministic dipakai untuk destructive test dan wrapper; tidak memakai akun provider nyata pada suite otomatis lokal.

| Seam | Coverage penting | Sumber prior art |
|---|---|---|
| Resolved Compose | Staging env, DSN sama, shared auth secret, proper URL, payment/Shipment keys, no mock, tooling mount/report, secret build exclusion | Compose production + audit resolved config |
| Migrator + SQL reset | Upgrade baseline 0015 ke release terbaru pada DB disposable; no-op rerun; data kosong dan journal utuh; wrong env/DB/role/confirmation tidak menghapus data; transaksi rollback bila gagal; seed reference-only sesudah reset | `migration-0018-rehearsal.test.ts`, `fresh-production-rehearsal.test.ts`, disposable helper |
| Bootstrap/Owner/full-import public CLI | Target guard, env staging + production Node, safe rerun, complete report, missing coverage menolak | Existing bootstrap CLI/full import DB tests |
| Wrapper CLI | Auth header, endpoint, path log, runs=1/2, invalid runs, fail fast, locking, jadwal, executable permission | Existing shell tests dengan curl fixture |
| Staging public browser | Catalog/page continuation/detail, Owner/forced reset, realm isolation, empty states, URL/TLS, tidak ada request transaksi/quote | New opt-in staging specs; source release existing |

Scope ini tidak menambahkan E2E mock spec baru; `playwright.staging.config.ts` mempunyai `testMatch` eksplisit untuk dua live smoke specs yang dibatasi tersebut. Jika implementasi kemudian memerlukan mock spec tambahan, wajib daftar pada `playwright.mock.config.ts` dan review delta plan.

### 10.2 Ladder verifikasi saat implementasi

- L0: typecheck store/admin bila konfigurasi TS/E2E menimbulkan dampak pada project types; typecheck package DB untuk test/logic DB yang berubah. Tidak ada typecheck pada penulisan spec ini.
- L1 RED → GREEN per slice: explicit paths, contohnya:
  - `node --test deployment/staging/deployment-config.test.mjs`.
  - `bash deployment/common/cron/refresh-jubelio-stock.test.sh` dan `bash deployment/common/cron/process-order-communications.test.sh`.
  - `npm run verify:unit:slice -- packages/db/src/migrations/staging-data-reset.db.test.ts packages/db/src/production-bootstrap/production-bootstrap-cli.db.test.ts` pada **TEST_DATABASE_URL disposable**; pastikan test benar-benar jalan, bukan skipped.
  - Tambahkan regression focused gateway runtime `apps/store/src/lib/jubelio-sales-client.test.ts` bila config-runtime staging belum tercakup, tanpa mengubah perilaku aplikasi di luar plan.
- L2 hanya di akhir deliverable terintegrasi: full unit `npm run test:unit` memakai DB disposable terkendali; bila parallel DB suites bertabrakan, serial `npm run verify:batch:unit` sebagai evidence tambahan dan laporkan alasan, jangan sembunyikan failure awal. Jangan menjalankan suite yang menulis DB staging nyata melalui env global test.
- Container build/rehearsal tools dan public CLI memakai env dummy/provider fixture dahulu; setelah izin remote, ulangi gate target dengan sandbox read-only.
- Jalankan opt-in Playwright staging dengan explicit dua spec melalui config staging, **bukan** `npm run test:e2e`. Legacy E2E masih perlu izin terpisah. Regression UI fase 2 melalui mock affected specs hanya bila implementasi mengubah UI/routing/auth; plan ini tidak mengubahnya.
- Rendered review tetap dilakukan karena deliverable adalah deployment yang dilihat pemilik, tetapi tidak mengklaim verifikasi state order/payment yang memerlukan transaksi di luar izin.

Output bounded; command logs ditangani di temporary directory/host log aman, dan semua output Playwright di `/playwright/`. Bila gagal, baca Markdown error context; jangan membuka image attachment kegagalan. Catat command, target non-secret, result/count termasuk skipped, waktu, dan AC yang dibuktikan. Tidak mewarisi PASS audit/lokal sebagai PASS server baru.

## 11. Acceptance criteria dan evidence register awal

**Semua AC implementasi di bawah masih Pending.** Penulisan spec tidak mengubah aplikasi/server. Tabel diperbarui saat implementasi; tidak ditutup dengan sekadar jumlah test atau clean diff.

| ID | Acceptance criterion yang dapat diamati | Bukti yang diwajibkan | Status |
|---|---|---|---|
| AC01 | Release target reproducible dan store/admin/tools dari tree yang sama; production tidak disentuh | SHA + bundle checksum/manifest, build IDs, project/host inventory, diff allowlist | Pending |
| AC02 | Credentials yang disepakati sandbox aktif; env/DSN lokal/production tidak tertukar; secret tidak bocor | Perbandingan boolean allowlist, login/master GET aman, resolved config terfilter, ignore/context/image check | Pending |
| AC03 | Seluruh migration release diterapkan dengan journal valid dan rerun migrator no-op | Pre/post manifest hash/timestamp, jumlah expected actual, schema probes, exit 0 | Pending |
| AC04 | Data aplikasi staging lama dibuang seluruhnya tanpa backup; struktur/journal/volumes tetap | DB reset guarded test + target aggregate sebelum/sesudah; journal unchanged; mounts unchanged | Pending |
| AC05 | Hanya referensi yang diperlukan dan satu Owner baru diprovisi; tidak ada seed demo/order/ledger palsu | CLI seed/Owner, rerun no-op/OWNER_EXISTS, counts dan policy checks | Pending |
| AC06 | Full sandbox catalog/stock terimpor tanpa cap/filter; tidak tercampur tenant lama | Report complete, independent source ID/count checks, DB ID sets, fresh stock timestamps dan nonnegative holds | Pending |
| AC07 | Pajak/diskon/payment config valid sesuai tenant dan diteruskan ke runtime | Master GET/evidence code payment type, config value/type checks, runtime test-account resolution | Pending |
| AC08 | Branch origin/jam pickup, parcel/packaging, konten wajib dan callback config siap tanpa dummy | Read-only region/master validation, branch/config checklist dan sumber konten, evidence callback configuration dari operator | Pending |
| AC09 | Store/admin healthy, HTTPS valid dan browser surfaces yang diizinkan usable | Container health, public GET/TLS, dua Playwright smoke specs dan rendered review desktop/mobile | Pending |
| AC10 | Jobs sweep/email terpasang satu kali di crontab deploy dan benar-benar dieksekusi scheduler | Managed block, executable/log permissions, dua run timestamps/job, body/substep/log tanpa error | Pending |
| AC11 | Daily stock job memiliki kapasitas seluruh katalog dan bukti scheduler/freshness | Eligible IDs, N runs, lock/timeout tests, actual cron run, coverage/oldest-age query, log | Pending |
| AC12 | Tidak ada agent business write provider di luar authentication; tidak ada quote/order/payment/booking test | Network/command review allowlist, action guard smoke, log audit aman, tidak ada order/SO test buatan agent | Pending |
| AC13 | Checkout diaktifkan hanya setelah konfirmasi gate handover pemilik dan config gates lulus | Konfirmasi aktivasi, SQL value false + proses baru, browser/config check tanpa submit order | Pending |
| AC14 | Runbook/evidence final menjelaskan recovery tanpa backup dan semua limitations | Walkthrough command/result, docs navigation, AC table lengkap, index date/evidence | Pending |

### Batas verifikasi yang disengaja, bukan bagian yang diam-diam dianggap PASS

- Canary SO → invoice → payment, Midtrans payment session/settlement, quote `POST /rates/all`, booking/pickup transaksi nyata, callback delivery signed nyata, SMTP actual delivery, dan Google OAuth end-to-end **belum diverifikasi pada staging** dalam scope ini.
- Catat batas tersebut pada laporan akhir walaupun AC deployment yang relevan sudah Verified. Tidak menambahkan transaksi provider sebagai acceptance wajib yang mustahil dipenuhi dengan izin login/import saja.
- Bila AC13 belum diizinkan, laporan pertama menyatakan “fitur terbaru sudah dideploy tetapi checkout masih dijeda; AC13 Pending”; tidak menyatakan seluruh deliverable selesai.
- Bila data origin/konten/callback milik operator belum tersedia, AC08 tetap Pending; tidak mengurangi scope menjadi pickup-only atau menganggap env credentials cukup untuk semua pengiriman.

## 12. Input operasional, discovery, dan blocker sebelum Ready/eksekusi

Keputusan data baru, sandbox, tanpa backup, dan jobs **tidak ditanyakan ulang**. Nilai secret tidak dimasukkan ke spec. Daftar berikut membedakan discovery fakta dari keputusan/masukan pemilik.

| ID | Item | Pemilik / cara menutup | Dampak bila belum tersedia |
|---|---|---|---|
| O01 | Approval complete plan dan seams §10 | Ditutup: pemilik menyetujui pada 2026-11-15 melalui “oke saya approve” | Scope/seams disetujui; izin eksekusi O02 tetap terpisah |
| O02 | Izin eksekusi remote/destruktif dan maintenance window | Pemilik memberi perintah eksplisit; downtime diakui | Tidak memulai SSH write/reset/deploy |
| O03 | Identity Owner + password file privat | Pemilik menyediakan melalui kanal aman; format diverifikasi agent | Bootstrap/login baru belum dapat diverifikasi |
| O04 | `discovery:` tax/master payment account/code type sandbox yang cocok | Agent membaca master/evidence primary setelah izin login/import; tidak menebak `transfer` → kode sembarang | Config/checkout gate tertahan |
| O05 | `discovery:` parcel/packaging, origin branch, jam pickup yang sah dan konten wajib | Agent periksa source/candidate lokal yang relevan; pemilik memasok nilai operasional yang tidak bisa dibuktikan dari repo/provider | Readiness pickup/delivery/konten belum lengkap; AC08 Pending |
| O06 | Callback domain/secret dan registrasi dashboard sandbox | Agent periksa local configuration/read-only evidence; pemilik melakukan/menyetujui mutasi dashboard terpisah bila perlu | Tidak mengklaim webhook operational verified |
| O07 | `discovery:` privilege ownership seluruh tabel/schema public dan dependency keluar schema | Agent read-only preflight target; jangan bypass dengan superuser | Reset STOP, butuh operator/keputusan jika privilege kurang |
| O08 | `discovery:` container build, `dist` dependency dan ignore context benar | Main agent build/rehearsal sebelum downtime; app scripts punya prebuild logging, jangan menganggap paket siap tanpa build | Jangan memulai destructive window |
| O09 | Konfirmasi pembukaan checkout sesudah gate runtime | Pemilik saat handover; bukan canary write authorization | Tetap paused, AC13 Pending |
| O10 | `discovery:` release final/base+patch dan akses transfer | Main agent susun allowlist/checksum, pemilik mengizinkan transfer/remote; commit/push terpisah | Tidak build source yang belum terdistribusi |

O03/O05/O06 adalah input operasional penting, bukan alasan mengarang data. Approval 2026-11-15 menutup keputusan scope/seams; input, discovery, dan izin operasional yang tersisa tetap memblokir tahap eksekusi terkait. Konfirmasi aktivasi O09 adalah gate handover yang sudah disepakati, bukan izin provider canary. Bila penutupan item ternyata memerlukan perubahan perilaku/scope, hentikan tahap terkait, revisi spec dan minta approval ulang.

## 13. Recovery, risiko, dan kondisi berhenti

### Risiko yang diterima

- Data staging lama hilang setelah truncate commit; tidak ada backup atau jalur restore data lama.
- Downtime store/admin selama cutover; Caddy dapat mengembalikan 502.
- Full import dapat memakan waktu lama/terbatas rate provider; durasi bukan SLA yang sudah terukur.
- Memakai credentials sandbox yang sama dengan lokal berarti transaksi sandbox yang dilakukan tester kelak dapat memengaruhi stock sandbox bersama development; ini tidak diubah menjadi tenant baru diam-diam.

### Recovery per checkpoint

| Titik gagal | Tindakan aman |
|---|---|
| Sebelum maintenance/reset | STOP; aplikasi lama dapat tetap berjalan sebagaimana existing tanpa tindakan tambahan. Jangan mengganti credentials lama sebelum konfigurasi baru siap. |
| Migration gagal | Pertahankan writer/job staging berhenti; baca error dan journal, perbaiki forward. Jangan start binary lama yang tidak kompatibel atau edit generated SQL/journal manual. |
| Reset transaction gagal | Rollback transaksi reset; schema sudah mengikuti migration yang berhasil. Tetap gunakan binary kompatibel dan stop sampai penyebab dipahami. |
| Sesudah reset commit | Data lama tidak bisa dikembalikan oleh plan ini. Perbaiki config/bootstrap/import dan rerun tahap idempotent, bukan reconnect ke tenant production lama. |
| Full import partial | Simpan report gagal aman, perbaiki dependency, rerun `--full` dari halaman 1. Jangan seed/reset ulang sebagai retry otomatis. |
| Container/smoke/job gagal | Pause checkout, tahan job yang bermasalah, pertahankan reader/config sandbox, forward-fix. Rebuild/recreate hanya source staging yang disetujui. |
| Provider write terlarang terdeteksi | STOP aktivitas agent dan scheduler yang relevan; catat outcome aman, beri tahu pemilik. Tidak melakukan cancel/refund/retry kompensasi tanpa izin. |

Tidak menjalankan Docker prune, `down -v`, menghapus images/volumes, atau menghidupkan kembali mock lama sebagai fallback. `staging-jubelio-mock-1` dihentikan/dihapus sebagai orphan terarah setelah approval eksekusi, tanpa menghapus data volumes lain.

## 14. Fitur, status per fitur, dan urutan review

| # | Fitur/deliverable | Status | verify: | Ketergantungan |
|---|---|---|---|---|
| 1 | Runtime/env/source sandbox staging dan tooling siap dibangun | Ready | Resolved Compose + image/tool CLI + secret boundaries, AC01–AC02 | Approval dan inputs |
| 2 | User path Owner/katalog pada data staging baru | Ready | Migration/reset/reference/Owner/import → public store/admin smoke, AC03–AC09 | Fitur 1; tidak dilaporkan sebagai backend-only delivery |
| 3 | Jobs staging dan daily coverage berjalan | Ready | Scheduler/log/freshness, AC10–AC12 | Tenant/data bersih; source sama |
| 4 | Gate aktivasi dan handover operasional | Ready | Konfirmasi pemilik, config activation, AC13–AC14 | Seluruh readiness; tanpa canary provider |

Main agent mengerjakan, mereview, dan memvalidasi. Tidak ada subagent atau breakdown tiket yang dipublikasikan. Perbaikan/test seam per slice mengikuti RED → GREEN, sedangkan final integration gate dijalankan pada akhir deliverable yang disepakati.

## 15. Catatan verifikasi penulisan spec dan deviation log

Pada sesi penulisan: hanya membaca source/docs, menulis dokumen ini, memperbarui index, dan memeriksa links/diff dokumen. Tidak menjalankan SSH baru, provider requests, database query/mutation, unit/E2E/build/lint/typecheck, atau deployment.

Context7 checkpoint untuk penulisan dokumen: **N/A — tidak mengimplementasikan external API code**. Sebelum implementasi, main agent wajib resolve/query library yang disentuh dan mencatat konfirmasi API/options; bila unavailable gunakan installed types/source atau dokumentasi vendor resmi dengan catatan fallback. Tidak mendelegasikan inquiry kepada implementer.

Deviasi template upstream `to-spec`: file paths dan blueprint disertakan sesuai aturan project; spec disimpan lokal di `.scratch/production-deployment/plan/`, bukan dipublikasikan otomatis atau diberi label agent-ready. Tidak menganggap approval scope percakapan sebagai approval complete spec.

| Slice | Rencana | Aktual / deviasi |
|---|---|---|
| Penulisan spec | Sintesis research + keputusan yang disepakati | Histori sebelum eksekusi; tidak ada deviasi saat penulisan |
| Normalisasi stock refresh17November | Di luar implementasi deployment awal; raw negative availability sebelumnya ditolak refresher | Pemilik menyetujui penyelarasan dengan importer dan kemudian memilih deploy terarah setelah full unit gate gagal pada cancel-race/cleanup unrelated. Signature/query/schema/business flow tidak diubah; tiga file helper/unit/DB-test, docs dan release pinned. Full gate tetap Pending; lihat [scope/evidence](../ticket/penyelarasan-stock-refresh-staging.md). |

## 16. Checklist penutupan saat implementasi kelak

- [ ] Complete plan dan seams testing disetujui; izin eksekusi target/destruktif tercatat.
- [ ] Seluruh AC01–AC14 Verified dengan command/result target yang relevan; tidak ada PASS dari test yang skipped.
- [ ] Release final dan credentials sandbox dapat diaudit tanpa secret.
- [ ] Data aplikasi lama kosong, journal migration utuh, full import complete dan stock coverage fresh.
- [ ] Owner baru dapat login/reset password; tidak ada akun/order/promo/recovery fixture demo.
- [ ] Origin/jam branch, parcel, konten wajib dan callback configuration tervalidasi; tidak ada pengurangan scope delivery diam-diam.
- [ ] Ketiga scheduler staging benar-benar berjalan, log/permissions benar, dan stock daily coverage dibuktikan.
- [ ] Checkout dibuka hanya setelah konfirmasi operator; tanpa konfirmasi, AC13 tetap Pending dan dilaporkan.
- [ ] Bukti browser terarah dan rendered review tersedia tanpa mengirim provider write yang dilarang.
- [ ] Limitations provider quote/transaksi/callback/email/OAuth yang belum diuji dinyatakan apa adanya.
- [ ] Runbook enduring dan navigasi docs diperbarui; walkthrough actual tercatat.
- [ ] Plan tetap disimpan; index fitur diperbarui dengan tanggal/evidence hanya setelah semua AC Verified.
