# Audit deployment production pertama

## Batas audit

- Tanggal: 2026-11-13; baseline HEAD `deb580f`, ditambah working tree existing.
- Pemeriksaan lokal terhadap source, konfigurasi, migration, dan dokumentasi. Working tree sudah memiliki perubahan pengguna, termasuk Dockerfile, package scripts, dan docs deployment; perubahan tersebut tidak diubah dalam audit ini.
- Tidak ada SSH, Docker operation, koneksi database, test suite, build, import, atau request Jubelio yang dijalankan. Ada satu probe lokal terhadap helper input password, tanpa membaca file secret atau mengakses DB; hasilnya dijelaskan di bawah. Kondisi server/tenant production belum diverifikasi.

## Temuan terverifikasi

| Area | Fakta dari source | Implikasi |
|---|---|---|
| Infrastruktur | `deployment/production/docker-compose.yml` mendefinisikan store/admin, Caddy, uploads volume, dan one-shot `migrate` pada profile `tools`; PostgreSQL berada di host VPS. | Fondasi deployment tersedia; bootstrap tidak perlu infrastruktur baru. |
| Migration | `packages/db/package.json` menyediakan `db:migrate`; container `deployment/common/migrate/Dockerfile` menjalankan `drizzle-kit migrate` sebagai default. Folder `packages/db/drizzle/` memuat SQL dan journal hingga `0058_abandoned_leader.sql`. | Gunakan migration yang diaudit, bukan `db:push`. Replay seluruh chain dari database kosong belum dibuktikan pada audit ini. |
| Seed existing | `packages/db/src/seed.ts:21` memanggil production guard; baris 230–254 menghapus data lama. `seed-mode.ts` hanya membedakan fixture katalog, bukan menjadikan seed aman. Akun demo/customer tetap dibuat pada mode `jubelio`. | Jangan menjalankan `db:seed`, `db:reset`, atau mengakali `NODE_ENV` untuk bootstrap production. Butuh entry point seed referensi terpisah dan non-destruktif. |
| Initial Roles | Migration `0018_silly_mystique.sql:182` membuat tiga Initial Roles dengan grant historis. `rbac/seed-defaults.ts` berisi grant fresh-install terkini. `rbac/ensure-roles.ts` dapat menambahkan grant yang hilang pada role existing. | Perlu membedakan penyelesaian fresh bootstrap dari perbaikan permission operational. Rerun seed tidak boleh mengembalikan grant yang sengaja dicabut operator. Jangan mengedit migration historis untuk memperbarui default. |
| Initial user | `packages/db/src/bootstrap-owner.ts` sudah memiliki Owner pertama, transaksi dan advisory lock, `mustResetPassword=true`, serta input env `RBAC_BOOTSTRAP_PASSWORD`. Flag `--password-file` dikenali, tetapi entry point tidak meneruskan dependency `readFile` yang diwajibkan `rbac/bootstrap-owner-input.ts`. Owner existing menghasilkan exit 1, bukan success. | Reuse CLI ini dengan regression pada public CLI untuk wiring password file; Owner creation bukan bagian seed tiap deploy. Rerun tidak boleh mereset password. |
| HQ | `packages/db/src/seed-hq.ts` mendefinisikan branch HQ aplikasi, tanpa Jubelio location ID; belum ada bootstrap production khusus untuk row tersebut. | Seed HQ terpisah dari cabang provider, menggunakan identitas stabil dan tanpa stok. |
| System config | `seed.ts:2358` dan `seed-system-config.ts` mencampur TTL, pajak, config diskon, shipment, dan default tenant/demo. `discounts.contractVersion=1` dan `jubelio.salesTaxId=-2` dinyatakan khusus seed lokal/demo. | Buat inventory config production; jangan menyalin ID pajak atau mengaktifkan feature gate secara otomatis. Config existing dipertahankan; nilai tenant diverifikasi terpisah. |
| Pause checkout | `apps/store/src/features/checkout/place-checkout-service.ts:75` membaca `checkout.paused` melalui config cache (`apps/store/src/lib/config.ts`). Missing key memakai fallback `false`. | Bootstrap perlu menulis pause sebelum app start; perubahan melalui SQL membutuhkan restart store. Pause bukan pengganti penutupan akses publik saat bootstrap. |
| Import | `packages/db/src/import-jubelio.ts` memuat lokasi, kategori yang digunakan, brand, product group, SKU, harga, gambar sebagai URL, dimensi parcel per SKU, dan stok per lokasi. Upsert memakai Jubelio IDs. Bukan import customer, order, invoice history, atau file gambar. | Reuse pipeline existing, bukan importer baru. Kebutuhan “semua produk” berarti tanpa cap/filter dan mulai halaman pertama. |
| Import sebagian | CLI membaca `JUBELIO_SYNC_MAX_PRODUCTS`, `JUBELIO_SYNC_START_PAGE`, dan `--item-name`; success umum masih mungkin saat hasil kosong. Log total belum membuktikan kesetaraan himpunan ID sumber dan database. | Full bootstrap membutuhkan guard dan laporan kelengkapan; exit 0 saja belum cukup untuk launch. |
| Rerun import | `jubelio-sync.ts:793` mempertahankan status produk saat conflict. Counter reservasi lokal tidak ditulis ulang oleh sync. CLI memberi jam operasional 07:00–22:00 setiap hari; `upsertJubelioBranches` menerapkannya juga saat update. | Jangan menyebut rerun aman untuk seluruh field. Jam operasional bukan fakta provider; perlu dicegah menimpa edit operator dalam jalur production. |
| Akses provider | `jubelio-sync.ts:77` memakai `POST /login`; `fetchStocks` memakai `POST /inventory/items/all-stocks/` untuk pembacaan. Retry 401/429/5xx sudah ada; seluruh run tidak dibungkus transaksi database. | Eksekusi import live nanti memerlukan izin eksplisit untuk POST login dan POST pembacaan stok; bukan izin write order/stok provider. Kegagalan parsial ditangani dengan rerun upsert, bukan reset database. |
| Wiring production | Production `.env.example` memuat `JUBELIO_PAYMENT_ACCOUNT_ID`, tetapi `deployment/production/docker-compose.yml` belum meneruskannya ke store; `apps/store/src/lib/jubelio-sales-lifecycle.ts` menggunakannya untuk settlement. Service migrate hanya mendapat `DATABASE_URL` dan `NODE_ENV`. | Audit env harus mencakup mapping container, bukan hanya isi `.env`; credentials import dan secret Owner harus masuk secara eksplisit pada one-shot yang relevan. |
| Port reverse proxy | Caddy staging dan production sama-sama publish port host 80/443 pada Compose masing-masing. Nama project berbeda tidak mengisolasi host port. | Jika target host yang sama sedang menjalankan Caddy staging, production tidak dapat langsung start Caddy kedua. Preflight harus STOP; perubahan topology/port dan penghentian staging memerlukan keputusan terpisah. |
| Konten storefront | Homepage API mengembalikan array kosong bila tidak ada section (`apps/store/src/app/api/homepage/route.ts:307`); footer memakai fallback (`components/FooterWrapper.tsx`); static pages hanya dibaca jika published. | Seed sistem tidak berarti storefront siap launch. Konfigurasi konten production perlu checklist operator. |
| Runbook lama | `docs/deployment-docs/deploy.md` start aplikasi sebelum migrate, mengandalkan seed disposable, dan memiliki petunjuk recovery/reset yang tidak tepat untuk production. `rbac-owner-bootstrap.md` masih menyebut role harus sudah di-seed walau CLI sudah dapat memprovisinya. | Update runbook menjadi production-first, selaraskan staging/disposable, dan hapus recovery yang menyamakan seed dengan perbaikan migration history. |

## Sumber eksternal

Context7 checkpoint: `/drizzle-team/drizzle-orm-docs` — mengonfirmasi alur `generate` menghasilkan SQL/metadata dan `migrate` membaca migration history untuk menerapkan migration yang belum diterapkan. Sumber resmi: [PostgreSQL migrations](https://orm.drizzle.team/docs/migrations), [drizzle-kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate). Lookup dilakukan pada fase research; belum ada API baru diimplementasikan. Struktur migration repo tetap mengikuti versi installed, bukan contoh format v1 pada docs terbaru.

## Probe lokal password file

- Hipotesis dari trace: entry point memanggil `resolvePassword` dengan `passwordFile`, tetapi tanpa `readFile`; helper menolak sebelum mencoba membaca file.
- Reproduksi lokal memakai `node --import tsx -e` untuk memanggil `resolvePassword({passwordFile:'/run/secrets/dummy-planning-probe'})`, persis shape dependency yang hilang di caller. Output: `LOCAL_PROBE: password file cannot be read in this environment`.
- Tidak ada file secret yang dibaca, koneksi DB, atau perubahan code. Test existing mengirim fake `readFile`, sehingga belum menguji wiring caller nyata.
- Kesimpulan terbatas: jalur password-file pada entry point belum tersambung. Perbaikan dan RED→GREEN test CLI masuk usulan plan, belum dikerjakan.

## Keputusan pemilik dari klarifikasi sesi ini

1. Target mengikuti konfigurasi repo: Docker Compose + Caddy + PostgreSQL di VPS.
2. Production dimulai dengan database baru; tidak menyalin database development/staging.
3. Seed hanya sistem: roles/grants awal, HQ lokal, system config tervalidasi. Konten storefront disiapkan operator melalui admin sebelum launch.
4. Bootstrap satu System Owner; akun operasional dibuat sesudah login lewat admin.

## Open items dan tindak lanjut

### Fakta belum diketahui

- Kelulusan replay migration `0000` sampai migration terakhir pada PostgreSQL disposable dan kesesuaian schema akhirnya.
- Identitas database/tenant production aktual, tax ID/rate, akun settlement, origin shipment, kebutuhan packaging, volume katalog, rate limit, serta kesiapan secret/DNS/backup. Ini input preflight operasional, bukan alasan memakai nilai demo.
- Tidak ada kebutuhan akses production untuk menyusun plan; akses live hanya saat operator mengizinkan eksekusi terpisah.

### Keputusan pemilik diperlukan

- Rangkuman scope dan seam verifikasi dikonfirmasi pemilik melalui jawaban “Sesuai, tulis draft”. Draft lengkap boleh ditulis; ini bukan approval implementasi.
- Approval draft lengkap sebelum implementasi; izin live execution/go-live tetap terpisah.

### Di luar scope

- Remote operation/deployment saat sesi planning, penyalinan customer/order demo, redesign UI/infrastruktur, import historical transactions, penyimpanan lokal file gambar, aktivasi checkout/payment/shipment otomatis, dan perbaikan fitur lain.

## Rekomendasi langkah berikut

Alignment menuju draft plan/spec setelah pemilik mengonfirmasi kesepahaman. Plan memisahkan provisioning database, migration, seed referensi, Owner bootstrap, full import, verifikasi, dan gate launch. Public seam utama: CLI bootstrap terhadap PostgreSQL disposable; unit policy untuk guard/idempotency, serta rehearsal container/runbook dan smoke login/katalog saat gate integrasi. Hasil planning tidak boleh disebut bukti kesiapan production.
