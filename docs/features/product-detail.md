# Admin Product Detail

The admin product detail page (`/admin/products/{id}`) is the read-only view
for a single product, its gallery, variants, and per-branch stock. Products are
managed by Jubelio (source of truth); the admin dashboard only displays data
and triggers a per-product re-sync.

## Gallery

Images are hotlinked from the Jubelio CDN (product-level `images[]` JSONB).
If a product has no product-level images, the gallery falls back to the first
variant's images, then the product thumbnail.

The gallery renders as a **horizontal scroll row** (`flex gap-3 overflow-x-auto`)
so many images do not stretch the page vertically. Each image is fixed at
`h-40 w-40 shrink-0`.

## Variants & Stock (tabbed)

The lower section is a single card with two tabs powered by Radix Tabs
(`@/components/ui/tabs`):

### Varian tab

Shows the existing variant table: SKU, size, color, price, barcode, and
Jubelio `item_id`. The "Default" column marks the default variant.

### Stok tab

Shows per-variant stock **grouped by branch**. Each branch is a sub-block
with a heading (branch name, status badge, city/code) and a table of:
`SKU | Ukuran | Warna | Stok | Reserved | Tersedia`.

- `Stok` = physical units on hand (`branch_stock.stock`).
- `Reserved` = units held by pending-payment orders (`branch_stock.reserved_stock`).
- `Tersedia` = `max(0, stock - pendingRemoteStock)`. Confirmed reservations
  are already included in Jubelio's reduced `stock`.

#### Branch scoping (Current Policy)

The stock view is **server-side filtered** by the caller's Current Policy via
the unified `guard` (`apps/admin/src/lib/rbac/guard.ts`, `products:view`)
and `branchScopeFromAuthorization` (`apps/admin/src/lib/rbac/branch-scope.ts`):

| Policy scope | Branch predicate | What they see |
|---|---|---|
| all-branch grant (`all_branches`, incl. System Owner) | `{ mode: "all" }` | Every branch that has stock rows for this product |
| own-branch grant (`own_branch`) | `{ mode: "own", branchId }` pinned to the server-trusted Home Branch | Only their Home Branch |

An own-branch grant without a Home Branch fails closed (403) — never an
all-branch widening. The SQL `where` clause is the real access control; the
pure helper `groupBranchStock` (`apps/admin/src/lib/branch-stock.ts`) groups
and sorts the rows and computes `available`.

An own-branch actor who opens a product their branch does **not** carry (no
`branch_stock` row for one of the product's variants at their Home Branch)
gets 404 — the detail route treats the id as a cross-branch reference so
existence is not disclosed. This mirrors the products-list visibility filter
so a non-carried product can't be reached by navigating to its detail URL
directly. All-branch scope is unaffected.

#### Empty states

- No branches at all → "Belum ada data stok untuk produk ini di cabang Anda." (admin) / "di cabang manapun." (HQ)
- Branch exists but no rows → "Belum ada data stok untuk produk ini di cabang ini."

## Re-sync from Jubelio

A "Sync dari Jubelio" button (top-right of the page) triggers
`POST /api/admin/products/{id}/sync`, which re-fetches the product catalog
and per-branch stock from Jubelio and upserts everything. Only visible for
products that have a `jubelioItemGroupId`.

## Files

- `apps/admin/src/app/admin/products/[id]/page.tsx` — UI
- `apps/admin/src/app/api/admin/products/[id]/route.ts` — detail API + stock scoping
- `apps/admin/src/lib/rbac/guard.ts` — unified policy guard (`products:view`)
- `apps/admin/src/lib/rbac/branch-scope.ts` — authorization → branch predicate (pure)
- `apps/admin/src/lib/branch-stock.ts` — pure group/filter/available helper
- `apps/admin/src/lib/branch-stock.test.ts` — unit tests for the helper
