# Flow transaksi pesanan

Artefak untuk review lintas checkout, pembayaran/webhook, settlement, dan penyelesaian pesanan oleh admin.

## Research dan evidence

- [Review keamanan dan keandalan transaksi](research/review-keamanan-dan-keandalan-transaksi.md) — snapshot `d75a44266af21e9a70329bced1f7a97640dd7e50`, 10 November 2026. Memuat 17 temuan static trace, skenario/regression yang disarankan, dan rekomendasi refactoring. Baseline terfokus: 12 file / 152 test lulus. Reproduction baru PostgreSQL/concurrency/browser dan verifikasi production masih Pending.

## Status plan

| Plan / spec | Status | Approval dan evidence |
|---|---|---|
| [Perbaikan keandalan transaksi TX-01–TX-06](plan/perbaikan-keandalan-transaksi-tx01-tx06-spec.md) | In Progress | Pengguna menyetujui **complete spec** (schema/API/UX/AC01–AC46) pada sesi implementasi, dengan scope §15.1–§15.5 bertahap, commit per langkah, DB disposable `marketplace_discounts_test_*`, dan final gate penuh §16.5. Evidence berjalan dicatat di [`ticket/verification.md`](ticket/verification.md). Slice TX-01 sudah terintegrasi; AC04 dan AC06–AC46 masih Pending. |

## Approval dan batas scope

Pengguna menyetujui complete spec TX-01–TX-06 beserta schema, kontrak API, UX blueprint §13.2, dan AC01–AC46 pada sesi implementasi. Implementasi berjalan bertahap mengikuti §15: setiap langkah berakhir pada jalur user yang berjalan, di-commit terpisah, dan dicatat evidence-nya di [`ticket/verification.md`](ticket/verification.md). Kebijakan resume tetap: recovery memperbaiki checkpoint lokal; customer menekan **Lanjutkan checkout** dengan attempt/key/snapshot/deadline semula. GET dan cron tidak membuat sesi Snap pertama untuk attempt. Unknown tetap held, tanpa refund otomatis atau redesign admin. Tidak ada DB development pengguna, provider write live, SSH, push, atau deployment.

## Tindak lanjut

Selesaikan slice TX-02 → TX-06 sesuai §15, lalu final gate §16.5 (types/lint store+admin, full unit suite, 11 mock E2E spec) dan pembaruan dokumentasi enduring. AC yang belum memiliki evidence aktual tetap Pending, termasuk seluruh AC yang membutuhkan browser sampai spec Playwright dijalankan.
