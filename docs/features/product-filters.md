# Product Filters

Product filtering on the storefront `/products` page and in the admin homepage
CMS (carousel "filter" mode + promo cards). Built on top of the sync-managed
product master data (Jubelio) — specifically the normalized `brand` dimension —
plus the already-supported sort and "on sale" (hasDiscount) filters.

## Why

The master-data sync (migration `0004`) added free-text `brand` / `gender` /
`season` / `collection` / `articleNumber` fields to products, but none were
selectable in
the UI. The `/products` sidebar only exposed search, category, and price range,
even though the `/api/products` endpoint already accepted `sortBy` / `sortOrder`
/ `hasDiscount`. This work surfaces that data as real filter choices on two
surfaces: the storefront product list and the admin homepage editor.

## Decisions

- **Filter fields added**: `brand` (single-select dropdown, stored as a **slug**).
  `gender` / `season` / `collection` / `articleNumber` are intentionally **not**
  filtered (out of scope — the gender filter was removed from the storefront
  sidebar and the admin homepage editor; gender remains a display-only field on
  product cards and the product detail page).
- **Normalization**: `brand` is a **dimension table** (`brands`) linked to
  `products` via `brandId` FK — not a free-text column. The free-text
  `product.brand` / `product.gender` columns were dropped (migrations `0006` +
  `0007`).
- **Sync-managed, no admin CRUD**: brand rows are auto-created by the Jubelio
  import / webhook (upserted by slug from the supplier master data). There is no
  admin brand management page — the dimension list is owned by the supplier
  sync, matching the push-managed replica design (see
  [jubelio-sync.md](./jubelio-sync.md)).
- **Easy wins exposed**: a sort dropdown (Terbaru / Harga Termurah / Harga
  Termahal) and a "Hanya produk diskon" (`hasDiscount`) toggle — both were
  already supported by `/api/products` but hidden from the UI.
- **Single-select**: each filter is one value (dropdown), so `ProductFilterConfig`
  fields stay `string`, not `string[]`.
- **Category is a searchable combobox, not checkboxes**: the category dimension
  is large (Jubelio sync-managed, thousands of rows) — a checkbox list or a
  plain native `<select>` would be unusable. The storefront sidebar uses a
  shadcn `Command` + `Popover` combobox with a search input, and the URL
  reflects the selection (`/products?category=<slug>`).
- **Branch filter is stock-aware**: the sidebar's branch dropdown lists **active**
  branches only (sourced from `GET /api/branches`, which already filters
  `status = "aktif"`). Selecting a branch narrows results to products with at
  least one variant that has **available stock** (`stock - pendingRemoteStock > 0`)
  at that branch — a product with zero sellable units there is excluded, not
  greyed out.

## The shared filter shape

`ProductFilterConfig` (`packages/db/src/schema/homepage.ts`) is the single source
of truth for the carousel/promo filter, and its field names deliberately match
the `/api/products` query string:

```ts
interface ProductFilterConfig {
  search?: string;
  category?: string; // category slug
  brand?: string;    // brand slug
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

- Sidebar (`apps/store/src/components/ProductFilters.tsx`): search, **branch
  dropdown** (active branches only), **searchable category combobox**, **brand
  dropdown**, price range, **sort dropdown**. Options are fetched from
  `GET /api/categories`, `GET /api/brands`, and `GET /api/branches`. (The
  "Hanya produk diskon" toggle was removed from the sidebar; the API still
  accepts `hasDiscount` for direct links, e.g. admin promo cards.)
- The sidebar's URL building is a pure helper — `buildProductsQuery`
  (`apps/store/src/lib/product-filters.ts`, unit-tested) — which maps the
  filter state to the `/api/products` query string and always resets `page=1`.
- Page (`apps/store/src/app/products/page.tsx`): forwards `category`, `brand`,
  `branch` (plus the existing `sortBy` / `sortOrder` / `hasDiscount`) to
  `/api/products`.
- API (`apps/store/src/app/api/products/route.ts`): resolves the `brand` slug to
  an id and applies `eq(products.brandId, …)`. Category is a junction-table
  subquery. **Branch** (`branch` = branch id) is a subquery requiring at least
  one variant with available stock (`stock - pendingRemoteStock > 0`) at that branch.
  **All filters apply to both the list and the count query**, so
  `pagination.total` is correct under any combination (this also fixes the
  previous count/category mismatch). Unknown slug → 0 results.

### Admin homepage CMS

- `ProductFilterEditor` (`apps/admin/.../homepage/ProductFilterEditor.tsx`): the
  shared editor used by the carousel filter mode and per promo card. Adds a
  **Brand** dropdown (sourced from `GET /api/admin/brands`), with a `showBrand`
  prop (default true) mirroring the existing `showSort` / `showHasDiscount`
  toggles.
- Validation: the Zod `productFilterSchema` in both
  `apps/admin/.../api/admin/homepage/route.ts` and `[…]/[id]/route.ts` accepts
  `brand` (optional slug).
- Preview: the `preview-products` proxy whitelist forwards `brand`;
  `preview-all`'s `resolveFilterModeProducts` mirrors the storefront resolution.
- Promo cards: each card's `filter` is serialized via `buildProductFilterQuery`
  into a `/products?brand=…` link the customer navigates to.

## Schema & sync

- New table: `brand` (`id`, `name`, `slug` unique, timestamps). `products.brandId`
  → `brand.id` (nullable). (The `gender` dimension table still exists — it is
  sync-managed and used for display on cards / the product detail page, but is
  no longer a filter.)
- Migrations: `0006_low_snowbird.sql` (create dimensions + add FK columns) and
  `0007_cuddly_hellion.sql` (drop the old free-text `brand` / `gender` columns).
  Generated via a staged `db:generate` (additions first, then drops) to avoid the
  drizzle-kit rename prompt. The DB is `db:push`-managed — apply with
  `npm run db:push` or the migration SQL directly.
- Jubelio sync (`packages/db/src/jubelio-sync.ts`): upserts `brands` **before**
  products (FK order), by slug, then sets `products.brandId` (insert +
  on-conflict update). Both the import and the webhook flow through this one
  module.
- Seeder (`packages/db/src/seed.ts`): upserts demo brands and links demo
  products via `brandId`.

## Populating after the schema change

The DB is a push-managed replica, so re-populate from the source after applying
the migration:

```
npm run db:reset && npm run db:seed      # dev demo data (includes brands)
# or, for supplier master data:
npm run db:import-jubelio                # idempotent; (re)creates brands + sets brandId
```

No SQL backfill is used: the sync creates dimension rows with deterministic sha1
ids (`keyId`), and a SQL backfill with a different id scheme would break the
subsequent sync's FK. Re-running the sync/seed is the canonical way to populate.

## Verification

- `/products`: combine brand + sort + hasDiscount + price; check the URL
  params, result set, and `pagination.total` (correct under category/brand).
- Admin: edit a `carousel_product` section in filter mode with brand + sort +
  hasDiscount → save → preview renders; edit a promo card filter → save →
  on the storefront the card links to `/products?brand=…` with the right
  results.
- Jubelio: re-run `npm run db:import-jubelio` → `brand` table repopulates,
  `products.brand_id` set.
- `npm run lint` and `tsc --noEmit` clean across `packages/db`, `apps/store`,
  `apps/admin`.
