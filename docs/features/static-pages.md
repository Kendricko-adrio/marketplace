# Static Pages

HQ-managed static pages (Tentang, Syarat & Ketentuan, Privasi, Kontak, …)
with markdown content, rendered on the storefront at `/pages/[slug]`. Pages
also feed the footer link catalog, so they are the CMS-backed half of footer
navigation.

## Data model

Table: `static_page` (owned by `packages/db/src/schema/pages.ts`)

| Column | Notes |
|---|---|
| `id` | `text` primary key (UUID generated in app code) |
| `slug` | `text`, **unique**, regex `^[a-z0-9-]+$` (lowercase, digits, hyphens) |
| `title` | `text`, required |
| `content` | `text`, markdown source, default `""` |
| `isPublished` | boolean, default `true`; unpublished pages 404 on the storefront |
| `displayOrder` | integer, default 0 (used for footer link ordering) |
| `createdAt` / `updatedAt` | `timestamptz` |

## Endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/admin/pages` | pages:view | List all pages ordered by `displayOrder` then `updatedAt` |
| POST | `/api/admin/pages` | pages:edit | Create a page |
| GET | `/api/admin/pages/{id}` | pages:view | Fetch one page |
| PUT | `/api/admin/pages/{id}` | pages:edit | Update a page (partial) |
| DELETE | `/api/admin/pages/{id}` | pages:delete | Delete a page |

- **Slug validation**: zod regex `^[a-z0-9-]+$`, max 60 chars — enforced on
  both create and update.
- **Duplicate slug → 409**: `POST` checks the slug before insert; `PUT`
  checks uniqueness excluding self (`ne(id)`). Error message:
  `"Slug sudah digunakan."`
- Missing page → 404 `"Halaman tidak ditemukan."`
- No audit-log write (see `docs/api-reference.md`).

## Admin UI

`/admin/pages` (list) + `/admin/pages/new` + `/admin/pages/[id]/edit`:

- Table with search (title or slug), status badge (Dipublikasi / Draft),
  display order, relative "Diperbarui" time, and per-row actions
  (Edit / Hapus with confirm dialog).
- Create/edit form: slug (with the lowercase-hyphen rule), title, markdown
  content editor, published toggle, display order.
- Buttons are gated by `hasPermission("pages", …)`; the layout enforces
  HQ-only (same pattern as the footer page).

## Storefront rendering

`apps/store/src/app/pages/[slug]/page.tsx`:

- `export const dynamic = "force-dynamic"` — content is fetched fresh per
  request so admin edits appear immediately.
- Queries `static_page` where `slug = …` **and** `isPublished = true`;
  unpublished or unknown slugs → `notFound()` (404).
- `generateMetadata` sets the page title from the row.
- Content is rendered with `MarkdownRenderer` from `@marketplace/ui`
  (`packages/ui/src/components/markdown/MarkdownRenderer.tsx`):
  `react-markdown` + `remark-gfm` (tables, strikethrough, task lists) +
  `rehype-sanitize` (HTML is sanitized — raw HTML in content is stripped),
  with styled headings, links (open in new tab), code blocks, tables, etc.

## Footer integration

`GET /api/admin/linkable-destinations` (see [footer.md](./footer.md)) lists
**published** pages as the `pages` category of footer link targets:

- Query: `isPublished = true`, ordered by `displayOrder` then `title`.
- Each page becomes `{ label: title, href: "/pages/<slug>" }` in the
  `FooterLinkPicker`, so HQ can link any published page from the footer
  without typing a URL.
- Unpublishing a page removes it from the catalog; existing footer links to
  it will 404 on the storefront (the picker does not validate saved hrefs).

## Decisions

- **Markdown + sanitize**: content is markdown source rendered with
  `rehype-sanitize`, so HQ can write rich text (headings, tables, links) but
  cannot inject raw HTML/scripts into the storefront.
- **Slug is the public URL**: `/pages/<slug>` is stable and human-readable;
  uniqueness is enforced at the API (409) and by the DB unique constraint.
- **Draft via `isPublished`**: pages are created published by default; a
  draft page 404s on the storefront but stays editable in admin.
- **`force-dynamic`**: like the footer, static pages are re-fetched per
  request so CMS edits take effect without a rebuild.
- **Footer catalog = published pages only**: drafts never appear as link
  targets; ordering follows `displayOrder` so HQ controls footer link order
  from the pages list.

## Verification

- Admin: create a page with slug `tentang-kami` and markdown content →
  appears in the list with "Dipublikasi" badge; duplicate slug → 409
  "Slug sudah digunakan."; invalid slug (uppercase, spaces) → 400.
- Storefront: `/pages/tentang-kami` renders the title + formatted markdown
  (tables, code blocks, links open in new tab); raw HTML in content is
  stripped; unpublished page → 404.
- Footer: in `/admin/footer`, the link picker's "Halaman" tab lists the
  published page; selecting it fills `href = /pages/tentang-kami` and
  auto-fills the label; unpublishing removes it from the picker.
- RBAC: branch admin gets redirected from `/admin/pages` and 403 from the
  pages API.
- `npm run lint` and `tsc --noEmit` clean across `packages/db`, `apps/store`,
  `apps/admin`.

## Related

- Endpoint details: [docs/api-reference.md](./api-reference.md)
- Footer CMS (link catalog consumer): [docs/features/footer.md](./footer.md)
