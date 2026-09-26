# Jubelio Sales Order canary — isolated-account attempt (2026-09-23 UTC)

**Status: create + pre-invoice cancel completed in the owner-designated test account.** This is an operational evidence log, not a production contract. Do not put tokens, email addresses, passwords, or customer PII here.

## Authorization and boundary

- Owner states the credentials in root `.env` belong to a Jubelio test account isolated from production. This is an **owner attestation**, not independently proven from the API hostname (`api2.jubelio.com`).
- Owner explicitly authorized the agent to call `POST /login`, one `POST /sales/orders/` for **item_id 101187, location_id 15, qty 1**, and one `POST /sales/orders/cancel/` for **that SO only**, before any invoice exists; owner reports ops approved this test.
- No invoice, payment, stock adjustment, production write, or automatic retry is authorized. On an ambiguous POST, stop and reconcile with GET before any further write. No blind duplicate or cancel with a guessed SO ID.
- The unique SO note/reference is `OKCIR_SANDBOX_SO_CANARY_20260923T164813Z` (also the local operation key). The SO create used `salesorder_no: "[auto]"` per the documented schema. The owner explicitly overrode the plan's former operator-only write rule **for this bounded agent-executed canary only**; do not generalize that permission to further writes.

## Sanitized preflight reads (before SO create)

- `GET /locations/list` returned HTTP 500; candidate location was taken from `GET /inventory/` instead. Do not infer root cause from this observation.
- `GET /inventory/?q=4067902952284` identified item `101187`, location `15`; **T0** `on_hand=2`, `on_order=0`, `reserved=0`, `available=2`.
- `GET /inventory/items/to-sell/15?q=4067902952284`: matching item, unit `Buah`, `sell_price=1300000`, tax ID `1`, tax rate `0`.
- `GET /contacts/customers/?q=Umum` returned generic contact ID `-1` (`Pelanggan Umum`); no PII will be used.

## Results (sanitized; one item/location/quantity)

| Event | SO ID/status | on_hand | on_order | reserved | available | Notes |
|---|---|---:|---:|---:|---:|---|
| T0 before create | — | 2 | 0 | 0 | 2 | Fresh pre-write inventory GET; item/unit/price/tax and generic contact also rechecked. |
| T1 after create | `68378`, `SO-000068378`, invoice ID `null` | 2 | 1 | 0 | 1 | Exactly one SO create POST → HTTP 200 `{id: 68378}`; independent SO GET HTTP 200 confirmed ID, location 15, one item, generic contact; inventory GET afterward. |
| T2 after cancel | `68378`, `is_canceled: true`, invoice ID `null` | 2 | 0 | 0 | 2 | Exactly one cancel POST `{ids:[68378]}` → HTTP 200 `{status:"ok"}`; SO GET confirmed cancellation; inventory GET afterward. |

**Observed for this single test only:** SO create coincided with `on_order` +1 and `available` −1, without changing `on_hand` or `reserved`; confirmed pre-invoice cancel restored both. This supports, but does not prove universally, the previously unverified stock-transition hypothesis. Reads were sequential, not an atomic cross-time snapshot; unrelated concurrent changes remain a caveat. No invoice or payment call was made, so the settlement path and its stock effects remain unverified. No website DB/checkout state was tested; these are Jubelio API observations only.

## Follow-up read-only preflight (2026-09-24 UTC)

At the owner's request, the agent authenticated against the configured account and called Jubelio directly for read-only stock/item/contact preflight. No Sales Order, invoice, payment, stock adjustment, or other business write was sent. `GET /inventory/?q=4067902952284` returned item `101187` at location `15`: `on_hand=2`, `on_order=0`, `reserved=0`, `available=2`. `GET /inventory/items/to-sell/15?q=4067902952284` returned `{data,totalCount}`; the item exposed `sell_unit="Buah"`, `sell_tax_id=1`, `rate="0.00"`, `available_qty="2"`, and `sell_price="1300000.0000"`. `GET /contacts/customers/?q=Umum` returned HTTP **500** on two attempts; no current generic-contact result could be verified. This does not invalidate the old canary's historical `contact_id=-1`, but it blocks a *fresh* contact preflight for a new SO/invoice/payment canary. The owner reaffirmed that `.env` is a sandbox account and approved API testing; this is owner attestation, not independent cross-account evidence. No credential or contact PII was recorded.

The GET `/locations/list` HTTP 500 was **not** investigated as a code fix. The test used the location and stock data returned by `GET /inventory/`, and the SO GET independently confirmed location 15. Account isolation remains an owner attestation, not independently verified from the API hostname.
