# Vouchers (validate-only)

Status: **validate-only**. The `voucher` table and a validation endpoint exist,
but vouchers are **not** redeemable end-to-end yet — no redemption at
`place-order`, no checkout UI, no admin CRUD. See "Known gaps" below.

## Data model

Table: `voucher` (owned by `packages/db/src/schema/marketing.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `code` | text, unique, not null | Stored uppercase; matched case-insensitively |
| `discountType` | text, not null | `percentage` \| `fixed` \| `shipping` |
| `value` | numeric(15,2), not null | Percentage rate (e.g. `10` = 10%) or flat amount |
| `maxDiscount` | numeric(15,2) | Cap for `percentage` discounts |
| `minPurchase` | numeric(15,2), not null, default `0` | Minimum subtotal |
| `quota` | integer, not null, default `100` | Total redemptions allowed |
| `used` | integer, not null, default `0` | Redemptions so far |
| `isActive` | boolean, not null, default `true` | |
| `validFrom` / `validUntil` | timestamptz, not null | Active window |
| `createdAt` / `updatedAt` | timestamptz, not null | |

## Endpoint: `POST /api/vouchers/validate`

`apps/store/src/app/api/vouchers/validate/route.ts` — no auth.

- **Body**: JSON `{ code: string, subtotal?: string|number }` (no zod schema; `code` required, `subtotal` optional).
- **Validation order**:
  1. `code` missing → 400 `"Voucher code is required"`.
  2. Lookup `code.toUpperCase()` with `isActive = true` and `validFrom < now < validUntil` → 404 `"Voucher tidak ditemukan atau sudah tidak berlaku"`.
  3. `used >= quota` → 400 `"Kuota voucher sudah habis"`.
  4. `subtotal < minPurchase` (only when `subtotal` provided) → 400 `"Minimum belanja Rp ..."`.
  5. Discount preview (only when `subtotal` provided): `percentage` = `subtotal * value/100` capped at `maxDiscount`; `fixed`/`shipping` = flat `value`.
- **Response 200**: `{ success: true, data: { code, discountType, value, maxDiscount, minPurchase, discount, validUntil, remainingQuota } }` where `remainingQuota = quota - used`.
- **Read-only**: never increments `used` — redemption increments must happen at order placement (not implemented, see gaps).

## Seeding

`packages/db/src/seed.ts` ("Creating vouchers") inserts 3 sample vouchers:

| Code | Type | Value | maxDiscount | minPurchase | quota | used | isActive |
|---|---|---|---|---|---|---|---|
| `DISKON10` | percentage | 10 | 50000 | 50000 | 100 | 50 | true |
| `HMT25RB` | fixed | 25000 | — | 100000 | 50 | 10 | true |
| `ONGKIRFREE` | shipping | 20000 | 20000 | 0 | 200 | 200 | false (habis) |

## Admin UI

`apps/admin/src/app/admin/marketing/page.tsx` is a **placeholder** ("Segera
Hadir" / "Alat marketing sedang dalam pengembangan") — no voucher CRUD exists.

## Known gaps / belum diimplementasikan

- **No redemption**: `place-order` (`apps/store/src/app/api/checkout/place-order/route.ts`) and the checkout UI (`apps/store/src/app/checkout/page.tsx`) do not reference vouchers at all — verified by grep: the only `voucher` references in `apps/store/src` are inside the validate route itself. No discount is applied to order totals and `used` is never incremented anywhere.
- **No checkout UI**: no voucher input field on the checkout page.
- **No admin CRUD**: the Marketing page is a placeholder; vouchers can only be created/edited via seed or direct DB access.

## Invariants

- `code` is matched case-insensitively (compared after `toUpperCase()`).
- Validate is read-only — it must never mutate `used` or any other column.
- `discountType` is one of `percentage | fixed | shipping`; `shipping` currently behaves like `fixed` (flat `value`) in the discount preview.

## Env

None — the voucher feature has no environment variables.

## Verification

- `npm run db:seed` → 3 voucher rows (`DISKON10`, `HMT25RB`, `ONGKIRFREE`).
- `curl -X POST http://localhost:3000/api/vouchers/validate -H "Content-Type: application/json" -d '{"code":"diskon10","subtotal":100000}'` → 200 with `discount: 10000` (case-insensitive, capped at `maxDiscount` 50000).
- Same call with `subtotal: 40000` → 400 minimum purchase; `code: "ONGKIRFREE"` → 400 quota habis; `code: "TIDAKADA"` → 404.
- Confirm `used` is unchanged after validation (read-only).

See `docs/api-reference.md` → `POST /api/vouchers/validate` for the endpoint contract.
