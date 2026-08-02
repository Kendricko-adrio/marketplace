# SOH Webhook — `POST /api/webhooks/soh`

Recurring product/stock master-data updates pushed by the third-party supplier.
The first full load is done via the [CSV import tool](./csv-import.md); this
endpoint handles subsequent deltas/snapshots.

- Canonical endpoint reference: [`../api-reference.md`](../api-reference.md)
  (Store → Webhooks).
- Design, invariants, and the `SohRecord` shape: [`README.md`](./README.md).

## Endpoint

`POST /api/webhooks/soh` — served by the **store** app
(`apps/store/src/app/api/webhooks/soh/route.ts`), alongside the Midtrans
webhook. `POST` only.

## Auth

Header `X-SOH-Webhook-Secret` must equal `process.env.SOH_WEBHOOK_SECRET` (same
pattern as `X-Cron-Secret` on the sweep cron).

| Condition | Status |
|---|---|
| `SOH_WEBHOOK_SECRET` unset on the server | **503** `{ error: "Webhook not configured" }` |
| header missing / mismatch | **401** `{ error: "Unauthorized" }` |

## Setup

- Generate a secret: `openssl rand -hex 32`.
- **Dev**: set `SOH_WEBHOOK_SECRET=...` in the **root `.env`** — the store app
  loads `../../.env` via `next.config.ts` (then `apps/store/.env.local`
  overrides if present). **Restart the dev server** after changing it.
- **Prod**: set it in `deployment/.env.production` — `docker-compose.yml`
  already wires `SOH_WEBHOOK_SECRET: ${SOH_WEBHOOK_SECRET}`.
- Templates already include `SOH_WEBHOOK_SECRET=`: root `.env.example`,
  `deployment/.env.staging.example`, `deployment/.env.production.example`.

## Request body

```json
{
  "records": [
    {
      "barcode": "4066765264091",
      "namaGudang": "ADFSport OUTLET SERPONG",
      "toko": "Adidas BSD",
      "brand": "ADIDAS",
      "prdsgroup": "Footwear",
      "sex": "Men",
      "art": "HP2001",
      "namaArtikel": "BOA JACKET",
      "size": "M",
      "rrp": "5,250,000",
      "disc": "50000",
      "nett": "600000",
      "status": "RUNNING APP WOMEN",
      "season": "SS25",
      "total": "3"
    }
  ]
}
```

- Field names are the **lowercase `SohRecord` field names** — note `disc`
  (**not** the CSV column `disc%`), `prdsgroup` (not `PRDSGROUP`), `namaGudang`,
  etc. See `SohRecord` / `SOH_CSV_HEADER_MAP` in `packages/db/src/soh-sync.ts`.
- Every field is coerced to a string; `null` / missing → `""`.
- `records` may be a **delta** (changed rows only) or a **full snapshot** — both
  are safe; the endpoint is upsert-only.
- Rows missing `art` or `namaGudang` are dropped before upsert.
- `brand` and `sex` are free-text names in the payload; the server resolves them
  into the `brands` / `genders` dimension tables (upsert by slug) and sets
  `product.brandId` / `genderId`. No `brandId` field is sent by the supplier.

## Behavior

1. Verify secret (503 / 401).
2. Parse JSON + validate with zod (400 on invalid JSON / payload).
3. Drop rows missing `art` / `namaGudang`.
4. `upsertSohRecords(db, records)` — batched idempotent upsert (mapping &
   invariants in [README](./README.md)).
5. Write an `auditLogs` row: `action="SOH_SYNC_WEBHOOK"`,
   `entityType="branch_stock"`, `changes={ summary, recordCount }`,
   `ipAddress` from `x-forwarded-for`.
6. Return 200 + summary.

## Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ success: true, branches, categories, brands, genders, products, variants, stockRows, totalQty }` | success |
| 400 | `{ success: false, error: "Invalid JSON body" }` or `{ error: "Invalid payload", issues }` | bad JSON / zod fail |
| 401 | `{ success: false, error: "Unauthorized" }` | secret mismatch / missing |
| 503 | `{ success: false, error: "Webhook not configured" }` | `SOH_WEBHOOK_SECRET` unset |
| 500 | `{ success: false, error: "Sync failed" }` | upsert threw |

## Invariants enforced here

- Upsert-only — **never deletes** products/stock.
- `branch_stock.reservedStock` never touched.
- New branches created `nonaktif`; existing branches preserve status.
- Replays are safe (idempotent on natural keys).

## curl examples

```
# success (200) — note "disc", NOT "disc%"
curl -X POST http://localhost:3000/api/webhooks/soh \
  -H "X-SOH-Webhook-Secret: $SOH_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"records":[{"barcode":"4066765264091","namaGudang":"ADFSport OUTLET SERPONG","toko":"Adidas BSD","brand":"ADIDAS","prdsgroup":"Footwear","sex":"Men","art":"HP2001","namaArtikel":"BOA JACKET","size":"M","rrp":"5,250,000","disc":"50000","nett":"600000","status":"RUNNING APP WOMEN","season":"SS25","total":"3"}]}'

# wrong/missing secret -> 401
curl -X POST http://localhost:3000/api/webhooks/soh \
  -H "Content-Type: application/json" -d '{"records":[]}'

# invalid payload -> 400
curl -X POST http://localhost:3000/api/webhooks/soh \
  -H "X-SOH-Webhook-Secret: $SOH_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"records":"not-an-array"}'
```

## Verification

- 200 response → check the returned summary; spot-check the upserted row in DB
  (e.g. the `product_variant` with `sku = "${art}-${size}"` got
  `discount="50000"`).
- Re-send the same payload → identical summary, no duplicates (proves the
  UPDATE path of the upsert).
- Wrong secret → 401. `SOH_WEBHOOK_SECRET` unset (stop server, unset, restart)
  → 503.
- Check `audit_log` for the `SOH_SYNC_WEBHOOK` row (`changes.summary`,
  `changes.recordCount`).