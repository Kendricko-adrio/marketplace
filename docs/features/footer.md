# Footer Config CMS

HQ-managed footer content for the storefront. A single `footer_config` row
holds the whole footer (brand, tagline, link columns, social media, copyright)
as JSONB; the storefront renders it on every page via a shared `<Footer />`
component from `@marketplace/ui`.

## Data model

Table: `footer_config` (owned by `packages/db/src/schema/footer.ts`)

| Column | Notes |
|---|---|
| `id` | `text` primary key (UUID generated in app code) |
| `data` | `jsonb`, full `FooterConfigData` shape, default `{}` |
| `updatedAt` | `timestamptz`, set on every save |
| `updatedBy` | FK to `users.id`, `onDelete: set null` |

**Singleton**: there should only ever be one row. Enforced in app code (both
the admin API and the storefront fetch `.limit(1)`), not by a DB constraint.

### Config shape (`FooterConfigData`)

| Field | Type | Limits |
|---|---|---|
| `brandName` | string | 1–100 chars, required |
| `tagline` | string | max 300 chars |
| `columns` | `FooterColumn[]` | **max 3 columns** |
| `columns[].title` | string | 1–100 chars, required |
| `columns[].links` | `FooterLink[]` | **max 5 links per column** |
| `columns[].links[]` | `{ label, href }` | label 1–100, href 1–500, both required |
| `copyrightText` | string | 1–200 chars, required |
| `socialMedia` | `SocialMediaLink[]` | 7 fixed platforms |

`SocialMediaLink` = `{ platform, url, enabled }`. Platforms are fixed to
`instagram | facebook | twitter | tiktok | youtube | linkedin | whatsapp` —
each renders with a dedicated icon (`SocialIcon` in
`packages/ui/src/components/footer/SocialIcons.tsx`). Only entries with
`enabled: true` **and** a non-empty `url` are rendered.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/footer` | admin-session (hq) | Fetch the singleton row's `data` (or `null` if no row) |
| PUT | `/api/admin/footer` | admin-session (hq) | Upsert the config (zod-validated) |
| GET | `/api/admin/linkable-destinations` | admin-session (hq) | Footer link target catalog |

- `GET` returns `{ success, data: null }` when no row exists — the admin form
  (`FooterForm`) falls back to empty strings (`?? ""`), not a default config.
- `PUT` validates the body with `footerConfigSchema` (the limits in the table
  above are the zod rules) and upserts: update the existing row (setting
  `updatedAt` + `updatedBy`), or insert with `crypto.randomUUID()`.
- No audit-log write (see `docs/api-reference.md`).

## Linkable destinations

`GET /api/admin/linkable-destinations` returns two categories, consumed by
`FooterLinkPicker` in the admin form:

- **`pages`** — published static pages (`isPublished = true`) from
  `static_page`, ordered by `displayOrder` then `title`, as
  `{ label: title, href: "/pages/<slug>" }`. See [static-pages.md](./static-pages.md).
- **`static`** — hardcoded storefront routes: Beranda `/`, Semua Produk
  `/products`, Cabang `/branches`, Keranjang Belanja `/cart`, Checkout
  `/checkout`, Akun Saya `/account`, Masuk `/login`, Daftar `/register`.
  Auth-gated routes are safe to link: the storefront middleware redirects
  guests to `/login?callbackUrl=`.

The picker also allows a free **external URL** (`https://...`) per link. The
storefront `<Footer />` renders external hrefs as `<a target="_blank"
rel="noopener noreferrer">` and internal ones as `<Link>`.

## HQ-only

- Page gate: `apps/admin/src/app/admin/footer/layout.tsx` hard-redirects
  non-`hq` sessions to `/admin?error=forbidden`.
- API gate: both routes use `withAuth(..., ["hq"])`.
- Rationale: footer content affects every storefront page, so only HQ may
  edit it.

## Storefront rendering

- `apps/store/src/app/layout.tsx` passes `<FooterWrapper />` as the footer
  slot of `LayoutWrapper`.
- `FooterWrapper` (`apps/store/src/components/FooterWrapper.tsx`) is an async
  Server Component with `export const dynamic = "force-dynamic"` — it fetches
  the row fresh on every request so admin edits appear immediately (without
  this, Next.js could statically render the footer once at build time).
- It passes `config` to the shared `<Footer />`
  (`packages/ui/src/components/footer/Footer.tsx`), which falls back to an
  empty object (`config ?? ({} as FooterConfigData)`) when the row is missing
  or the query fails — the footer renders empty (no brand, columns, or
  copyright) until a `footer_config` row exists.
- `DEFAULT_FOOTER_CONFIG` is defined in `packages/db/src/schema/footer.ts` but
  is currently **dead code** — nothing imports it. The seeder
  (`packages/db/src/seed.ts`) hardcodes the same default values inline (a
  mirror of the constant).

## Admin UI

`/admin/footer` (page + `FooterForm` client component):

- Brand section (name + tagline with 300-char counter).
- Up to 3 link columns, each with up to 5 links; each link row has a
  `FooterLinkPicker` (pages / static routes / external URL) that auto-fills
  the label when empty.
- Social media: all 7 platforms pre-filled, disabled by default; URL input
  enabled only when the platform switch is on.
- Copyright text.
- Live **Preview** dialog renders the same `<Footer />` component with the
  current form state.
- Client-side validation mirrors the server zod limits (max 3 columns, max 5
  links per column, required brand/copyright).

## Decisions

- **Singleton row, JSONB payload**: one row per deployment; the whole config
  is one JSON document. Simpler than a normalized table for a single global
  footer, and the storefront reads it with one query.
- **HQ-only**: footer is global storefront chrome; branch admins cannot edit.
- **`force-dynamic` on the storefront wrapper**: guarantees admin edits are
  picked up without a redeploy/rebuild.
- **No runtime default**: the storefront's actual fallback is an empty object,
  so a fresh DB (before seeding) renders an empty footer. The pre-CMS default
  values survive only as `DEFAULT_FOOTER_CONFIG` (dead code) and the seeder's
  inline copy.
- **Fixed platform enum**: social icons are per-platform SVGs, so platforms
  are a closed set rather than free-form labels.
- **Link catalog instead of free text**: footer links are picked from
  published pages + verified static routes (or an explicit external URL),
  reducing broken links.

## Verification

- Admin: log in as HQ → `/admin/footer` → edit brand/tagline, add a column
  with links from the picker (page + static + external), enable a social
  platform with a URL, save → toast "Konfigurasi footer tersimpan".
- Storefront: reload any store page → footer shows the new brand, columns,
  social icons (external links open in a new tab), and copyright.
- Fallback: with no `footer_config` row (fresh DB before seed), the storefront
  renders an empty footer (no brand, columns, or copyright) — run the seeder
  to get the default content.
- RBAC: a branch admin session gets redirected from `/admin/footer` and gets
  403 from `GET /api/admin/footer`.
- Limits: the API rejects >3 columns, >5 links per column, empty brandName /
  copyrightText, and unknown social platforms (400 with zod details).
- `npm run lint` and `tsc --noEmit` clean across `packages/db`, `apps/store`,
  `apps/admin`.

## Related

- Endpoint details: [docs/api-reference.md](./api-reference.md)
- Static pages (the `pages` link category): [docs/features/static-pages.md](./static-pages.md)
