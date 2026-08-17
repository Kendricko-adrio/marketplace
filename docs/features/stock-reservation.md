# Jubelio-backed Stock Reservation

## Purpose

Checkout reserves inventory in Jubelio before a customer is allowed to open
Midtrans. This prevents the same units from being sold by a retail outlet or
another marketplace channel during the 15-minute payment window.

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
   returns HTTP 409; an ambiguous timeout returns HTTP 503. Both keep the user
   on checkout and no Midtrans transaction is created.

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

## Durable operation states

`jubelio_stock_operation` uses these states:

- `pending` — durable work not sent yet.
- `in_flight` — request may be in progress.
- `reconciling` — response was ambiguous; search Jubelio by note before doing
  anything else.
- `applied` — Jubelio confirmed the adjustment.
- `committed` — payment succeeded after a reserve.
- `failed` — reserve was definitively rejected.
- `manual_review` — release could not be confirmed safely.

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
`pending_remote_stock = reserved_stock` for pre-existing pending orders. Those
legacy orders have no durable Jubelio operation, so their success/failure
finalizers use the former local-only behavior until they become terminal.

## Invariants

- Never call Midtrans before the reserve operation is `applied`.
- Never subtract `reserved_stock` when calculating storefront availability.
- Never release local `reserved_stock` before Jubelio confirms the positive
  adjustment.
- Catalog sync never writes `reserved_stock` or `pending_remote_stock`.
- Cart changes do not reserve stock.
- Provider calls run outside DB transactions.
- A timeout after a POST is ambiguous and must be reconciled by note.

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
