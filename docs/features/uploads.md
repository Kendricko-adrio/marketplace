# File Uploads

Admin-uploaded images (homepage banners, promo cards, product images) are
stored on a **shared local directory** and served publicly by the store app.
Both apps (`apps/store`, `apps/admin`) have their own `lib/uploads.ts` with
the same directory resolution, so files written by admin are immediately
visible to the store.

## Location

`getUploadsDir()` (both apps):

1. `UPLOADS_DIR` env var if set (prod: point it at a shared volume / CDN
   mount).
2. Fallback: `{repo_root}/public/uploads` — resolved as
   `path.resolve(process.cwd(), "..", "..", "public", "uploads")` (when
   running `next dev`/`next build`, cwd is the app dir, so this walks up to
   the repo root).

In dev both apps share the same folder, so admin uploads are served by the
store immediately. Files are organized in subfolders: `/uploads/{folder}/{uuid}.{ext}`.

## Helpers

`apps/admin/src/lib/uploads.ts`:

| Constant | Value |
|---|---|
| `ALLOWED_FOLDERS` | `["products", "homepage", "orders"]` |
| `MAX_FILE_SIZE` | `5 * 1024 * 1024` (5 MB) |
| `ALLOWED_TYPES` | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |

| Function | Behavior |
|---|---|
| `getUploadsDir()` | Resolve dir (env → repo-root fallback) |
| `saveFile(folder, filename, buffer)` | `mkdir -p` the folder, write the file |
| `deleteFile(fileUrl)` | No-op unless URL starts with `/uploads/`; **rejects paths containing `..`** (path-traversal guard); unlinks if it exists |

`apps/store/src/lib/uploads.ts` has `getUploadsDir()` + `deleteFile()` with
the same guards (no `saveFile` — the store never writes uploads).

## Endpoints

### `POST /api/admin/upload` (admin app)

Auth: `withAuth(..., ["admin", "hq"])` — any authenticated admin.

- Query param `folder` (default `"products"`); must be in `ALLOWED_FOLDERS`
  → else 400 `"Invalid folder"`.
- Multipart form field `file` (required → 400 if missing).
- `file.type` must be in `ALLOWED_TYPES` → else 400.
- `file.size` ≤ 5 MB → else 400.
- Filename: `crypto.randomUUID()` + original extension (default `jpg`).
- Response: `{ success: true, url: "/uploads/{folder}/{uuid}.{ext}" }`.

### `DELETE /api/admin/upload` (admin app)

Auth: `withAuth(..., ["admin", "hq"])`.

- Query param `url` (required → 400); calls `deleteFile(url)`.
- Response: `{ success: true }`.

### `GET /uploads/{path...}` (store app)

`apps/store/src/app/uploads/[...path]/route.ts` — public file serving:

- **Path-traversal guard**: any segment containing `..` → 403.
- Missing file → 404.
- Content-Type from extension (`jpg`/`jpeg` → `image/jpeg`, `png`, `webp`,
  `gif`; anything else → `application/octet-stream`).
- **Cache**: `Cache-Control: public, max-age=31536000, immutable` — filenames
  are UUIDs, so content never changes for a given URL.

## Config

No uploads-specific config in `next.config.ts` (either app). Both apps set
`images.unoptimized: true`; the admin app adds `remotePatterns` for the store
host so `<Image>` can display store-served uploads. The admin app does **not**
serve `/uploads/` itself — admin UI resolves upload URLs against the store
origin via `toStoreUrl()` in `apps/admin/src/lib/store-url.ts`
(`NEXT_PUBLIC_STORE_URL`, default `http://localhost:3000`).

## Who uses uploads

| Consumer | Where | Notes |
|---|---|---|
| Homepage banner slides | `apps/admin/src/components/admin/homepage/BannerSectionForm.tsx` | Uploads per slide; deletes old `/uploads/` files on replace/remove |
| Homepage promo cards | `apps/admin/src/components/admin/homepage/PromoCardsSectionForm.tsx` | Same pattern |
| Homepage section update/delete | `apps/admin/src/app/api/admin/homepage/[id]/route.ts` | Extracts `/uploads/` URLs from JSONB content and deletes orphaned files |
| Product variant images | `apps/admin/src/components/admin/ProductForm.tsx` | Uploads; `DELETE /api/admin/upload` on image removal |
| Storefront rendering | `apps/store/src/app/page.tsx` → `HomepageSectionRenderer` (`@marketplace/ui`) | Renders the `/uploads/...` URLs stored in section content |

## Invariants (do NOT violate)

- **Only the admin app writes** — the store has no `saveFile`; it only serves
  and (in lib code) deletes.
- `deleteFile` and the serving route both **reject `..`** — never remove that
  guard.
- Folder must be one of `ALLOWED_FOLDERS`; type must be in `ALLOWED_TYPES`;
  size ≤ 5 MB — enforced server-side, not just in the UI.
- Filenames are always `randomUUID().{ext}` — never user-supplied names.
- Uploads are served with `immutable` caching because URLs are content-addressed
  by UUID; do not reuse a URL for different content.
- In prod, `UPLOADS_DIR` must point both apps at the same shared volume,
  otherwise admin writes and store serving diverge.

## Verification

- `npm run dev:admin` → upload an image via a homepage banner form → 200 with
  `url: /uploads/homepage/{uuid}.jpg`; file exists under
  `public/uploads/homepage/`.
- `npm run dev:store` → open the returned URL → image renders with
  `Cache-Control: public, max-age=31536000, immutable`.
- `GET /uploads/homepage/..%2F..%2F.env` (or any `..` path) → 403.
- `POST /api/admin/upload?folder=../../etc` → 400 `"Invalid folder"`; a
  `.txt` file → 400; a 6 MB image → 400.
- Remove a banner slide → the old file is deleted from disk (check
  `public/uploads/homepage/`).
