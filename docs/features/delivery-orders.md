# Delivery orders and settlement

Delivery placement uses the existing Sales Order checkout pipeline, never a second delivery SO or inventory adjustment. Pickup remains the default for legacy rows/requests.

## Approval and immutable data

`POST /api/checkout/place-order` accepts delivery input `{ itemIds, contactPhone, contactEmail, fulfillmentMethod: "delivery", addressId, courierId, serviceId, approvedPricing }`, or replaces `addressId` with `{ newAddress, saveAddress, saveRequestId }` for a new inline destination. `saveRequestId` is a UUID unique to that destination attempt, used to avoid duplicate saved address rows on a repeated request. No pickup slots are accepted for delivery. The server reloads owned cart/current prices, stock, branch origin, owned canonical address or revalidated inline destination, parcel parameters and current rates. Browser pricing is approval only, not the source of money.

A changed price/tax/shipping breakdown or unavailable selected service returns 409 `DELIVERY_REPRICE_REQUIRED` before local order/reservation/SO/Snap writes, with fresh services. Review shows the new money and "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan." Confirmation is cleared; placement requires another explicit click. A vanished service returns the customer to service selection. Failed/empty rates never become zero shipping.

Approved orders persist `fulfillment_method: delivery` and JSONB `delivery_snapshot` with five deep-independent blocks: canonical address, origin sender, measured parcel, courier service and website pricing. IDs/postcodes remain strings. Order items separately retain goods prices/quantities. An unsaved checkout destination has a null address FK and the same immutable snapshot. Saving is optional and happens inside the approved local order transaction; a rejected reprice/quote does not create a book row. Address-book deletion only nulls the address FK; editing/deleting the book, changing branch/master/config or later rates cannot rewrite the snapshot or order money. Customer review/detail show the destination and service, not pickup instructions.

## Two ledgers and payment

For goods Rp100,000 + rates Rp20,000 + website PPN 11%:

- Jubelio SO/invoice/payment: **Rp100,000**, zero SO tax/discount, no shipping.
- Website/Midtrans: **Rp133,200**, including **Rp13,200** website PPN.
- Snap items contain goods, a separate SHIPPING line, and PPN; their sum equals gross_amount and orders.total.

Local reservation and one durable SO create intent precede the once-only POST. Independent SO GET confirmation precedes Snap. Ambiguous remote outcomes are not blindly retried. Repayment uses stored order/order-item money and the existing SO/Snap link, never a new quote/address/master price.

Authoritative Midtrans settlement is necessary but not sufficient for delivery eligibility. Jubelio invoice and payment must also be GET-verified. Verified delivery remains paid/processing, has no pickup code, sends no pickup-ready email, and bypasses pickup fulfillment/mirror. Ambiguous invoice/payment stays paid-but-blocked with a durable manual-review operation. Booking is a subsequent slice; placement/settlement never calls shipments/create.

## Verification

`delivery-order.test.ts` verifies deep-independent JSON snapshots and approval comparisons. Settlement/Midtrans unit tests cover delivery's pickup exclusion and the shipping line sum. `delivery-order-mock.spec.ts` uses isolated local providers plus real PostgreSQL for SO ledger/confirmation, inline unsaved/saved destinations, save-intent deduplication, snapshot drift/deletion, repayment, order-time reprice approval, normal settlement and ambiguous settlement. It also checks review/detail destination display and that delivery detail omits pickup instructions. No live provider write is part of verification.
