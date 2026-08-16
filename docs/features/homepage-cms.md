# Homepage CMS

Admin-managed homepage sections for the storefront. Sections are stored in
`homepage_section` (with a `homepage_section_product` junction for manual
carousels), assembled by the public `GET /api/homepage` endpoint, and rendered
by shared section components from `@marketplace/ui`.

## Data model

Table: `homepage_section` (owned by `packages/db/src/schema/homepage.ts`)

| Column | Notes |
|---|---|
| `id` | `text` primary key (UUID generated in app code) |
| `type` | `banner \| carousel_product \| promo_cards \| announcement_bar \| store_banner` |
| `title` / `subtitle` | nullable text, rendered by most sections |
| `content` | `jsonb`, per-type shape (see below), default `{}` |
| `displayOrder` | integer, ascending order of rendering |
| `isActive` | boolean, default `true`; inactive sections are hidden from customers |
| `createdAt` / `updatedAt` | `timestamptz` |

Table: `homepage_section_product` (junction, only used by **manual** carousels)

| Column | Notes |
|---|---|
| `sectionId` | FK → `homepage_section.id`, cascade delete |
| `productId` | FK → `products.id`, cascade delete |
| `displayOrder` | position of the product inside the carousel |

Composite primary key `(sectionId, productId)`.

## Section types & content shapes

| Type | Content shape | Notes |
|---|---|---|
| `banner` | `{ slides: [{ imageUrl, altText? }] (max 5), ctaText?, ctaLink?, autoRotateIntervalSec? (2–30, default 5) }` | Hero carousel; title/subtitle/CTA shared across slides |
| `carousel_product` | `{ mode: "manual" \| "filter", filter?: ProductFilterConfig, limit?: 1–20 (default 10) }` | `manual` uses the junction table; `filter` resolves products dynamically at render time (junction unused) |
| `promo_cards` | `{ cards: [{ id, imageUrl, title, filter? }] (max 6) }` | `filter` undefined → non-clickable card; otherwise the card links to `/products?…` |
| `announcement_bar` | `{ message, variant?: "info" \| "warning" \| "success" }` | Dismissible by visitors (per-section `localStorage` key); rendered above all other sections |
| `store_banner` | free-form (no zod validation) | Renders a grid of **active** branches (`branches.status = "aktif"`), hydrated server-side |

`ProductFilterConfig` (`search`, `category`, `brand`, `gender`, `minPrice`,
`maxPrice`, `hasDiscount`, `sortOrder`) is the shared filter shape — see
[product-filters.md](./product-filters.md) for the full story; this doc only
covers how the homepage CMS uses it.

## Endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/admin/homepage` | homepage:view | List all sections by `displayOrder`, carousel products hydrated |
| POST | `/api/admin/homepage` | homepage:edit | Create a section (per-type content validation) |
| GET | `/api/admin/homepage/{id}` | homepage:view | Fetch one section + linked products |
| PATCH | `/api/admin/homepage/{id}` | homepage:edit | Update a section (content, isActive, displayOrder, productIds) |
| DELETE | `/api/admin/homepage/{id}` | homepage:delete | Delete section + its image files |
| PATCH | `/api/admin/homepage/reorder` | homepage:edit | Bulk-update `displayOrder` for all sections |
| GET | `/api/admin/homepage/preview-all` | homepage:view | All sections (incl. inactive), fully hydrated |
| GET | `/api/admin/homepage/preview-products` | homepage:view | Server-side proxy to storefront `/api/products` |
| GET | `/api/homepage` (store) | public | Assemble **active** sections, hydrated |

### Create / update

- Both `route.ts` and `[id]/route.ts` validate `content` **per type** with
  zod (`validateContent`): banner slides ≤ 5, carousel limit 1–20, promo
  cards ≤ 6, announcement variant enum. `store_banner` passes through
  unvalidated. Invalid shape → 400 with details.
- `POST` assigns `displayOrder = max + 1`; junction rows are inserted only
  when `type === "carousel_product"` **and** `mode !== "filter"`.
- `PATCH` clears and re-inserts junction rows when `productIds` is provided
  (again skipped in filter mode).

### Image lifecycle

- Banner slides and promo card images are uploaded via the admin upload
  endpoint and stored as `/uploads/...` URLs inside `content`.
- `extractImageUrls` collects those URLs from `banner.slides[].imageUrl` and
  `promo_cards.cards[].imageUrl` (only these two types store images).
- **On update**: when content changes for banner/promo, URLs that are no
  longer referenced are deleted from disk via `deleteFile` (per-file errors
  swallowed).
- **On delete**: all referenced image files are deleted before the DB row.
- Orphaned uploads (uploaded but never saved into a section) are not swept
  by this module.

### Preview

- `preview-all` mirrors the storefront assembly (manual junction hydration,
  `resolveFilterModeProducts` for filter mode, active branches for
  `store_banner`) but returns **all** sections — the public endpoint only
  returns active ones, so it cannot preview inactive sections.
- `preview-products` forwards a whitelist of filter params to the storefront
  `/api/products` (server-to-server, no CORS) so the admin editor can preview
  filter-mode results.
- The admin preview page (`/admin/homepage/preview`) rewrites `/uploads/...`
  image paths to the store origin (`toStoreUrl`) because the admin app does
  not serve them, and renders with `preview` mode (announcement bar not
  dismissible, inactive sections flagged with a badge).

## Storefront assembly

`apps/store/src/app/api/homepage/route.ts`:

1. Selects sections where `isActive = true`, ordered by `displayOrder`.
2. Manual carousels: junction rows → products; price = cheapest variant net
   price, image = product `thumbnail` (Jubelio CDN) falling back to the
   default variant's first image, gender name resolved via `genders`.
3. Filter carousels: `resolveFilterModeProducts` runs the same filter logic as
   `/api/products` (status `aktif`, search, brand/gender slug → id, category
   junction subquery, hasDiscount = `basePrice > min variant price`, price
   range, sort) with `limit` clamped to 1–20.
4. `store_banner` sections get `branches` = active branches ordered by name.
5. `apps/store/src/app/page.tsx` fetches this with `cache: "no-store"` and
   renders via `HomepageSectionRenderer` — the `announcement_bar` is rendered
   first, then the rest in order.

## Admin UI

- `/admin/homepage` — list with drag-and-drop reorder (dnd-kit → `reorder`
  endpoint), active toggle, edit/delete per row, "Tambah Section" dialog
  (one entry per type), and a Preview link.
- `/admin/homepage/new?type=…` and `/admin/homepage/[id]/edit` — per-type
  forms (`BannerSectionForm`, `CarouselProductSectionForm`,
  `PromoCardsSectionForm`, `AnnouncementBarSectionForm`,
  `StoreBannerSectionForm`).
- `ProductFilterEditor` — shared filter editor used by carousel filter mode
  and per promo card: search, category, brand, gender, sort, price range,
  hasDiscount (brand/gender sourced from `/api/admin/brands` and
  `/api/admin/genders`; `showBrand` / `showGender` / `showSort` /
  `showHasDiscount` / `showSearch` props toggle fields).
- `buildProductFilterParams` / `buildProductFilterQuery` /
  `buildStoreFilterQuery` in `packages/ui/src/components/homepage/filter-query.ts`
  serialize `ProductFilterConfig` → `/products` query string for promo card
  links and admin preview fetches.

## Decisions

- **JSONB content per section**: each section type has its own content shape
  validated by zod at the API boundary; the DB stores it opaquely. Adding a
  field means touching the schema type + zod + the form, not the DB.
- **Two carousel modes**: `manual` (curated, junction table) vs `filter`
  (dynamic, resolved at render time from `ProductFilterConfig`). Filter mode
  never touches the junction table, so a stale `productIds` payload is
  ignored.
- **`store_banner` is data-driven, not content**: it renders active branches
  from the DB; the section only contributes title/subtitle/position. No
  branch picker in the CMS.
- **Image cleanup on update/delete**: files referenced by removed slides/cards
  are deleted from disk to avoid orphaned uploads; only `/uploads/` URLs are
  considered.
- **Preview-all instead of proxying the public API**: the public endpoint
  filters `isActive`, so a separate admin endpoint hydrates everything
  including inactive sections.
- **Announcement bar pinned on top**: the storefront page renders it before
  all other sections regardless of `displayOrder`; dismissal is per-visitor
  `localStorage`, disabled in preview mode.

## Verification

- Admin: create each section type → edit → toggle active → reorder via drag →
  delete; check the list reflects changes and the preview page renders both
  active and inactive (badge "Nonaktif").
- Carousel manual: pick products → save → storefront shows them in order;
  switch to filter mode with brand/gender/sort/hasDiscount → save → storefront
  carousel matches `/products` results for the same filter (see
  [product-filters.md](./product-filters.md)).
- Promo cards: card with a filter links to `/products?brand=…&gender=…` with
  the right results; card without a filter is not clickable.
- Image cleanup: replace a banner slide image → the old file disappears from
  the uploads directory; delete a section → its images are gone.
- Storefront: `GET /api/homepage` returns only active sections in
  `displayOrder`; `store_banner` includes active branches; announcement bar
  renders on top and can be dismissed.
- `npm run lint` and `tsc --noEmit` clean across `packages/db`, `apps/store`,
  `apps/admin`.

## Related

- Filter details (ProductFilterConfig, brand/gender dimensions, shared
  helpers): [docs/features/product-filters.md](./product-filters.md)
- Endpoint details: [docs/api-reference.md](./api-reference.md)
