# Jubelio Sales Orders (implemented)

The storefront checks out through **Jubelio Sales Orders** for every new
order. Inventory adjustments are retired from the runtime paths (plan:
`plan/jubelio-sales-api-switching.md`). This document is the implemented
behavior plus the sandbox-observed provider contract.

## Lifecycle (Path 1 settlement only)

| Event | Jubelio | Local result |
|---|---|---|
| Checkout | Atomic local hold (`pending_remote_stock`) → durable create intent → **one** `POST /sales/orders/` → confirm via `GET /sales/orders/{id}` (persist SO id) | Midtrans is created only after the confirmed SO/hold |
| Midtrans paid | Path 1 exactly once: `POST /sales/packlists/create-invoice` → persist invoice id → `GET /sales/invoices/{id}` verification → `POST /sales/payments/` once → verified payment GET | `ready_for_pickup` only after invoice + payment are verified; ambiguous → paid-but-blocked + `manual_review` |
| Payment init failure / expiry (pre-invoice) | `POST /sales/orders/cancel/` `{ids:[...]}` → confirm via GET → release the local hold | Order fails only after the cancel is confirmed |
| Late settlement after a confirmed cancel | No automatic new SO/invoice/payment | Order stays paid, blocked from pickup, `manual_review` |

The pickup create intent includes `channelStatus: "Belum Bayar"`; the same
single SO create POST carries `channel_status: "Belum Bayar"`. The independent
SO GET must still match the INTERNAL source, note/reference, contact, branch,
items, quantities, prices, line amounts and totals before Midtrans. If only
`channel_status` differs (including an absent value), checkout can proceed:
the discrepancy is recorded atomically with the confirmed create in
`jubelio_sales_operation.channel_status_mismatch_reason` (`CREATE_MARKER_MISMATCH`)
and `channel_status_mismatch_at`, with the confirmed SO id. There is **no**
marker edit or blind create retry. This informational marker never authorizes
payment or pickup. For investigation, query the local DB by `order_id` or
`sales_order_id`, e.g. `SELECT order_id, sales_order_id, status,
channel_status_mismatch_reason, channel_status_mismatch_at FROM
jubelio_sales_operation WHERE type = 'create' AND
channel_status_mismatch_reason IS NOT NULL ORDER BY channel_status_mismatch_at;`.
Use the SO id for a read-only GET; do not re-POST the create or edit marker
without a separately approved procedure. Logs contain only IDs and reason codes,
not customer or provider response bodies.

## Channel-status mirror — Siap Proses (ticket #03)

After an order is **committed** `ready_for_pickup` (which happens only after
the verified invoice + payment above), the website status is mirrored onto
the Jubelio **Status Channel** as `Siap Proses` — best effort, never
blocking payment or pickup:

- **Trigger.** Right after `fulfillPaidOrder` claims pickup in the
  settlement pipeline, and again in the sweep's bounded mirror pass. The
  trigger derives eligibility ONLY from committed state: local
  `ready_for_pickup` + confirmed `invoice` + confirmed `payment` ledger
  operations. A merely `paid` Midtrans status or an in-flight settlement is
  never a `Siap Proses` trigger. `Selesai` is projected separately from
  committed completion (ticket #06); `Gagal Bayar` and `Menunggu Verifikasi`
  follow tickets #05 and #04 below.
- **Intent ledger.** `jubelio_channel_status_intent`
  (packages/db/src/schema/jubelio-channel.ts) persists one intent per
  (order, monotonic `target_version`) with the known SO id and the target
  marker BEFORE any edit. ONE conditional UPDATE (`pending` →
  `possibly_sent`) grants the single edit POST permission; the partial
  unique index `jubelio_channel_status_intent_active_per_so_unique`
  additionally guarantees at most ONE active dispatch per sales order
  across all local orders (a competing claim fails closed, never a second
  POST).
- **Fail-closed full-payload edit.** Before the single `POST /sales/orders/`
  edit, the gateway performs a strict pre-read GET and the mirror
  cross-checks it against the verified ledger: identity/location, note,
  ref_no, invoice link, item lines (identity, quantity, unit, tax, price,
  amount) and money. Source ≠ INTERNAL, missing/zero detail ids, or any
  nonzero disc/tax/fee money refuses the edit with ZERO POST (codes
  `EDIT_*` → investigation, never a harmless "provider rejection"). The
  edit payload preserves the SO id, SO number, detail ids, items and money
  verbatim; `channel_status` is the ONLY intended change. The verified edit
  snapshot is persisted in the intent's audit payload before POST and may
  include the customer's name; protect that DB field like other order PII.
  Logs and durable mismatch reasons never include that snapshot. An
  independent post-edit GET must observe the marker AND every core
  attribute; any divergence is an ambiguous outcome.
- **Target ordering (ticket #06).** Targets are per-order monotonic
  versions on the forward sales-progression chain
  (`Menunggu Verifikasi` < `Siap Proses` < `Selesai`): an older target is
  never dispatched while an older intent is unresolved (`possibly_sent`),
  a confirmed intent already at (or past) the marker applicable to the
  committed local state excludes the order from the sweep window, an
  earlier confirmed stage is never overwritten with an earlier marker
  (no backward overwrite; the guard claims no ordering against unranked
  targets such as `Gagal Bayar`), and a stale PENDING target (order went
  `completed` after the intent was recorded) is atomically superseded
  (never-sent → `aborted`, zero POST/GET) before the next version is
  recorded.
- **Crash tolerance.** A claimed edit whose outcome is unknown (timeout,
  5xx, unreadable response, failed confirmation GET) stays `possibly_sent`:
  a competing caller never GET-reconciles a FRESH claim (15-minute default
  cutoff); aged claims are reconciled GET-ONLY by the persisted SO id —
  never a re-POST, also for orders that meanwhile went terminal. Recovery
  confirms against the intent's OWN target marker (never a hardcoded
  value). TRANSIENT read failures (GET 5xx/429/timeout after the claim)
  keep the intent `possibly_sent` for an aged GET-only retry on a later
  sweep — they are never recorded as an investigation; only DEFINITIVE
  read failures (strict shape, canceled SO, unknown SO id) record a
  durable, PII-safe `mismatch_reason` with the gateway code
  (`needs_investigation`); open investigations are never re-dispatched
  automatically. A definitive provider rejection records ONLY a static
  PII-safe reason code in the durable `last_error` (validated
  `A-Z 0-9 _ : . -`); the dynamic provider message is surfaced in the
  returned outcome but never persisted, and a rejected intent is never
  re-POSTed automatically.
- **Noninterference.** A mirror failure never changes the local order
  status, payment status, pickup code or verify-pickup permission, and
  never fails the sweep or settlement. The mirror is informational only.
- **Scheduled PENDING terminal disposition.** A pending intent on a
  committed `completed` or `cancelled` order is durably superseded by an
  atomic guarded `pending` → `aborted` UPDATE (static PII-safe reason
  `PENDING_TERMINAL_SUPERSEDED`, zero POST/GET). A pending `Selesai` intent
  on a completed, paid order with verified positive create/invoice/payment
  IDs is the CURRENT target and is spared at the write boundary, then
  dispatched by the missed-order pass. `failed_payment` is not blanket-
  terminal: the #05 `Gagal Bayar` pass decides whether to edit or record a
  started-cancel mismatch. `possibly_sent` is never aborted here (GET-only
  recovery); the terminal abort is concurrency-guarded against a dispatch
  claim. An aborted intent never blocks a later version.
- **Sweep budget & fairness.** The cron runs the mirror pass LAST (lowest
  priority — settlement and expiry get the budget first). Per run it
  touches at most `limit` (50) aged possibly-sent intents, at most `limit`
  (50) pending-terminal intents and at most `limit` (50) mirror-ELIGIBLE
  missed `ready_for_pickup` AND `completed` orders (ticket #06 — the sweep's
  recovery therefore finds a committed completed state and reconciles any
  unresolved edit GET-only by the persisted SO id even when the
  store→admin completion response was lost); orders whose latest intent is
  confirmed for the marker applicable to the CURRENT committed state,
  resolved (needs_investigation / rejected) or in-progress
  (possibly_sent) are excluded by SQL — a confirmed EARLIER stage
  (e.g. a confirmed `Siap Proses` on a since-completed order, ticket #06, or
  a resolved `Menunggu Verifikasi` investigation, ticket #04) is NOT
  excluded so the monotonic next version can be recorded; historical aborted intents pass so a later committed state can record its
  next version, ineligible ready/completed orders
  (e.g. without a verified SO ledger) never consume the window, and a
  still-unknown intent is rotated to the back of the bounded scan, so
  every unresolved intent and missed order is eventually reached across
  sweeps. `missedFailed` counts per-run per-order failures and is surfaced
  in the cron response/log.
- **Investigation runbook.** Query the local DB by order or SO id, e.g.
  `SELECT id, order_id, sales_order_id, target_version, target_status,
  status, last_observed_status, mismatch_reason, mismatch_at FROM
  jubelio_channel_status_intent WHERE order_id = '<order>' OR
  sales_order_id = <so_id> ORDER BY target_version;`. Recovery is a
  read-only GET of the persisted SO id (via `GET /sales/orders/{id}` in
  Jubelio); do not re-POST any edit without a separately approved
  procedure. Logs contain only ids and reason codes, not customer or
  provider response bodies.

`/sales/packlists/create-invoice-payment` (Path 2) is never called. There is
no adjustment fallback, no per-order mode flag.

## Channel-status mirror — Menunggu Verifikasi (ticket #04)

A paid-but-blocked order whose committed state evidences a **settlement
manual review or an explicit operator investigation block** is mirrored as
`Menunggu Verifikasi` on the Jubelio Status Channel — through the SAME
durable, versioned intent machinery as `Siap Proses` above (one intent per
monotonic version, one atomic dispatch claim, full-payload fail-closed edit,
independent GET confirmation, GET-only recovery, and PII-safe durable
reasons):

- **Trigger (committed state only).** An order that is `paid` and still held
  in `processing` (never fulfilled) where the committed evidence shows
  operator investigation is required: a non-null `fulfillment_blocked_reason`
  (set ONLY by the committed settlement/late-settlement review paths) or a
  `manual_review` status on any settlement ledger operation. A short
  pending/in-flight settlement (ops merely `intent`/`dispatched_unknown`, no
  block) and the implicit admin-queue membership of EVERY `processing`+`paid`
  order are **not** triggers. A raw Midtrans callback never triggers the
  marker. A confirmed create with a known SO id is always required.
- **No `Menunggu Verifikasi` for quick success.** A quickly verified invoice
  + payment goes straight to `ready_for_pickup`; the mirror projects
  `Siap Proses` directly (ticket #03 path) and no investigation marker is
  ever sent for a merely short verification.
- **Resolved investigation.** Once the manual review is resolved and the
  committed local order becomes `ready_for_pickup` (verified invoice +
  payment), the LATEST mirror target is the monotonic NEXT version `Siap
  Proses`: a confirmed `Menunggu Verifikasi` intent is history, never
  authority; a STALE PENDING `Menunggu Verifikasi` intent (never dispatched)
  is durably superseded atomically (`pending` → `aborted`, static PII-safe
  reason `PENDING_TARGET_SUPERSEDED`, zero edit POST, zero GET,
  concurrency-guarded against a simultaneous dispatch claim) before the
  `Siap Proses` version is recorded and dispatched. An older outcome can
  never overwrite a newer target, and a possibly-sent old intent still
  blocks newer dispatches until its GET-only recovery resolves. There is a
  small accepted race between reading the committed block and issuing an
  already-claimed edit: if settlement resolves in that interval, an older
  `Menunggu Verifikasi` marker can briefly be sent. The later `Siap Proses`
  version waits for that intent to resolve (or operator investigation), so
  there is no guaranteed time-to-correction; the channel never gates pickup.
- **Wiring.** The settlement pipeline reconciles the mirror best-effort
  right after each committed settlement manual review (blocked-by-active-
  cancel, unverified invoice, unverified payment); the sweep's bounded pass
  (step 4) additionally recovers paid-but-blocked orders whose intent was
  never created, bounded by `limit` and surfaced in the cron response as
  `verifikasiOrdersScanned` / `verifikasiDispatched` / `verifikasiFailed`.
- **Noninterference.** A `Menunggu Verifikasi` mirror failure never changes
  the paid status, the committed settlement block, the pickup code or the
  verify-pickup permission; the manual-review outcome of the settlement is
  unaffected. The marker is informational only and never authorizes pickup.
- **Fail-closed notes.** The same strict pre-edit GET and cross-check apply;
  the invoice-link check compares the remote SO's invoice link against the
  ledger-persisted invoice id when one exists (verified for `Siap Proses`,
  conversion-persisted for `Menunggu Verifikasi`), or requires NO remote
  invoice link when the ledger has none — a remote link the ledger does not
  know of is an investigation with zero POST. An SO that is (or became)
  canceled is never edited (`PRE_READ_SO_CANCELED`). Late-settlement cases
  paid-but-blocked after a started cancel project `Menunggu Verifikasi`
  through this same committed-state derivation (per ticket #05's handoff).
  Open mirror investigations (`needs_investigation`) still require an
  explicit operator action before any newer target is dispatched.
- **Investigation runbook.** Same query as the `Siap Proses` mirror above,
  filtered by `target_status = 'Menunggu Verifikasi'` when useful; recovery
  is a read-only GET of the persisted SO id. Do not re-POST any edit without
  a separately approved procedure.

## Channel-status mirror — Gagal Bayar (ticket #05)

A locally committed `failed_payment` + `failed` order whose Sales Order is
**provably safe to edit** is mirrored as `Gagal Bayar` on the Jubelio Status
Channel — through the SAME durable, versioned intent machinery as the other
markers (one intent per monotonic version, one atomic dispatch claim,
full-payload fail-closed edit, independent GET confirmation, GET-only
recovery, PII-safe durable reasons):

- **Trigger (committed state only).** The order is `failed_payment` +
  `failed` locally, the confirmed create ledger operation carries a known
  SO id, and the Sales-Order cancel path is provably NOT in flight: no
  cancel ledger operation exists, or the recorded one was definitively
  refused pre-apply (`rejected`) or locally abandoned unsent (`aborted`).
  One non-terminal Midtrans attempt failure never triggers the marker
  (non-terminal attempt statuses keep the order `pending_payment`); without
  a confirmed create there is NO marker edit and no intent.
- **Started/confirmed cancel path — zero POST, durable mismatch.** A
  committed cancel operation in `intent`, `dispatched_unknown`, `confirmed`
  or `manual_review` state makes the SO unsafe to edit for `Gagal Bayar` —
  including an existing PENDING mirror intent (a webhook/sweep racing with
  the cancel). The disposition is an ATOMIC `pending` → `aborted` write
  correlated to the committed cancel-active evidence (concurrency-guarded
  against a simultaneous dispatch claim), with the static PII-safe reason
  `GAGAL_BAYAR_CANCEL_STARTED`; when no pending intent exists, the intended
  `Gagal Bayar` target is recorded as the monotonic next version and
  immediately aborted with the same reason (deduped per order). The Status
  Channel may then stay `Belum Bayar`; the cancel/hold release is never
  delayed or reverted for the mirror. A remote GET that shows the SO was
  canceled (`PRE_READ_SO_CANCELED`) likewise fail-closes any attempt with
  zero POST and a durable, findable investigation.
- **Safe edit.** When the cancel path never started (or was definitively
  refused/abandoned pre-apply) and the remote SO is still active, the
  `Gagal Bayar` edit uses the same at-most-once claim, fail-closed
  full-payload cross-check and GET confirmation as `Siap Proses`;
  ambiguity (timeout/5xx/unreadable response) leaves the intent
  `possibly_sent` for GET-only recovery — never a second POST. The marker
  is best effort: it may remain `Belum Bayar` on a canceled SO; the
  cancel/stock release is never delayed or reverted for the mirror.
- **Stale targets.** A pending intent whose committed state now evidences a
  different mirror target is superseded atomically
  (`PENDING_TARGET_SUPERSEDED`, never dispatched) and the derived target is
  recorded as the monotonic next version. A possibly-sent older target is
  never breached or blindly re-sent: it is reconciled GET-only against its
  OWN target; an ambiguous old `Gagal Bayar` outcome stays
  `needs_investigation` (operator action) and blocks newer dispatches.
- **Late settlement.** A paid-but-blocked late settlement (after a started
  cancel) keeps the local flow unchanged (processing + paid + committed
  block) and projects `Menunggu Verifikasi` through the ticket #04
  derivation; the fail-closed pre-read refuses the edit when the remote SO
  is already canceled. If the settlement is later fully verified and the
  local order becomes committed `ready_for_pickup`, the mirror follows the
  latest local state: a confirmed old `Gagal Bayar` intent is history and
  the next version projects `Siap Proses`.
- **Sweep window.** The cron's bounded mirror pass scans missed
  failed_payment orders (safe SO → one `Gagal Bayar` edit; active cancel
  path → the durable mismatch record with zero POST/GET), surfaced in the
  cron response as `gagalBayarOrdersScanned` / `gagalBayarDispatched` /
  `gagalBayarFailed`. A recorded started-cancel mismatch (while the cancel
  path is still active) frees the bounded window; when the cancel later
  resolves, the order re-enters the window and projects normally.
  `failed_payment` orders are no longer blanket-terminal for pending
  mirror intents (only `completed` / `cancelled` are).
- **Noninterference.** A `Gagal Bayar` mirror failure never changes the
  local failed_payment state, the cancel path, the hold release or any
  pickup/verify-pickup behavior. The marker is informational only.
- **Investigation runbook.** Same query as the other mirror sections,
  filtered by `target_status = 'Gagal Bayar'` or
  `mismatch_reason = 'GAGAL_BAYAR_CANCEL_STARTED'` when useful. Recovery is
  a read-only GET of the persisted SO id; do not re-POST any edit without a
  separately approved procedure.

## Durable operation ledger

`jubelio_sales_operation` (packages/db/src/schema/jubelio-sales.ts) stores one
request snapshot per `(order_id, type)` for `create | cancel | invoice |
payment`. The single dispatch permission is ONE conditional
`UPDATE ... WHERE status = 'intent'` → `dispatched_unknown` (possibly sent).
Outcomes: `confirmed` (independent GET verified; remote id persisted),
`rejected` (definitive pre-apply rejection), `manual_review` (ambiguous —
never retried, never assumed failed). The invoice id is persisted
(`invoice_id` column) as soon as the conversion POST returns it, BEFORE any
payment; the payment id is persisted only after a verified payment GET.
Provider calls stay OUTSIDE any DB transaction.

## Sellable stock rule

`branch_stock.availableStock` mirrors the provider `available`
(= on_hand − on_order − reserved) captured by jubelio-sync from all four
series. Sellable = `available − pending_remote_stock`; the provider series is
never subtracted again (no double counting). Fail closed:

- Before every NEW checkout, read selected item/location stock directly from
  Jubelio; validate the complete four-series observation, then reconcile the
  local mirror with concurrency guards. Missing/inconsistent response or a
  network error blocks checkout (503) without creating a Sales Order. Last-known
  stock is shown in the catalog/cart but is not a checkout authority.
- The hold is acquired BEFORE the SO POST (the just-read provider snapshot and
  `available − pending >= qty`). Confirmed create atomically clears this hold,
  decrements the local `availableStock` mirror and stores the SO id. Confirmed
  cancel **does not** decrement the aggregate pending holds a second time;
  the next provider sync restores availability.
- Confirmed create/cancel accounting is transactionally marked in
  `jubelio_sales_operation.hold_accounted_at`. Sweep repairs a confirmed
  operation whose local accounting was interrupted, without a second POST.
  Once the provider confirms a create/cancel, subsequent local DB failures
  must never be reclassified as a definitive provider rejection.
- A sync refresh never touches `pendingRemoteStock`.
- A negative provider `available` is clamped to 0 locally.

## Sandbox-observed runtime contract (2026-09-24, `.env` test account)

Verified end-to-end via `npm run sandbox:sales` (apps/store):

- `POST /sales/orders/` → `{id}`; SO GET returns `is_canceled: null` (not
  `false`) for active orders and carries `invoice_id` after conversion.
- Stock series after SO create: `on_order +1`, `available −1`,
  `on_hand`/`reserved` unchanged; confirmed cancel reverses it. The provider
  `available` can go negative when oversold; local snapshots clamp at 0.
- `tax_id` must reference a real tax record — `0` fails the provider FK
  (HTTP 500 after send). The account's "No Tax" record is `1` (`rate 0.00`);
  configured via `JUBELIO_ITEM_TAX_ID`.
- `POST /sales/packlists/create-invoice` `{salesorder_id}` →
  `{status:"ok", id}` where `id` is the **Sales Invoice Number**.
  `GET /sales/invoices/{id}` exposes money as decimal strings and
  `salesorder_id: null` — the SO link is proven by the SO GET's `invoice_id`.
- `POST /sales/payments/` requires a **numeric** `payment_type` (0 = cash/
  other on this account), accepts `payment_no: "[auto]"` and
  `transaction_date`; response `{status:"ok", id}` where `id` is the
  `payment_id`. `GET /sales/payments/{id}` returns `invoices[]`
  (`invoice_id`, `payment_amount`, `salesorder_id`) used for association
  verification.
- Sandbox recheck (2026-09-25, isolated account): read-only SO 68388 GET still
  reports `invoice_id: null`, not canceled; invoice list filtered by test customer
  returned one different SO (68384). This does **not** prove the earlier ambiguous
  invoice POST was unapplied. SO 68388 requires operator investigation and
  disposition; no retry, cancel or payment has been issued for it.
- A separate stocked item (43822/location 2, available 1) passed the full
  create → cancel → create → invoice 45939 → payment 16 Path 1 sandbox suite.
  SO 68389 canceled and stock restored; SO 68390 links invoice 45939, whose
  payment GET has one association (amount 1000). A second item/branch with
  quantity 2 (43842/location 7) confirmed SO 68391 cancellation, SO 68392 →
  invoice 45940, and a read-only payment 18 GET associated exactly once with
  that invoice and amount 2000. The second script output stopped while its
  payment GET was pending; the subsequent independent GET proves association,
  not that the second script completed its final assertions. No write to SO
  68388.
- Runtime cancel of an SO that already has an invoice **succeeds and reverses
  the stock** at the provider. Our gateway deliberately refuses cancel after
  an invoice exists (stricter than the runtime); the payment intent is
  never dispatched for a canceled SO.
- Error shapes: provider 500s return
  `{statusCode, error, message, code}`; the gateway classifies 5xx/timeouts as
  AMBIGUOUS (possibly applied) and 4xx as definitive rejections.

## Settlement pipeline

`settleJubelioSalesOrder` (apps/store/src/lib/jubelio-sales-settlement.ts)
runs invoice → payment → fulfillment. Guarantees:

- Duplicate webhooks + sweep race converge on the ledger: at most one
  conversion POST and one payment POST per order.
- Invoice verification checks active SO linkage, contact, branch, amounts and
  each item/quantity/price against the persisted create intent. Payment GET
  must contain exactly one invoice association with the expected amount; an
  empty or different association cannot unlock pickup. Gateway logs include
  HTTP metadata, not provider request/response bodies with customer PII.
- Any ambiguous or unverified invoice/payment keeps Midtrans's authoritative
  paid status, sets `fulfillment_blocked_reason`, blocks `ready_for_pickup`
  and pickup codes (verify-pickup refuses blocked orders), and surfaces the
  case in the admin review queue. No automatic retry, no auto-refund.
- Payment account: `JUBELIO_PAYMENT_ACCOUNT_ID` (real cash/bank account id;
  blank routes payments to manual review). `JUBELIO_PAYMENT_TYPE` is numeric
  (default 0).

## Sweep cron

`POST /api/cron/sweep-reservations` first finishes local accounting for
confirmed create/cancel operations, then reconciles in-flight SO operations by
persisted remote id + GET (cancel → confirm + release hold; invoice/payment →
GET-verify), resumes settlement for stuck paid orders, and expires stale
pending orders (the failure path cancels the SO pre-invoice). Aged unknown
dispatches without remote ids go to `manual_review`.

## Admin review queue

`GET /api/admin/reviews/sales-operations` [orders:view] lists manual-review
SO/invoice/payment operations and paid-but-blocked orders with remote ids,
reasons and timestamps. It is strictly read-only: operators investigate in
Jubelio using the remote ids; no blind writes. Order detail shows the remote
SO/invoice/payment ids and the block reason.