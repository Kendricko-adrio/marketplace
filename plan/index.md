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