# Research proposal: long-term discount database design

Status: research proposal, **not an approved schema or migration spec**.
Research date: 2026-10-13 (workspace clock). No schema, seed, application code or infrastructure was changed; no SQL was executed.

Companion: [discount/product/admin research](discounts-coupons-promo-codes.md), especially its confirmed business rules and Jubelio field investigation. Table/column names below are proposed physical names; illustrative IDs/data are synthetic.

## Klarifikasi scope fase awal — keputusan pemilik

Kupon/kode barang bersifat **general untuk seluruh barang order** pada harga setelah markdown, tanpa targeting produk/kategori/brand atau include/exclude. Catatan targeting sebelumnya bukan kebutuhan fase awal. Bagian target group/member, diagram terkait, dan contoh targeting di bawah hanya referensi extension future-only, bukan tabel/fitur wajib untuk implementasi awal. Keputusan schema final tetap milik tiket schema.

Contoh terkonfirmasi: Rp150.000 + Rp300.000 = Rp450.000; kupon 10% maksimal Rp20.000 → potongan Rp20.000; net barang Rp430.000 sebelum pajak/ongkir/fee. Lihat [tiket 02](../wayfinder/02-offer-eligibility-and-money-basis.md); keputusan final threshold/pembulatan/alokasi/benefit nol telah disetujui dan tercatat pada Answer tiket tersebut. Plafon persentase opsional: subtotal Rp450.000, 10% tanpa cap → diskon Rp45.000/net barang Rp405.000. Minimum memakai subtotal barang setelah markdown; nominal maksimal subtotal; ongkir delivery min(ongkir, plafon); pembulatan turun/alokasi largest remainder dengan tie ID stabil; invalid/benefit nol ditolak tanpa memakai jatah; total pembayaran nol ditolak; tanggal opsional WIB/waktu server, mulai inklusif/akhir eksklusif; tanpa conditions tambahan. Ini keputusan planning, bukan approval schema/implementasi.

## 1. Recommendation and settled business rules

Use **separate domain records with one shared pricing/discount module**, not a universal `discount` table containing incompatible lifecycles:

1. **Persistent SKU markdowns**: website price adjustments for clearance/dead stock; no mandatory campaign name/expiry. Preserve Jubelio source base prices.
2. **Checkout offers**: shared benefit/eligibility model for discoverable coupons and manual codes. Benefit awal: persentase dengan plafon, nominal per order, subsidi ongkir. Diskon barang general untuk seluruh barang order; targeting produk/kategori/brand hanya extension future-only.
3. **Financial execution records**: immutable order money, component allocations, and payment-aware offer reservations/redemptions.

Markdown plus one coupon/code is allowed. Goods/shipping coupons and manual codes all share **one offer slot per order**. Multiple coupons/codes and multi-benefit offers are not approved for the initial release. The schema must not accidentally enable them merely because a table is extensible.

The recommended design is **relational financial/identity data + small, typed/versioned JSONB extension parameters**. Extensible means new mechanisms can reuse stable identity, targeting, reservations and allocation records; it does not mean clients can upload arbitrary code or that every future feature needs no migration.

## 2. Verified baseline and why the current voucher table is insufficient

| Inspected fact | Evidence | Design consequence |
| --- | --- | --- |
| Variant `price` and product `basePrice` are updated by Jubelio sync. SKU is unique; variants have stable local IDs and nullable unique Jubelio item IDs. | [products L113–139](../../../packages/db/src/schema/products.ts#L113); [sync L795–874](../../../packages/db/src/jubelio-sync.ts#L795) | Separate website markdowns; reference variant ID, not a mutable name or barcode. |
| Product has a brand FK; categories use a product/category join. | [products L27–109](../../../packages/db/src/schema/products.ts#L27) | Use real catalog FKs for targeting, not product IDs hidden in opaque configuration. |
| `voucher` combines code, type/value, dates and one global used counter. No per-client reservation/history model is present. | [marketing L11–28](../../../packages/db/src/schema/marketing.ts#L11) | Separate offer identity/rule version, activation code, counters and redemption evidence. |
| `orders.voucherId` is plain text without a voucher FK. `subtotal`, `discount`, `shippingCost`, PPN and total exist. | [orders L142](../../../packages/db/src/schema/orders.ts#L142), [L172–190](../../../packages/db/src/schema/orders.ts#L172) | Add real offer/redemption relations and distinct price components; do not overload one discount with shipping and markdown simultaneously. |
| Order item currently freezes one price, quantity and product label. | [order items L298–314](../../../packages/db/src/schema/orders.ts#L298) | Add source/effective/net line snapshots and discount allocations. |
| Order math uses exact scaled integer arithmetic; delivery taxes shipping as well as net goods. | [pricing L72–100](../../../apps/store/src/lib/order-pricing.ts#L72) | Retain exact-money arithmetic and explicit approved tax basis. No assumed tax change. |
| Durable Jubelio intents already snapshot request payload and claim dispatch once; calls stay outside transactions. | [Jubelio ledger L15–35](../../../packages/db/src/schema/jubelio-sales.ts#L15), [L110–193](../../../packages/db/src/schema/jubelio-sales.ts#L110) | Reuse this provider ledger, not another competing SO/payment system. |
| Admin audit supports transactional change evidence. | [audit schema](../../../packages/db/src/schema/system.ts#L7) | Reuse audit events alongside dedicated price and redemption history. |
| Orders currently cascade on client deletion. | [orders L130–134](../../../packages/db/src/schema/orders.ts#L130) | Financial/usage history retention needs explicit deletion-policy review; a new ledger must not silently reset usage through deletion. |

These are code-inspection facts, not assertions about deployed DB contents or live provider behavior.

## 3. Primary-source lessons used in the proposal

- **Vendure** separates conditions from actions, supports developer-defined extensions, and distinguishes item/order/shipping actions. Adopt the separation and explicit extension registration, not its framework or side-effect lifecycle. [DB1]
- **Saleor** separates line and order reductions, documents allocation of order-level reductions to lines, product/variant/category eligibility, shared voucher limits across codes and independent code/customer-use concepts. Our reservation/payment lifecycle deliberately remains specific to this repo, not a copy of Saleor's counting rules. [DB2, DB3]
- **commercetools** separates discount definitions from activation codes and supports many codes linked to one discount. Adopt stable shared identity/usage, but **not** its multi-code stacking policy or case-sensitive default. [DB4]
- **PostgreSQL 16** supports unique/composite FK/partial-index constraints and transactional row locks. Its `CHECK` constraints cannot guarantee cross-table sums or mutable catalog-price relationships. JSONB supports structured data but should have predictable shapes and manageable size. [DB5–DB8]

No vendor's published model establishes Jubelio nonzero-discount semantics; the companion research's provider verification gate still applies.

## 4. Relationship overview

```text
product_variant (Jubelio source base)
  ├─ variant_price_current ──> variant_price_revision (append-only terms)
  └─ price_change_batch_row ──> price_change_batch (admin job, not campaign)

 discount_offer (stable identity + mutable operational state/limits)
  ├─ discount_offer_revision (versioned published terms)
  │    ├─ discount_benefit (one initially)
  │    ├─ discount_condition
  │    └─ discount_target_group ──> discount_target_member ──> catalog FKs
  ├─ discount_code (optional manual activation)
  ├─ discount_offer_usage (global count/budget capacity)
  └─ discount_client_usage (personal capacity)

 orders
  ├─ discount_redemption (zero or one; revision/code actually selected)
  │    └─ discount_redemption_event (append-only transitions)
  ├─ order_item (source/effective/net money snapshots)
  └─ order_discount_allocation (markdown OR offer component by line/shipping)

 checkout_request (client-scoped idempotency) ──> orders
 jubelio_sales_operation (existing) ──> orders + verified provider payload
```

A price-adjustment batch is only an administrative job. An offer is a redeemable commercial identity. Neither is a replacement for an order snapshot.

The following sections describe a coherent target design; creating every table is not an instruction to implement all of it in one session. Optional future features are explicitly labeled.

## 5. Markdown and Excel tables

### 5.1 `variant_price_revision` — immutable price-change history

| Column | Type/constraint | Purpose |
| --- | --- | --- |
| `id` | text PK | Stable price-revision identity. |
| `variant_id` | text FK → product variant, RESTRICT | SKU variant affected. |
| `revision_number` | integer > 0 | Monotonic variant price-adjustment revision. Unique `(variant_id, revision_number)`. |
| `operation` | checked text: `set_price`, `restore_base` | A restore is an explicit revision, not deletion of history. |
| `new_price` | numeric(15,2), nullable only for restore | Persistent final website unit price; positive/bounded for set. |
| `base_price_at_review` | numeric(15,2) | Source price reviewed, not permanent source-price authority. |
| `previous_effective_price_at_review` | numeric(15,2) | Before value disclosed to the admin. |
| `batch_id` | nullable FK → price-change batch | Groups one manual/bulk action; no business expiry. |
| `reason` | nullable bounded text | Optional clearance explanation. |
| `created_by` | nullable FK → admin users | Actor; anonymization/deletion policy preserves historical action attribution. |
| `created_at` | timestamptz, not null | Change timestamp. |

Set/restore column-shape checks are same-row DB checks. `new_price < current Jubelio price` is **not** a valid cross-table CHECK: enforce it on review/apply/checkout under the chosen source-price-change policy. Preserve history if source data changes later. Published historical price terms are not edited in place. [DB5]

### 5.2 `variant_price_current` — one cheap catalog lookup

`variant_id` PK/FK; `revision_id` non-null FK; `version` positive integer; `updated_at timestamptz`.

- Composite FK `(variant_id, revision_id)` → `variant_price_revision(variant_id, id)` requires a corresponding unique key and prevents pointing to another variant's revision.
- Missing current row or a current restore revision means use current source price. Keep the current row after the first change/restore so its optimistic version does not reset.
- One current row per variant prevents stacked markdown layers. New revision replaces the pointer atomically.
- User-confirmed during wayfinder charting: a single website price per variant applies to all branches. Branch price books are outside initial scope. If introduced in a future approved effort, use non-null price-scope identities; nullable-branch uniqueness must not silently create multiple global prices. [DB5]
- User confirmed **fixed final prices**. Percentage input calculates the reviewed final price at confirmation; it is not a continuing percentage rule. Source-price drift/invalid-target handling remains open.

Catalog sorting/filtering must join current price revisions consistently before choosing the cheapest variant. Do not sort by source price while displaying effective price. Do not initially duplicate effective price into sync-managed columns; a future read projection needs source/revision versioning and demonstrated query-performance need.

### 5.3 `price_change_batch` — administrative request

Proposed columns: `id` text PK; `source` (`manual`, `bulk_selection`, `xlsx`); `status` (`draft`, `validating`, `ready`, `applying`, `applied`, `partially_applied`, `rejected`); `template_version`; `request_key`; `request_fingerprint`; `actor_id`; optional reason/file hash/protected storage key; row counts; `created_at`, `validated_at`, `applied_at` timestamptz.

Unique `(actor_id, request_key)` makes retries refer to the same administrative request. A new deliberate batch can contain identical values, so file hash alone is **not** the idempotency identity. Reusing the same key with different content is rejected.

### 5.4 `price_change_batch_row` — staging, preview and error evidence

`id` PK; `batch_id` FK; `row_number`; raw bounded `sku_text`; resolved nullable `variant_id` FK; operation; parsed target price; expected current version; source/effective prices at review; validation status; bounded reason codes; nullable applied revision FK. Unique `(batch_id, row_number)`.

- Unknown SKUs remain staged error rows; live revisions always require a real variant FK.
- Duplicate resolved variants must be diagnosed; no arbitrary last-row-wins. A partial unique index on `(batch_id, variant_id)` for accepted rows can reinforce uniqueness after diagnosis. Whether all colliding rows are excluded or require a user-selected resolution remains open. Do not lose useful row errors behind an uncaught uniqueness failure. [DB6]
- User-confirmed import policy: apply valid rows and explain failed rows. Upload/validation inserts staging only. A reviewed bounded accepted subset can commit in a short transaction: lock its source variants in stable order, recheck source/current versions, append revisions, update pointers, audit and record exact applied/failed counts. A 97-success/3-error file is `partially_applied`, not unqualified success. Apply-time races and retry granularity remain decisions for the bulk-import ticket.
- Set and publish an initial row limit after measurement. Reject or explicitly split oversized requests rather than pretending huge unbounded updates are safely atomic. A future versioned catalog-epoch publication model can stage very large jobs while retaining atomic visibility; it is **not** implemented or promised by `batch.status` alone.
- Restore only variants explicitly selected/marked for restore. Absence from a file or a blank target price never implies clearing an existing markdown.

## 6. Offer, eligibility and activation tables

### 6.1 `discount_offer` — stable identity, not a product markdown

Proposed columns:

```text
id text PK
key text UNIQUE                      -- stable internal identifier
state checked text                   -- draft / enabled / paused / archived
current_revision_id nullable text    -- pointer with same-offer composite FK
version integer                      -- optimistic admin concurrency
usage_policy_version integer
max_redemptions integer NULL         -- NULL means explicitly unlimited
max_redemptions_per_client integer    -- default 1; adjustable positive integer
budget_limit numeric(15,2) NULL       -- hard merchant subsidy exposure ceiling
created_by, created_at, updated_at, archived_at
```

Operational limits are mutable only through authorized, audited transactions that lock the capacity row. Do not lower a global count/budget below held + consumed exposure. Per-client limit reductions require a policy for existing over-limit customers; reject reductions below existing exposure in the initial proposal rather than silently reclaiming paid usage.

The identity survives renaming, new rule revisions, pause/resume and additional codes. Usage belongs to `offer_id`, **not rule revision or literal code string**. A genuinely new offer identity can provide new eligibility only through an explicit business action, not an accidental edit.

### 6.2 `discount_offer_revision` — published terms

`id` PK; `offer_id` FK; `revision_number`; display name/terms; `currency='IDR'` initially; `discovery` (`public`, `manual_only`); `valid_from`, `valid_until` nullable timestamptz; `min_eligible_spend numeric(15,2)`; `eligible_spend_basis='after_markdown_before_tax_shipping_fees'`; `schema_version`; `created_by/at`, nullable `published_at`.

Unique `(offer_id, revision_number)` plus `(offer_id, id)`; pointer/FKs must identify a revision of the same offer. When both dates exist, `valid_from < valid_until`; time eligibility is evaluated against server time, not a volatile `now()` CHECK.

- A draft revision and its children can be edited before first publication. After publication, the terms/targets/benefits are immutable; edit by publishing another revision.
- Publishing parent revision, benefits, targets and current pointer is one transaction. Price and offer snapshots on unpaid orders still use their selected version.
- Offer enabled plus revision date window determines active availability; expired/exhausted are derived states, not conflicting separate booleans.
- `public` permits picker selection by offer ID. `manual_only` requires an active bound code. No separate `coupon` versus `promo_code` monetary schema.
- Persist rule/engine version in order snapshots. Maintain old version readers; repayment reads final stored money instead of evaluating today's configuration.

### 6.3 `discount_benefit` — typed calculation, separate from targeting

Proposed columns: `id`; `revision_id` FK; `kind`; `scope` (`goods`, `shipping` initially); `rate numeric(9,6)` nullable; `fixed_amount numeric(15,2)` nullable; `max_discount numeric(15,2)` nullable; `params_version integer`; `extra_params jsonb` object, bounded size.

Initial allowed combinations and DB shape checks:

| `kind` | `scope` | Required money fields | Meaning |
| --- | --- | --- | --- |
| `percentage_off` | goods | `0 < rate <= 100`; `max_discount` opsional, jika diisi harus positif; fixed amount null | Persentase seluruh barang setelah markdown; plafon opsional sekali per order. |
| `fixed_off` | goods | positive `fixed_amount`; rate null | One fixed amount per eligible order, clamped to eligible goods; optional lower cap. |
| `shipping_subsidy` | shipping | positive `max_discount`; rate/fixed amount null | Subsidy `min(eligible shipping, cap)`. |

Use **UNIQUE(revision_id)** initially: one selected offer has one benefit, matching approved scope. At least one benefit is required at publication, enforced transactionally/with a deliberate publication guard; a FK/unique key only enforces existence of parent and at most one child, not mandatory child existence.

Benefit kinds are controlled text values plus a deployed evaluator registry, not arbitrary tenant/admin scripts. Adding tiers can add a versioned parameter shape and evaluator without recreating orders/redemptions. Multi-benefit requires a later explicit scope approval, removing/changing the one-benefit constraint and defining allocation/budget semantics. JSONB flexibility does not pre-approve multi-benefit stacking.

### 6.4 `discount_condition` — optional extensible eligibility

`id` PK; `revision_id` FK; `kind`; `params_version`; `params jsonb` predictable object; optional unique `(revision_id, kind)` where only one instance is meaningful.

All supported conditions must pass (AND). Examples of later explicitly approved conditions: `first_paid_order` with a documented history basis, `fulfillment_method` with `delivery`, verified-identity requirement, or shipping-service selection. Shipping subsidy inherently requires valid delivery/shipping even without an extra condition row.

- Initial `min_eligible_spend` lives in the revision's relational column, **not duplicated** as a JSON condition.
- A later `first_paid_order` condition needs a shared client eligibility-claim seam, not only a history query: two concurrent orders using different new-customer offers can both observe no paid history. Add a typed shared claim/usage record keyed by the client and the first-order entitlement before enabling that mechanism. An offer-specific client counter alone cannot serialize eligibility across different offers.
- Put catalog/client/branch identity references in typed FK associations where supported; do not treat arbitrary JSON arrays of IDs as referentially safe. A shipping provider's external service identifier is different: no local service FK exists, so store it as typed/versioned external reference and validate through the quote adapter.
- Unknown kinds/versions fail closed at publication and evaluation. New eligibility kinds need code, admin controls, tests and an approved policy; storing JSON does not implement their behavior.
- Do not build a general nested rule language in the first version. Add named, composable conditions and only introduce a richer expression model when a real requirement justifies it.

### 6.5 `discount_target_group` and `discount_target_member`

**Future-only, bukan scope fase awal.** Usulan struktur dan matching berikut tidak menjadi kebutuhan implementasi atau keputusan pemilik. Fase awal tidak mempunyai include/exclude dan memakai seluruh barang order sebagai dasar diskon barang.

`discount_target_group`: `id` PK; `revision_id` FK; `mode` (`include`, `exclude`); bounded label.

`discount_target_member`: `id` PK; `group_id` FK; four nullable typed FKs: `product_id`, `variant_id`, `category_id`, `brand_id`; **exactly one must be non-null**. Add per-target unique indexes `(group_id, target_fk)` for populated types and FK lookup indexes.

This is a compact alternative to four separate target junction tables while retaining actual FKs. Never use unconstrained `entity_type + entity_id` or a JSON ID list for these four core identities.

Proposed matching semantics, requiring product approval:

1. Within an include group: OR across its members.
2. Across include groups: AND. No include groups means all sellable goods.
3. Any matching exclude member wins over inclusion.
4. Empty include/exclude groups are rejected at publication; an empty group must not accidentally mean all goods.
5. The same eligible line set determines threshold **and** discount allocation. Categories use current memberships at checkout; historical orders snapshot the eligible set and never re-read changed membership to reprice themselves.

Example: group A = brand X OR brand Y; group B = footwear category; exclusion = variant V3. Eligible lines are footwear from either brand, except V3. A simple two-SKU selection uses one group with two variant members.

These semantics are our proposal, not Saleor's exact union/combination behavior. Catalog category hierarchy/descendant inclusion is not inferred from a name; the current schema has no hierarchy relation, so target only explicit categories unless separately modeled.

### 6.6 `discount_code` — optional activation key

`id` PK; `offer_id` FK; `code_normalized` unique not-null; `state` (`active`, `disabled`, `archived`); optional `bound_client_id` FK; optional `expires_at`; created actor/time. Add unique `(offer_id, id)` for composite ownership FKs.

- Normalize at the trusted write/read seam, enforce trim/canonical uppercase and bounded allowed characters. Reserve archived code names initially to avoid ambiguous reuse/history.
- Many codes can refer to the same offer identity. Each receives its own ID but shares global/per-client offer capacity.
- A code's expiry cannot extend the current offer's eligibility window; enforce intersection at evaluation, not a cross-table CHECK.
- One bound client is enough for the initial customer-specific-code case. Multiple allowed clients or client segments require typed joins/segment membership and approval later.
- Per-code single-use/subquota is an **optional future extension**, requiring a code-usage row locked alongside global/personal capacity. It is not implemented by a `disabled` flag or offer per-client limit alone.
- Public offers can have codes if explicitly desired; both activation paths consume the same identity/slot. If not desired, restrict code issuance to manual-only offers.

## 7. Reservation/usage and financial-result tables

### 7.1 `discount_offer_usage` and `discount_client_usage`

`discount_offer_usage`: `offer_id` PK/FK; `reserved_count`, `consumed_count` nonnegative integers; `reserved_amount`, `consumed_amount` nonnegative bounded numeric; `updated_at`.

`discount_client_usage`: composite PK `(offer_id, client_id)` with actual FKs; same count/amount counters; optional last redemption time; `updated_at`.

Count/amount together support both quota and subsidy-budget enforcement. They are **transactionally maintained capacity projections** of durable redemption evidence, not independent analytics that may lag. Reconcile projections against the ledger; never rebuild by resetting counters while checkout continues.

Global usage row is created with the offer, even when no limits are configured. Client usage row is inserted with conflict-safe initialization before locking. All reserve/consume/release and authorized limit edits lock in one documented order (e.g. global offer capacity → client's capacity → redemption); coordinate with checkout's stock/idempotency lock order to avoid deadlocks. [DB7]

### 7.2 `discount_redemption` — one selected offer per order

| Column | Proposed role |
| --- | --- |
| `id` | text PK |
| `order_id` | FK to order, **UNIQUE**, financial-history deletion protection |
| `offer_id`, `revision_id` | Composite ownership FK to selected offer revision |
| `code_id` nullable | Composite `(offer_id, code_id)` FK; null for public picker selection |
| `client_id` | FK to actual store client; must equal the order owner through composite ownership FK or trusted transaction validation |
| `activation` | `picker` / `manual_code`; same-row shape check on required/absent code |
| `status` | `reserved` / `consumed` / `released` |
| `reserved_amount` | Immutable actual benefit for this order; positive when a reservation is created |
| `usage_policy_version` | Limit-policy version observed at reservation, not a new usage identity |
| `expires_at` | Reservation/order deadline for sweep lookup; never proof of safe release by itself |
| `consumed_at`, `released_at`, `release_reason` | Coherent terminal-state metadata |
| `revision_snapshot jsonb` | Bounded versioned description of applied terms/eligibility result; private codes protected |
| `created_at`, `updated_at` | timestamptz |

Create no redemption/capacity hold for an offer that produces zero benefit; reject or mark that preview ineligible rather than consuming a use without savings. Aturan benefit nol ini telah dikonfirmasi pada tiket 02; persetujuan complete spec/implementasi tetap terpisah.

**UNIQUE(order_id)** enforces one coupon/code offer across both goods and shipping without needing two independent slots. Markdown history/allocations are separate, so many order lines can have markdowns alongside that one redemption.

Offer replacement happens in preview, before order creation. An already-created order does not exchange codes; a safely terminal order keeps its released ledger row and a new checkout creates a new order. Do not delete a released row to reuse the same order's offer slot.

Do **not** use `UNIQUE(offer_id, client_id)` on redemption: it would prohibit configured second use even after safe release. Per-client capacity must enforce the adjustable maximum using locked counters. A filtered uniqueness rule for one simultaneously reserved order could be added only if that extra policy is approved; it is distinct from lifetime maximum uses.

### 7.3 `discount_redemption_event` — durable transition evidence

`id` PK; `redemption_id` FK; `event_type` (`reserved`, `consumed`, `released`, `late_paid_review`, future approved support correction); `event_key` scoped unique; previous/next status where relevant; financial amount; static reason; request/provider correlation; actor/time.

Events append; transition status/counters/event commit together. Normal consumed/released events can have uniqueness on `(redemption_id, event_type)`; support corrections, if introduced, need their own authorized idempotency keys rather than disabling normal transition checks.

Refund evidence is **not** a `released` redemption. Keep consumed history and separately link to the future refund ledger; default recommendation is no automatic personal-use restoration or hard-budget recycling. Late paid evidence after release is a review event, not silent reacquisition of already-allocated budget.

### 7.4 `order_discount_allocation` — exact reduction by source and destination

Proposed columns:

```text
id text PK
order_id FK
order_item_id nullable FK              -- same-order composite FK
component checked text                -- markdown / offer_goods / offer_shipping
markdown_revision_id nullable FK
redemption_id nullable FK              -- same-order composite FK
benefit_id nullable FK                 -- belongs to redemption's selected revision
amount numeric(15,2) > 0
eligible_quantity integer NULL
source_snapshot jsonb                 -- bounded, versioned labels/identity evidence
created_at timestamptz
```

Same-row shape checks:

- Markdown: goods line required; markdown revision required; redemption/benefit null.
- Offer goods: goods line required; redemption/benefit required; markdown revision null.
- Offer shipping: no goods line; redemption/benefit required; markdown revision null.

Composite FKs/transaction checks must prove the line/redemption belong to this order, a markdown revision belongs to the line's variant, and a benefit belongs to the redemption revision. An FK to a globally existing ID alone is not enough. Unique source/destination allocation keys prevent duplicate components on retry.

The table is immutable once checkout is accepted. Cross-row sums must equal price snapshots and redemption amount, validated and persisted in the order transaction. PostgreSQL CHECK cannot enforce `sum(child.amount) = parent.discount`. If database-enforced cross-row aggregates are required, use deliberately designed deferred constraint triggers with concurrency analysis; do not pretend a row CHECK provides that protection. [DB5]

### 7.5 `checkout_request` — retry-safe order creation

`id` PK; `client_id` FK; client-provided bounded `idempotency_key`; server `request_fingerprint`; `status`; nullable unique `order_id` FK; timestamps. Unique `(client_id, idempotency_key)`.

The fingerprint includes owned cart selection/quantities, fulfillment/service/address approval and selected offer, not raw browser money as authority. Atomically claim the request and create order/snapshots/redemption/stock intent. Same key + same fingerprint returns the same order/result; same key + different request fails. New keys still obey quota/personal limits.

This is independent from the existing Jubelio operation reference: that protects provider dispatch for one already-created order, not duplicate creation of two different orders.

## 8. Order money compatibility and Jubelio mapping

### Explicit amounts, no double subtraction

Recommended additive changes, with an explicit pricing snapshot version:

| Record | Proposed fields/semantics |
| --- | --- |
| `orders` | Add `pricing_version`, `source_goods_subtotal`, `markdown_discount_total`, `shipping_before_subsidy`, `shipping_discount_total`, `pricing_snapshot` (versioned bounded JSONB, includes currency/tax policy/engine version). |
| Existing `orders.subtotal` | Preserve meaning as goods subtotal at effective unit prices **after markdown, before coupon**. Do not redefine it as source gross just to fit provider totals. |
| Existing `orders.discount` | Goods coupon/code reduction only; shipping subsidy is separate and markdown already reflected in subtotal. |
| Existing `orders.shippingCost` | Customer net shipping after subsidy; separately preserve quote/provider cost and shipping-before-subsidy. Exact tax/funding treatment awaits accounting approval. |
| Existing PPN/total | Final approved website money snapshot; repayment uses it. |
| `order_item` | Add `source_unit_price`, `markdown_revision_id` nullable FK, `markdown_discount_amount`, `offer_discount_amount`, `net_goods_amount`. Existing `price` remains effective unit price after markdown, before coupon. All line discounts are total-line amounts. |
| Existing `jubelio_sales_operation.payload` | Carry snapshotted source unit prices, verified nominal discounts and expected provider gross/discount/net values with a payload version; adapter depends on provider verification. |

For a current initial-benefit order, proposed invariants:

```text
source_goods_subtotal = sum(source_unit_price × quantity)
subtotal = sum(order_item.price × quantity)
markdown_discount_total = source_goods_subtotal − subtotal
discount = sum(goods offer allocations)
net_goods = subtotal − discount
shippingCost = shipping_before_subsidy − shipping_discount_total
total = net_goods + shippingCost + approved fees + approved PPN
```

Actual quoted provider shipping cost, merchant subsidy funding and customer charge remain distinct even when two happen to be equal. Persist them in the versioned delivery/pricing snapshot. Do not infer provider booking cost from customer net shipping.

Known same-row arithmetic checks can be added to snapshots with non-null inputs. Line/header/allocation aggregate equivalence is a transactional invariant, not an ordinary cross-table CHECK. Stored columns are intentional financial snapshots with strict consistency rules, not uncontrolled caches.

Jubelio candidate goods discount per line = markdown allocation + offer-goods allocation; preserve source unit price in provider `price`. SO `total_disc` aggregates reductions **once**. Provider nominal-per-unit/line semantics, invoice persistence, expected payable and shipping mapping remain unverified; see [companion §10](discounts-coupons-promo-codes.md#10-integration-dependencies-and-possible-accounting-paths). This proposal must not remove existing zero-discount guards before sandbox proof.

Published offer revisions and markdown history FKs use RESTRICT/soft archive rather than cascade. Order/client erasure is a separate retention/anonymization design: existing cascades must be reviewed before a ledger becomes authoritative. Do not reset per-client/verified-identity limits through profile deletion. Raw phone/IP/device fingerprints do not belong in rule JSON; any future verified-identity usage table needs pseudonymization/access/retention policy and does not prove a unique natural person.

## 9. Concrete use cases and example records

All examples use synthetic IDs, whole-Rupiah amounts and exclude PPN/fees unless explicitly stated. Each checkout selects at most one offer.

### A. Persistent clearance markdown and bulk import

Source: variant V42, SKU `SHOE-BLACK-42`, source price `300000.00`.

```text
price_change_batch B1: source=xlsx, status=applied, reason="Old-series clearance"
price_change_batch_row: batch=B1, row=2, variant=V42, target=150000.00
variant_price_revision M1: variant=V42, revision=1, operation=set_price,
                          new_price=150000.00, base_at_review=300000.00, batch=B1
variant_price_current: variant=V42, revision=M1, version=1
```

The import has 100 input SKU rows: 97 valid and three with explicit errors. The admin reviews/confirms the valid subset; a bounded apply commits those changes and reports the three unchanged failed rows. No coupon, redemption quota, campaign start/end or SO exists merely because prices were adjusted.

Catalog/cart shows Rp300,000 → Rp150,000 (50%). Order O1 freezes source unit Rp300,000, effective unit Rp150,000 and one markdown allocation Rp150,000; no `discount_redemption` row when no coupon is selected.

Later set Rp120,000: append M2 and update current pointer/version. It is a 60% reduction from source Rp300,000, not stacking another price adjustment on M1. O1 remains unchanged. Restore: append M3 with `operation=restore_base`, `new_price=NULL`; new orders use the current Jubelio base, not the old Rp300,000 review reference.

### B. Capped percentage coupon stacked with markdown

```text
discount_offer P10: per_client_limit=1, max_redemptions=100, budget=2000000.00
revision R10: offer=P10, discovery=public, min_eligible_spend=100000.00
benefit D10: revision=R10, kind=percentage_off, scope=goods,
             rate=10, max_discount=20000.00
```

Customer C1 buys V42 at effective Rp150,000. Coupon gives Rp15,000.

```text
orders O2: source_goods=300000, markdown=150000, subtotal=150000,
           discount=15000, net_goods=135000
discount_redemption U2: order=O2, offer=P10, revision=R10, client=C1,
                        activation=picker, code=NULL, status=reserved, amount=15000
allocations: O2/V42/markdown/M1=150000; O2/V42/offer_goods/U2/D10=15000
```

At authoritative paid transition, U2 becomes consumed once. Global/client reserved count decreases and consumed count increases; Rp15,000 moves from reserved to consumed budget. Source offer total exposure is unchanged by the transition. A second C1 order is denied; public picker versus manual activation cannot bypass identity usage.

Two pairs have effective eligible subtotal Rp300,000; 10% would be Rp30,000 but the order receives Rp20,000. Nominal coupon amount is capped once for the order, then allocated across its line quantities.

### C. Fixed amount per order, allocated across eligible lines

```text
P25/R25: public offer, min_eligible_spend=200000.00
D25: kind=fixed_off, scope=goods, fixed_amount=25000.00
```

Effective eligible lines are Rp150,000 and Rp100,000. Coupon is Rp25,000 **once**, with proposed proportional allocations Rp15,000 and Rp10,000. Net goods = Rp225,000. Redemption amount is Rp25,000; allocation sum is Rp25,000, not Rp50,000. Any line markdown allocation remains separately recorded.

For other ratios use exact proportional allocation and a deterministic largest-remainder rule with stable line-ID tie-breaking so allocations add up exactly; pembulatan turun dan alokasi largest remainder dengan tie ID stabil telah disetujui pada tiket 02.

### D. Shipping subsidy, not a goods reduction

```text
PS/RShip: public offer, min_eligible_spend=100000.00
DShip: kind=shipping_subsidy, scope=shipping, max_discount=20000.00
```

Goods Rp150,000; valid delivery quote/customer shipping before subsidy Rp30,000. Shipping discount Rp20,000; net customer shipping Rp10,000. Redemption amount Rp20,000, one `offer_shipping` allocation with no order-item ID; `orders.discount=0` for goods. Before tax/fees, payable Rp160,000.

If shipping costs Rp12,000, reserve/consume only Rp12,000; no leftover cash/credit. Pickup is ineligible and creates no offer redemption. Customer cannot also select P10: `discount_redemption.order_id UNIQUE` represents one slot irrespective of benefit scope.

This does not assert that merchant-funded shipping reduces PPN base or Jubelio shipping fields in a particular way; those remain accounting/provider gates.

### E. Product/category/brand eligibility

**Contoh future-only, bukan skenario fase awal.** Contoh ini dipertahankan untuk research extension; tidak menjadi acceptance criteria. Fase awal: sepatu Rp150.000 + baju Rp300.000 dengan 10% cap Rp20.000 menghasilkan net barang Rp430.000 sebelum pajak/ongkir/fee.

```text
RT: minimum eligible spend=200000.00; benefit=10%, maximum=30000.00
include group G1: brand X OR brand Y
include group G2: category FOOTWEAR
exclude group GX: variant VEX
```

Cart: eligible shoes Rp120,000 + Rp100,000; excluded bag Rp300,000. Eligible spend Rp220,000; benefit Rp22,000, allocated Rp12,000 and Rp10,000 to shoes only. The bag does not receive discount or satisfy minimum spend.

If eligible shoes are only Rp120,000 plus that bag, reject despite total goods Rp420,000. One-group/two-product or two-variant selection uses the same target association tables, not another discount mechanism/table.

### F. Hidden manual code and adjustable customer quota

```text
PM/RM: discovery=manual_only; fixed-off benefit=25000.00; per_client_limit=1
code K1: offer=PM, code_normalized="OLDSTOCK25", state=active
```

Customer C2 enters `oldstock25`; trusted lookup normalizes it. Checkout creates U6 with activation=manual_code and code=K1. If PM is customer-specific, a bound code denies other client IDs even when they know the text.

Adding code K2 to PM or publishing RM2 does not reset C2's usage: `(PM,C2)` remains the same usage key. After an authorized limit change from 1 to 2, a second redemption is allowed; a third is denied. Renaming/deactivating does not implement a reset. A different existing selected coupon must be replaced in preview, never stacked.

### G. Concurrent checkout, release and replay

P has quota 100: consumed 90, reserved 9. Two clients each attempt the last slot. The first capacity-lock holder reserves it; the other sees consumed 90 + reserved 10 and is denied. If budget remaining is only Rp10,000 but benefit is Rp15,000, reject: do not silently shrink a customer's benefit to whatever budget remains.

Order safely expires and provider/payment terminal evidence permits release: change one reserved redemption to released, decrement counts/amount, append release event atomically. Duplicate sweep is a no-op. A merely failed payment attempt on a still-live order keeps the hold. Repeated checkout request key returns the same order, not a new redemption. Late payment after safe release records `late_paid_review` and follows existing manual-review flow.

## 10. Concurrency and database invariants

A conceptual reserve transaction:

1. Claim/check client-scoped checkout idempotency. Load owned cart and fresh authoritative price/quote/offer terms.
2. Follow the approved lock order; initialize/lock global offer and personal usage capacity, relevant source/current price versions and stock rows. Recheck state, current revision/date, ownership, eligibility, exact money and counts/budget after locks.
3. Validate `consumed_count + reserved_count + 1 <= limit` and analogous money budget; unlimited is explicit NULL, not missing data.
4. Insert order/items/component allocations, one redemption, reservation event and durable SO intent; update capacity and stock holds; bind idempotency request to order.
5. Commit; only then call provider outside transaction through existing once-only dispatch mechanism.

Keep transactions short. Deadlock/serialization retries are bounded **DB-only retries before provider dispatch**; they never authorize re-POSTing an ambiguous external operation. [DB7]

Consume/release uses a conditional `WHERE status=reserved` transition; zero transitioned rows means no counter change/event repeat. Event + projection + transition belong to one transaction. Limit edits and publication/pausing also use the relevant locks so they cannot race reservations based on a stale enabled state/revision.

Important constraints/indexes:

- Current price PK/ownership composite FK; revision unique numbers and real variant FKs.
- Offer/revision/code ownership composite FKs; code canonical unique.
- One benefit per initial revision; coherent kind/column shape and bounded exact money.
- One redemption per order; personal usage composite PK; immutable event keys and allocation source keys.
- Targets exactly one typed catalog identity plus group/member uniqueness.
- Index redemption `(status, expires_at)` for held deadlines; `(offer_id, client_id, created_at)` for investigation; FK lookup indexes; current offer state/pointer for discovery; price-current/revision join keys; batch status/actor/date for admin jobs.
- Do not use `now()` in a partial index to express current expiry; time changes without index-row rewrites. Query time windows against indexed stored timestamps.
- Do not add a large GIN index on every rule/order JSON column by default. Index relational keys and add measured JSON expression/GIN indexes only for real query patterns. [DB8]

Numeric proposal: `numeric(15,2)` money and `numeric(9,6)` rates to match current conventions, bounded finite values with NOT NULL where applicable; calculate using exact decimal/scaled integer arithmetic. Validate accepted initial prices/discount output as whole Rupiah before gateway use. Store JSON money as decimal strings, not binary floating-point values. All timestamps use timestamptz and app Date objects; currency is IDR explicitly. [repo database conventions](../../../docs/architecture/database.md), [DB8]

## 11. Long-term extension strategy and honest limits

| Future requirement | Reused foundation | What must actually be added/approved |
| --- | --- | --- |
| Spend tiers | Offer identity/revisions, conditions, one benefit, capacity, allocations | `tiered_off` evaluator + versioned bounded tier parameters; strictly increasing thresholds, one selected tier and cap semantics; tests/admin form. No arbitrary script. |
| Quantity-based discount | Catalog targets, conditions, benefit, line snapshots | Eligible-quantity selection/allocation rules; bounded uses per order. Schema extension if quantity identity cannot fit existing records safely. |
| Buy X Get Y/gift | Offer/revision/capacity and snapshot history | Typed qualifying/reward target roles and reward SKU FKs; stock reservation for gifts; quantity pairing and returns policy. Do not pretend a gift is just a numeric coupon. |
| Cashback/points | Stable offer identity, rule/version, redemption evidence | Dedicated credit/reward account and posting ledger, delayed issuance, expiry, reversals and refund links. Not an immediate order-discount allocation. |
| Customer segments/verified phone | Conditions and stable offer usage | Real segment/verified-identity relations, privacy/retention policy and atomic identity usage capacity. Account ID alone is not person identity. |
| First-order offers | Condition/version and redemption evidence | Shared per-client first-order entitlement claim across all relevant offers; define paid/refunded history and concurrent unpaid-order handling. A read-only history check is insufficient. |
| Per-code quota/single-use codes | Code identities and parent offer capacity | Code usage projection/limits, same reservation lock/transition discipline. |
| Daily/monthly personal limits | Existing lifetime usage and evidence | Usage-window buckets with non-null timezone/window identities and timestamped policy; one lifetime counter cannot enforce every window. |
| Branch/channel price books | Revision/history/import jobs | Non-null price scope/channel currency definitions and uniqueness/query changes; cannot assume a global price applies safely to all scopes. |
| More currencies | Exact money and offer revisions | Currency-specific benefits/budget buckets, gateway precision and allocation rules. Never aggregate unrelated currencies into one IDR budget. |
| Two benefits in one offer | Stable parent slot and allocations | Explicit policy approval, benefit cardinality migration, defined combination ordering, budget reservation for all components; still one selected offer unless stacking policy changes. |
| Very large atomic price imports | Staging/batch evidence/history | Catalog-version publication/projected-current-price model and performance proof. A status flag alone does not make incremental pointer updates invisible. |

Prefer controlled text kinds and schema versions over a large database ENUM that must be extended for every possible mechanism. Database CHECK constraints and the evaluator registry still enumerate supported combinations; relaxing them is an approved migration/deployment change. New conditions/benefits require compatible rollout: do not publish configurations an old running store process cannot evaluate. Unsupported definitions fail closed.

Typed relational fields cover critical caps/amounts/ownership and common admin/reporting queries. JSONB is for small versioned parameters such as future tiers and historical evidence, not an unstructured bag of money, quotas and orphaned IDs. This balances extension cost with enforceable financial invariants. [DB1, DB5, DB8]

## 12. Migration/review proposal, not executable approval

1. Keep new schema definitions only in `packages/db/src/schema/`; no app-owned tables. Fixed final prices shared across branches, valid-row Excel application with explicit errors, and direct coupon selection are now confirmed. Choose remaining price-change/rounding/refund/identity policies before migration approval.
2. Add new records and `pricing_version`; preserve legacy order semantics/snapshots. No retrospective discount recalculation. Backfill only facts evidenced by existing data.
3. Map each legacy voucher to a stable offer/revision/benefit/code with a legacy-ID mapping for compatibility. **Do not reset legacy `used` to zero or fabricate per-customer history.** Inspect data: current feature is validate-only but seed rows contain artificial used counts. Any production aggregate with no redemption evidence needs an explicit opening balance/quota disposition and owner approval before cutover.
4. Replace validate-only preview with authenticated server pricing/reservation at approved seams. Existing `voucher_id` remains legacy compatibility until data/users/endpoints are safely migrated; do not rename/drop blindly.
5. Review old client/order cascade deletes, admin permission catalog, audit writer, import storage and deployment needs. Update FK-ordered seed cleanup and realistic markdown/percentage/fixed/shipping/code examples for the approved schema; preserve no-dummy-data Jubelio seed mode.
6. Prove provider nonzero goods mapping and invoice/payment/mirror/cancellation contract before enabling live discounts. Shipping accounting stays its own decision.
7. Tests must cover revision ownership and preservation, import optimistic conflicts/accurate partial results, public/manual shared slot, semantik diskon general seluruh barang (targeting future-only), contoh nominal/pembulatan independen, real-DB capacity races, payment callbacks/sweep replay, safe release/late settlement and deletion/retention constraints. Playwright covers bulk preview/errors/apply and customer discounts. No such tests were run in this research.

The proposed schema does not select a PostgreSQL trigger strategy, Drizzle implementation, migration SQL or final table count for the first delivery slice. Those belong in a complete user-approved spec after remaining product decisions are settled.

## Sources and verification

- **DB1 — Vendure, Promotions**: https://docs.vendure.io/guides/core-concepts/promotions/ . Direct fetch read successfully; conditions/actions, registered custom behavior and item/order/shipping separation. Framework choice/API code is not being adopted.
- **DB2 — Saleor, Discounts Overview**: https://docs.saleor.io/developer/discounts/overview . Direct fetch read successfully; types, line/order reduction and propagation of order benefits into lines.
- **DB3 — Saleor, Vouchers**: https://docs.saleor.io/developer/discounts/vouchers . Direct fetch read successfully; target associations, multiple codes/combined usage, customer limits and explicit counting/releasing differences. The proposal does not copy Saleor's lifecycle or its cheapest-unit `applyOncePerOrder` meaning; our fixed discount is once per eligible order pool.
- **DB4 — commercetools, Discount Codes and Cart Predicates**: https://docs.commercetools.com/learning-price-and-discount-your-products/discount-codes/discount-codes-and-cart-predicates . Direct fetch read successfully; definition/code separation, multiple codes per definition, customer restrictions and code normalization. The API reference search extract at https://docs.commercetools.com/api/projects/discountCodes corroborated max global/customer applications and identity/versioning; no claims depend on a successful direct fetch of its Cart Discounts page (that fetch failed).
- **DB5 — PostgreSQL 16, Constraints**: https://www.postgresql.org/docs/16/ddl-constraints.html . Direct fetch read successfully; NULL/CHECK caveats, unique/composite FK behavior and FK index/deletion considerations.
- **DB6 — PostgreSQL 16, Partial Indexes**: https://www.postgresql.org/docs/16/indexes-partial.html . Direct fetch read successfully; conditional uniqueness and query/predicate considerations.
- **DB7 — PostgreSQL 16, Explicit Locking**: https://www.postgresql.org/docs/16/explicit-locking.html . Direct fetch read successfully; row locks, transaction scope and consistent lock ordering/deadlocks.
- **DB8 — PostgreSQL 16, JSON Types**: https://www.postgresql.org/docs/16/datatype-json.html . Direct fetch read successfully; predictable JSON shapes, hybrid relational/JSON design, precision and whole-row concurrency/indexing implications.
- **Context7 corroboration:** resolved `/websites/postgresql_16`; queried constraints/partial uniqueness/composite FK/row locking. Followed primary PostgreSQL pages for detailed limitations rather than treating snippets as a complete transaction design.

Verified: source/code inspection, first-party documentation retrieval and example arithmetic only. No authenticated Jubelio requests, SQL/schema checks, tests/builds/lint, migration generation, database writes or runtime exploit tests were performed. This is a recommendation grounded in current repo facts, not evidence that these proposed tables or constraints already exist.
