# Jubelio-backed Stock Reservation

## Purpose

Checkout reserves inventory in Jubelio before a customer is allowed to open
Midtrans. This prevents the same units from being sold by a retail outlet or
another marketplace channel during the 15-minute payment window.

## Locked direct-adjustment lifecycle

The marketplace uses Jubelio inventory adjustments as a stock hold; it does
not create Jubelio Reserved Stock records or Sales Orders. This decision avoids
the Reserved Stock API's required `store_id` mapping while keeping Jubelio as
the on-hand source of truth.

| Lifecycle event | Jubelio action | Required local result |
|---|---|---|
| Checkout, before Midtrans | One negative adjustment for all order items | Confirm absolute on-hand, move `pending_remote_stock` to `reserved_stock`, then create Midtrans |
| Payment succeeds | No additional Jubelio write | Clear `reserved_stock`; the original negative adjustment remains committed |
| Payment initialization fails, or Midtrans reports `deny`, `cancel`, or `expire` | One compensating positive adjustment using the original reserve metadata | Clear `reserved_stock` only after remote confirmation |
| TTL sweep finds an unpaid order | Re-verify Midtrans, then perform the same positive compensation | Mark the order failed and keep stock hidden while compensation is unconfirmed |
| Settlement arrives after compensation | Re-acquire a race-safe local hold and send a new negative adjustment if stock is sufficient | Finalize as paid after confirmation; insufficient or ambiguous stock goes to manual review |

The lifecycle is fail-closed: no Midtrans transaction is created before the
initial negative adjustment is confirmed; no stock is exposed after a payment
failure before the positive adjustment is confirmed; and ambiguous writes are
reconciled by their unique note instead of being submitted blindly again.

The intended provider notes are:

- initial deduction: `OKCIR_RESERVE:<orderId>:<operationId>`;
- failed-payment compensation: `OKCIR_RELEASE:<orderId>:<operationId>`;
- late-settlement re-deduction:
  `OKCIR_REACQUIRE:<orderId>:<operationId>`.

Provider contract validation performed by development tooling is read-only.
Only the explicitly enabled production application may send stock-changing
adjustments. Live canary adjustments are operator-controlled, never executed by
an automated coding agent.

### Explicit non-goals

- Do not create Jubelio Reserved Stock records.
- Do not create Jubelio Sales Orders or other sales records.
- Do not deduct stock again when an ordinary pending order becomes paid.
- Do not treat a paid late settlement as a failed payment; unresolved stock is
  an operational manual-review case.

Late settlement is authoritatively re-verified with Midtrans. If release has
not started, its pending operation is cancelled and the original deduction is
committed. If release is confirmed, the application atomically acquires a local
hold and submits a prioritized `reacquire` adjustment. Unresolved writes,
missing snapshots, and insufficient stock are moved to `manual_review`.

## Read-only live contract verification

The production Jubelio account was verified using non-mutating calls only; no
`POST /inventory/adjustments/` request was sent. The observed contract is:

- `GET /systemsetting/account-mapping` returns adjustment accounts separately:
  `adjp_acct_id=75` (`7-7004 - Penyesuaian Persediaan Barang`) and
  `adjm_acct_id=72` (`8-8004 - Penyesuaian Persediaan Barang`).
- `GET /wms/default-bin/23` returns a valid location-specific `bin_id`.
- `POST /inventory/items/to-adjust/` with item IDs and `location_id` is a
  non-mutating batch lookup and returns exactly the requested item with
  `item_full_name`, `unit`, `cost`, `end_qty`, and `resulting_qty`; it replaces
  the former paginated metadata scan.
- The `account_id` returned by `items/to-adjust` is the inventory asset account
  (`1-1200 - Persediaan Barang` in the verified response), not the adjustment
  offset account. Adjustment payloads must therefore use the plus/minus IDs
  from `systemsetting/account-mapping`.
- `POST /inventory/items/all-stocks/` is a non-mutating batch lookup and returns
  location-specific on-hand and available stock.

The verified item returned its `cost` as the numeric string `1.0000...` while
its on-hand quantity was `2`. This value must be confirmed against Jubelio's
inventory valuation before enabling live writes: the gateway must preserve the
provider value exactly for a reserve/release pair, but code must not silently
replace a suspicious provider cost with product selling price or a guessed
fallback.

## Counters and availability

`branch_stock` owns three counters:

| Column | Meaning |
|---|---|
| `stock` | Last confirmed Jubelio on-hand value |
| `pending_remote_stock` | Local hold while the outcome of the Jubelio write is not yet confirmed |
| `reserved_stock` | Jubelio deduction confirmed, but payment is not terminal yet |

Storefront availability is `stock - pending_remote_stock`. Confirmed
reservations are already included in Jubelio's reduced `stock`, so subtracting
`reserved_stock` again would double-count them.

## Checkout flow

1. A short DB transaction creates the order and items, atomically increments
   `pending_remote_stock`, and inserts a unique `reserve` row into
   `jubelio_stock_operation`.
2. Outside the transaction, the gateway sends
   `POST /inventory/adjustments/` with a negative `qty_in_base` for every item.
3. After a successful response, the gateway reads absolute stock from
   `POST /inventory/items/all-stocks/`. In one DB transaction it replaces
   local `stock`, decreases `pending_remote_stock`, increases
   `reserved_stock`, and marks the operation `applied`.
4. Only then is the Midtrans transaction created. A rejected Jubelio write
   returns HTTP 409; an ambiguous timeout or local provider backpressure
   returns HTTP 503. All keep the user on checkout and no Midtrans transaction
   is created.

Provider requests share one process-wide priority queue and one default gateway.
Request starts default to 450/minute with at most 10 concurrent requests.
Release work has priority 10, reconciliation reads priority 5, and new checkout
reserve work priority 0. A queue-full or queue-wait timeout happens before
`fetch`: reserve releases its local pending hold, while release remains queued
for durable reconciliation. Such a rejection is never treated as an ambiguous
Jubelio write.

The adjustment note is the idempotency/reconciliation key:
`OKCIR_RESERVE:<orderId>:<operationId>`.

## Terminal flows

| Event | Jubelio action | Local action |
|---|---|---|
| Payment succeeds | None; the negative adjustment remains | Decrease only `reserved_stock`; mark reserve operation `committed` |
| Payment fails, is denied/cancelled, or expires | Send a compensating positive adjustment | After confirmation, replace `stock` with Jubelio on-hand and decrease `reserved_stock` |
| Release result is unknown | Do not expose the stock | Keep `reserved_stock`; reconcile by unique note |

The release note is `OKCIR_RELEASE:<orderId>:<operationId>`. A payment-failed
order is terminal immediately, but its stock remains unavailable until the
positive adjustment is confirmed.

Before the initial adjustment POST, the durable reserve payload is enriched
with a provider snapshot for each item: description, unit, cost, default bin,
plus-account ID, and minus-account ID. Compensation uses this snapshot and does
not read current item metadata again. Persisting the snapshot is part of
preflight; if persistence fails, no adjustment request is sent. This guarantees
that a reserve/release pair uses the same valuation and unit even if Jubelio
master data changes during the payment TTL.

## Durable operation states

`jubelio_stock_operation` uses these states:

- `pending` — durable work not sent yet.
- `in_flight` — request may be in progress.
- `reconciling` — response was ambiguous; search Jubelio by note before doing
  anything else.
- `applied` — Jubelio confirmed the adjustment.
- `committed` — payment succeeded after a reserve.
- `failed` — reserve was definitively rejected.
- `manual_review` — release or late-settlement re-acquisition could not be
  confirmed safely.

Admin order detail shows every operation, remote adjustment ID, attempts, and
last error. Users with `orders:edit` can choose **Recheck safely**, which moves a
manual-review operation to `reconciling`; it never writes stock and only asks
the sweep to search Jubelio by the existing note.

The sweep cron processes both expired orders and due stock operations. It never
blindly repeats an ambiguous adjustment because that could double-decrement or
double-restore stock. It first searches recent Jubelio adjustments by note and
then verifies absolute stock.

## 15-minute TTL

`system_config.reservation.ttlMinutes` is seeded to `15`. It is used for both
`orders.expires_at` and Midtrans expiry. The value is cached by the store app;
restart the store after changing it.

## Environment safety

All environments except `APP_ENV=production` are forced to
`JUBELIO_MOCK_API_BASE_URL`, even if `NODE_ENV=production` and a live URL is
present. Live writes additionally require all of:

- `APP_ENV=production`
- `NODE_ENV=production`
- `JUBELIO_STOCK_WRITES_ENABLED=true`
- `JUBELIO_API_BASE_URL=https://api2.jubelio.com`

If the safety gate is closed, checkout fails before Midtrans and releases its
local pending hold.

## Migration compatibility

Migration `0013_absurd_vampiro.sql` initializes
`pending_remote_stock = reserved_stock` for pre-existing pending orders and
adds the initial durable operation table. Migration `0015_fixed_hiroim.sql`
extends the operation constraint with the late-settlement `reacquire` type.
Both must be applied before enabling live writes. Those legacy orders have no
durable Jubelio operation, so their success/failure finalizers use the former
local-only behavior until they become terminal.

Production preflight, canary, monitoring, and kill-switch recovery are defined
in
[`docs/deployment-docs/stock-adjustment-rollout.md`](../deployment-docs/stock-adjustment-rollout.md).

## Invariants

- Never call Midtrans before the reserve operation is `applied`.
- Never subtract `reserved_stock` when calculating storefront availability.
- Never release local `reserved_stock` before Jubelio confirms the positive
  adjustment.
- Persist adjustment metadata before the first POST and reuse it for release;
  never silently replace a missing provider cost or unit with guessed values.
- Catalog sync never writes `reserved_stock` or `pending_remote_stock`.
- Cart changes do not reserve stock.
- Provider calls run outside DB transactions.
- A timeout after a POST is ambiguous and must be reconciled by note.
- A local queue timeout occurs before a POST and is definitive; never reconcile
  it as though Jubelio may have applied the adjustment.

## Operational logging

Checkout and stock writes use the store structured logger. The same
`requestId` is returned in the `x-request-id` response header and is carried
through the checkout request, durable Jubelio operation, and reconciliation
cron. Stock events also include `orderId`, `operationId`, `kind` (`reserve` or
`release`), `locationId`, and the operation attempt count; quantities and
customer contact details are not logged.

Important messages to query are:

- `local stock hold created` — the race-safe local `pending_remote_stock` hold
  was created.
- `Jubelio stock adjustment requested`, `... applied`, or `... rejected` — the
  remote provider boundary and its result.
- `Jubelio stock operation applied locally` — absolute Jubelio on-hand was
  copied back and local counters were moved to the confirmed state.
- `Jubelio stock operation deferred` — the operation remains reconciling or
  requires manual review.
- `Jubelio stock reconciliation completed` — cron summary with scanned,
  applied, failed, and pending counts.

At the HTTP boundary, `Jubelio HTTP request started` contains the method,
relative endpoint, and sanitized request body. `Jubelio HTTP response received`
contains the status and duration, followed by `Jubelio HTTP response output`
with the sanitized response body. Network, timeout, and fetch errors are logged
as `Jubelio HTTP request failed` with endpoint and duration. Authentication
headers, passwords, tokens, cookies, and secrets are always redacted.

## Verification

- Start `npm run dev:store`; this also starts the local mock on port 3002.
- Place one unit from stock 10: mock/local on-hand becomes 9,
  `reserved_stock=1`, `pending_remote_stock=0`, then Midtrans is created.
- Set mock scenario `insufficient-stock`: checkout shows a stock error and
  does not navigate to Midtrans.
- Expire/fail the order: a positive adjustment restores on-hand to 10 and
  `reserved_stock` returns to 0.
- Set `timeout-after-apply`: the order fails closed; the sweep finds the
  adjustment by note and later queues the compensating release.
