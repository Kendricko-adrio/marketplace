# Verifikasi filter status harga coret

## Scope dan approval

Pengguna menyetujui rencana percakapan dengan “oke tolong implementasikan”.
Perubahan kecil satu sesi, tanpa breakdown ticket, subagent, commit, atau deploy.
Filter tabel utama: Semua (default), Sudah disetup (target saat ini tersimpan,
aktif maupun nonaktif), Belum disetup (tanpa target, termasuk restore).
Search digabung pada backend sebelum count/pagination; pergantian filter kembali
ke halaman 1 dan tidak menghapus selection. Target nonaktif tetap independen.
Tidak ada perubahan schema, aturan harga, environment, atau deployment.

## Blueprint ringkas

- `apps/admin/src/app/admin/products/harga/price-change-client.tsx`: UI dan hook
  lokal `useCandidates(search, page, revision, markdownStatus = "all")`;
  `PriceChangeClient()` tetap kontrak exported existing. Label nyata dan shared
  `Select`/`Label` di `packages/ui/src/components/ui/{select,label}.tsx`.
- `apps/admin/src/lib/price-changes-administration.ts`: query/DAL existing
  `listPriceChangeCandidates(query: PriceChangeCandidateQuery, actorUserId: string)`;
  tambah nilai query `configured`/`unconfigured`, tanpa perubahan response.
  Tidak mengekstrak/memindahkan module legacy besar untuk perubahan query kecil.
- `apps/admin/src/app/api/admin/price-changes/candidates/route.ts`: dokumentasi
  kontrak query; forwarding, otorisasi, no-store, logging success/failure existing
  dipertahankan. Tidak ada query di route.
- Seam backend: `apps/admin/src/lib/price-changes-administration.db.test.ts`;
  seam UI: `e2e/admin/price-change-prototype-mock.spec.ts` (sudah masuk testMatch).
- Referensi visual: `apps/admin/src/app/admin/discounts/discounts-list-client.tsx`.
  Label “Status harga coret”; opsi “Semua”, “Sudah disetup”, “Belum disetup”.
  Loading/error/retry existing dipertahankan; empty “Tidak ada SKU yang cocok
  dengan pencarian dan filter.” Filter tetap tersedia bagi viewer; tidak membuat
  unsaved state. Desktop 1440×1000, mobile 390×844, focus dan keyboard shared.

## Context7 checkpoint

- `/drizzle-team/drizzle-orm-docs`: `sql` template untuk predicate, `and()`
  mengabaikan `undefined`; filter sama dipakai pada rows dan count.
- `/radix-ui/website`: controlled Select `value`/`onValueChange`, Trigger dan Item.
- `/microsoft/playwright`: locator role/name/exact dan retrying assertions.
- Panduan Next.js installed `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`
  dibaca; tetap Client Component existing, tanpa API Next.js baru.

## Bukti verifikasi — 2026-10-26

Semua operasi fixture memakai DB lokal disposable baru
`marketplace_discounts_test_price_filter_20260302`; bukan database aplikasi.
Schema disiapkan dengan `db:push` dan `SEED_MODE=demo db:seed`.

- RED backend: test baru gagal `INPUT_INVALID` pada `configured` sebelum query
  diperbarui. GREEN `verify:unit:slice` dengan path backend di atas: **35 passed**.
  Mencakup target aktif/nonaktif, belum setup, restore, search nama, pagination
  lintas katalog, empty, serta permission.
- RED Playwright: combobox belum ditemukan sebelum UI dibuat. Laporan Markdown
  dibaca; screenshot kegagalan tidak dibuka.
- GREEN `npm run verify:batch:e2e -- e2e/admin/price-change-prototype-mock.spec.ts`:
  **7 passed**. Mencakup pilihan bertahan, reset halaman, search+filter, empty,
  keyboard, mobile, dan regresi alur harga existing.
- `npm run verify:types:admin`: **PASS**.
- Scoped ESLint empat file kode/test admin yang berubah: **PASS**, tanpa warning.
- `git diff --check`: **PASS**.
- `npm run verify:batch:unit`: **168 file passed, 1 failed; 1866 tests passed,
  9 failed, 12 skipped**. Kesembilan kegagalan berada di
  `apps/store/src/app/api/checkout/place-order/route.test.ts`, tidak diubah dalam
  scope ini. Dijalankan ulang file tersebut secara terpisah: **9 failed** juga.
  Test cart mengharapkan live-stock refusal tetapi menerima 200; beberapa test
  place-order tidak menerima envelope adjustments yang diharapkan. Belum
  diperbaiki atau dinyatakan root cause final; tidak ada perubahan store.
  Gate regression penuh **belum hijau** dan tidak diklaim lulus.
- Legacy `npm run test:e2e` tidak dijalankan karena perlu izin provider terpisah.

## Review UX dan scope

Rendered UI diperiksa dari screenshot run Playwright yang lulus dan sesi browser
Chromium terpisah di admin mock lokal. MCP browser tidak tersedia karena Chrome
system tidak terpasang; fallback memakai Chromium Playwright yang sudah tersedia,
tanpa mengubah konfigurasi mesin. Dropdown dibandingkan dengan render daftar
promo: surface, tinggi, border, indikator pilihan, dan focus memakai shared
Select yang sama. Desktop/mobile tidak overflow; keyboard selection serta
Escape/focus diverifikasi. Screenshot manual berada di
`playwright/mcp/price-status-filter/` (disposable), screenshot E2E di
`playwright/results/mock/`.

Dokumentasi enduring diperbarui di `docs/features/markdown-pricing.md` dan
`docs/api-reference.md`. Diff direview terhadap scope yang disetujui: tidak ada
perubahan perilaku lain. Implementasi filter dan verifikasi terfokus selesai;
regression global masih memiliki blocker checkout di atas.
