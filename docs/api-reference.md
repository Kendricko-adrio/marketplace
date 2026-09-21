# API Reference — Marketplace Monorepo

> Reference for **every HTTP API endpoint** in the project, derived from the
> `route.ts` handlers under `apps/store/src/app` and `apps/admin/src/app`.
> Last updated: 2026-09-14.
>
> This document describes behavior as implemented in source. If code and this
> doc disagree, the **code is authoritative** — re-run the extraction or read
> the route file directly.

## Overview

The monorepo ships **two Next.js 16 (App Router) apps**, each with its own API
surface and its own Better Auth instance:

| App | Path prefix | Dev URL | Prod URL | Better Auth |
|---|---|---|---|---|
| **Store** (storefront) | `apps/store` | `http://localhost:3000` | `dev-store.adfsport.cloud` | `client` cookie prefix · `clients` table |
| **Admin** (back office) | `apps/admin` | `http://localhost:3001` | `dev-admin.adfsport.cloud` | `admin` cookie prefix · `users` table (dynamic RBAC Roles; see `docs/features/rbac.md`) |

Both apps import the shared Drizzle schema and create their **own local `db`
instance** (`@/db`). DB tables are owned solely by `packages/db`.

## Authentication & conventions

### Auth types used across endpoints

| Label | Meaning |
|---|---|
| **`none`** | Public, no auth. |
| **`client-session`** | Store Better Auth session (`client.session_token` cookie). Missing → `401`. |
| **`admin-session`** | Admin Better Auth session (`admin.session_token` cookie). Missing → `401`. |
| **`admin-session (guard: <module>:<action>)`** | Admin session **plus** a Current Policy authorization via the unified `guard` (`apps/admin/src/lib/rbac/guard.ts`): 401 for a missing session, 403 with a stable code (`NO_ACCESS` for admission failures, `DENIED` for missing grants). Branch-aware grants carry an `own_branch`/`all_branches` scope; own scope is pinned server-side to the user's Home Branch. |
| **`secret-header`** | Shared-secret header compared to a `process.env` var. **`503`** if the env var is unset on the server, **`401`** on mismatch. (Used by cron + webhooks.) |
| **`signature-verification`** | Request body signature verified against a provider key (Midtrans `signature_key` = `SHA512(order_id + status_code + gross_amount + serverKey)`). |
| **`internal (HMAC)`** | Server-to-server call (admin → store) carrying `secret = HMAC-SHA256(BETTER_AUTH_SECRET, orderId)` in the body. |

### Response envelope

Almost all JSON endpoints return `{ success: boolean, data?: ..., error?: string, ... }`.
Error responses add `details` (e.g. flattened zod field errors) or `issues` (raw
zod issues) on validation failures. Status codes are noted per endpoint.

### Secrets / env dependencies

| Secret / env | Used by | Header / mechanism |
|---|---|---|
| `CRON_SECRET` | `POST /api/cron/sweep-reservations` | `X-Cron-Secret` |
| `JUBELIO_WEBHOOK_SECRET` | `POST /api/webhooks/jubelio` | `Sign` (`HMAC-SHA256(body+secret, secret)`; legacy aliases supported) |
| `MIDTRANS_SERVER_KEY` | `POST /api/webhooks/midtrans`, payment creation | `signature_key` verification |
| `BETTER_AUTH_SECRET` | `POST /api/internal/order-complete` | HMAC body secret (shared store↔admin) |

### Path conventions

- `apps/<app>/src/app/api/<...>/route.ts` → `/<...>` with `[id]` → `{id}`,
  `[...all]` → `*` (Better Auth catch-all).
- `apps/<app>/src/app/uploads/[...path]/route.ts` → `/uploads/{path...}` (public file serving).

---

## Quick reference — Store (`:3000`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/branches` | none | List active branches (store locator) |
| GET | `/api/branches/{id}` | none | Fetch a single branch |
| GET | `/api/categories` | none | List active categories |
| GET | `/api/brands` | none | List all product brands (dimension) for storefront filter dropdowns |
| GET | `/api/products` | none | Paginated/filterable product list |
| GET | `/api/products/{id}` | none | Product detail + variants + per-branch stock |
| GET | `/api/homepage` | none | Assemble active homepage sections (hydrated) |
| POST | `/api/vouchers/validate` | none | Validate voucher code + preview discount |
| GET | `/api/cart` | client-session | Get (auto-create) cart with items, subtotal, and effective PPN rate |
| DELETE | `/api/cart` | client-session | Clear all cart items |
| POST | `/api/cart/items` | client-session | Add variant@branch to cart (merge) |
| PUT | `/api/cart/items/{id}` | client-session | Update cart item quantity |
| DELETE | `/api/cart/items/{id}` | client-session | Remove a cart item |
| POST | `/api/cart/validate-checkout` | client-session | Pre-checkout branch/stock validation |
| POST | `/api/checkout/validate-step-2` | client-session | Validate pickup slot vs operating hours |
| GET | `/api/checkout/order-status` | client-session | Poll order status/paymentStatus |
| POST | `/api/checkout/place-order` | client-session | Reserve stock in Jubelio, then create Midtrans Snap |
| GET | `/api/orders` | client-session | List the user's orders |
| GET | `/api/orders/{id}` | client-session | Order detail (+ pickup code when applicable) |
| PATCH | `/api/account/profile` | client-session | Update client name/phone |
| POST | `/api/payments/midtrans/create` | client-session | Re-payment for a pending_payment order |
| POST | `/api/webhooks/midtrans` | signature-verification | Midtrans payment notification → finalize/fail order |
| POST | `/api/webhooks/jubelio` | signature `HMAC-SHA256(body+secret, secret)` | **Jubelio master-data sync (product/price/stock push)** |
| POST | `/api/internal/order-complete` | internal (HMAC) | Admin→store: mark order completed + email |
| POST | `/api/cron/sweep-reservations` | secret-header `X-Cron-Secret` | Release stale reservation safety-net |
| GET | `/api/onboarding/sync` | client-session | Sync onboarding cookie, redirect |
| GET/POST | `/api/auth/*` | Better Auth (catch-all) | Store auth endpoints (sign-up/in/out, verify, …) |
| GET | `/uploads/{path...}` | none | Serve an uploaded file |

## Quick reference — Admin (`:3001`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/products` | admin-session (products:view) | List products (paginated) |
| POST | `/api/admin/products` | admin-session (products:edit) | Create product + variants + images |
| GET | `/api/admin/products/{id}` | admin-session (products:view) | Fetch product detail |
| POST | `/api/admin/products/{id}/sync` | admin-session (products:edit) | Re-sync a single product from Jubelio |
| ~~PUT~~ | ~~`/api/admin/products/{id}`~~ | — | **Removed** — Jubelio is the source of truth; use the Sync button |
| ~~DELETE~~ | ~~`/api/admin/products/{id}`~~ | — | **Removed** — Jubelio is the source of truth |
| GET | `/api/admin/categories` | admin-session (products:view) | List active categories |
| GET | `/api/admin/brands` | admin-session (products:view) | List all product brands (dimension) for the homepage ProductFilterEditor dropdown |
| GET | `/api/admin/branches` | admin-session (branches:view) | List branches (paginated) |
| POST | `/api/admin/branches` | admin-session (branches:edit) | Create branch |
| GET | `/api/admin/branches/{id}` | admin-session (branches:view) | Fetch a branch |
| PUT | `/api/admin/branches/{id}` | admin-session (branches:edit) | Update a branch |
| DELETE | `/api/admin/branches/{id}` | admin-session (branches:delete) | Delete a branch |
| GET | `/api/admin/users` | admin-session (users:view) | List admin users (Role + Home Branch summary, filters) |
| POST | `/api/admin/users` | admin-session (users:edit) | Create a user (Role + Home Branch assignment) |
| GET | `/api/admin/users/{id}` | admin-session (users:view) | Fetch a user |
| PUT | `/api/admin/users/{id}` | admin-session (users:edit) | Update user identity/assignment (strict payload) |
| DELETE | `/api/admin/users/{id}` | — | **Removed** — answers 405; users are soft-deactivated via `POST /api/admin/users/{id}/deactivate` |
| POST | `/api/admin/users/{id}/deactivate` | admin-session (users:edit) | Soft-deactivate a user (reason required, revokes sessions) |
| POST | `/api/admin/users/{id}/reactivate` | admin-session (users:edit) | Reactivate a deactivated user (Authorization-Ceiling validated) |
| POST | `/api/admin/users/{id}/reset-password` | admin-session (users:edit) | Reset password + revoke sessions (active users only) |
| GET | `/api/admin/roles` | admin-session (roles:view) | List Roles (archived behind `?archived=true`) |
| POST | `/api/admin/roles` | admin-session (roles:edit) | Create a Role (final deny-all/cloned draft) |
| GET | `/api/admin/roles/{id}` | admin-session (roles:view) | Role detail (grants + user counts; archived fetchable) |
| PUT | `/api/admin/roles/{id}` | admin-session (roles:edit) | Atomic complete-draft revision (optimistic `expectedVersion`) |
| DELETE | `/api/admin/roles/{id}` | admin-session (roles:delete) | Archive a custom Role (reason required) |
| POST | `/api/admin/roles/{id}/impact` | admin-session (roles:edit) | Preview grant diff + affected active users (read-only) |
| GET | `/api/admin/roles/{id}/restore` | admin-session (roles:view) | Restore review of an archived Role |
| POST | `/api/admin/roles/{id}/restore` | admin-session (roles:edit) | Activate an archived Role after reviewed revalidation |
| POST | `/api/admin/upload` | admin-session | Upload a file |
| DELETE | `/api/admin/upload` | admin-session | Delete an uploaded file |
| GET | `/api/admin/orders` | admin-session (orders view) | List orders (RBAC branch-scoped) |
| GET | `/api/admin/orders/{id}` | admin-session (orders view) | Order detail including durable Jubelio stock operations |
| POST | `/api/admin/orders/{id}/stock-review` | admin-session (orders edit) | Queue a manual-review stock operation for safe note reconciliation |
| POST | `/api/admin/orders/{id}/verify-pickup` | admin-session (orders edit + Home Branch match) | Verify pickup code → complete order |
| GET | `/api/admin/analytics` | admin-session (analytics:view) | Dashboard aggregates + AOV + 30-day WIB revenue trend |
| GET | `/api/admin/audit-log` | admin-session | List audit log (newest first) |
| GET | `/api/admin/me` | admin-session | Current admin identity |
| GET | `/api/admin/session-check` | admin-session (soft) | Must-reset-password check |
| GET | `/api/admin/linkable-destinations` | admin-session (footer:view) | Footer link target catalog |
| GET | `/api/admin/footer` | admin-session (footer:view) | Fetch footer config |
| PUT | `/api/admin/footer` | admin-session (footer:edit) | Upsert footer config |
| GET | `/api/admin/homepage` | admin-session (homepage:view) | List homepage sections |
| POST | `/api/admin/homepage` | admin-session (homepage:edit) | Create a homepage section |
| GET | `/api/admin/homepage/{id}` | admin-session (homepage:view) | Fetch a section |
| PATCH | `/api/admin/homepage/{id}` | admin-session (homepage:edit) | Update a section |
| DELETE | `/api/admin/homepage/{id}` | admin-session (homepage:delete) | Delete a section + image files |
| PATCH | `/api/admin/homepage/reorder` | admin-session (homepage:edit) | Reorder sections |
| GET | `/api/admin/homepage/preview-all` | admin-session (homepage:view) | Preview all sections (incl. inactive) |
| GET | `/api/admin/homepage/preview-products` | admin-session (homepage:view) | Proxy to storefront `/api/products` |
| GET | `/api/admin/pages` | admin-session (pages:view) | List static pages |
| POST | `/api/admin/pages` | admin-session (pages:edit) | Create a static page |
| GET | `/api/admin/pages/{id}` | admin-session (pages:view) | Fetch a page |
| PUT | `/api/admin/pages/{id}` | admin-session (pages:edit) | Update a page |
| DELETE | `/api/admin/pages/{id}` | admin-session (pages:delete) | Delete a page |
| — | `/api/admin/permissions`, `/api/admin/permissions/me` | — | **Removed** — returns `404` (legacy permission endpoints dropped in the RBAC slice-9 cutover, migration 0018) |
| GET | `/api/admin/policy/me` | admin-session | Current Policy: Role identity, exact grants/scopes, Home Branch, policy version (new RBAC) |
| GET | `/api/admin/notifications/poll` | admin-session | Long-poll real-time notifications (Current Policy branch scope) |
| GET | `/api/admin/notifications` | admin-session (notifications:view) | List notifications (paginated, isRead filter) |
| PATCH | `/api/admin/notifications/{id}` | admin-session (notifications:edit) | Mark one notification as read |
| POST | `/api/admin/notifications/mark-all-read` | admin-session (notifications:edit) | Mark all in-scope notifications as read |
| DELETE | `/api/admin/notifications/{id}` | admin-session (notifications:delete) | Delete one notification |
| DELETE | `/api/admin/notifications/clear-all-read` | admin-session (notifications:delete) | Delete all read in-scope notifications |
| GET/POST | `/api/auth/*` | Better Auth (catch-all) | Admin auth endpoints |
| GET | `/uploads/{path...}` | none | Serve an uploaded file |

---

# Detailed endpoint reference

## Store — Catalog (products, branches, categories, homepage, vouchers)

#### `GET` `/api/branches`
- **Auth**: none
- **Purpose**: List all active branches for the public store locator.
- **Params**: `city` (string, optional) — case-insensitive partial match on `branches.city`
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ id, name, code, city, address, latitude, longitude, operatingHours, googleMapsUrl, status }] }`; 500 `{ success: false, error }`
- **Notes**: Filters to `status = "aktif"` only; ordered by `name` asc. No pagination.

#### `GET` `/api/branches/{id}`
- **Auth**: none
- **Purpose**: Fetch a single branch by id.
- **Params**: `{id}` — branch id
- **Body**: none
- **Response**: 200 `{ success: true, data: { id, name, code, city, address, latitude, longitude, operatingHours, googleMapsUrl, status } }`; 404 `{ success: false, error: "Branch not found" }`; 500 `{ success: false, error }`
- **Notes**: Unlike the list endpoint, this does NOT filter by `status` — a non-aktif branch can still be fetched by id.

#### `GET` `/api/categories`
- **Auth**: none
- **Purpose**: List all active categories.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: categories[] }` (full `categories` row); 500 `{ success: false, error }`
- **Notes**: Filters `isActive = true`; ordered by `name` asc.

#### `GET` `/api/brands`
- **Auth**: none
- **Purpose**: List all product brands (dimension) for storefront filter dropdowns.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ id, name, slug }] }`; 500 `{ success: false, error }`
- **Notes**: Sync-managed dimension (populated by the Jubelio import / webhook — see `docs/features/jubelio-sync.md`). Ordered by `name` asc. No `isActive` flag — all rows returned.

#### `GET` `/api/products`
- **Auth**: none
- **Purpose**: Paginated, filterable product list for storefront browsing.
- **Params**: `search` (string, optional), `category` (slug, optional), `brand` (slug, optional), `minPrice` (string, optional), `maxPrice` (string, optional), `status` (string, default `"aktif"`), `hasDiscount` (`"true"` to filter products whose `basePrice > min(variant.price)`), `sortBy` (`"price"`|`"createdAt"`, default `"createdAt"`), `sortOrder` (`"asc"`|`"desc"`, default `"desc"`), `page` (int, default `1`), `limit` (int, default `12`, clamped to 1–100 via `parseListParams` in `apps/store/src/lib/list-params.ts`)
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ id, name, slug, description, basePrice, status, createdAt, price, image, collection: string|null, gender: string|null, hasStock: boolean }], pagination: { page, limit, total, totalPages } }`; 500 `{ success: false, error }`
- **Notes**: `price` is the cheapest variant net price and `basePrice` is the RRP. `hasStock` is true when at least one active-branch variant has `stock - pendingRemoteStock > 0`; product cards grey out otherwise. Price/category/brand filtering remains server-side and pagination-aware. **Out-of-stock products always sort to the bottom**: a tier-1 `ORDER BY (has sellable stock) DESC` runs above the user's chosen `sortBy`/`sortOrder`, so products with no sellable stock in any active branch appear after every in-stock product regardless of sort (e.g. a `price asc` sort still lists all in-stock items cheapest-first, then out-of-stock items). When a `branch` filter is active every returned product is already in-stock at that branch, so the tier has no effect. Requests are logged via the structured logger (`module: "products-list"`) and stamped with `x-request-id`.

#### `GET` `/api/products/{id}`
- **Auth**: none
- **Purpose**: Full product detail with variants, per-variant branch availability, and categories.
- **Params**: `{id}` — accepts either the product `id` or its `slug` (looked up by id first, then by slug)
- **Body**: none
- **Response**: 200 `{ success: true, data: { ...product, variants: [{ ...variant, branchStock: [{ branchId, stock, reservedStock, pendingRemoteStock, available }] }] } }`; 404 if not found; 500 on error
- **Notes**: Active branch rows are exposed when `stock - pendingRemoteStock > 0`; `available` uses that same expression. Confirmed `reservedStock` is already reflected in reduced Jubelio on-hand and is not subtracted again.

#### `GET` `/api/homepage`
- **Auth**: none
- **Purpose**: Assemble all active homepage sections with their hydrated content (product carousels and store banners).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: sections[] }` where each section varies by `type`: `carousel_product` sections gain a `products` array; `store_banner` sections gain a `branches` array (active branches, `name` asc); other types pass through unchanged. Empty array if no sections. 500 `{ success: false, error }`
- **Notes**: Only `isActive = true` sections, ordered by `displayOrder` asc. `carousel_product` content has a `mode`: `"filter"` resolves products dynamically (mirrors `/api/products` filters: `search`, `category` slug, `brand` slug, `hasDiscount`, `minPrice`, `maxPrice`, `sortOrder` of `newest|priceAsc|priceDesc`; `limit` clamped 1–20, default 10) and runs in parallel; otherwise manual mode reads `homepageSectionProducts` junction rows ordered by `displayOrder`. Carousel product `price` is the cheapest variant net price, `basePrice` is the RRP. Each carousel product also carries `collection` (text label from the product row, nullable) and `gender` (resolved name from the sync-managed `gender` dimension table via `genderId`, nullable) so product cards can render both. `store_banner` sections attach all `status = "aktif"` branches. Read-only.

#### `POST` `/api/vouchers/validate`
- **Auth**: none
- **Purpose**: Validate a voucher code against active window, quota, and minimum purchase, and preview the discount.
- **Params**: —
- **Body**: JSON `{ code: string, subtotal?: string|number }` (no zod schema; `code` required, `subtotal` optional)
- **Response**: 200 `{ success: true, data: { code, discountType, value, maxDiscount, minPurchase, discount, validUntil, remainingQuota } }`; 400 if `code` missing, quota exhausted, or subtotal below `minPurchase`; 404 if voucher not found/inactive/out of date window; 500 `{ success: false, error }`
- **Notes**: Looks up `code` case-insensitively after `toUpperCase()`, requires `isActive = true` and `validFrom < now < validUntil`. `discount` computed only when `subtotal` is provided: `percentage` = `subtotal * value/100` capped at `maxDiscount`; `fixed`/`shipping` = flat `value`. **Read-only — does NOT increment `vouchers.used`**; redemption increments must happen at order placement.

## Store — Cart, Checkout, Orders, Account

#### `GET` `/api/cart`
- **Auth**: client-session
- **Purpose**: Get (or auto-create) the user's cart with items, variant/branch/product details, first image, and subtotal.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, data: { id, items[], itemCount, subtotal, ppnRatePercent } }`; `ppnRatePercent` is the validated effective rate (11 fallback); 401 if unauth; 500 on error
- **Notes**: Auto-creates a `carts` row if none exists for the user. Each item carries its own `branchId`. Subtotal sums `parseFloat(variant.price) * quantity`.

#### `DELETE` `/api/cart`
- **Auth**: client-session
- **Purpose**: Clear all items from the user's cart.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, message: "Cart cleared" }`; 401 if unauth; 500 on error
- **Notes**: Deletes all `cartItems` for the user's cart and bumps `carts.updatedAt`; the `carts` row itself is preserved. Does not touch stock/reservedStock.

#### `POST` `/api/cart/items`
- **Auth**: client-session
- **Purpose**: Add a variant from a branch to the cart, merging into an existing (variantId+branchId) line.
- **Params**: —
- **Body**: `{ variantId: string, branchId: string, quantity: number (int, positive, default 1) }`
- **Response**: 200 `{ success, message }` (`"Cart item updated"` or `"Item added to cart"`); 400 invalid body / `"Branch not available"` / `"Insufficient stock at this branch"`; 401 if unauth; 404 `"Variant not found"`; 500 on error
- **Notes**: Available = `branch_stock.stock - branch_stock.pendingRemoteStock`. Branch must be active. A matching line increments quantity and re-validates availability.

#### `PUT` `/api/cart/items/{id}`
- **Auth**: client-session
- **Purpose**: Update the quantity of a single cart item.
- **Params**: `{id}` (cart item id)
- **Body**: `{ quantity: number (int, positive) }`
- **Response**: 200 `{ success, message: "Cart item updated" }`; 400 invalid body / `"Insufficient stock at this branch"`; 401 if unauth; 404 `"Cart not found"` / `"Cart item not found"`; 500 on error
- **Notes**: Item is scoped to the user's cart. Stock check uses `stock - pendingRemoteStock >= quantity`; cart changes do not reserve stock.

#### `DELETE` `/api/cart/items/{id}`
- **Auth**: client-session
- **Purpose**: Remove a single cart item.
- **Params**: `{id}` (cart item id)
- **Body**: none
- **Response**: 200 `{ success, message: "Cart item removed" }`; 401 if unauth; 404 `"Cart not found"`; 500 on error
- **Notes**: Deletion is scoped to the user's cart (`cartId` match). Does not touch `reservedStock` (reservations only change at place-order).

#### `POST` `/api/cart/validate-checkout`
- **Auth**: client-session
- **Purpose**: Pre-checkout validation that the selected items' branch is still active and stock is sufficient.
- **Params**: —
- **Body**: `{ selectedItemIds: string[] (min 1) }`
- **Response**: 200 `{ success: true }`; 400 invalid body / `"Cart is empty"` / `"No selected items to checkout"` / multi-branch error / `{ success: false, code: "BRANCH_INACTIVE", branchName, removedItemCount }` / `{ success: false, code: "INSUFFICIENT_STOCK", outOfStock: [{name}], adjusted: [{name, available}] }`; 401 if unauth; 500 on error
- **Notes**: Enforces single-branch checkout. On inactive/removed branch, deletes ALL of that branch's items from the cart. On insufficient stock: fully out-of-stock items (available ≤ 0) are deleted; partially available (0 < available) have their `quantity` lowered to `available`. Soft UX pre-check — the authoritative race-free guard lives in place-order's atomic conditional UPDATE.

#### `POST` `/api/checkout/validate-step-2`
- **Auth**: client-session
- **Purpose**: Validate the pickup date/time against the branch's operating hours.
- **Params**: —
- **Body**: `{ branchId: string, pickupDate: string (YYYY-MM-DD), pickupTime: string (HH:mm) }`
- **Response**: 200 `{ success, message: "Pickup slot is valid" }`; 400 invalid body / `"Branch is not available"` / `result.error` (invalid slot); 401 if unauth; 404 `"Branch not found"`; 500 on error
- **Notes**: Branch must have `status === "aktif"`. Delegates to `validatePickupSlot(branch.operatingHours, pickupDate, pickupTime)`.

#### `GET` `/api/checkout/order-status`
- **Auth**: client-session
- **Purpose**: Poll an order's `status` and `paymentStatus` (used for QRIS confirmation polling).
- **Params**: query `orderId`
- **Body**: none
- **Response**: 200 `{ success, status, paymentStatus }`; 400 `"Missing orderId parameter"`; 401 if unauth; 403 `"Forbidden"` (order belongs to another user); 404 `"Order not found"`; 500 on error
- **Notes**: Read-only DB lookup. The Midtrans webhook (`/api/webhooks/midtrans`) remains the source of truth — this endpoint only reflects current DB state.

#### `POST` `/api/checkout/place-order`
- **Auth**: client-session
- **Purpose**: Hold stock locally, confirm a negative Jubelio adjustment, then create Midtrans Snap and remove checked-out cart items.
- **Params**: —
- **Body**: `{ phone: string (8-20), email: string (email), pickupDate: string (YYYY-MM-DD), pickupTime: string (HH:mm), selectedItemIds: string[] (min 1) }`
- **Response**: 200 `{ success, orderId, redirectUrl, token }`; 400 invalid body/local stock failure; 401 if unauth; 409 definitive Jubelio rejection; 503 ambiguous Jubelio confirmation; 500 on error; 502 on Midtrans failure (cart preserved)
- **Notes**: Enforces single-branch checkout and a Jakarta-time pickup slot. Server prices are authoritative. PPN uses `tax.ppnRatePercent` (11 fallback), applies after discount, rounds upward to whole Rupiah, and persists `ppnRate`/`ppnAmount` with the gross `total`. A short transaction creates the order/items, increments `pending_remote_stock`, and creates a durable reserve operation. Midtrans is called only after Jubelio confirms the negative adjustment; item details include PPN and sum to the gross total. A Jubelio failure never creates a Midtrans transaction. Midtrans failure queues a positive compensation.

#### `GET` `/api/orders`
- **Auth**: client-session
- **Purpose**: List the authenticated user's orders with branch and items (each item with first image).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, data: orders[] }` (each order spread + `branch` + `items[]` with `imageUrl`); 401 if unauth; 500 on error
- **Notes**: Scoped to `orders.userId = session.user.id`, ordered by `orders.createdAt desc`. `orderItems` joined to `productVariants` to get `productId`.

#### `GET` `/api/orders/{id}`
- **Auth**: client-session
- **Purpose**: Get a single order's full detail with branch and items (with images).
- **Params**: `{id}` (order id)
- **Body**: none
- **Response**: 200 `{ success, data: { ...order, pickupCode, branch, items[] } }`; 401 if unauth; 404 `"Order not found"` (also when order exists but is not owned by the user); 500 on error
- **Notes**: Scoped to `orders.userId = session.user.id`. `pickupCode` is only exposed when `order.status === "ready_for_pickup"` or `"completed"`; otherwise `null`. `orderItems` joined to `productVariants` for `productId` and first image by `displayOrder`.

#### `PATCH` `/api/account/profile`
- **Auth**: client-session
- **Purpose**: Update the authenticated client's profile (name and/or phone).
- **Params**: —
- **Body**: `{ name?: string (1-100), phone?: string (regex /^\+62\d{8,13}$/) }`
- **Response**: 200 `{ success: true }`; 400 invalid data (first zod issue message, e.g. `"Nama wajib diisi"` / phone format error) / `"Tidak ada perubahan untuk disimpan."` (no effective changes); 401 if unauth; 500 on error (`"Gagal memperbarui profil"`)
- **Notes**: Writes to the `clients` table keyed by `session.user.id`. `name` is only written when it differs from `session.user.name`; always sets `updatedAt = new Date()`. Body parsed with `.catch(() => null)` so a missing/invalid JSON body yields a 400 rather than a 500.

## Store — Payments, Webhooks, Cron, Internal, Onboarding, Auth, Uploads

#### `POST` `/api/payments/midtrans/create`
- **Auth**: client-session
- **Purpose**: Create a Midtrans Snap payment session for a pending_payment order (re-payment flow).
- **Params**: —
- **Body**: `{ orderId: string }`
- **Response**: 401 unauthorized; 400 missing id/not pending; 403 forbidden; 404 not found; 409 `{ error: "Stock has not been confirmed by Jubelio" }`; 500 provider error; 200 `{ success, redirectUrl, token }`
- **Notes**: Only owned `pending_payment` orders with an `applied` or `committed` Jubelio reserve operation can create another Midtrans session.

#### `POST` `/api/webhooks/midtrans`
- **Auth**: signature-verification (Midtrans `signature_key` = `SHA512(order_id + status_code + gross_amount + serverKey)`; plus authoritative re-verify with `getMidtransTransactionStatus`)
- **Purpose**: Receive Midtrans payment notification callbacks and finalize/fail orders accordingly.
- **Params**: —
- **Body**: `{ order_id, transaction_status, status_code, gross_amount, signature_key, fraud_status }` (raw JSON body; signature verified)
- **Response**: 400 for missing required signed fields or amount/order mismatch; 401 for invalid signature; 404 for unknown order; 503 when authoritative provider verification is unavailable; 500 on processing failure; 200 on success/idempotent skip.
- **Notes**: `signature_key`, `order_id`, `transaction_status`, `status_code`, and `gross_amount` are mandatory. Signature comparison is constant-time. Both callback and authoritative provider amounts/order IDs must match the local order. There is no unverified payload fallback; non-2xx responses intentionally allow Midtrans retry. Claim guards keep success/failure finalization idempotent against webhook/sweep races. A verified settlement for an already failed order is treated as a late settlement: the original deduction is committed when compensation has not started, or a durable `reacquire` operation is applied after confirmed compensation; unsafe states enter `manual_review`.

#### `POST` `/api/webhooks/jubelio`
- **Auth**: signature — `HMAC-SHA256(rawBodyString + JUBELIO_WEBHOOK_SECRET, JUBELIO_WEBHOOK_SECRET)` (hex), sent by Jubelio in the `Sign` header; legacy `webhook-signature` and `x-jubelio-signature` aliases remain supported; recomputed from the raw request body — **503** if env unset, **401** on mismatch
- **Purpose**: Receive Jubelio push events when a product/price/stock changes and re-sync the affected entity from Jubelio (source of truth). Setup: Jubelio UI → Pengaturan → Developer → Webhook, register this URL for `update-product` / `update-price` / `update-qty` + set the Webhook Secret Key. See `docs/features/jubelio-sync.md` + `docs/deployment-docs/jubelio-sync.md`.
- **Params**: —
- **Body**: `update-product`/`update-price`: `{ action, item_group_id, item_group_name }`; `update-qty`: `{ action, item_group_id, item_group_name, item_ids: number[], location_id }`
- **Response**: 503 `{ success: false, error: "Webhook not configured" }` (env unset); 401 `{ success: false, error: "Unauthorized" }` (bad signature); 400 `{ success: false, error: "Invalid JSON body" | "Missing item_group_id" | "Missing item_ids" }`; 500 `{ success: false, error: "Sync failed" }` (Jubelio retries up to 3×); 200 `{ success: true, ...summary }`
- **Notes**: Payload is minimal (entity ids only) — the handler re-fetches the current state from Jubelio and upserts. `update-product`/`update-price` → `syncOneProduct(db, item_group_id)` (re-fetches `/inventory/catalog/{id}` + stock); `update-qty` → `fetchStocks(item_ids)` → `upsertJubelioStock`. Upsert-only, never deletes; `branch_stock.reservedStock` never touched; new branches created `"nonaktif"`. Writes an `auditLogs` row (`action: "JUBELIO_SYNC_WEBHOOK"`). Env: `JUBELIO_WEBHOOK_SECRET` + `JUBELIO_EMAIL`/`JUBELIO_PASSWORD` (login token, 12h, auto-refresh). Shared logic with `db:import-jubelio` + the admin Sync button (`POST /api/admin/products/{id}/sync`). Worker: `packages/db/src/jubelio-sync.ts`.

#### `POST` `/api/internal/order-complete`
- **Auth**: internal (HMAC shared secret in body — `secret` must equal `HMAC-SHA256(BETTER_AUTH_SECRET, orderId)`)
- **Purpose**: Called by the admin app to mark an order `completed` and send the Order Completed email.
- **Params**: —
- **Body**: `{ orderId: string, secret: string }`
- **Response**: 400 `{ success: false, error: "orderId is required" | "Order must be ready_for_pickup (current: <status>)" }`; 403 `{ success: false, error: "Unauthorized" }` (missing/invalid secret, or `BETTER_AUTH_SECRET` unset); 404 `{ success: false, error: "Order not found" }`; 500 `{ success: false, error: "Failed to complete order" }`; 200 `{ success: true, completedAt: string (ISO) }`
- **Notes**: Only `ready_for_pickup` orders can be completed. Loads `orderItems` to render the completed email and sends via `sendEmail` to `order.contactEmail`; email failure is logged but does not fail the request (order is already completed). Env dependency: `BETTER_AUTH_SECRET` (shared with admin app).

#### `POST` `/api/cron/sweep-reservations`
- **Auth**: secret-header (`X-Cron-Secret` vs `process.env.CRON_SECRET`) — **503** if env unset, **401** on mismatch
- **Purpose**: Safety-net sweep that releases stock reservations for stale `pending_payment` orders whose `expiresAt` has passed without a Midtrans `expire` webhook.
- **Params**: —
- **Body**: none
- **Response**: 503 `{ success: false, error: "Cron not configured" }`; 401 `{ success: false, error: "Unauthorized" }`; 500 `{ success: false, error: "Sweep failed" }`; 200 `{ success: true, scanned, finalized, failed, jubelioSync: { scanned, applied, failed, pending } }`
- **Notes**: Reconciles due Jubelio stock operations first, then processes up to 100 stale orders. Provider calls remain outside DB transactions. Unique adjustment notes prevent blind retries after ambiguous writes. Claim guards make order finalization idempotent and safe with webhooks.

#### `GET` `/api/onboarding/sync`
- **Auth**: client-session
- **Purpose**: Sync the `client.onboarding` cookie from DB state and redirect home — used when the DB says onboarding is done but the cookie is missing (expired/never set), to avoid an infinite redirect loop with middleware.
- **Params**: —
- **Body**: none
- **Response**: 307 redirect to `/login?callbackUrl=/onboarding` (no session); 307 redirect to `/` (session present), setting cookie `client.onboarding=1` when `user.onboardingCompleted` is true
- **Notes**: Sets `client.onboarding` cookie (`httpOnly: false`, `sameSite: "lax"`, `secure` in production, `path: "/"`, `maxAge` 7 days) only if `onboardingCompleted`. Env dependency: `NODE_ENV`.

#### `GET` & `POST` `/api/auth/*`
- **Auth**: managed per-endpoint by Better Auth `auth.handler`
- **Purpose**: Better Auth catch-all delegating all `/api/auth/*` sub-paths (sign-up, sign-in, sign-out, verification, etc.) to `auth.handler`.
- **Params**: `[...all]` → `*` (matched sub-path)
- **Body**: varies per Better Auth endpoint
- **Response**: varies per Better Auth endpoint
- **Notes**: Handlers exported via `toNextJsHandler(auth)` — the store Better Auth instance (`client` cookie prefix / `clients` table). See Better Auth docs for the exact sub-path contract.

#### `GET` `/uploads/{path...}`
- **Auth**: none
- **Purpose**: Serve an uploaded file from the uploads directory.
- **Params**: `path: string[]` (joined with `/`)
- **Body**: none
- **Response**: 403 `"Forbidden"` (path contains `..`); 404 `"Not Found"` (file missing); 200 file bytes with `Content-Type` (`.jpg`/`.jpeg`/`.png`/`.webp`/`.gif` mapped, else `application/octet-stream`) and `Cache-Control: public, max-age=31536000, immutable`
- **Notes**: Resolves path under `getUploadsDir()`; rejects `..` traversal. Long-term immutable caching (1 year).

## Admin — Products, Categories, Branches, Users, Roles, Upload

#### `GET` `/api/admin/products`
- **Auth**: admin-session (guard: products/view)
- **Purpose**: List products with variants, categories, stock totals, and images (paginated), **scoped by the caller's branch access**.
- **Params**: query `page` (default 1), `limit` (default 20), `search` (optional — case-insensitive partial match on name or slug)
- **Body**: none
- **Response**: 200 `{ success, data: [...], pagination: { page, limit, total, totalPages } }`; 500 error
- **Notes**: Authorization is via the unified `guard` (`apps/admin/src/lib/rbac/guard.ts`, `products:view`); branch scope comes from the Current Policy via `branchScopeFromAuthorization` (`apps/admin/src/lib/rbac/branch-scope.ts`): all-branch scope → every product, with stock summed across branches; own-branch scope → **only products the server-pinned Home Branch carries** (products that have a `branch_stock` row for the Home Branch), with stock totals scoped to that branch only. An own-branch grant without a Home Branch fails closed (403). The carried-product filter and the search filter are both applied to the list and the `count(*)` query so pagination stays in sync. Per-product stock totals come from the raw per-branch rows summed through the pure `computeScopedTotals` helper (`apps/admin/src/lib/branch-stock.ts`); the SQL `where` is the real access control and the helper is the tested guarantee (defence in depth). Per-product fields: `variants: [{id, price, isDefault}]`, `variantCount`, `totalStock`, `totalReserved`, `totalAvailable = max(0, totalStock - totalReserved)`, `categories: [name]`, `images: [{url}]`. Also spreads the full product row (incl. `collection` text label) and adds `gender` (resolved name from the `gender` dimension table via `genderId`, nullable — batch-looked-up per page) so carousel manual-mode preview cards can render the gender label. N+1 per product (variants, categories, branch stocks, productImages ordered by displayOrder).

#### `POST` `/api/admin/products` — **REMOVED**
- **Status**: Removed. Jubelio is the source of truth for the product catalog; products are created via the Jubelio sync (`db:import-jubelio` / the Jubelio webhook / the per-product Sync button). The `GET` list endpoint remains.

#### `GET` `/api/admin/products/{id}`
- **Auth**: admin-session (guard: products/view)
- **Purpose**: Fetch a single product with its categories, variants (with images), and **per-branch stock scoped by the caller's role**.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 product detail with branch rows containing `stock`, `reservedStock`, `pendingRemoteStock`, and `available`; 404 not found; 500 error
- **Notes**: Branch visibility remains role-scoped. `available = max(0, stock - pendingRemoteStock)`; `reservedStock` is shown separately for operational visibility.

#### `PUT` `/api/admin/products/{id}` — **REMOVED**
- **Status**: Removed. Jubelio is the source of truth; refresh a product via `POST /api/admin/products/{id}/sync` (the Sync button on the admin product detail page).

#### `DELETE` `/api/admin/products/{id}` — **REMOVED**
- **Status**: Removed. Jubelio is the source of truth.

#### `POST` `/api/admin/products/{id}/sync`
- **Auth**: admin-session (guard: products/edit)
- **Purpose**: Re-sync a single product from Jubelio (brand, description, gallery images, variants, per-branch stock). Triggered by the "Sync dari Jubelio" button on the admin product detail page.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success: true, data: { product: string, variants: number, stockRows: number } }`; 404 product not found; 400 `{ error: "Product is not a Jubelio-synced product (no jubelio_item_group_id)" }`; 500 sync failed
- **Notes**: Looks up the product's `jubelio_item_group_id`, calls `syncOneProduct(db, itemGroupId)` from `packages/db/src/jubelio-sync.ts` (fetches `/inventory/catalog/{id}` + `/inventory/items/all-stocks/`, upserts). Writes an `auditLogs` row (`action: "JUBELIO_SYNC_ADMIN"`). Env: `JUBELIO_EMAIL`/`JUBELIO_PASSWORD`/`JUBELIO_API_BASE_URL`.

#### `GET` `/api/admin/categories`
- **Auth**: admin-session (guard: products/view)
- **Purpose**: List active categories ordered by name.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, data: [...] }`; 500 error
- **Notes**: Filters `categories.isActive = true`. No pagination. Only `GET` is exported here.

#### `GET` `/api/admin/brands`
- **Auth**: admin-session (guard: products/view)
- **Purpose**: List all product brands (dimension) for the homepage ProductFilterEditor dropdown.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, data: [{ id, name, slug }] }`; 500 error
- **Notes**: Sync-managed dimension (no admin CRUD). Ordered by `name` asc. Read-only `GET`.

#### `GET` `/api/admin/branches`
- **Auth**: admin-session (guard: branches/view)
- **Purpose**: List branches (paginated).
- **Params**: query `page` (default 1), `limit` (default 20)
- **Body**: none
- **Response**: 200 `{ success, data: [...], pagination: { page, limit, total, totalPages } }`; 500 error
- **Notes**: Ordered by `createdAt` desc.

#### `POST` `/api/admin/branches`
- **Auth**: admin-session (guard: branches/edit)
- **Purpose**: Create a branch.
- **Params**: —
- **Body**: `{ name: string, code: string, city: string, address: string, latitude?: string, longitude?: string, operatingHours: { monday?: { open, close }|null, tuesday?, ..., sunday? } (default {}), googleMapsUrl?: string (valid URL or ""), status: "aktif"|"nonaktif" (default "aktif") }`
- **Response**: 201 `{ success: true, data: branch }` (the created branch row, incl. `id`); 400 invalid; 500 error
- **Notes**: `latitude`/`longitude` stored null if empty; `googleMapsUrl` validated as URL or literal `""`, stored null if empty. `id` via `crypto.randomUUID()`. Created resources return 201 with the full row (same contract as the Roles/Users POST endpoints).

#### `GET` `/api/admin/branches/{id}`
- **Auth**: admin-session (guard: branches/view)
- **Purpose**: Fetch a single branch.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success, data: branch }`; 404 not found; 500 error
- **Notes**: —

#### `PUT` `/api/admin/branches/{id}`
- **Auth**: admin-session (guard: branches/edit)
- **Purpose**: Update a branch.
- **Params**: `{id}`
- **Body**: `{ name: string, code: string, city: string, address: string, latitude?: string, longitude?: string, operatingHours: { monday?: {open,close}|null, ... sunday? } (required), googleMapsUrl?: string (valid URL or ""), status: "aktif"|"nonaktif" }`
- **Response**: 200 `{ success, data: { id } }`; 400 invalid; 404 not found; 500 error
- **Notes**: Unlike POST, `operatingHours` has no default (required) and `status` is required. `latitude`/`longitude`/`googleMapsUrl` stored null when empty. `updatedAt` set.

#### `DELETE` `/api/admin/branches/{id}`
- **Auth**: admin-session (guard: branches/delete)
- **Purpose**: Delete a branch.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success: true }`; 404 not found; 500 error
- **Notes**: No FK/cascade handling; deletion may fail if `users.branchId` or `branchStocks` reference it (relies on DB cascade/restrict).

#### `GET` `/api/admin/users`
- **Auth**: admin-session (guard: users/view)
- **Purpose**: List users (global directory) with Role + Home Branch summary.
- **Params**: query `q`/`search` (ilike on `name`/`email`/`username`), `roleId` (filter by assigned Role id), `active` (`"true"`/`"false"`)
- **Body**: none
- **Response**: 200 `{ success, data: [{ id, name, username, displayUsername, email, isActive, mustResetPassword, emailVerified, role: { id, key, name, isSystem } | null, branch: { id, name, code } | null, createdAt, updatedAt }] }`; 400 `LEGACY_FILTER_REMOVED` when the legacy `role` (name) filter is used; 500 error
- **Notes**: Ordered by `createdAt` desc. No pagination. Role-name filters were removed in the RBAC slice-9 cutover — clients must filter by `roleId`.

#### `POST` `/api/admin/users`
- **Auth**: admin-session (guard: users/edit)
- **Purpose**: Create a user with a Role + Home Branch assignment (one transaction).
- **Params**: —
- **Body**: strict (`z.strictObject`) `{ name: string (2-100), email: string (valid email), roleId: string, branchId?: string|null, passwordMode: "manual"|"generate", password?: string (min 8, required when manual) }` — a legacy role-name payload fails 400
- **Response**: 201 `{ success, data: <user summary + plaintext `password`> }`; 400 invalid body (`INVALID_BODY`) / `INVALID_ROLE` / `INVALID_BRANCH` / `INVALID_PASSWORD` / Authorization-Ceiling denial; 409 email already used (active **and** inactive users); 500 error
- **Notes**: Assignment is validated in-transaction (valid active Role, mandatory Home Branch for non-Owner Roles, Authorization Ceiling, Owner-only promotion). Username auto-generated from `name` (lowercase, diacritics stripped, dots for separators, suffix increment on collision). `email` lowercased; `emailVerified=true`; `mustResetPassword=true`. Inserts a `credential` `adminAccounts` row with bcrypt hash (cost 10). Plaintext password returned once in response (never persisted).

#### `GET` `/api/admin/users/{id}`
- **Auth**: admin-session (guard: users/view)
- **Purpose**: Fetch a single user with Role + Home Branch summary.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success, data: <same user-summary shape as the list endpoint> }`; 404 not found; 500 error
- **Notes**: Left-joins `branches` and `admin_roles`.

#### `PUT` `/api/admin/users/{id}`
- **Auth**: admin-session (guard: users/edit)
- **Purpose**: Update a user's identity/assignment (strict payload).
- **Params**: `{id}`
- **Body**: `{ name?: string (2-100), email?: string, roleId?: string, branchId?: string|null, reason?: string|null }`
- **Response**: 200 `{ success, data: <user summary> }`; 400 invalid body / `INVALID_ROLE` / `INVALID_BRANCH` / Authorization-Ceiling denial; 404 not found; 409 email already used; 500 error
- **Notes**: `z.strictObject` — a legacy `role` (name) payload fails 400. Assignment changes are validated against the actor's Authorization Ceiling; Home Branch rules follow the Current Policy (non-Owner Roles require a Home Branch).

#### `DELETE` `/api/admin/users/{id}` — **REMOVED**
- **Status**: Users are soft-deactivated, never hard-deleted (audit attribution + identity reservation). The endpoint answers `405` (`USER_DEACTIVATE_REQUIRED`, `Allow: GET, PUT`) directing callers to `POST /api/admin/users/{id}/deactivate`.

#### `POST` `/api/admin/users/{id}/deactivate`
- **Auth**: admin-session (guard: users/edit)
- **Purpose**: Soft-deactivate a user.
- **Params**: `{id}`
- **Body**: `{ reason: string (min 1) }` (strict)
- **Response**: 200 on success; 400 `REASON_REQUIRED` (missing reason) / validation denial; 404 not found; 500 error
- **Notes**: Retains the Role, Home Branch, identity, and audit attribution; revokes every existing session in the same transaction and blocks future sign-in.

#### `POST` `/api/admin/users/{id}/reactivate`
- **Auth**: admin-session (guard: users/edit)
- **Purpose**: Reactivate a deactivated user.
- **Params**: `{id}`
- **Body**: `{ reason?: string|null }` (strict; optional)
- **Response**: 200 on success; 400 when the retained Role is archived/invalid or the required Home Branch is missing (validated within the actor's Authorization Ceiling); 404 not found; 500 error
- **Notes**: Reactivation re-runs assignment validation — a user whose Role was archived while inactive cannot be silently reactivated.

#### `POST` `/api/admin/users/{id}/reset-password`
- **Auth**: admin-session (guard: users/edit)
- **Purpose**: Reset a user's password.
- **Params**: `{id}`
- **Body**: `{ passwordMode: "generate" }` (no password field) or `{ passwordMode: "manual", password: string }` (minimum 8 characters)
- **Response**: 200 `{ success, data: { password: string, mustResetPassword: true } }`; 400 invalid / password-too-short; 404 not found; 409 `USER_NOT_ACTIVE` (deactivated users are rejected); 500 error
- **Notes**: Updates the user's `credential` `adminAccounts` row password (bcrypt, cost 10), or creates one if absent. Sets `users.mustResetPassword=true`. Revokes all sessions via the centralized `revokeUserSessions` seam (revokes old password on all devices). Plaintext password is returned once and never logged; structured logs contain actor/target IDs, mode, and validation field names only.

#### Shared Roles contract (all `/api/admin/roles` endpoints)

- **Auth**: the unified `guard` — `roles:view` for all reads, `roles:edit` for create/revise/impact/restore, `roles:delete` for archive. Guard failures: `401` for a missing session, `403 { success: false, error, code: "NO_ACCESS" | "DENIED" }` otherwise. `roles` is a **global module** — grants carry `scope: "global"` only; branch scope does not apply.
- **Role shape** (`RoleDetail`): `{ id, key: string|null, name, description: string|null, isSystem, archived, archivedAt: string|null, version: int, userCount: int, activeUserCount: int, grants: [{ module, action: "view"|"edit"|"delete", scope: "global"|"own_branch"|"all_branches" }] }`. `key` is non-null only for System Roles (`system_owner`, `hq`, `admin`); `isSystem` Roles are visible but immutable. `userCount`/`activeUserCount` are computed per response.
- **Grant shape**: validated against the code-owned catalog (`packages/db/src/rbac/catalog.ts`) — branch modules (`products`, `orders`, `notifications`, `branches`, `analytics`, `audit_log`) require `scope: "own_branch" | "all_branches"` (with per-action restrictions, e.g. `products:edit` is all-branch only); global modules (`customers`, `homepage`, `pages`, `users`, `roles`, `footer`) require `scope: "global"`. Unsupported module/action/scope combinations are rejected `400 INVALID_GRANTS`. Edit/delete grants must be covered by a view grant in the same module (`400 COVERAGE_VIOLATION`). Non-branch modules store `scope: "global"` regardless of the submitted value.
- **Name rules**: normalized (whitespace runs collapsed, trimmed, lowercased) and case-insensitively unique across active **and** archived Roles (`409 DUPLICATE_NAME`); 2–64 chars, Unicode letters/numbers + spaces/hyphens/underscores (`400 INVALID_NAME`); the System Role display names ("System Owner", "HQ", "Admin") are protected (`400 PROTECTED_NAME` when renaming to them).
- **Authorization ceiling**: a non-System-Owner actor cannot create/revise a Role whose grants exceed their own effective grants, and cannot revise a Role whose **current** grants exceed their ceiling (`403 CEILING_VIOLATION`). The System Owner Role (`key: system_owner`) is immutable and never archivable (`403 OWNER_IMMUTABLE`); a non-Owner cannot revise the Role they hold (`403 SELF_ROLE_REVISION`).
- **Stable error envelope**: every service denial is `{ success: false, error, code }` with a fixed status (`roles-http.ts`): `NOT_FOUND` 404 · `INVALID_BODY`/`INVALID_NAME`/`PROTECTED_NAME`/`INVALID_GRANTS`/`COVERAGE_VIOLATION`/`REDUCTION_REASON_REQUIRED`/`REASON_REQUIRED` 400 · `CEILING_VIOLATION`/`OWNER_IMMUTABLE`/`SELF_ROLE_REVISION`/`SYSTEM_ROLE_NOT_ARCHIVABLE` 403 · `DUPLICATE_NAME`/`STALE_VERSION`/`ROLE_HAS_ACTIVE_USERS`/`ROLE_NOT_ARCHIVED`/`CONFLICT` 409 · `INTERNAL` 500. Validation failures: `{ success: false, error: "Invalid request body", code: "INVALID_BODY" }` 400.
- **Transactional behavior**: every mutation runs in one DB transaction that locks the Role row (`SELECT … FOR UPDATE`), re-validates the optimistic version, replaces the complete grant set, bumps `version`, and writes the immutable audit event (`ROLE_*`, `branchScope: "global"`, `policyVersion` = the actor's Current Policy version) **before commit** — a failed audit write aborts the mutation. Surviving unique-constraint races map to `409 DUPLICATE_NAME` / `409 CONFLICT` / `400 INVALID_GRANTS`. See `docs/features/rbac.md`.

#### `GET` `/api/admin/roles`

- **Auth**: admin-session (guard: `roles:view`)
- **Purpose**: Searchable Role list with grants and user counts. Default excludes archived Roles.
- **Params**: query `q` (optional — case-insensitive partial match on `name`), `archived` (`"true"` shows **only** archived Roles; any other value shows only active ones)
- **Body**: none
- **Response**: 200 `{ success: true, data: RoleDetail[] }` ordered by `createdAt` asc (System Roles first, seeded order); 401/403 guard; 500 `{ code: "INTERNAL" }`
- **Notes**: No pagination. Archived Roles are visible only with `?archived=true` (or individually by id — see `GET /api/admin/roles/{id}`).

#### `POST` `/api/admin/roles`

- **Auth**: admin-session (guard: `roles:edit`)
- **Purpose**: Create a custom Role from a final draft (deny-all, explicit grants, or cloned).
- **Params**: —
- **Body**: `{ name: string (min 1; normalized rules apply), description?: string|null, grants?: [{ module, action, scope }], cloneFromId?: string }` — omitting `grants` (and `cloneFromId`) creates a deny-all draft; `cloneFromId` copies the source Role's grants (source must be active — `404 NOT_FOUND` otherwise — and the copied set is ceiling-checked); an explicit `grants` array overrides and is validated first for catalog well-formedness, then against the ceiling.
- **Response**: 201 `{ success: true, data: RoleDetail }` (`version: 1`, `userCount: 0`); 400 `INVALID_BODY`/`INVALID_NAME`/`PROTECTED_NAME`/`INVALID_GRANTS`/`COVERAGE_VIOLATION`; 403 `CEILING_VIOLATION`; 404 `NOT_FOUND` (clone source); 409 `DUPLICATE_NAME`; 500 `INTERNAL`
- **Notes**: `isSystem: false`, `key: null`. Audit: `ROLE_CREATED` with `changes: { name, description, grants, cloneFromId }`.

#### `GET` `/api/admin/roles/{id}`

- **Auth**: admin-session (guard: `roles:view`)
- **Purpose**: Fetch a single Role with its grants and user counts. **Archived Roles are fetchable by id** (needed for the archived editor and restore review); the restore review itself stays separately validated on `/restore`.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success: true, data: RoleDetail }`; 404 `{ success: false, error: "Role not found", code: "NOT_FOUND" }`; 401/403 guard; 500 `INTERNAL`
- **Notes**: Unlike the list endpoint, archived Roles are returned here (`includeArchived: true`).

#### `PUT` `/api/admin/roles/{id}`

- **Auth**: admin-session (guard: `roles:edit`)
- **Purpose**: Atomic **complete-draft** revision of a Role's identity and grants (the whole grant set is replaced; omitted grants are removed).
- **Params**: `{id}`
- **Body**: `{ name: string, description?: string|null, grants: [{ module, action, scope }] (required), expectedVersion: int (positive), reason?: string|null }` — `reason` is required by the planner whenever the draft removes or narrows a grant (`400 REDUCTION_REASON_REQUIRED`)
- **Response**: 200 `{ success: true, data: RoleDetail }` (bumped `version`, new grant set); 400 `INVALID_BODY`/`INVALID_NAME`/`PROTECTED_NAME`/`INVALID_GRANTS`/`COVERAGE_VIOLATION`/`REDUCTION_REASON_REQUIRED`; 403 `CEILING_VIOLATION`/`OWNER_IMMUTABLE`/`SELF_ROLE_REVISION`; 404 `NOT_FOUND` (unknown **or archived** Role — archived Roles must be restored first); 409 `STALE_VERSION`/`DUPLICATE_NAME`/`CONFLICT`; 500 `INTERNAL`
- **Notes**: Optimistic concurrency — `expectedVersion` must equal the Role's current `version` (`409 STALE_VERSION` otherwise). A concurrent duplicate-name insert loses the race into `409 DUPLICATE_NAME`; other constraint races become `409 CONFLICT`. Archived Roles cannot be revised (`404`). Audit: `ROLE_UPDATED` with `changes: { before: { name, description, grants }, after: { name, description, grants }, diff: { added, removed }, reduction, reason }`.

#### `DELETE` `/api/admin/roles/{id}` — archive (no hard delete)

- **Auth**: admin-session (guard: `roles:delete`)
- **Purpose**: Archive a custom Role (soft delete — the row and its grants are retained for the restore review and audit history).
- **Params**: `{id}`
- **Body**: `{ reason: string (min 1) }`
- **Response**: 200 `{ success: true, data: RoleDetail }` (`archived: true`, **retained** grants, `activeUserCount: 0`, bumped `version`); 400 `INVALID_BODY`/`REASON_REQUIRED`; 403 `SYSTEM_ROLE_NOT_ARCHIVABLE`; 404 `NOT_FOUND`; 409 `ROLE_HAS_ACTIVE_USERS`/`CONFLICT`; 500 `INTERNAL`
- **Notes**: System Roles are never archivable. The active-user guard is re-checked **inside** the transaction (`409 ROLE_HAS_ACTIVE_USERS` — "Reassign or deactivate the active users of this Role first"), so a concurrent assignment cannot slip past the pre-check. Grant rows are retained on archive; `archivedAt` is set and `version` bumps (a later restore revalidates the retained grants under the current catalog). Audit: `ROLE_ARCHIVED` with `changes: { before: { name, grants }, reason }`.

#### `POST` `/api/admin/roles/{id}/impact`

- **Auth**: admin-session (guard: `roles:edit`)
- **Purpose**: Preview a proposed revision before applying it: the grant diff (reductions and widenings) and the number of active users currently assigned to the Role. Read-only — no mutation, no audit event.
- **Params**: `{id}`
- **Body**: `{ name?: string, grants?: [{ module, action, scope }] }` — a partial draft; omitting `grants` diffs against the Role's current grants
- **Response**: 200 `{ success: true, data: { role: { id, name, version }, reduction: boolean, diff: { added: Grant[], removed: Grant[] }, invalidGrants: Grant[], affectedActiveUsers: int } }`; 400 `INVALID_BODY`; 404 `NOT_FOUND` (unknown **or archived** Role); 401/403 guard; 500 `INTERNAL`
- **Notes**: `reduction` is true when `diff.removed` is non-empty. `invalidGrants` uses **set-level** classification of the after-set (`classifyGrantSet`): a mutation grant is only flagged invalid when the remainder of the draft cannot cover it — `products:edit:all` is valid when `products:view:all` is retained alongside it.

#### `GET` `/api/admin/roles/{id}/restore`

- **Auth**: admin-session (guard: `roles:view`)
- **Purpose**: Restore review of an archived Role: its identity plus the **retained** grants classified against the **current** grant catalog.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success: true, data: { role: { id, name, description, version, archivedAt }, validGrants: Grant[], invalidGrants: Grant[] } }`; 404 `{ success: false, error: "Archived Role not found", code: "NOT_FOUND" }` (unknown **or not-archived** Role); 401/403 guard; 500 `INTERNAL`
- **Notes**: Classification is set-level (`classifyGrantSet`) — a mutation grant covered by the valid remainder stays valid.

#### `POST` `/api/admin/roles/{id}/restore`

- **Auth**: admin-session (guard: `roles:edit`)
- **Purpose**: Activate an archived Role after reviewed revalidation (new name/description/grants submitted by the client).
- **Params**: `{id}`
- **Body**: `{ name: string, description?: string|null, grants: [{ module, action, scope }] (required), expectedVersion: int (any int — a stale or non-positive value is a semantic `409 STALE_VERSION`, not a body error) }`
- **Response**: 200 `{ success: true, data: RoleDetail }` (`archived: false`, `archivedAt: null`, bumped `version`); 400 `INVALID_BODY`/`INVALID_NAME`/`PROTECTED_NAME`/`INVALID_GRANTS`/`COVERAGE_VIOLATION`; 403 `CEILING_VIOLATION`; 404 `NOT_FOUND`; 409 `STALE_VERSION`/`ROLE_NOT_ARCHIVED`/`DUPLICATE_NAME`/`CONFLICT`; 500 `INTERNAL`
- **Notes**: The optimistic version gate runs first (pre-transaction) so a stale draft is rejected before any validation; the transaction then re-locks and re-checks. Catalog well-formedness gates the ceiling (unsupported module/action/scope is `INVALID_GRANTS`, never a ceiling verdict). Name uniqueness includes archived Roles (excluding the Role being restored). Audit: `ROLE_RESTORED` with `changes: { before: { name, archivedAt }, after: { name, grants }, policyVersionAfter }`.

#### `POST` `/api/admin/upload`
- **Auth**: admin-session (guard: `<owning-purpose module>:<action>` — purpose-bound, e.g. `products:edit` for product images; catalog scope is all-branch only, so branch-scoped editors cannot upload product images)
- **Purpose**: Upload a single file to a configured folder.
- **Params**: query `folder` (default `"products"`; must be in `ALLOWED_FOLDERS`)
- **Body**: multipart/form-data field `file` (File)
- **Response**: 200 `{ success, url: "/uploads/<folder>/<uuid>.<ext>" }`; 400 invalid folder / no file / invalid type / file too large; 500 error
- **Notes**: Validates `file.type` against `ALLOWED_TYPES` (JPEG, PNG, WebP, GIF) and `file.size` ≤ `MAX_FILE_SIZE` (5MB). Filename = `<crypto.randomUUID()>.<ext>`; saved via `saveFile(folder, filename, buffer)`.

#### `DELETE` `/api/admin/upload`
- **Auth**: admin-session (guard on the URL's owning purpose: `<module>:<edit>`)
- **Purpose**: Delete an uploaded file by URL.
- **Params**: query `url`
- **Body**: none
- **Response**: 200 `{ success: true }`; 400 missing `url` / invalid `url`; 500 error
- **Notes**: The URL is canonicalized and validated (`resolveUploadDeleteUrl`) BEFORE deriving the purpose: percent-encoding is decoded until stable, and literal or encoded traversal (`..`/`.` dot segments), encoded separators (`%2F`, `%5C`), backslashes, NUL bytes, and malformed encoding are rejected — so `/uploads/products/../homepage/x` is denied (400) instead of being authorized as `products.edit` and deleting a homepage file. The resolved path must stay under `/uploads/<first-segment>/`; deletion requires the owning folder's module edit authority (e.g. `products.edit`). Deletion runs against the canonical URL via `deleteFile` (which additionally rejects dot-segments and keeps root containment).

## Admin — Orders, Analytics, Audit, Session, Misc

#### `GET` `/api/admin/orders`
- **Auth**: admin-session (guard: orders `view`)
- **Purpose**: List orders with customer/branch summary and per-order item count, scoped by the Current Policy's Branch Scope.
- **Params**: `status` (exact match), `branchId` (all-branch scope only — optional filter; own-branch scope ignores it and pins to the Home Branch), `from` / `to` (date range on `createdAt`; `to` inclusive by +1 day), `pickupFrom` / `pickupTo` (date range on `pickupDate`; `to` inclusive by +1 day; orders with NULL `pickupDate` are excluded when either is set), `search` (ilike on `orders.id`, `clients.name`, or `orders.contactPhone`), `page` (default 1), `limit` (default 20)
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ ...orders, customer: {id,name,email}, branch: {id,name,city}, itemCount, stockNeedsReview }], pagination: { page, limit, total, totalPages } }`; 500 `{ success: false, error: "Failed to fetch orders" }`
- **Notes**: Branch scope comes from the Current Policy via `branchScopeFromAuthorization` — `scope.mode === "own"` pins `orders.branchId` to the server-trusted Home Branch regardless of any client-supplied `branchId`; all-branch scope filters by the `branchId` param when supplied. An own-branch grant without a Home Branch fails closed (403). N+1 item-count query per order.

#### `GET` `/api/admin/orders/{id}`
- **Auth**: admin-session (guard: orders `view`)
- **Purpose**: Fetch a single order's full detail including items (with variant + first display image), customer/branch, and its durable Jubelio stock-operation lifecycle.
- **Params**: path `id` (order id)
- **Body**: none
- **Response**: 200 `{ success: true, data: { ...order fields, ppnRate, ppnAmount, customer, branch, items, stockOperations: [{ id, type, status, remoteAdjustmentId, attemptCount, lastError, createdAt, updatedAt }] } }`; 404 `"Order not found"` (also returned for a cross-branch id — existence is not disclosed); 403 `DENIED` only when an own-branch grant has no Home Branch; 500 `"Failed to fetch order"`
- **Notes**: RBAC enforced via the unified `guard` (`orders:view`) + `branchScopeFromAuthorization`: own-branch scope can only view orders whose `branchId` equals the server-pinned Home Branch; a cross-branch id maps to `404` via `crossBranchNotFound`. All-branch scope sees every order. Read-only.

#### `POST` `/api/admin/orders/{id}/stock-review`
- **Auth**: admin-session (guard: orders `edit`; branch-scoped via Current Policy — cross-branch operations map to 404)
- **Purpose**: Move one operation from `manual_review` to `reconciling` so the store cron safely searches Jubelio by its unique note.
- **Body**: `{ operationId: string }`
- **Response**: 200 on queueing; 400 invalid input; 403 branch mismatch; 404 unknown order; 409 operation no longer in manual review; 500 error.
- **Notes**: This endpoint never submits an inventory adjustment. It writes a `RECHECK_JUBELIO_STOCK` audit entry and only enables note-based reconciliation, preventing blind duplicate writes.

#### `POST` `/api/admin/orders/{id}/verify-pickup`
- **Auth**: admin-session (guard: orders `edit`; **the caller must have a server-pinned Home Branch and the order must belong to it — even an all-branch editor verifies from one physical branch**)
- **Purpose**: Verify the customer's pickup code and, on match, trigger the store's internal order-complete flow to mark the order completed.
- **Params**: path `id` (order id)
- **Body**: `{ pickupCodeInput: string (1..10 chars) }` (zod-validated)
- **Response**: 200 on completion; 400 for invalid input/state; 403 when the caller has no Home Branch in Current Policy (a policy without one can never verify); 404 for unknown or cross-branch orders (existence not disclosed); 409 invalid code; 429 while temporarily locked (with `Retry-After`); 502 when store completion fails; 500 on exception.
- **Notes**: The branch identity is the server-pinned Home Branch from the Current Policy — never a client-supplied value. Cross-branch ids hide behind 404. Pickup codes use constant-time comparison. Five failed attempts lock verification for 15 minutes; a successful verification resets attempt/lock state. Completion is delegated to the store HMAC-protected internal endpoint and recorded in `auditLogs` (`VERIFY_PICKUP_CODE`, with the policy version and branch scope stamped on the Audit Event).

#### `GET` `/api/admin/analytics`
- **Auth**: admin-session (guard: `analytics:view`)
- **Purpose**: Return dashboard aggregates — revenue, average order value, a 30-calendar-day (WIB) revenue trend, order/customer counts, orders grouped by status, and 5 most recent orders.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: { totalRevenue, monthlyRevenue, totalOrders, weeklyOrders, totalCustomers, averageOrderValue, ordersByStatus: [{ status, count }], recentOrders: [{ id, total, status, createdAt, customer }], trend: [{ date, revenue, orders }] } }`; 403 when an own-branch grant has no Home Branch (fail closed); 500 `"Failed to fetch analytics"`
- **Notes**: Branch Analytics scope comes from the Current Policy: own-branch scope filters revenue, order counts, statuses, trend, recent activity, and distinct transacting customers to the server-pinned Home Branch (branch-less orders excluded); all-branch scope includes every order, including branch-less ones. **Revenue semantics**: every revenue aggregate (all-time, monthly, `averageOrderValue`, `trend[].revenue`) counts only orders with `paymentStatus = "paid"` AND `status <> "cancelled"` — a late-settled `failed_payment` order with `paymentStatus = "paid"` counts, the failed path does not, and cancelled orders never contribute revenue while still counting as orders. `monthlyRevenue` = rolling 30 × 24 h, `weeklyOrders` = rolling 7 × 24 h. `averageOrderValue` = all-time qualifying revenue ÷ qualifying order count (`0` when none). `trend` is exactly 30 consecutive `Asia/Jakarta` (WIB) calendar days ending today in WIB, oldest → newest, zero-filled (`date` = `"YYYY-MM-DD"`); trend `orders` counts all statuses. A distinct customer counts only after transacting through an order in the authorized scope (the customer directory itself is global). The response is additive over the original contract (original fields unchanged in shape).

#### `GET` `/api/admin/audit-log`
- **Auth**: admin-session (guard: `audit_log:view`)
- **Purpose**: List audit log entries newest-first, joined with the acting user's name/email.
- **Params**: `limit` (default 50)
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ ...auditLogs, user: { id, name, email } | { name: "System", email: null } }] }`; 500 `"Failed to fetch audit log"`
- **Notes**: Left-joins `users` on `auditLogs.userId`; missing user normalized to `{ name: "System", email: null }`. No pagination cursor — only `limit`. Branch scope comes from the Current Policy: own-branch scope returns only Home-Branch events (`single_branch` events on the Home Branch plus `dual_branch` reassignment events touching it as old or new branch); global/system/product-sync events are excluded. All-branch scope returns branch-tagged and global events alike.

#### `GET` `/api/admin/me`
- **Auth**: admin-session (no module authorization gate — identity only)
- **Purpose**: Return the currently signed-in admin user's identity (id, name, email, assigned Role id, Home Branch id).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, user: { id, name, email, roleId, branchId } }`; 401 if unauthenticated; 500 `"Failed to fetch current user"`
- **Notes**: Read-only; carries no protected business data, so there is no module gate. Policy discovery (grants/scopes/policyVersion) lives in `GET /api/admin/policy/me`; the legacy `role` name field is gone (assignment is `roleId` + `branchId`).

#### `GET` `/api/admin/session-check`
- **Auth**: admin-session (no role check; missing session returns `200` not `401`)
- **Purpose**: Post-login check to decide whether the current user must complete a forced password reset.
- **Params**: —
- **Body**: none
- **Response**: 200 (auth) `{ success: true, authenticated: true, mustResetPassword: boolean }`; 200 (no session/error) `{ success: false, mustResetPassword: false, authenticated: false }`
- **Notes**: Reads `session.user.mustResetPassword`. Errors swallowed and returned as `authenticated: false` with `200` — no error surface to the client.

#### `GET` `/api/admin/linkable-destinations`
- **Auth**: admin-session (guard: `footer:view`)
- **Purpose**: Return categorized storefront destinations usable as footer link hrefs (consumed by FooterLinkPicker).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: { pages: [{ label: title, href: "/pages/<slug>" }], static: [{ label, href }, ...] } }`; 500 `"Failed to fetch linkable destinations"`
- **Notes**: Gated by `footer:view`. `pages` = published static pages (`isPublished = true`) ordered by `displayOrder` then `title`. `static` is hard-coded: Beranda `/`, Semua Produk `/products`, Cabang `/branches`, Keranjang Belanja `/cart`, Checkout `/checkout`, Akun Saya `/account`, Masuk `/login`, Daftar `/register`. Auth-gated routes are safe to link because storefront middleware redirects guests to `/login?callbackUrl=`.

#### `GET` `/api/admin/footer`
- **Auth**: admin-session (guard: `footer:view`)
- **Purpose**: Fetch the singleton footer-config row's `data` field (or `null` if none exists; the admin form falls back to empty fields, and the storefront renders an empty footer until a row is seeded — see `docs/features/footer.md`).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: null }` (no row) or `{ success: true, data: { id, data, updatedAt } }`; 500 `"Failed to fetch footer config"`
- **Notes**: Read-only.

#### `PUT` `/api/admin/footer`
- **Auth**: admin-session (guard: `footer:edit`)
- **Purpose**: Upsert the singleton footer config row.
- **Params**: —
- **Body**: `{ brandName: string (1..100), tagline: string (≤300, default ""), copyrightText: string (1..200), columns: [{ title: string (1..100), links: [{ label: string (1..100), href: string (1..500) }] }] (max 3 columns, max 5 links/column, default []), socialMedia: [{ platform: "instagram"|"facebook"|"twitter"|"tiktok"|"youtube"|"linkedin"|"whatsapp", url: string (≤500, default ""), enabled: boolean (default false) }] (default []) }` (zod-validated)
- **Response**: 200 `{ success: true, data: { id, data } }` (update or insert); 400 `{ success: false, error: "Invalid request body", details: <zod fieldErrors> }`; 500 `"Failed to save footer config"`
- **Notes**: Upsert: selects the first `footerConfig` row; if found, updates `data`, `updatedAt = now()`, `updatedBy = ctx.user.id`; else inserts with `id = crypto.randomUUID()`. No audit-log write.

## Admin — Homepage, Pages, Removed legacy permission endpoints, Auth, Uploads

#### `GET` `/api/admin/homepage`
- **Auth**: admin-session (guard: `homepage:view`)
- **Purpose**: List all homepage sections ordered by `displayOrder`, with carousel products hydrated.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: Section[] }`; 500 `{ success: false, error }`
- **Notes**: For `carousel_product` sections, joins `homepageSectionProducts` → `products` and attaches a `products` array of `{ id, name, slug, displayOrder }`. `store_banner` and other types returned as-is.

#### `POST` `/api/admin/homepage`
- **Auth**: admin-session (guard: `homepage:edit`)
- **Purpose**: Create a new homepage section.
- **Params**: —
- **Body**: `{ type: "banner"|"carousel_product"|"promo_cards"|"announcement_bar"|"store_banner", title?: string|null, subtitle?: string|null, content?: object, isActive?: boolean (default true), productIds?: string[] }`
- **Response**: 200 `{ success: true, data: { id } }`; 400 `{ success: false, error, details }` (invalid body or content shape); 500 on error
- **Notes**: Content validated per-type via Zod (`banner` → `slides` max 5, `carousel_product` → `mode` enum manual/filter + `limit` 1-20, `promo_cards` → `cards` max 6, `announcement_bar` → `message` + `variant`). The carousel/promo `filter` object (`ProductFilterConfig`) accepts `search`, `category`/`brand`/`gender` (slugs), `minPrice`, `maxPrice`, `hasDiscount`, `sortOrder` (`newest|priceAsc|priceDesc`) — field names match the `/api/products` query format. New section's `displayOrder` = `max(existing)+1`. Junction rows only inserted for `carousel_product` when `content.mode !== "filter"`.

#### `GET` `/api/admin/homepage/{id}`
- **Auth**: admin-session (guard: `homepage:view`)
- **Purpose**: Fetch a single homepage section by id, with linked products for carousels.
- **Params**: `{ id }` (path)
- **Body**: none
- **Response**: 200 `{ success: true, data: Section & { products: { id, name, slug, displayOrder }[] } }`; 404 if not found; 500 on error
- **Notes**: For `carousel_product`, returns `products` ordered by junction `displayOrder`. Non-carousel sections return `products: []`.

#### `PATCH` `/api/admin/homepage/{id}`
- **Auth**: admin-session (guard: `homepage:edit`)
- **Purpose**: Update a homepage section.
- **Params**: `{ id }` (path)
- **Body**: `{ type?, title?: string|null, subtitle?: string|null, content?: object, isActive?: boolean, displayOrder?: number, productIds?: string[] }`
- **Response**: 200 `{ success: true }`; 404 if not found; 400 invalid body/content shape; 500 on error
- **Notes**: Validates content per effective type. For `banner`/`promo_cards` content changes, extracts `/uploads/` image URLs from old vs new content and deletes orphaned files via `deleteFile`. For `carousel_product`, when `productIds` provided: deletes all existing junction rows first, then re-inserts only if carousel is NOT in `filter` mode. Sets `updatedAt`.

#### `DELETE` `/api/admin/homepage/{id}`
- **Auth**: admin-session (guard: `homepage:delete`)
- **Purpose**: Delete a homepage section and its referenced image files.
- **Params**: `{ id }` (path)
- **Body**: none
- **Response**: 200 `{ success: true }`; 404 if not found; 500 on error
- **Notes**: Before DB delete, extracts `/uploads/` image URLs from `banner` slides and `promo_cards` cards and deletes the files (per-file errors swallowed).

#### `PATCH` `/api/admin/homepage/reorder`
- **Auth**: admin-session (guard: `homepage:edit`)
- **Purpose**: Reorder homepage sections by updating `displayOrder`.
- **Params**: —
- **Body**: `{ items: { id: string, displayOrder: number }[] }`
- **Response**: 200 `{ success: true }`; 400 invalid body; 500 on error
- **Notes**: Iterates items and updates each section's `displayOrder` + `updatedAt` sequentially (no transaction).

#### `GET` `/api/admin/homepage/preview-all`
- **Auth**: admin-session (guard: `homepage:view`)
- **Purpose**: Return ALL homepage sections (active and inactive) fully hydrated for admin preview.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: Section[] }` (empty array if no sections); 500 on error
- **Notes**: Unlike the storefront endpoint, includes inactive sections. For `carousel_product` in `manual` mode, hydrates products with the cheapest-variant net price and the default-variant image, returning `products: { id, name, slug, price, basePrice, image, collection, gender }[]` (`price` = net, `basePrice` = RRP; `collection` from the product row, `gender` resolved from `genderId` via a per-page gender-name lookup — both nullable). For `filter` mode, runs `resolveFilterModeProducts` mirroring storefront logic (status `aktif`, optional `search`/`category`/`brand`/price range/`hasDiscount`/`sortOrder` of `newest|priceAsc|priceDesc`, limit clamped 1-20); filter-mode products also carry `collection`/`gender` (via a left join on `genders`). `store_banner` sections include `branches` (status `aktif`, ordered by `name`).

#### `GET` `/api/admin/homepage/preview-products`
- **Auth**: admin-session (guard: `homepage:view`)
- **Purpose**: Server-side proxy to storefront `/api/products` for carousel filter-mode preview.
- **Params**: query — forwards whitelisted `search`, `category`, `brand`, `minPrice`, `maxPrice`, `hasDiscount`, `sortOrder`, `sortBy`, `page`, `limit`
- **Body**: none
- **Response**: Proxied storefront response (status + JSON passed through); 500 on fetch error
- **Notes**: Forwards only the whitelisted params; defaults `limit=10`, `page=1`. Store base URL from `NEXT_PUBLIC_STORE_URL` || `STORE_URL` || `http://localhost:3000`. Uses `cache: "no-store"`. Avoids CORS by fetching server-to-store.

#### `GET` `/api/admin/pages`
- **Auth**: admin-session (guard: `pages:view`)
- **Purpose**: List all static pages ordered by `displayOrder` then `updatedAt`.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: { id, slug, title, content, isPublished, displayOrder, updatedAt }[] }`; 500 on error
- **Notes**: —

#### `POST` `/api/admin/pages`
- **Auth**: admin-session (guard: `pages:edit`)
- **Purpose**: Create a static page.
- **Params**: —
- **Body**: `{ slug: string (1-60 chars, /^[a-z0-9-]+$/), title: string (1-200 chars), content?: string (default ""), isPublished?: boolean (default true), displayOrder?: int (default 0) }`
- **Response**: 200 `{ success: true, data: { id, slug, title, isPublished, displayOrder } }`; 400 invalid body (`details` = flattened field errors); 409 if slug already exists; 500 on error
- **Notes**: `id` via `crypto.randomUUID()`. Enforces slug uniqueness against `staticPages`.

#### `GET` `/api/admin/pages/{id}`
- **Auth**: admin-session (guard: `pages:view`)
- **Purpose**: Fetch a single static page by id.
- **Params**: `{ id }` (path)
- **Body**: none
- **Response**: 200 `{ success: true, data: { id, slug, title, content, isPublished, displayOrder, createdAt, updatedAt } }`; 404 `"Halaman tidak ditemukan."`; 500 on error
- **Notes**: —

#### `PUT` `/api/admin/pages/{id}`
- **Auth**: admin-session (guard: `pages:edit`)
- **Purpose**: Update a static page.
- **Params**: `{ id }` (path)
- **Body**: `{ slug?: string, title?: string, content?: string, isPublished?: boolean, displayOrder?: int }`
- **Response**: 200 `{ success: true, data: { id } }`; 404 if not found; 400 invalid body; 409 if slug taken by another page; 500 on error
- **Notes**: When `slug` is provided, uniqueness is checked excluding the current id. Only provided fields are written; `updatedAt` always refreshed.

#### `DELETE` `/api/admin/pages/{id}`
- **Auth**: admin-session (guard: `pages:delete`)
- **Purpose**: Delete a static page.
- **Params**: `{ id }` (path)
- **Body**: none
- **Response**: 200 `{ success: true, data: { id } }`; 404 if not found; 500 on error
- **Notes**: —

#### `/api/admin/permissions` — **REMOVED** (`GET`, `PUT`)

#### `GET` `/api/admin/permissions/me` — **REMOVED**
- **Status**: All three legacy permission endpoints return **`404`**. They were removed by the RBAC slice-9 cutover (migration `0018` dropped the `permission` table, the static permission map, and the legacy `users.role` column; runbook: `docs/deployment-docs/rbac-rollout.md`). There is no permission-map CRUD anymore: grants are managed via `/api/admin/roles` as normalized scoped grants on dynamic Roles, and policy discovery is `GET /api/admin/policy/me`.

#### `GET` `/api/admin/policy/me`
- **Auth**: admin-session (no module authorization gate — this is how the client discovers its own policy, including the deny-all No-Access case)
- **Purpose**: Return the caller's Current Policy: Role identity, the exact current grants/scopes, Home Branch display data, and the policy version (`role.version`).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: { user: { id, name, email, isActive, homeBranchId, homeBranch: { id, name, code, city } | null }, role: { id, key, name, isSystem, archived }, grants, policyVersion, mustResetPassword } }`; 401 `UNAUTHENTICATED` if no session; 403 `NO_ACCESS` when the policy is unresolvable (unassigned/invalid Role); 500 on error
- **Notes**: `force-dynamic`. The policy is resolved from the database on every call — never cached in the session — so role/grant/assignment changes apply on the next request. The browser mirrors this payload through `apps/admin/src/lib/rbac/policy-client.ts` for client-side checks.

#### `GET` & `POST` `/api/auth/*`
- **Auth**: managed per-endpoint by Better Auth `auth.handler`
- **Purpose**: Better Auth catch-all handler for all `/api/auth/*` admin auth endpoints (sign-in, sign-out, session, etc.).
- **Params**: —
- **Body**: varies per Better Auth endpoint
- **Response**: delegated to `auth.handler` via `toNextJsHandler(auth)`
- **Notes**: The admin Better Auth instance (`admin` cookie prefix / `users` table). All `/api/auth/*` requests are served by this catch-all.

#### `GET` `/uploads/{path...}`
- **Auth**: none (public file serving)
- **Purpose**: Serve an uploaded file from the uploads directory.
- **Params**: `{ path: string[] }` (catch-all path segments)
- **Body**: none
- **Response**: 200 file bytes with `Content-Type` by extension (`.jpg/.jpeg` → `image/jpeg`, `.png` → `image/png`, `.webp` → `image/webp`, `.gif` → `image/gif`, else `application/octet-stream`) and `Cache-Control: public, max-age=31536000, immutable`; 403 `"Forbidden"` if path contains `..`; 404 `"Not Found"` if file missing
- **Notes**: Path traversal guard rejects `..`. Resolves via `path.join(getUploadsDir(), relativePath)`. No session check — public static file route.

#### `GET` `/api/admin/notifications/poll`
- **Auth**: admin-session
- **Purpose**: Long-polling endpoint used by the admin notification bell and notifications page to receive new order-paid events in near real-time.
- **Params**: `since` (ISO8601 timestamp, optional) — client-supplied watermark; the server returns any notifications with `createdAt > since`.
- **Body**: none
- **Response**:
  - First call (no `since`): 200 `{ success: true, data: [], unreadCount: N, serverNow: "<db-now-iso>" }`
  - With `since` and new rows exist: 200 `{ success: true, data: NotificationListItem[], unreadCount: N, serverNow: "<latest-createdAt-or-db-now>" }`
  - With `since` and no new rows within ~25s: 200 `{ success: true, data: [], unreadCount: N, serverNow: "<db-now-iso>" }`
  - 401 if no session; 500 on error
- **Notes**: `dynamic = "force-dynamic"`. Scope is enforced server-side from the Current Policy: own-branch scope only receives notifications for the server-pinned Home Branch; all-branch scope receives notifications for all branches. An own-branch grant without a Home Branch fails closed (403), never widening to all-branch. The client reconnects immediately after every response, using `serverNow` as the next `since` value. The in-memory pending-poll broadcaster (`apps/admin/src/lib/notification-broadcaster.ts`) wakes matching listeners when a new notification row is inserted.

#### `GET` `/api/admin/notifications`
- **Auth**: admin-session (`notifications:view`)
- **Purpose**: Paginated list of notifications for the full `/admin/notifications` page.
- **Params**: `isRead` (`"all"` | `"read"` | `"unread"`, default `"all"`), `page` (int, default `1`), `limit` (int, default `20`, max `100`)
- **Body**: none
- **Response**: 200 `{ success: true, data: NotificationListItem[], pagination: { page, limit, total, totalPages } }`; 401/403/500 on error
- **Notes**: Scope comes from the Current Policy: own-branch scope is pinned to the server-pinned Home Branch; all-branch scope sees all. Each row includes joined `branch` and `order` details (customer name, order status, total).

#### `PATCH` `/api/admin/notifications/{id}`
- **Auth**: admin-session (`notifications:edit`)
- **Purpose**: Mark a single notification as read.
- **Params**: `{id}` — notification id
- **Body**: none
- **Response**: 200 `{ success: true }`; 404 if notification not found or not in scope; 401/403/500 on error
- **Notes**: Updates `isRead = true`, `readAt = now()`, `updatedAt = now()`.

#### `POST` `/api/admin/notifications/mark-all-read`
- **Auth**: admin-session (`notifications:edit`)
- **Purpose**: Mark every unread notification in the user's scope as read.
- **Body**: none
- **Response**: 200 `{ success: true, updated: N }`; 401/403/500 on error
- **Notes**: The bell dropdown and the `/admin/notifications` page both call this on open (per product decision).

#### `DELETE` `/api/admin/notifications/{id}`
- **Auth**: admin-session (`notifications:delete`)
- **Purpose**: Delete a single notification.
- **Params**: `{id}` — notification id
- **Body**: none
- **Response**: 200 `{ success: true }`; 404 if not found or not in scope; 401/403/500 on error
- **Notes**: Hard delete; no audit trail is kept for notification deletions.

#### `DELETE` `/api/admin/notifications/clear-all-read`
- **Auth**: admin-session (`notifications:delete`)
- **Purpose**: Bulk delete all already-read notifications in the user's scope.
- **Body**: none
- **Response**: 200 `{ success: true, deleted: N }`; 401/403/500 on error
- **Notes**: Used by the "Hapus Dibaca" button on `/admin/notifications`.

---

## Appendix — Cross-cutting behaviors

- **Stock reservation model**: availability is `branch_stock.stock - pendingRemoteStock`. `reservedStock` represents a confirmed Jubelio deduction and is not subtracted again. Place-order writes a negative adjustment before Midtrans; failure/expiry writes a positive compensation. Catalog sync never touches either runtime counter. See `docs/features/stock-reservation.md`.
- **RBAC (admin)**: every policy-protected route seam uses the unified `guard` (`apps/admin/src/lib/rbac/guard.ts`) — 401 for a missing session, 403 with a stable code (`NO_ACCESS` for admission failures, `DENIED` for missing grants). Branch-aware list/detail endpoints are scoped via `branchScopeFromAuthorization` (`apps/admin/src/lib/rbac/branch-scope.ts`): `own_branch` scope is pinned server-side to the user's Home Branch (fail closed when missing); `all_branches` imposes no branch filter. Cross-branch object ids map to 404 via `crossBranchNotFound` so existence is not disclosed. Policy discovery is `GET /api/admin/policy/me`; the legacy permission map and `/api/admin/permissions` endpoints were removed (404) by the slice-9 cutover.
- **Audit log**: significant mutations write `audit_log` rows through the unified `writeAuditEvent` seam (`apps/admin/src/lib/rbac/audit-writer.ts`): Roles (`ROLE_CREATED/UPDATED/ARCHIVED/RESTORED`), Users (`USER_CREATED/UPDATED/DEACTIVATED/REACTIVATED`), Branches (`CREATE/UPDATE/DELETE_BRANCH`), order stock-review (`RECHECK_JUBELIO_STOCK`) and pickup verification (`VERIFY_PICKUP_CODE`), and Jubelio syncs (`JUBELIO_SYNC_ADMIN`, `JUBELIO_SYNC_WEBHOOK`). RBAC/branch/order writers run **inside the mutation's transaction** and stamp `policyVersion` plus a `branchScope` classification (`global`/`single_branch`/`dual_branch` + `branchId`/`relatedBranchId`). Homepage/pages/footer mutations and notification deletes keep no audit trail — noted per endpoint. The store webhook row is a legacy unclassified event (no `policyVersion`/`branchScope`). Full writer/shape reference: `docs/features/audit-log.md`.
- **Idempotency**: payment webhooks (Midtrans + sweep) use a claim-guard so duplicate/replayed notifications are safe. The Jubelio webhook is upsert-only on natural keys, so replays are safe.
- **Transactions**: most admin CRUD endpoints do **not** wrap multi-row writes in a DB transaction (noted where relevant); `place-order` and the stock-claim flows do.
