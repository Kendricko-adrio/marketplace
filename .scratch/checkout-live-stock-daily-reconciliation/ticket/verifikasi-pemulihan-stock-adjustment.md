# Verifikasi pemulihan penyesuaian stok checkout

## Scope dan persetujuan

Pada 2026-10-26 pengguna meminta investigasi sembilan kegagalan checkout pada
regression filter harga coret, kemudian menyetujui pemulihan dengan
“iya tolong pulihkan”. Scope satu sesi: pulihkan kontrak existing kedua endpoint,
perbarui mock database, dan verifikasi tanpa mengubah aturan harga, schema,
provider business writes, deployment, atau membuat commit. Tidak memakai subagent.
Bukti awal: [verifikasi filter harga coret](../../markdown-pricing/ticket/verifikasi-filter-status-harga-coret.md).

## Temuan akar penyebab

- Commit `c822619` membawa live-read di cart, penyesuaian quantity di place-order,
  helper, test HTTP, serta dokumentasi. Merge `1b06775`, dibanding parent
  `c822619`, tidak mempertahankan bagian implementasi route itu, sementara test,
  helper, dan dokumentasi tetap tersedia.
- Empat test cart menerima 200 karena route hanya memeriksa cabang.
- Tiga test place-order menerima 409 biasa tanpa `CHECKOUT_STOCK_ADJUSTED` dan
  tanpa quantity tersimpan.
- Dua test provider failure/missing observation gagal saat membaca cart: query
  proyeksi harga baru membaca `product_variant`, tetapi mock DB belum mendukung
  tabel tersebut. GET cart menjawab 500; helper test langsung membaca `.data`.
- Typecheck juga menemukan state `stockAdjustmentMessage` hilang pada halaman
  checkout walaupun handler dan JSX masih menggunakannya. Browser sebelum
  pemulihan menampilkan error boundary, bukan halaman checkout.

## Blueprint ringkas dan perubahan

1. `apps/store/src/features/checkout/verify-checkout-stock-service.ts` — service
   baru `verifyAndAdjustCheckoutStock(db, cartId, selections)`: verifikasi seluruh
   observasi provider lalu gunakan transaksi penyesuaian existing hanya untuk
   shortage terverifikasi. Hasil success mempertahankan `observedAt`; hasil
   insufficient menambahkan `adjustments`. Tidak menerima HTTP object/logger.
2. `apps/store/src/app/api/cart/validate-checkout/route.ts` dan
   `apps/store/src/app/api/checkout/place-order/route.ts` — HTTP adapter existing
   memanggil service dan memetakan hasil ke 409 beserta code/adjustments atau
   503 tanpa adjustments. Tidak menambah query Drizzle dalam route; query legacy
   di luar bagian pemulihan tidak direfactor massal.
3. `apps/store/src/app/api/checkout/place-order/route.test.ts` — public seam
   POST kedua endpoint serta GET cart; fixture menambahkan projection source
   price tanpa Markdown. Helper cart kini memeriksa status 200 terlebih dahulu.
   Satu test tambahan memastikan pembacaan quantity/source price/subtotal.
4. `apps/store/src/app/checkout/page.tsx` — hanya pulihkan deklarasi state pesan
   existing. Tidak mengubah JSX, styling, copy, atau lifecycle request v1.
5. `e2e/store/checkout-stock-adjustment-mock.spec.ts` dan
   `playwright.mock.config.ts` — seam browser contract v0, desktop 1440×1000 dan
   mobile 390×844. Spec didaftarkan di kedua `testMatch`.
6. Referensi UX: halaman checkout existing dan warning pickup amber di halaman
   yang sama. Idle tidak menampilkan banner; shortage menampilkan copy existing,
   quantity dan total baru, checkbox konfirmasi kosong, tombol bayar disabled
   sampai customer mengonfirmasi lagi. Tidak ada auto-submit/payment redirect.

## Context7 checkpoint

- `/vitest-dev/vitest` — `vi.hoisted`, async factory `vi.mock`, dan state fixture.
- `/vercel/next.js` — `NextResponse.json(data, { status })` pada Route Handler.
  Docs bundled Next.js tidak tersedia di path lokal yang diperiksa; Context7
  menjadi referensi penggantinya.
- `/reactjs/react.dev` — `useState(initialState)` pada top-level component
  mengembalikan nilai dan setter untuk render berikutnya.
- `/microsoft/playwright` — `page.route` dan `route.fulfill({ status, json })`.
- Service baru hanya mengomposisikan API internal yang sudah ada; tidak ada API
  Drizzle baru atau perubahan transaksi/predicate helper persistence existing.

## Bukti verifikasi

DB disposable baru `marketplace_discounts_test_stock_restore_20260303` dibuat
sebagai clone DB disposable verifikasi sebelumnya, bukan database aplikasi.
Provider browser di-stub; provider unit di-stub pada fetch. Tidak ada live
Jubelio/Midtrans business request. Manual server lokal milik sesi sudah dihentikan.

- Reproduksi awal: **9 failed** di file HTTP existing.
- RED test GET cart baru: **1 failed, 9 skipped**; `.data` tidak tersedia.
- Setelah fixture diperbarui: **3 passed, 7 failed**; dua test provider refusal
  kini bisa membaca cart dengan benar, tanpa mengubah runtime refusal.
- Setelah pemulihan cart: **5 passed, 5 skipped** pada kelompok cart.
- `npm run verify:unit:slice -- apps/store/src/app/api/checkout/place-order/route.test.ts`:
  **10 passed**. Kesembilan kegagalan awal seluruhnya pulih.
- RED Playwright desktop: heading Checkout tidak ditemukan; laporan Markdown
  menunjukkan error boundary “This page couldn’t load”. Screenshot gagal tidak
  dibuka.
- Setelah state dipulihkan, `npm run verify:types:store`: **PASS**.
- `DATABASE_URL=<url-db-disposable> npm run verify:batch:e2e -- e2e/store/checkout-stock-adjustment-mock.spec.ts`:
  **2 passed**. Quantity 10→5, total Rp 5.550, konfirmasi ulang, satu submission,
  tanpa pageerror, dan tanpa horizontal overflow pada kedua viewport.
- Scoped ESLint dari `apps/store`: **0 errors, 1 warning**. Warning existing
  `evaluatePricing` unused pada place-order sudah ada di HEAD sebelum perubahan.
  Percobaan awal lint dari root tidak berjalan karena root tidak memiliki config;
  run diperbaiki dengan cwd app.
- `git diff --check`: **PASS**.
- Percobaan batch unit tanpa override DB: **158 file passed, 8 failed,
  3 skipped; 1739 tests passed, 48 skipped**. Delapan suite menolak DB default
  `storefront` melalui safety guard, bukan kegagalan assertion checkout.
- Batch unit dengan DB disposable: **168 file passed, 1 failed;
  1875 tests passed, 1 failed, 12 skipped**. Satu kegagalan berada di
  `apps/store/src/lib/jubelio-channel-mirror.db.test.ts`, case
  “missed-order scan under a small limit”: insert fixture berbenturan dengan
  unique constraint `orders_pickup_code_unique` (`23505`). Bukan response checkout.
- Recheck terfokus case channel-mirror yang gagal pada DB disposable yang sama:
  **1 passed, 101 skipped**. Ini mengonfirmasi hasil tidak stabil pada fixture;
  tidak mengubah test tersebut dan tidak mengklaim batch penuh hijau.
- Legacy `npm run test:e2e` tidak dijalankan: membutuhkan izin provider terpisah.

Log disposable: `/tmp/checkout-restore-{fixture-red,fixture-green,cart-green,green,types-green,e2e-red,e2e-green,batch,batch-disposable,unrelated-recheck,lint-scoped,ux}.log`.

## Review UX dan batas penerimaan

Browser manual Chromium terpisah juga menjalankan alur pickup contract v0.
Rendered screenshot berhasil diperiksa pada desktop/mobile:
`playwright/mcp/checkout-stock-restore/checkout-{1440,390}.png`. Banner shortage
mengikuti warning amber existing; quantity/total baru terbaca, konfirmasi kosong,
dan tombol bayar disabled. Tidak ada redesign. Screenshot full-page dapat
menangkap posisi sticky header saat scroll; header tidak diubah oleh pemulihan.

**Pembaruan follow-up:** batas consumer v1 di bawah sudah ditangani pada
[pemulihan contract v1](verifikasi-pemulihan-stock-adjustment-v1.md).
Catatan berikut dipertahankan sebagai kondisi pada tahap pemulihan awal.

**Batas penting:** coverage browser ini memakai `pricingContractVersion: 0`.
Saat review consumer ditemukan `submitVersioned` belum menangani response
`CHECKOUT_STOCK_ADJUSTED` seperti jalur legacy. Pemulihan sembilan test/API
bukan bukti bahwa UX contract v1 sudah pulih seluruhnya. Follow-up perlu
menangani invalidasi review/request key serta test v1 secara tersendiri; scope
itu tidak diimplementasikan diam-diam dalam pemulihan ini.

Dokumentasi enduring diperbarui pada `docs/features/stock-reservation.md`.
Plan live-stock tetap **In Progress**; deployment/provider verification dan
follow-up contract v1 tidak ditutup oleh pekerjaan ini.
