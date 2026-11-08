# Debug promo: budget NULL dianggap Rp0

## Scope dan persetujuan

Pengguna menyetujui opsi **Perbaiki budget** setelah diagnosis: pertahankan budget
NULL pada evaluasi dan daftar promo, tambahkan regression test; masa berlaku
review checkout tidak berubah. Perubahan kecil satu sesi, tanpa plan/ticket baru,
subagent, commit, remote, atau perubahan konfigurasi promo milik pengguna.

## Bukti diagnosis

Database lokal `storefront` diperiksa dengan transaksi read-only. Offer yang
terkait kode laporan berstatus enabled, quota_count 100, budget_amount NULL,
per_client_limit 3, seluruh counter reserved/consumed nol; tidak ada Redemption
atau client usage. Benefit percentage 10%, cap Rp20.000.

`apps/store/src/lib/discount-selection.ts` dan `discount-availability.ts`
menormalisasi NULL menjadi "0" sebelum evaluator. Evaluator memperlakukan nol
sebagai budget eksplisit, sehingga benefit positif ditolak dengan
CAPACITY_UNAVAILABLE. Ini bukan pemakaian kuota oleh preview.

Log lokal `logs/store.log` menunjukkan review berhasil 2026-11-03 00:11:32 UTC,
review_required 00:38:42, review baru berhasil 00:38:53, lalu penolakan kapasitas
00:38:58. TTL review 10 menit, sehingga review pertama sudah kedaluwarsa.
`preparePromo` mengembalikan checkout ke langkah pengiriman pada respons
CHECKOUT_REVIEW_REQUIRED. Gejala navigasi terpisah dari bug budget.

## Blueprint perubahan kecil

- DAL/evaluasi `apps/store/src/lib/discount-selection.ts`: pertahankan NULL saat
  membangun input evaluator; kontrak export tidak berubah.
- DAL/discovery `apps/store/src/lib/discount-availability.ts`: mapping yang sama;
  kontrak export tidak berubah.
- Public test seams: evaluateSelectedPublicOffer/evaluateSelectedManualCode pada
  `apps/store/src/lib/discount-selection.db.test.ts`, readAvailableOffers pada
  `apps/store/src/lib/discount-availability.db.test.ts`.
- Matriks budget: NULL eligible; nol/di bawah benefit ditolak; tepat benefit
  eligible. Expected benefit Rp20.000 untuk subtotal Rp800.000, rate10%, cap20rb;
  Rp5.000 untuk fixture discovery fixed.
- UX: tidak ada perubahan komponen, copy, styling, atau navigasi. Visual review
  N/A untuk slice mapping backend; browser checkout belum diverifikasi ulang.
- Dokumentasi kontrak: `docs/features/discount-redemption.md`.

## Context7 checkpoint

Fix runtime hanya mapping nilai internal; tidak mengubah API eksternal.
Untuk test, `/vitest-dev/vitest/v4.1.12` mengonfirmasi `it.each` menerima tabel
object, callback async, dan interpolasi `$label`. Sumber:
https://github.com/vitest-dev/vitest/blob/v4.1.12/docs/api/test.md

## Verifikasi

- RED evaluasi: 2 failed, 19 passed, 1 skipped; kasus NULL publik/manual gagal.
- GREEN evaluasi: 21 passed, 1 skipped.
- RED discovery: 2 failed, 9 passed, 1 skipped; fixture NULL salah ditolak.
- GREEN discovery: 11 passed, 1 skipped.
- Dua skip focused adalah guard blocker yang memang di-skip saat PostgreSQL ada;
  bukan regression test yang tidak dijalankan.
- `npm run verify:types:store`: PASS.
- `npm run verify:batch:unit`: **belum hijau** — 160 files passed, 9 failed,
  3 skipped; 1839 tests passed, 1 failed, 48 skipped. Delapan suite menolak DB
  `storefront` karena mensyaratkan database disposable `marketplace_discounts_test_*`.
  Satu test existing/dirty `packages/db/src/rbac/seed-roles-integration.test.ts`
  mengharapkan branch HQ hasil reset+seed, tetapi database lokal masih cabang
  Jubelio. Perubahan seeding tersebut sudah ada sebelum sesi dan tidak disentuh.
- Log sementara di `%TEMP%/discount-budget-{selection,availability}-{red,green}.log`,
  `%TEMP%/discount-budget-types.log`, `%TEMP%/discount-budget-batch-unit.log`.
- Tidak menjalankan reset/seed database pengguna untuk mengatasi blocker.
  Tidak ada UI/spec mock E2E yang diubah; legacy E2E tidak dijalankan.

## Batas hasil

Fix dan regression focused terverifikasi, tetapi tidak mengklaim full suite atau
checkout browser end-to-end lulus. Batch penuh membutuhkan database disposable
sesuai prasyarat suite. Review expiry 10 menit dan aturan reservation tetap.
