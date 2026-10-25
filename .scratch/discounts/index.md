# discounts

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Modal pemilihan promo checkout](plan/checkout-promo-modal.md) | Done | 4 | 2026-02-18 — Scope disetujui dan diimplementasikan: ringkasan/modal draft, 10 promo/page, ranking global total bayar, kode dan replacement lifecycle. Full unit enam workspace 163 file/1.766 pass/12 skip + service tambahan 8/8; mock E2E **38 kasus unik PASS** via batch/recheck; types/lint/diff PASS; render peer modal alamat vs promo 360/1440 serta delivery1280/390 diperiksa. [Evidence](ticket/checkout-promo-modal-verification.md). Batas: keyboard virtual fisik dan legacy live E2E belum dijalankan; tidak ada commit/deploy/gate rollout. |
| [Pemulihan UX Diskon Admin sesuai Prototype](plan/admin-discounts-prototype-alignment.md) | In Progress | 3 | Ketiga fitur diimplementasikan: list/tab/projection, detail empat tab+audit, dialog review/publish/stale. Unit batch 148 files/1706 pass/12 skip; 16 mock cases unik PASS melalui run dan focused recheck; scoped types/lint PASS; browser1440/390 tanpa overflow. **Outstanding:** standard/live-provider E2E L3 (izin terpisah), UAT/sign-off; plan tidak dinyatakan Done. Tanpa subagent/commit/deploy/provider live; schema/aturan bisnis/gate rilis existing tidak berubah. |
| [Spec Markdown, Coupon, dan Manual Promo Code](plan/discounts-spec.md) | In Progress | 5 | Complete spec dan 13 implementation tickets disetujui. Seluruh slice **01–12 resolved** (verifikasi lokal/mock/PG disposable, tanpa provider live/deploy). Ticket **13 claimed**: cross-slice manual×percentage/percentage+Markdown/shipping+Markdown, serial unit 1703 pass/12 guard-skip, mock E2E 47 pass, build/typecheck/db:check PASS, rehearsal migrasi52/seed/reset + mode Jubelio PASS, docs cutover + `CHECKOUT_TRUST_PROXY` compose diperbaiki, dan **legacy voucher sudah dihapus** (route 404; tabel/kolom inert). **Blocked**: UAT staging/sign-off, standard `test:e2e` live-provider (izin), deployment/rollback rehearsal, aktivasi gate1/rilis. Gate `0`; tanpa commit/push/remote. Register: `.scratch/discounts/ticket/evidence-register.md`. |

Catatan status dan hasil test di atas dipindahkan dari index lama, bukan verifikasi baru.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

## Artefak

### plan

- [plan/checkout-promo-modal.md](plan/checkout-promo-modal.md)
- [plan/admin-discounts-prototype-alignment.md](plan/admin-discounts-prototype-alignment.md)
- [plan/discounts-spec.md](plan/discounts-spec.md)

### wayfinder

- [wayfinder/acceptance-12-and-specification-outline.md](wayfinder/acceptance-12-and-specification-outline.md)
- [wayfinder/contract-09-provider-representation-and-settlement.md](wayfinder/contract-09-provider-representation-and-settlement.md)
- [wayfinder/contract-11-schema-retention-and-extensibility.md](wayfinder/contract-11-schema-retention-and-extensibility.md)
- [wayfinder/decision-zero-payment-and-no-service-fee.md](wayfinder/decision-zero-payment-and-no-service-fee.md)
- [wayfinder/map.md](wayfinder/map.md)
- [wayfinder/wireframe-06-admin-discounts-and-authorization.md](wayfinder/wireframe-06-admin-discounts-and-authorization.md)

### ticket

- [ticket/checkout-promo-modal-verification.md](ticket/checkout-promo-modal-verification.md)
- [ticket/checkout-recovery.md](ticket/checkout-recovery.md)
- [ticket/evidence-register.md](ticket/evidence-register.md)
- [ticket/execution.md](ticket/execution.md)
- [ticket/handoff-04-seed-docs.md](ticket/handoff-04-seed-docs.md)
- [ticket/handoff-04.md](ticket/handoff-04.md)
- [ticket/map.md](ticket/map.md)
- [ticket/ticket-loop-plan.md](ticket/ticket-loop-plan.md)
- [ticket/ticket-loop-runbook.md](ticket/ticket-loop-runbook.md)
- [ticket/ticket-prompt.md](ticket/ticket-prompt.md)

### research

- [research/discount-database-design.md](research/discount-database-design.md)
- [research/discount-wayfinder-proposal.md](research/discount-wayfinder-proposal.md)
- [research/discounts-coupons-promo-codes.md](research/discounts-coupons-promo-codes.md)
- [research/research-08-approved-proof-scope.md](research/research-08-approved-proof-scope.md)
- [research/research-08-combined-retest.md](research/research-08-combined-retest.md)
- [research/research-08-evidence.md](research/research-08-evidence.md)
- [research/research-08-field-matrix-evidence.md](research/research-08-field-matrix-evidence.md)
- [research/research-08-field-matrix-ij-evidence.md](research/research-08-field-matrix-ij-evidence.md)
- [research/research-08-field-matrix-protocol.md](research/research-08-field-matrix-protocol.md)
- [research/research-08-field-matrix.md](research/research-08-field-matrix.md)
- [research/research-08-integer-discount.md](research/research-08-integer-discount.md)
- [research/research-08-retest.md](research/research-08-retest.md)
- [research/research-08-selected-lifecycle.md](research/research-08-selected-lifecycle.md)
- [research/research-08-selected-shipping-mapping.md](research/research-08-selected-shipping-mapping.md)
- [research/research-08-shipping-percentage.md](research/research-08-shipping-percentage.md)
- [research/research-08-without-shipping-discount.md](research/research-08-without-shipping-discount.md)
- [research/research-08-write-protocol.md](research/research-08-write-protocol.md)
- [research/research-09-post-invoice-mirror.md](research/research-09-post-invoice-mirror.md)
- [research/sandbox-error-investigation.md](research/sandbox-error-investigation.md)
- [research/sandbox-followup.md](research/sandbox-followup.md)
- [research/sandbox-verification.md](research/sandbox-verification.md)

### prototype

- [prototype/README.md](prototype/README.md)
