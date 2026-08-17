# Order Flow (End-to-End)

## Purpose

End-to-end lifecycle of a customer order: checkout → Midtrans Snap payment →
webhook finalization → pickup → completion, plus the failure path and the
sweep-cron interplay. Companion docs: **`docs/features/stock-reservation.md`** (the
reservation model), **`docs/features/notifications.md`** (the `order_paid` admin
notification), **`docs/api-reference.md`** (endpoint contracts).

## State machine

`orders.status` (schema: `packages/db/src/schema/orders.ts`):

```
pending_payment ──(settlement webhook / sweep re-verify)──▶ processing ──▶ ready_for_pickup ──(admin verify-pickup)──▶ completed
      │
      └──(deny / cancel / expire webhook / sweep)──▶ failed_payment   (terminal)
```

| From | To | Trigger | Code |
|---|---|---|---|
| `pending_payment` / `pending` | `processing` / `paid` | settlement or capture+accept (webhook or sweep) | claim-guard in `claimAndFinalizePaidOrder` |
| `processing` / `paid` | `ready_for_pickup` + `pickupCode` | same transaction | `claimAndFinalizePaidOrder` |
| `ready_for_pickup` | `completed` | branch admin verifies pickup code | admin `verify-pickup` → store `/api/internal/order-complete` |
| `pending_payment` / `pending` | `failed_payment` / `failed` | deny / cancel / expire (webhook or sweep) | claim-guard in `claimAndFailOrder` |

- `paymentStatus`: `pending` → `paid` | `failed` (mirrors the terminal
  transitions above).
- `cancelled` is declared in the schema comment (manual cancellation) but no
  current code path writes it.
- `paymentFailureReason` + `midtransFailureStatus` are set on failure for
  human-readable + raw debugging.
- `expiresAt` = place-order time + `reservation.ttlMinutes` (default 30);
  drives the sweep cron and pairs with the Midtrans expiry.
- Index `idx_orders_status_expires` on `(status, expiresAt)` supports the sweep
  batch lookup.

## Happy path

1. **Place order** — `POST /api/checkout/place-order`
   (`apps/store/src/app/api/checkout/place-order/route.ts`), client session
   required. Validates body (`phone`, `email`, `pickupDate`, `pickupTime`,
   `selectedItemIds`), loads the user's cart, filters the selected items,
   enforces **single-branch checkout**, checks branch `status = "aktif"` +
   pickup slot (`validatePickupSlot`), soft stock pre-check, totals
   (`serviceFee = 0`, `total = subtotal`). A short transaction then:
   insert order (`pending_payment`/`pending`/`qris`, `expiresAt`), insert
   `order_item` rows, and atomic stock reservation per item. After commit,
   Midtrans Snap is created outside the transaction. A second short transaction
   persists `snapRedirectUrl` and deletes only the checked-out cart items.
   Gateway failure triggers compensation and preserves the cart. Returns
   `{ success, orderId, redirectUrl,
   token }`; customer is redirected to the Snap page.
2. **Pay** — customer completes QRIS payment on Midtrans Snap.
3. **Webhook** — `POST /api/webhooks/midtrans`
   (`apps/store/src/app/api/webhooks/midtrans/route.ts`):
   - Signature verification: `SHA512(order_id + status_code + gross_amount +
     serverKey)` (`verifyMidtransSignature`); invalid → 401.
   - Early skip if already terminal (`paymentStatus = "paid"` or
     `status = "failed_payment"`).
   - **Authoritative re-verify** via `getMidtransTransactionStatus`
     (`GET /v2/{order_id}/status`) to defend against spoofed callbacks. There
     is no payload fallback; provider errors return retryable non-2xx without
     mutating the order.
   - `settlement` / `capture`+`fraud=accept` → `claimAndFinalizePaidOrder`;
     `deny` / `cancel` / `expire` → `claimAndFailOrder` (reason via
     `describeFailureReason`); `pending` → no action.
   - Processing failures return non-2xx so Midtrans retries the notification.
4. **Finalize** — `claimAndFinalizePaidOrder`
   (`apps/store/src/lib/order-finalize.ts`): claim-guard UPDATE
   (`pending_payment`/`pending` → `processing`/`paid`; 0 rows → skip), convert
   reservation → real deduction (`stock` and `reservedStock` both conditionally
   decremented; inventory drift aborts the transaction), generate a
   collision-checked 6-char pickup code,
   `status → ready_for_pickup`, insert `order_paid` notification +
   `pg_notify('new_notification', …)` (see `docs/features/notifications.md`), send
   pickup-ready email (best-effort, outside the tx).
5. **Redirect to Snap** — the checkout page
   (`apps/store/src/app/checkout/page.tsx`) redirects the customer straight to
   the Midtrans Snap page (`window.location.href = data.redirectUrl`); no
   polling. After payment, Midtrans redirects back to the checkout result page
   (`apps/store/src/app/checkout/result/page.tsx`), which derives the outcome
   directly from Snap's query params (`transaction_status` → success /
   pending / cancel).
6. **Order-status endpoint (not consumed by UI)** — `GET
   /api/checkout/order-status?orderId=…`
   (`apps/store/src/app/api/checkout/order-status/route.ts`) exists: read-only
   DB lookup of `status` + `paymentStatus`, ownership-checked. No UI calls it
   (no polling) — the webhook remains the source of truth; the endpoint is
   still useful for debugging / manual polling.
7. **Pickup** — customer shows the pickup code; branch admin verifies it via
   `POST /api/admin/orders/{id}/verify-pickup`
   (`apps/admin/src/app/api/admin/orders/[id]/verify-pickup/route.ts`):
   branch-admin only (`withPermission(…, "orders", "edit")` + `getBranchScope`
   mode `own`; HQ is read-only per spec), order must belong to the admin's
   branch, must be `ready_for_pickup`, constant-time code comparison
   (`crypto.timingSafeEqual`; mismatch → 409). On match, calls the store's
   internal endpoint with an HMAC secret.
8. **Complete** — `POST /api/internal/order-complete`
   (`apps/store/src/app/api/internal/order-complete/route.ts`): admin→store
   auth via `secret = HMAC-SHA256(BETTER_AUTH_SECRET, orderId)` (shared secret
   between the two apps; mismatch → 403). Requires `ready_for_pickup`, sets
   `status = "completed"`, then schedules the order-completed email with
   Next.js `after()` so SMTP latency does not block the response. The
   admin route then writes an `audit_log` row (`VERIFY_PICKUP_CODE`).

## Failure path

- **Webhook failure** — `deny` / `cancel` / `expire` →
  `claimAndFailOrder`: claim-guard (`pending_payment` → `failed_payment`,
  `paymentStatus` → `failed`, reason + raw status stored), release
  `reservedStock` per item (**`stock` untouched**), send payment-failed email.
- **Sweep cron** — `POST /api/cron/sweep-reservations`
  (`apps/store/src/app/api/cron/sweep-reservations/route.ts`), auth
  `X-Cron-Secret` = `CRON_SECRET`. Safety-net for stale `pending_payment`
  orders (`expiresAt < now`, batch 100): re-verifies Midtrans status outside
  any tx → settled → `claimAndFinalizePaidOrder` (missed success webhook);
  otherwise best-effort `expireMidtransTransaction` (only if `pending`) then
  `claimAndFailOrder`. Transient Midtrans error → skip to the next run. Always
  returns 200. The claim-guard makes webhook-vs-sweep races safe: first to flip
  the order off `pending_payment` wins. See `docs/features/stock-reservation.md` and
  `docs/deployment-docs/cron-sweep.md`.
- **Place-order failures** — `InsufficientStockError` → 400 (tx rolled back,
  earlier reservations in the same tx released); Midtrans create failure → 502
  after compensating the committed reservation; cart rows remain available.

## Re-payment

`POST /api/payments/midtrans/create`
(`apps/store/src/app/api/payments/midtrans/create/route.ts`): client session,
order ownership check, **only `pending_payment` orders** (`failed_payment` is
final). Re-creates a Snap payment from the stored order items (plus a
`SERVICE_FEE` line item), persists the new `snapRedirectUrl`, returns
`{ redirectUrl, token }`. The existing reservation stays in place — no new
reservation is made.

## Emails

All order emails are **best-effort** (sent outside the tx; failures are logged
and never fail the request). Templates: `apps/store/src/lib/email-templates-order.ts`;
transport: `apps/store/src/lib/email.ts` (nodemailer, Gmail SMTP).

| # | Email | Sent when | Subject |
|---|---|---|---|
| 1 | Pickup-ready | `claimAndFinalizePaidOrder` (payment success) | `Your Order is Ready for Pickup — #XXXXXXXX` (includes pickup code, items, branch address, pickup time) |
| 2 | Order completed | `/api/internal/order-complete` (pickup verified) | `Your Order has been Completed — #XXXXXXXX` |
| 3 | Payment failed | `claimAndFailOrder` | `Pembayaran Gagal — #XXXXXXXX` (includes failure reason) |

## Pickup code

- 6-char uppercase alphanumeric from `CODE_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"` (no ambiguous `O/I/0/1`), generated in
  `claimAndFinalizePaidOrder` and collision-checked (up to 10 attempts) against
  orders with status `ready_for_pickup` / `completed`.
- Delivered to the customer via Email #1; exposed on the order detail API only
  when `status` is `ready_for_pickup` or `completed` (see `docs/api-reference.md`).

## RBAC / branch scope (admin)

- `verify-pickup`: permission `orders` + `edit`; only branch admins
  (`getBranchScope` mode `own`) may verify — HQ is read-only per spec. The
  order's `branchId` must equal the admin's branch.
- Notifications (`order_paid`): branch admin sees only their branch; HQ sees
  all (see `docs/features/notifications.md`).

## Logging

`apps/store/src/lib/logger.ts` — structured JSON logs, one line per record:
`timestamp`, `level`, `requestId`, `message`, plus bound context. `requestId`
honors an upstream `x-request-id` header (cross-service tracing) or generates a
fresh id; `.child({ orderId })` binds order context while keeping the same
`requestId`; `withRequestId` stamps the response header so clients can
reference it. Modules: `place-order`, `midtrans-webhook`, `order-finalize`,
`order-complete`, `admin-orders` (verify-pickup). `LOG_LEVEL` env controls the
minimum level (default `info`).

## Env

| Var | Used by | Purpose |
|---|---|---|
| `MIDTRANS_SERVER_KEY` / `MIDTRANS_CLIENT_KEY` | store | Snap creation, signature verification, status re-verify |
| `MIDTRANS_IS_PRODUCTION` | store | `true` → `api.midtrans.com`, else sandbox |
| `BETTER_AUTH_SECRET` | store + admin | HMAC for `/api/internal/order-complete`; must be **identical** in both apps (mismatch → 403) |
| `STORE_INTERNAL_URL` | admin | Base URL for the internal order-complete call (compose: `http://store:3000`) |
| `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | store | Order emails (Gmail App Password) |
| `CRON_SECRET` | store | Sweep cron auth (`X-Cron-Secret`) |
| `LOG_LEVEL` | store + admin | Minimum log level (`debug`/`info`/`warn`/`error`) |

## Invariants (do NOT violate)

- The Midtrans webhook is the **source of truth** for payment state;
  `order-status` is a read-only reflection of the DB.
- Only `pending_payment` orders can be claimed; the claim-guard UPDATE is the
  single arbiter of webhook-vs-sweep races — never bypass it with a plain
  read-modify-write.
- `failed_payment` is terminal — no re-payment, no re-claim.
- Paid orders are terminal — later failure callbacks are ignored (no refund
  reversal handling).
- Emails and notifications are best-effort side effects, always outside the
  claim transaction.
- `order_item` rows snapshot `productName`/`variantInfo`/`price` at
  place-order — never re-read from the catalog.
- Pickup verification requires branch-admin role + matching `branchId` +
  `ready_for_pickup` + constant-time code comparison.

## Verification

- **Sandbox happy path**: register → add to cart → checkout → pay sandbox QRIS
  → webhook finalizes → order `ready_for_pickup` with pickup code → Email #1
  arrives → admin verifies code → order `completed` + Email #2 + audit log row.
- **Failure path**: place order, don't pay, wait past TTL → order
  `failed_payment` with reason, `reservedStock` released, Email #3 arrives
  (via `expire` webhook or the sweep).
- **Re-payment**: with a `pending_payment` order, call
  `/api/payments/midtrans/create` → new Snap URL; attempt on a
  `failed_payment` order → 400.
- **Sweep**: `curl -X POST -H "X-Cron-Secret: $CRON_SECRET"
  https://<store-host>/api/cron/sweep-reservations` →
  `{"success":true,"scanned":N,"finalized":N,"failed":N}`; wrong/missing
  secret → 401/503.
- **Webhook replay**: re-POST the same settlement payload → 200 with
  `"Order already processed"`, no duplicate deduction/email/notification.
- **RBAC**: HQ user calling verify-pickup → 403; branch admin on another
  branch's order → 403; wrong code → 409.
- **Logs**: every step above appears as JSON lines with a shared `requestId`
  (and `orderId` where bound).
