# Plan: Replace Jubelio stock adjustments with Sales Orders before launch

> Status of this plan as a whole is tracked in [`index.md`](index.md) only.
> This file tracks **per-feature** status. This is a pre-launch breaking
> replacement plan, not permission to launch the site. Jubelio calls through the root
> `.env` are settled as isolated-test-account calls and cannot reach
> production (see Decisions); production credentials are never configured.

## Goal / Motivation

Replace the existing direct-inventory-adjustment checkout flow with Jubelio
Sales Orders **before the website goes live**. The owner confirms there are no
live customer orders whose legacy lifecycle needs preserving. Once enabled,
**all** new checkouts use the SO flow; no per-order `adjustment | sales_order`
mode, parallel legacy pipeline, staff-only cohort or gradual customer rollout.
The old implementation is replaced, not kept as an automatic fallback.

Source: [`research/jubelio-sales-api-migration.md`](research/jubelio-sales-api-migration.md)
(especially §§5, 7, 9–14, 17–21) and the current behavior in
[`../docs/features/stock-reservation.md`](../docs/features/stock-reservation.md)
and [`../docs/features/order-flow.md`](../docs/features/order-flow.md). The
research's immutable per-order coexistence/cohort proposal (§§11, 13, 21) is
**superseded for this pre-launch implementation** by the owner's new premise;
its API evidence, uncertainty and settlement safeguards still apply. Strategy
B (pre-payment SO) remains **provisional**: one SO create/cancel stock
transition has been observed for a single item/location, but invoice/payment
runtime behavior and the general sellable-stock rule remain unverified.

## Scope

- Validate the SO, stock, invoice and payment contract using an **isolated
  Jubelio test account** before enabling the replacement (the root `.env` is
  settled as that isolated account; see Decisions).
- Replace the adjustment-based checkout reserve, release, late settlement,
  stock ledger, cron and reconciliation paths with SO create/cancel/invoice/
  payment operations. Remove retired adjustment-specific runtime paths when
  the replacement is tested; retain catalog/master-data sync unless evidence
  requires changing it.
- Derive the website availability rule from actual same-snapshot stock evidence
  and a local pending SO hold; prevent both oversell and double-counting.
- Give ops an immediately visible manual-review queue for ambiguous outcomes,
  especially **Midtrans paid but Jubelio invoice uncertain**.
- Test the whole replacement before enabling all new checkouts; document
  emergency checkout pause and safe handling of in-flight SOs.

## Non-scope

- Migrating historical customer orders, dual-writing an order to both flows,
  implementing a per-order mode flag, or supporting an automatic adjustment
  fallback for an SO order. **Pre-launch test/dev data must still be inspected
  before any destructive database operation; do not reset it implicitly.**
- Blind retries after ambiguous SO, cancel, invoice or payment POSTs, and
  configuring production credentials anywhere (production is unreachable
  through `.env`, which is settled as the isolated test account). The owner's
  settled `.env` isolation decision (see Decisions) supersedes the earlier
  research boundary of operator-executed sandbox writes and agent GET-only
  reads with a pre-generated token, including its one-time canary exception:
  the agent may hit the Jubelio service directly with `.env` credentials for
  sandbox testing. Read-semantic POSTs such as `all-stocks/` were not used and
  remain unnecessary; see [`research/jubelio-sales-api-canary-2026-09-23.md`](research/jubelio-sales-api-canary-2026-09-23.md).
- Full WMS fulfillment, automatic `set-as-paid` or `mark-as-complete`, refunds,
  or a sellable-stock formula guessed from the API schema.

## Decisions recorded from the owner

- **Replacement, not coexistence:** the site is not live, so no legacy customer
  order lifecycle or initial staff-only cohort needs preserving. All checkout
  traffic adopts SOs together **only after the safety gates pass**. The prior
  staff-only cohort decision is superseded.
- **First settlement candidate:** Path 1 — convert the SO to an invoice,
  persist the returned **numeric invoice identifier** separately from the SO
  ID, independently verify it via `GET /sales/invoices/{id}` (including the
  actual `invoice_id` and display `invoice_no`), then record payment via
  `POST /sales/payments/`. Whether the conversion response's `id` is directly
  usable as the invoice GET ID is **not yet runtime-verified**. This choice is
  conditional on successful isolated-account validation. Path 2
  (`/sales/packlists/create-invoice-payment`) is not an automatic fallback.
- **Paid but invoice unverified/ambiguous:** retain the confirmed Midtrans
  payment as **paid**, but do not expose the order as `ready_for_pickup`.
  Immediately record the operation as `manual_review` and show the paid-but-
  blocked order to ops; no automatic retry or automatic refund.
- **Approvals:** the system owner and operations lead both explicitly
  approve the final pre-launch enablement, and the owner approves direct
  `.env`-authenticated sandbox API testing (isolation settled; see the next
  decision). The approval for the completed create/cancel canary was
  **one-time only** at the time and is superseded by that general approval.
  The owner's later request supersedes the earlier code-and-mock preference:
  implement a **direct Jubelio Sales gateway without a mock dependency**, and
  remove the old mock only when its legacy consumers are safely replaced.
  This is **not** permission to activate a checkout lacking the
  settlement/stock contract. No additional Jubelio write was performed in
  this implementation phase. Earlier per-cohort decisions are obsolete.
- **`.env` isolation is settled (owner decision, 2026-09-24):** the root
  `.env` is already configured against the **isolated Jubelio test account**.
  Hitting the Jubelio service with `.env` credentials operates only on that
  sandbox and **cannot reach production** stock, accounting or credentials,
  so `.env`-authenticated calls are no longer treated as potential production
  writes and require no per-call production-safety review or independent
  cross-account isolation proof; the historical "owner attestation is not
  API proof" caveat is superseded by this recorded decision. (The API origin
  `api2.jubelio.com` hosts both accounts; isolation is by credentials, which
  the owner confirms are the test account's.) Still required: a recorded
  bounded write scope and recovery plan per new write family — for sandbox
  hygiene and interpretable results, not production protection — plus the
  no-blind-retry rule; **stop and reconfirm with the owner** if any runtime
  evidence contradicts the isolation premise.
- **Ops visibility for this phase:** immediately expose cases in the admin
  review queue and structured logs. A separate push/email channel was **not**
  requested for this implementation phase; the review owner, SLA, customer
  wording and numerical pause/resume thresholds still require definition
  before enablement.
- **Observed bounded canary:** the owner selected item 101187/location 15,
  qty 1, and reported ops approval. In the owner-designated test account,
  create confirmed SO 68378 and changed that inventory snapshot from
  `on_hand/on_order/reserved/available = 2/0/0/2` to `2/1/0/1`;
  pre-invoice cancel confirmed and restored `2/0/0/2`. This is evidence for
  **one item/location only**, not yet a validated sellable-stock formula or
  invoice/payment contract. Full sanitized record:
  [`research/jubelio-sales-api-canary-2026-09-23.md`](research/jubelio-sales-api-canary-2026-09-23.md).

## Features

| # | Feature | Status | verify: | Notes |
|---|---|---|---|---|
| 1 | Isolated-account contract and stock evidence | Draft | SO create/cancel T0/T1/T2 recorded for one item/location in linked canary; account isolation is **settled** (`.env` = isolated test account, owner decision 2026-09-24; calls via `.env` cannot reach production), so contract evidence can now be collected by direct `.env` testing: branch/quantity/concurrency stock series, settlement-path writes, invoice GET and payment association. | Partial evidence only: the canary covers one item/location. `.env` sandbox testing is owner-approved; record a bounded write scope per new write family. If runtime evidence contradicts the isolation premise, **stop**. |
| 2 | Replace local hold and availability model | In Progress | Unit/DB tests: concurrent checkout holds cannot oversell; sync cannot clear a pending hold; provider/local snapshots reconcile without subtracting the same units twice; unavailable/unknown stock fails closed. | `flattenStock` now preserves explicit zero and clamps negative/absent/non-finite stock for a known item/location to zero (10 focused DB-package tests pass); the SO availability formula, local hold replacement, **availability-specific** schema/seed changes and DB-backed concurrency tests remain **unimplemented**. The separate operation-ledger schema/seed is not a stock invariant. Schema only in `packages/db/src/schema/`; no implicit reset. |
| 3 | SO create/cancel gateway and durable recovery | In Progress | Contract/integration tests: persist operation before POST; save SO ID; only confirmed hold can start Midtrans; confirmed pre-invoice cancel releases local hold; timeout/crash/replay never blindly repeats a write; late settlement after confirmed cancel → manual review. | `apps/store/src/lib/jubelio-sales-client.ts` is an **unwired**, real-Jubelio-only create/read/cancel gateway: no local mock fallback, explicit default-OFF test-account opt-in, explicit pinned production URL/write gate. 59 stubbed-fetch boundary tests cover one POST, GET confirmation, ambiguous body-read, cancel confirmation-GET failure, and duplicate-ID rejection. The earlier 2 HTTP-to-local-mock integration tests were **removed**; do not claim real HTTP evidence. A DB-backed ledger/claim seam exists but is **unwired**; its five focused PostgreSQL tests now pass on the local `storefront` DB, not against Jubelio; stock rule and checkout/Midtrans lifecycle wiring remain unimplemented; only crash triage is connected to the sweep cron. Zero-tax/zero-discount only. |
| 4 | Invoice → verification → payment finalization | In Progress | Mock/integration tests: duplicate Midtrans webhook + sweep race, invoice-ID proof before payment, persisted at-most-once payment attempt, ambiguous result → ops-visible manual review, no post-invoice cancel, never call Path 2 in this rollout. | Only the local mock's candidate invoice/payment HTTP behavior and failure scenarios have tests. **No actual Jubelio invoice/payment write has been performed yet** (`.env` sandbox testing is owner-approved per the settled isolation decision), and no settlement gateway, durable state, webhook finalization, or admin UI is implemented. Path 1 still needs its recorded bounded write scope and sandbox contract evidence before activation. |
| 5 | Breaking checkout cutover and emergency pause | Draft | Unit + relevant `npm run test:e2e`: all new checkout/re-payment/expiry/late-payment paths use SO (no adjustment POST); pre-enable gate blocks unsafe checkout; emergency pause blocks **new** checkouts rather than falling back; in-flight SOs remain reconcilable. | Enable only after features 1–4, reconciled test results and joint owner + ops sign-off; no staff cohort. |
| 6 | Admin review, logs and enduring documentation | Draft | E2E: paid-but-ambiguous case remains paid, is not ready for pickup and is visible in admin manual review; operator can investigate without blind write; runbook demonstrates safe pause/reconcile/resume. | Structured success/error logging on changed `/api/**` routes; update feature/API/testing/deployment docs when implemented. |

## Switching sequence (explicit stop/go)

1. **Preflight.** Isolation is settled: the root `.env` points at the
   isolated Jubelio test account, so `.env`-authenticated calls cannot reach
   production stock, accounting or credentials and no independent
   re-verification is required. A read-only GET sanity check against known
   sandbox data is still cheap the first time a new endpoint family is
   touched. Inspect whether any dev/test orders or data need retention;
   absence of *live customer* orders does not authorize deleting arbitrary
   local data. Record a bounded write scope and recovery plan for each new
   write family in the research log; never configure production credentials.
2. **Evidence gate.** The bounded, explicitly authorized canary created and
   canceled one SO (item 101187/location 15) and collected T0/T1/T2 inventory
   + SO GETs (linked above). The owner now requests direct-Jubelio code rather
   than a Sales mock, but writing disabled code does not pass this gate. This proves
   one SO stock transition, not other branches/quantities or settlement.
   Validate Path 1 directly against the isolated account via `.env`
   (owner-approved; record the bounded write scope first): conversion
   response ID versus actual invoice ID/number and SO association,
   independent invoice GET,
   payment account and invoice-detail association, then post-invoice stock
   snapshots. Document error/timeout interpretation. **STOP** if stock,
   identity, association or a complete snapshot cannot be proven. Do not use
   the local mock as substitute evidence or repeat an ambiguous POST.
3. **Replace in code, disabled until verified.** Remove the old adjustment
   calls from checkout/finalizers/sweep/re-payment and replace them with
   durable SO operations. Keep a conservative local pending hold before the
   provider POST; derive the **final** website sellable-stock rule from the
   observed stock transitions and catalog-refresh interleavings. Never
   subtract the old confirmed `reservedStock` again from already-reduced
   on-hand. Update schema/seed/mock and tests, removing obsolete adjustment
   logic only after coverage establishes the replacement lifecycle. Provider
   calls stay outside DB transactions.
4. **Settlement safety.** Midtrans must not start until SO creation/hold is
   confirmed. On authoritative Midtrans settlement, perform Path 1 **once**:
   invoice conversion → persist invoice number → verify invoice GET → payment
   write only with sandbox-proven association. Persist operation state before
   each POST and guard duplicate webhook/sweep claims. An ambiguous POST is
   not proof of failure: never automatically retry it. If Midtrans is already
   paid but invoice is ambiguous, keep paid status, block `ready_for_pickup`
   and immediately create an ops-visible `manual_review` case. Never
   auto-refund. Cancel only before an invoice exists; late settlement after
   confirmed cancel also goes to manual review.
5. **Pre-launch acceptance.** Run `npm run test:unit` and relevant
   `npm run test:e2e`, including admin visibility. Prove zero double-counted
   units, zero duplicate payment attempts, zero unsafe retries, and no
   adjustment API POST in the new checkout lifecycle; verify ambiguous
   outcomes remain visible and unresolved rather than treated as success.
   Update [`../docs/features/stock-reservation.md`](../docs/features/stock-reservation.md)
   to explicitly supersede its old SO non-goal **only when implementation is
   approved**. Require owner + ops go/no-go approval before enabling checkout.
6. **Enable all new checkouts; pause if unsafe.** No gradual cohort or
   per-order mode. Monitor same-snapshot divergence, review backlog, failed
   provider calls and duplicate-attempt count. If any unsafe condition arises,
   **pause new checkout**; do not silently send adjustments as a fallback.
   Investigate in-flight SOs by persisted ID + independent GETs and route
   unresolved cases to manual review. A deployment rollback or code revert
   must include an explicit in-flight SO handling plan; never abandon their
   reconciliation or make a second remote write. Resume only after root cause,
   gates re-pass and owner + ops sign-off.

### Intended event contract (new flow only)

| Event | Jubelio | Website / Midtrans |
|---|---|---|
| Checkout | `POST /sales/orders/`, persist returned SO ID; verify outcome | Acquire local pending hold first; start Midtrans **only** after confirmed SO/hold. |
| Midtrans paid | Path 1: `/sales/packlists/create-invoice` → persist invoice number → `GET /sales/invoices/{id}` → `POST /sales/payments/` only after proof/association | Keep money status paid; expose `ready_for_pickup` only after the defined Jubelio gate. Unknown invoice/payment outcome → ops-visible `manual_review`, not a blind retry. |
| Payment init failure / actual expiry pre-invoice | `POST /sales/orders/cancel/` with `{ids:[...]}`; confirm before local release | Midtrans `pending`/`deny`/`cancel` *attempts* do not themselves end the order; follow the existing TTL policy. |
| Late payment after confirmed cancel | No automatic new SO, invoice/payment, or adjustment | Manual review; decide disposition with the operator, not via auto-settlement. |

## Implementation touchpoints

- `packages/db/src/schema/orders.ts`, `packages/db/src/schema/jubelio-stock.ts`
  (or replacement/new schema module), `packages/db/src/seed.ts`.
- `apps/store/src/app/api/checkout/place-order/route.ts`,
  `apps/store/src/lib/jubelio-stock-client.ts`,
  `apps/store/src/lib/jubelio-stock-saga.ts`,
  `apps/store/src/lib/order-finalize.ts`, Midtrans webhook, sweep cron and
  re-payment route; `apps/jubelio-mock/src/server.ts` and associated tests.
- Admin order-detail API/UI for remote identifiers and manual review;
  `e2e/store/` and `e2e/admin/` specs for changed UI/routes.
- When implemented: `docs/features/stock-reservation.md`, `order-flow.md`,
  `jubelio-sync.md`, `docs/api-reference.md`, `docs/testing/README.md`,
  `docs/deployment-docs/` and matching `deployment/` env/rollout settings if
  changed. Do not document the candidate as live behavior prematurely.

## Remaining decisions / evidence (not guesses for the owner)

- **Partially observed:** one create changed `on_order` +1 and `available` −1;
  one cancel reversed it, without changing `on_hand` or `reserved`. How does
  invoicing affect the series, and do the transitions generalize across
  branches/quantities and concurrent checkout/webhook/import sync? Derive the
  local availability rule only from sufficient isolated-account evidence,
  not from the one canary alone.
- **Empirical gate:** does Path 1's returned number identify the right invoice
  and can `/sales/payments/` link to it safely? If not, stop and request a new
  settlement-path decision; never auto-switch to Path 2.
- **Operational detail before enablement:** the owner selected an immediate
  **admin review queue + structured logs** for this phase (no extra email/push
  requested). Define the accountable ops owner, response SLA, customer-facing
  wording, queue triage permissions and measurable pause/resume thresholds.
  Paid-but-ambiguous orders must never be shown as `ready_for_pickup`.
- **Empirical/operational gate:** safe pre-invoice cancel window and procedure
  for resolving paid funds after confirmed cancellation. No automatic
  re-settlement or refund is authorized by this plan.
- **Safety:** test-account isolation is **settled** (`.env` = isolated test
  account per owner decision; calls via `.env` cannot hit production).
  Identify any dev/test data requiring retention before migration. Do not
  assume that "not live" means every existing database row may be deleted.

## Implementation ledger — what exists now (NOT a completed cutover)

**Source-of-truth distinction:** the existing production-path checkout still
uses `/inventory/adjustments/` through `jubelio-stock-client.ts` and
`jubelio-stock-saga.ts`. The new SO gateway has **no caller** in any checkout,
webhook, sweep, re-payment, admin or deployment path. Local tests cannot prove
real invoice/payment behavior. Do not deploy or enable the replacement yet.

| Area | Completed work / evidence | Still missing for this area |
|---|---|---|
| Test-account SO canary | Owner/ops-approved **one-time** create of SO `68378`, item `101187`, location `15`, qty 1; independent SO GET confirmed invoice ID `null`; one cancel and GET confirmed `is_canceled=true`. Stock `on_hand/on_order/reserved/available`: T0 `2/0/0/2` → T1 `2/1/0/1` → T2 `2/0/0/2`. Reads were sequential, **not atomic** across endpoints. See [sanitized record](research/jubelio-sales-api-canary-2026-09-23.md). | Other locations/quantities, tax/fee shapes, invoice/payment/post-invoice stock evidence — collectible now via owner-approved direct `.env` testing. Isolation is settled by the owner's `.env` decision (no independent cross-account proof required); stop only if runtime evidence contradicts it. |
| State-aware local mock | `apps/jubelio-mock/src/server.ts` / `server.test.ts`: contact and to-sell/inventory GETs; SO create/GET/pre-invoice cancel; candidate invoice create/GET and payment create/GET; stock T0/T1/T2; duplicate-line/ID and overpay guards; timeout/malformed-success-after-apply scenarios and request log. **31 focused tests pass.** Legacy adjustment mock remains for old tests. | Invoice/payment stock effects, SO→invoice GET linkage, 409/duplicate semantics and payment association are **hypothetical** until account evidence. Mock tests must not be used as authorization for real writes. No undocumented `GET /sales/orders/?q=<note>` discovery: an ambiguous create without a confirmed SO ID stays manual review. |
| SO-only HTTP gateway | `apps/store/src/lib/jubelio-sales-client.ts`: unwired create/read/cancel candidate against an **explicit pinned real Jubelio origin only**; no mock runtime. Construction outside production fails closed unless `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true` and `JUBELIO_API_BASE_URL=https://api2.jubelio.com` are explicitly configured. Production requires explicit URL and `JUBELIO_STOCK_WRITES_ENABLED=true`. Shared queue; one POST per invocation (including network/response-body failures), GET confirmation of known IDs, pre-invoice cancel only; pre-send failures remain non-ambiguous. Nonzero tax/discount rejected and logs redact credentials. **59 focused stubbed-fetch tests pass.** | The separate ledger/claim seam exists but is not connected to this gateway; no pricing/account/contact metadata contract for real checkout or call-site integration. Runtime construction gates cannot by themselves prove which account the credentials belong to, but the owner has settled that `.env` is the isolated test account, so `.env`-authenticated testing cannot reach production. Only a read-only direct account preflight has been made so far (contact GET returned HTTP 500); no live Sales business write has been made. A direct caller without a DB operation claim is **not** at-most-once across crashes/replays. |
| Durable SO operation ledger | `packages/db/src/schema/jubelio-sales.ts`, generated migration `0020_dry_rogue.sql`, seed fixtures, and `apps/store/src/lib/jubelio-sales-operations.ts` implement an **unwired** create/cancel intent and one conditional `UPDATE ... WHERE status='intent' ... RETURNING` dispatch claim. A review found that unowned post-claim rejection could erase an in-flight write; the local API now only rejects never-claimed intents and allows a claimed unknown to be marked for manual review (now via the existing secret-protected sweep for operations older than 15 minutes). Unique-conflict handling targets `(order_id,type)` and replay requires identical reference, payload and SO ID. Focused tests: **18/18** operation-unit, **5/5** schema and **8/8** PostgreSQL race/constraint/recovery tests pass after authorized local `db:push` (the environment-blocker reporter is skipped). | Local schema was synced via `db:push`; generated migration 0020 itself was not executed through `db:migrate`, and deployment migration ordering remains unverified. Post-claim definitive rejection still needs ownership proof. Cron triages stale unknowns into `manual_review` without a retry or release, but known-ID GET reconciliation and an ops-visible SO queue remain required before checkout wiring; a local hold can remain blocked. No invoice/payment ledger, live account evidence or checkout caller exists. |
| Cross-boundary verification | The previous `apps/store/src/lib/jubelio-sales-integration.test.ts` (2 real-HTTP-to-local-mock tests) was **removed** at the owner's request to stop using a Sales mock. Gateway tests now stub only the external `fetch` boundary. The historical canary is still a distinct one-time API observation, not current end-to-end code coverage. | No current real-HTTP gateway integration test, DB-backed SO checkout/webhook/re-payment tests, SO checkout/admin-queue Playwright E2E or real Jubelio invoice/payment test. The SO *sweep triage* alone has DB and cron HTTP coverage; it is not an SO checkout E2E. Do not claim the removed 2 tests as passing now. |
| Stock-sync safety slice | `packages/db/src/jubelio-sync.ts` now forwards explicit provider zero to the existing upsert; an identified item/location with negative, absent or non-finite numeric stock clamps to zero instead of leaving a stale positive storefront stock. **10 focused tests pass**, DB package typecheck passes. It does not derive SO sellable stock. | Stock still mirrors `on_hand` (with existing `available` fallback), not an empirically proven SO-aware availability rule; sync/hold concurrency and post-invoice effects need DB tests and account evidence. Clamps may temporarily hide valid stock if the response is malformed; monitor before enablement. |
| Enduring test docs | `docs/testing/README.md` documents the current focused commands, mock boundary distinction and DB prerequisites. | Update feature/API/deployment/runbook docs when actual behavior changes; do not call the candidate live functionality. |

### Verification record and environment limitation

- Current focused checks: **59** Sales gateway tests (stubbed fetch), **18**
  ledger operation-unit tests, **8** PostgreSQL ledger tests, **5** ledger
  schema tests, **10** DB sync tests, and **31** separate local mock-service tests pass; store/DB
  typechecks and targeted store ESLint pass. The old **2 HTTP-to-local-mock
  integration tests are deleted** and must not be counted. The independent
  gateway review's P1s (pre-send failure classification, malformed body after
  POST, implicit production URL, invalid money/empty input) and mock review's
  duplicate-hold/payment issues were fixed and retested. The mock service is
  still used by the *legacy* dev/E2E/staging stack and is not part of the new
  Sales gateway. These are **local** assurances, not vendor contract proof.
- Ledger worker's DB-specific race tests (five) were skipped when PostgreSQL
  refused port 5432; its explicit environment-blocker test remained red.
  **Later local verification:** the owner started PostgreSQL and authorized
  `db:push` against the local `storefront` test DB. `db:push` synced the schema
  without reset/seed. The first real DB run exposed two test assertions that
  checked Drizzle's outer error rather than PostgreSQL's `cause`, plus a replay
  fixture whose payload differed from the persisted intent. The tests were
  corrected (cleanup now targets only IDs created in that run); **5/5 real
  DB race/constraint tests passed** in that earlier run. After adding bounded
  stale-claim triage, **8/8 real DB tests** pass; the blocker reporter is
  skipped. Focused gateway/ledger unit tests now pass **77/77**, with
  store typecheck/ESLint passing. This
  validates local DB behavior, not remote Jubelio behavior or deployment
  migration ordering. The worker's prior acceptance metadata was **rejected**
  and is not retrospectively a passing gate. The writer briefly stashed and
  popped the shared dirty worktree without conflicts; do not repeat it.
- Historical `npm run test:unit` without PostgreSQL: **598 passed, 24 skipped,
  10 failed** (port 5432 refused); not a green suite. **Current rerun with the
  local test DB available: 689 passed, 1 skipped, 80 files passed**. The sole
  skipped test is the ledger's intentional missing-DB blocker reporter; the
  eight real DB ledger tests ran and passed. No remote Jubelio write is covered.
- Full Playwright rerun with one worker **128/128 passed**. The first
  two-worker attempt had one admin Roles UI transport `ECONNRESET` (120 passed,
  7 not run); its isolated retry passed, then the full one-worker suite passed.
  This does **not** establish SO checkout E2E. The targeted Playwright recovery
  spec **3/3 passed** (including two auth setup tests):
  the secret-protected cron triages an aged SO claim exactly once without a
  provider write. A separate checkout/admin baseline **17/17 passed**: auth setup plus
  `e2e/store/checkout.spec.ts` and `e2e/admin/orders.spec.ts` against the
  local DB, with development-mode legacy adjustment/mock writes. These are
  **not** Sales Order E2E: no Playwright spec exercises the new SO gateway,
  ledger or a cutover checkout, because they have no caller yet. Add actual
  SO storefront/admin specs after the feature is safely wired; do not claim
  this baseline as cutover acceptance.
- Delegated sync writer's **acceptance metadata was rejected** (report
  formatting), so the subsequent durable-ledger writer in that workflow did
  **not launch in that workflow**. A later independent ledger workflow
  produced the bounded, unwired ledger above; it did not establish DB-backed
  correctness and its acceptance metadata was rejected. Parent independently
  reran the sync writer's focused 10/10 tests and DB typecheck; read-only
  reviewers inspected the gateway, sync and ledger diffs.
  One review found two gateway P1s (POST response-body read and implicit
  production URL), fixed and retested in the later gateway pass. The current
  gateway pass is 59/59; new tests cover duplicate item IDs rejected pre-send
  and a cancel whose confirmation GET fails after one POST.
  This is evidence for the code, not a claim that the rejected workflow gate
  or unlaunched ledger stage passed. Independently review the latest fixes
  before accepting them for cutover.
- No code commit, push, deployment, production write, additional test-account
  write, DB reset, or final go/no-go has been performed by this work. An
  owner-authorized local `db:push` did sync the test DB schema; neither
  `db:migrate` nor deployment was performed. Other pre-existing/unrelated working-tree changes remain untouched.
- Remaining gateway review follow-ups before any checkout wiring: consider minor currency
  rounding tolerance/decimal normalization for GET-versus-request amount
  comparisons (exact floating-point comparison may produce a *fail-closed*
  false ambiguity); inspect whether ambiguous cancel is logged twice. These
  are bounded test/observability follow-ups, **not** justification for
  treating a mismatched amount as a success or loosening write safety.

## Remaining execution backlog — ordered gates and acceptance

### Gate A — test-account evidence and contract decisions (feature 1, Draft)

1. Isolation is settled by the owner's recorded decision that the root `.env`
   points at the isolated Jubelio test account: `.env`-authenticated calls
   cannot reach production stock, accounting or credentials, and no
   independent cross-account proof is required. Keep the cheap read-only
   sanity check when first touching a new endpoint family (compare against
   known sandbox data); **stop and reconfirm with the owner** if runtime
   evidence contradicts the premise. Preserve existing dev/test orders and
   data; do not reset implicitly.
2. Record a **bounded, auditable write scope** (item/location/quantity/amount,
   cleanup, recovery plan) in the research log before each new write family —
   e.g. the Path 1 settlement series. The owner's settled `.env` decision
   supersedes the earlier one-time-canary framing and authorizes direct
   `.env` sandbox API testing; production is unreachable through `.env` and
   production credentials are never configured. A later owner-requested
   read-only direct Jubelio preflight occurred (see sanitized canary
   addendum); **no new business write was sent** yet. Removing mock usage
   does not by itself produce the invoice/payment contract evidence still
   required below.
3. On an approved test item/location, record timestamped, consistently
   ordered T0/T1/post-invoice/post-payment inventory reads (record that
   cross-endpoint reads are not atomic), SO and invoice GETs, numeric conversion
   `id` versus `invoice_id`/`invoice_no`, SO→invoice link (if returned),
   `items[].invoice_id` payment association, payment GET and payment account
   mapping. Establish the tax, discount, fees and integer-money payload
   contract used by the website; never infer it from the zero-tax canary.
   Test multiple branches/quantities if safe and specifically record errors,
   timeouts and whether a known ID allows independent reconciliation. The
   published API schema alone does **not** prove invoice ID or stock effects.
   The live `GET /inventory/items/to-sell/{location_id}` response was
   `{data, totalCount}` rather than the schema's array; validate actual
   runtime response shapes before parsing them. `GET /locations/list` returned
   HTTP 500 in the canary and was not diagnosed; do not rely on it for this
   location without a separate check.
4. For an ambiguous create without a returned SO ID, no documented by-note
   GET search has been established. Record it for manual investigation; do
   not repeat the POST or claim the local mock's known counter as recovery.
   `POST /sales/orders/cancel/` worked in the single canary, but wider
   behavior/error semantics are not generalized from one call.
5. **STOP** if any invoice/payment association, money identity, stock series
   or recovery rule cannot be demonstrated. Do not wire settlement or pick
   Path 2 automatically. Record evidence and update this plan before removing
   gateway fail-closed monetary restrictions.

### Gate B — DB and sellable-stock invariant (feature 2, In Progress)

1. Specify the post-SO source of website availability from observed Jubelio
   `on_hand`, `on_order`, `reserved`, `available` plus the local pending hold.
   The legacy `branch_stock.stock` currently mirrors `on_hand` and checkout
   reads `stock - pending_remote_stock`: that is **not** sufficient when an SO
   only increments `on_order` without changing `on_hand`. Define how fresh
   provider snapshots, pending/confirmed local holds, concurrent checkout and
   webhook/import races avoid both oversell and subtracting the same unit
   twice; fail closed if the snapshot is stale/missing/unreconcilable.
2. **Zero-observation slice implemented:** `packages/db/src/jubelio-sync.ts`
   no longer drops `onHand=0`; tests cover explicit zero, `available:0`,
   negative, absent and non-finite observations. Unknown/unsafe stock for a
   known item/location now clamps to zero (fail closed) rather than keeping a
   stale positive row. This does **not** settle SO-aware stock: the response
   type still lacks `on_order`, `stock` still primarily mirrors `on_hand`, and
   sync/checkout interleavings have no DB-backed tests. Add diagnostics for
   clamped versus genuinely zero rows and prove post-invoice behavior before
   choosing a final sellable rule.
3. Put any new tables/columns **only** under `packages/db/src/schema/`;
   update `packages/db/src/seed.ts` FK-ordered cleanup/realistic fixtures,
   generate but do not hand-edit Drizzle SQL, apply with `db:push` in an
   explicitly prepared dev DB (no implicit reset). Test conditional atomic
   holds under concurrent checkouts, sync races, DB constraints and recovery
   with a local PostgreSQL test DB.

### Gate C — durable SO create/cancel lifecycle (feature 3, In Progress)

1. **Partial, unwired:** the order-linked intent/request snapshot/claim
   ledger, generated migration and demo seed fixtures exist. No checkout
   caller exists. Eight focused claim/constraint/stale-recovery tests now
   pass on the owner-approved local PostgreSQL after `db:push`; the generated
   migration's deployment execution is still unverified. Once wired, unknown
   create ID must enter manual review with the local hold retained, not a
   blind retry, false failure or silent release. Reconcile only using proven
   remote GETs and persisted known IDs. Cron now triages aged unknowns to
   `manual_review` without a provider request; before wiring, implement
   known-ID GET reconciliation, an ops-visible queue, and a claim-owned way
   to record any definitive post-claim rejection; otherwise use manual review.
   The owner has settled that `.env` is the isolated test account and
   approves direct API testing through it; `.env`-authenticated POSTs cannot
   reach production. Still define and record a bounded write payload and
   recovery plan before any new POST.
2. Replace adjustment reserve/release/reacquire saga branches with SO
   create/confirm and **confirmed pre-invoice** cancel; keep provider calls
   outside DB transactions. On payment-init failure or true expiry, cancel
   once and release the local hold only after an independent GET confirms it.
   Model races between cancel, expiry, late Midtrans settlement and provider
   reconciliation; unknown outcomes pause rather than fall back to inventory
   adjustment or create a second SO.
3. Wire checkout only after Gate A+B are satisfied; start Midtrans only after
   the SO and stock hold are confirmed. Re-payment must require the same
   confirmed SO, honor remaining TTL and never create a new SO accidentally.
   Remove dead adjustment-only runtime paths **after** full lifecycle tests,
   not by deleting the legacy path while recovery is unspecified.

### Gate D — paid order and settlement (feature 4, In Progress; no settlement write performed yet)

1. Once Path 1 is empirically confirmed and separately approved, add durable
   invoice-conversion intent/claim → persist returned numeric ID → verify
   invoice GET belongs to the SO/contact/location and matches monetary/item
   expectations → durable payment intent/claim → `POST /sales/payments/`
   **once** with proven invoice-detail and account mapping → independent
   payment association proof. Keep unknown or mismatched results for ops
   review; do not call Path 2 or auto-refund.
2. Serialize duplicate Midtrans webhooks against the sweep cron and any admin
   action so the external payment attempt is at most once. Midtrans's
   authoritative paid status stays **paid** even if invoice/payment is
   unverified; the order must not become `ready_for_pickup` or disclose a
   pickup code. Capture remote identifiers and errors without secrets/PII.
3. Cancel only if the verified SO has no invoice. A late payment after a
   confirmed cancellation cannot automatically recreate/resettle inventory;
   record a paid-but-blocked manual-review case. Test timeout-after-apply,
   malformed success, crashes before/after each persisted claim, and
   independently reconciled (not re-POSTed) outcomes.

### Gate E — cutover, ops UI and launch (features 5–6, Draft)

1. Replace **every** new-checkout, re-payment, webhook, TTL sweep, late
   settlement and admin reconciliation entry point as one pre-launch cutover.
   No order-mode flag/cohort and no adjustment fallback. Add a fail-closed
   pre-enable gate and emergency **pause new checkout** switch; describe
   in-flight SO handling and rollback/restart responsibilities. Review
   matching environment/deployment files for changed flags, URLs, cron,
   health checks and build steps before touching activation.
2. Reuse existing admin orders/stock-review RBAC patterns **only as UI and
   authorization starting points**: today's `manual_review` concerns legacy
   adjustment operations, not paid-but-ambiguous SO/invoice/payment cases.
   Expose an immediately queryable queue and order detail with payment-paid
   versus fulfillment-blocked reason, known IDs, timestamp/owner and safe
   read-only investigation steps; ensure branch scope and no blind write.
   This phase requires admin queue + structured logs, not extra email/push.
   Define accountable ops owner, response SLA, customer-facing messaging and
   measurable pause thresholds before go/no-go.
3. Add unit/DB/contract tests through approved public seams, plus Playwright
   specs under `e2e/store/` and `e2e/admin/` for checkout, blocked pickup and
   visible manual review. Run **all** unit and relevant E2E with PostgreSQL
   available; check no `/inventory/adjustments/` POST is reachable in the
   replacement lifecycle, no double-count, no repeat Jubelio write, and
   no paid-but-uncertain order shown as ready. Update enduring feature/API/
   testing/deployment docs to match actual behavior.
4. Require recorded owner + ops go/no-go after Gates A–E pass. Enable all new
   checkout only then; monitor stock divergence, review backlog and unknown
   provider outcomes. If unsafe, pause new checkout rather than reverting to
   adjustments. Resume only after reconciliation and reapproval.

## Retirement checklist (when the plan reaches Done)

- [ ] Every feature's `verify:` passes (tests per `AGENTS.md` §5).
- [ ] Test-account evidence and enablement approval recorded; no ambiguous
      provider outcome silently treated as success.
- [ ] Enduring behavior extracted to `docs/` per `docs/README.md`, including
      feature, API, testing and deployment docs where applicable.
- [ ] Plan file deleted (git history is the archive).
- [ ] [`index.md`](index.md) entry updated to **Done** with date + outcome.
