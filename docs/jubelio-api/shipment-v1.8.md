# Jubelio Shipment API — contract v1.8

Source: [`API Contract Jubelio Shipment v1.8.pdf`](../../API%20Contract%20Jubelio%20Shipment%20v1.8.pdf), 21 pages, maintained by Jubelio API Team (document metadata: created 2023-06-28, version v1.8). This is a transcription and implementation-oriented summary of the **provided PDF**, not a record of live API testing or confirmation that the marketplace tenant has Shipment enabled. Page references below refer to the PDF, not to `dist.yaml`.

**Different API:** Shipment uses `api-shipment.*.jubelio.com`; [`dist.yaml`](dist.yaml) describes the Omnichannel API at `api2.jubelio.com`. Do not reuse Omnichannel credentials, tokens, paths, or region IDs without verification. The PDF specifies `POST /rates/all`, **not** the `/webstore/rates/all` path seen in older plugin-based research. [PDF pp. 1, 17]

## Base URLs, authentication, and endpoint map

| Environment | Base URL |
|---|---|
| Production | `https://api-shipment.jubelio.com` |
| Staging / sandbox | `https://api-shipment.sandbox.jubelio.com` |

Configure `JUBELIO_SHIPMENT_URL` separately from the Omnichannel `JUBELIO_API_BASE_URL`. For the currently tested tenant, use `https://api-shipment.jubelio.com` even with sandbox credentials in mock mode; the public sandbox host does not recognize this tenant (see live-test notes below). The URL setting does not by itself enable Shipment integration.

Obtain Shipment `client_id` and `client_secret` after integrating with Jubelio Shipment. `POST /auth/generate-token` accepts `{ "client_id": "…", "client_secret": "…" }` and returns `{ "token": "…", "expires_in": 86400 }` in the success example. `expires_in` is described as seconds, but the attributes table calls its type `string` while the example is numeric. Shipment, rate, and webhook sections show a Bearer token / `authorization` header for outbound authenticated operations where indicated; configure server-side only and refresh before expiry. The PDF does not explicitly show an Authorization header for every GET (notably category/region lookup); confirm their authentication requirements with Jubelio. Never send credentials or tokens from the browser. [PDF pp. 1–2, 9–10, 12–18]

| Purpose | Method and path | PDF |
|---|---|---|
| Token | `POST /auth/generate-token` | pp. 1–2 |
| Create shipment / generate AWB | `POST /shipments/create` | pp. 2–4 |
| Cancel AWB | `POST /shipments/cancel` | pp. 4–5 |
| AWB detail and tracking | `GET /shipments/awb/{awb}` | pp. 5–9 |
| Service categories | `GET /services/categories` | p. 9 |
| Search / list regions | `GET /regions?name=jakarta` or `GET /regions` | pp. 9–11 |
| Provinces | `GET /region/provinces` | p. 12 |
| Cities by province | `GET /region/cities/{province_id}` | pp. 12–13 |
| Districts by city | `GET /region/districts/{city_id}` | pp. 13–14 |
| Areas by district | `GET /region/areas/{district_id}` | p. 14 |
| Rates by service category | `POST /rates` | pp. 14–16 |
| Rates across couriers | `POST /rates/all` | pp. 17–19 |
| Status callback (received by **our** server) | `POST /webhook` in the PDF; actual callback URL is configured in Shipment dashboard | pp. 19–21 |

The PDF shows HTTP 200 samples for successful calls and HTTP 500 examples (`statusCode`, `error`, `message`) for failures; it does **not** exhaustively define other HTTP status codes, retry rules, or rate limits. [PDF pp. 1–21]

## Region and courier lookups

`GET /services/categories` returns an array of `{ service_category_id, name }`; examples are `1 REGULER`, `2 EKONOMI`, `3 NEXTDAY`, `4 INSTANT`, `5 SAMEDAY`, `6 CARGO`. These are examples, not a guaranteed current list of services available to this tenant. [PDF p. 9]

`GET /regions` returns region entries containing `name`, `province`, `city`, `district`, `area`, `area_id`, and `zipcode`; a `name` query is shown for searching. The hierarchical endpoints return `{ province_id, name }`, `{ city_id, province_id, name }`, `{ district_id, city_id, name }`, and `{ area_id, district_id, name, zipcode }` respectively. IDs and postcodes appear as **strings** in examples; preserve leading zeroes and use the returned IDs for mapping addresses. [PDF pp. 9–14]

## Quote shipping rates

### `POST /rates` and `POST /rates/all`

Both take origin and destination plus package weight. `/rates` additionally requires `service_category_id` to filter by category; `/rates/all` omits it. Both show an `authorization` Bearer token header. [PDF pp. 14–19]

| Request field | Contract | Notes |
|---|---|---|
| `origin.zipcode`, `destination.zipcode` | Required strings | Origin/destination postcodes. |
| `origin.area_id`, `destination.area_id` | Optional strings | Area / kelurahan IDs. |
| `origin.coordinate`, `destination.coordinate` | Optional strings | Examples use `(latitude,longitude)`; exact accepted formatting needs validation. |
| `weight` | Required number | Package weight; sample `1000`. The per-item and package-detail weight fields are explicitly in grams; confirm units for this top-level field before production. |
| `service_category_id` | Required for `/rates` only | Example `1` for REGULER. The table calls it `string` but the JSON sample is numeric. |
| `total_value` | Optional number | Declared value of the order. |
| `items[]` | Optional array | `quantity`, `weight` (grams), `length`, `width`, `height` (cm) in the example. |
| `package_detail` | Optional object | `width`, `height`, `length` (cm), `weight` (grams) in the field table; the request sample omits `package_detail.weight`. |

The PDF says **either** `items` **or** `package_detail` can be supplied for more accurate volumetric calculation. Both appear in its request samples; it does not specify whether both are required, how they are combined, or dimensional-weight rounding. [PDF pp. 15–18]

Example based on the `/rates/all` sample (sample values only; not a tested request): [PDF pp. 17–18]

```http
POST /rates/all
Authorization: Bearer <shipment-token>
Content-Type: application/json
```

```json
{
  "origin": { "area_id": "3174021004", "zipcode": "12920" },
  "destination": { "area_id": "3175101006", "zipcode": "17425" },
  "package_detail": { "width": 20, "height": 5, "length": 30 },
  "weight": 1000,
  "total_value": 40000
}
```

Success is an **array of courier services**, each with example fields `courier_id`, `courier_name`, `courier_service_id`, `courier_service_code`, `courier_service_name`, `courier_service_category`, `rates`, `eta_from`, `eta_to`, `is_cod_supported`, `courier_logo`, `shipping_insurance`, `cod_fee`, `discount_rates`, `final_rates`, and `promotion`. The attributes table additionally lists `insurance_info`, which is absent from the response samples. **The PDF explicitly instructs that the value for calculating shipping cost is `rates`, not `final_rates`**; do not substitute the seemingly discounted field without clarification from Jubelio. The examples do not specify quote TTL or a quote ID, nor do they guarantee that booking will charge exactly the earlier quote. [PDF pp. 16, 18–19]

## Create, cancel, and inspect an AWB

### `POST /shipments/create`

The PDF calls this *Generate AWB*; it requires a Bearer token and JSON body. [PDF pp. 2–4]

| Field | PDF requirement | Meaning / example |
|---|---|---|
| `ref_no` | Required string | Reference number; example `"[auto]"`, described as auto-generated. Whether a caller may set its own unique order reference or use it for idempotency is **not specified**. |
| `courier_id`, `courier_service_id` | Required numbers | Select the courier and specific service returned by rates; example `13`, `1327`. |
| `shipping_insurance` | Optional number | Insurance value; meaning (premium versus insured value) needs confirmation. |
| `is_cod` | Optional boolean | COD selection; check `is_cod_supported` from the chosen rate. |
| `origin`, `destination` | Required objects | Each requires `name`, `phone`, `address`, `zipcode` (strings); optional `email`, `area_id`, `coordinate`. |
| `items` | Required array | Item `item_name`, `quantity`, `value`, `weight` (grams), `length`, `width`, `height` (cm) shown as required in the table; `item_code` and `category` optional. Check valid minimums and interpretation of `value` with Jubelio. |
| `package_detail` | Optional object | Dimension / weight fields for more accurate volumetric rating; PDF table mentions width, height, length (cm), weight (grams). |

A successful sample returns `{ "shipment_id": 1281, "awb": "LSAJ8933UJFCCN0", "tracking_url": "https://shipmentwdgbcka.com", "price": 20000, "extra_info": {} }`. Persist both the Shipment ID and AWB; treat the returned `price` as a separate booking value to reconcile against the earlier `rates`. The sample request contains a missing comma in `origin` and does not include `package_detail.weight`; the representation above is a normalized field summary, not a verbatim executable sample. [PDF pp. 3–4]

### `POST /shipments/cancel`

Bearer-authenticated JSON body: `{ "cancel_reason": "Barang belum siap", "awb_code": "CM8439257324384" }` (correcting a malformed quote in the PDF's sample). On success, example fields are `status` (`"cancel successful"`), `awb_code`, `courier_name`, and `ref_no`. Cancellation is only possible **before courier pickup** and may still be rejected if the courier disallows it or pickup is too close. Failed cancellation examples include an HTTP 500 body and/or `{ "code": "INT_ERR", "message": "Cancel Shipment Failed" }`; do not assume a failed/timeout request means the AWB remains active without checking. [PDF pp. 4–5]

### `GET /shipments/awb/{awb}`

Bearer-authenticated lookup of the AWB returned by create. Success includes `shipment_id`, `ref_no`, `awb`, carrier/service identifiers and names, `price` / `price_bill`, pickup and ETA timestamps, `latest_status`, sender and recipient address fields, `items[]`, `tracking[]` with `{ date, status, status_detail }`, and optional image/tracking URLs and delivery metadata. The sample shows carrier-specific tracking codes such as `S01` (pickup) and `D09` (delivered), but does not provide a general carrier-code enum. Fields may be `null` or empty; avoid exposing private addresses and POD images without authorization. [PDF pp. 5–9]

Documented `latest_status` values: `WAITING`, `CONFIRMED_BY_COURIER`, `ON_THE_WAY_PICK_UP`, `PICKED_UP`, `ON_DELIVERY`, `ON_HOLD`, `DELIVERED`, `RETURNED`, `CANCELED`, `SHIPMENT_ISSUE`. This list appears both in AWB detail and in the webhook field table; treat unknown values as possible and do not equate `PICKED_UP` with `DELIVERED`. [PDF pp. 9, 20]

## Webhook: shipment updates

The PDF illustrates `POST /webhook` but says to configure the webhook in **Jubelio Shipment dashboard → Setting → Developer → Webhook**. This is an **inbound callback** to an application-controlled URL, not an outbound POST the marketplace makes to the Shipment API, and it is distinct from Omnichannel webhooks. [PDF pp. 19–20]

Example body fields: `event` (`"awb"`), `ref_no`, `awb`, `shipment_id`, `latest_status`, `courier` (`courier_id`, `courier_service_id`, `courier_name`, `courier_service_name`, `service_category_name`), `delivered_img_url`, `sign_img_url`, `live_tracking_url`, `tracking_url`, `pod_url`, and `tracking` (`date`, `status`, `status_detail`). The example's `latest_status` is `CANCELED` and `tracking.status` is `CNCL`. These are **two different status vocabularies**; reconcile against AWB detail rather than assuming every carrier tracking code is a normalized shipment status. Payload example fields are not an exhaustive event schema; event types and redelivery policy are not specified. [PDF pp. 20–21]

The `x-jubelio-signature` header carries a webhook signature. **Security ambiguity in the source:** prose says stringify the payload, append the secret, then apply SHA-256; the PDF's Node.js example actually computes `HMAC-SHA256(key = secret, message = payload + secret)` and compares hex strings. A plain SHA-256 digest and that HMAC are **not equivalent**. Obtain a known-good signed test payload and confirm the algorithm, exact raw-body encoding / stringify rules, and signature representation with Jubelio before accepting production callbacks. Verify on the server before mutating state; avoid reserializing JSON before verification, use constant-time comparison, and deduplicate/reconcile events. The PDF does not document webhook retries, replay protection, or ordering. [PDF p. 21]

## Integration boundaries / questions for Jubelio

These are gaps in the **PDF**, not additional contractual requirements:

1. Confirm tenant activation, sandbox credentials and whether region/category GET requests require authorization; never test write endpoints against production with real orders merely to discover behavior. [PDF pp. 1–2, 9–14]
2. Confirm quote `weight` units, dimensional-weight formula, service availability, price/insurance semantics, and how long a quote remains valid. The PDF's `rates` versus `final_rates` instruction must be followed unless Jubelio supplies a superseding contract. [PDF pp. 14–19]
3. Confirm `ref_no` behavior, booking idempotency and lookup after timeout, charge timing, and how to relate an Omnichannel Sales Order to a Shipment shipment. No Sales Order linkage or reliable booking-retry contract is specified here. [PDF pp. 2–5]
4. Confirm cancellation rules, status transition semantics, webhook signature algorithm and event retry/ordering with signed sandbox samples. [PDF pp. 4–9, 19–21]
5. This PDF has **no endpoint for shipping-label generation**; any label route found in a plugin or other documentation is not established by this contract. [PDF contents p. 1, endpoint sections pp. 1–21]

Related: [`docs/jubelio-api/README.md`](README.md) (Omnichannel spec index), [`plan/research/pengiriman-ke-rumah-jubelio.md`](../../plan/research/pengiriman-ke-rumah-jubelio.md) (earlier research written before this PDF was available; its plugin-based endpoint and missing-contract claims should be re-evaluated against this contract).

## Live verification notes (2026-09-27)

Outside the transcription — owner-approved per-request live checks (read-only, no booking; tokens held in memory only, never logged):

- **Production host** `api-shipment.jubelio.com`: `POST /auth/generate-token` → 200 (token 205 chars; `expires_in` is a **number** `86400`, resolving the contract's type ambiguity); `GET /services/categories` → 200 **with and without Bearer**; `GET /region/provinces` → 200 (34 provinces, IDs are **strings**); `GET /region/cities/11` → 200 (23 cities, string IDs); `POST /rates/all` with the contract's sample body → 200 with **19 courier services** (Lion Parcel, SiCepat, ID Express, TIKI, JNE, J&T, Paxel, Anteraja, etc.); all samples had `rates == final_rates`, `is_cod_supported` false, `eta_from/eta_to` as **absolute ISO timestamps**, and small `shipping_insurance` amounts (100–5100; semantics still unconfirmed).
- **Sandbox** `api-shipment.sandbox.jubelio.com` is alive (categories 200 without auth, same 7 categories) but rejected the tenant's credentials (`ERR_INPUT "Akun tidak ditemukan"`). **Owner clarification (2026-09-27):** the credentials are the tenant's **sandbox credentials operated via the production URL** — the tenant runs in sandbox/mock mode on that host (hence `MOCK-` AWBs); the separate public sandbox host does not recognize this account.
- Live category list = **7** (`1 REGULER, 2 EKONOMI, 3 NEXTDAY, 4 INSTANT, 5 SAMEDAY, 6 CARGO, 7 MUATAN TRUK PENUH`) — the PDF's 6-item list is explicitly example-only; document-vs-live drift is proven at this point.
- Not yet live-tested: `GET /regions` (search), `/region/districts|areas`, `POST /rates`, webhook, label. Remaining contract ambiguities (webhook signature, price semantics, quote TTL) still follow the vendor question draft in `.scratch/pengiriman-ke-rumah-jubelio/draf-pertanyaan-ke-jubelio.md`.
- **AWB lifecycle (owner-approved dummy booking, production URL):** `POST /shipments/create` → **201** (`shipment_id`, `awb` with **`MOCK-`** prefix — owner confirmed the tenant runs in sandbox/mock mode on this URL; `price` equals the quoted `rates`; `tracking_url` + `short_tracking_url` returned); `GET /shipments/awb/{awb}` → 200 (`latest_status: WAITING`, `ref_no` round-trips exactly, `price` and `price_bill` both present, normalized tracking); `POST /shipments/cancel` → 200 (`"Cancel Successful"`); a follow-up GET shows `latest_status: CANCELED` with a **normalized** `tracking[].status: "CANCELED"` — note this differs from the PDF's webhook example (`CNCL`), reinforcing the two-vocabularies caveat.
