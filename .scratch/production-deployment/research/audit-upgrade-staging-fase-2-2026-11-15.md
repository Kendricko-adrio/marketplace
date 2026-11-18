# Audit kesiapan upgrade staging ke fase 2 — 15 November 2026

## Kesimpulan

**Belum siap untuk deploy langsung dengan `git pull` lalu `up -d --build`.** Infrastruktur existing sehat, tetapi ada perubahan schema besar, konfigurasi wajib yang belum tersedia, gap wiring Compose, dan keputusan penanganan transaksi lama yang belum ditetapkan. Staging tetap menjalankan versi lama; audit ini tidak mengubah deployment.

Dokumen ini adalah hasil pemeriksaan, **bukan plan yang disetujui atau izin eksekusi**. Pemeriksaan dilakukan langsung oleh main agent; tidak ada delegasi.

## Keputusan lanjutan pemilik setelah audit

Pemilik kemudian menjelaskan bahwa konfigurasi `.env` lokal dan app-local `.env.local` menjadi acuan credentials sandbox staging, dan data/deployment lama tidak memerlukan backup. Melalui klarifikasi terstruktur, pemilik memilih:

- **Data baru:** seluruh data DB staging lama boleh dibuang, termasuk order, akun, katalog, dan config; schema dibentuk melalui migration resmi, kemudian referensi/config dan full import sandbox. Tidak ada backup; data lama tidak dapat dipulihkan melalui proses ini. Izin ini tidak mencakup penghapusan transaksi pada provider atau volume uploads/sertifikat.
- **Login dan import:** izinkan authentication POST Omnichannel/Shipment sesuai kebutuhan serta master/region GET dan penyimpanan hasil ke DB staging. Tidak membuat Sales Order/invoice/payment, booking kurir, refund, atau mengubah transaksi lama pada provider. Canary transaksi tetap Pending dan membutuhkan izin terpisah.

Pemeriksaan lokal lanjutan menemukan `.env` root dan `apps/{store,admin}/.env.local` tersedia; `.env.local` root tidak tersedia. Credentials relevan diperiksa hanya sebagai status keberadaan, tanpa mencetak secret. Root config berisi opt-in akun test Sales dan Midtrans sandbox; `JUBELIO_SYNC_MAX_PRODUCTS` terisi sehingga full refetch tidak boleh mewarisi cap tersebut. Identitas tenant sandbox merupakan konfirmasi pemilik; login provider belum dijalankan pada tahap alignment ini.

Keputusan ini menggantikan kebutuhan mempertahankan data lama dan backup pada B07/B08 untuk scope staging ini, tetapi bukan bukti eksekusi deployment. URL/domain staging dan DSN server tetap dipertahankan; env lokal tidak disalin mentah. Perlu plan lengkap yang disetujui sebelum perubahan repo deployment atau eksekusi server. Tidak ada plan baru, server write, atau provider request yang dijalankan saat pencatatan keputusan.

## Scope dan batas pemeriksaan

User mengizinkan SSH ke staging dan pemeriksaan kelengkapan upgrade. Akses menggunakan alias SSH existing `remote-server`, user `deploy`, repo `/home/ops/marketplace`.

Yang dilakukan:

- Membaca status Git, metadata container/image/volume, resource host, metadata backup, jadwal cron dan permission direktori.
- Membandingkan source release dengan versi repo server serta journal migration database.
- Menjalankan SQL agregat dengan `default_transaction_read_only=on`, statement timeout 10 detik, dan lock timeout pada pemeriksaan awal.
- Menjalankan GET publik untuk root store dan login admin, dengan validasi TLS aktif.
- Memvalidasi Compose target melalui stdin di server menggunakan `.env` staging existing; hanya status keberadaan config dan hasil perbandingan boolean yang dikeluarkan. Config yang berisi secret tidak dicetak.

Tidak dilakukan: fetch/pull pada server, perubahan `.env`, build/start/stop/restart container, migration, seed/reset, backup/restore, pemasangan cron, login/authentication provider, request Jubelio/Midtrans/Shipment, transaksi test, commit, atau push. Query tidak mengambil email, nama, alamat, telepon, token, atau isi order customer.

Context7 checkpoint: N/A — audit source/config existing dan dokumentasi internal, tanpa implementasi atau penulisan external API code.

## Baseline terverifikasi

| Area | Evidence 15 November 2026 |
|---|---|
| Release target | `main` lokal `6c5733833af09635de4a4990e5b1ca4ca5a8f9b5`; `git ls-remote origin refs/heads/main` menghasilkan commit yang sama. Tidak perlu push source `main` lagi untuk mencapai commit ini. |
| Repo server | `main` di `93d12d89f5b0ab892db27c01def352bdba96af83`, worktree bersih. Baseline merupakan ancestor target; terdapat 52 commit tambahan. |
| Container existing | Store/admin healthy; Caddy dan `staging-jubelio-mock-1` berjalan. Tidak ada bukti commit label pada image; commit repo server tidak otomatis membuktikan provenance binary running. |
| HTTP/TLS | `GET https://dev-store.adfsport.cloud/` dan `GET https://dev-admin.adfsport.cloud/login`: HTTP 200, `ssl_verify_result=0`. Ini bukan bukti transaksi end-to-end. |
| Resource | RAM 7,8 GiB, available sekitar 6,8 GiB; disk sekitar 91 GiB available; load mendekati nol; swap tidak tersedia. Headroom awal cukup, tetapi peak build dua image belum diukur. |
| Tooling | Docker 29.6.2, Compose v5.3.1, PostgreSQL client 16.15; service PostgreSQL aktif. Versi server database tidak ditanyakan secara terpisah. Host tidak memiliki `node`/`npm` pada PATH user `deploy`; tools harus memakai image migration yang dibangun dari release target. |
| Database | `qadfstore`, ukuran sekitar 174 MB; 11 order, 3 admin user, 5 client, 28 branch, 110.744 variant dengan Jubelio mapping, 83.710 baris branch stock. |
| Migration history | 16 journal entries, sampai `0015_fixed_hiroim`. **16/16 hash SHA-256 dan timestamp cocok dengan manifest target**; 16 file SQL server juga cocok dengan release. Tidak ditemukan mismatch pada history tersebut; ini bukan pemeriksaan seluruh schema drift. |
| Migration pending | 43 migration: `0016_broken_nehzno` sampai `0058_abandoned_leader`. Belum dieksekusi/rehearsal pada salinan database staging ini. |
| Preflight data terarah | Legacy roles: `hq=1`, `admin=2`; tidak ada duplicate default address per owner atau duplicate `(order_id, variant_id)`; order dengan legacy voucher=0; local reserved/pending-remote stock seluruhnya nol. |
| Compose target | `config --format json` dengan profile `tools` lulus; store/admin/migrate memakai DSN sama dan auth secret store/admin cocok. Validasi config bukan bukti image bisa dibangun atau migration bisa diterapkan. |
| Persistence | Named volumes uploads dan Caddy data/config tersedia. Jangan memakai `down -v`. |

## Blocker dan dampaknya

### B01 — Cutover schema/RBAC memerlukan maintenance dan rollback berpasangan

Migration `0018` menghapus kolom `user.role` dan tabel `permission`, menggantinya dengan role/grant baru. Menjalankan aplikasi lama setelah migration dapat mematahkan authorization; menjalankan aplikasi baru sebelum schema siap juga berisiko error.

Perlu backup database yang dapat direstore, snapshot konfigurasi dan referensi image lama, serta cutover code/schema yang terkoordinasi. Sistem Owner belum tersedia pada schema lama; bootstrap pertama serta re-login/reset password harus masuk verifikasi. Pengaturan permission lama tidak otomatis diterjemahkan menjadi custom Role.

Sumber: [migration 0018](../../../packages/db/drizzle/0018_silly_mystique.sql), [runbook RBAC](../../../docs/deployment-docs/rbac-rollout.md), [bootstrap Owner](../../../docs/deployment-docs/rbac-owner-bootstrap.md).

### B02 — Config checkout, PPN, dan diskon belum tersedia

Inventory `system_config` hanya berisi `reservation.ttlMinutes`. Key berikut belum ada:

- `tax.ppnRatePercent` dan `jubelio.salesTaxId`.
- `discounts.contractVersion`.
- `checkout.paused`.
- `shipment.parcelFallback` dan `shipment.packagingWeightGrams`.
- Batas import diskon eksplisit `discount.import.*`.

Kontrak diskon absen dibaca sebagai versi 0; checkout UI berversi tidak otomatis aktif. Konfigurasi pajak checkout memiliki reader ketat yang menolak key hilang/invalid. Nilai tax ID wajib diverifikasi terhadap master tenant yang benar, bukan menyalin nilai seed lokal. Batas import yang absen memakai default terdokumentasi menurut `packages/db/src/discount-import-limits.ts`; bukan blocker aktivasi tersendiri. Nilai yang ada tetapi invalid tetap ditolak.

Contoh dampak: customer memilih barang lalu melanjutkan checkout setelah hanya rebuild; preview kontrak baru dapat ditolak `UNSUPPORTED_VERSION`, dan setelah gate dibuka pajak tetap dapat ditolak `CHECKOUT_TAX_UNAVAILABLE` bila dua key pajak belum valid.

Sumber: [config reader](../../../apps/store/src/lib/config.ts#L102), [preview](../../../apps/store/src/app/api/checkout/preview/route.ts), [tax config](../../../apps/store/src/features/checkout/jubelio-tax-config-repository.ts), [cutover diskon](../../../docs/deployment-docs/discounts-cutover.md).

### B03 — Compose staging belum meneruskan akun pembayaran Jubelio

`.env` server belum memiliki `JUBELIO_PAYMENT_ACCOUNT_ID`. Selain itu, **Compose staging target tidak memiliki passthrough key tersebut**, sehingga mengisi `.env` saja tidak menyelesaikan masalah. Hasil resolved Compose mengonfirmasi `store_payment_account_passed=False`.

Reader settlement menggunakan `process.env.JUBELIO_PAYMENT_ACCOUNT_ID`; nilai hilang membuat invoice payment tertahan untuk manual review. Compose production sudah mempunyai wiring yang dapat dijadikan pembanding.

`JUBELIO_PAYMENT_TYPE` juga tidak diteruskan staging; contoh staging berisi `transfer`, sedangkan reader runtime mengharapkan integer nonnegatif dan fallback ke 0. Semantik kode payment type dan payment account harus diverifikasi terhadap tenant target. `JUBELIO_ITEM_TAX_ID` legacy juga tidak diteruskan; jangan menyamakannya dengan otoritas `jubelio.salesTaxId` untuk order provider3 baru.

Sumber: [Compose staging](../../../deployment/staging/docker-compose.yml), [Compose production](../../../deployment/production/docker-compose.yml#L110), [reader payment](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L639), [missing account handling](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L1400), [env staging](../../../deployment/staging/.env.example#L104).

### B04 — Isolasi tenant staging belum dibuktikan

Container existing dan Compose target memakai `APP_ENV=production`, `NODE_ENV=production`, `JUBELIO_STOCK_WRITES_ENABLED=true`, serta host `https://api2.jubelio.com`. Midtrans masih sandbox.

Host Jubelio yang sama dapat melayani tenant berbeda. Audit tidak mencetak/membandingkan credentials atau melakukan login provider, sehingga **tidak menyimpulkan apakah akun server adalah akun test terisolasi atau akun operasional**. Keputusan isolasi `.env` lokal pada plan lama tidak otomatis berlaku pada `.env` server.

Gateway baru akan memilih jalur production-live berdasarkan kombinasi flag tersebut; mock container existing bukan pelindung dari write ke tenant nyata. Akun tenant dan izin write untuk pengujian staging harus dikonfirmasi sebelum activation/canary.

Sumber: [runtime Sales](../../../apps/store/src/lib/jubelio-sales-client.ts#L491), [peringatan deployment Jubelio](../../../docs/deployment-docs/jubelio-sync.md).

### B05 — Prasyarat pengiriman belum tersedia

`.env` server belum memiliki credentials Shipment dan secret webhook khusus; resolved Compose target menghasilkan nilai kosong untuk client ID/secret serta store callback secret.

Migration branch origin/region tidak mengisi readiness operasional secara otomatis. Branch eligible memerlukan Area ID/hierarki wilayah, sender contact/address; SKU perlu berat/dimensi dan packaging aktual. Callback provider perlu didaftarkan dan diverifikasi oleh operator. Aktivasi pickup saja dapat memisahkan blocker delivery, tetapi itu keputusan scope user, bukan asumsi audit.

Sumber: [Shipment readiness](../../../docs/deployment-docs/shipment-readiness.md), [parcel config](../../../apps/store/src/lib/shipment-config.ts), [branch regions](../../../docs/features/branch-shipping-regions.md).

### B06 — Cron baru belum terpasang dan template belum siap dipakai langsung

Crontab user `deploy` hanya mempunyai `sweep-reservations`. Tidak ada `process-order-communications` atau `refresh-jubelio-stock` di crontab tersebut maupun file sistem cron yang dapat diperiksa. Tidak ada timer khusus marketplace/backup PostgreSQL yang terlihat; crontab user lain tidak diperiksa.

Temuan source tambahan:

- Dua wrapper baru tercatat dengan Git mode **100644**, tetapi template cron memanggil path script secara langsung. Perlu executable bit atau pemanggilan melalui `bash` sebelum dipasang.
- Template email menggunakan `/home/ops/logs/marketplace-order-comms/staging`; `/home/ops/logs` tidak ada dan user `deploy` tidak dapat menulis `/home/ops` (mode 750). Parent log perlu disiapkan operator atau disejajarkan dengan `/home/ops/log` yang sudah writable.
- Template stock menggunakan `0 2 * * *` (02:00 UTC pada host), walaupun komentar masih menyebut setiap 5 menit. Runbook menyatakan harian; jangan mengikuti komentarnya.
- Query dengan join yang sama seperti scanner menemukan **39.833 distinct item ID eligible**. Satu invocation dibatasi 20.000 ID; minimal dua bounded runs diperlukan untuk satu full scan, tanpa menghitung retry/missing observation/time budget. Satu run harian default belum membuktikan coverage harian penuh.
- Setelah migration baru, observation timestamp legacy belum populated. Perlu initial stock scan dan monitoring freshness sebelum checkout dibuka sesuai runbook.

Cron email diperlukan agar durable email jobs diproses. Endpoint sweep existing pada binary baru juga memiliki kemampuan settlement/mirror provider; memasang code baru sambil membiarkan cron berjalan bukan tindakan tanpa efek provider.

Sumber: [template email](../../../deployment/staging/order-communications.cron), [template stock](../../../deployment/staging/stock-refresh.cron), [scanner](../../../packages/db/src/jubelio-stock-refresh.ts), [runbook stock](../../../docs/deployment-docs/jubelio-sync.md#L88), [cron komunikasi](../../../docs/deployment-docs/order-communications.md), [sweep target](../../../apps/store/src/app/api/cron/sweep-reservations/route.ts).

### B07 — Transaksi lama tidak boleh dianggap disposable tanpa keputusan

Pada saat query: 1 `pending_payment`, 1 `processing`, 3 `ready_for_pickup`, 2 `completed`, 3 `failed_payment`, 1 `cancelled`. Ledger stock lama berisi 2 `applied`, 1 `failed`, dan 3 `committed`.

Plan penggantian adjustment menjadi Sales Order secara eksplisit mengasumsikan belum ada legacy customer order yang perlu dipertahankan dan tidak menyediakan parallel legacy pipeline. Target staging ternyata mempunyai lima order nonterminal. Audit tidak menetapkan apakah order itu fixture disposable atau transaksi yang harus diselesaikan.

Perlu keputusan mempertahankan data dan penanganan order/provider lama (misalnya drain terlebih dahulu) atau reset pada target yang benar-benar disposable. **Tidak boleh menjalankan seed/reset atau mengarang backfill SO/payment untuk order lama.** Status dan counter nol saja tidak membuktikan seluruh kewajiban provider sudah selesai.

Sumber: [asumsi plan Sales Order](../../jubelio-sales-api-switching/plan/jubelio-sales-api-switching.md#L17), hasil SQL agregat staging.

### B08 — Backup dan restore path belum verified

Tidak ditemukan file backup pada lokasi umum yang diperiksa: file `*.sql`/`*.dump`, nama backup di home ops/deploy dan subfolder backup yang diperiksa, serta `/var/backups`. **Ini bukan bukti tidak ada backup di lokasi lain/offsite.**

`pg_dump` tersedia, tetapi belum dibuat atau diuji restore. Role DB target memiliki `rolcreatedb=false` dan `rolsuper=false`; user SSH `deploy` bukan user sudo menurut dokumentasi operasional. Rehearsal restore ke DB terpisah memerlukan jalur privileged/operator atau target disposable yang dipersiapkan; tidak boleh diasumsikan contoh `createdb` pada runbook langsung dapat dijalankan.

Image lama masih ada, tetapi belum ada release tag/manifest rollback yang dipin. Audit juga menemukan konfigurasi housekeeping Docker pada `/etc/cron.d`; retensi image rollback perlu diverifikasi sebelum perubahan.

Sumber: metadata filesystem/DB role dan image list melalui SSH; [role operational user](../../../docs/deployment-docs/server-hardening.md), [rollback diskon](../../../docs/deployment-docs/discounts-cutover.md#L106).

### B09 — Mock lama akan menjadi orphan

`staging-jubelio-mock-1` masih berjalan, tetapi service/build source mock telah dihapus dari target. Cleanup service orphan perlu dicakup dalam deployment yang disetujui; tidak dijalankan saat audit. Jangan menghapus uploads/sertifikat bersama cleanup ini.

## AC audit → evidence

Tidak ada spec implementasi baru yang disetujui. Berikut kriteria pemeriksaan dari scope percakapan, bukan pengesahan readiness release.

| AC audit | Evidence | Status |
|---|---|---|
| Identifikasi versi server dan target | SSH Git status/revision; local ancestor/count; `ls-remote origin main` sesuai target | Verified |
| Periksa health/resource dan persistence existing | `docker ps/inspect/image ls`, HTTP 200 + TLS=0, RAM/disk, metadata volume | Verified |
| Periksa migration gap dan history | SELECT read-only journal; 16/16 SHA-256 + timestamp cocok; 43 pending; preflight duplicate/role terarah | Verified |
| Periksa kelengkapan runtime/config/cron | Inventory key tanpa secret, resolved Compose target, crontab/system cron, permission direktori, Git executable modes | Verified |
| Jelaskan blocker, batas pemeriksaan dan langkah berikut | B01–B09 serta klasifikasi open items di bawah | Verified |

## Gate upgrade yang masih terbuka

| Gate | Status |
|---|---|
| Backup terbaru + restore rehearsal + manifest rollback | Pending |
| Rehearsal 43 migration pada salinan database staging | Pending |
| Wiring Compose diperbaiki dan env/config target tervalidasi | Pending |
| Isolasi tenant, izin provider write, dan keputusan order lama | Pending |
| Bootstrap Owner/current grants, Shipment origin/parcel/callback | Pending |
| Initial stock scan, daily coverage dan cron email/stock berfungsi | Pending |
| Build image target, cutover, smoke/UAT pada server dan rendered UI | Pending |

Unit/E2E/build/lint/typecheck tidak dijalankan ulang: scope sesi ini audit read-only, bukan perubahan aplikasi atau deployment. Evidence testing lokal yang ada pada artefak fitur tidak dianggap bukti koneksi/payment/courier target staging.

Catatan pemeriksaan: pemanggilan awal `compose config` tanpa profile `tools` tidak memasukkan service `migrate`; script agregasi berhenti pada lookup service tersebut. Pemeriksaan diulang terarah dengan `--profile tools`, exit 0, DSN tiga service cocok. Tidak ada container yang dijalankan pada kedua pemanggilan.

## Open items dan rekomendasi

### Fakta belum diketahui

- Identitas/isolation tenant server dan payment/tax master yang sah; perlu verifikasi melalui jalur akses yang disetujui. Login provider POST belum diizinkan/dijalankan pada audit ini.
- Lokasi/validitas backup offsite, kemampuan operator menyediakan DB restore, serta kompatibilitas seluruh migration terhadap salinan data staging.
- Kesiapan pengiriman operasional, konfigurasi callback di dashboard provider, dan validitas SMTP/Midtrans/Shipment target. Keberadaan secret bukan bukti credential masih valid.
- Provenance commit image running dan retensi rollback saat Docker pruning berlangsung.

### Keputusan user diperlukan

- Apakah data/order staging lama harus dipertahankan dan diselesaikan, atau database dinyatakan disposable dengan izin reset terpisah? Rekomendasi: perlakukan sebagai data yang harus dipertahankan sampai pemilik menyatakan sebaliknya.
- Apakah fase 2 di staging akan diuji dengan tenant Jubelio test terisolasi, atau tetap menggunakan tenant operational yang dipakai server sekarang? Rekomendasi: tenant test terisolasi agar canary tidak mengubah stok/transaksi operasional. Hostname tidak cukup untuk membedakan tenant.
- Apakah pickup dan delivery harus aktif bersama? Bila delivery belum siap, alternatif pickup-only harus disetujui secara eksplisit; jangan diam-diam mengurangi scope fase 2.
- Maintenance window dan izin tindakan perubahan: memperbaiki repo deployment, update server/env/config, backup/restore rehearsal, migration, cron, restart, bootstrap Owner, serta provider canary.

### Di luar scope sesi ini

Seluruh eksekusi perbaikan/deployment/provider canary di atas; production first deployment; refactor fitur; menjalankan ulang broad test suites; commit/push.

### Rekomendasi jalur berikut

**Klarifikasi singkat keputusan data/tenant/scope aktivasi, kemudian alignment untuk plan upgrade staging.** Setelah scope dikonfirmasi, plan lengkap perlu memuat penutupan B01–B09, maintenance dan recovery terkoordinasi, serta bukti smoke/UAT. Jangan memakai quick-start lama yang menyalakan aplikasi sebelum migration sebagai prosedur upgrade 43 migration ini. Audit berhenti di sini dan menunggu arahan; belum membuat plan baru atau mengubah server.
