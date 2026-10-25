# Customer PPN

## Dua kontrak pajak (status per dokumentasi ini)

Ada dua cara menghitung PPN yang hidup berdampingan, dipilih oleh gate
`discounts.contractVersion` (`apps/store/src/lib/config.ts`):

| Gate | Dasar pajak | Catatan |
|---|---|---|
| `0` (legacy, default) | barang, dan untuk delivery **ditambah ongkir** | perilaku lama, tetap dipakai order/history lama |
| `1` (kontrak pricing1) | **barang saja** (`taxable_base = net_goods`) | order baru kontrak berversi |

Dokumentasi lengkap kontrak berversi (identitas nominal, decoder, batas input,
payable provider) ada di
[versioned-checkout-pricing.md](versioned-checkout-pricing.md). Seluruh bagian di
bawah ini yang menyebut ongkir masuk dasar pajak adalah **LEGACY**: sengaja tidak
dihapus karena masih menjelaskan order dan decoder versi 0.

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

## Calculation (LEGACY — gate `0`)

> **LEGACY.** Bagian ini menjelaskan `calculateOrderPricing`
> (`apps/store/src/lib/order-pricing.ts`), yaitu formula versi 0 di mana ongkir
> delivery ikut menjadi dasar pajak. Order baru pada gate `1` memakai dasar
> barang saja; lihat
> [versioned-checkout-pricing.md](versioned-checkout-pricing.md).

PPN is calculated after discount and rounded upward to a whole Rupiah. For
pickup the taxable base is goods only; the pricing helper also supports a
future delivery calculation where quoted shipping enters the taxable base.
Delivery checkout is **not active** yet.

```text
goodsBase = max(0, subtotal - discount)
taxableBase = goodsBase + (fulfillmentMethod == delivery ? shippingCost : 0)
ppnAmount = ceil(taxableBase × ppnRatePercent / 100)
total = goodsBase + shippingCost + serviceFee + ppnAmount
```

For pickup with Rp100,000 goods at 11%, the website/Midtrans total is
Rp111,000 (PPN Rp11,000), while its single Jubelio Sales Order, invoice and
payment are Rp100,000 with zero SO tax and discount. A mismatched SO/invoice/
payment must block pickup fulfillment; the two ledgers are not equal.

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

### Pembaca berversi (gate `1`)

Pada gate `1`, repayment dan detail order tidak membaca kolom ini secara
langsung: keduanya melewati decoder `readOrderPricing` yang memvalidasi versi
(`pricing1/engine1/provider2`) dan identitas nominal sebelum menampilkan uang.
Versi yang tidak dikenal fail closed (tidak ada fallback ke rate/config
terbaru). Snapshot legacy (versi `0`) dibaca oleh decoder legacy eksplisit dan
tetap memakai cents `numeric(15,2)`; ia tidak pernah dihitung ulang dengan
formula barang-saja.

`serviceFee` pada kontrak baru selalu `0` dan **bukan** baris charge di UI
maupun Midtrans; baris service fee pada order legacy yang nonzero tetap boleh
tampil sebagai history.

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
