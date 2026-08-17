# Stock Reservation (Checkout)

## Purpose

When a customer places an order, the requested units are **reserved** on
`branch_stock.reserved_stock` for the duration the customer is on the Midtrans
Snap payment page. The reservation converts into a real stock deduction on
payment success, or is released on payment failure/expiry. This document
describes the model, the reserve/release lifecycle, the safety-net sweep cron,
and the invariants that must never be violated. For the full order lifecycle
see **`docs/features/order-flow.md`**; for operational cron setup see
**`docs/deployment-docs/cron-sweep.md`**.

## Data model

Table: `branch_stock` (owned by `packages/db/src/schema/branches.ts`),
composite PK `(branchId, productVariantId)`.

| Column | Meaning | Written by |
|---|---|---|
| `stock` | Physical stock-on-hand (SOH) | Sync only (Jubelio import + webhook), and the finalizer's deduction on payment success |
| `reservedStock` | Units held by `pending_payment` orders | **Checkout runtime only** — never by sync |

**Available stock = `stock - reservedStock`.** `reservedStock` is a runtime
counter, not physical inventory.

## When a reservation is created (place-order)

`apps/store/src/app/api/checkout/place-order/route.ts` uses a two-phase flow so
no database transaction stays open during the Midtrans network request:

1. Insert `orders` row: `status = "pending_payment"`, `paymentStatus =
   "pending"`, `paymentMethod = "qris"`, `expiresAt = now + ttlMinutes * 60_000`.
2. Insert `order_item` rows (snapshot of `productName`, `variantInfo`, `price`,
   `quantity`).
3. **Atomic conditional UPDATE per item** (the authoritative, race-free guard):

   ```sql
   UPDATE branch_stock
   SET reserved_stock = reserved_stock + qty, updated_at = now()
   WHERE branch_id = ? AND product_variant_id = ?
     AND stock - reserved_stock >= qty
   ```

   If 0 rows match, `InsufficientStockError` is thrown → the whole transaction
   rolls back, releasing reservations made for earlier items in the same tx.
   No `FOR UPDATE` needed: two concurrent checkouts for the last unit produce
   one match and one miss.
4. Commit the reservation transaction, then call Midtrans Snap outside it.
5. If Midtrans creation fails, `claimAndFailOrder` compensates by releasing
   the reservation and preserves the selected cart rows.
6. On success, a short second transaction persists `snapRedirectUrl` and
   deletes only the checked-out `selectedItemIds`. If local persistence needs
   reconciliation, the valid gateway result is still returned.

A soft UX pre-check runs before the tx (`available = stock - reservedStock`;
`qty > available` → 400) — it is **not** the guard; the atomic UPDATE is.

## When a reservation is released

| Path | Trigger | Action |
|---|---|---|
| Midtrans `expire` webhook | Customer didn't pay in time | `claimAndFailOrder` → release `reservedStock` |
| Midtrans `deny` / `cancel` webhook | Payment denied/cancelled | `claimAndFailOrder` → release `reservedStock` |
| **Sweep cron** (safety-net) | `expiresAt < now` and no `expire` webhook arrived | Re-verify with Midtrans, then finalize or fail (below) |
| Payment success | `settlement` / `capture+accept` webhook (or sweep re-verify) | `claimAndFinalizePaidOrder` → reservation **converts** to real deduction |

### Sweep cron (`apps/store/src/app/api/cron/sweep-reservations/route.ts`)

- Auth: header `X-Cron-Secret` must equal `CRON_SECRET` (503 if unset, 401 on
  mismatch). Always returns 200 otherwise so the crontab log stays clean.
- Selects up to 100 stale orders (`status = "pending_payment"` AND
  `expiresAt < now()`, via index `idx_orders_status_expires`).
- For each order, re-verifies the Midtrans transaction status **outside any
  tx** (never holds DB locks across HTTP):
  - `settlement` / `capture`+`fraud=accept` → `claimAndFinalizePaidOrder`
    (a success webhook was likely missed).
  - anything else (`pending` / `expire` / `deny` / `cancel` / `not_found`) →
    best-effort `expireMidtransTransaction` (only when status is `pending`),
    then `claimAndFailOrder` with reason "Payment expired — order timed out
    (sweep)".
  - transient Midtrans error → `continue` (leave the order for the next run;
    never wrongly fail a paid-but-unreachable order).
- Idempotent: re-running over already-handled orders is a no-op.

## Claim-guard idempotency (`apps/store/src/lib/order-finalize.ts`)

Both finalizers start with a conditional UPDATE that only matches
`pending_payment` orders — the first caller to flip the status wins; the other
sees 0 rows and returns `{ claimed: false }` (no side effects). This makes the
webhook vs. sweep race safe.

| Finalizer | Claim-guard UPDATE | Then |
|---|---|---|
| `claimAndFinalizePaidOrder` | `status: pending_payment → processing`, `paymentStatus: pending → paid` | Per item: conditionally decrement `stock` and `reservedStock` only when both cover qty; drift throws and rolls back for retry/alert instead of silently clamping; generate collision-checked pickup code; `status → ready_for_pickup`; insert `order_paid` notification + `pg_notify`; send pickup-ready email (best-effort, outside tx) |
| `claimAndFailOrder` | `status: pending_payment → failed_payment`, `paymentStatus: pending → failed` (+ `paymentFailureReason`, `midtransFailureStatus`) | Per item: `reservedStock = GREATEST(0, reservedStock - qty)` — **`stock` untouched** (pending orders never deducted stock); send payment-failed email (best-effort, outside tx) |

The webhook additionally early-skips when `paymentStatus = "paid"` or
`status = "failed_payment"` to avoid a redundant Midtrans re-verify round-trip.

## TTL: `system_config` → in-memory cache

- Key `reservation.ttlMinutes` (type `number`, seeded default **30**) in
  `system_config` (`packages/db/src/schema/system.ts`).
- Read via `getConfigNumber("reservation.ttlMinutes", 30)` in
  `apps/store/src/lib/config.ts`: loaded **once** into an in-memory Map at app
  boot (lazy, shared-Promise so a burst of first callers doesn't stampede the
  DB; a failed load self-heals on next call).
- **SQL-only edit + restart to refresh**: there is no admin UI; change the
  value with `UPDATE system_config SET value = '45' WHERE key =
  'reservation.ttlMinutes';` then restart the store app. (`reloadConfig()`
  clears the cache for tests/manual ops only.)
- The same TTL is passed to Midtrans as the Snap expiry, so Midtrans
  auto-expires the transaction and fires an `expire` webhook at the same
  moment — the primary release path. Note: Midtrans recommends expiry ≥ 15
  minutes (shorter durations may be delayed by their scheduler).

## Env

| Var | Purpose | Default |
|---|---|---|
| `CRON_SECRET` | Auth for `POST /api/cron/sweep-reservations` (`X-Cron-Secret` header) | — (503 if unset) |

## Invariants (do NOT violate)

- **Sync never writes `reservedStock`.** Jubelio import/webhook writes
  only `stock` (see `docs/features/jubelio-sync.md`); `reservedStock` is
  checkout-managed exclusively.
- **The cart does not reserve.** Cart mutations never touch `reservedStock`;
  reservations only change at place-order (and are released by the finalizers).
- Pending orders hold a reservation only — they never deduct `stock`.
- Reservation release/deduction is clamped with `GREATEST(0, …)` to absorb
  drift; never allow `reservedStock` to go negative.
- `expiresAt` must pair with the Midtrans expiry so the reservation is released
  even if the `expire` webhook is missed (that is the sweep cron's job).
- Paid orders are terminal: refund/reversal after settlement is intentionally
  **not** handled — later failure callbacks are ignored.
- The sweep must re-verify with Midtrans **outside** any transaction and must
  never fail an order on a transient Midtrans error.

## Verification

- After a sync import: `SELECT COUNT(*) FROM branch_stock WHERE reserved_stock
  <> 0;` → `0` (sync never leaves reservations).
- Place an order (Midtrans sandbox) → `reserved_stock` increases by the ordered
  qty; order is `pending_payment` with `expires_at ≈ now + ttl`.
- Pay with sandbox QRIS → webhook finalizes: `stock` and `reservedStock` both
  decrease by qty; order `ready_for_pickup` with a 6-char pickup code.
- Don't pay and let the TTL elapse → order becomes `failed_payment` and
  `reservedStock` is released (via `expire` webhook, or the sweep if the
  webhook was missed).
- Manual sweep: `curl -X POST -H "X-Cron-Secret: $CRON_SECRET"
  https://<store-host>/api/cron/sweep-reservations` → `{"success":true,
  "scanned":N,"finalized":N,"failed":N}`.
- Race check: two concurrent checkouts for the last unit → exactly one 200,
  one 400 `InsufficientStockError`, and `reservedStock` never exceeds `stock`.
- TTL change: `UPDATE system_config ...` → restart store → new `expiresAt`
  values use the new TTL.
