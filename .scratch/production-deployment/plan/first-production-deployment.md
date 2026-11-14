# Plan deployment production pertama

## 1. Masalah dan tujuan

Production belum go-live. Dibutuhkan alur yang dapat membangun seluruh schema pada database baru, mengisi data sistem tanpa fixture demo, menyediakan satu System Owner, lalu menyimpan seluruh master produk dan stok Jubelio sebelum aplikasi dibuka.

Fondasi tersedia, tetapi belum menjadi prosedur production yang aman. Seeder existing bersifat destruktif, panduan lama memulai aplikasi sebelum migration, dan import belum membuktikan bahwa seluruh katalog telah masuk. Lihat [audit source dan gap](../research/first-deployment-audit.md).

**Hasil yang dituju:** operator memiliki command terpisah yang dapat diuji, runbook berurutan, bukti kelengkapan data, dan kondisi STOP yang jelas. Container berstatus healthy bukan bukti bahwa bootstrap maupun transaksi production siap.

## 2. Approval dan batas otorisasi

- Pemilik memilih Docker Compose + Caddy + PostgreSQL di VPS sesuai fondasi repo.
- Pemilik memilih database production baru, seed sistem dahulu, dan satu System Owner.
- Kesepahaman scope dan seam pengujian dikonfirmasi dalam sesi ini melalui **“Sesuai, tulis draft”**.
- **Approval complete plan dan acceptance criteria: belum diberikan.**
- Implementasi, subagent, commit, push, SSH, perubahan database pengguna, request provider, dan deployment belum diizinkan oleh dokumen ini. Status keseluruhan hanya dicatat di [index fitur](../index.md).
- Verifikasi pada database disposable membuktikan implementasi bootstrap, bukan kesiapan target production. Gate target tetap memiliki evidence tersendiri.

## 3. Scope dan non-scope

### Termasuk

1. Audit dan rehearsal seluruh migration pada PostgreSQL 16 disposable, menggunakan runner migration yang sesungguhnya.
2. Preflight target database, config, secret presence, dan wiring deployment.
3. Seed referensi production terpisah, atomic, non-destruktif, dan aman diulang.
4. Reuse CLI Owner pertama, termasuk menyambungkan jalur password file yang belum tersambung pada caller.
5. Mode full import yang memanfaatkan pipeline Jubelio existing, menolak pembatas testing, dan menghasilkan laporan kelengkapan.
6. Verifikasi bootstrap, one-shot tooling Compose, recovery, dan runbook production pertama serta deployment berikutnya. Dokumentasi langkah implementasi production wajib difinalisasi setelah script dibuat dan diverifikasi, menggunakan command final yang benar-benar tersedia; lihat §9.3.
7. Pengujian melalui CLI pada database disposable dan provider fixture; smoke admin/katalog pada gate integrasi.

### Tidak termasuk

- Menyalin database development/staging; membuat customer, order, diskon, stok, atau akun demo.
- Menulis konten homepage/footer/static pages production. Owner menyiapkannya lewat admin sebelum launch.
- Import history customer/order/invoice/payment Jubelio; pengunduhan file gambar ke uploads. Gambar katalog tetap berupa URL CDN sesuai pipeline existing.
- Redesign UI, perubahan alur checkout, upgrade library, squash/edit/delete migration historis, atau refactor seluruh modul Jubelio.
- Aktivasi otomatis checkout, Midtrans live, shipment, webhook, maupun cron.
- Menghentikan staging, mengganti topology reverse proxy, atau mengubah port tanpa keputusan terpisah bila ada konflik host.
- Eksekusi target production pada sesi planning.

## 4. Solusi dan user stories

Pisahkan tanggung jawab berikut; jangan menyatukannya ke startup aplikasi atau satu command yang otomatis membuka transaksi live:

```text
Persiapan host/database dan akses terbatas
  → preflight sebelum migration
  → migrate seluruh schema
  → preflight sesudah migration
  → seed referensi production
  → bootstrap satu System Owner
  → full import Jubelio
  → verifikasi bootstrap
  → start aplikasi untuk smoke terbatas + siapkan konten
  → sign-off integrasi/operasional
  → aktivasi checkout dan pembukaan publik secara eksplisit
```

1. Sebagai operator, saya ingin menolak salah target sebelum ada write agar database development/staging tidak tersentuh.
2. Sebagai operator, saya ingin migration membangun schema lengkap dari database kosong tanpa `db:push`.
3. Sebagai operator, saya ingin seed hanya data sistem yang dibutuhkan tanpa menghapus data lain.
4. Sebagai Owner, saya ingin akun awal menggunakan secret saya sendiri dan wajib mengganti password ketika pertama masuk.
5. Sebagai operator, saya ingin rerun tidak mereset password, config, grants, jam cabang, maupun stok yang ditahan checkout.
6. Sebagai operator, saya ingin seluruh product group, SKU, dan stok yang dikembalikan provider tersimpan, bukan hanya halaman pertama atau cap testing.
7. Sebagai operator, saya ingin kegagalan/hasil parsial terbaca sebagai kegagalan, dengan cara rerun yang jelas.
8. Sebagai operator, saya ingin membedakan bootstrap database yang lulus dari storefront dan transaksi live yang belum disetujui.

**Contoh:** import berhenti setelah 200 dari 201 product group. Database boleh berisi 200 hasil upsert, tetapi tidak ada laporan sukses final. Operator mengulang full import dari halaman 1; 200 group lama diperbarui tanpa duplikasi, group ke-201 masuk, lalu seluruh ID dan stock coverage direkonsiliasi sebelum bootstrap dinyatakan lulus.

## 5. Kontrak command

> Command bertanda **baru/perubahan** berikut adalah rancangan, **belum tersedia**. Nama dan flags menjadi kontrak implementasi setelah plan disetujui. Root aliases meneruskan argumen ke workspace DB.

| Command | Kondisi | Kontrak |
|---|---|---|
| `npm run db:migrate` | Existing | Menerapkan migration versioned; tidak seed, tidak generate/push, tidak membuka aplikasi. Jalur target menggunakan container migrate. |
| `npm run db:preflight:production -- --config <file> --phase before-migrate` | Baru | Read-only: validasi config, identitas database dan kelayakan fresh bootstrap. Belum mengharuskan tabel aplikasi tersedia. |
| `npm run db:preflight:production -- --config <file> --phase after-migrate` | Baru | Read-only: pastikan migration history dan schema yang diperlukan sesuai release. |
| `npm run db:seed:production -- --config <file>` | Baru | Menulis referensi pertama dalam satu transaksi dan lock; tidak membuat user atau memanggil provider. |
| `npm run db:bootstrap-owner -- --name <name> --email <email> --username <username> --expected-database <name> --password-file <path>` | Perubahan terfokus | Reuse Owner CLI; guard target production dan wiring file secret. Env secret existing tetap didukung; secret lewat argv tidak dipakai di runbook production. |
| `npm run db:import-jubelio -- --full --expected-database <name> --report-file <file>` | Perubahan terfokus | Full pull tanpa cap/filter/skip halaman, upsert existing, dan laporan durable yang hanya ditandai complete setelah rekonsiliasi lulus. |
| `npm run db:verify:production -- --config <file> --import-report <file>` | Baru | Read-only: memeriksa schema, referensi, Owner, hasil import dan invariant DB. Output bukan izin go-live. |

- Database dan role PostgreSQL dibuat terlebih dahulu oleh operator berwenang. `migrate` membuat schema/tabel, **bukan database atau login PostgreSQL**.
- Tidak ada flag `--force` untuk mengabaikan salah target, fixture demo, migration failure, atau data tidak lengkap.
- Tidak ada `seed:production` pada `CMD` store/admin, migration default, restart, ataupun webhook.
- Owner CLI tetap mempertahankan exit `0` created, `1` OWNER_EXISTS, `2` invalid input, `3` unexpected failure. Jangan memakai `|| true`. Rerun prepare/seed tidak memanggil ulang Owner CLI; operator memverifikasi Owner yang sudah ada.
- Command baru: `0` operasi yang diminta lulus; `2` input/target/prasyarat ditolak; `3` dependency/eksekusi gagal; `4` hasil verifikasi/import tidak lengkap. Existing import tetap nonzero saat gagal; laporan membedakan sebabnya tanpa mengubah kontrak consumer non-full secara tidak perlu.

## 6. Config dan pengaman target

### 6.1 Manifest non-secret

Sediakan `deployment/production/bootstrap.config.example.json` dan file actual gitignored `deployment/production/bootstrap.config.json`. Manifest berisi `version`, `expectedDatabase`, serta config sistem production; **tidak** berisi password, DSN, token, atau credentials provider.

Config production dibaca secara eksplisit dari path command/container. Jangan diam-diam memuat root `.env` development pada entry point production. Rahasia tetap melalui environment/secret mount; bootstrap memeriksa keberadaannya tanpa mencetak nilainya. Prasyarat diperiksa per fase: migration/seed tidak memerlukan credentials payment/shipment, import memerlukan credentials master-read, sedangkan kesiapan transaksi live dilaporkan terpisah.

Target guard membandingkan `current_database()` dengan `expectedDatabase`, memeriksa role DB bukan superuser dan memiliki privilege operasi yang diperlukan, serta environment production yang eksplisit. Guard dijalankan kembali pada command mutasi production, bukan hanya preflight sekali. Tidak menampilkan connection string. Ini melengkapi, bukan menggantikan, pemisahan database/credentials production dari staging.

Preflight `before-migrate` mendukung dua kondisi: database aplikasi kosong, atau rerun dengan migration journal yang valid. Jika tabel sudah ada tanpa history yang dapat dipertanggungjawabkan, STOP; jangan menebak bahwa semua migration sudah diterapkan atau menulis journal palsu.

### 6.2 Inventory seed

| Data/key | Kebijakan fresh bootstrap | Rerun |
|---|---|---|
| `system_owner`, `hq`, `admin` | Validasi identitas Initial Roles hasil migration, lalu lengkapi grant fresh-install dari `rbac/seed-defaults.ts` pada inisialisasi pertama saja. System Owner tetap code-owned bypass tanpa grant row. | Tidak mengembalikan grant yang dicabut dan tidak mengubah role/grant operational. |
| Branch HQ | Identitas stabil dari `seed-hq.ts`, tanpa `jubelio_location_id`, stok, atau origin shipment palsu. | Pertahankan perubahan operator; jangan membuat HQ kedua. |
| `production.bootstrapReferenceVersion` | Marker internal `1`, disimpan bersama seluruh seed dalam transaksi yang sama. | Versi yang dikenal menjadi no-op yang dilaporkan; versi unknown ditolak. Bukan feature gate. |
| `checkout.paused` | `true` sebelum aplikasi start. | Jangan mengubah nilai existing, termasuk jangan mem-pause ulang production yang sudah live. |
| `reservation.ttlMinutes` | Nilai eksplisit manifest; contoh template `15`, validasi terhadap kontrak checkout existing. | Pertahankan nilai existing. |
| `tax.ppnRatePercent` | Wajib eksplisit dari kebijakan pajak bisnis; jangan menganggap fallback 11 sebagai persetujuan production. | Pertahankan; perubahan menjadi operasi terpisah. |
| `jubelio.salesTaxId` | Opsional saat preparation; wajib benar sebelum checkout aktif. ID ditentukan lewat verifikasi tax master tenant dan harus cocok dengan rate bisnis. Tidak ada default `-2`. | Pertahankan; tidak auto-update dari tenant lain. |
| `discounts.contractVersion` | Wajib eksplisit `0` atau `1` pada manifest. `0` bukan kesiapan checkout kontrak terkini; nilai `1` hanya dipilih setelah checklist cutover terkait disetujui. Bootstrap tidak mengaktifkannya diam-diam. | Pertahankan. Gate launch memeriksa kontrak yang memang akan dipakai. |
| `discount.import.maxRows` | Default operasional awal `1000`, tervalidasi menurut reader existing. | Pertahankan. |
| `discount.import.maxFileBytes` | Default awal `5242880`. | Pertahankan. |
| `discount.import.maxExpandedBytes` | Default awal `26214400`, tidak lebih kecil dari batas file terkompresi. | Pertahankan. |
| `shipment.parcelFallback`, `shipment.packagingWeightGrams` | Hanya jika sudah diberikan dan divalidasi sebagai parameter operasional production. Ketiadaan dilaporkan sebagai blocker delivery, bukan diisi ukuran/berat contoh. | Pertahankan. |
| `jubelio.stockRefreshCursor` | State runtime worker, bukan seed referensi yang perlu direset. | Jangan disentuh. |

Manifest tidak menjadi mekanisme untuk menimpa config operational. Bila nilai manifest berbeda dengan nilai existing pada rerun, laporkan perbedaan non-secret tanpa update; operator memakai prosedur perubahan config terpisah. Missing required row sesudah marker dianggap drift dan menggagalkan verifikasi, bukan alasan memperbaiki permission/config diam-diam.

### 6.3 Atomicity dan marker

- Seed mengambil transaction advisory lock dengan namespace bootstrap referensi, membaca marker, dan menulis roles/grants awal, HQ, config, serta marker dalam **satu transaksi**.
- Marker absent hanya boleh menjadi fresh initialization ketika belum ada Admin User, client, catalog import, order, atau transaksi operational. Initial Roles dan config hasil migration diperbolehkan setelah divalidasi. Bila data operational sudah ada, STOP untuk audit/adopsi manual; jangan menyimpulkan marker hilang berarti database baru.
- Existing config yang sudah berasal dari migration tetap dipertahankan. Untuk database baru, preflight membandingkan nilainya dengan manifest; perbedaan yang memengaruhi kontrak harus diselesaikan eksplisit sebelum seed diterima.
- Marker present yang valid tidak memicu rekonsiliasi grant. Seed ulang tidak menjadi mekanisme repair role.
- Error di tengah seed rollback seluruh perubahan dan marker. Dua invocation bersamaan hanya menghasilkan satu inisialisasi.

## 7. Migration dan initial Owner

### 7.1 Migration

- Image release, SQL, metadata journal, dan aplikasi harus berasal dari revisi yang sama; simpan identitas release bersama evidence.
- Gunakan `drizzle-kit migrate`, bukan `db:push` atau dump schema development.
- Rehearsal memakai seluruh chain dari `0000` sampai migration terbaru pada release, lalu menjalankan migrate sekali lagi untuk membuktikan no-op. Tidak hardcode `0058` sebagai migration terakhir selamanya.
- Cek hasil schema: tabel, column/type/default/nullability, FK, unique/check/index penting, enum, dan schema migration journal; jangan menganggap jumlah tabel saja cukup. Periksa tidak ada perubahan schema yang belum memiliki migration.
- Bila chain gagal pada SQL historis, STOP dan simpan error. Jangan mengedit/menghapus audit SQL, memakai `db:push`, atau melewati statement. Migration koreksi di akhir tidak menyelesaikan kegagalan yang mencegah runner mencapai migration tersebut. Strategi baseline/rekonsiliasi memerlukan proposal dan approval terpisah bila benar-benar dibutuhkan.
- Backup sebelum write ke target yang sudah berisi data, dan uji restore pada database lain. Fresh database juga dicatat identitas serta kondisi kosongnya. Tidak ada janji rollback otomatis untuk seluruh DDL/data migration.

### 7.2 Owner

- Reuse transaksi, advisory lock, hashing, Role Assignment global, dan `mustResetPassword=true` existing; tidak menggabungkan auth store dengan admin.
- Sambungkan pembacaan UTF-8 file pada caller `bootstrap-owner.ts`. Root cause terverifikasi: helper memerlukan `readFile`, tetapi caller tidak mengirimkannya; lihat probe pada audit. Public CLI test harus mengunci wiring nyata, bukan hanya helper dengan fake dependency.
- Secret file hanya di-mount read-only pada invocation Owner; tidak di-build ke image atau dipasang ke store/admin. File tidak boleh ikut log, report, shell history, atau artifact yang dilacak git.
- Setelah Owner dibuat, lepaskan mount/secret bootstrap dan lakukan login/reset melalui admin. Akun HQ/Admin berikutnya dibuat oleh Owner dengan Home Branch yang benar.
- Owner existing tidak dibuat ulang, tidak diganti identitasnya dan tidak direset passwordnya oleh tooling bootstrap.

## 8. Full import dan kelengkapan

### 8.1 Cakupan dan guard

Mode `--full` harus menolak `--item-name`, cap `JUBELIO_SYNC_MAX_PRODUCTS` yang terisi, serta `JUBELIO_SYNC_START_PAGE` selain halaman 1. Nilai malformed ditolak sebelum request/data write. Tidak diam-diam menghapus pembatas lalu menyebut import berhasil.

Alur tetap: locations → category tree → seluruh masters pages → catalog dan master detail per SKU → upsert product/variant/brand/category yang dipakai → stock per lokasi. Tidak mengimpor semua kategori yang tidak dipakai. Harga, gambar sebagai URL, barcode/dimensi parcel yang tersedia tetap mengikuti mapping existing.

- Produk baru tetap mengikuti status insert existing (`aktif`); status produk existing tidak ditimpa. Situs belum dibuka hanya karena row produk aktif.
- Cabang provider mengikuti status `is_active` sesuai existing. Jalur bootstrap production tidak memberikan jam 07:00–22:00 contoh: row baru memakai jam belum dikonfigurasi (`{}`), row existing mempertahankan jam operator. Jam dan origin yang belum lengkap menjadi checklist cabang sebelum launch.
- Pertahankan reservation/local-hold counters, local shipment origin, status produk yang diubah admin, dan Markdown website. Master provider-owned dapat diperbarui sesuai kontrak sync existing; ini bukan snapshot database yang tidak boleh berubah sama sekali.
- Tidak ada deletion otomatis untuk produk/variant yang hilang dari sumber. Laporkan selisih dan STOP readiness untuk rekonsiliasi, bukan menghapus data.

### 8.2 Batas API dan eksekusi

- Tetap page/batch-bounded; jangan menampung seluruh catalog detail dalam memory atau membuka satu transaksi DB selama HTTP import.
- Retry 401, 429, 5xx existing dipertahankan; tambahkan timeout/abort dan validasi concurrency/retry yang bounded untuk jalur import. Mulai concurrency konservatif `2` dan budget `JUBELIO_SYNC_REQUESTS_PER_MINUTE=120` pada service bootstrap; semua request termasuk login/retry dihitung. Budget harus disesuaikan dengan limit tenant dan trafik lain, bukan mengandalkan 429 sebagai satu-satunya throttle. Jalur shared existing tanpa env budget tersebut tidak diubah diam-diam. Nilai ini tuning, bukan SLA. Retry hanya untuk request login/read pada pipeline ini, bukan write order/payment.
- Jangan menjalankan dua full import bersamaan. Gunakan session advisory lock untuk importer pada koneksi khusus yang tetap hidup sampai run berakhir, bukan lock transaksi yang menahan transaksi selama ribuan HTTP request.
- Rerun yang didukung adalah full scan dari halaman 1. Tidak menambah checkpoint/resume framework pada tahap ini; manual skip halaman bukan bukti full import.
- Pipeline menggunakan `POST /login` dan `POST /inventory/items/all-stocks/` untuk pembacaan stok. Eksekusi live memerlukan izin eksplisit atas dua jenis POST tersebut, termasuk relogin/retry bounded. Izin itu tidak mencakup SO, invoice, payment, adjustment, booking shipment, atau perubahan master Jubelio.

### 8.3 Laporan durable dan pemeriksaan

`--report-file` wajib pada full bootstrap. Laporan memuat versi format, run ID, database name non-secret, release, waktu mulai/akhir, scope, halaman yang dilalui, himpunan unique group/SKU IDs atau referensi manifest per-page, total source, totals upsert, stock coverage, serta error/mismatch yang tersanitasi. Jangan menyimpan body provider atau PII. Gunakan file progress/partial dan finalisasi atomik; penanda complete hanya setelah pemeriksaan lulus. CLI yang terputus tidak meninggalkan laporan sukses.

Syarat lengkap:

1. Scan dimulai halaman 1 tanpa filter/cap dan mencapai akhir pagination secara valid.
2. Himpunan unique product group dan SKU yang dibaca cocok dengan row database bermapping Jubelio. Hitungan yang sama tanpa kecocokan ID tidak cukup.
3. Total group dari provider direkonsiliasi; lakukan enumerasi masters ringan sekali lagi pada akhir untuk mendeteksi perubahan/skipped ID, bukan hanya menghitung respons terakhir.
4. Bila provider tidak menyediakan consistent snapshot, hasil dibatasi pada dua enumerasi yang cocok selama window import; tidak menjanjikan snapshot atomik tenant. Perubahan sumber menyebabkan laporan incomplete dan rerun pada window lebih tenang.
5. Semua stock observation yang dikembalikan tersimpan pada pasangan SKU/lokasi yang benar. Unknown mapping, data inconsistent, atau missing observation tidak dianggap nol. Coverage untuk pasangan SKU/cabang yang akan dijual diperiksa sebelum checkout, dengan timestamp provider yang sah.
6. Tidak ada duplicate natural key, orphan FK, counter hold negatif, maupun error yang diam-diam dilewati. Empty catalog tanpa persetujuan khusus adalah incomplete, bukan sukses.
7. Image URL/description/dimensi yang tidak tersedia dilaporkan sebagai kualitas data; jangan mengarang gambar atau ukuran. Ketiadaan dimensi dapat memblokir delivery tetapi tidak harus membatalkan penyimpanan katalog/pickup.

Contoh fixture independen untuk test: **201 product group, 202 SKU, dua lokasi, 404 pasangan stok eksplisit**, kategori terpakai dan satu kategori tidak terpakai. Pastikan group ke-201 ditemukan di database/API, bukan hanya di manifest importer. Expected values berasal dari kontrak fixture tersebut, bukan perhitungan ulang implementation.

## 9. Deployment wiring dan runbook target

### 9.1 Tooling Compose

- Pertahankan `migrate` pada profile `tools`, default migrate-only dengan env database minimal.
- Tambahkan service `bootstrap` pada profile `tools`, menggunakan image tools yang sama. Default command preflight read-only; mutation selalu invocation eksplisit. Jangan memasang `depends_on` yang menyalakan store/admin/Caddy ketika tooling dijalankan.
- Mount manifest read-only dan direktori report persisten. File report disimpan operator di luar checkout git, misalnya `/home/ops/log/marketplace-bootstrap/production/`. Secret Owner hanya mount ad hoc untuk command Owner.
- Tool image menyalin dan membangun `@marketplace/logging` bila dipakai facade CLI; `npm ci` tetap berdasarkan lockfile. Jangan bergantung pada `tsx` atau root script yang belum tentu ada pada image Next standalone.
- Service bootstrap hanya menerima DB dan credentials master-read Jubelio yang diperlukan, bukan Midtrans/Shipment write credentials yang tidak dipakai tugas ini. Wire env import concurrency, timeout/retry dan `JUBELIO_SYNC_REQUESTS_PER_MINUTE` secara eksplisit pada service tersebut serta template production; jangan menganggap `.env` otomatis masuk container.
- Audit env runtime store, termasuk `JUBELIO_PAYMENT_ACCOUNT_ID`, `JUBELIO_PAYMENT_TYPE`, dan unit item yang saat ini belum seluruhnya diteruskan. `JUBELIO_PAYMENT_TYPE` harus mengikuti kontrak numeric runtime, bukan string `transfer` dari template lama. Nilai/account aktual tetap input tenant yang diverifikasi, bukan dipilih agent.
- `JUBELIO_STOCK_WRITES_ENABLED=false` tetap default sampai aktivasi terpisah. Tidak menambahkan test-account/mock bypass pada Compose production.

### 9.2 Urutan operator

| Tahap | Tindakan | Bukti / kondisi STOP |
|---|---|---|
| 0. Persiapan | Tetapkan release, database baru dan DB role terpisah, secret production, manifest, storage report, DNS/firewall, volume/backup. Periksa kapasitas disk dan pemilik port 80/443. | Tidak ada target identitas jelas atau port konflik → STOP. Jangan menghentikan staging otomatis. |
| 1. Build | Build image tools/store/admin dari release yang sama, **tanpa `up` publik**. | Image/dependency/source tidak sesuai release → STOP. |
| 2. Preflight awal | Jalankan bootstrap `preflight --phase before-migrate`. | Salah database, privilege tidak sesuai, schema tanpa history, manifest tidak valid → STOP sebelum write. |
| 3. Migration | Jalankan service migrate satu kali; simpan log dan history. | SQL/journal gagal → STOP; tidak seed/reset/push sebagai recovery. |
| 4. Referensi | Preflight after-migrate, kemudian `seed` production. | Seed harus atomic; marker dan referensi diverifikasi. |
| 5. Owner | Jalankan Owner CLI dengan secret file; catat user ID non-secret, bukan password. | Invalid input/Owner existing ditangani sesuai exit code; jangan menelan error. |
| 6. Import | Setelah izin provider-read POST, jalankan full import dengan report path persisten. | Laporan parsial/mismatch/timeout → situs tetap belum dibuka; rerun setelah penyebab ditangani. |
| 7. Verify | Jalankan verifier terhadap DB dan report run yang sama. | Exit 0 hanya berarti bootstrap verified. Missing tax/shipment/feature activation tetap terlihat sebagai launch blockers. |
| 8. Smoke terbatas | Start store/admin sesudah DB siap; akses operator dibatasi melalui kontrol jaringan yang disepakati. Login/reset Owner, buka list/detail katalog, siapkan akun operasional dan konten storefront. | Jangan expose port app langsung atau menganggap secret URL sebagai kontrol akses. Caddy belum dibuka untuk trafik umum sampai gate terkait lulus. |
| 9. Integrasi | Verifikasi SMTP/OAuth, tax/account mapping, live stock, webhook, cron, Midtrans dan shipment sesuai flow yang akan diaktifkan; uji write live hanya dengan izin terpisah. | Uji mock bukan bukti live. Jangan menjalankan order dummy live tanpa scope write yang diizinkan. |
| 10. Go-live | Owner sign-off, ubah feature/config dan enable write yang memang disetujui, restart store untuk config cache, lalu buka akses publik. | Jangan mengubah `checkout.paused` tanpa restart. Pantau error/provider settlement/stock freshness setelah release. |

Runbook implementasi harus berisi command Compose konkret untuk setiap tahap, dari `deployment/production/` dengan project `production` dan `.env` yang eksplisit, termasuk build tooling dan bind mounts. Tidak memakai full `up -d --build` sebelum bootstrap. Tidak menaruh credentials di contoh command atau menampilkan hasil `docker compose config` yang sudah berisi secret.

**Konflik Caddy:** konfigurasi staging dan production sama-sama mengikat 80/443. Project name terpisah tidak menyelesaikannya. Jika host yang dipilih juga melayani staging, preflight operator harus menghentikan prosedur dan meminta keputusan penataan proxy/host. Plan ini tidak diam-diam memilih menghentikan staging atau mengubah infrastruktur.

### 9.3 Deliverable dokumentasi langkah implementasi production

Sesuai permintaan pemilik, setelah scripting dibuat dan diverifikasi, finalisasikan panduan **bahasa Indonesia** di `docs/deployment-docs/first-production-deployment.md`. Ini bagian wajib deliverable implementasi, bukan follow-up opsional. Draft panduan boleh berkembang bersama script, tetapi versi yang diserahkan harus mengikuti perilaku, nama command, flags, mount, dan exit code final yang sudah diuji—bukan menyalin command usulan plan seolah sudah tersedia.

Panduan harus dapat diikuti operator dari database production baru sampai gate go-live, dengan urutan:

1. **Persiapan server dan release:** prerequisites PostgreSQL/Docker Compose, identitas release, DNS/TLS/firewall, kapasitas disk, volume persisten, dan pemeriksaan konflik Caddy/port staging.
2. **Persiapan database dan backup:** pembuatan database serta DB role production terpisah, privilege/koneksi container, penetapan expected database, dan prosedur backup/restore sesuai kondisi target.
3. **Pengisian konfigurasi:** file `.env` dan manifest yang digunakan, input wajib/opsional per fase, secret Owner read-only, credentials provider, serta lokasi report; tidak menuliskan secret nyata.
4. **Build dan bootstrap schema:** build image tanpa membuka aplikasi, preflight sebelum migration, migration, lalu preflight sesudah migration.
5. **Seed sistem dan initial user:** seed production non-destruktif, verifikasi referensi, bootstrap satu Owner, serta penanganan `OWNER_EXISTS` tanpa mengganti password atau mengabaikan error.
6. **Full import Jubelio:** izin POST login/read-stock yang diperlukan, parameter full import tanpa cap/filter/skip halaman, penyimpanan report, pemantauan progress dan cara mengulang import parsial dengan upsert.
7. **Verifikasi hasil:** pemeriksaan schema, referensi, Owner, kelengkapan group/SKU/stok, dan pembacaan output verifier. Bedakan `BOOTSTRAP_VERIFIED` dari kesiapan transaksi live.
8. **Start dan smoke terbatas:** aplikasi baru dijalankan sesudah database siap; login/reset Owner, pelepasan secret bootstrap, pemeriksaan katalog, pembuatan akun operasional dan penyiapan konten storefront.
9. **Prasyarat transaksi:** pemeriksaan pajak/settlement, SMTP/OAuth, payment, webhook, cron, stok dan shipment untuk flow yang akan diaktifkan. Tandai action yang membutuhkan izin write provider terpisah.
10. **Go-live dan pemantauan:** checklist sign-off, perubahan gate/config yang disetujui, restart store untuk config cache, pembukaan akses publik, monitoring awal dan penanggung jawab recovery.

**Setiap langkah wajib memuat:** tujuan dan prasyarat; lokasi kerja/path file; command final yang dapat disalin setelah placeholder input dijelaskan; dampak terhadap data/provider; hasil/exit code yang diharapkan; pemeriksaan keberhasilan; serta kondisi STOP dan langkah recovery/rerun yang aman. Input yang hanya diketahui saat eksekusi ditandai jelas dan tidak diisi dengan nilai demo. Bedakan prosedur deployment pertama, rerun setelah kegagalan, dan deployment berikutnya; gunakan kontrak recovery §10.

**Gate penerimaan dokumentasi:** jalankan walkthrough panduan pada environment disposable dengan release/script yang sama dan simpan evidence. Langkah yang menyentuh host production atau provider live tidak dieksekusi tanpa izin; tandai sebagai **belum diverifikasi di target** dan catat prasyarat/approval-nya. Bila command berubah setelah pengujian, perbarui panduan dan verifikasi ulang langkah yang terdampak. Tautkan panduan dari `docs/deployment-docs/README.md` dan selaraskan referensi deployment existing. Implementasi tidak diterima hanya karena scripting lulus bila dokumentasi operasional ini belum tersedia dan sesuai hasil verifikasi.

## 10. Recovery dan deployment berikutnya

| Kejadian | Recovery aman |
|---|---|
| Preflight menolak target | Perbaiki konfigurasi/identitas target; tidak ada write yang perlu di-rollback. |
| Migration gagal | Simpan error dan backup/history; diagnosis pada database disposable dengan release sama. Tidak menjalankan seed untuk memperbaiki schema/journal. |
| Seed gagal | Transaksi rollback; setelah akar masalah diperbaiki, ulangi seed. Marker tidak boleh tertinggal sebagian. |
| Owner dibuat, tahap berikutnya gagal | Pertahankan Owner. Jangan ulang create untuk mereset secret; lanjutkan setelah verifikasi identitas Owner. |
| Import berhenti/hasil berubah | Pertahankan data parsial, perbaiki koneksi/data, ulang full dari halaman 1. Tidak reset schema/seed demo. |
| Smoke/launch gate gagal | Pertahankan akses terbatas dan checkout paused/write disabled; jangan menghapus katalog atau membuka transaksi sebagai workaround. |
| Masalah setelah live | Tahan checkout baru, tinjau attempt/order in-flight dan kompatibilitas reader/provider snapshot. Restore DB atau downgrade binary harus direview; tidak otomatis menghapus transaksi/side effect provider. |

Pada deploy berikutnya: backup sesuai kebijakan → preflight release/target → migration jika ada → deploy compatible binary → smoke/verifikasi. **Tidak** melakukan bootstrap Owner atau reset/seed demo setiap deploy. Seed referensi versi sama dapat diuji no-op, tetapi bukan syarat restart harian. Perubahan referensi versi berikutnya membutuhkan migration data/operasi yang direview dengan kontrak tersendiri.

## 11. Blueprint teknis

Path relatif terhadap root repo tetapi ditulis lengkap, bukan basename. Schema tetap hanya di `packages/db/src/schema/`; **tidak ada perubahan schema baru yang diasumsikan** untuk bootstrap ini. Marker memakai `system_config` existing.

| Full path | Aksi | Tanggung jawab / layer | Seam test |
|---|---|---|---|
| `packages/db/src/production-bootstrap.ts` | Baru | CLI adapter: parse subcommand, explicit config/env, execution context, exit/report; tanpa query inline. | CLI process tests di bawah. |
| `packages/db/src/production-bootstrap/bootstrap-input.ts` | Baru | Domain input: typed manifest, target/phase validation, klasifikasi config wajib/opsional. | `packages/db/src/production-bootstrap/bootstrap-input.test.ts` |
| `packages/db/src/production-bootstrap/preflight-production-service.ts` | Baru | Service satu operasi preflight, membedakan before/after migrate; read-only. | CLI dan disposable DB rehearsal. |
| `packages/db/src/production-bootstrap/seed-production-reference-service.ts` | Baru | Service seed satu operasi, keputusan fresh-vs-rerun, atomicity/marker; tanpa SQL inline. | CLI seed/rerun/concurrency. |
| `packages/db/src/production-bootstrap/verify-production-service.ts` | Baru | Service verifikasi schema/referensi/Owner/import report dan klasifikasi launch blockers. | CLI verifier positif/negatif. |
| `packages/db/src/production-bootstrap/production-bootstrap-repository.ts` | Baru | Persistence DB identity/introspection, transaksi/lock seed, write referensi dan read projections; tanpa HTTP. | CLI integration, bukan test internal repository. |
| `packages/db/src/logger.ts` | Baru | Facade logging CLI package, memakai core `@marketplace/logging`; scope dibuat di entry. | CLI output redaction dalam tests. |
| `packages/db/src/bootstrap-owner.ts` | Modify | Sambungkan file reader, production target guard, logging CLI yang aman; preserve semantik Owner. | `packages/db/src/rbac/bootstrap-owner-cli.db.test.ts` |
| `packages/db/src/rbac/bootstrap-owner-input.ts` | Modify | Tambahkan expected database pada parsed input tanpa mengubah prioritas secret. | `packages/db/src/rbac/bootstrap-owner-input.test.ts` |
| `packages/db/src/import-jubelio.ts` | Modify | CLI tipis memanggil import service, full/target guard dan final report. | CLI import tests. |
| `packages/db/src/import-jubelio-service.ts` | Baru | Service satu operasi import; mengoordinasi pipeline existing, pagination, report, session lock dan completeness. | `packages/db/src/production-bootstrap/full-import-cli.db.test.ts` |
| `packages/db/src/jubelio-import-options.ts` | Modify | Parse flags full/report/target dan tolak kombinasi ambigu. | `packages/db/src/jubelio-import-options.test.ts` |
| `packages/db/src/jubelio-import-report.ts` | Baru | Kontrak report/progress, atomic finalization dan rekonsiliasi ID; bukan logger callback. | `packages/db/src/jubelio-import-report.test.ts` dan CLI. |
| `packages/db/src/jubelio-sync.ts` | Modify terbatas | Existing client/persistence worker: timeout/retry input bounded dan request budget saat env bootstrap dipasang; jalur full tidak memasok jam contoh. Mapping/provider invariants existing dipertahankan. | Existing fetch/upsert tests dan full CLI. |
| `packages/db/src/testing/jubelio-bootstrap-fixture.ts` | Baru | Test-only loopback server dengan pagination/catalog/SKU/location/stock dan skenario failure. Tidak masuk runtime deployment. | Dipakai CLI integration. |
| `packages/db/src/production-bootstrap/production-bootstrap-cli.db.test.ts` | Baru | Public CLI: target guard, migration readiness, atomic seed, rerun, concurrency, verifier. | PostgreSQL disposable. |
| `packages/db/src/migrations/fresh-production-rehearsal.test.ts` | Baru | Runner migration nyata, replay seluruh journal dan second-run no-op/schema equivalence. | PostgreSQL disposable. |
| `packages/db/src/rbac/bootstrap-owner-cli.db.test.ts` | Baru | CLI nyata dengan secret file/env, duplicate Owner dan tidak ada secret pada output. | PostgreSQL disposable. |
| `packages/db/src/production-bootstrap/full-import-cli.db.test.ts` | Baru | Full CLI dengan fixture 201 group; partial/rerun/guard/coverage/report. | PostgreSQL disposable + HTTP loopback. |
| `packages/db/src/production-bootstrap/bootstrap-input.test.ts`, `packages/db/src/jubelio-import-report.test.ts` | Baru | Focused public policy tests; expected literals dari kontrak plan/fixture. | Vitest focused. |
| `packages/db/src/rbac/bootstrap-owner-input.test.ts`, `packages/db/src/jubelio-import-options.test.ts`, `packages/db/src/jubelio-sync-fetch.test.ts`, `packages/db/src/jubelio-sync.test.ts`, `packages/db/src/jubelio-sync.db.test.ts` | Modify bila kontraknya terdampak | Regression prioritas secret/full flags/timeout/upsert invariants; tidak memperluas refactor. | Explicit focused paths; DB cases di final gate. |
| `package.json`, `packages/db/package.json`, `package-lock.json` | Modify | Root/workspace aliases dan dependency logging CLI; pertahankan perubahan existing pengguna. | Command contract, lock/install image. |
| `deployment/common/migrate/Dockerfile` | Modify | Satu tools image dengan DB source, migration, logging build; default migrate-only tetap aman. | Image/container rehearsal. |
| `deployment/production/docker-compose.yml`, `deployment/production/.env.example` | Modify | One-shot bootstrap, manifest/report mounts, env minimal per service dan runtime wiring yang hilang. | Compose wiring audit + container rehearsal. |
| `deployment/production/bootstrap.config.example.json` | Baru | Template manifest non-secret dengan default aman dan required input yang jelas. | Parser/manifest tests. |
| `deployment/.gitignore` | Modify | Ignore manifest actual dan file secret lokal bila operator memakai path di deployment; template tetap tracked. | Audit git-ignore/secret. |
| `e2e/admin/production-bootstrap-mock.spec.ts`, `e2e/store/production-catalog-mock.spec.ts` | Baru | Smoke public auth/admin/catalog pada database disposable yang di-bootstrap tanpa demo. Tidak checkout/provider write. | Playwright final gate. |
| `playwright.mock.config.ts` | Modify | Tambahkan kedua spec ke **kedua** testMatch existing; bootstrap smoke wajib DB disposable, tanpa perubahan isolasi live. | List/run explicit specs. |
| `docs/deployment-docs/first-production-deployment.md` | Baru | Runbook production-first lengkap dan troubleshooting/recovery aman. | Walkthrough container disposable dan operator review. |
| `docs/deployment-docs/deploy.md`, `docs/deployment-docs/rbac-owner-bootstrap.md`, `docs/deployment-docs/jubelio-sync.md`, `docs/deployment-docs/environments.md`, `docs/deployment-docs/verification.md`, `docs/deployment-docs/README.md` | Modify | Selaraskan urutan, Owner, full import, port conflict, seed production vs demo, dan gate verifikasi. | Review silang source/command. |
| `packages/db/README.md`, `docs/testing/README.md`, `docs/README.md`, `README.md` | Modify terfokus | Dokumentasi scripts, seam/test prerequisites dan navigasi runbook. Tidak menerjemahkan konten unrelated. | Link/command review. |
| `.scratch/production-deployment/index.md`, `.scratch/production-deployment/ticket/verification.md` | Modify / Baru saat implementasi | Approval/status plan dan AC→evidence; bukan publikasi ticket breakdown. | Main-agent review. |

### Kontrak exports/entry points

Semua signature berikut tanpa body; dependency DB/client adalah dependency kerja, bukan parameter logging. Tipe input/result diekspor dari modul pemilik operasi. Tests/config/docs tidak memiliki kontrak export bisnis.

- `bootstrap-input.ts`: `parseProductionBootstrapInput(argv: readonly string[], env: BootstrapEnvironment): ProductionBootstrapInput`; `validateProductionBootstrapConfig(value: unknown): ProductionBootstrapConfig`.
- `preflight-production-service.ts`: `preflightProduction(input: PreflightInput, dependencies: PreflightDependencies): Promise<PreflightReport>`.
- `seed-production-reference-service.ts`: `seedProductionReferenceData(input: SeedProductionInput, dependencies: SeedProductionDependencies): Promise<SeedProductionResult>`.
- `verify-production-service.ts`: `verifyProductionBootstrap(input: VerifyProductionInput, dependencies: VerifyProductionDependencies): Promise<VerificationReport>`.
- `production-bootstrap-repository.ts`: `readTargetIdentity(db: BootstrapDb): Promise<TargetIdentity>`; `inspectMigrationState(db: BootstrapDb, release: MigrationManifest): Promise<MigrationState>`; `initializeProductionReferences(db: BootstrapDb, config: ProductionBootstrapConfig): Promise<ReferenceSeedResult>`; `readProductionVerificationState(db: BootstrapDb): Promise<ProductionVerificationState>`. Transaksi/lock berada di operasi persistence; aturan allow/refuse dikembalikan bertipe.
- `logger.ts`: facade `createModuleLogger(module: string)` dan `withExecutionContext(work)` dengan kontrak core existing, tanpa instance logger diteruskan ke service.
- `bootstrap-owner-input.ts`: existing `parseArgs(argv)` menambahkan `expectedDatabase?: string`; existing `resolvePassword(input)` mempertahankan kontrak/prioritas file→env→argv.
- `import-jubelio-service.ts`: `importJubelio(input: JubelioImportInput, dependencies: JubelioImportDependencies): Promise<JubelioImportReport>`; existing shared worker menjadi adapter provider/DB, tidak ada caller HTTP yang dipindahkan massal.
- `jubelio-import-options.ts`: existing `parseJubelioImportArgs(argv)` mengembalikan option `itemName?`, `full`, `expectedDatabase?`, `reportFile?`; `validateFullJubelioImportOptions(options, env): FullImportOptions` menolak cap/filter/page ambigu.
- `jubelio-import-report.ts`: `reconcileJubelioImport(input: ImportReconciliationInput): ImportReconciliationResult`; `finalizeJubelioImportReport(path: string, report: JubelioImportReport): Promise<void>`. Report writer menulis artifact bisnis, bukan pengganti logger.
- `jubelio-sync.ts`: existing `fetch*`/`upsert*` signatures dipertahankan sejauh mungkin. Penghilangan jam contoh dilakukan pada full import caller dengan tidak memberikan override jam; **tidak perlu** menambah opsi replace/preserve baru pada shared upsert.
- `jubelio-bootstrap-fixture.ts`: `startJubelioBootstrapFixture(scenario: BootstrapFixtureScenario): Promise<BootstrapFixtureServer>`; teardown wajib, bind loopback, tanpa credentials nyata.
- CLI production baru: subcommands `preflight`, `seed`, `verify` sesuai §5. Existing Owner/import entry points tetap entry CLI, bukan module yang menjalankan side effect ketika diimpor test.

### Keputusan struktur

- Domain folder `production-bootstrap/` menampung operasi bootstrap; tidak membuat service/repository global. Entry point root mengikuti pola script package DB existing.
- Seed production **tidak** menambah mode production ke `seed.ts`: struktur demo/destructive tidak menjadi landasan write production.
- Reuse pipeline Jubelio dan role catalog existing; tidak membuat importer/catalog grants duplikat. Marker diperlukan karena migration sudah membuat role historis, sementara default HQ fresh-install terkini berbeda dan grant operational tidak boleh direpair tiap rerun.
- Tidak menambah tabel bootstrap/job/checkpoint pada tahap ini; `system_config` menyimpan marker dan report durable menjadi evidence import. Hindari framework orchestration yang tidak dibutuhkan.
- Logger dibuat sekali per module; entry CLI memiliki satu execution scope dan satu pemilik unexpected-error log. Jangan meneruskan `logger`, `requestId`, atau progress callback untuk logging pada alur baru. Sanitisasi error sebelum output.

## 12. Blueprint UX dan feedback operasional

**N/A untuk perubahan visual:** tidak mengubah halaman, komponen, layout, copy storefront, ataupun flow auth. Reference visual/tokens tetap existing. Smoke memakai halaman login/reset password admin serta list/detail produk store/admin yang sudah ada; bukan mendesain UI baru.

Kontrak CLI operator:

| Kondisi | Output yang harus jelas | Konsekuensi |
|---|---|---|
| Target salah | `PRODUCTION_TARGET_MISMATCH` | STOP sebelum write; jangan tampilkan DSN. |
| Seed pertama berhasil | `REFERENCE_SEED_APPLIED` | Laporkan jumlah referensi/versi, tanpa user/secret demo. |
| Seed diulang | `REFERENCE_SEED_ALREADY_APPLIED` | No-op; jangan mengganti permission/config. |
| Owner sudah ada | `OWNER_EXISTS` | Tidak reset password; operator verifikasi lalu lanjut tahap lain. |
| Import berjalan | Nomor halaman dan jumlah group/SKU/stock; report partial | Belum sukses final. |
| Import tidak lengkap | `FULL_IMPORT_INCOMPLETE` dengan sebab tersanitasi | Jangan lanjut ke launch. |
| Bootstrap terverifikasi | `BOOTSTRAP_VERIFIED` + daftar launch blockers terpisah | Boleh melanjutkan smoke terbatas, bukan approval checkout/live. |

Viewport, component reuse map, list sorting/filter/URL contract, dan state UI baru: N/A karena tidak diubah. Browser smoke tetap memeriksa data baru dapat dipakai melalui public interface existing; bila menemukan kebutuhan perubahan UX, berhenti untuk alignment terpisah.

## 13. Pengujian dan verifikasi

Seams disepakati: **CLI sebagai public interface utama**, PostgreSQL disposable untuk persistence/transactions, provider fixture untuk full import, unit policy untuk guard/report, dan smoke auth/katalog pada integrasi. Tidak menguji private method atau menjadikan importer report sebagai satu-satunya bukti bahwa database sudah terisi.

### Development / L0–L1

- Ikuti TDD per slice: failing public-policy/CLI test dahulu, implementasi minimum, lalu review. Tidak menulis seluruh test suite secara horizontal sebelum implementasi.
- Fokus unit non-infrastructure dengan explicit paths, misalnya:
  `npm run verify:unit:slice -- packages/db/src/production-bootstrap/bootstrap-input.test.ts packages/db/src/jubelio-import-options.test.ts packages/db/src/jubelio-import-report.test.ts packages/db/src/rbac/bootstrap-owner-input.test.ts`.
  Pilih hanya file relevan slice saat itu, bukan selalu seluruh daftar.
- Typecheck package DB dan affected apps sesuai perubahan; app L0 memakai `npm run verify:types:store` / `npm run verify:types:admin`. Tidak memakai clean diff atau typecheck sebagai bukti migration benar.
- Tests integrasi/E2E ditulis bersama slice tetapi eksekusinya di final gate. Early database rehearsal/broad suite hanya bila pengguna meminta secara eksplisit.

### Final integration / L2

1. Siapkan PostgreSQL disposable yang dedicated; tidak memakai `.env`/database development pengguna sebagai disposable. Harness harus menolak target non-test sebelum create/drop data; database test tidak dibuat dalam production cluster secara diam-diam.
2. Jalankan full migration rehearsal dan CLI tests DB dengan explicit paths setelah scope terintegrasi. Uji database kosong, malformed/unknown marker, salah target, interruption, concurrent seed/import, file secret, dan rerun yang mempertahankan sentinel config/grants/password/hours/holds.
3. Jalankan full unit suite `npm run test:unit` dengan environment disposable yang memenuhi test guard existing. Bila prerequisite tidak tersedia atau failure pre-existing muncul, catat row AC terkait Pending; jangan mengubah DB user demi membuat suite hijau.
4. Build tools image dan lakukan container rehearsal dari migrasi kosong sampai verifier; periksa manifest/report mount, tidak ada app auto-start, secret tidak masuk output/image, dan env runtime yang hilang sudah terpasang. Butuh runtime Docker lokal yang diizinkan/tersedia; jika tidak, evidence container Pending.
5. Jalankan `npm run verify:batch:e2e -- e2e/admin/production-bootstrap-mock.spec.ts e2e/store/production-catalog-mock.spec.ts` pada DB disposable; auth lewat seam HTTP existing bila konfigurasi URL lokal menghalangi UI login. Assert Owner diarahkan ke reset password, sesi admin bukan client store, serta produk halaman kedua/detail variant terlihat melalui app existing. Jangan merombak env/auth routing demi test tanpa scope baru.
6. Browser/manual smoke terbatas mencatat hasil login/reset dan katalog pada environment bootstrap; ini memeriksa jalur data, bukan mengklaim visual redesign. Legacy `npm run test:e2e` tetap membutuhkan izin terpisah bila diperlukan; tanpa izin, bukti tersebut Pending.
7. Output validation dibatasi, log disimpan di temp/di luar repo. Artifact Playwright hanya di `playwright/`; diagnosis failure dari Markdown, bukan membuka screenshot.

Context7 checkpoint research: `/drizzle-team/drizzle-orm-docs` — `generate` menghasilkan audit SQL/metadata; `migrate` memakai history untuk migration pending. Sumber resmi: [migrations](https://orm.drizzle.team/docs/migrations) dan [drizzle-kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate). Sebelum implementasi, konfirmasi kembali API version-specific Drizzle/pg/Node logging yang benar-benar disentuh; jangan menyalin format migration v1 ke repo 0.x. Catat checkpoint tambahan pada evidence slice.

## 14. Acceptance criteria implementasi

Semua row berikut **Pending** pada sesi planning. Kolom evidence adalah bukti yang harus dihasilkan, bukan test yang sudah dijalankan.

| AC | Perilaku yang diterima | Evidence yang wajib tersedia | Status |
|---|---|---|---|
| AC01 | Command production menolak salah database sebelum write dan tidak memuat env development diam-diam. | Public CLI negative test + tidak ada data target yang berubah. | Pending |
| AC02 | Seluruh migration release membuat schema sesuai schema owner pada database kosong; invocation kedua no-op. | Fresh PostgreSQL rehearsal memakai runner nyata + schema/history comparison. | Pending |
| AC03 | Seed pertama hanya Initial Roles/grants, HQ dan config sistem; tidak ada customer/order/product/akun demo. | CLI seed + projection output/invariant verifier pada DB kosong. | Pending |
| AC04 | Seed atomic dan serialized; kegagalan tidak menyisakan marker/data parsial, concurrent invocation tidak menduplikasi. | DB CLI failure/concurrency test. | Pending |
| AC05 | Rerun tidak mereset config, grant yang dicabut, password Owner, HQ/jam cabang, maupun local holds. | Sentinel sebelum/sesudah rerun seed/import + public auth/verification behavior. | Pending |
| AC06 | Satu Owner dapat dibuat dengan file secret nyata yang di-mount; wajib reset, duplicate Owner ditolak tanpa reset credential. | Owner public CLI DB test + admin smoke auth/reset. | Pending |
| AC07 | Full import menolak cap/filter/start-page skip/malformed input sebelum side effect. | Public CLI/option-policy tests dengan fixture counter request dan DB tetap. | Pending |
| AC08 | Seluruh halaman, group/SKU IDs dan mapping stock fixture tersimpan benar; unused category tidak diimpor. | Fixture literal 201 group/202 SKU/404 stock, DB verifier dan public katalog item halaman kedua. | Pending |
| AC09 | Timeout/429/5xx/interruption/empty source/missing stock/source drift tidak menghasilkan false complete; rerun tidak duplikasi. | HTTP fixture scenarios + CLI exit/report + DB verification. | Pending |
| AC10 | Import mempertahankan field aplikasi dan tidak memberi jam operasional/ukuran palsu; report membedakan coverage dan kualitas data. | Full-import regression dengan sentinel operational dan missing optional fields. | Pending |
| AC11 | Tooling tidak auto-start aplikasi/seed pada startup; manifest/report/secret wiring bekerja di container dan runtime env settlement tersedia. | Container rehearsal + redacted env-presence audit + source/config assertions. | Pending |
| AC12 | Verifier menolak schema/config/Owner/import drift, dan tidak menyebut bootstrap pass sebagai izin live. | Positive/negative public CLI tests + blocker report. | Pending |
| AC13 | Sesudah scripting dibuat dan diverifikasi, tersedia panduan bahasa Indonesia di `docs/deployment-docs/first-production-deployment.md` sesuai §9.3: urutan production-first, command final, hasil/verifikasi tiap tahap, recovery non-destruktif, batas POST provider, konflik Caddy dan gate go-live; navigasi docs konsisten. | Walkthrough command final di disposable environment pada release yang sama + review docs/source; langkah target/live yang belum diuji ditandai eksplisit tanpa klaim sukses. | Pending |
| AC14 | Logging sukses/gagal terstruktur dan aman; tidak ada credentials/PII/raw provider response dalam report/output. | CLI output tests dengan secret sentinel + logging policy regression. | Pending |
| AC15 | Gate integrasi deliverable lulus; kondisi yang tidak dapat dijalankan dilaporkan Pending tanpa klaim production ready. | Focused evidence, full unit, container dan dua smoke specs; limitation eksplisit untuk gate yang terblokir. | Pending |

## 15. Gate target production — terpisah dari kelulusan implementasi

Tidak dijalankan pada sesi planning. Semua membutuhkan execution scope/operator yang sah; test write provider membutuhkan izin action tersendiri.

- [ ] Identitas DB/user production, release, akses PostgreSQL dari container, backup + restore test, disk dan volume persisten diverifikasi.
- [ ] Port 80/443 dan topology Caddy target tidak konflik; DNS/TLS serta pembatasan akses bootstrap diverifikasi.
- [ ] Migration, seed referensi, satu Owner dan full import berhasil pada target; report run final direkonsiliasi terhadap database dan sumber tenant.
- [ ] Owner login dan ganti password; secret bootstrap dilepas; akun operasional/Home Branch dibuat lewat admin.
- [ ] Homepage, footer/kontak, static/legal pages dan aset production disiapkan serta direview; tidak mengandalkan fallback/demo.
- [ ] Rate/ID pajak, akun settlement dan numeric payment type, contract gate, jam cabang, serta data SKU/lokasi diverifikasi untuk flow yang diaktifkan.
- [ ] SMTP/OAuth dan Midtrans production config/webhook diverifikasi; transaksi live hanya sesuai izin dan safeguards terpisah.
- [ ] Stock freshness, webhook Jubelio, daily stock reconciliation, sweep reservation dan order communication cron dipasang/dipantau sesuai runbook existing. Tidak menjalankan cron write tanpa meninjau efeknya.
- [ ] Untuk delivery: origin tiap cabang, contact/address hierarchy, parcel/packaging, Shipment credentials/webhook dan booking flow diverifikasi terpisah.
- [ ] Owner memberi sign-off go-live; checkout/config write diaktifkan eksplisit, store direstart untuk config cache, akses publik dibuka dan monitoring/rollback owner ditetapkan.

Checklist yang belum tercentang harus dibawa verbatim ke laporan batasan; tidak boleh ditutup hanya dengan test mock atau jumlah test pass.

## 16. Urutan implementasi yang diusulkan

Ini urutan kerja dalam satu plan, **bukan publikasi breakdown ticket multi-sesi**. Jika nanti dibutuhkan tickets, minta approval breakdown terpisah.

| Slice | Jalur operator yang dihasilkan | Verifikasi / dependensi |
|---|---|---|
| 1 | Operator dapat menjalankan preflight dan mengetahui target/migration belum siap; tersedia test replay schema fresh. | Unit input guard terlebih dahulu; rehearsal DB di final gate. |
| 2 | Database yang sudah migrate dapat di-seed sistem dan dipakai membuat Owner via secret file, tanpa demo. | CLI seed/Owner coverage; rerun/concurrency/atomicity; tidak menunggu importer untuk menjadi command yang berguna. |
| 3 | Operator melakukan full import dan mendapatkan hasil lengkap atau failure yang dapat dipulihkan. | Fixture pagination/partial/rerun/report; preserve field aplikasi. |
| 4 | Operator menggunakan image tools dari database kosong sampai verifier dan smoke admin/katalog; panduan langkah production §9.3 difinalisasi setelah script diverifikasi, sementara public launch tetap manual. | Integrasi Compose/env/docs, walkthrough panduan dengan command final dan final gate AC01–AC15 setelah seluruh scope terintegrasi. |

Main agent menangani integration/review/validation; tidak ada delegasi yang tersirat. Perubahan di luar file/kontrak blueprint atau keputusan produk baru harus kembali ke pemilik, bukan diam-diam menambah scope.

## 17. Discovery, risiko, dan keputusan tersisa

### Fakta operasional yang diisi saat eksekusi

- `discovery:` apakah target host juga melayani staging pada 80/443? Operator memeriksa host pada execution scope yang diizinkan. Konflik berarti STOP; keputusan topology baru tidak diasumsikan.
- `discovery:` apakah seluruh historical migration replay pada PostgreSQL 16 bersih dan final schema identik dengan schema owner? Jawab melalui test rehearsal, bukan database development yang sudah memakai `db:push`.
- `discovery:` berapa source group/SKU/lokasi aktual, waktu import dan stabilitas enumerasi tenant? Jawab lewat import yang diizinkan; tidak memberikan estimasi durasi/SLA tanpa measurement.
- `discovery:` nilai fiscal tax rate, tax master ID, settlement account/type, shipment/packaging dan contract activation yang disetujui operator? Isi manifest/config/checklist sebelum gate terkait, bukan hardcode demo.

### Keputusan pemilik

Tidak ada keputusan scope lain yang diperlukan untuk mereview draft ini. Nilai deployment spesifik tetap input operasional wajib, bukan pilihan otomatis agent. Jika rehearsal mengungkap migration historis rusak atau host memerlukan redesign proxy, usulkan penyelesaian terpisah sebelum bagian yang terpengaruh diimplementasikan/dijalankan.

### Risiko utama

- Migration chain belum terbukti; adanya file SQL tidak menjamin fresh install berhasil.
- Upsert importer bukan rollback global dan tidak memberikan snapshot atomik provider. Source drift dan partial writes harus terlihat dalam report.
- Seed marker mencegah re-grant operational, tetapi marker hilang/corrupt tidak boleh di-repair otomatis pada database yang sudah dipakai.
- `checkout.paused` memakai config cache existing. Pause/aktivasi harus disertai restart; selama preparation, tidak membuka akses umum dan tetap menahan provider writes.
- Rollback binary yang tidak kompatibel dengan snapshot order baru berisiko. Jangan menganggap restore database membatalkan side effect Jubelio/Midtrans.

## 18. Deviation log

Sesi implementasi 2026-11-13 (repository lokal, tanpa eksekusi target):

- `packages/db/src/logger.ts` memakai facade CLI lokal (CommonJS) dengan envelope
  JSON, execution scope, dan sanitasi error — bukan `@marketplace/logging` yang
  ESM-only dan tidak dapat di-`require` oleh `packages/db` (CJS). Kontrak
  eksternal (`createModuleLogger`, `withExecutionContext`) sama; tools image
  tidak perlu membangun package logging. Menunggu keputusan bila package DB
  nanti dipindah ke ESM.
- `JubelioImportReport` mendapat field `reasons` (additive) agar alasan
  rekonsiliasi tersimpan durable bersama report, bukan hanya output log.
- `stockPairsRequested/Covered` didefinisikan sebagai pasangan unik (SKU provider
  yang dibaca × lokasi provider bernama); observasi dihitung per baris
  `flattenStock` yang lolos mapping variant/lokasi.
- Test DB membuat role non-superuser baru sebagai owner scratch database, agar
  guard privilege preflight diuji tanpa bypass.
- `rbac/ensure-roles.ts` tipe `Executor` dipersempit struktural (`Pick<…,"select"
  | "insert">`) supaya transaksi schema-typed dapat memprovisikan Initial Roles.
- Coverage Owner CLI tidak memakai file terpisah `rbac/bootstrap-owner-cli.db.test.ts`;
  test Owner (file secret, duplicate, hash tidak berubah) digabung ke
  `production-bootstrap/production-bootstrap-cli.db.test.ts` agar satu scratch
  database/harness dipakai bersama test preflight/seed/verify.
- Verifier menambah check `STOCK_COVERAGE` (pasangan unik SKU×cabang provider +
  timestamp observasi) dan cross-check coverage report ↔ database; kualitas data
  provider (gambar/deskripsi/dimensi parcel) masuk `report.dataQuality`, tidak
  diisi placeholder. Credential master-read Jubelio diperiksa di awal command
  import (`MISSING_PROVIDER_CREDENTIALS`, exit 2).

Tidak ada perubahan perilaku/AC di luar catatan di atas.

## 19. Penutupan

- [ ] Complete plan dan AC disetujui pemilik sebelum implementasi.
- [ ] AC01–AC15 memiliki evidence aktual dan semuanya Verified sebelum klaim implementasi lengkap.
- [ ] Gate target production yang belum dikerjakan tetap Pending dan dibawa verbatim sebagai batasan; tidak diklaim production ready.
- [ ] Panduan `docs/deployment-docs/first-production-deployment.md` difinalisasi setelah scripting diverifikasi, memenuhi §9.3, dan walkthrough command final memiliki evidence sesuai AC13.
- [ ] Dokumentasi enduring dan navigasi deployment/testing diperbarui bersama implementasi.
- [ ] Plan/research/evidence tetap disimpan; status hanya di `../index.md` dan diperbarui sesuai scope approval serta evidence.
