# jubelio-sales-api-switching

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Hapus syarat positif ID lokasi Jubelio](plan/signed-location-id-validation.md) | In Progress | Shared decoder, regression settlement/mirror, docs | Complete plan disetujui user melalui “oke tolong jalankan perubahan”. Kode/tests/docs selesai; RED terverifikasi, L0 PASS, L1 204 pass/1 sentinel skipped. L2 1729 pass/48 skipped, 8 suite setup gagal karena butuh DB disposable `marketplace_discounts_test_*` (environment default `storefront`). Belum Done sampai L2 lulus; evidence dan blocker lengkap di plan. Recovery order lama tidak termasuk. |
| [Jubelio Sales API switching](plan/jubelio-sales-api-switching.md) | In Progress | 7 | Features 1–5 implemented. Feature 7 stock-only worker/cron templates and feature 6 stocked-sandbox Path 1 verified locally (SO 68390/invoice 45939/payment 16); affected checkout/admin E2E 14/14 passed. **Outstanding:** SO 68388 ambiguous invoice needs operator disposition; target cron installation, migration 0022, fresh coverage and launch require explicit owner-authorized deployment. Features 6–7 remain In Progress until those checks pass. Feature 7 scheduling policy is superseded by the live-checkout/daily-reconciliation plan below. |
| [Checkout attempt sebelum pembentukan order](plan/checkout-attempt-before-order.md) | In Progress | Checkout pickup/delivery, SO, payment initialization, compensation/recovery | Complete spec disetujui user melalui “oke setuju. tolong jalankan perubahan”. Implementasi lifecycle attempt, route, frontend, sweep recovery, dan admin review selesai. Bukti: 34 DB test attempt PASS, 39 Midtrans unit PASS, E2E mock 22/22 + 29/29 + admin 1/1 PASS, full unit 1828 pass/10 gagal karena state DB bersama (terisolasi lulus). **Outstanding:** review visual UX eksplisit, deviasi legacy kontrak 0, full `test:e2e` legacy. Detail: [catatan implementasi](ticket/checkout-attempt-verification.md). |

Catatan status dan hasil test plan Sales API switching di atas dipindahkan dari index lama, bukan verifikasi baru. Draft checkout attempt adalah artefak baru dan tidak mengubah status plan existing.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

## Artefak

### plan

- [plan/signed-location-id-validation.md](plan/signed-location-id-validation.md) — hapus batas positif khusus ID lokasi; pertahankan format, mapping, financial/linkage guards, dan non-location IDs.
- [plan/jubelio-sales-api-switching.md](plan/jubelio-sales-api-switching.md)
- [plan/checkout-attempt-before-order.md](plan/checkout-attempt-before-order.md) — spec perbaikan checkout gagal sebelum pembentukan order; complete spec disetujui, implementasi berjalan.
- [plan/superseded/jubelio-sales-api-switching-2026-09-24-gated.md](plan/superseded/jubelio-sales-api-switching-2026-09-24-gated.md)

### research

- [research/jubelio-sales-api-canary-2026-09-23.md](research/jubelio-sales-api-canary-2026-09-23.md)
- [research/jubelio-sales-api-migration.md](research/jubelio-sales-api-migration.md)
- [research/jubelio-wms-status-unknown.md](research/jubelio-wms-status-unknown.md)
