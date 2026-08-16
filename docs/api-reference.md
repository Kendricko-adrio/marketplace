# API Reference — Marketplace Monorepo

> Reference for **every HTTP API endpoint** in the project, derived from the
> `route.ts` handlers under `apps/store/src/app` and `apps/admin/src/app`.
> Last updated: 2026-08-16.
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
| **Admin** (back office) | `apps/admin` | `http://localhost:3001` | `dev-admin.adfsport.cloud` | `admin` cookie prefix · `users` table (roles `admin`/`hq`) |

Both apps import the shared Drizzle schema and create their **own local `db`
instance** (`@/db`). DB tables are owned solely by `packages/db`.

## Authentication & conventions

### Auth types used across endpoints

| Label | Meaning |
|---|---|
| **`none`** | Public, no auth. |
| **`client-session`** | Store Better Auth session (`client.session_token` cookie). Missing → `401`. |
| **`admin-session`** | Admin Better Auth session (`admin.session_token` cookie). Missing → `401`. |
| **`admin-session (permission: <module>:<action>)`** | Admin session **plus** a permission check via the in-app RBAC permission map (`<action>` ∈ `view`/`edit`/`delete`). |
| **`admin-session (role: hq)`** | Admin session **plus** explicit `role === "hq"` check (HQ is the implicit superuser). |
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
| `JUBELIO_WEBHOOK_SECRET` | `POST /api/webhooks/jubelio` | `webhook-signature` (`SHA256(body+secret)`) |
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
| GET | `/api/genders` | none | List all product genders (dimension) for storefront filter dropdowns |
| GET | `/api/products` | none | Paginated/filterable product list |
| GET | `/api/products/{id}` | none | Product detail + variants + per-branch stock |
| GET | `/api/homepage` | none | Assemble active homepage sections (hydrated) |
| POST | `/api/vouchers/validate` | none | Validate voucher code + preview discount |
| GET | `/api/cart` | client-session | Get (auto-create) cart with items + subtotal |
| DELETE | `/api/cart` | client-session | Clear all cart items |
| POST | `/api/cart/items` | client-session | Add variant@branch to cart (merge) |
| PUT | `/api/cart/items/{id}` | client-session | Update cart item quantity |
| DELETE | `/api/cart/items/{id}` | client-session | Remove a cart item |
| POST | `/api/cart/validate-checkout` | client-session | Pre-checkout branch/stock validation |
| POST | `/api/checkout/validate-step-2` | client-session | Validate pickup slot vs operating hours |
| GET | `/api/checkout/order-status` | client-session | Poll order status/paymentStatus |
| POST | `/api/checkout/place-order` | client-session | Create order, reserve stock, Midtrans Snap |
| GET | `/api/orders` | client-session | List the user's orders |
| GET | `/api/orders/{id}` | client-session | Order detail (+ pickup code when applicable) |
| PATCH | `/api/account/profile` | client-session | Update client name/phone |
| POST | `/api/payments/midtrans/create` | client-session | Re-payment for a pending_payment order |
| POST | `/api/webhooks/midtrans` | signature-verification | Midtrans payment notification → finalize/fail order |
| POST | `/api/webhooks/jubelio` | signature `SHA256(body+JUBELIO_WEBHOOK_SECRET)` | **Jubelio master-data sync (product/price/stock push)** |
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
| GET | `/api/admin/genders` | admin-session (products:view) | List all product genders (dimension) for the homepage ProductFilterEditor dropdown |
| GET | `/api/admin/branches` | admin-session (branches:view) | List branches (paginated) |
| POST | `/api/admin/branches` | admin-session (branches:edit) | Create branch |
| GET | `/api/admin/branches/{id}` | admin-session (branches:view) | Fetch a branch |
| PUT | `/api/admin/branches/{id}` | admin-session (branches:edit) | Update a branch |
| DELETE | `/api/admin/branches/{id}` | admin-session (branches:delete) | Delete a branch |
| GET | `/api/admin/users` | admin-session (users:view) | List admin users (+ branch, last login) |
| POST | `/api/admin/users` | admin-session (users:edit) | Create admin/hq user |
| GET | `/api/admin/users/{id}` | admin-session (users:view) | Fetch a user |
| PATCH | `/api/admin/users/{id}` | admin-session (users:edit) | Update user (name/email/role/branch) |
| DELETE | `/api/admin/users/{id}` | admin-session (users:delete) | Delete a user (guards: self, last-hq) |
| POST | `/api/admin/users/{id}/reset-password` | admin-session (users:edit) | Reset password + revoke sessions |
| POST | `/api/admin/upload` | admin-session | Upload a file |
| DELETE | `/api/admin/upload` | admin-session | Delete an uploaded file |
| GET | `/api/admin/orders` | admin-session (orders view) | List orders (RBAC branch-scoped) |
| GET | `/api/admin/orders/{id}` | admin-session (orders view) | Order detail |
| POST | `/api/admin/orders/{id}/verify-pickup` | admin-session (orders edit, branch admin only) | Verify pickup code → complete order |
| GET | `/api/admin/analytics` | admin-session | Dashboard aggregates |
| GET | `/api/admin/audit-log` | admin-session | List audit log (newest first) |
| GET | `/api/admin/me` | admin-session | Current admin identity |
| GET | `/api/admin/session-check` | admin-session (soft) | Must-reset-password check |
| POST | `/api/admin/clear-must-reset` | admin-session | Clear must-reset + revoke other sessions |
| GET | `/api/admin/linkable-destinations` | admin-session (hq) | Footer link target catalog |
| GET | `/api/admin/footer` | admin-session (hq) | Fetch footer config |
| PUT | `/api/admin/footer` | admin-session (hq) | Upsert footer config |
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
| GET | `/api/admin/permissions` | admin-session (hq) | List permissions |
| PUT | `/api/admin/permissions` | admin-session (hq) | Upsert a permission (admin role) |
| GET | `/api/admin/permissions/me` | admin-session | Current user's role + permissions |
| GET | `/api/admin/notifications/poll` | admin-session | Long-poll real-time notifications (branch/HQ scoped) |
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

#### `GET` `/api/genders`
- **Auth**: none
- **Purpose**: List all product genders (dimension) for storefront filter dropdowns.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ id, name, slug }] }`; 500 `{ success: false, error }`
- **Notes**: Sync-managed dimension (supplier `sex` → `genders`), populated by the Jubelio import / webhook. Ordered by `name` asc. Distinct from the `clients.gender` onboarding field.

#### `GET` `/api/products`
- **Auth**: none
- **Purpose**: Paginated, filterable product list for storefront browsing.
- **Params**: `search` (string, optional), `category` (slug, optional), `brand` (slug, optional), `gender` (slug, optional), `minPrice` (string, optional), `maxPrice` (string, optional), `status` (string, default `"aktif"`), `hasDiscount` (`"true"` to filter products whose `basePrice > min(variant.price)`), `sortBy` (`"price"`|`"createdAt"`, default `"createdAt"`), `sortOrder` (`"asc"`|`"desc"`, default `"desc"`), `page` (int, default `1`), `limit` (int, default `12`)
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ id, name, slug, description, basePrice, status, createdAt, price, image, collection: string|null, gender: string|null }], pagination: { page, limit, total, totalPages } }`; 500 `{ success: false, error }`
- **Notes**: `price` is the **cheapest variant net price** per product (`min(productVariants.price)` via a grouped subquery join) — the price the customer pays and the value shown on product cards; `basePrice` is the RRP (strikethrough/original). `image` is the first image (`displayOrder` asc) of the **default** variant (separate from price). `minPrice`/`maxPrice` and `sortBy=price` operate on the cheapest-variant net price; `hasDiscount` filters to `basePrice > min(variant.price)`. `category` (slug), `brand` (slug), and `gender` (slug) are each resolved to an id and applied as conditions to **both** the list and the count query, so `pagination.total` is correct under any filter combination (category uses a junction-table subquery; brand/gender are direct `brandId`/`genderId` equality). An unknown slug yields zero results.

#### `GET` `/api/products/{id}`
- **Auth**: none
- **Purpose**: Full product detail with variants, per-variant branch availability, and categories.
- **Params**: `{id}` — accepts either the product `id` or its `slug` (looked up by id first, then by slug)
- **Body**: none
- **Response**: 200 `{ success: true, data: { ...product, brand: string|null, gender: string|null, collection: string|null, categories: [{ id, name, slug }], variants: [{ ...variant, images: string[], branchStock: [{ branchId, name, code, city, stock, reservedStock, available }] }], colors: string[], sizes: string[] } }`; 404 if not found by id or slug; 500 `{ success: false, error }`
- **Notes**: Variants ordered by `isDefault` asc. `branchStock` is restricted to `branches.status = "aktif"` and only rows where `stock - reservedStock > 0`; `available = stock - reservedStock` is computed in JS. `colors`/`sizes` are unique non-null variant values. Read-only. Each variant `price` is the net price the customer pays; `product.basePrice` is the RRP. `brand`/`gender` are the resolved names from the sync-managed `brand`/`gender` dimension tables (looked up from `product.brandId`/`product.genderId`, nullable); `collection` is the plain-text collection label column on the product row.

#### `GET` `/api/homepage`
- **Auth**: none
- **Purpose**: Assemble all active homepage sections with their hydrated content (product carousels and store banners).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: sections[] }` where each section varies by `type`: `carousel_product` sections gain a `products` array; `store_banner` sections gain a `branches` array (active branches, `name` asc); other types pass through unchanged. Empty array if no sections. 500 `{ success: false, error }`
- **Notes**: Only `isActive = true` sections, ordered by `displayOrder` asc. `carousel_product` content has a `mode`: `"filter"` resolves products dynamically (mirrors `/api/products` filters: `search`, `category` slug, `brand` slug, `gender` slug, `hasDiscount`, `minPrice`, `maxPrice`, `sortOrder` of `newest|priceAsc|priceDesc`; `limit` clamped 1–20, default 10) and runs in parallel; otherwise manual mode reads `homepageSectionProducts` junction rows ordered by `displayOrder`. Carousel product `price` is the cheapest variant net price, `basePrice` is the RRP. Each carousel product also carries `collection` (text label from the product row, nullable) and `gender` (resolved name from the sync-managed `gender` dimension table via `genderId`, nullable) so product cards can render both. `store_banner` sections attach all `status = "aktif"` branches. Read-only.

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
- **Response**: 200 `{ success, data: { id, items[], itemCount, subtotal } }`; 401 if unauth; 500 on error
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
- **Notes**: Available = `branch_stock.stock - branch_stock.reservedStock`. Branch must exist with `status === "aktif"`. If a matching line exists, increments quantity and re-validates against available stock. Auto-creates cart if needed.

#### `PUT` `/api/cart/items/{id}`
- **Auth**: client-session
- **Purpose**: Update the quantity of a single cart item.
- **Params**: `{id}` (cart item id)
- **Body**: `{ quantity: number (int, positive) }`
- **Response**: 200 `{ success, message: "Cart item updated" }`; 400 invalid body / `"Insufficient stock at this branch"`; 401 if unauth; 404 `"Cart not found"` / `"Cart item not found"`; 500 on error
- **Notes**: Item is scoped to the user's cart (`cartId` match). Stock check (`stock - reservedStock >= quantity`) only run when `item.branchId` is set. Does not reserve stock.

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
- **Purpose**: Atomically create the order + order items, reserve stock, call Midtrans Snap, persist `snapRedirectUrl`, and remove only the checked-out cart items.
- **Params**: —
- **Body**: `{ phone: string (8-20), email: string (email), pickupDate: string (YYYY-MM-DD), pickupTime: string (HH:mm), selectedItemIds: string[] (min 1) }`
- **Response**: 200 `{ success, orderId, redirectUrl, token }`; 400 invalid body / `"Cart is empty"` / `"No selected items to checkout"` / multi-branch error / `"Branch is no longer available"` / invalid pickup slot / `Insufficient stock for <productName> at this branch` (soft check) / `Insufficient stock for <productName>` (atomic guard rollback); 401 if unauth; 500 on error; 502 on Midtrans failure (cart preserved)
- **Notes**: Enforces single-branch checkout; validates branch `status === "aktif"` and pickup slot. Soft stock pre-check then authoritative guard inside a DB transaction: `UPDATE branchStocks SET reservedStock = reservedStock + qty WHERE stock - reservedStock >= qty` — 0 matching rows throws `InsufficientStockError` and rolls back the whole tx (releasing reservations made for earlier items in the same tx). Order created with `status: "pending_payment"`, `paymentMethod: "qris"`, `paymentStatus: "pending"`, `expiresAt = now + reservation.ttlMinutes` (from `system_config`, default 30) — drives the sweep cron and pairs with Midtrans expiry. `createPayment` (Midtrans Snap) is called inside the tx so any failure rolls back order + reservations + cart deletion. Only the `selectedItemIds` cart items are deleted (inside tx). `serviceFee = 0`, `total = subtotal`, `shippingCost`/`discount` = `"0"`.

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
- **Response**: 401 `{ success: false, error: "Unauthorized" }`; 400 `{ success: false, error: "orderId is required" | "Order is not pending payment" }`; 404 `{ success: false, error: "Order not found" }`; 403 `{ success: false, error: "Forbidden" }`; 500 `{ success: false, error: "Failed to create payment" }`; 200 `{ success: true, redirectUrl: string, token: string }`
- **Notes**: Loads order and verifies `order.userId === session.user.id`; only `pending_payment` orders allowed (`failed_payment` is final). Persists `snapRedirectUrl` on the order. Sends item_details including a `SERVICE_FEE` line item. Env dependency: Midtrans keys via `createPayment`.

#### `POST` `/api/webhooks/midtrans`
- **Auth**: signature-verification (Midtrans `signature_key` = `SHA512(order_id + status_code + gross_amount + serverKey)`; plus authoritative re-verify with `getMidtransTransactionStatus`)
- **Purpose**: Receive Midtrans payment notification callbacks and finalize/fail orders accordingly.
- **Params**: —
- **Body**: `{ order_id, transaction_status, status_code, gross_amount, signature_key, fraud_status }` (raw JSON body; signature verified)
- **Response**: 400 `{ success: false, error: "Invalid notification" }` (missing `order_id`/`transaction_status`); 401 `{ success: false, error: "Invalid signature" }`; 404 `{ success: false, error: "Order not found" }`; 200 `{ success: true }` (also returned on idempotent skip and on handler error to prevent Midtrans retries)
- **Notes**: Signature skipped only when `signature_key` absent. Idempotency: skips orders already `paid` or `failed_payment`. Re-verifies authoritative status from Midtrans to defend against spoofed callbacks. `settlement` / `capture`+`fraud_status: accept` → `claimAndFinalizePaidOrder` (reservation → real deduction, pickup code, ready_for_pickup, email). `deny`/`cancel`/`expire` → `claimAndFailOrder` (releases reservation). `pending` → no action. Claim-guard makes it safe vs. the sweep cron. Env dependency: `MIDTRANS_SERVER_KEY`.

#### `POST` `/api/webhooks/jubelio`
- **Auth**: signature — `SHA256(rawBodyString + JUBELIO_WEBHOOK_SECRET)` (hex), sent in the `webhook-signature` (or `x-jubelio-signature`) header; recomputed from the raw request body — **503** if env unset, **401** on mismatch
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
- **Response**: 503 `{ success: false, error: "Cron not configured" }`; 401 `{ success: false, error: "Unauthorized" }`; 500 `{ success: false, error: "Sweep failed" }`; 200 `{ success: true, scanned: number, finalized: number, failed: number }`
- **Notes**: Batch of up to 100 stale orders (uses `idx_orders_status_expires`). Re-verifies Midtrans status OUTSIDE any tx (no locks held across HTTP). `settlement`/`capture`+`accept` → `claimAndFinalizePaidOrder` (missed success webhook). `pending` → best-effort `expireMidtransTransaction` then `claimAndFailOrder`; `expire`/`deny`/`cancel`/`not_found` → `claimAndFailOrder` with a descriptive reason. Transient Midtrans errors skip the order (left for next run). Claim-guard makes it idempotent and safe to run concurrently with the webhook. Always returns 200 so the crontab log stays clean. Env dependency: `CRON_SECRET` + Midtrans keys.

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

## Admin — Products, Categories, Branches, Users, Upload

#### `GET` `/api/admin/products`
- **Auth**: admin-session (permission: products/view)
- **Purpose**: List products with variants, categories, stock totals, and images (paginated).
- **Params**: query `page` (default 1), `limit` (default 20)
- **Body**: none
- **Response**: 200 `{ success, data: [...], pagination: { page, limit, total, totalPages } }`; 500 error
- **Notes**: N+1 per product (variants, categories, branchStocks sums, productImages ordered by displayOrder). Per-product fields: `variants: [{id, price, isDefault}]`, `variantCount`, `totalStock`, `totalReserved`, `totalAvailable = max(0, totalStock - totalReserved)`, `categories: [name]`, `images: [{url}]`. Also spreads the full product row (incl. `collection` text label) and adds `gender` (resolved name from the `gender` dimension table via `genderId`, nullable — batch-looked-up per page) so carousel manual-mode preview cards can render the gender label.

#### `POST` `/api/admin/products` — **REMOVED**
- **Status**: Removed. Jubelio is the source of truth for the product catalog; products are created via the Jubelio sync (`db:import-jubelio` / the Jubelio webhook / the per-product Sync button). The `GET` list endpoint remains.

#### `GET` `/api/admin/products/{id}`
- **Auth**: admin-session (permission: products/view)
- **Purpose**: Fetch a single product with its categories and variants (with images).
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success, data: { ...product, categories: [{id, name, slug}], variants: [{ ...variant, images: [{id, url, displayOrder}] }] } }`; 404 not found; 500 error
- **Notes**: Variants ordered by `isDefault` asc; images ordered by `displayOrder` asc.

#### `PUT` `/api/admin/products/{id}` — **REMOVED**
- **Status**: Removed. Jubelio is the source of truth; refresh a product via `POST /api/admin/products/{id}/sync` (the Sync button on the admin product detail page).

#### `DELETE` `/api/admin/products/{id}` — **REMOVED**
- **Status**: Removed. Jubelio is the source of truth.

#### `POST` `/api/admin/products/{id}/sync`
- **Auth**: admin-session (permission: products/edit)
- **Purpose**: Re-sync a single product from Jubelio (brand, description, gallery images, variants, per-branch stock). Triggered by the "Sync dari Jubelio" button on the admin product detail page.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success: true, data: { product: string, variants: number, stockRows: number } }`; 404 product not found; 400 `{ error: "Product is not a Jubelio-synced product (no jubelio_item_group_id)" }`; 500 sync failed
- **Notes**: Looks up the product's `jubelio_item_group_id`, calls `syncOneProduct(db, itemGroupId)` from `packages/db/src/jubelio-sync.ts` (fetches `/inventory/catalog/{id}` + `/inventory/items/all-stocks/`, upserts). Writes an `auditLogs` row (`action: "JUBELIO_SYNC_ADMIN"`). Env: `JUBELIO_EMAIL`/`JUBELIO_PASSWORD`/`JUBELIO_API_BASE_URL`.

#### `GET` `/api/admin/categories`
- **Auth**: admin-session (permission: products/view)
- **Purpose**: List active categories ordered by name.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, data: [...] }`; 500 error
- **Notes**: Filters `categories.isActive = true`. No pagination. Only `GET` is exported here.

#### `GET` `/api/admin/brands`
- **Auth**: admin-session (permission: products/view)
- **Purpose**: List all product brands (dimension) for the homepage ProductFilterEditor dropdown.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, data: [{ id, name, slug }] }`; 500 error
- **Notes**: Sync-managed dimension (no admin CRUD). Ordered by `name` asc. Read-only `GET`.

#### `GET` `/api/admin/genders`
- **Auth**: admin-session (permission: products/view)
- **Purpose**: List all product genders (dimension) for the homepage ProductFilterEditor dropdown.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, data: [{ id, name, slug }] }`; 500 error
- **Notes**: Sync-managed dimension (CSV `sex`). Ordered by `name` asc. Read-only `GET`.

#### `GET` `/api/admin/branches`
- **Auth**: admin-session (permission: branches/view)
- **Purpose**: List branches (paginated).
- **Params**: query `page` (default 1), `limit` (default 20)
- **Body**: none
- **Response**: 200 `{ success, data: [...], pagination: { page, limit, total, totalPages } }`; 500 error
- **Notes**: Ordered by `createdAt` desc.

#### `POST` `/api/admin/branches`
- **Auth**: admin-session (permission: branches/edit)
- **Purpose**: Create a branch.
- **Params**: —
- **Body**: `{ name: string, code: string, city: string, address: string, latitude?: string, longitude?: string, operatingHours: { monday?: { open, close }|null, tuesday?, ..., sunday? } (default {}), googleMapsUrl?: string (valid URL or ""), status: "aktif"|"nonaktif" (default "aktif") }`
- **Response**: 200 `{ success, data: { id } }`; 400 invalid; 500 error
- **Notes**: `latitude`/`longitude` stored null if empty; `googleMapsUrl` validated as URL or literal `""`, stored null if empty. `id` via `crypto.randomUUID()`.

#### `GET` `/api/admin/branches/{id}`
- **Auth**: admin-session (permission: branches/view)
- **Purpose**: Fetch a single branch.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success, data: branch }`; 404 not found; 500 error
- **Notes**: —

#### `PUT` `/api/admin/branches/{id}`
- **Auth**: admin-session (permission: branches/edit)
- **Purpose**: Update a branch.
- **Params**: `{id}`
- **Body**: `{ name: string, code: string, city: string, address: string, latitude?: string, longitude?: string, operatingHours: { monday?: {open,close}|null, ... sunday? } (required), googleMapsUrl?: string (valid URL or ""), status: "aktif"|"nonaktif" }`
- **Response**: 200 `{ success, data: { id } }`; 400 invalid; 404 not found; 500 error
- **Notes**: Unlike POST, `operatingHours` has no default (required) and `status` is required. `latitude`/`longitude`/`googleMapsUrl` stored null when empty. `updatedAt` set.

#### `DELETE` `/api/admin/branches/{id}`
- **Auth**: admin-session (permission: branches/delete)
- **Purpose**: Delete a branch.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success: true }`; 404 not found; 500 error
- **Notes**: No FK/cascade handling; deletion may fail if `users.branchId` or `branchStocks` reference it (relies on DB cascade/restrict).

#### `GET` `/api/admin/users`
- **Auth**: admin-session (permission: users/view) — source comments indicate HQ-only intent
- **Purpose**: List users with branch info and last login.
- **Params**: query `search` (ilike on `name`/`email`/`username`), `role` (`"admin"` or `"hq"`)
- **Body**: none
- **Response**: 200 `{ success, data: [{ id, name, username, email, role, branchId, branchName, branchCode, mustResetPassword, emailVerified, image, createdAt, updatedAt, lastLogin }] }`; 500 error
- **Notes**: `lastLogin` derived from `max(adminSessions.createdAt)` per user (null if none). Left-join on `branches`. No pagination. Enforcement is via the permission map, not an explicit role check.

#### `POST` `/api/admin/users`
- **Auth**: admin-session (permission: users/edit) — source comments indicate HQ-only intent
- **Purpose**: Create an admin or HQ user.
- **Params**: —
- **Body**: `{ name: string (2-100), email: string (valid email), role: "admin"|"hq", branchId?: string|null, passwordMode: "manual"|"generate", password?: string (min 8, required when manual) }`
- **Response**: 200 `{ success, data: { id, name, username, email, role, branchId, mustResetPassword, password } }`; 400 invalid body / admin-requires-branch / branch-not-found / password-too-short; 409 email already used; 500 error
- **Notes**: `role==="admin"` requires a valid `branchId`; `role==="hq"` forces `branchId=null`. Username auto-generated from `name` (lowercase, diacritics stripped, dots for separators, suffix increment on collision). `email` lowercased; `emailVerified=true`; `mustResetPassword=true`. Inserts a `credential` `adminAccounts` row with bcrypt hash (cost 10). Plaintext password returned once in response (never persisted).

#### `GET` `/api/admin/users/{id}`
- **Auth**: admin-session (permission: users/view)
- **Purpose**: Fetch a single user with branch info.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success, data: { id, name, username, displayUsername, email, role, branchId, branchName, branchCode, mustResetPassword, emailVerified, image, createdAt, updatedAt } }`; 404 not found; 500 error
- **Notes**: Left-join on `branches`.

#### `PATCH` `/api/admin/users/{id}`
- **Auth**: admin-session (permission: users/edit)
- **Purpose**: Update a user's name, email, role, and/or branch.
- **Params**: `{id}`
- **Body**: `{ name?: string (2-100), email?: string, role?: "admin"|"hq", branchId?: string|null }`
- **Response**: 200 `{ success: true }`; 400 invalid / admin-requires-branch / branch-not-found / role-change-to-admin-requires-branchId / cannot-demote-self; 404 not found; 409 email already used; 500 error
- **Notes**: Self-protection: an HQ user cannot demote themselves (`ctx.user.id === id` and `role !== "hq"`). Role→`hq` clears `branchId`; role→`admin` requires a `branchId` in the payload. Email lowercased and uniqueness-checked against other users. `updatedAt` set.

#### `DELETE` `/api/admin/users/{id}`
- **Auth**: admin-session (permission: users/delete)
- **Purpose**: Delete a user.
- **Params**: `{id}`
- **Body**: none
- **Response**: 200 `{ success: true }`; 400 cannot-delete-self / cannot-delete-last-hq; 404 not found; 500 error
- **Notes**: Cannot delete self. Prevents deleting the last remaining HQ user. Explicitly deletes `adminSessions` and `adminAccounts` for the user before deleting the `users` row.

#### `POST` `/api/admin/users/{id}/reset-password`
- **Auth**: admin-session (permission: users/edit) — comment indicates HQ-only intent
- **Purpose**: Reset a user's password.
- **Params**: `{id}`
- **Body**: `{ passwordMode: "manual"|"generate", password?: string (min 8, required when manual) }`
- **Response**: 200 `{ success, data: { password: string, mustResetPassword: true } }`; 400 invalid / password-too-short; 404 not found; 500 error
- **Notes**: Updates the user's `credential` `adminAccounts` row password (bcrypt, cost 10), or creates one if absent. Sets `users.mustResetPassword=true`. Deletes all `adminSessions` for the user (revokes old password on all devices). Plaintext password returned once in response.

#### `POST` `/api/admin/upload`
- **Auth**: admin-session (role: admin | hq)
- **Purpose**: Upload a single file to a configured folder.
- **Params**: query `folder` (default `"products"`; must be in `ALLOWED_FOLDERS`)
- **Body**: multipart/form-data field `file` (File)
- **Response**: 200 `{ success, url: "/uploads/<folder>/<uuid>.<ext>" }`; 400 invalid folder / no file / invalid type / file too large; 500 error
- **Notes**: Validates `file.type` against `ALLOWED_TYPES` (JPEG, PNG, WebP, GIF) and `file.size` ≤ `MAX_FILE_SIZE` (5MB). Filename = `<crypto.randomUUID()>.<ext>`; saved via `saveFile(folder, filename, buffer)`.

#### `DELETE` `/api/admin/upload`
- **Auth**: admin-session (role: admin | hq)
- **Purpose**: Delete an uploaded file by URL.
- **Params**: query `url`
- **Body**: none
- **Response**: 200 `{ success: true }`; 400 missing `url`; 500 error
- **Notes**: Delegates to `deleteFile(url)` helper (file-system removal).

## Admin — Orders, Analytics, Audit, Session, Misc

#### `GET` `/api/admin/orders`
- **Auth**: admin-session (permission: orders `view`; both `admin` and `hq` pass the guard)
- **Purpose**: List orders with customer/branch summary and per-order item count, scoped by RBAC branch visibility.
- **Params**: `status` (exact match), `branchId` (HQ-only filter), `from` / `to` (date range on `createdAt`; `to` inclusive by +1 day), `pickupFrom` / `pickupTo` (date range on `pickupDate`; `to` inclusive by +1 day; orders with NULL `pickupDate` are excluded when either is set), `search` (ilike on `orders.id`, `clients.name`, or `orders.contactPhone`), `page` (default 1), `limit` (default 20)
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ ...orders, customer: {id,name,email}, branch: {id,name,city}, itemCount }], pagination: { page, limit, total, totalPages } }`; 500 `{ success: false, error: "Failed to fetch orders" }`
- **Notes**: Branch scope via `getBranchScope` — `scope.mode === "own"` forces `orders.branchId = scope.branchId` (branch admins); HQ only filters by `branchId` when supplied. N+1 item-count query per order.

#### `GET` `/api/admin/orders/{id}`
- **Auth**: admin-session (permission: orders `view`)
- **Purpose**: Fetch a single order's full detail including items (with variant + first display image) and customer/branch.
- **Params**: path `id` (order id)
- **Body**: none
- **Response**: 200 `{ success: true, data: { ...order fields, customer: {id,name,email}, branch, items: [{ id, orderId, variantId, productName, variantInfo, price, quantity, createdAt, productId, imageUrl }] } }`; 404 `"Order not found"`; 403 `"Forbidden — order belongs to a different branch"`; 500 `"Failed to fetch order"`
- **Notes**: RBAC enforced — a branch admin whose `order.branchId !== scope.branchId` gets 403. Read-only.

#### `POST` `/api/admin/orders/{id}/verify-pickup`
- **Auth**: admin-session (permission: orders `edit`; **branch admins only — HQ is rejected**)
- **Purpose**: Verify the customer's pickup code and, on match, trigger the store's internal order-complete flow to mark the order completed.
- **Params**: path `id` (order id)
- **Body**: `{ pickupCodeInput: string (1..10 chars) }` (zod-validated)
- **Response**: 200 `{ success: true, message: "Order completed successfully" }`; 400 (invalid input, or order not `ready_for_pickup`); 403 (non-branch admin, or order belongs to another branch); 404 order not found; 409 `"Invalid pickup code. Please verify with the customer."`; 502 `"Failed to complete order. Please try again."` (store internal call failed); 500 on exception
- **Notes**: Branch-admin-only. Order must be `status === "ready_for_pickup"`. Pickup code compared with `crypto.timingSafeEqual` (constant-time, uppercase+trimmed) against `order.pickupCode`. On match: POSTs `{ orderId, secret }` to `${STORE_INTERNAL_URL||"http://localhost:3000"}/api/internal/order-complete`, where `secret = HMAC-SHA256(BETTER_AUTH_SECRET, id)`. Writes an `auditLogs` row: `action: "VERIFY_PICKUP_CODE"`, `entityType: "order"`, `entityId: id`, `changes: { status: { from: "ready_for_pickup", to: "completed" } }`. The status transition is delegated to the store endpoint (not mutated directly here).

#### `GET` `/api/admin/analytics`
- **Auth**: admin-session (roles: `admin`, `hq`)
- **Purpose**: Return dashboard aggregates — revenue, order/customer counts, orders grouped by status, and 5 most recent orders.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: { totalRevenue, monthlyRevenue, totalOrders, weeklyOrders, totalCustomers, ordersByStatus: [{ status, count }], recentOrders: [{ id, total, status, createdAt, customer }] } }`; 500 `"Failed to fetch analytics"`
- **Notes**: `totalRevenue`/`monthlyRevenue` filter on `paymentStatus === "paid"` (last 30 days for monthly). `weeklyOrders` = orders with `createdAt >= 7 days ago`. `totalOrders`/`totalCustomers` are unfiltered. Not branch-scoped (global aggregates).

#### `GET` `/api/admin/audit-log`
- **Auth**: admin-session (roles: `admin`, `hq`)
- **Purpose**: List audit log entries newest-first, joined with the acting user's name/email.
- **Params**: `limit` (default 50)
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ ...auditLogs, user: { id, name, email } | { name: "System", email: null } }] }`; 500 `"Failed to fetch audit log"`
- **Notes**: Left-joins `users` on `auditLogs.userId`; missing user normalized to `{ name: "System", email: null }`. No pagination cursor — only `limit`.

#### `GET` `/api/admin/me`
- **Auth**: admin-session (roles: `admin`, `hq`)
- **Purpose**: Return the currently logged-in admin user's identity for client-side role/branch UI decisions.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, user: { id, name, email, role, branchId } }`; 500 `"Failed to fetch current user"`
- **Notes**: Read-only. Fields come from the Better Auth session `user` object (extended with `role` and `branchId`).

#### `GET` `/api/admin/session-check`
- **Auth**: admin-session (no role check; missing session returns `200` not `401`)
- **Purpose**: Post-login check to decide whether the current user must complete a forced password reset.
- **Params**: —
- **Body**: none
- **Response**: 200 (auth) `{ success: true, authenticated: true, mustResetPassword: boolean }`; 200 (no session/error) `{ success: false, mustResetPassword: false, authenticated: false }`
- **Notes**: Reads `session.user.mustResetPassword`. Errors swallowed and returned as `authenticated: false` with `200` — no error surface to the client.

#### `POST` `/api/admin/clear-must-reset`
- **Auth**: admin-session (no role check; missing session → `401`)
- **Purpose**: After a forced password reset succeeds, clear the `mustResetPassword` flag and revoke all other sessions for the user.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true }`; 401 `"Unauthorized"`; 500 `"Failed to update"`
- **Notes**: Updates `users` set `mustResetPassword = false`, `updatedAt = now()` for the session user. Then deletes all `adminSessions` for the user except the current session token — revoking other sessions so the old initial password can no longer be used. No audit-log write.

#### `GET` `/api/admin/linkable-destinations`
- **Auth**: admin-session (role: `hq`)
- **Purpose**: Return categorized storefront destinations usable as footer link hrefs (consumed by FooterLinkPicker).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: { pages: [{ label: title, href: "/pages/<slug>" }], static: [{ label, href }, ...] } }`; 500 `"Failed to fetch linkable destinations"`
- **Notes**: HQ-only. `pages` = published static pages (`isPublished = true`) ordered by `displayOrder` then `title`. `static` is hard-coded: Beranda `/`, Semua Produk `/products`, Cabang `/branches`, Keranjang Belanja `/cart`, Checkout `/checkout`, Akun Saya `/account`, Masuk `/login`, Daftar `/register`. Auth-gated routes are safe to link because storefront middleware redirects guests to `/login?callbackUrl=`.

#### `GET` `/api/admin/footer`
- **Auth**: admin-session (role: `hq`)
- **Purpose**: Fetch the singleton footer-config row's `data` field (or `null` if none exists; the admin form falls back to empty fields, and the storefront renders an empty footer until a row is seeded — see `docs/features/footer.md`).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: null }` (no row) or `{ success: true, data: { id, data, updatedAt } }`; 500 `"Failed to fetch footer config"`
- **Notes**: HQ-only. Read-only.

#### `PUT` `/api/admin/footer`
- **Auth**: admin-session (role: `hq`)
- **Purpose**: Upsert the singleton footer config row.
- **Params**: —
- **Body**: `{ brandName: string (1..100), tagline: string (≤300, default ""), copyrightText: string (1..200), columns: [{ title: string (1..100), links: [{ label: string (1..100), href: string (1..500) }] }] (max 3 columns, max 5 links/column, default []), socialMedia: [{ platform: "instagram"|"facebook"|"twitter"|"tiktok"|"youtube"|"linkedin"|"whatsapp", url: string (≤500, default ""), enabled: boolean (default false) }] (default []) }` (zod-validated)
- **Response**: 200 `{ success: true, data: { id, data } }` (update or insert); 400 `{ success: false, error: "Invalid request body", details: <zod fieldErrors> }`; 500 `"Failed to save footer config"`
- **Notes**: HQ-only. Upsert: selects the first `footerConfig` row; if found, updates `data`, `updatedAt = now()`, `updatedBy = ctx.user.id`; else inserts with `id = crypto.randomUUID()`. No audit-log write.

## Admin — Homepage, Pages, Permissions, Auth, Uploads

#### `GET` `/api/admin/homepage`
- **Auth**: admin-session (permission: `homepage:view`)
- **Purpose**: List all homepage sections ordered by `displayOrder`, with carousel products hydrated.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: Section[] }`; 500 `{ success: false, error }`
- **Notes**: For `carousel_product` sections, joins `homepageSectionProducts` → `products` and attaches a `products` array of `{ id, name, slug, displayOrder }`. `store_banner` and other types returned as-is.

#### `POST` `/api/admin/homepage`
- **Auth**: admin-session (permission: `homepage:edit`)
- **Purpose**: Create a new homepage section.
- **Params**: —
- **Body**: `{ type: "banner"|"carousel_product"|"promo_cards"|"announcement_bar"|"store_banner", title?: string|null, subtitle?: string|null, content?: object, isActive?: boolean (default true), productIds?: string[] }`
- **Response**: 200 `{ success: true, data: { id } }`; 400 `{ success: false, error, details }` (invalid body or content shape); 500 on error
- **Notes**: Content validated per-type via Zod (`banner` → `slides` max 5, `carousel_product` → `mode` enum manual/filter + `limit` 1-20, `promo_cards` → `cards` max 6, `announcement_bar` → `message` + `variant`). The carousel/promo `filter` object (`ProductFilterConfig`) accepts `search`, `category`/`brand`/`gender` (slugs), `minPrice`, `maxPrice`, `hasDiscount`, `sortOrder` (`newest|priceAsc|priceDesc`) — field names match the `/api/products` query format. New section's `displayOrder` = `max(existing)+1`. Junction rows only inserted for `carousel_product` when `content.mode !== "filter"`.

#### `GET` `/api/admin/homepage/{id}`
- **Auth**: admin-session (permission: `homepage:view`)
- **Purpose**: Fetch a single homepage section by id, with linked products for carousels.
- **Params**: `{ id }` (path)
- **Body**: none
- **Response**: 200 `{ success: true, data: Section & { products: { id, name, slug, displayOrder }[] } }`; 404 if not found; 500 on error
- **Notes**: For `carousel_product`, returns `products` ordered by junction `displayOrder`. Non-carousel sections return `products: []`.

#### `PATCH` `/api/admin/homepage/{id}`
- **Auth**: admin-session (permission: `homepage:edit`)
- **Purpose**: Update a homepage section.
- **Params**: `{ id }` (path)
- **Body**: `{ type?, title?: string|null, subtitle?: string|null, content?: object, isActive?: boolean, displayOrder?: number, productIds?: string[] }`
- **Response**: 200 `{ success: true }`; 404 if not found; 400 invalid body/content shape; 500 on error
- **Notes**: Validates content per effective type. For `banner`/`promo_cards` content changes, extracts `/uploads/` image URLs from old vs new content and deletes orphaned files via `deleteFile`. For `carousel_product`, when `productIds` provided: deletes all existing junction rows first, then re-inserts only if carousel is NOT in `filter` mode. Sets `updatedAt`.

#### `DELETE` `/api/admin/homepage/{id}`
- **Auth**: admin-session (permission: `homepage:delete`)
- **Purpose**: Delete a homepage section and its referenced image files.
- **Params**: `{ id }` (path)
- **Body**: none
- **Response**: 200 `{ success: true }`; 404 if not found; 500 on error
- **Notes**: Before DB delete, extracts `/uploads/` image URLs from `banner` slides and `promo_cards` cards and deletes the files (per-file errors swallowed).

#### `PATCH` `/api/admin/homepage/reorder`
- **Auth**: admin-session (permission: `homepage:edit`)
- **Purpose**: Reorder homepage sections by updating `displayOrder`.
- **Params**: —
- **Body**: `{ items: { id: string, displayOrder: number }[] }`
- **Response**: 200 `{ success: true }`; 400 invalid body; 500 on error
- **Notes**: Iterates items and updates each section's `displayOrder` + `updatedAt` sequentially (no transaction).

#### `GET` `/api/admin/homepage/preview-all`
- **Auth**: admin-session (permission: `homepage:view`)
- **Purpose**: Return ALL homepage sections (active and inactive) fully hydrated for admin preview.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: Section[] }` (empty array if no sections); 500 on error
- **Notes**: Unlike the storefront endpoint, includes inactive sections. For `carousel_product` in `manual` mode, hydrates products with the cheapest-variant net price and the default-variant image, returning `products: { id, name, slug, price, basePrice, image, collection, gender }[]` (`price` = net, `basePrice` = RRP; `collection` from the product row, `gender` resolved from `genderId` via a per-page gender-name lookup — both nullable). For `filter` mode, runs `resolveFilterModeProducts` mirroring storefront logic (status `aktif`, optional `search`/`category`/`brand`/`gender`/price range/`hasDiscount`/`sortOrder` of `newest|priceAsc|priceDesc`, limit clamped 1-20); filter-mode products also carry `collection`/`gender` (via a left join on `genders`). `store_banner` sections include `branches` (status `aktif`, ordered by `name`).

#### `GET` `/api/admin/homepage/preview-products`
- **Auth**: admin-session (permission: `homepage:view`)
- **Purpose**: Server-side proxy to storefront `/api/products` for carousel filter-mode preview.
- **Params**: query — forwards whitelisted `search`, `category`, `brand`, `gender`, `minPrice`, `maxPrice`, `hasDiscount`, `sortOrder`, `sortBy`, `page`, `limit`
- **Body**: none
- **Response**: Proxied storefront response (status + JSON passed through); 500 on fetch error
- **Notes**: Forwards only the whitelisted params; defaults `limit=10`, `page=1`. Store base URL from `NEXT_PUBLIC_STORE_URL` || `STORE_URL` || `http://localhost:3000`. Uses `cache: "no-store"`. Avoids CORS by fetching server-to-store.

#### `GET` `/api/admin/pages`
- **Auth**: admin-session (permission: `pages:view`)
- **Purpose**: List all static pages ordered by `displayOrder` then `updatedAt`.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: { id, slug, title, content, isPublished, displayOrder, updatedAt }[] }`; 500 on error
- **Notes**: —

#### `POST` `/api/admin/pages`
- **Auth**: admin-session (permission: `pages:edit`)
- **Purpose**: Create a static page.
- **Params**: —
- **Body**: `{ slug: string (1-60 chars, /^[a-z0-9-]+$/), title: string (1-200 chars), content?: string (default ""), isPublished?: boolean (default true), displayOrder?: int (default 0) }`
- **Response**: 200 `{ success: true, data: { id, slug, title, isPublished, displayOrder } }`; 400 invalid body (`details` = flattened field errors); 409 if slug already exists; 500 on error
- **Notes**: `id` via `crypto.randomUUID()`. Enforces slug uniqueness against `staticPages`.

#### `GET` `/api/admin/pages/{id}`
- **Auth**: admin-session (permission: `pages:view`)
- **Purpose**: Fetch a single static page by id.
- **Params**: `{ id }` (path)
- **Body**: none
- **Response**: 200 `{ success: true, data: { id, slug, title, content, isPublished, displayOrder, createdAt, updatedAt } }`; 404 `"Halaman tidak ditemukan."`; 500 on error
- **Notes**: —

#### `PUT` `/api/admin/pages/{id}`
- **Auth**: admin-session (permission: `pages:edit`)
- **Purpose**: Update a static page.
- **Params**: `{ id }` (path)
- **Body**: `{ slug?: string, title?: string, content?: string, isPublished?: boolean, displayOrder?: int }`
- **Response**: 200 `{ success: true, data: { id } }`; 404 if not found; 400 invalid body; 409 if slug taken by another page; 500 on error
- **Notes**: When `slug` is provided, uniqueness is checked excluding the current id. Only provided fields are written; `updatedAt` always refreshed.

#### `DELETE` `/api/admin/pages/{id}`
- **Auth**: admin-session (permission: `pages:delete`)
- **Purpose**: Delete a static page.
- **Params**: `{ id }` (path)
- **Body**: none
- **Response**: 200 `{ success: true, data: { id } }`; 404 if not found; 500 on error
- **Notes**: —

#### `GET` `/api/admin/permissions`
- **Auth**: admin-session (role: `hq`)
- **Purpose**: List all permissions.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: rows }` (from `getAllPermissions()`); 401 if no session; 403 if role !== `hq`; 500 on error
- **Notes**: Explicit `session.user.role !== "hq"` → 403. Not using `withPermission` wrapper.

#### `PUT` `/api/admin/permissions`
- **Auth**: admin-session (role: `hq`)
- **Purpose**: Upsert a permission entry for the `admin` role on a given module.
- **Params**: —
- **Body**: `{ role: string, module: string, canView: boolean, canEdit: boolean, canDelete: boolean }`
- **Response**: 200 `{ success: true }`; 401 if no session; 403 if role !== `hq`; 400 if `role` missing, `role !== "admin"`, `module` missing/not in `moduleNames`, or any of `canView`/`canEdit`/`canDelete` not boolean; 500 on error
- **Notes**: Only the `admin` role can be modified (`hq` is implicit superuser and not editable here). `module` must be one of `moduleNames`. Calls `upsertPermission(role, module, { canView, canEdit, canDelete })`.

#### `GET` `/api/admin/permissions/me`
- **Auth**: admin-session
- **Purpose**: Return the current user's role and permissions.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: { role, permissions } }` (permissions from `getPermissionsForRole(role)`); 401 if no session; 500 on error
- **Notes**: Any authenticated admin can read their own permissions; no role restriction.

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
- **Notes**: `dynamic = "force-dynamic"`. Scope is enforced server-side: branch admins only receive notifications for `branchId = user.branchId`; HQ receives notifications for all branches. The client reconnects immediately after every response, using `serverNow` as the next `since` value. The in-memory pending-poll broadcaster (`apps/admin/src/lib/notification-broadcaster.ts`) wakes matching listeners when a new notification row is inserted.

#### `GET` `/api/admin/notifications`
- **Auth**: admin-session (`notifications:view`)
- **Purpose**: Paginated list of notifications for the full `/admin/notifications` page.
- **Params**: `isRead` (`"all"` | `"read"` | `"unread"`, default `"all"`), `page` (int, default `1`), `limit` (int, default `20`, max `100`)
- **Body**: none
- **Response**: 200 `{ success: true, data: NotificationListItem[], pagination: { page, limit, total, totalPages } }`; 401/403/500 on error
- **Notes**: Branch-scoped for branch admins; HQ sees all. Each row includes joined `branch` and `order` details (customer name, order status, total).

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

- **Stock reservation model**: `branch_stock.stock` (SOH) + `branch_stock.reservedStock` (runtime). Cart operations check `stock - reservedStock` but do **not** reserve. Reservation happens atomically inside `place-order`'s transaction; release happens via the Midtrans webhook (payment fail/expire) or the `sweep-reservations` cron for stale `pending_payment` orders. The Jubelio webhook/import **never** touches `reservedStock`. See `docs/deployment-docs/cron-sweep.md` and `docs/deployment-docs/jubelio-sync.md`.
- **RBAC (admin)**: admin list/detail endpoints are branch-scoped via `getBranchScope` — branch admins see only their own branch; HQ sees all. Edit/delete operations additionally check the permission map (`<module>:<view|edit|delete>`); a few endpoints require `role: "hq"`.
- **Audit log**: significant mutations write `audit_log` rows (e.g. `VERIFY_PICKUP_CODE`, `JUBELIO_SYNC_WEBHOOK`). Several upsert/delete endpoints (products, pages, footer, users) do **not** write audit entries — noted per endpoint.
- **Idempotency**: payment webhooks (Midtrans + sweep) use a claim-guard so duplicate/replayed notifications are safe. The Jubelio webhook is upsert-only on natural keys, so replays are safe.
- **Transactions**: most admin CRUD endpoints do **not** wrap multi-row writes in a DB transaction (noted where relevant); `place-order` and the stock-claim flows do.