# Verifikasi pemulihan consumer penyesuaian stok contract v1

## Persetujuan dan batas scope

Pengguna menyetujui follow-up yang dijelaskan pada pemulihan sebelumnya dengan
“lanjutkan pemulihannya” pada 2026-10-26. Scope satu sesi: consumer checkout v1
harus menangani shortage definitif seperti legacy, tetapi wajib membuang review
serta request key lama dan meminta review/konfirmasi baru. Recovery jaringan
harus tetap memakai key yang sama. Tidak ada redesign, perubahan pricing,
schema, backend/provider write, deployment, subagent, atau commit.

Bukti pendahulu: [pemulihan sembilan kegagalan HTTP](verifikasi-pemulihan-stock-adjustment.md).
Catatan pendahulu tetap dipertahankan sebagai rekaman kondisi sebelum follow-up.

## Diagnosis dan blueprint

- `apps/store/src/app/checkout/page.tsx`, layer UI: `submitVersioned(record)`
  tidak memanggil `handleStockAdjustment`, sehingga toast muncul tetapi quantity,
  total, checkbox, review, dan pending request tetap lama. Handler shared hanya
  dipanggil oleh consumer legacy.
- Pemulihan menambahkan satu cabang setelah penanganan hasil attempt v2 dan order
  diterima, sebelum penanganan review/reprice/promo existing. Respons gagal yang
  diterima `handleStockAdjustment` membersihkan pending request, review, dan
  attempt feedback. Tidak menambah exported contract/module baru.
- `e2e/store/checkout-stock-adjustment-mock.spec.ts`, public browser/HTTP seam:
  tambah fixture preview/promos/quote, capture body request, dan network abort.
  Tidak memock hook/component/internal helper; uang expected berupa literal
  worked case, bukan hasil fungsi pricing aplikasi.
- Referensi UX: halaman checkout dua langkah, banner shortage legacy, warning
  pickup amber, dan panel **Periksa ulang pesanan** existing. Tidak mengubah JSX,
  copy, shared components, token, spacing, atau fokus keyboard existing.
- Pickup shortage: tetap di pembayaran, tampil quantity/total baru dan warning
  review ulang; checkbox kosong dan bayar disabled. Centang checkbox saja tidak
  cukup; customer harus meminta preview baru lalu mengonfirmasi. Delivery:
  kembali ke cara pengiriman, alamat/kontak tetap ada, layanan lama tidak
  terpilih, quote baru tersedia dan **Lanjut** disabled sampai layanan dipilih.
- Stok nol: selection berkurang, item cart tetap ada; semua nol kembali ke cart.
  Network failure/503/adjustment tanpa daftar: quantity/review/key tetap, recovery
  melakukan lookup terlebih dahulu dan hanya replay body/key yang sama saat 404.
  Viewport: desktop 1440×1000 dan mobile 390×844 untuk pickup.

## Context7 checkpoint

Library ID telah di-resolve pada pemulihan awal dan dipakai kembali untuk inquiry:

- `/reactjs/react.dev` — event handler async melihat snapshot state render;
  setter meminta render berikutnya dan dibatch. Karena itu handler hanya
  menginvalidasi state; preview baru menunggu tindakan customer pada render baru.
  Sumber: https://react.dev/learn/state-as-a-snapshot dan
  https://react.dev/reference/react/useState.
- `/microsoft/playwright` — `route.abort("connectionreset")` untuk network
  failure dan `route.fulfill({ status, json })` untuk response terkendali.
  Sumber: https://playwright.dev/docs/api/class-route#route-abort dan
  https://playwright.dev/docs/mock.
- Tidak ada API Next.js/Drizzle baru. Dokumen pendamping skill Next.js
  `rsc-boundaries.md` tidak tersedia pada path skill lokal; kode tetap memakai
  Client Component dan setter existing yang dikonfirmasi dokumentasi React.

## Bukti RED → GREEN dan regression

Semua run DB memakai database lokal disposable
`marketplace_discounts_test_stock_restore_20260303`, bukan database aplikasi.
Login dilakukan ke server mock lokal; seluruh API cart/checkout/provider browser
di-stub. Test ini membuktikan consumer UI dan body request, bukan provider
promotion/settlement live. Spec tetap tercakup `testMatch` mock existing.

1. RED: test pickup v1 desktop gagal karena banner penyesuaian tidak muncul.
   Markdown report menunjukkan quantity 10, total Rp 11.100, dan checkbox masih
   checked setelah refusal. Screenshot gagal tidak dibuka.
2. GREEN slice pertama: **2 mock tests passed** untuk pickup v1 desktop/mobile.
   Review kedua memakai token `stock-review-2` dan request key berbeda dari
   submit pertama; tidak ada lookup/replay request lama setelah shortage.
3. `npm run verify:types:store`: **PASS**.
4. `npm run verify:unit:slice -- apps/store/src/app/api/checkout/place-order/route.test.ts`:
   **10 passed**.
5. Batch mock E2E file yang berubah:
   `DATABASE_URL=<url-db-disposable> npm run verify:batch:e2e -- e2e/store/checkout-stock-adjustment-mock.spec.ts`:
   **10 passed**:
   - 2 pickup v1 desktop/mobile: Rp 11.100 → Rp 5.550, wajib preview dan
     konfirmasi baru, key/token baru, tanpa auto-preview/auto-submit;
   - 3 recovery: network abort, 503 tanpa adjustments, dan response adjustment
     tanpa daftar. Quantity/review/key lama bertahan; 404 lookup diikuti replay
     body/key yang sama, lalu shortage definitif membersihkan pending key;
   - 1 stok nol sebagian: Rp 13.320 → Rp 2.220, review/submission baru hanya
     berisi item lain, barang stok nol tetap bisa dilihat di cart;
   - 1 semua stok nol: kembali ke cart, selection `[]`, pending key hilang,
     tanpa submission tambahan;
   - 1 delivery: Rp 12.210 → Rp 6.660 setelah re-quote, pilih ulang layanan,
     preview/konfirmasi baru, approval/token/key baru;
   - 2 regression pickup v0 desktop/mobile tetap lulus.
6. `DATABASE_URL=<url-db-disposable> npm run verify:batch:unit`:
   **169 files passed; 1876 tests passed, 12 skipped, 0 failed**.
   Run ini juga melewati fixture channel-mirror yang sempat collision pada run
   pendahulu; fixture tersebut tidak diubah oleh pemulihan.
7. Scoped ESLint `apps/store/src/app/checkout/page.tsx` dari cwd `apps/store`:
   **PASS, tanpa warning**. `git diff --check`: **PASS**.
8. Legacy `npm run test:e2e` tidak dijalankan karena memerlukan izin provider
   terpisah. Tidak ada klaim full live E2E, staging UAT, atau deployment selesai.

Log disposable: `/tmp/checkout-v1-stock-{red,green,batch-e2e,batch-unit,lint}.log`,
`/tmp/checkout-v1-{types,http}.log`.

## Review rendered UX dan integrasi

Main agent memeriksa screenshot dari test yang berhasil (bukan screenshot gagal):

- `playwright/results/mock/store-checkout-stock-adjus-81bc3-w-and-request-key-at-1440px-pickup-mock/pickup-stock-adjustment.png`
- `playwright/results/mock/store-checkout-stock-adjus-60d23-ew-and-request-key-at-390px-pickup-mock/pickup-stock-adjustment.png`
- `playwright/results/mock/store-checkout-stock-adjus-b402f-es-a-fresh-quote-and-review-pickup-mock/delivery-stock-adjustment.png`

Banner shortage dan panel review ulang memakai warning amber existing; total dan
quantity baru terbaca, tombol bayar disabled, serta desktop/mobile tidak
horizontal overflow. Pickup dibandingkan dengan referensi v0 pada
`playwright/mcp/checkout-stock-restore/`; delivery mempertahankan alamat/kontak
serta menampilkan layanan tidak terpilih dan tombol Lanjut disabled. Header
sticky dapat tertangkap di tengah screenshot full-page saat scroll; header tidak
diubah oleh slice ini. Tidak ada perubahan visual yang membutuhkan redesign.

Review diff mengonfirmasi bahwa accepted order/attempt v2 tetap diprioritaskan,
unknown transport tidak membersihkan key, dan cabang shortage memakai handler
shared existing. Dokumentasi enduring diperbarui di
`docs/features/stock-reservation.md`. Pemulihan consumer v1 dalam scope selesai;
plan live-stock keseluruhan tetap In Progress karena provider/deployment gates
berada di luar scope ini.
