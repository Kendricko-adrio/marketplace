# Verifikasi Status Channel pada SO INTERNAL pickup

Parent: [Cermin status website di Status Channel SO pickup Internal](../map.md)
Type: research
Status: answered (UI screenshot + API GET)
Blocked by: none

## Question

Apakah kolom **Status Channel** pada UI Jubelio menampilkan `channel_status` yang dibuat pada SO `INTERNAL` pickup, terpisah dari kolom **Status Jubelio**? Pada [uji terkendali](../combined-test-results-2026-09-26.md), SO 68397 menyimpan `OKCIR_TEST_CREATED` pada GET detail dan list sedangkan kontrol 68396 `null`; keduanya tetap `wms_status=UNKNOWN`. Cocokkan dua baris tersebut di UI vendor (atau dapatkan aturan resmi Jubelio), catat apakah nilai mentah ditampilkan, dipetakan, disembunyikan, atau tertunda. Ini pemeriksaan fakta, bukan izin mengubah order.

## Result — UI confirmed by owner

The owner supplied a Jubelio Sales Orders UI screenshot (temporary local evidence: `C:\\Users\\USER\\AppData\\Local\\Temp\\pi-clipboard-30543e3b-9f1d-4cf7-8176-bdafd13086e4.png`). The row for **SO-000068397** shows **Status Channel = `OKCIR_TEST_CREATED`**, **Status Jubelio = `UNKNOWN`**; **SO-000068396** has a blank Status Channel and `UNKNOWN` Status Jubelio. The screenshot corroborates the [API detail/list comparison](../combined-test-results-2026-09-26.md). The clipboard path is ephemeral; this textual observation is the durable note. It proves display for this test account/source-1 case, not a general vendor promise about all custom strings or downstream automations.

The marker was submitted **with POST create**, then read back via GET. This is different from writing a marker **after** GET confirmation (an edit not yet tested). There is no SO to carry a marker before create. No additional POST is authorized by this finding. [Issue 03](03-pilih-alur-status-resmi.md) can now settle the desired *display-only website status mirror* scope and failure semantics with the owner.

## Historical WMS investigation (parked in [04](04-wms-ditunda.md))

Evidence below is retained for traceability, **not an active WMS work item**. The next active step is UI verification above.

### Evidence update (2026-09-26)

The [controlled account probe](../observations-2026-09-26.md) shows that invoice conversion and verified invoice payment do **not** update `wms_status=UNKNOWN` or `is_paid=null` on INTERNAL SOs in this account. The two UI comparator IDs supplied by the owner are SHOPEE SOs, not INTERNAL controls. Detail and filtered-list `wms_status` agree; the exact vendor UI mapping and supported paid/ready transition remain open. The recorded CLI output ended before a complete audit of the optional `set-as-paid` step; do not retry on the test SO. Vendor confirmation or a trustworthy audit is needed before any further write test.

## Candidate mechanisms — follow-up research

Read-only account comparison (GET detail + filtered WMS list, same configured account):

| SO | Source | `channel_status` | `is_paid` | `internal_status` | `wms_status` | In `GET /wms/sales/orders/ready-to-process/`? |
|---|---|---|---|---|---|---|
| 68371 | SHOPEE (`64`) | `READY_TO_SHIP` | `true` | `PROCESSING` | `PAID` | yes |
| 68373 | SHOPEE (`64`) | `UNPAID` | `false` | `PENDING` | `PENDING` | no |
| 68394/68395 | INTERNAL (`1`) | `null` | `null` | `null` | `UNKNOWN` | no |

The relevant fields are **present with `null`** on INTERNAL orders. SHOPEE orders have non-null `store_id` and `payment_method`, while these INTERNAL test orders have `null`; this is a source/workflow difference, **not** a prescription to spoof a Shopee store. On this account, provider's ready-to-process WMS list contains 68371 but neither 68373 nor the INTERNAL test SOs. This is evidence of distinct WMS processing, not proof of the UI's rendering rule or causal status mapping. No status-changing request was made in this follow-up.

| Candidate | Primary source | Potential use / unproven consequence |
|---|---|---|
| Include `is_paid: false` on initial `POST /sales/orders/` | [`saveSalesOrderRequest`](../../../docs/jubelio-api/dist.yaml) (~L24893–25005): optional boolean; currently omitted by [`buildSalesOrderPayload`](../../../apps/store/src/lib/jubelio-sales-client.ts). | Could distinguish explicit unpaid from `null`; **no contract guarantee** that INTERNAL `wms_status` changes to `PENDING` or UI reads it. Requires fresh SO experiment, not editing an existing paid invoice. |
| `POST /sales/orders/set-as-paid` **after verified invoice/payment** | [`setAsPaid`](../../../docs/jubelio-api/dist.yaml) (~L9104), `{ids:[...]}` | Most direct documented operation to mark **SO** paid. Does not promise WMS transition, absence of duplicate accounting, or safe behavior after invoice payment; optional previous test outcome cannot be audited from the captured output, so never retry on SO 68395. |
| Edit SO using `POST /sales/orders/` with existing ID and `is_paid: true` | [`postSalesOrders`](../../../docs/jubelio-api/dist.yaml) (~L8716) and `saveSalesOrderRequest` | Documented edit API, but requires the full order payload and can affect totals/items/stock; more dangerous than a dedicated endpoint and not proven to set `wms_status`. Do not try on a paid SO without vendor guidance. |
| `POST /wms/sales/ready-to-process` | [`postWMSSalesReadyToProcess`](../../../docs/jubelio-api/dist.yaml) (~L2837) and [WMS workflow](../../../docs/jubelio-api/dist.yaml) (~L1170–1200) | **Not** a general `UNKNOWN` → `PAID` operation: documented specifically for *empty-stock* or *failed-pick* orders to return to ready-to-process. `POST /wms/sales/ready-to-pick` is the next warehouse stage, not payment. Neither is safe to assume for pickup INTERNAL. |
| `channel_status`, `payment_method`, `store_id`, `source` | [`saveSalesOrderRequest`](../../../docs/jubelio-api/dist.yaml) (~L24980–25010) | Fields exist but represent channel/store context or a payment label, not a documented way to write `wms_status`. Do not impersonate Shopee or fabricate channel statuses. `internal_status`, `wms_status`, `wms_statuses`, `is_payment_gateway_invoice_paid` are **GET output fields**, not documented fields on the SO save input. |

**Current conclusion:** there is a documented API to mark an SO paid, and a documented optional boolean on SO create/edit; neither is established as the official path to `PENDING` → `PAID`/ready-to-process for INTERNAL pickup. SHOPEE's working path shows Jubelio has a source-specific status workflow, **not** that a public API can safely reproduce it for `source=1`. Before selecting an implementation, ask Jubelio which field drives the UI column, whether INTERNAL pickup is eligible for this WMS flow, whether explicit `is_paid:false` produces an unpaid state, and the exact before/after effects of `set-as-paid` after a verified invoice payment (including stock/accounting). A new isolated write experiment would require its own reviewed scope; do not reuse SO 68395.

A bounded one-session test of the documented WMS recovery endpoint **and a separately gated INTERNAL `channel_status` create experiment** was approved by the owner; its consumed proposal was retired during scratch cleanup. See [redacted results](../combined-test-results-2026-09-26.md): Phase A found no verified WMS-eligible test SO (empty-stock 0; failed-pick GET 404), so **no ready-to-process POST was sent**. Phase C created two fresh INTERNAL test SOs: explicit `channel_status=OKCIR_TEST_CREATED` persisted in API detail/list on SO 68397, unlike control 68396 (`null`), while both remained `wms_status=UNKNOWN`/`is_paid=null`. The vendor UI is not verified. Two test units remain on order; no automatic cancellation is approved. This one-session approval is consumed, not standing permission. A channel field cannot represent an SO that has not yet been created.
