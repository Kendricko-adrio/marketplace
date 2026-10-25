# jubelio-sales-api-switching

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Jubelio Sales API switching](plan/jubelio-sales-api-switching.md) | In Progress | 7 | Features 1–5 implemented. Feature 7 stock-only worker/cron templates and feature 6 stocked-sandbox Path 1 verified locally (SO 68390/invoice 45939/payment 16); affected checkout/admin E2E 14/14 passed. **Outstanding:** SO 68388 ambiguous invoice needs operator disposition; target cron installation, migration 0022, fresh coverage and launch require explicit owner-authorized deployment. Features 6–7 remain In Progress until those checks pass. Feature 7 scheduling policy is superseded by the live-checkout/daily-reconciliation plan below. |

Catatan status dan hasil test di atas dipindahkan dari index lama, bukan verifikasi baru.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

## Artefak

### plan

- [plan/jubelio-sales-api-switching.md](plan/jubelio-sales-api-switching.md)
- [plan/superseded/jubelio-sales-api-switching-2026-09-24-gated.md](plan/superseded/jubelio-sales-api-switching-2026-09-24-gated.md)

### research

- [research/jubelio-sales-api-canary-2026-09-23.md](research/jubelio-sales-api-canary-2026-09-23.md)
- [research/jubelio-sales-api-migration.md](research/jubelio-sales-api-migration.md)
- [research/jubelio-wms-status-unknown.md](research/jubelio-wms-status-unknown.md)
