# Delivery follow-up and manual resolution

## Scope and permissions

`/admin/orders/follow-up` is the single open-case area, linked from Orders. Its `Jenis Kendala` filter covers settlement, packing, booking and shipment issues. Completed orders never return to this queue. A physically handed-over booking without electronic progress is shown as pending evidence, not automatically declared late. Normal in-transit progress is not an issue by itself.

Reading requires `orders:view` and the server-derived Branch Scope. All-branch visibility does **not** permit an action outside the acting admin's current Home Branch. Every mutation requires `orders:edit`, an active current database admin, exact Home Branch, paid/processing delivery, no settlement block or packing-failure flag, matching confirmed SO/invoice/payment IDs and no active cancellation. The actor is share-locked and the order update-locked; audits commit with the mutation. Unknown/cross-Home orders are hidden; unauthorized and ineligible actions have no effects.

Implementation: `apps/admin/src/lib/delivery-follow-up.ts`. Browser-safe codes live separately in `delivery-follow-up-contract.ts` (no database imports into client UI).

## Packing cannot be fulfilled

Before any remote booking/dispatch, staff can choose one mandatory standard code:

- `physical_stock_unavailable` — physical stock unavailable.
- `damaged_goods` — damaged goods.
- `paid_service_limits_exceeded` — parcel exceeds the paid service's limits.

The order remains **processing/paid**, records `delivery_failure_code/at/by`, and enters packing follow-up. Normal packing, booking and handoff/reconciliation reject the flag. Settlement recovery never erases it. For example, discovering a damaged item after packing disables `Pesan pengiriman`; it does not refund, cancel the SO, roll back stock or send an email. Staff arrange any commercial resolution and customer communication **outside the app**.

## Booking ambiguity and proof-approved release

Timeout, HTTP 404, elapsed time, an empty dashboard result and `ref_no` are **not** proof that no booking exists. A live/crashed `booking_dispatched` remains held; it is not releasable through this action.

For `booking_unknown`, authorized staff must record an explicit provider/Jubelio confirmation that the **original request is closed and no booking exists**. This is a trusted, audited human attestation, not automatic GET inference. If certainty cannot be obtained, remain held and escalate outside the app.

```json
{"proof":{"source":"jubelio_confirmation","reference":"SUPPORT-CASE-123","reason":"Provider confirmed the original operation is closed without booking.","attemptNumber":1,"absenceConfirmed":true,"operationClosed":true}}
```

The current attempt must match. Release atomically changes unknown → packed and archives the original request/dispatch actor/time plus proof in `delivery_booking_reviews`, unique per shipment ledger and attempt. Attempt count is **monotonic**, never reset. Release performs **no provider POST**. A separate `Pesan pengiriman` approval makes one atomic claim for attempt 2. A second ambiguous outcome requires a new confirmation for attempt 2; stale/repeated proof and concurrent release losers are refused. Each claim is at-most-once; a new claim is allowed only following explicit proof-approved release, not a blind retry.

## Manual finish

`Selesaikan manual` requires a known, complete booked ledger and a nonblank reason, with either pre-completion `RETURNED`/`SHIPMENT_ISSUE`, physical handoff or verified `PICKED_UP`/`ON_DELIVERY` evidence. AWB alone, unknown booking, unpaid/unverified settlement and packing failure are not sufficient.

The action sets completed while preserving paid, records `delivery_manual_reason/at/by`, and audits the resolution. It neither invents DELIVERED/POD nor creates a pickup code. Later tracking can enrich safe evidence but cannot reopen the order or create an open follow-up. Internal reasons/actor IDs are removed from customer order DTOs. No refund, stock adjustment, SO cancellation, email or communication-log feature is introduced.

## System-only settlement recovery

Paid-but-blocked delivery recovery extends the existing `ensureJubelioInvoice/Payment` and settlement sweep with `readOnlyRecovery`. Known invoice/payment IDs are verified through GET against the frozen goods-only ledger, SO linkage, cancellation state and payment association. Only verified invoice/payment manual-review operations can be confirmed; create/cancel are never overridden.

For example, goods 100000 + shipping 20000 + website PPN 13200 = website 133200; recovery verifies Jubelio goods **100000**, not 133200. Unknown IDs, missing operations and mismatches remain held; recovery never records an intent or sends a provider POST. There is no admin “mark verified” action. Initial normal settlement and legacy pickup behavior are unchanged.

## HTTP contracts

- `GET /api/admin/orders/follow-up?kind=all|settlement|packing|booking|shipment` — scoped safe summaries, no raw provider errors.
- `POST /api/admin/orders/{id}/delivery/packing-failure` — strict `{reasonCode}`.
- `POST /api/admin/orders/{id}/delivery/release-booking` — strict `{proof}` above.
- `POST /api/admin/orders/{id}/delivery/finish-manually` — strict `{reason}`.

Invalid bodies return 400; missing edit permission 403; cross-Home/unknown 404; ineligible state/proof 409. Routes use structured contextual success/error logging without raw proof/customer payloads.

## Database and verification

Migration `0032_pretty_mandroid.sql` adds nullable order flags/evidence, review history and the nonnegative attempt constraint. The initially invalid, **unapplied** artifact was regenerated by Drizzle with explicit owner approval, not hand-edited. In local development, `db:push` retained the previous CHECK despite schema changes; the two generated DROP/ADD constraint statements were applied transactionally after inspecting `pg_constraint`. Deployment uses the normal generated migration, not dev push.

Real-PG tests cover scope, fresh Home authorization, matching settlement, failure guards, proof/archive/concurrent release, one approved attempt-2 POST and manual terminal safety. Mock Playwright covers list/filter, permission visibility, packing failure, zero automatic create on release and required-reason completion. Existing real-PG recovery tests cover known-ID GET recovery and missing-ID/no-intent safety. No live provider writes, remote deployment or operational courier activation were performed.
