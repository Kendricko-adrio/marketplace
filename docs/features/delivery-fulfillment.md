# Delivery packing and booking

[Proof-approved booking release](delivery-follow-up.md#booking-ambiguity-and-proof-approved-release) is the only route to a new claim after a stable unknown outcome. At-most-once is per durable claim, not an unconditional lifetime limit. Attempts remain monotonic; release does not create a shipment and a new booking requires a separate approval. Without explicit provider confirmation that the original operation is closed without booking, remain held.

Admin order detail exposes delivery actions separately from pickup. `orders:view` uses existing Branch Scope for visibility. Each physical/action mutation additionally requires `orders:edit` and the current Home Branch matching the order branch, including owner/HQ with all-branch visibility. No Home Branch or an inactive/reassigned admin cannot act. Authorization, order row lock, eligibility and transaction audit are server-owned; UI hints are not authorization.

## Eligible packing

Only paid, processing, delivery orders without fulfillment blocking and with confirmed matching Jubelio invoice/payment operations are packable. Unpaid, failed/expired, pickup, broken snapshot, active SO cancellation and ambiguous settlement fail before any booking POST. A paid order can be packed after its *unpaid reservation TTL*: `expires_at` is not a delivery deadline.

Packing validates and persists the create request from the immutable snapshot. No current address book, SKU, branch complement or IT parameter is reread to replace it. Request uses the original parties, string ZIP/region IDs, frozen goods value/quantity/grams/cm and chosen courier/service. `ref_no` is the order ID for correlation **not provider idempotency**. Booking is non-COD, `shipping_insurance: 0`; no carton dimensions or `package_detail` are invented. An explicit valid zero quote is allowed, never a missing-rate fallback.

## One durable dispatch

`delivery_shipment` is unique per order. Packing and a `SHIPMENT_PACKED` audit are atomic. Booking locks/rechecks the order, conditionally moves packed → booking_dispatched, records actor/time/attempt, and **commits before** one `/shipments/create` POST. Concurrent callers/processes refuse without posting. The public factory requires a full database, not an outer transaction/savepoint.

A failure, malformed response or timeout after dispatch stays booking_unknown/manual hold, with a transaction audit. A process crash leaves booking_dispatched, also held. Neither is eligible for a blind retry. Known success persists AWB/Shipment ID, safe HTTP(S) tracking URL and a transaction `SHIPMENT_BOOKED` audit. Persistence failure after remote success leaves the durable intent held rather than creating again.

AWB is **not physical handoff or delivery**. Normal booking leaves paid/processing and does not produce a pickup code or Ready for Pickup instructions.

## Independent cost ledger

Approved `rates` Rp20,000, booking `price` Rp25,000 and billed `price_bill` Rp30,000 are three distinct values. The audit records booking delta Rp5,000 and billed delta Rp10,000. Differences do not block normal fulfillment and do not increase customer payment. Billed cost absent from create stays NULL/“Belum ada tagihan”; it is not zero or the quote. Missing billed cost triggers one read-only lookup of the known AWB after durable booking; failure leaves booking successful. [Tracking reconciliation and physical handoff](delivery-tracking.md) are separate lifecycle actions.

## Runtime and verification

Admin owns its Shipment adapter/logger/database instance, with separate `JUBELIO_SHIPMENT_*` credentials. No Omnichannel credentials or cross-app auth are reused. Token caching never extends the returned lifetime. HTTP timeout defaults to 10 seconds; there is no booking/auth retry. E2E requires bare loopback and rejects both NODE_ENV/APP_ENV production, with no live fallback. See [deployment readiness](../deployment-docs/shipment-readiness.md).

Real PostgreSQL tests (`shipment-fulfillment.db.test.ts`) cover eligibility, Home Branch, reassignment, confirmed invoice linkage, parallel service-instance claims, snapshot drift, zero-rate approval, ambiguity and audited independent fees. Transport tests verify token expiry and runtime isolation. `shipment-booking-mock.spec.ts` covers UI packing/booking, authorization, concurrent HTTP claims, separate cost display and held ambiguity using only isolated local providers. Seeder cleanup clears the ledger before orders/admin attribution. No live provider write or deployment is part of verification.
