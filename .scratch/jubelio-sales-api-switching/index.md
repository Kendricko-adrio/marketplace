# jubelio-sales-api-switching

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [PPN checkout pada SO, invoice, dan payment Jubelio](plan/jubelio-sales-order-tax-spec.md) | Ready — implementasi sebagian | DB tax config, signed tax ID, provider3, compatibility, checkout failure UX, lifecycle/mirror | Complete spec disetujui pemilik pada 2026-10-26 melalui “oke sudah saya setujui specnya”, termasuk blueprint, kontrak error dan acceptance tests. **Implementasi sebagian (2026-10-26):** slice inti sudah ditulis di working tree — `packages/db/src/provider-tax.ts` (validasi tax context + alokasi exact whole-line), schema union provider2/3 + constraint versi 3 + migration `0056_regular_talon.sql`, builder/decoder/evaluator provider3, gateway `getTaxRecord` + create/GET/invoice provider3, preflight `jubelio-tax-config-repository.ts`/`prepare-checkout-tax-service.ts`, wiring preview/place-order/review fingerprint/mirror, UI `CheckoutTaxFeedback`, seed/env/docs. Verifikasi terbaru: L0 store+admin typecheck PASS; L1 514 unit PASS; **L2 unit 1965 pass / 12 skipped (171 file, termasuk DB constraint tests pada DB disposable `marketplace_discounts_test_ppn`)**; **L2 mock E2E 31 pass** (`checkout-review-mock` 25 termasuk 2 test pajak baru, `versioned-checkout-mock` 4, `versioned-settlement-mock` 2). Mock provider kini melayani `GET /taxes/` (+ kontrol `PUT /__control/taxes`) dan GET SO/invoice memuat pajak per baris. **Outstanding:** evidence provider multi-line/diskon/ongkir/mirror ber-tax (butuh izin write terpisah) dan aktivasi staging/production (verifikasi master tenant + isi `jubelio.salesTaxId`); legacy `npm run test:e2e` juga belum dijalankan.  Implementasi belum dimulai; breakdown multi-sesi belum dipublikasikan/disetujui. Bukti fixture tunggal SO68450/invoice45978/payment67 PASS; gap provider rounding/diskon/ongkir/mirror tetap gate sebelum aktivasi, bukan izin write baru. Tanpa menu admin atau perubahan order lama. |
| [Hapus syarat positif ID lokasi Jubelio](plan/signed-location-id-validation.md) | In Progress | Shared decoder, regression settlement/mirror, docs | Complete plan disetujui user melalui “oke tolong jalankan perubahan”. Kode/tests/docs selesai; RED terverifikasi, L0 PASS, L1 204 pass/1 sentinel skipped. L2 1729 pass/48 skipped, 8 suite setup gagal karena butuh DB disposable `marketplace_discounts_test_*` (environment default `storefront`). Belum Done sampai L2 lulus; evidence dan blocker lengkap di plan. Recovery order lama tidak termasuk. |
| [Jubelio Sales API switching](plan/jubelio-sales-api-switching.md) | In Progress | 7 | Features 1–5 implemented. Feature 7 stock-only worker/cron templates and feature 6 stocked-sandbox Path 1 verified locally (SO 68390/invoice 45939/payment 16); affected checkout/admin E2E 14/14 passed. **Outstanding:** SO 68388 ambiguous invoice needs operator disposition; target cron installation, migration 0022, fresh coverage and launch require explicit owner-authorized deployment. Features 6–7 remain In Progress until those checks pass. Feature 7 scheduling policy is superseded by the live-checkout/daily-reconciliation plan below. |
| [Checkout attempt sebelum pembentukan order](plan/checkout-attempt-before-order.md) | In Progress | Checkout pickup/delivery, SO, payment initialization, compensation/recovery | Complete spec disetujui user melalui “oke setuju. tolong jalankan perubahan”. Implementasi lifecycle attempt, route, frontend, sweep recovery, dan admin review selesai. Bukti: 34 DB test attempt PASS, 39 Midtrans unit PASS, E2E mock 22/22 + 29/29 + admin 1/1 PASS, full unit 1828 pass/10 gagal karena state DB bersama (terisolasi lulus). **Outstanding:** review visual UX eksplisit, deviasi legacy kontrak 0, full `test:e2e` legacy. Detail: [catatan implementasi](ticket/checkout-attempt-verification.md). |

Catatan status dan hasil test plan Sales API switching di atas dipindahkan dari index lama, bukan verifikasi baru. Draft checkout attempt adalah artefak baru dan tidak mengubah status plan existing.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

## Artefak

### plan

- [plan/jubelio-sales-order-tax-spec.md](plan/jubelio-sales-order-tax-spec.md) — to-spec hasil grilling dan canary: keputusan produk, blueprint teknis/UX, versi order lama/baru, acceptance tests, dan batas aktivasi; complete spec disetujui pemilik 2026-10-26, implementasi belum dimulai.

- [plan/signed-location-id-validation.md](plan/signed-location-id-validation.md) — hapus batas positif khusus ID lokasi; pertahankan format, mapping, financial/linkage guards, dan non-location IDs.
- [plan/jubelio-sales-api-switching.md](plan/jubelio-sales-api-switching.md)
- [plan/checkout-attempt-before-order.md](plan/checkout-attempt-before-order.md) — spec perbaikan checkout gagal sebelum pembentukan order; complete spec disetujui, implementasi berjalan.
- [plan/superseded/jubelio-sales-api-switching-2026-09-24-gated.md](plan/superseded/jubelio-sales-api-switching-2026-09-24-gated.md)

### research

- [Invoice/payment pajak — hasil kelanjutan](research/jubelio-tax-canary-verification.md#kelanjutan-invoice-dan-payment--berhasil) — PASS 2026-10-26: fixture baru SO68450 → invoice45978 → payment67, tax_id-2/PPN11000/payable111000/paid111000/due0. Satu login/create/invoice/payment berizin; fixture dipertahankan paid, stok berkurang satu sesuai scope, tanpa cancel/reversal. [Journal settlement](research/jubelio-tax-invoice-payment-results.json). Jurnal accounting UI, variasi pajak, dan perubahan aplikasi belum diverifikasi/diimplementasikan.

- [research/jubelio-tax-canary-verification.md](research/jubelio-tax-canary-verification.md) — hasil final 2026-10-26: PASS create/GET/cancel/stok dua kasus pada item116334/lokasi2 yang dipilih setelah izin pemilik. SO68448 NoTax total100000; SO68449 tax_id-2/PPN11000/total111000, seluruh request kasus HTTP200. Keduanya canceled, stok pulih; create2/cancel2, tanpa invoice/payment. Empat login berizin dalam journal kumulatif; blocker preflight sebelumnya dipertahankan sebagai histori. [Journal teredaksi](research/jubelio-tax-canary-results.json). Perubahan system configuration/validator belum diimplementasikan.

- [research/jubelio-sales-order-tax-input.md](research/jubelio-sales-order-tax-input.md) — riset 2026-10-26: field pajak resmi, review batas tax0 aplikasi, dan usulan skenario sandbox bertahap. Riset dokumentasi dan GET master pajak selesai; satu login diotorisasi/dijalankan. Enam record ditemukan, termasuk PPN11% dengan tax_id -2. Tranche dua create + cancel kemudian diotorisasi dan selesai PASS pada fixture pengganti tersedia: SO68448/68449, tax_id-2/PPN11000 terverifikasi pada SO68449. Keduanya canceled dan stok pulih. Kelanjutan invoice/payment tax nonzero kemudian PASS pada fixture baru SO68450/invoice45978/payment67, total111000/due0; lihat evidence settlement di atas. Tidak mengubah status plan atau keputusan pemisahan PPN existing.

- [research/jubelio-sales-api-canary-2026-09-23.md](research/jubelio-sales-api-canary-2026-09-23.md)
- [research/jubelio-sales-api-migration.md](research/jubelio-sales-api-migration.md)
- [research/jubelio-wms-status-unknown.md](research/jubelio-wms-status-unknown.md)
