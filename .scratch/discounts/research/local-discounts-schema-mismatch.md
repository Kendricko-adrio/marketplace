# Pemulihan error 500 Diskon pada database lokal

## Penyebab terverifikasi

Halaman `http://localhost:3001/admin/discounts` menampilkan `Internal server error`.
Log `logs/admin.log` mencatat kegagalan list. Database lokal `storefront` belum
memiliki `discount_offer_revision.draft_configuration`, sementara schema source
`packages/db/src/schema/discounts.ts:64` sudah mendefinisikannya.

Query revision di `apps/admin/src/lib/discounts-administration.ts:1926` membaca
seluruh kolom schema. Reproduksi langsung sebelum pemulihan:

```sql
SELECT draft_configuration FROM discount_offer_revision LIMIT 0;
-- 42703: column "draft_configuration" does not exist
```

Verifikasi sebelumnya hanya menerapkan schema pada DB disposable; belum pada DB
lokal yang dipakai pengguna. Tidak ada perubahan kode yang diperlukan untuk
mengatasi mismatch ini.

## Persetujuan dan eksekusi

Pengguna awalnya mengizinkan sinkronisasi additive. Preview full `db:push`
read-only menemukan drift constraint di luar diskon (`order_item`). Preview
scoped juga memunculkan prompt unique constraint revision yang sudah ada.
Keduanya dihentikan tanpa write; tidak memakai `--force` atau truncate.

Pengguna kemudian secara eksplisit meminta **`db:reset`, push ulang, seed, dan
import Jubelio**. Sebelum reset dijelaskan bahwa promo/order lokal terhapus dan
import tidak memulihkan transaksi atau promo lama. Pengguna juga mengizinkan
`POST /login` dan `POST /inventory/items/all-stocks/` dalam scope import ini,
serta memilih batas **100 produk** sesuai konfigurasi development.

Urutan yang berhasil, seluruhnya dari root repo:

1. Preflight target memastikan host lokal, DB `storefront`, bukan production;
   login/GET lokasi Jubelio berhasil, 25 lokasi.
2. `npm run db:reset`: 56 tabel public sebelum reset, 0 setelah reset.
3. `npm run db:push`: schema fresh berhasil diterapkan.
4. `SEED_MODE=jubelio npm run db:seed`: baseline aplikasi tanpa katalog/promo
   dummy; tidak mengubah konfigurasi file `.env`.
5. `JUBELIO_SYNC_MAX_PRODUCTS=100 JUBELIO_SYNC_START_PAGE=1 npm run db:import-jubelio`:
   import berhasil.

Tidak ada Sales Order, stock adjustment, remote/deploy, perubahan gate manual,
atau perubahan source schema. SQL generated tidak diedit. Scope ini memakai
reset yang diminta pengguna, bukan penerapan SQL additive manual.

## Verifikasi sesudah pemulihan

- Query kolom revision di atas: **PASS**.
- DB counts: **100 produk, 619 varian, 26 cabang (25 Jubelio + HQ), 2.426 baris
  stok, 0 Offer**.
- Smoke HTTP authenticated menggunakan akun HQ hasil seed:
  `GET /api/admin/discounts?page=1&limit=10&activationKind=public` →
  **200**, `success: true`, `data.length: 0`. Sesi smoke di-sign-out setelah cek.
- Daftar promo kosong adalah hasil yang diharapkan pada seed mode Jubelio,
  bukan kegagalan load. Pengguna perlu login ulang karena sesi lama terhapus.
- Render browser belum diperiksa: Playwright MCP tidak menemukan executable
  Chrome. Tidak memasang browser baru. Bukti pemulihan adalah query DB dan
  authenticated HTTP; tidak mengklaim UX/E2E lulus.

Log disposable berada di `/tmp/discounts-local-{reset,push,seed,import-jubelio}.log`
dan `/tmp/discounts-local-jubelio-preflight.log`. Log seed dapat memuat kredensial
contoh; jangan menyalin isinya ke dokumentasi atau laporan pengguna.

## Catatan tooling

Context7 `/drizzle-team/drizzle-orm` mengonfirmasi `push --strict --verbose`,
`--force`, dan programmatic `pushSchema`. Source installed
`node_modules/drizzle-kit/api.js:75267` menunjukkan jalur programmatic membuang
parameter query introspeksi; preview API gagal dengan `42P02` tanpa write.
Karena itu pemulihan memakai CLI `db:push` setelah reset yang disetujui, bukan
memodifikasi dependency atau mengakali prompt data loss. Referensi:
`https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/api.ts`.

Pemulihan environment ini tidak menyelesaikan scope editor terpadu yang masih
parsial; lihat [checkpoint implementasi](../ticket/admin-unified-editor-verification.md).
