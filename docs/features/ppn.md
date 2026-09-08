# Customer PPN

## Policy and configuration

Customer payments include configurable PPN. The effective default and fallback
rate is **11%**. IT manages it directly in `system_config`; there is no admin UI.
The store caches configuration for the process lifetime, so restart the store
after changing it:

```sql
UPDATE system_config
SET value = '12', updated_at = NOW()
WHERE key = 'tax.ppnRatePercent';
```

The configured value must be a decimal from 0 through 100 (up to six decimal
places). Invalid, negative, or excessive values produce a structured warning
and use 11%.

## Calculation

PPN is calculated after discount and rounded upward to a whole Rupiah:

```text
taxableBase = max(0, subtotal - discount)
ppnAmount = ceil(taxableBase × ppnRatePercent / 100)
total = taxableBase + shippingCost + serviceFee + ppnAmount
```

`apps/store/src/lib/order-pricing.ts` performs fixed-point `BigInt` arithmetic,
not binary floating-point arithmetic. Thus a raw result of `100000.21` becomes
`100001`, while an already-whole result is unchanged.

## Immutable order and payment snapshot

Every order stores `ppn_rate numeric(9,6)` and `ppn_amount numeric(15,2)`.
These are immutable pricing snapshots. Initial payment and re-payment build
Midtrans item details from the order/product snapshot, including a line such as
`PPN 11%`. Discounts are negative lines and non-zero shipping/service fees are
explicit lines. The invariant is:

```text
sum(item_details.price × quantity) = gross_amount = orders.total
```

Re-payment never reads the current tax configuration. Webhooks continue to
verify the provider gross amount against `orders.total`. PPN changes accounting
amounts only; stock and Jubelio quantities are unaffected.

## Presentation and analytics

Cart, checkout, customer order detail, admin order detail, and customer order
emails display PPN. Historical labels use the stored order rate. Admin analytics
sum `orders.total`, so paid revenue is gross revenue including PPN; separate
net-revenue and collected-tax reports are outside this scope.

## Seed and tests

Both seed modes create `tax.ppnRatePercent = 11`; demo order fixtures also store
an 11% snapshot and gross total. Unit coverage exercises fixed-point rounding,
config fallback, payment item invariants, and email output. Playwright checkout
and admin-order coverage verifies visible and persisted snapshots.
