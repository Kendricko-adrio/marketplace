# Delivery orders and settlement

Delivery placement uses the existing Sales Order checkout pipeline, never a second delivery SO or inventory adjustment. Pickup remains the default for legacy rows/requests.

## Approval and immutable data

`POST /api/checkout/place-order` accepts delivery input `{ itemIds, contactPhone, contactEmail, fulfillmentMethod: "delivery", addressId, courierId, serviceId, approvedPricing }`, or replaces `addressId` with `{ newAddress, saveAddress, saveRequestId }` for a new inline destination. `saveRequestId` is a UUID unique to that destination attempt, used to avoid duplicate saved address rows on a repeated request. No pickup slots are accepted for delivery. The server reloads owned cart/current prices, stock, branch origin, owned canonical address or revalidated inline destination, parcel parameters and current rates. Browser pricing is approval only, not the source of money.

A changed price/tax/shipping breakdown or unavailable selected service returns 409 `DELIVERY_REPRICE_REQUIRED` before local order/reservation/SO/Snap writes, with fresh services. Review shows the new money and "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan." Confirmation is cleared; placement requires another explicit click. A vanished service returns the customer to service selection. Failed/empty rates never become zero shipping.

Approved orders persist `fulfillment_method: delivery` and JSONB `delivery_snapshot` with five deep-independent blocks: canonical address, origin sender, measured parcel, courier service and website pricing. IDs/postcodes remain strings. Order items separately retain goods prices/quantities. An unsaved checkout destination has a null address FK and the same immutable snapshot. Saving is optional and happens inside the approved local order transaction; a rejected reprice/quote does not create a book row. Address-book deletion only nulls the address FK; editing/deleting the book, changing branch/master/config or later rates cannot rewrite the snapshot or order money. Customer review/detail show the destination and service, not pickup instructions.

## Two ledgers and payment (LEGACY — gate `0`)

> **LEGACY.** Contoh di bawah memakai formula versi 0: PPN delivery dihitung
> atas barang **ditambah ongkir**. Kontrak berversi (gate `1`) memakai PPN atas
> barang saja; lihat [bagian berikut](#dua-ledger-kontrak-berversi-gate-1).

For goods Rp100,000 + rates Rp20,000 + website PPN 11%:

- Jubelio SO/invoice/payment: **Rp100,000**, zero SO tax/discount, no shipping.
- Website/Midtrans: **Rp133,200**, including **Rp13,200** website PPN.
- Snap items contain goods, a separate SHIPPING line, and PPN; their sum equals gross_amount and orders.total.

Local reservation and one durable SO create intent precede the once-only POST. Independent SO GET confirmation precedes Snap. Ambiguous remote outcomes are not blindly retried. Repayment uses stored order/order-item money and the existing SO/Snap link, never a new quote/address/master price.

Authoritative Midtrans settlement is necessary but not sufficient for delivery eligibility. Jubelio invoice and payment must also be GET-verified. Verified delivery remains paid/processing, has no pickup code, sends no pickup-ready email, and bypasses pickup fulfillment/mirror. Ambiguous invoice/payment stays paid-but-blocked with a durable manual-review operation. Booking is a subsequent slice; placement/settlement never calls shipments/create.

## Dua ledger kontrak berversi (gate `1`)

Pada gate `1`, delivery memakai snapshot uang berversi. Untuk barang 150000 dan
ongkir quote 30000 (rate PPN 11% hanya fixture):

| Komponen | Nilai |
|---|---|
| Barang (net goods) | 150000 |
| PPN (barang saja) | 16500 |
| Ongkir net customer | 30000 |
| **Total customer / Midtrans** | **196500** |
| Jubelio SO/invoice/payment (expected payable) | **180000** |
| Service fee | 0 (tidak ditagih, tidak ada baris charge) |

Yang tetap terpisah dan tidak boleh saling diturunkan:

- `delivery_snapshot.service.shippingCost` = ongkir quote **sebelum** subsidi
  (original). Subsidy pada baseline `0`, jadi original dan net kebetulan sama —
  bukan asumsi permanen.
- `pricing.shippingCost` = ongkir net yang dibayar customer.
- Quote/booking cost provider (ongkir kurir) tidak ikut dipotong subsidi dan
  tidak disamakan dengan ongkir customer.
- `providerQuotedShippingCost`/`providerBilledShippingCost` disimpan `null`
  selama belum ada bukti biaya provider; biaya billed yang belum diketahui tetap
  `null`, bukan `0`.

Placement gate `1` memvalidasi bound sumber (uang integer Rupiah utuh, quantity
1..99, maksimal 50 baris) **sebelum** read region/ongkir provider, lalu menulis
order + kolom versi + `pricing_snapshot` + intent provider v2 dalam satu
transaksi. Approve/reprice tetap membandingkan approval browser dengan quote
server terbaru; browser tidak pernah menjadi sumber uang.

Repayment dan detail order memakai decoder versi (`readOrderPricing`) dan
snapshot tersimpan, bukan quote/alamat/master price terbaru. Snapshot unknown
version fail closed tanpa membuat pembayaran baru. Detail lengkap kontrak:
[versioned-checkout-pricing.md](versioned-checkout-pricing.md).

Admin detail order memakai decoder versi yang sama: `GET /api/admin/orders/{id}`
men-select kolom versi + `pricing_snapshot`, lalu — setelah RBAC/branch scope
lolos (cross-branch tetap 404) dan sebelum DTO uang maupun workflow delivery
dibangun — memanggil `readOrderPricing`. Nominal admin (`subtotal`, `discount`,
`shippingCost`, `serviceFee`, `ppnRate`, `ppnAmount`, `total`) dan
`pricingSnapshot` karena itu berasal dari snapshot tersimpan, bukan kolom
relational/master/config terbaru; baris item memakai quantity, harga efektif,
dan net line dari snapshot. Versi yang tidak dikenal atau corrupt fail closed
sebagai 500 generik dengan konteks terstruktur, read-only, tanpa provider write.

Baris service fee di UI checkout, halaman order store, dan row order admin sudah
kondisional (hanya dirender bila nominal > 0), jadi order kontrak baru tidak lagi
menampilkan "Biaya Layanan Rp 0".

Sisa sebelum gate dinaikkan adalah matriks kompatibilitas §8
[versioned-checkout-pricing.md](versioned-checkout-pricing.md); selama itu belum
terbukti, `discounts.contractVersion` tetap `0`.

## Verification

`delivery-order.test.ts` verifies deep-independent JSON snapshots and approval comparisons. Settlement/Midtrans unit tests cover delivery's pickup exclusion and the shipping line sum. `delivery-order-mock.spec.ts` uses isolated local providers plus real PostgreSQL for SO ledger/confirmation, inline unsaved/saved destinations, save-intent deduplication, snapshot drift/deletion, repayment, order-time reprice approval, normal settlement and ambiguous settlement. It also checks review/detail destination display and that delivery detail omits pickup instructions. No live provider write is part of verification.
