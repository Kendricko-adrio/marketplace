# Product Filters

Product filtering on the storefront `/products` page and in the admin homepage
CMS (carousel "filter" mode + promo cards). Built on top of the sync-managed
product master data (Jubelio) — specifically the normalized `brand` and `gender`
dimensions — plus the already-supported sort and "on sale" (hasDiscount) filters.

## Why

The master-data sync (migration `0004`) added free-text `brand` / `gender` /
`season` / `collection` / `articleNumber` fields to products, but none were
selectable in
the UI. The `/products` sidebar only exposed search, category, and price range,
even though the `/api/products` endpoint already accepted `sortBy` / `sortOrder`
/ `hasDiscount`. This work surfaces that data as real filter choices on two
surfaces: the storefront product list and the admin homepage editor.

## Decisions

- **Filter fields added**: `brand` + `gender` (single-select dropdown, stored as
  **slugs**). `season` / `collection` / `articleNumber` are intentionally **not**
  filtered (out of scope).
- **Normalization**: `brand` and `gender` are **dimension tables** (`brands`,
  `genders`) linked to `products` via `brandId` / `genderId` FKs — not free-text
  columns. The free-text `product.brand` / `product.gender` columns were dropped
  (migrations `0006` + `0007`).
- **Sync-managed, no admin CRUD**: brand/gender rows are auto-created by the
  Jubelio import / webhook (upserted by slug from the supplier master data).
  There is no admin brand/gender management page — the dimension list is owned
  by the supplier sync, matching the push-managed replica design (see
  [jubelio-sync.md](./jubelio-sync.md)).
- **Easy wins exposed**: a sort dropdown (Terbaru / Harga Termurah / Harga
  Termahal) and a "Hanya produk diskon" (`hasDiscount`) toggle — both were
  already supported by `/api/products` but hidden from the UI.
- **Single-select**: each filter is one value (dropdown), so `ProductFilterConfig`
  fields stay `string`, not `string[]`.

## The shared filter shape

`ProductFilterConfig` (`packages/db/src/schema/homepage.ts`) is the single source
of truth for the carousel/promo filter, and its field names deliberately match
the `/api/products` query string:

```ts
interface ProductFilterConfig {
  search?: string;
  category?: string; // category slug
  brand?: string;    // brand slug
  gender?: string;   // gender slug
  minPrice?: string;
  maxPrice?: string;
  hasDiscount?: boolean;
  sortOrder?: "newest" | "priceAsc" | "priceDesc";
}
```

A single helper serializes this shape to a `/products` query string for every
surface — `buildProductFilterParams` / `buildProductFilterQuery` /
`buildStoreFilterQuery` in `packages/ui/src/components/homepage/filter-query.ts`
(exported via `@marketplace/ui`). **Add a new filter field here once** and it
propagates to the storefront sidebar, carousel filter mode, promo card links,
and admin preview. (Previously this mapping was duplicated in three files —
`PromoCardsSection`, `CarouselProductSectionForm`, `HomepageSectionForm` — which
has been consolidated.)

## Surfaces

### Storefront `/products`

- Sidebar (`apps/store/src/components/ProductFilters.tsx`): search, category
  (single-select checkbox list), **brand dropdown**, **gender dropdown**, price
  range, **sort dropdown**, **hasDiscount toggle**. Options for brand/gender are
  fetched from `GET /api/brands` and `GET /api/genders`.
- Page (`apps/store/src/app/products/page.tsx`): forwards `brand`, `gender`
  (plus the existing `sortBy` / `sortOrder` / `hasDiscount`) to `/api/products`.
- API (`apps/store/src/app/api/products/route.ts`): resolves `brand` / `gender`
  slugs to ids and applies `eq(products.brandId, …)` / `eq(products.genderId, …)`.
  Category is now a junction-table subquery. **All filters apply to both the list
  and the count query**, so `pagination.total` is correct under any combination
  (this also fixes the previous count/category mismatch). Unknown slug → 0 results.

### Admin homepage CMS

- `ProductFilterEditor` (`apps/admin/.../homepage/ProductFilterEditor.tsx`): the
  shared editor used by the carousel filter mode and per promo card. Adds
  **Brand** and **Gender** dropdowns (sourced from `GET /api/admin/brands` and
  `GET /api/admin/genders`), with `showBrand` / `showGender` props (default true)
  mirroring the existing `showSort` / `showHasDiscount` toggles.
- Validation: the Zod `productFilterSchema` in both
  `apps/admin/.../api/admin/homepage/route.ts` and `[…]/[id]/route.ts` accepts
  `brand` / `gender` (optional slugs).
- Preview: the `preview-products` proxy whitelist forwards `brand` / `gender`;
  `preview-all`'s `resolveFilterModeProducts` mirrors the storefront resolution.
- Promo cards: each card's `filter` is serialized via `buildProductFilterQuery`
  into a `/products?brand=…&gender=…` link the customer navigates to.

## Schema & sync

- New tables: `brand` (`id`, `name`, `slug` unique, timestamps), `gender` (same).
  `products.brandId` → `brand.id`, `products.genderId` → `gender.id` (nullable).
- Migrations: `0006_low_snowbird.sql` (create dimensions + add FK columns) and
  `0007_cuddly_hellion.sql` (drop the old free-text `brand` / `gender` columns).
  Generated via a staged `db:generate` (additions first, then drops) to avoid the
  drizzle-kit rename prompt. The DB is `db:push`-managed — apply with
  `npm run db:push` or the migration SQL directly.
- Jubelio sync (`packages/db/src/jubelio-sync.ts`): upserts `brands` / `genders`
  **before** products (FK order), by slug, then sets `products.brandId` /
  `genderId` (insert + on-conflict update). Both the import and the webhook flow
  through this one module.
- Seeder (`packages/db/src/seed.ts`): upserts demo brands/genders and links demo
  products via `brandId` / `genderId`.

## Populating after the schema change

The DB is a push-managed replica, so re-populate from the source after applying
the migration:

```
npm run db:reset && npm run db:seed      # dev demo data (includes brands/genders)
# or, for supplier master data:
npm run db:import-jubelio                # idempotent; (re)creates brands/genders + sets brandId/genderId
```

No SQL backfill is used: the sync creates dimension rows with deterministic sha1
ids (`keyId`), and a SQL backfill with a different id scheme would break the
subsequent sync's FK. Re-running the sync/seed is the canonical way to populate.

## Verification

- `/products`: combine brand + gender + sort + hasDiscount + price; check the URL
  params, result set, and `pagination.total` (correct under category/brand/gender).
- Admin: edit a `carousel_product` section in filter mode with brand + gender +
  sort + hasDiscount → save → preview renders; edit a promo card filter → save →
  on the storefront the card links to `/products?brand=…&gender=…` with the right
  results.
- Jubelio: re-run `npm run db:import-jubelio` → `brand` / `gender` tables
  repopulate, `products.brand_id` / `gender_id` set.
- `npm run lint` and `tsc --noEmit` clean across `packages/db`, `apps/store`,
  `apps/admin`.