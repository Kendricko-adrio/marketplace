# WMS + channel-status test result — 2026-09-26

Executed a bounded, owner-approved one-session test in 2026-09-26; the consumed test proposal was retired during scratch cleanup. Its gates required a verified, test-owned eligible WMS fixture before a WMS write and separately permitted a create-only INTERNAL channel-status comparison. The account was configured for `https://api2.jubelio.com` with test-account opt-in. This configuration and prior notes identify it as a test account; isolation from real commerce is **not independently proven** by the flag. Authentication via `POST /login` was used with token in memory only. Raw responses, credentials, names and token were not stored. No application code was changed.

## Phase A: WMS fixture preflight

- `GET /wms/sales/orders/empty-stock/?page=1&pageSize=50`: HTTP 200; `totalCount=0`.
- `GET /wms/sales/orders/failed-pick?page=1&pageSize=50`: HTTP 404; slash variant also HTTP 404. This is an API/access limitation, **not** proof that no failed-pick orders exist.
- `GET /wms/sales/orders/ready-to-process/?page=1&pageSize=50`: HTTP 200, `totalCount=38`; no clearly test-owned fixture in those returned rows.
- Existing test SOs 68394 and 68395 still have `wms_status=UNKNOWN`, `is_paid=null`, invoice IDs 45942/45943 and are **not** documented empty-stock/failed-pick fixtures. They were not modified.
- Test item 43842 at location 7 had on-hand 4, on-order 0, available 4. Provider omitted the `reserved` field (absent, not observed zero).

**Phase B skipped by the approved gate:** no verified, test-owned SO eligible for the documented recovery transition. No `POST /wms/sales/ready-to-process` was sent. There is no evidence from this run that the endpoint changes ordinary INTERNAL `UNKNOWN` SOs; a blind POST would not have tested the documented preconditions.

## Phase C: fresh, controlled INTERNAL SOs

Two new source-1 SOs with generic test contact, the same item 43842/location 7, one unit at 1000 each, and no invoice/payment. Each create POST was issued **once** and independently GET-confirmed. The retired one-shot script used a fail-if-journal-exists guard; the redacted [execution journal](channel-status-run.jsonl) contains returned IDs and observations, not response bodies or PII. The consumed approval grants no additional writes or cleanup.

| SO | Create input `channel_status` | Detail GET | Filtered sales-list GET | Other fields after create |
|---|---|---|---|---|
| 68396, control | omitted | `null` | `null` | `wms_status=UNKNOWN`, `is_paid=null`, `internal_status=null`, `invoice_id=null` |
| 68397, variant | `OKCIR_TEST_CREATED` | `OKCIR_TEST_CREATED` | `OKCIR_TEST_CREATED` | `wms_status=UNKNOWN`, `is_paid=null`, `internal_status=null`, `invoice_id=null` |

Neither SO appeared in the filtered `GET /wms/sales/orders/ready-to-process/`. Independent read-back confirmed both statuses after the one-shot run. Stock series changed `(on_hand,on_order,available)` from `(4,0,4)` to `(4,2,2)`. `reserved` stayed **absent** in the provider response; do not report it as zero. No invoice, payment, WMS write, SO edit, cancel, or cleanup POST was issued. These two open test SOs continue to occupy two units of `on_order`/availability in this account and require operator disposition if that stock must be restored; do not automatically cancel without a separately authorized, verified plan.

## Interpretation and limits

The account accepts an explicit `channel_status` string when creating an INTERNAL SO and preserves it on **API detail and list**. This is a plausible way to expose a **separate channel-status marker**, not a mechanism to change `wms_status` or `is_paid`. The vendor UI columns have **not** been independently inspected; the owner should check whether SO 68397 shows the marker in **Status Channel** while 68396 remains blank and both **Status Jubelio** columns remain `UNKNOWN`. Neither SO existed before the create POST; a Jubelio field cannot represent 'not yet created'. The application's durable create-operation ledger must still handle ambiguous creates. No automatic production workaround is approved by this experiment.

The WMS endpoint remains untested because its documented precondition was unavailable in this account. A safe WMS test would require a new, unambiguously test-owned *empty-stock* or *failed-pick* fixture plus review of how to produce/resolve it, or vendor support guidance; do not use an existing paid/customer SO as a shortcut.
