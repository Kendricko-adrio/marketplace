# Client address book (delivery foundation)

Store clients manage their own recipient addresses at `/account/addresses` or enter a new delivery destination directly in checkout. Checkout offers independent **Simpan alamat** and **Jadikan alamat utama** choices: the latter is only available when saving. An unchecked save option leaves the address book unchanged while the order retains an immutable destination snapshot. An approved order saves the chosen new address atomically with the local order row; a quote or rejected pricing approval never saves it. Repeated accepted save requests with the same client-scoped UUID reuse that address row (not a second row); this is address-save deduplication, not a claim that retrying the entire checkout creates no second order. The current default address is preselected on the next checkout, but can be replaced. All endpoints require an onboarded store session; admin authentication is not accepted. Address changes do not constitute delivery activation: branch origin/master parcel data and the later checkout/fulfillment tickets remain prerequisites.

## API

- `GET /api/addresses`: list only the authenticated client's addresses.
- `POST /api/addresses`: create.
- `PATCH /api/addresses/{id}`: replace the address input.
- `DELETE /api/addresses/{id}`: delete.
- `POST /api/addresses/{id}/default`: atomically promote to default.

Create/update input: `recipientName`, `phone`, `fullAddress`, `provinceId`, `cityId`, `districtId`, `areaId`, `postalCode`, `isDefault`. Unknown properties are rejected. Region IDs and postal codes are strings, preserving leading zeros. Labels are resolved server-side from Shipment, not trusted from the browser. Invalid hierarchy/postcode rejects the write. Foreign/unknown address IDs return 404 without mutation. At most one default is enforced by a partial unique index; every mutation locks the client row inside a transaction. Removing the default does not automatically promote another address. Legacy addresses require verified region selection before they can be used for delivery.

`GET /api/shipment/regions?level=provinces` lists provinces. Use `level=cities|districts|areas&parentId={stringId}` for children. `JUBELIO_SHIPMENT_URL` configures the separate Shipment host, never the Omnichannel host. GET region lookups require no provider token. Failures never fabricate a postcode or silently reuse an old hierarchy.

The form clears all descendant selections and postcode when a parent changes. Save is disabled until required fields are supplied; server validation remains authoritative. Structured API logs exclude recipient names, phones, street addresses and raw provider responses.

## Branch origin and per-SKU parcels

The existing admin Branch form stores `shippingPhone`, `shippingAddress`, `shippingPostalCode`, and optional string `shippingAreaId`. Branch name is the sender. These nullable local fields are never overwritten by Jubelio location sync. `branches:edit` and existing branch scope apply; mutation and origin audit diff share one transaction. POST defaults omitted fields to null; PUT preserves omitted fields under the row lock, while explicit null/empty clears them. Supplied malformed values reject the whole write. Pickup-only branches may remain unconfigured.

Each synced SKU obtains parcel fields from `GET /inventory/items/{item_id}` separately, not from an assumed group dimension. Normalized integer grams and positive centimetre dimensions are stored in `product_variant.parcel_dimensions`; invalid master blocks become null. The documented master accepts numeric/string `package_weight/length/width/height` (see `docs/jubelio-api/dist.yaml`, `getProductResponse`; grams specified by the product input schema). Catalog sync now makes one additional sequential read per SKU; provider failures propagate through existing sync error handling rather than claiming successful master refresh.

IT configures `system_config` keys `shipment.parcelFallback` (JSON `{ "weight": 100, "length": 15, "width": 10, "height": 5 }`, per-unit grams/cm) and `shipment.packagingWeightGrams` (nonnegative integer text, e.g. `40`). These values are examples, not real operational measurements. Parcel parameters are re-read for each quote; they do not use the general PPN config cache. Seeder sets `shipment.packagingWeightGrams` to `15` grams and `shipment.parcelFallback` to `{ "weight": 250, "length": 30, "width": 20, "height": 10 }` (per-unit grams/cm), matching the approved local fallback. Seeded branches remain origin-null and legacy SKU dimensions remain null. Verify fallback dimensions and seeded packaging weight against actual SKU measurements and operational packaging before activation. Do not activate delivery before valid data exists.

`buildShipmentInputs` rejects inactive/missing/invalid origins, unusable master/fallback dimensions, invalid quantities/values and missing packaging. It sums per-unit grams times quantity plus packaging, and emits per-item dimensions without guessing a physical carton. For example, two 250g master items plus three 100g fallback items and 40g packaging produce `weight: 840` with two distinct `items[]` entries. Quote/payment/booking integration belongs to subsequent tickets.

## Verification

`client-addresses.db.test.ts` uses real PostgreSQL for ownership, CRUD and concurrent default changes. `shipment-regions.test.ts` checks canonical string IDs/postcodes, parent mismatch and postal mismatch. `e2e/store/addresses-mock.spec.ts`, run through `playwright.mock.config.ts`, exercises creation, editing, default changes/deletion and cross-client API isolation using local region fixtures. No live Jubelio writes are necessary.
