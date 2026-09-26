# Plan: Replace Jubelio stock adjustments with Sales Orders before launch

> Status of this plan as a whole is tracked in [`index.md`](index.md) only.
> This file tracks **per-feature** status.
>
> The root `.env` is the **isolated Jubelio test account** (owner decision,
> 2026-09-24): every Jubelio call made through `.env` — read or write —
> operates on the sandbox and cannot reach production. There are therefore
> **no evidence, approval or stop gates in this plan**: agents implement and
> test all features directly, validating against the sandbox via `.env`.
> Production credentials are never configured, and launching the live site
> remains an owner action outside this plan.
>
> The previous gate-based version of this plan is archived (not blocking) at
> [`superseded/jubelio-sales-api-switching-2026-09-24-gated.md`](superseded/jubelio-sales-api-switching-2026-09-24-gated.md).

## Goal

Replace the direct-inventory-adjustment checkout flow with Jubelio Sales
Orders for **all** new checkouts, before the website goes live. The site is
not live; there are no legacy customer orders to preserve. No per-order
`adjustment | sales_order` mode flag, no parallel legacy pipeline, no
staff-only cohort, no gradual rollout, no adjustment fallback. The old
adjustment implementation is replaced.

## Owner decisions (recorded)

- **Replacement, not coexistence:** all checkout traffic moves to SOs together.
- **`.env` isolation is settled (2026-09-24):** `.env` targets the isolated
  test account; agent API testing through `.env` is approved and cannot touch
  production. (Origin `api2.jubelio.com` hosts both accounts; isolation is by
  credentials, confirmed by the owner.)
- **Direct gateway, no mock dependency:** the Sales gateway talks to real
  Jubelio only; the local mock stays solely for legacy consumers until
  replaced.
- **Settlement path:** Path 1 — SO → invoice conversion → persist numeric
  invoice ID → `GET /sales/invoices/{id}` verification → `POST /sales/payments/`.
  Path 2 (`/sales/packlists/create-invoice-payment`) is not used.
- **Paid but invoice/payment ambiguous:** keep Midtrans's authoritative paid
  status, block `ready_for_pickup`, create an ops-visible `manual_review`
  case. No automatic retry, no automatic refund.
- **Ops visibility this phase:** admin review queue + structured logs.

## Starting point (what exists now)

- `apps/store/src/lib/jubelio-sales-client.ts` — real-Jubelio-only SO
  create/read/cancel gateway with fail-closed runtime gates; 59 stubbed-fetch
  tests pass. **Unwired: no caller yet.**
- `packages/db/src/schema/jubelio-sales.ts` + generated migration
  `0020_dry_rogue.sql` + `apps/store/src/lib/jubelio-sales-operations.ts` —
  durable create/cancel intent/claim ledger (persist intent before POST, one
  conditional claim, replay refusal, unique `(order_id, type)`); only the
  sweep cron touches it (stale-claim triage to `manual_review`). 18 unit,
  8 PostgreSQL and 5 schema tests pass. Migration 0020 not yet run through
  `db:migrate`.
- `packages/db/src/jubelio-sync.ts` — zero-clamp slice: explicit zero is kept
  and unsafe stock (negative/absent/non-finite) flattens to 0; 10 tests pass.
  Stock still mirrors `on_hand` with `available` fallback.
- Legacy adjustment path still serves all checkout traffic:
  `jubelio-stock-client.ts` / `jubelio-stock-saga.ts` wired into place-order,
  Midtrans webhook, sweep cron and `order-finalize.ts`.
- One canary observation (test account, item 101187/location 15, qty 1):
  SO create moved `on_hand/on_order/reserved/available` from `2/0/0/2` to
  `2/1/0/1` — i.e. `on_order` +1, `available` −1, `on_hand`/`reserved`
  unchanged — and a confirmed cancel reversed it. Record:
  [`research/jubelio-sales-api-canary-2026-09-23.md`](research/jubelio-sales-api-canary-2026-09-23.md).

## Non-scope

- Migrating historical customer orders, dual-writing to both flows, a
  per-order mode flag, or an automatic adjustment fallback for SO orders.
- Full WMS fulfillment automation, refunds, Path 2 settlement.
- Enabling live checkout / launching the site (owner action).

## Global requirements (apply to every feature)

- **Durable remote operations.** Persist an intent row (unique per
  `(order_id, type)`, full request payload) **before** any provider POST;
  claim it with a single conditional update; persist returned IDs; **never
  blind-retry an ambiguous POST** — reconcile via GET of the known ID and
  route unresolved cases to `manual_review`. Provider calls stay outside DB
  transactions.
- **Fail closed.** Unknown, mismatched or stale provider data blocks
  availability/pickup instead of guessing. Ambiguous is never treated as
  success or as definitive failure.
- **Money integrity.** Integer money; verify GET results (amounts, items,
  contact, branch) match the request before depending on them, with tolerant
  decimal normalization that still fails closed on real mismatch. Redact
  credentials/PII from logs.
- **No adjustment fallback.** No mode flag, no cohort; remove retired
  adjustment-only runtime paths once the replacement lifecycle is tested.
- **DB discipline.** New tables/columns only under `packages/db/src/schema/`;
  keep `packages/db/src/seed.ts` fixtures FK-ordered and realistic; generate
  Drizzle SQL (no hand edits); no implicit DB reset — inspect existing
  dev/test rows before destructive operations.
- **Testing.** Unit + DB-backed tests for every changed module; Playwright
  specs under `e2e/store/` and `e2e/admin/` for changed flows
  (per `AGENTS.md` §5). The replacement lifecycle must show zero
  `/inventory/adjustments/` POSTs, zero double-counted units and zero
  duplicate provider writes.
- **Sandbox validation.** Direct `.env` integration tests are part of each
  feature's verification. When real sandbox behavior differs from assumptions,
  fix the code and record the observed contract in
  `docs/features/jubelio-sales-orders.md`.

## Intended event contract

| Event | Jubelio | Website / Midtrans |
|---|---|---|
| Checkout | `POST /sales/orders/`; persist returned SO ID; confirm via GET | Acquire local pending hold first; start Midtrans **only** after confirmed SO/hold |
| Midtrans paid | Path 1: invoice conversion → persist invoice ID → `GET /sales/invoices/{id}` → `POST /sales/payments/` once, after verification | Keep money status paid; expose `ready_for_pickup` only after invoice + payment are verified; ambiguous → `manual_review` |
| Payment init failure / true expiry, pre-invoice | `POST /sales/orders/cancel/` `{ids:[...]}`; confirm via GET before local release | Midtrans `pending`/`deny`/`cancel` attempts do not end the order; existing TTL policy applies |
| Late payment after confirmed cancel | No automatic new SO, invoice, payment or adjustment | `manual_review`; disposition decided by an operator |

## Features

| # | Feature | Status | verify: |
|---|---|---|---|
| 1 | SO availability rule + local pending hold | Done | Unit/DB tests: sellable formula handles `on_order`/`reserved`/zero/clamp cases; concurrent checkouts cannot oversell; sync refresh cannot clear or double-subtract a pending hold; stale/missing snapshot fails closed. ✅ `stock.test.ts`, `jubelio-sales-holds.db.test.ts` (3 DB race/mirror tests), `jubelio-sync.test.ts`. |
| 2 | SO checkout lifecycle wiring (checkout, webhook, sweep, re-payment) | Done | DB/contract tests: intent persisted before POST; Midtrans starts only after confirmed SO/hold; cancel confirmed by GET before hold release; crash/replay never double-writes; re-payment reuses the same SO; late settlement after confirmed cancel → `manual_review`; e2e checkout completes on the SO flow. ✅ lifecycle/ledger unit+DB suites; `e2e/store/checkout.spec.ts` 11/11 (live sandbox SO flow, incl. late-settlement blocked + unknown-item manual-review). |
| 3 | Settlement: invoice → verify → payment | Done | Mock/integration tests: duplicate Midtrans webhook + sweep race → one external payment attempt; invoice-ID proof before payment; crash before/after each claim; verification mismatch keeps order paid + blocked → `manual_review`; never Path 2, never auto-refund. ✅ gateway tests (sandbox shapes), `jubelio-sales-settlement.test.ts`, live `settlement persists…` e2e (invoice+payment verified → ready_for_pickup). |
| 4 | Cutover + emergency pause | Done | Unit + e2e: zero `/inventory/adjustments/` POSTs reachable in the new lifecycle (adjustment saga + stock client deleted); `checkout.paused` blocks new checkouts without fallback; in-flight SOs reconcile by persisted ID + GET; migrations 0020+0021 generated in order and applied (0021 includes the `available_stock` backfill). |
| 5 | Admin review queue, logs and docs | Done | E2e: paid-but-ambiguous order stays paid, is blocked from `ready_for_pickup`/pickup code and is visible in the admin queue with remote IDs and reason; operator investigates read-only; docs match implemented behavior. ✅ `e2e/admin/sales-review-queue.spec.ts` 2/2 + verify-pickup refusal; docs updated (sales-orders, stock-reservation, order-flow, jubelio-sync, api-reference, testing, cron-sweep). |
| 6 | Sandbox integration validation via `.env` | In Progress | Stocked item 43822/location 2: full Path 1 passed (SO 68390 → invoice 45939 → payment 16); full affected checkout/admin E2E 14/14 passed on 2026-09-25. SO 68388 remains ambiguous: read-only SO GET shows no invoice ID and customer-filtered invoice list shows another SO; operator must investigate/dispose without blindly retrying. |
| 7 | Recurring stock-only provider refresh | In Progress | Bounded CAS keyset worker + secret-protected cron route, five-minute staging/production host-cron templates, docs, unit/DB/HTTP tests and real-stock Playwright recovery added; 14/14 affected E2E passed. Schedule is **not installed** in target environments (remote operations require owner request); target coverage/run-duration verification remains outstanding. |

### Feature 1 — SO availability rule + local pending hold

- Extend the stock-sync contract to capture `on_order`, `reserved` and
  `available` per item/location (today only `on_hand` with `available`
  fallback is stored). Keep the zero-clamp fail-closed behavior.
- Sellable rule, derived from the observed canary transition: **sellable =
  provider `available` − local pending/confirmed SO holds**. The provider's
  `available` already nets out `on_order` and `reserved`, so local code must
  never subtract provider-reserved units again (no double counting). Fail
  closed on stale/missing/unreconcilable snapshots.
- Replace the `pending_remote_stock` hold semantics with the SO hold: acquire
  the local hold atomically **before** the SO POST, keep it through
  confirmation, release only after a confirmed cancel or settlement.
- DB-backed concurrency tests: parallel checkouts cannot oversell; a
  catalog/sync refresh interleaved with checkout cannot clear or
  double-subtract a hold.

### Feature 2 — SO checkout lifecycle wiring

- Wire `jubelio-sales-client.ts` + `jubelio-sales-operations.ts` into
  `place-order`: atomic local hold → persist create intent → POST SO once →
  confirm via GET (persist SO ID) → only then create the Midtrans token.
  Unknown create results keep the hold and go to `manual_review` — never a
  blind retry, never a second SO.
- Payment-init failure or true expiry: pre-invoice cancel — persist cancel
  intent → POST cancel once → confirm via GET → release the local hold only
  after confirmation. Never cancel once an invoice exists.
- Sweep cron: reconcile in-flight operations using persisted IDs + GET
  (beyond the current stale-claim triage only); late Midtrans settlement
  after a confirmed cancel → `manual_review`.
- Re-payment: reuses the same confirmed SO, honors remaining TTL, never
  creates a new SO.
- Remove the adjustment reserve/release/reacquire runtime paths (callers of
  `jubelio-stock-saga.ts` in place-order/webhook/sweep/finalize) once the SO
  lifecycle tests pass.

### Feature 3 — Settlement: invoice → verify → payment

- Add invoice and payment operation types to the durable ledger, same
  intent/claim/at-most-once pattern as create/cancel.
- On authoritative Midtrans settlement, perform Path 1 exactly once:
  invoice conversion → persist the returned numeric invoice ID → verify via
  `GET /sales/invoices/{id}` (belongs to the SO/contact/branch; amounts and
  items match) → `POST /sales/payments/` once with the proven
  invoice-detail/account mapping → verify the payment association via GET.
- Serialize duplicate Midtrans webhooks against the sweep cron and admin
  actions: at most one external payment attempt.
- Ambiguous or unverified invoice/payment: keep Midtrans's authoritative
  paid status, block `ready_for_pickup` and pickup codes, create
  `manual_review`. No automatic retry, no auto-refund, never Path 2.
- Late settlement after a confirmed cancel → `manual_review`.

### Feature 4 — Cutover + emergency pause

- ✅ One pre-launch cutover complete: every new-checkout, re-payment, webhook,
  TTL sweep, late-settlement and admin reconciliation entry point uses the SO
  flow. No mode flag, no cohort, no adjustment fallback. The retired
  adjustment runtime modules (`jubelio-stock-saga.ts`,
  `jubelio-stock-client.ts`) and their tests were removed.
- ✅ Emergency **pause new checkouts** switch: `system_config` key
  `checkout.paused = "true"` blocks new checkouts (fail closed on config read
  errors); it never falls back to adjustments. In-flight orders keep their
  normal reconciliation paths.
- ✅ In-flight SOs remain reconcilable by persisted ID + GET
  (`reconcileJubelioSalesOperations`); crash/restart never re-POSTs (ledger
  claim gate).
- ✅ Env/deployment files updated (`JUBELIO_PAYMENT_ACCOUNT_ID`,
  `JUBELIO_PAYMENT_TYPE`, `JUBELIO_ITEM_UNIT`, `JUBELIO_ITEM_TAX_ID`);
  migration 0021 (generated 2026-09-24) applies 0020 → 0021 in order and
  backfills `available_stock` for legacy rows. Dev DB is `db:push`-managed
  (AGENTS.md); deployment containers run `drizzle-kit migrate`.

### Feature 5 — Admin review queue, logs and docs

- Admin review queue (reuse existing RBAC and stock-review UI/authorization
  patterns as starting points) listing `manual_review` SO/invoice/payment
  operations including paid-but-blocked orders: reason, known remote IDs
  (SO/invoice/payment), timestamps and owner; read-only investigation;
  no blind-write actions.
- Order detail: remote SO/invoice/payment IDs plus payment-paid vs
  fulfillment-blocked reason; a paid-but-ambiguous order never shows
  `ready_for_pickup` or a pickup code.
- Structured success/error logging on changed routes (redacted).
- Update docs to match implemented behavior: `docs/features/stock-reservation.md`
  (supersede its SO non-goal), `order-flow.md`, `jubelio-sync.md`,
  `jubelio-sales-orders.md`, `docs/api-reference.md`, `docs/testing/README.md`,
  deployment docs and matching `deployment/` settings.

### Feature 6 — Sandbox integration validation via `.env`

- Direct integration tests against the isolated test account through
  `.env` for everything built in features 1–3: SO create/cancel stock
  series (multiple items/quantities/branches where sandbox data allows),
  invoice conversion ID vs `GET /sales/invoices/{id}` (actual
  `invoice_id`/`invoice_no`), SO→invoice linkage, payment create/GET
  association, and runtime response shapes (e.g. to-sell returns
  `{data, totalCount}` rather than the schema's array).
- Record error and timeout behavior. Where real behavior differs from
  assumptions, fix the code and document the observed contract in
  `docs/features/jubelio-sales-orders.md`.
- All calls go through `.env` only; production credentials are never
  configured.

## Corrective review (2026-09-25)

- Added migration 0022: provider-only stock observation timestamp and atomic
  confirmed-SO hold accounting marker. Checkout fails closed after 15 minutes;
  confirmed create/cancel local accounting replays through the sweep without
  consuming another order's hold. Regression: unit + PostgreSQL and Playwright
  stale-snapshot cart preservation.
- Invoice/payment verification now requires matching items, contact, branch,
  totals and an explicit payment invoice association. Gateway logs no longer
  include request/response payloads with customer PII.
- `npm run sandbox:sales` recheck was **not green**: the sandbox item 101187
  already showed on_hand=0/available=0. A new test SO could be created, but
  invoice conversion returned HTTP 500 (ambiguous); its SO id 68388 had
  `invoice_id: null` on a subsequent read and requires operator investigation.
  No blind retry was made. Before closing this plan, replenish/choose a stocked
  test item, inspect that SO, rerun the full Path 1 contract and establish a
  recurring provider stock refresh within the 15-minute freshness window.
  Webhook deltas alone cannot keep unchanged stock observations fresh.

## Outstanding work (not yet Done)

### Feature 7 — Recurring stock-only provider refresh (In Progress: local implementation verified, target scheduling pending)

> **2026-09-25 scope change:** the five-minute schedule/15-minute checkout
> freshness policy below records the original design and is superseded by
> [`checkout-live-stock-daily-reconciliation.md`](checkout-live-stock-daily-reconciliation.md):
> daily full reconciliation, webhook deltas, and a live read of selected
> items/branch before each new Sales Order. Do not deploy the old five-minute
> schedule or treat the daily mirror as a checkout fallback.

- Build a bounded **stock-only** sync for mapped item/location pairs, using
  real Jubelio reads. Do not run the full catalog import every 15 minutes;
  do not POST `/inventory/adjustments/` or mutate the durable SO ledger.
- Provide a resumable scan/batch strategy so large catalogs converge without
  permanently starving items beyond the first batch. Apply stock series and
  `provider_stock_synced_at` only for successfully observed rows; an absent,
  failed, malformed or stale observation must not become a fresh positive
  snapshot. Never overwrite `pending_remote_stock` or double-count provider
  `on_order`/`reserved`.
- Schedule refresh with enough headroom to keep mapped sellable rows within
  the **15-minute** checkout limit (target <=10-minute start interval, account
  for run duration and Jubelio backpressure); an outage must fail closed and
  be visible to ops through structured logs/monitoring. Use the cron secret
  for any new HTTP entry point. Update matching `deployment/staging/` and
  `deployment/production/` settings, plus stock-sync/deployment/API docs.
- **Verify:** unit and PostgreSQL-backed tests for successful, partial,
  failed, concurrent-checkout and repeat syncs; Playwright proves a stale
  item blocks checkout without deleting the cart and a subsequently fresh
  observation restores the customer-visible flow. Run the changed-flow E2E.

### Feature 6 — Sandbox re-verification (In Progress: Path 1 verified, ambiguous SO disposition pending)

- **Read-only investigation first:** sandbox SO **68388** was created while
  item 101187 showed `on_hand=0`/`available=0`. Invoice conversion returned
  HTTP 500 (ambiguous). A later SO GET had `invoice_id: null`, which does
  **not** prove the POST was unapplied. Check Jubelio's invoice records and
  the SO/reference manually; document the finding and arrange an authorized
  operator disposition. No blind repeat invoice POST, automatic cancel or
  payment for this ambiguous SO.
- Find/replenish an isolated test item with actual sellable stock, then run
  `npm run sandbox:sales` through confirmed create/cancel and full Path 1
  invoice + payment verification. Record IDs/shapes and any changed contract
  in `docs/features/jubelio-sales-orders.md`; never substitute a mocked
  success for sandbox evidence.
- Rerun full affected store checkout and admin review E2E (not only the
  targeted stale-stock and admin specs that passed on 2026-09-25), plus unit,
  DB, schema and type checks. Diagnose Playwright failures from Markdown
  reports, not image files. Keep status In Progress until these pass.

### Release prerequisite (not a completed feature or launch authorization)

- Migration **0022** was generated and pushed only to the local dev DB.
  Before an owner-authorized deployment, verify ordered application of
  0020 → 0021 → 0022 in the target environment, populate fresh provider
  stock snapshots, enable/check the refresh schedule, and confirm checkout
  stays paused until those checks pass. Do not deploy, connect remotely or
  launch the site without an explicit owner request.

## Local verification update (2026-09-25)

- Stock-only refresh worker scans mapped items in 100-ID keyset batches (up to
  200 pages per invocation), backed by `system_config` CAS cursor. Only complete
  stock-series observations update provider timestamps; sandbox omitted
  `reserved` when zero, proven by `on_hand - on_order = available`. Concurrent
  checkout holds remain untouched. Five-minute cron templates are committed
  under `deployment/{staging,production}/`, but **not installed remotely**.
- `npm run test:unit` passed 702 tests (one skipped) after the final
  omitted-reserved regression, concurrent-hold guard and cron-route tests.
  `npx playwright test e2e/store/checkout.spec.ts
  e2e/admin/sales-review-queue.spec.ts` passed 14/14 after the provider-shape
  correction. `npm run sandbox:sales` with stocked item 43822/location 2 passed
  the complete Path 1; SO 68388 was inspected read-only and remains ambiguous.
- Checkout must remain paused in target environments until the owner
  authorizes installation, migration 0022 and live freshness checks. Never
  infer a successful invoice conversion for SO 68388 from a null invoice ID.

## Suggested execution order

Features 1–5 are implemented. Finish feature 7 before expecting a stable
checkout availability window; investigate SO 68388 before repeating feature
6's write-based validation. Run feature 6's full integration/E2E verification
and the release prerequisites only after their dependencies are satisfied.

## Implementation touchpoints

- `packages/db/src/schema/` (`jubelio-sales.ts`, `jubelio-stock.ts`,
  `orders.ts`, any new availability/hold schema), `packages/db/src/seed.ts`,
  `packages/db/src/jubelio-sync.ts`.
- `apps/store/src/lib/jubelio-sales-client.ts`,
  `jubelio-sales-operations.ts`, `stock.ts`,
  `apps/store/src/app/api/checkout/place-order/route.ts`,
  `order-finalize.ts`, Midtrans webhook route, sweep cron route,
  `payments/midtrans/create` route (re-payment).
- Admin orders API/UI + new review queue; `e2e/store/`, `e2e/admin/`.
- Docs listed in feature 5; `deployment/` env/rollout files when changed.

## Retirement checklist (when the plan reaches Done)

- [ ] Feature 7 stock-only refresh is implemented, scheduled and tested.
- [ ] Feature 6 sandbox ambiguity is investigated and Path 1 + affected
      Playwright E2E re-verification passes.
- [ ] Target-environment migration 0022, fresh snapshots and schedule are
      verified when the owner explicitly authorizes the deployment action.
- [ ] Every feature's `verify:` passes (tests per `AGENTS.md` §5).
- [ ] Enduring behavior extracted to `docs/` per `docs/README.md`.
- [ ] Plan file deleted (git history is the archive);
      [`index.md`](index.md) entry updated to **Done** with date + outcome.