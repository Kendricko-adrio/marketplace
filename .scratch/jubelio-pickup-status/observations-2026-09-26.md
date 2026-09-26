# Jubelio status probe — 2026-09-26

Scope: owner-approved live requests to configured `https://api2.jubelio.com` account with `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=true`. Login used `POST /login`; credentials/tokens and customer payloads were not recorded. **The flag and prior repo documentation describe this as a test account; the flag alone does not independently prove account isolation.** No existing SO was changed. No app code was changed.

## Existing SOs: GET detail and filtered GET list

| SO | Source | Detail `channel_status` | Detail `wms_status` | Detail `internal_status` | Detail `is_paid` | Invoice | List comparison |
|---|---|---|---|---|---|---|---|
| 68371 | `64`, SHOPEE | `READY_TO_SHIP` | `PAID` | `PROCESSING` | `true` | `null` | `wms_status=PAID`, `is_paid=true`, `channel_status="Ready To Ship"` |
| 68373 | `64`, SHOPEE | `UNPAID` | `PENDING` | `PENDING` | `false` | `null` | `wms_status=PENDING`, `is_paid=false`, `channel_status="Unpaid"` |
| 68390 | `1`, INTERNAL | `null` | `UNKNOWN` | `null` | `null` | 45939 | detail only |
| 68392 | `1`, INTERNAL | `null` | `UNKNOWN` | `null` | `null` | 45940 | detail only |
| 68393 | `1`, INTERNAL | `null` | `UNKNOWN` | `null` | `null` | 45941 | list `wms_status=UNKNOWN`, `is_paid=null`, `channel_status=null` |

Fields above were present with explicit `null` (not absent). The Shopee SOs demonstrate different status values but are **not source-equivalent controls** for INTERNAL pickup. `status_details` on the detail GET was `null` for both Shopee orders; on the list GET it was `[]` (including the INTERNAL SO). Source 1 existing SOs had `shipment_type=null`, `is_canceled=null`.

## New, controlled INTERNAL SOs

Two fresh SOs with generic test contact, test item 43842 at location 7, quantity 1 each, price 1000 each. Exact operations: one SO create per ID, one invoice conversion per ID, one payment per invoice; no repeat writes to an existing SO. Output was redacted to IDs/status/stock. Existing gateway verified SO create and invoice linkage; payment GET independently verified associations.

| Stage | Control SO 68394 | Treatment SO 68395 | Shared stock `(on_hand,on_order,available)` |
|---|---|---|---|
| Before create | — | — | `(6,0,6)` |
| After both creates | `wms_status=UNKNOWN`, `is_paid=null`, `invoice_id=null` | same | `(6,2,4)` |
| After control invoice 45942 | `UNKNOWN`, `null`, invoice 45942 | pending same | `(5,1,4)` |
| After treatment invoice 45943 | unchanged | `UNKNOWN`, `null`, invoice 45943 | `(4,0,4)` |
| After both invoice payments | `UNKNOWN`, `null`, invoice 45942 | `UNKNOWN`, `null`, invoice 45943 | `(4,0,4)` |

Payment 22 GET: one invoice association `45942`, amount 1000, SO 68394. Payment 24 GET: one invoice association `45943`, amount 1000, SO 68395. Follow-up independent GET of both SOs and filtered list returned `wms_status=UNKNOWN`, `is_paid=null`, `internal_status=null`, `channel_status=null` on list. Stock API did not include a `reserved` field for this item/location (absent, **not** observed zero); the other three series were numeric. Invoice conversion moved on-hand/on-order but left available unchanged, as observed here; no conclusion about accounting safety beyond the specific payment associations.

**Safety stop:** The one-shot CLI's captured output stopped while the gateway was starting GET of payment 24. Independent GET later proved payment 24 had applied and was associated correctly, but the captured output is not a reliable audit of whether any later `POST /sales/orders/set-as-paid` was attempted. The treatment SO still has `is_paid=null` and `wms_status=UNKNOWN`, which does **not** prove no attempt occurred. Do not rerun the one-shot experiment or send `set-as-paid` again on SO 68395 unless an authoritative vendor audit can establish that it was never sent. The SOs with paid invoices were not canceled.

## Interpretation and next evidence

- On this account, creating an INTERNAL SO leaves `wms_status=UNKNOWN`/`is_paid=null`; invoice + verified payment does **not** automatically update those SO fields. This reproduces the reported distinction. The user-provided examples are SHOPEE, so cannot by themselves establish a supported INTERNAL status transition.
- List and detail agree on `wms_status`; this makes the value a plausible source of the UI label, **not proof of the UI's mapping**. Verify in the vendor UI/support.
- `set-as-paid` remains only a documented candidate (`docs/jubelio-api/dist.yaml`, operation `setAsPaid`), not a verified remedy or known-safe step after invoice payment. Do not ship an automatic call. Ask Jubelio support for official mapping, semantics, financial/stock impact, and read-only audit of SO 68395 before any further write experiment.

Related: [initial research](../../plan/research/jubelio-wms-status-unknown.md), [read-only ticket](issues/01-ukur-status-mentah-so-internal.md), [vendor-rule ticket](issues/02-pastikan-asal-status-ui-dan-transisi-pickup.md). No test suite run: this was an external, account-scoped exploratory probe, not an application-code change.
