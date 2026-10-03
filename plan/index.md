# Plan Index

**Single source of truth for plan status.** Each plan file under `plan/`
tracks per-feature status internally; this index tracks the plan as a whole.
The two must never disagree — if they do, this index wins.

Lifecycle: **Draft → Ready → In Progress → Done.** When a plan reaches Done,
its file is **deleted** (git history is the archive) and the entry below is
**retained** with date + one-line outcome summary. See
[`plan/README.md`](README.md) for the full lifecycle rules.

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Jubelio Sales API switching](jubelio-sales-api-switching.md) | In Progress | 7 | Features 1–5 implemented. Feature 7 stock-only worker/cron templates and feature 6 stocked-sandbox Path 1 verified locally (SO 68390/invoice 45939/payment 16); affected checkout/admin E2E 14/14 passed. **Outstanding:** SO 68388 ambiguous invoice needs operator disposition; target cron installation, migration 0022, fresh coverage and launch require explicit owner-authorized deployment. Features 6–7 remain In Progress until those checks pass. Feature 7 scheduling policy is superseded by the live-checkout/daily-reconciliation plan below. |
| [Checkout live stock and daily reconciliation](checkout-live-stock-daily-reconciliation.md) | In Progress | 3 | Local live-read + guarded hold, provisional catalog/cart and daily cron implemented; DB tests, targeted Playwright and cron shell test passed. Full E2E/provider verification and owner-authorized target deployment remain pending. |
| [Isi dan simpan alamat delivery di checkout](../docs/features/delivery-quotes.md) | Done | 3 | 2026-10-02: checkout menerima alamat baru tanpa harus disimpan, penyimpanan opsional/default terintegrasi dengan transaksi order dan dedupe save-intent; unit serial 955 lulus/2 skipped, mock E2E 30/30, store typecheck/lint lulus. Tidak ada aktivasi provider live. |
| [Pengiriman ke rumah via Jubelio Shipment](../docs/features/home-delivery.md) | Done | [7 approved implementation tickets](../.scratch/pengiriman-ke-rumah-jubelio-implementation/map.md) | Ticket 01 Done: mock-only pickup E2E 2/2, DB-backed ledger and full unit suite verified; no live-provider writes. Ticket 02 Done: address/origin mock E2E, real-DB ownership/default concurrency, master parcel/fallback tests and full serial unit suite verified. Ticket 03 Done: rates-only quote, stale selection and server pricing E2E verified; full serial unit 914 passed/2 skipped, mock E2E 10/10. Ticket 04 Done: immutable snapshot, reprice approval and delivery settlement verified; serial unit 923 passed/2 skipped and mock E2E 13/13. Ticket 05 Done: packing/booking claims and ambiguity verified; serial unit 937 passed/2 skipped and mock E2E 16/16. Ticket 06 Done: handoff/signature/tracking/privacy verified; serial unit 945 passed/2 skipped and mock E2E 20/20. Ticket 07 Done: scope/physical failure/proof-approved release/manual finish and GET-only recovery verified. Final serial unit 953 passed/2 ready-infrastructure sentinels skipped; mock E2E 22/22, types/lint/schema/diff pass. Enduring docs published; Ready source preserved with implementation evidence; no live operational activation. Post-completion issues deferred in [future note](research/pengiriman-ke-rumah-jubelio-lanjutan.md). |

## Legend

| Status | Definition |
|---|---|
| Draft | Plan is being written or awaiting explicit user approval; nothing implemented. |
| Ready | Complete scope and acceptance/verify criteria explicitly approved by the user; eligible for implementation; no code touched. |
| In Progress | Implementation started (at least one feature underway). |
| Done | All features implemented, tested, verified, docs extracted; plan file deleted; entry retained with date + outcome. |

> **Grandfathered plans:** earlier plans live under `.agents/`
> (`plan.md`, `rbac-new-plan.md`, `rbac-new-handoff.md`). They keep their own
> tracking there and are intentionally **not** indexed here; new plans go to
> `plan/` only. See [`plan/README.md`](README.md).