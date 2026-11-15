# Outstanding follow-up setelah plan checkout-copy-density ditutup

Status: daftar kerja **belum diimplementasikan**. Tidak ada approval, ticket,
atau commit dari dokumen ini. Tujuan: item yang tidak masuk scope plan
[Ringkas dan perjelas UX checkout](../../checkout-simplification/plan/improve-checkout-copy-density.md)
tetap bisa diurus tanpa membuka kembali plan yang sudah Done.

Dibuat 2026-11-15 dari sesi implementasi plan tersebut.

## Item

| # | Item | Pemilik artefak | Status | Dampak bila dibiarkan |
|---|---|---|---|---|
| FU-1 | Literal provider line di `e2e/store/discounts-coupon-mock.spec.ts:651` masih kontrak provider2 (`amount` 125000) padahal server membekukan provider3 (aktual 138750) | [discounts/research/follow-up-coupon-provider-contract-literal.md](../../discounts/research/follow-up-coupon-provider-contract-literal.md) | Scope test-only dikonfirmasi melalui grilling; implementasi/verifikasi Pending | Full-run spec coupon tetap merah pada DB dengan preflight pajak aktif; bukan regresi plan ini |
| FU-2 | Legacy `npm run test:e2e` (shared/live config) belum dijalankan untuk scope checkout-copy-density | plan di atas (bagian Limitations) + [`docs/testing/README.md`](../../../docs/testing/README.md) | Menunggu izin user (aturan repo: eksekusi legacy E2E butuh izin terpisah) | Evidence final hanya mock E2E + unit; perilaku browser pada DB live-provider belum dibuktikan |

## Item yang sudah selesai / tidak perlu follow-up

| Hal | Status | Evidence |
|---|---|---|
| Full unit suite | **Selesai** — 2432 passed, 25 skipped, 0 failed | `DATABASE_URL=<db disposable> npm run verify:batch:unit` (serial, `--no-file-parallelism`), 2026-11-15 |
| DB test admin (`price-changes-administration`, `price-workbook-administration`) yang sempat merah | **Bukan defect** — merah hanya saat file DB dijalankan paralel karena berbagi gate global `discounts.contractVersion`; serial run hijau | Bandingkan `npm run test:unit` (paralel) vs `npm run verify:batch:unit` (serial) di DB disposable yang sama |
| `npm run test:unit` di DB dev `storefront` menolak 9 file DB | **By design** — guard menolak DB non-disposable | Pesan guard di tiap `*.db.test.ts` |

## Cara mengurus

1. Untuk FU-1: keputusan test-only sudah dikonfirmasi user melalui grilling; baca file pemilik di `discounts/research/`. Setelah ada perintah implementasi, periksa dan perbarui assertion nominal/pajak/total terkait dalam file coupon yang sama, tanpa mengubah aplikasi; verifikasi memakai DB testing terpisah dan Jubelio simulasi lokal. Tidak perlu meminta keputusan kontrak provider ulang.
2. Untuk FU-2: minta izin eksekusi legacy E2E; setelah disetujui, jalankan dan
   catat hasilnya di plan (yang sudah Done tetap disimpan, cukup tambah evidence
   atau buka item baru bila menemukan defect).
3. Jangan menaikkan kembali status plan Done hanya karena item di sini; buat
   plan/ticket baru bila keputusan atau scope berubah.
