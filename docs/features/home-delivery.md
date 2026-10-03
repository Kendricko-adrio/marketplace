# Home delivery via Jubelio Shipment

The implemented marketplace delivery lifecycle is:

`owned saved address or inline new destination → server quote → approved immutable order → paid/verified goods settlement → packing → booked AWB → physical handoff → signed/GET tracking → completion`

Checkout accepts a new verified destination even if the client's address book is empty. Saving it is optional, occurs in the approved local order transaction, and can mark it as the sole default; an unsaved destination still has an immutable snapshot on the order.

AWB is not handoff; handoff or PICKED_UP is not completion. Verified DELIVERED completes without mandatory POD. Authorized, reason-required manual resolution is separate and never invents courier delivery evidence.

## Contracts and implementation slices

| Slice | Enduring contract |
|---|---|
| 01 Pickup financial regression | [Jubelio sales orders](jubelio-sales-orders.md), [PPN](ppn.md) |
| 02 Owned addresses, local origin, measured parcels | [Client addresses](client-addresses.md) |
| 03 Server-derived delivery quotes | [Delivery quotes](delivery-quotes.md) |
| 04 Approved immutable orders and payment | [Delivery orders](delivery-orders.md) |
| 05 Packing, durable booking and cost reconciliation | [Delivery fulfillment](delivery-fulfillment.md) |
| 06 Physical handoff, signed tracking, terminal safety | [Delivery tracking](delivery-tracking.md) |
| 07 Scoped follow-up and audited manual actions | [Delivery follow-up](delivery-follow-up.md) |

Two financial ledgers remain separate: goods 100000 + shipping 20000 + website PPN 13200 = website/Midtrans 133200; Jubelio SO/invoice/payment remain goods-only 100000. Quote, booked and actual billed shipping prices are distinct; provider cost drift does not surcharge the customer. Repayment uses the frozen order, not new quotes or mutable address/master/config data.

Store/client and admin/user authentication remain separate. Branch Scope grants visibility, never permission for physical actions outside current Home Branch. Customer DTOs exclude provider fees, raw callback data, internal notes and admin attribution. Provider request intents are durable; ambiguous outcomes are held, not blindly retried. Proof-approved booking release is audited and requires a separate booking click.

## Verification and activation boundary

All seven implementation tickets passed main-owned review and isolated local validation: 106 unit files, 953 passed (two infrastructure-failure sentinel tests skipped because PostgreSQL is ready), 22 mock-only browser/HTTP cases, both app typechecks, focused lint, schema check and diff check. Tests for real database behavior ran against local PostgreSQL; skipped sentinels are not skipped delivery acceptance tests.

This is **implementation completion**, not operational activation. Owner deployment must apply generated migrations, configure independent Shipment credentials and webhook secret/dashboard URL, validate branch sender data and measured SKU/fallback/packaging parameters, and arrange any authorized tenant smoke test. See [Shipment readiness](../deployment-docs/shipment-readiness.md). No live provider writes, remote operations, deployment, commit or push were performed. Post-completion disputes/returns remain outside this MVP.
