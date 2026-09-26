# Jubelio Sales API Migration — Research Plan (Direct Adjustments → Settlement-Path Selection)

## 1. Status / Scope

**Status: research/documentation only.** This document proposes a decision (a settlement-path strategy for Jubelio sales operations) and **implements nothing**: no code changes, no configuration changes, no production writes, and no changes to any other document.

Everything here is a plan and an evidence ledger. The only artifacts of this work are this file and, later, canary observations gathered under the constraints in §5 and §14.

- [Official] Scope statement (this section): documentation-only, decision-proposing.

## 2. Evidence taxonomy

Every factual claim in this document carries exactly one of these tags:

- **[Official]** — claims taken from first-party published documentation: `https://docs-wms.jubelio.com/` and its OpenAPI specification `https://docs-wms.jubelio.com/dist.yaml`. These describe endpoint shapes, fields, and semantics as published.
- **[Sanitized live read-only]** — claims from non-mutating production reads (GET/list/read endpoints only), with sensitive data sanitized before recording. The allowed set is **exhaustively enumerated in §5**; nothing outside that list may be cited as a live fact.
- **[Hypothesis]** — everything else: inference, extrapolation, schema-derived assumptions, unobserved behavior. Hypothesis-only claims **must be phrased as questions or options, never as facts**.

Rule: a claim without a tag is a documentation defect. A "live fact" not present in §5 is a defect of the worst kind and must be demoted to hypothesis or removed.

### 2.1 Evidence tiers (used by the flow comparison in §17–§21)

The flow-comparison sections added at the end of this document (§17–§21) additionally classify every claim into one of three evidence tiers. A claim carries exactly one tag **and** exactly one tier; the two are never silently mixed. Mapping:

| Tier | Meaning | Maps to existing tag(s) |
|---|---|---|
| **Tier 1 — repository-confirmed** | Verifiable in this repository's own records and docs: lifecycle events, exact endpoint lists, local stock counters (`stock`, `reserved_stock`, `pending_remote_stock`), the settlement-path rule (§7). Sources: this document, [`./stock-reservation.md`](./stock-reservation.md), [`./order-flow.md`](./order-flow.md), [`./jubelio-sync.md`](./jubelio-sync.md), [`../jubelio-api/README.md`](../jubelio-api/README.md). | [Official — repo documentation], [Sanitized live read-only] (§5) |
| **Tier 2 — externally documented** | First-party published material: the official API documentation site and OpenAPI spec (`https://docs-wms.jubelio.com/`, `https://docs-wms.jubelio.com/dist.yaml`; `https://docs.jubelio.com/` is an alias that redirects there — see §16), the Jubelio T&C, and Jubelio product pages (inventory, orders). Concretely: the published stock model exposing `on_hand` / `on_order` / reserved with `available = on_hand − on_order − reserved`; the adjustments endpoint `POST /inventory/adjustments/` (the only adjustment write path **defined in the spec's path table**; the Inventory overview prose additionally mentions a `POST /inventory/adjustments/warehouse`, but that path is **not** a defined OpenAPI path — §16 item 2) that mutates `on_hand`; asynchronous channel sync and the associated oversell caveat in the T&C. | [Official] |
| **Tier 3 — staging hypothesis / unknown** | Everything else — including **when (and whether) SO creation moves any Jubelio stock series** (§5, observation 8) and any behavior that only a live write or staging observation could establish. Hypothesis-only claims stay phrased as questions/options. | [Hypothesis] |

Defect rule (restated for the tiers): a claim without exactly one tier is a documentation defect, same as a claim without a tag.

### 2.2 Tag-spelling variants used in this document

The tags above appear in several spellings across this document (§3, §4, §9, §17–§21). This table consolidates the variants actually used and states which are equivalent:

| Variant spelling | Status |
|---|---|
| `[Official]` | Base external-documentation tag; for published API material it maps to **Tier 2**. |
| `[Official — repo documentation]` (incl. the refinement `… as design decision(s)`) | Equivalent variant for claims grounded in in-repo records/docs; maps to **Tier 1**. |
| `[Sanitized live read-only]` | Live-observation tag, valid **only** inside §5's closed list; maps to **Tier 1**. |
| `[Hypothesis]` | Maps to **Tier 3**. |
| `[Tier 1]` / `[Tier 2]` / `[Tier 3]` | Tier-only shorthand used in the §17–§21 tables, where a column header or surrounding sentence fixes the tag half. |

Rule (restated): every claim carries **exactly one tag and exactly one tier**. Combined forms such as `[Official / Tier 2]` or `[Hypothesis / Tier 3]` spell both halves in one cell and are acceptable; anywhere else, a cell that fixes a tier without a tag — or vice versa, outside the fixed-context cases listed above — is a defect (§2.1).

## 3. Current repo direct-adjustment lifecycle

**[Official — repo documentation]** Today, inventory corrections flow through a **direct-adjustment** lifecycle built on Jubelio's `stock=on_hand` semantics:

- A **negative adjustment** (shrinkage, damage, correction) reduces `on_hand` at the location directly. Critically, the legacy implementation already applied this reduction to `on_hand`; the corresponding `reservedStock` ledger entry is a historical record of that movement and **must not be subtracted from stock again** — doing so double-counts the same adjustment (see §9).
- A **positive adjustment** adds back to `on_hand` in the same direct manner.

Related in-repo documentation (all **[Official — repo documentation]**):

- Reservation model: [`./stock-reservation.md`](./stock-reservation.md)
- Order lifecycle: [`./order-flow.md`](./order-flow.md)
- Jubelio synchronization: [`./jubelio-sync.md`](./jubelio-sync.md)
- Jubelio API overview: [`../jubelio-api/README.md`](../jubelio-api/README.md)

[Hypothesis] Is the direct-adjustment path sufficient for all future sellable-stock needs, or do Sales Orders give materially better observability/control? (This is the question this research exists to answer; see §6.)

## 4. Official endpoint/schema matrix

All items in this section are **[Official]**, sourced only from:

- `https://docs-wms.jubelio.com/`
- `https://docs-wms.jubelio.com/dist.yaml`

Tier mapping (§2.1): endpoint/field **existence and shapes** in this section are **Tier 2 (externally documented)**. **Semantics and live behavior** (when stock moves, retry/idempotency behavior, whether the endpoint accepts our integration) are **Tier 3** unless stated otherwise. For §4.1–4.3 specifically, the field lists are **repo-captured** from the in-repo spec copy [`../jubelio-api/dist.yaml`](../jubelio-api/dist.yaml) and were verified during this documentation update to match the live official spec (§16) — they are treated as a **candidate contract**: documented existence is Tier 2, but operational usability and any stock effect remain unverified and require **live Swagger / staging verification** (§5, observations 7–8; §18). Editorial decision (recorded here): these lists enumerate the schema's `required:` arrays — the **minimum required fields, not full schemas** (§4.1's list matches the `required:` array of `saveSalesOrderRequest` exactly).

**Schema-completeness caveat:** official response schemas may document less than the runtime actually returns; any runtime field beyond what a schema documents is **canary evidence only, never part of the contract**. For invoice conversion this caveat is now settled at the documentation level: the fresh official spec (re-verified this update, §16 item 2) documents `createInvoiceResponse` as `{status, id}` — `status` (string, example `ok`, with the odd description *"Delete Status"*, likely copy-paste residue in the spec itself; treat that *description* with suspicion, not the field's existence) and `id` (**number**, description *"Sales Invoice Number"*, example 8). Runtime behavior — including whether `id` is returned as documented and really identifies the created invoice — still needs sandbox validation and remains Tier 3 (§18).

### 4.1 Sales Order (SO) header fields — repo-captured candidate contract (Tier 2 existence; Tier 3 semantics)

`salesorder_id`, `salesorder_no`, `contact_id`, `customer_name`, `transaction_date`, `sub_total`, `total_disc`, `total_tax`, `grand_total`, `location_id`, `source`, `add_fee`, `add_disc`, `service_fee`, `items`

### 4.2 SO item fields — repo-captured candidate contract (same evidence status as §4.1)

`salesorder_detail_id`, `item_id`, `tax_id`, `price`, `unit`, `qty_in_base`, `disc`, `disc_amount`, `tax_amount`, `amount`, `location_id`

### 4.3 SO create response — repo-captured candidate contract (same evidence status as §4.1)

`{id}`

### 4.4 Explicit payment fields

**Minimum required fields, not full schemas.** The header list below enumerates the schema's `required:` entries for `saveSalesPaymentRequest` — a minimum required set, not the complete property inventory.

Header (the `required:` array, exactly): `account_id`, `amount`, `contact_id`, `payment_id`, `payment_no`, `payment_type`

`items` is **optional** in the schema — it is **not** part of the top-level `required:` array. When items are provided, the item object schema defines: `invoice_id` (Invoice ID), `payment_amount` (Invoice Amount), and `payment_detail_id` (Payment Detail ID — verified present inside the payment `items` schema in [`../jubelio-api/dist.yaml`](../jubelio-api/dist.yaml), `saveSalesPaymentRequest`, and optional). The item object carries no `required:` array of its own in the official schema, so item-level field requirements are **unasserted by the schema**; any runtime-observed extra item fields are canary evidence, not contract (§4 note).

### 4.5 Sales Order, payment, and packlist endpoints

Write endpoints ([Official / Tier 2] existence and shapes; [Hypothesis / Tier 3] semantics):

- `POST /sales/orders/` (`postSalesOrders` — "Create/Edit Sales Order"; request schema `saveSalesOrderRequest`, response schema `saveID` → `{id}`) — Sales Order create/edit.
- `POST /sales/orders/cancel/` (`cancelSalesOrder`; request schema `cancelOrderRequest`, body `{ids:[...]}` — an array of **1–200** Sales Order IDs; schema constrains `minItems: 1`, `maxItems: 200`) — cancel Sales Orders. This is a **Sales Order** endpoint, not a packlist endpoint.
- `/sales/packlists/create-invoice` — create an invoice from a packlist; request `createInvoiceRequest` (`{salesorder_id}`), response `createInvoiceResponse` = **`{status, id}`** (`id` = **Sales Invoice Number**, number, example 8 — §16 item 2). **Do not confuse the two `id` fields:** the SO create response `saveID.id` (§4.3) is the **Sales Order ID**; `createInvoiceResponse.id` is the **Sales Invoice Number** of the invoice produced from that order. §7's Path 1 persists this `id` and independently verifies it via the documented invoice read below before any payment call (§7, §10.2).
- `/sales/packlists/create-invoice-payment` — create invoice and payment together; response `createInvoiceResponse` = the same **`{status, id}`**, where `id` identifies the **Sales Invoice Number** — **not** a payment ID. §7's Path 2 combines the invoice leg and the payment leg in one call: after Path 2, do **not** treat the returned `id` as a payment identifier and do **not** call `/sales/payments/` afterward (§7, §19).
- `POST /sales/orders/set-as-paid` (`setAsPaid` — "Set Sales Order as Paid"; request schema `salesorderIdsRequest`) — **documented in the endpoint landscape but explicitly excluded from Strategy B for now**: it is **not** assumed equivalent to invoice/payment creation or to stock posting, and it requires sandbox evidence before any use is considered (§18). [Tier 2] existence; [Tier 3] semantics.
- `POST /sales/payments/` (`postSalesPayments` — **"Create/Edit Invoice Payment"**; request schema `saveSalesPaymentRequest`, §4.4 fields; response `saveOK`) — explicit standalone invoice payment creation/edit.

Verification-GET endpoints (read-only; the canary observation contract — §18, §21.3):

- `GET /sales/orders/{id}` (`getSalesOrdersId` — "Get Sales Order") — read a single Sales Order.
- `GET /sales/payments/{id}` — read a single invoice payment.
- **`GET /sales/invoices/{id}`** (`getSalesInvoicesId` — "Get Invoice"; path parameter `id`, response `getInvoiceResponse`) — read a single invoice. This is the **documented independent verification read** for the invoice `id` returned by invoice conversion (§7, §10.2, §18 step 5).
- **`GET /sales/invoices/unpaid/`** (`getSalesInvoicesUnpaid` — "Get All 'Outstanding' Invoices"; paginated `page`/`pageSize`/`sortBy`/`q` parameters, response `getInvoicesResponse`) — list outstanding invoices; useful for reconciliation cross-checks after invoice conversion (§18 step 5).
- `GET /inventory/` (`getInventory` — "Get All Products Stock"; supports `page`, `pageSize` (camelCase), `q`, and sort parameters) — the stock-series snapshot read used for canary snapshots.
- **`GET /sales/v2/orders/`** (`getSalesV2Orders` — "Get all sales orders (V2)", paginated list/search) — [Official / Tier 2]: present in the fresh official spec, with `page` and `page_size` (snake_case) both **required** query parameters (plus `q`). The in-repo spec copy [`../jubelio-api/dist.yaml`](../jubelio-api/dist.yaml) is **stale and missing this endpoint** (§16 item 6); its Tier-2 status rests on the official spec alone.

Note — `GET /locations/list` (used by the repo's runtime flows, §17.2) is **Tier-1 repository/live-verified** behavior ([Sanitized live read-only], §5 observation 1) but is **not documented as a path in the current official spec**, which documents `GET /locations/` (`getLocations`). It must not be cited as [Official / Tier 2].

[Official / Tier 2] The above field lists are reproduced verbatim from the first-party schema. [Hypothesis / Tier 3] Semantics beyond the published names (e.g., when stock is reserved, whether `qty_in_base` is the reservation unit) are **not** established by these sources — see §5 (nothing observed) and §15.

## 5. Sanitized observations

This section is the **exhaustive, closed list** of live claims. Nothing outside it may be stated as a live fact anywhere in this document. All items are **[Sanitized live read-only]** unless noted; no production write was performed.

1. 25 `/locations/list` results were retrieved (sanitized).
2. `/locations/` returns **500**.
3. The generic contact is `-1` and carries no email or phone.
4. The all-stocks read exposes `on_hand`, `on_order`, and `available`.
5. A 2,500-item sample had **zero** positive `on_order` values.
6. Sampled recent invoices show **no tax**.
7. **No production write test was performed.**
8. **No SO stock transition was observed.**

Explicit non-claims (guardrails derived from the list above):

- [Hypothesis] "SO creation reserves stock at `location_id`" — **not observed**; remains an open question (§15).
- [Hypothesis] Invoice/payment call behavior under concurrency or retry — **not observed** (schema-inferred only).
- [Hypothesis] Absence of sampled tax may reflect sample composition, not API reality — do not conclude "Jubelio invoices are untaxed."

## 6. Strategy comparison

Three candidate strategies. A and B rest on [Official] schema knowledge plus the [Sanitized live read-only] observations of §5; C is largely [Hypothesis].

### Strategy A — direct invoice after settlement (single-step packlist invoice)

Settle first, then call `/sales/packlists/create-invoice-payment` once, or settle and call `/sales/packlists/create-invoice` for the invoice leg only.

- [Official] Endpoints and schemas exist as documented (§4.5).
- [Hypothesis] Fewest moving parts — but also the least granular observability: one call performs two logically distinct effects (invoice + payment), and failure recovery between those effects is opaque from schema alone.

### Strategy B — pre-payment Sales Order (provisional)

1. Create SO (response `{id}` per §4.3) — [Official].
2. Settle (payment received out-of-band) — [Official] process assumption.
3. Call `/sales/packlists/create-invoice` to produce the invoice — [Official].
4. **Payment step — gated, not blocked.** `/sales/payments/` (§4.4 fields) may be called only after the invoice `id` returned by `createInvoiceResponse` (the **Sales Invoice Number**, §4.5) is **persisted** and **independently verified** through the documented invoice read `GET /sales/invoices/{id}` (§4.5, §7, §10.2). This stricter verification gate is **deliberate safety policy** — the response *does* document an ID; the gate exists to catch ambiguity and duplication, not to compensate for a missing ID. If verification is ambiguous, **stop before payment** and route to manual reconciliation/review; "latest invoice" guesses and blind payment calls remain prohibited. [Official] payment schema and invoice GET; [Hypothesis] runtime semantics (sandbox validation pending, §18) and whether the optional step is ever beneficial.

**B is provisional**, pending canary evidence per §14. It is not promoted on schema strength alone.

### Strategy C — full WMS flow

Adopt Jubelio's full WMS order pipeline (packlist as a first-class workflow object, status-driven transitions).

- [Hypothesis] Would give the highest observability and match the vendor's intended flow.
- [Hypothesis] Highest integration cost and the largest unobserved surface; cannot be evaluated without canary-grade read evidence we do not yet have.

Current standing: **B is the provisional working choice**; A remains a simpler fallback; C is a long-shot option. Promotion between them happens only through §14.

## 7. Critical settlement correctness rule

> **⚠️ CRITICAL — SETTLEMENT PATH CORRECTNESS**
>
> On active SO settlement, choose **exactly one** path:
>
> - **Path 1:** `/sales/packlists/create-invoice` → the response documents **`{status, id}`**, where `id` is the **Sales Invoice Number** (distinct from the SO `saveID.id`, which is the Sales Order ID — §4.5) → **persist that `id`** → **independently verify it** via the documented invoice read `GET /sales/invoices/{id}` (§4.5) → only then, and optionally, `POST /sales/payments/`. The verification gate is **deliberate safety policy** (defense against ambiguity/duplication), **not** a workaround for a missing ID. If verification is ambiguous, **stop before payment** and route to **manual review**; **never guess** an invoice (e.g., "latest invoice") and **never blind-call** the payment endpoint; **or**
> - **Path 2:** `/sales/packlists/create-invoice-payment` — its `createInvoiceResponse` `{status, id}` identifies the **Sales Invoice Number** (not a payment ID); do **not** call `/sales/payments/` afterward and do **not** treat the `id` as a payment identifier.
>
> **Never call both** for the same order/settlement.
>
> **Cancellation is allowed only before an invoice exists; never cancel after an invoice exists.**
>
> On failure or expiry (pre-invoice), cancellation may proceed via `POST /sales/orders/cancel/` with body `{ids:[...]}` (1–200 IDs; §4.5). After settlement on a **confirmed** cancel, the default disposition is **manual review** — no automatic retry or re-settlement.

This rule is a hard invariant, not a preference. It is enforced operationally by §10 (persisted operation records, invoice-ID proof gate) and validated by the canary gates in §14 (zero duplicate payment attempts).

## 8. Target event matrix

**Consolidated into §19.** This section previously carried its own event table. To keep exactly one authoritative old-vs-new comparison in this document, that table was folded into the single event-by-event matrix of §19 (which also absorbs the former §20 endpoint matrix); §19 is now the only old-vs-new table to cite. The invariants this section expressed — one invoice path, cancel pre-invoice only, no double-charge retries — remain stated in §7 and enforced by §10.

[Official] Endpoint names/fields; [Hypothesis] all timing/behavior nuances not covered by §5.

## 9. Stock/accounting model and double-count hazards

- Current semantics: `stock=on_hand` — [Sanitized live read-only] (observation 4: `on_hand`, `on_order`, `available` are exposed) and [Official — repo documentation] (§3).
- **Double-count hazard (primary):** the legacy negative adjustment **already reduced `on_hand`**. Its `reservedStock` ledger entry is a record, not an outstanding liability — subtracting it again from stock **double-counts** the adjustment. [Official — repo documentation].
- **Mitigation 1:** track SO holds in a **separate ledger**, never folded into the legacy `reservedStock` series. [Official — repo documentation as design rule]; [Hypothesis] that Jubelio SOs do not also write into `reservedStock` (nothing observed — §5, observation 8).
- **Mitigation 2:** reconcile all four series **from the same snapshot**: `on_hand`, `on_order`, `available`, `reserved`. Remote `reserved` is **[Official / Tier 2]** — a field of `getInventoryResponse`, the response schema of `GET /inventory/` in the official spec (§4.5) — **not** a sanitized-live observation; the sanitized observation (§5, observation 4) covers **only `on_hand` / `on_order` / `available`**. Cross-snapshot reconciliation is invalid because series move independently between reads. [Hypothesis] for cross-series consistency guarantees.
- **Sellable-stock formula: TBD.** No final sellable-stock formula is adopted **before canary**. Any candidate formula (e.g., combinations of the four series) is [Hypothesis] and is deliberately left out of this document.

## 10. Durable operations / idempotency

Design rules ([Official — repo documentation as design decisions]; behavioral outcomes [Hypothesis] until canary):

1. **Persisted operation records keyed per order.** Every settlement attempt is recorded before the network call, with order key, chosen path (Path 1 / Path 2 per §7), and state machine position.
2. **Invoice-ID verification gate.** No `/sales/payments/` call is issued unless the operation record contains a **persisted** invoice identifier — `createInvoiceResponse.id`, the **Sales Invoice Number** (§4.5) — that has been **independently verified** through the documented invoice read `GET /sales/invoices/{id}` (§4.5). The gate is **deliberate safety policy**, kept despite the response documenting an ID: it exists to prevent ambiguous or duplicate payment, not to compensate for a missing identifier. If verification is ambiguous, the gate fails: the case **stops before payment** and routes to **manual review**; "latest invoice" guesses and blind payment calls remain prohibited (§7).
3. **At-most-once payment.** Payment execution is guarded by the operation record state; a payment is emitted at most once per order/settlement.
4. **Retry only on provably-not-executed operations.** A retry is permitted only when the record proves the prior attempt did not execute (e.g., no request left the boundary). Ambiguous outcomes (timeout, unknown response) route to manual review, never automatic retry — consistent with the post-confirm-cancel = manual review rule in §7.

[Hypothesis] Whether Jubelio itself is idempotent on repeated `/create-invoice-payment` calls is unknown (no write test — §5, observation 7); our own at-most-once guard does not depend on that.

## 11. Per-order immutable `adjustment|sales_order` coexistence

- Every order is **permanently tagged at creation** with its mode: `adjustment` (legacy direct-adjustment lifecycle, §3) or `sales_order` (Strategy B pipeline).
- The tag is **immutable** for the lifetime of the order; no migration or retagging of existing orders.
- **Mixed-mode correction within a single order is out of scope.** A correction is a new order with its own mode tag.
- [Official — repo documentation as design decision]. [Hypothesis] That this per-order isolation suffices without cross-order invariants.

This makes the cohort-based rollout (§13) possible: mode is per-order, so cohorts are just tag populations.

## 12. Testing / mock plan

- **Contract mocks from `dist.yaml` schemas only** — mock servers/stubs are generated from `https://docs-wms.jubelio.com/dist.yaml` field lists (§4) and assert schema conformance. [Official] for schemas; [Hypothesis] for behavior they cannot encode.
- **No production write tests.** All environments above mock are read-only. [Sanitized live read-only] policy (§5, observation 7).
- **Sanitized read-only replay fixtures** — captured from the allowed observation set (§5), sanitized, replayed against mocks and reconciliation tooling.

[Hypothesis] That mock parity is sufficient to catch settlement-path defects (e.g., a double-path call) — the canary gates (§14) exist precisely because it may not be.

## 13. Rollout / rollback

- **Per-order mode flag:** the `adjustment|sales_order` tag of §11 is the unit of rollout.
- **Gradual cohort switch:** new orders enter `sales_order` mode cohort by cohort; existing orders never switch.
- **Rollback:** new orders revert to `adjustment` mode. No in-flight data is rewritten.
- **In-flight SO orders follow SO rules to completion:** they run under the settlement rule of §7 — cancellation via `POST /sales/orders/cancel/` with `{ids:[...]}`, only when no invoice exists, and settlement after a **confirmed** cancel defaults to manual review.

[Official — repo documentation as design decisions]; [Hypothesis] for any Jubelio-side behavior this depends on.

## 14. Canary evidence gates

Promotion of any strategy (A, B, or C) requires **all** of the following, each backed by sanitized read-only canary data:

1. **Observed SO→stock transition** in sanitized read-only data — closing §5, observation 8. Without this, Strategy B's stock assumptions remain [Hypothesis].
2. **Zero double-count** in reserved-ledger reconciliation — the separate SO-hold ledger (§9) must reconcile cleanly against the same-snapshot four-series reconciliation, with no re-subtraction of legacy `reservedStock`.
3. **Zero duplicate payment attempts** — the idempotency machinery of §10 must show no order with more than one payment execution, validating the §7 invariant operationally.

Then, and only then, **re-derive the sellable-stock formula** (currently TBD per §9).

**No gate, no promotion.** Failure of any gate keeps the strategy provisional (or demotes it).

## 15. Risks / open decisions

Risks:

- `/locations/` 500 ([Sanitized live read-only], observation 2) and the absence of observed SO stock transitions (observation 8) mean **Strategy B remains provisional**; SO stock behavior is [Hypothesis] until canary.
- No production write test exists (observation 7), so invoice/payment behavior — including double-call behavior on `/sales/packlists/create-invoice-payment` vs `/sales/packlists/create-invoice` — is **schema-inferred** ([Hypothesis]).
- Legacy negative adjustment already moved `on_hand`; any reconciliation that also subtracts its `reservedStock` ledger **double-counts**. Mitigation: separate SO-hold ledger + same-snapshot reconciliation (§9).
- Sampled invoices showing no tax (observation 6) may reflect **sample composition**, not API reality ([Hypothesis]).
- **Official response schemas vs runtime:** official response schemas may document less than the runtime returns. For invoice conversion, the fresh spec documents `createInvoiceResponse` as `{status, id}` (`id` = Sales Invoice Number; note the odd `status` description *"Delete Status"* in the spec itself, §4). What remains unverified is **runtime behavior** — whether the live call returns `id` as documented and it really identifies the created invoice — pending sandbox validation (§18). Any additional runtime field beyond the documented `{status, id}` is **canary evidence only, not contract** (§4 caveat) — it must never be promoted into the §4 matrix or relied on beyond the gate as written.

Additional risks added with the flow-comparison update (§17–§21):

- **Reader over-trust in the comparison tables:** §17–§21 are explainers, not implementation specs. The "New" columns describe an **unimplemented candidate contract**; every cell carries a tier tag to prevent misreading them as committed behavior.
- **Spec-site alias drift:** `https://docs.jubelio.com/` currently resolves via a **301 redirect** to `https://docs-wms.jubelio.com/` (verified during this documentation update, §16). If that alias or redirect changes, Tier-2 citations would need re-pointing and re-verification.
- **Evidentiary posture of §4.1–4.3:** the SO header/item/create-response fields now carry the explicit **candidate-contract** status (Tier 2 existence, Tier 3 semantics — §4). Reviewers must treat "documented in the official spec" and "verified usable in staging" as different claims; only the former is established.

Open decisions (all [Hypothesis] / deferred):

- Does the **Jubelio SO pipeline write into any series that collides with the local `reserved_stock` ledger**, or does the separate SO-hold ledger fully isolate it? (Prerequisite for any sellable-stock formula; **gate 2 of §14**.)
- Is the **oversell window wider or narrower under SO reservation vs direct `on_hand` adjustment**? The T&C-level async-sync risk (§20.1) applies to both flows; the comparative width is a staging hypothesis, not answerable from existing evidence.
- Should `GET /systemsetting/account-mapping` be **retained under the new flow at all**? Adjustment-account lookups may be irrelevant to the SO pipeline (the §19 matrix marks it old-flow-specific today).
- Should `POST /sales/orders/mark-as-complete` be called **at pickup under Strategy B**? **Explicitly undecided** — listed as an open option in §18; no default is adopted. (Endpoint existence is Tier 2 — `postSalesOrdersMarkascomplete` is indexed in the spec — the *decision* is what is open.)
- Which strategy is promoted post-canary: **A, B, or C**?
- Exact **sellable-stock formula** — deferred; requires canary evidence from same-snapshot reconciliation (§9, §14).
- Does **SO creation reserve stock at `location_id` granularity**, and is `qty_in_base` the correct reservation unit? (§14 gate 1.)
- **Retention/window for `POST /sales/orders/cancel/` (`{ids:[...]}`) expiry** before switching to manual review.
- Whether explicit `/sales/payments/` is **ever needed under B**, or `/sales/packlists/create-invoice-payment` suffices in all settlement cases. (No longer gated by a missing invoice ID — `createInvoiceResponse.id` is documented, §4.5 — but by unverified runtime semantics behind the §10.2 verification gate — §7.)

## 16. First-party sources

First-party sources used in this document (all links re-verified during this documentation update):

1. `https://docs-wms.jubelio.com/` — official Jubelio API documentation site.
2. `https://docs-wms.jubelio.com/dist.yaml` — official OpenAPI specification (YAML). Verified to contain: the adjustment flow — the OpenAPI **path table defines only `POST /inventory/adjustments/`** and the detail read `GET /inventory/adjustments/{id}`; the Inventory **overview prose** also mentions a `POST /inventory/adjustments/warehouse` (as one of "2 endpoints" for adjusting stock), but **that path is not defined in the spec's path table** and must not be cited as a defined endpoint; the current repo uses `/inventory/adjustments/` (this resolves reviewer item W1) —, the packlist endpoints (`/sales/packlists/create-invoice` — "Convert Sales Order to Invoice" (`createInvoice`) — and `/sales/packlists/create-invoice-payment` — "Convert Sales Order to Invoice with Payment" (`createInvoicePayment`); **both return `createInvoiceResponse` = `{status, id}`**, with `id` = number, description *"Sales Invoice Number"*, example 8, and `status` carrying the odd description *"Delete Status"* — §4.5), the invoice reads `GET /sales/invoices/{id}` (`getSalesInvoicesId`, "Get Invoice") and `GET /sales/invoices/unpaid/` (`getSalesInvoicesUnpaid`, "Get All 'Outstanding' Invoices") — the documented invoice verification reads (§4.5, §7, §18 step 5) —, the Sales Order cancel endpoint (`POST /sales/orders/cancel/`, body `{ids:[...]}`, 1–200 IDs), `POST /sales/orders/` (`postSalesOrders` — "Create/Edit Sales Order", request schema `saveSalesOrderRequest`, response schema `saveID` → `{id}`), `GET /sales/v2/orders/` (`getSalesV2Orders`, `page`/`page_size` required), `POST /sales/orders/set-as-paid` (`setAsPaid`), and the published stock model. The stock formula, **quoted verbatim** from the spec's Inventory overview: *"So, the formula for available items in Jubelio:   **On Hand - On Order - On Reserved**"* — this is the citation target for the §20.2 math (with the `on_hand` / `on_order` / reserved series).
3. `https://docs.jubelio.com/` — **alias**: resolves via a **301 redirect** to `https://docs-wms.jubelio.com/` (verified during this update; this resolves the earlier open question about whether the two domains host different specs — as of this update they are the same site). Caveat: `https://docs.jubelio.com/dist.yaml` serves the HTML documentation shell, **not** YAML; the working spec URL is item 2. If the alias or redirect changes, Tier-2 citations must be re-verified (§15).
4. `https://jubelio.com/en/terms-and-conditions/` — Jubelio T&C: omnichannel use **carries the risk of overselling** (one stock value across channels), orders may take **10–20 minutes** to be withdrawn from sales channels, and stock updates through the API **may fail at any time if the RPS limit is exceeded**. Cited for the oversell row of §20.1.
5. `https://jubelio.com/en/product/omnichannel/inventory/` and `https://jubelio.com/en/product/omnichannel/orders/` — Jubelio product pages for inventory and orders (context only; no endpoint claim rests on them).
6. In-repo spec copy: [`../jubelio-api/dist.yaml`](../jubelio-api/dist.yaml) with its overview [`../jubelio-api/README.md`](../jubelio-api/README.md) — a Tier 1 artifact. **Known staleness (recorded during this update):** the in-repo copy is **stale and missing `GET /sales/v2/orders/`** (`getSalesV2Orders`), which the fresh official spec contains (§4.5), and its invoice-conversion response descriptions must be re-checked against the fresh official spec, which documents `createInvoiceResponse` as `{status, id}` (`id` = Sales Invoice Number, example 8 — §4.5, §7); the local snapshot agrees with the fresh spec on this schema and on both packlist endpoints returning it (re-verified this update, §16 item 2). Its own caveat applies: the spec may drift from live API behavior, and the repo code remains the source of truth for implemented sync behavior.

No third-party documentation, blog post, or community resource is cited as evidence anywhere above.

---

## 17. Old flow — direct adjustment (repository-confirmed)

> **Evidence tier: Tier 1 (repository-confirmed) throughout, unless a cell says otherwise.** Sources: [`./stock-reservation.md`](./stock-reservation.md) (lifecycle table + observed adjustment contract), [`./order-flow.md`](./order-flow.md) (stock saga), [`./jubelio-sync.md`](./jubelio-sync.md) (checkout adjustments, catalog sync), [`../jubelio-api/README.md`](../jubelio-api/README.md), and §3/§9 of this document.

This is the flow that runs today: inventory holds are expressed as **direct Jubelio inventory adjustments** against `on_hand` — negative at checkout, positive compensation on failure/expiry, a fresh negative adjustment on late settlement.

### 17.1 Exact endpoint sequence per lifecycle event

| Lifecycle event | Exact endpoint sequence (Tier 1) | Write/read classification (Tier 1) |
|---|---|---|
| **Checkout / reserve** | `POST /login` → `GET /locations/list` → `POST /inventory/items/to-adjust/` (item IDs + `location_id`) → `GET /wms/default-bin/{location_id}` (`bin_id`) → `GET /systemsetting/account-mapping` (adjustment account IDs) → `POST /inventory/adjustments/` with a **negative `qty_in_base` per item** (directly against `on_hand`) → `POST /inventory/items/all-stocks/` (confirm absolute on-hand after the write) → `GET /inventory/adjustments/?page=…` (reconcile by the unique operation note). Midtrans Snap is created only after the adjustment is confirmed. | **Exactly one Jubelio write**: the negative `POST /inventory/adjustments/`. All other calls are reads — including two POST-verb calls that are read-semantics only: `POST /inventory/items/to-adjust/` (adjustment prep; mutates nothing) and `POST /inventory/items/all-stocks/` (snapshot read). The final `GET /inventory/adjustments/?page=…` is the ambiguity search: the hold is reconciled by its unique operation note. |
| **Payment initialization fails / Midtrans `deny`, `cancel`, `expire`** | One **compensating positive** `POST /inventory/adjustments/`, reusing the original reserve metadata (account lineage, `bin_id`, note lineage); local `reserved_stock` is cleared **only after** remote confirmation of the restore. | **One compensating Jubelio write** (positive adjustment) + reads to confirm it. |
| **TTL sweep finds an unpaid order** | Re-verify Midtrans, then the same **positive compensation** as above; the order is marked failed and stock stays hidden while compensation is unconfirmed. | **One compensating Jubelio write** (same positive compensation) + reads. |
| **Late settlement after compensation** | Race-safe local re-acquire, then a **new negative** `POST /inventory/adjustments/` if stock is sufficient; insufficient or ambiguous stock goes to **manual review**. | **One new Jubelio write** (fresh negative adjustment) — or none, if the stock check routes to manual review. |
| **Settlement (payment succeeds normally)** | **No Jubelio write at all.** The original negative adjustment stays committed; the local `reserved_stock` counter clears. | **Zero Jubelio writes and zero Jubelio reads** on the settlement event itself. |

### 17.2 Shared/support calls (not part of the runtime write path)

| Call | Role | Flow relevance |
|---|---|---|
| `POST /login` | Authentication (token, 12h expiry) | Shared by both flows |
| `GET /locations/list` | Branch/location mapping (sync + checkout context) — **Tier-1 repo/live-verified** (§5, observation 1); **not documented as a path in the current official spec**, which documents `GET /locations/` (§4.5) | Shared by both flows |
| `GET /inventory/items/masters`, `GET /inventory/catalog/{id}`, `POST /inventory/items/all-stocks/` | Catalog sync (products, galleries, per-branch stock reads) | **Shared/unchanged with the new flow**; catalog sync is excluded from the flow comparison in §19 because it never writes checkout counters |
| `GET /inventory/categories/item-categories/` | Category lookup in product-setup context (spec-documented helper, not a checkout write) | Catalog context only |
| `GET /systemsetting/account-mapping` | Adjustment plus/minus account IDs for `POST /inventory/adjustments/` | **Old-flow-specific today** (§15 open decision; see the §19 matrix) |

> **Footnote — strict "GET-only" definition (Tier 1).** Under the current user boundary, the agent's "GET-only" allowance means **GET verbs only**. `POST /inventory/items/all-stocks/` is read-semantics but carries the POST verb, so it remains a **human/operator call** in both flows; it appears in the legacy runtime sequence above only because the legacy runtime actually issues it after every adjustment write (§21.3).

> **Key stock fact (Tier 1).** The negative checkout adjustment **already reduced Jubelio `on_hand`**. The local `reserved_stock` counter is a **ledger record of that movement** — not an outstanding remote liability. Any calculation that subtracts that ledger entry from Jubelio stock again double-counts (§9, §21).

## 18. New flow — provisional Strategy B (candidate contract)

> **⚠️ PROVISIONAL AND UNIMPLEMENTED.** Nothing in this section exists in code. Every endpoint below is a **candidate contract**, not a call plan that has ever executed. Promotion happens only through the §14 canary gates — never on schema strength alone.

Numbered sequence (each step tier-tagged per §2.1):

1. **SO create** — `POST /sales/orders/` with the §4.1–4.2 fields → response `{id}` per §4.3.
   [Tier 2] The endpoint and schemas are documented in the official spec (`postSalesOrders`, "Create/Edit Sales Order", request `saveSalesOrderRequest`, response `saveID` — verified present during this update, §16) and captured in the repo spec copy.
   [Tier 3] **Live behavior is unverified**: usability under our integration's auth, retry/idempotency behavior, and — critically — **any stock effect of SO creation** (§5, observation 8). **Live Swagger / staging verification required** before this step is trusted.
2. **Out-of-band settlement** — payment received outside Jubelio; **no API call**. Acknowledged in the local persisted operation record (§10). [Tier 1 for the record-keeping design; Tier 3 for anything Jubelio-side during this window.]
3. **Exactly one invoice path** (hard invariant, §7):
   - **Path 1:** `/sales/packlists/create-invoice` → **persist** the returned `createInvoiceResponse.id` (the **Sales Invoice Number** — distinct from the SO `saveID.id`, which is the Sales Order ID; §4.5) → **independently verify it** via the documented `GET /sales/invoices/{id}` (§4.5) → then, and only then, optionally `/sales/payments/` behind the §10.2 verification gate. The gate is **deliberate safety policy**, not a consequence of a missing ID; if verification is ambiguous, **stop before payment** and route to **manual review** — never guess an invoice and never blind-pay (§7); **or**
   - **Path 2:** `/sales/packlists/create-invoice-payment` — its response `{status, id}` identifies the **Sales Invoice Number**, not a payment ID; do **not** call `/sales/payments/` afterward (§7, §19).

   **Never call both** for the same order/settlement. [Tier 2] Endpoints documented in the official spec. [Tier 3] All live semantics, including concurrency and retry behavior (§5, observation 7).
4. **Cancel only pre-invoice** — `POST /sales/orders/cancel/` with body `{ids:[...]}` (1–200 IDs) is permitted only when no invoice exists; **never cancel after an invoice exists**, and cancel is **never part of settlement**. Post-confirm-cancel settlement defaults to **manual review** — explicitly: a **late settlement arriving after a confirmed cancel is routed to `manual_review`**, never auto-settled (§7). [Tier 2] Endpoint documented. [Tier 3] Timing/retention semantics (§15).
5. **Verification GETs — the observation contract** [Tier 2] existence (§4.5) / [Tier 3] semantics: `GET /sales/orders/{id}` (order status), `GET /sales/invoices/{id}` (**invoice verification** — the documented read behind the §10.2 gate, run after every invoice conversion), `GET /sales/invoices/unpaid/` (outstanding-invoice listing, where useful for reconciliation), `GET /sales/payments/{id}` (payment existence after the proof gate), `GET /inventory/` (`getInventory`; `page`/`pageSize`/`q` — the stock-series snapshot), and `GET /sales/v2/orders/` (list search; `page` and `page_size` required — [Tier 2], documented in the official spec §4.5 though missing from the stale repo spec copy, §16) — not required by the canary snapshot contract. These GETs are how the flow is **observed**; every POST in steps 1–4 remains a human/operator call, and the agent's own credential is GET-only (§21.3).

**Explicitly excluded from Strategy B for now — `POST /sales/orders/set-as-paid` (`setAsPaid`, Tier 2, §4.5):** although documented in the official spec, it is **not** assumed equivalent to invoice/payment creation or to stock posting, and it lacks sandbox evidence. It is deliberately **not** a step above and requires a separate sandbox-evidence decision before any use is considered. (This is distinct from `POST /sales/orders/mark-as-complete`, whose use remains an **open, undecided** option below.)

**Explicitly undecided (open option — do not assume it into the sequence):** whether to call `POST /sales/orders/mark-as-complete` at pickup. The endpoint's existence is Tier 2 (indexed in the spec as `postSalesOrdersMarkascomplete`), but its *use* is an open decision tracked in §15; it is deliberately **not** a step above.

**On the SO-creation endpoint's status, stated plainly:** a `POST /sales/orders/` definition exists in the official indexed spec (verified during this update, §16) and in the repo-captured copy — so the candidate contract is not invented. What remains **unconfirmed** is everything past documentation: no live call has ever been made (§5, observation 7), and no SO stock transition has ever been observed (§5, observation 8). Neither §17's reader assumptions nor §19's comparison should be read as claiming the endpoint works.

## 19. Old vs new — the single event-by-event comparison matrix

> **Consolidation note.** This is the **only** old-vs-new table in this document: it absorbs the former §8 target event matrix and the former §20 endpoint matrix (§8 now points here). **Reader warning (mirrors §15):** this is an explainer, **not** an implementation spec. The "New" column describes an **unimplemented candidate contract**; per-cell tier tags mark what is confirmed vs hypothesized. The new-flow behavior must not be quoted as fact until the §14 gates pass.

Rows follow the §17 lifecycle events. The final row records the cross-cutting **catalog-sync** calls, which are **shared/unchanged** between the flows and excluded from the comparison because they never write checkout counters ([`./jubelio-sync.md`](./jubelio-sync.md)). Shared/support calls in general are documented once, in §17.2.

| Lifecycle event | Legacy — direct adjustment (Tier 1) | New — Strategy B, provisional (Tier 2 existence / Tier 3 semantics) | Deliberately **not** called (new flow) | Shared / unchanged |
|---|---|---|---|---|
| **Reserve / checkout** | `POST /login` → `GET /locations/list` → `POST /inventory/items/to-adjust/` (read-semantics prep) → `GET /wms/default-bin/{location_id}` → `GET /systemsetting/account-mapping` → **negative** `POST /inventory/adjustments/` → `POST /inventory/items/all-stocks/` (snapshot confirm — human call per the GET-only footnote, §17.2) → `GET /inventory/adjustments/?page=…` (reconcile by unique note) [Tier 1] | `POST /sales/orders/` with §4.1–4.2 fields → `{id}` (§4.3). **Stock effect unobserved** — §5, observation 8; §14 gate 1 [Tier 2 endpoint; Tier 3 semantics/behavior] | No adjustments, no packlist, no payment, no cancel | — |
| **Settle (payment succeeds normally)** | **No Jubelio write at all**; the negative adjustment stays committed; local `reserved_stock` clears [Tier 1] | No API call (out-of-band settlement acknowledged in the operation record, §10), then **exactly one** invoice path per §7: `/sales/packlists/create-invoice` (Path 1 — persist the returned **Sales Invoice Number** `createInvoiceResponse.id`, independently verify it via the documented `GET /sales/invoices/{id}`, then optional `POST /sales/payments/` behind the §10.2 verification gate; ambiguous verification → **stop before payment** / manual review, §7/§10.2) **or** `/sales/packlists/create-invoice-payment` (Path 2 — its `{status, id}` identifies the **Sales Invoice Number**, not a payment ID; **no** `/sales/payments/` call afterward) — never both [Tier 2 endpoints; Tier 3 behavior, §5 observation 7] | The other invoice path; any payment call before the invoice `id` is persisted and independently verified via a documented invoice GET (§7, §10.2); "latest invoice" guesses; blind payment calls; a `/sales/payments/` call after Path 2 | — |
| **Fail / expire (pre-invoice)** | Compensating **positive** `POST /inventory/adjustments/` reusing the original reserve metadata (§17.1) [Tier 1] | `POST /sales/orders/cancel/` with `{ids:[...]}`, **pre-invoice only** [Tier 2 endpoint; Tier 3 semantics — incl. the retention window before post-cancel settlement becomes manual review, §15] | Invoice, payment, any retry that could double-charge | — |
| **Late settlement after release** | Race-safe local re-acquire → **new negative** `POST /inventory/adjustments/` if stock is sufficient; else **manual review** [Tier 1] | **Undefined under B as scoped**: once a cancel is confirmed, late settlement routes to **manual review** (§7, §18 step 4); a fresh SO create for a re-released order would be a per-order-mode decision, not part of this candidate sequence [Tier 3] | Automatic re-settlement; double path calls | — |
| **Cancel** | No Sales Order endpoint exists in the legacy flow — compensation runs through positive adjustments (rows above) [Tier 1] | `POST /sales/orders/cancel/` with `{ids:[...]}` — only when no invoice exists (§7) [Tier 2 endpoint; Tier 3 semantics] | Cancel after an invoice exists; cancel as part of settlement | — |
| **Catalog sync (cross-cutting, all events)** | `GET /inventory/items/masters`, `GET /inventory/catalog/{id}` [Tier 1] | identical — no change | — | **Shared/unchanged — excluded from this comparison** (never writes checkout counters) |

Notes on the matrix:

- `GET /systemsetting/account-mapping` appears **only** in the legacy reserve cell — old-flow-specific today; whether to retain it under the new flow is the §15 open decision (it is not part of the candidate sequence in §18).
- `POST /login` and `GET /locations/list` are shared by both flows (§17.2); they authenticate/locate and do not distinguish the flows, so they appear in the legacy cells only.
- The SO-side verification GETs (`GET /sales/orders/{id}`, `GET /sales/invoices/{id}`, `GET /sales/invoices/unpaid/`, `GET /sales/payments/{id}`, `GET /inventory/`) are the **observation contract**, not write-path steps — specified once in §18 step 5 and §4.5.

## 20. Stock behavior inside Jubelio — old vs new

### 20.1 Comparison table

| Aspect | Old (direct adjustment) | New (Strategy B, provisional) |
|---|---|---|
| When `on_hand` mutates | Immediately at reserve (negative); compensation adds back [Tier 1] | **Unobserved at SO create** [Tier 3]; hypothesized: deferred to invoice/fulfillment [Tier 3] |
| Reservation mechanism | None Jubelio-side — direct shrinkage plus the local ledger [Tier 1] | Presumed SO-driven reservation / movement of an `on_order`-style series [Tier 3] |
| Compensation semantics | Positive adjustment reusing the original reserve metadata [Tier 1] | `POST /sales/orders/cancel/` with `{ids:[...]}`, pre-invoice only [Tier 2 endpoint; Tier 3 semantics] |
| Oversell exposure | Possible — Jubelio's T&C state that omnichannel use carries oversell risk, orders may take 10–20 minutes to withdraw from channels, and API stock updates can fail on RPS limits [Tier 2, §16] | **Also possible** — the same async-sync risk applies regardless of how the order is created. Whether the window is wider or narrower under SO reservation is **unknown** [Tier 3, §15]. The new flow is **not oversell-proof**. |

The quantitative treatment of these series — the official formula, per-event deltas, and a worked example — follows in §20.2.

### 20.2 Jubelio stock-counter math — formula, per-event deltas, worked example

**Formula.** Jubelio's official spec states, verbatim (Inventory overview; §16 anchors the citation target): *"So, the formula for available items in Jubelio:   **On Hand - On Order - On Reserved**"* [Official / Tier 2; repo spec copy [`../jubelio-api/dist.yaml`](../jubelio-api/dist.yaml)]. The series `on_hand`, `on_order`, `available` are exposed by `POST /inventory/items/all-stocks/` [Tier 1 — §5, observation 4]; the remote `reserved` series is **[Official / Tier 2]** via `getInventoryResponse` (§4.5, §9). With H = `on_hand`, O = `on_order`, R = reserved, A = `available`:

> **A = H − O − R**  [Official / Tier 2]

**Per-event deltas for quantity q** (each row's delta is measured against the state **immediately before** the event):

| Event | ΔH | ΔO | ΔR | ΔA | Status |
|---|---|---|---|---|---|
| Legacy negative adjustment | −q | 0 | 0 | −q | Tier 1 (confirmed — §17) |
| Legacy release (compensating positive) | +q | 0 | 0 | +q | Tier 1 (confirmed — §17) |
| SO create (Strategy B) | 0 | +q | 0 | −q | **canary hypothesis, not proven fact** (§5, observation 8; §14 gate 1) |
| SO cancel | inverse of create: 0 | −q | 0 | +q | **canary hypothesis, not proven fact** |
| Invoice conversion | −q | −q | 0 | 0 (vs. the immediately-before-invoice state) | **canary hypothesis, not proven fact** |
| Payment alone | 0 | 0 | 0 | 0 | **canary hypothesis, not proven fact** |

Every "canary hypothesis" cell is a **hypothesis about SO-side behavior** — arithmetically consistent with the formula A = H − O − R, but pending canary snapshots (§14, §21.3) and not established by any observation in this document. The invoice-conversion ΔA = 0 is measured **against the immediately-before-invoice state** (H and O move in opposite directions, cancelling in A). **Full WMS fulfillment could additionally move `reserved` — that is out of Strategy B scope**, which uses only create / settle / invoice / payment / cancel (§18).

**Worked example, q = 2** (state shown as H/O/R/A; arithmetic follows the formula and the delta table above):

- **Legacy path:** `A` drops **immediately** at reserve: 100 → **98** (ΔH = −2; ΔO = ΔR = 0; ΔA = −2) [Tier 1].
- **SO path (Strategy B):** start **100/0/0/100** → SO create [canary hypothesis] → **100/2/0/98** (ΔO = +2, so ΔA = −2) → invoice conversion [canary hypothesis] → **98/0/0/98** (ΔH = −2, ΔO = −2, ΔA = 0) → cancel **before** invoice [canary hypothesis] → back to **100/0/0/100** (the inverse of create).

[Official / Tier 2] the formula and the series names; [Tier 1] the legacy deltas; [Hypothesis / Tier 3] every SO-path delta and every quadruple after SO create — none of it is proven until canary.

## 21. Coexistence and sandbox role split

### 21.1 Coexistence — immutable per-order mode, no dual-write, separate SO-hold ledger

- Every order is permanently tagged at creation with its mode — `adjustment` (legacy, §3) or `sales_order` (Strategy B, §18) — and the tag is **immutable** for the order's lifetime (§11). [Official — repo documentation as design decision]
- **No dual-write:** an order runs exactly one flow. Legacy-mode orders never issue SO calls; `sales_order`-mode orders never fall back to direct adjustments (§11, §13). [Official — repo documentation as design decision]
- **Separate SO-hold ledger:** new SO holds are tracked in their own ledger and are **never subtracted from the legacy `reservedStock` series again** — see the double-count hazard below (§9). [Tier 1 for the hazard; Hypothesis / Tier 3 for whether Jubelio SOs also write their own series]
- The **final local sellable-stock formula stays TBD**, gated by canary / snapshot-overlap evidence (**§14 gate 2**); no candidate formula is adopted before then (§9).

### 21.2 Double-count warning

> **⚠️ DOUBLE-COUNT HAZARD (Tier 1 — mirrors §9)**
>
> The legacy negative checkout adjustment **already reduced Jubelio `on_hand`**. Its `reservedStock` / `reserved_stock` ledger entry is a **record of that movement** and must **never** be subtracted from stock a second time — doing so double-counts the same adjustment.
>
> - The **sellable-stock formula remains TBD** pending the §14 canary; no candidate formula is adopted before then (§21.1).
> - Additional hypothesis (Tier 3): Jubelio SOs may write their **own** reservation series (e.g., `on_order` / reserved) when created and/or invoiced. Whether that series collides with the local `reserved_stock` ledger — or is fully isolated by the separate SO-hold ledger — is unknown until staging observation (**§14 gate 2**; §15 open decision).

### 21.3 Sandbox role split

This resolves the earlier role ambiguity explicitly:

- **The human operator alone executes every POST write** in the sandbox: SO create (`POST /sales/orders/`), cancel (`POST /sales/orders/cancel/`), and any future invoice/payment calls (`/sales/packlists/create-invoice`, `/sales/packlists/create-invoice-payment`, `POST /sales/payments/`). [Hypothesis / Tier 3 as a plan — no write of any kind has been performed, §5 observation 7]
- **The agent's credential is GET-only, strictly defined: GET verbs only.** `POST /inventory/items/all-stocks/` is read-semantics but carries the POST verb, so it is **excluded** from the agent's allowance (§17.2 footnote). [Official — repo documentation as policy]
- The agent uses a **pre-generated token** and **never calls `POST /login`**. [Official — repo documentation as policy]
- The current create+cancel canary consists of sanitized `GET /inventory/` snapshots at T0/T1/T2 plus `GET /sales/orders/{id}` status reads — all within the §5 closed observation list. [Sanitized live read-only for the allowed set; Hypothesis / Tier 3 for any results not yet gathered]
- **No production writes**, in any case. [Official — repo documentation as policy; §5, observation 7]

### 21.4 Supersession note (conditional — proposal only, not an edit)

If Strategy B is approved after the §14 gates pass, this document's Strategy B **would supersede** one explicit non-goal in [`./stock-reservation.md`](./stock-reservation.md): *"Do not create Jubelio Sales Orders or other sales records."* This is stated here **as a proposal requiring approval** — this documentation update does **not** edit that file, and until such approval is granted, `stock-reservation.md`'s non-goals stand unchanged and remain consistent with this document's provisional status.
