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

### Header korelasi `x-request-id`

Setiap route handler HTTP first-party store dan admin dibungkus
`withRequestContext` (kecuali yang tercantum pada pengecualian di bawah), dan
wrapper itu **selalu** menambahkan header `x-request-id` pada response:

- Nilai header adalah UUID kanonik yang dibuat **server** pada setiap request.
  Incoming `x-request-id` dari client **diabaikan** sebagai identitas: dua
  request dengan header masuk yang sama tetap mendapat dua UUID berbeda.
- Nilai header sama dengan `requestId` pada setiap baris application log yang
  ditulis di dalam request tersebut (detail format:
  [`features/logging.md`](features/logging.md)).
- Kontrak bisnis **tidak berubah**: status, body, dan header lain tetap seperti
  sebelumnya. Endpoint yang sudah membawa field `requestId` di body error
  envelope tetap memakai bentuk yang sama.

Bukti korelasi pada server Next nyata dikunci dua endpoint pilot beserta test
route masing-masing:

| App | Endpoint | Module log |
|---|---|---|
| store | `GET /api/categories` | `categories-route` |
| admin | `GET /api/admin/session-check` | `admin-session-check` |

Endpoint first-party lain memakai wrapper yang sama, tetapi baru dua endpoint di
atas yang punya artifact E2E korelasi sendiri; jangan memperlakukan angka itu
sebagai bukti cakupan seluruh endpoint.

Pengecualian yang diketahui (lihat
[pemetaan cakupan](features/logging.md#pengecualian-yang-harus-dibaca-bersama-tabel)):

- Status wrapper: store 34 `route.ts` di `src/app/api`, 33 dibungkus; admin 72
  `route.ts`, 71 dibungkus. Satu-satunya `route.ts` yang tidak dibungkus di kedua
  app adalah `auth/[...all]/route.ts` (catch-all Better Auth, memang tidak boleh
  dibungkus `withRequestContext`). Tabel lengkap ada di
  [tabel cakupan](features/logging.md#pengecualian-yang-harus-dibaca-bersama-tabel).
- `/api/auth/[...all]` (Better Auth catch-all) dan `/uploads/[...path]` bukan
  handler first-party berlogging, jadi jaminan header/`requestId` tidak berlaku.
- `/api/addresses`, `/api/addresses/{id}`, `/api/addresses/{id}/default`, dan
  `/api/onboarding/sync` kini dibungkus `withRequestContext` (module
  `store-addresses`, `store-address`, `store-address-default`, `onboarding-sync`),
  sehingga response-nya membawa `x-request-id` dan baris log jalur itu memakai
  `requestId` kanonik.
- `GET /api/admin/prices/{variantId}/history` dan
  `GET /api/admin/shipment/regions` **sudah** dibungkus wrapper dengan module
  logger miliknya sendiri (`admin-price-history`, `admin-shipment-regions`),
  sehingga keduanya ikut jaminan header/`requestId` kanonik dan tidak lagi
  memakai jalur logger lama dari guard.

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
| GET | `/api/cart` | client-session | Get (auto-create) cart with items, subtotal, and effective PPN rate |
| DELETE | `/api/cart` | client-session | Clear all cart items |
| POST | `/api/cart/items` | client-session | Add variant@branch to cart (merge) |
| PUT | `/api/cart/items/{id}` | client-session | Update cart item quantity |
| DELETE | `/api/cart/items/{id}` | client-session | Remove a cart item |
| POST | `/api/cart/validate-checkout` | client-session | Validate branch and live stock before entering checkout; adjust insufficient quantities |
| POST | `/api/checkout/validate-step-2` | client-session | Validate pickup slot vs operating hours |
| POST | `/api/checkout/preview` | client-session | Authoritative pickup review: pricing + signed review token (read-only) |
| POST | `/api/discounts/available` | client-session | Daftar Coupon publik pickup/delivery + disabled reason (read-only, tanpa reserve) |
| GET | `/api/checkout/order-status` | client-session | Poll order status/paymentStatus |
| POST | `/api/checkout/place-order` | client-session | Verify live Jubelio stock, hold locally, confirm SO, then create Midtrans Snap |
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
| GET | `/api/admin/branches` | admin-session (branches:view) | List branches (paginated; `search` nama/kode/kota) |
| POST | `/api/admin/branches` | admin-session (branches:edit:all) | Create branch with verified Shipment hierarchy |
| GET | `/api/admin/shipment/regions` | admin-session (branches:edit) | Shipment hierarchy lookup |
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
| GET | `/api/admin/discounts` | admin-session (discounts:view) | Daftar promo dengan filter `state`/`activationKind`, jumlah per jalur, revision/benefit dan kapasitas tersedia global |
| POST | `/api/admin/discounts` | admin-session (discounts:edit, gate 1) | Create ONE fixed Offer draft, `activationKind` public/manual_only (request-key idempotent; manual boleh membawa `codes[]`) |
| GET | `/api/admin/discounts/{id}` | admin-session (discounts:view) | Safe Offer detail: live + draft revision, benefit, global capacity summary, masked codes |
| PUT | `/api/admin/discounts/{id}/draft` | admin-session (discounts:edit) | Save complete draft terms + one goods benefit: fixed nominal or percentage rate/cap (expected Offer/draft versions) |
| POST | `/api/admin/discounts/{id}/review` | admin-session (discounts:edit) | Read-only diff + validations + publish fingerprint |
| POST | `/api/admin/discounts/{id}/publish` | admin-session (discounts:edit) | Atomic publish (request key + versions + review fingerprint; manual menerima `proposedCodes`) |
| POST | `/api/admin/discounts/{id}/codes` | admin-session (discounts:edit) | Tambah satu Manual Promo Code canonical (request key + expected Offer version) |
| PATCH | `/api/admin/discounts/{id}/codes/{codeId}` | admin-session (discounts:edit) | `active/inactive/archived` dengan expected Offer + code versions; tanpa literal/owner baru |
| POST | `/api/admin/discounts/{id}/simulate` | admin-session (discounts:edit) | Admin pricing simulation (no hold/quote promise) |
| PATCH | `/api/admin/discounts/{id}/state` | admin-session (discounts:edit) | Enable/pause/archive (request key + expected version) |
| PATCH | `/api/admin/discounts/{id}/policy` | admin-session (discounts:edit; +discount_capacity when enlarging) | Quota/budget/per-account policy (request key + versions) |
| GET | `/api/admin/discounts/{id}/usage` | admin-session (discounts:view; entries also need orders:view) | Global consumed/held/available + Orders-scoped Redemption entries (pagination/filters) |
| GET | `/api/admin/discounts/{id}/history` | admin-session (discounts:view) | Immutable Offer history: revision/policy/code references + safe actor attribution |
| POST | `/api/admin/price-changes` | admin-session (prices:edit + products:view all_branches) | Stage 1..N Markdown rows (JSON manual/bulk atau multipart workbook `.xlsx`; request-key idempotent, configured row limit) |
| GET | `/api/admin/price-changes/template` | admin-session (prices:view + products:view all_branches) | Template `.xlsx` berversi (sheet `Harga`, marker, header resmi, mulai row 3) |
| POST | `/api/admin/price-changes/export` | admin-session (prices:view + products:view all_branches) | Export `.xlsx` SKU terpilih dari data server (maks 1000/limit config) |
| GET | `/api/admin/price-changes/{id}/report` | admin-session (prices:view + products:view all_branches) | Laporan/subset gagal `.xlsx` dari row durable (`subset=all|failed`) |
| GET | `/api/admin/price-changes/{id}` | admin-session (prices:view + products:view all_branches) | Batch review/detail: counts + paginated rows (state filter) |
| POST | `/api/admin/price-changes/{id}/apply` | admin-session (prices:edit + products:view all_branches) | Foreground chunked apply (≤25 rows / 5s per request); `202` while pending |
| GET | `/api/admin/price-changes/candidates` | admin-session (prices:view + products:view all_branches) | Daftar harga SKU terpadu (`search`/`page`/`limit`, opsional `markdownStatus=inactive`) |
| GET | `/api/admin/prices/{variantId}/history` | admin-session (prices:view + products:view all_branches) | Immutable revisions + current Markdown projection |
| GET | `/api/admin/orders` | admin-session (orders view) | List orders (RBAC branch-scoped) |
| GET | `/api/admin/orders/{id}` | admin-session (orders view) | Order detail incl. durable Jubelio operations + remote SO/invoice/payment ids + fulfillment block reason |
| GET | `/api/admin/reviews/sales-operations` | admin-session (orders view) | Read-only Sales-Order review queue: manual-review SO/invoice/payment ops + paid-but-blocked orders |
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

## Admin — Delivery work lists

`GET /api/admin/orders` remains orders:view + current Branch Scope. `fulfillment=delivery` accepts `queue=actionable|monitoring|completed|all` (default actionable), `stage=<exact business label>`, `branchId`, `search`, `from`, `to`, and `page`. Delivery filters intersect authorized evidence before pagination; invalid queue/stage/date values return 400. Own-branch scope ignores a client branch override. Delivery rows add `stage:{label,guidance,terminal}`. Pagination is `{page,limit:20,total,baseTotal,totalPages}`, where baseTotal removes only creation dates, not scope/queue/stage/search/branch filters.

`fulfillment=pickup` retains order-status and pickup-date filtering; omitted fulfillment retains general search/history. Lists have no default creation-date restriction and sort by createdAt then ID ascending, with fixed 20-row pages. UI Orders defaults to Delivery; Pickup and Semua remain separate contexts. [Workflow details](features/admin-delivery-workflow.md).

## Admin — Delivery workflow projection

`GET /api/admin/orders/{id}` retains orders:view and current Branch Scope (cross-scope IDs remain 404). Delivery data additionally includes `workflow: {stage: {label,guidance,terminal}, access: {known,allowed,reasons}, eligibility: {known,eligible,blocker?}, tracking: {handoff,reconcile}, special: {failure,release,finish}}` and authorized proof-review summaries. Edit/Home Branch restrictions are separate from visibility. Preflights reuse existing fulfillment/tracking/special-action guards read-only, not as grants to mutate; all writes recheck current server state. No provider request is made by this GET. Protected data is hidden when browser Current Policy becomes unavailable. [Workflow details](features/admin-delivery-workflow.md).

## Admin — Delivery follow-up

- `GET /api/admin/orders/follow-up?kind=all|settlement|packing|booking|shipment` — orders:view + Branch Scope, existing open safe case summaries plus projected stage/guidance. Optional stage/branchId/search/from/to/page intersect the original case source before the same 20-row pagination and matching/no-date-base counts. No new case ledger or criteria.
- `POST /api/admin/orders/{id}/delivery/packing-failure` — `{reasonCode: physical_stock_unavailable|damaged_goods|paid_service_limits_exceeded}` before booking; paid/processing preserved, normal fulfillment blocked.
- `POST /api/admin/orders/{id}/delivery/release-booking` — strict `{proof:{source:'jubelio_confirmation',reference,reason,attemptNumber,absenceConfirmed:true,operationClosed:true}}`; only stable unknown, current attempt, explicit closed/no-booking provider confirmation. Archives proof; does not POST/create; next booking needs a separate click.
- `POST /api/admin/orders/{id}/delivery/finish-manually` — `{reason}`; known booked/verified paid with issue or handoff/progress evidence, never ambiguous/AWB alone. Completed/paid, no invented courier DELIVERED or pickup code.

Mutations require orders:edit + exact current DB Home Branch, even owner/all-scope; invalid400, forbidden403, hidden404, ineligible409. No admin mark-verified/refund/communication action. Settlement recovery is system-only GET of known IDs, never fresh intent/POST. [Details](features/delivery-follow-up.md).

## Delivery — Handoff and tracking

- Admin `POST /api/admin/orders/{id}/delivery/handoff {}` — physical stamp, idempotent, processing only; orders:edit + current Home Branch.
- Admin `POST /api/admin/orders/{id}/delivery/reconcile {}` — reactive known-AWB GET only, same permission/Home Branch; identity verified before status/billing changes.
- Public store `POST /api/webhooks/jubelio-shipment` — exact raw JSON body and hex `x-jubelio-signature`; dedicated Shipment webhook secret, constant-time HMAC(key=secret, raw+secret); 401 invalid signature, 503 missing secret, 200 accepted/duplicate/ignored.
- Owned store order detail GET adds customer-safe tracking/POD/applied timeline; foreign clients remain 404.

DELIVERED completes without mandatory POD; PICKED_UP does not. Replay/older/late issues never reopen completion. No provider create, SO, stock, payment or notification writes occur in tracking. See [delivery tracking](features/delivery-tracking.md).

## Admin — Delivery packing and booking

- `POST /api/admin/orders/{id}/delivery/packing` — strict `{}` JSON, stores frozen request and packing audit; no provider write.
- `POST /api/admin/orders/{id}/delivery/book` — strict `{}` JSON, atomic one-time dispatch of packed request; returns AWB, Shipment ID and separate `quoteRates`, `bookingPrice`, `billedPrice` (nullable).
- Existing order detail GET additionally returns fulfillment method, snapshot, shipment metadata and server Home Branch action hint.

Both actions require `orders:edit` AND the current Home Branch matching the order, even for owner/all-scope roles. Denials: 403 missing grant/Home Branch, 404 unknown/cross-branch, 409 ineligible or `BOOKING_AMBIGUOUS`. Only verified-paid, processing, unblocked delivery is packable; the unpaid reservation TTL does not expire a paid order. Booking ambiguity is held without create retries. See [delivery fulfillment](features/delivery-fulfillment.md).

## Admin — Discount Offer administration (public fixed-goods)

Gate domain `discounts.contractVersion` dibaca **tanpa cache** pada setiap writer; `0`/tidak ada = tidak aktif (`503 DISCOUNTS_INACTIVE`), nilai tidak dikenal fails closed (`503 DISCOUNTS_CONTRACT_UNSUPPORTED`). Otorisasi memakai Current Policy server-side: `discounts:view` + `discounts:edit` global (System Owner memakai bypass code-owned), dibaca ulang di dalam transaksi di bawah `SHARE` lock Admin User → Role. `discount_capacity:view/edit` global terpisah diperlukan untuk **memperbesar** kapasitas. Browser tidak pernah menjadi sumber policy. Envelope sukses `{ success: true, data }` (list menambahkan `pagination` di top level); kegagalan `{ success: false, error, code, requestId }` + header `x-request-id`, `Cache-Control: no-store`. Log sukses `info` dan kegagalan `error` tanpa body/key/fingerprint/token.

- `GET /api/admin/discounts` — `page` (≥1), `limit` (1–50), `state` opsional (`draft|enabled|paused|archived`), `activationKind` opsional (`public|manual_only`; invalid → `400 INPUT_INVALID`). Tanpa activation filter tetap mengembalikan kedua jalur untuk kompatibilitas. Filter jenis dijalankan sebelum pagination. Response menambahkan `countsByActivationKind: { public, manual_only }` di top level: hitungan mengikuti `state`, tetapi tidak dibatasi jenis/page. Setiap row menambahkan `liveRevision.revisionNo`, `kind`, `scope`, dan `capacitySummary` global (`consumedCount`, `heldCount`, `consumedAmount`, `heldAmount`, `availableCount`, `availableAmount`, `basis:"global"`). Missing projection atau komitmen melebihi batas → `capacitySummary:null`, bukan angka nol palsu. Field lama tetap; `codes` hanya masked untuk semua persona, tanpa literal kode/identitas order/customer. Kuota dan budget tersedia dibaca dari projection global dalam query yang dibatasi Offer pada halaman, bukan HTTP usage per row. Ringkasan bukan jaminan eligibility/booking kuota dan tidak menjalankan rekonsiliasi histori.
- `POST /api/admin/discounts` — strict `{ requestKey: UUID, activationKind: "public" | "manual_only", codes?: string[] }`. Kode manual (maks 50 perintah) di-canonical-kan (trim+uppercase, ASCII 3–64) dan direservasi di transaksi yang sama; Offer publik dengan `codes` → `400 CODE_NOT_SUPPORTED`. Detail memuat `codes` (masked) dan literal `code` hanya untuk promo editor.
- `POST /api/admin/discounts/{id}/codes` — `{ requestKey, code, expectedOfferVersion }`. Canonical unik global; bentrok → `409 CODE_CONFLICT`; Offer publik → `409 CODE_NOT_SUPPORTED`; stale → `409 STALE_REVISION`. Replay key+command sama → `200` tanpa code/audit kedua.
- `PATCH /api/admin/discounts/{id}/codes/{codeId}` — `{ expectedOfferVersion, expectedCodeVersion, state }`; arsip terminal (`409 CODE_ARCHIVED`), usage tidak pernah direset, owner/literal tetap.
- `POST /api/admin/discounts/{id}/review` dan `publish` menerima `proposedCodes` yang masuk fingerprint publish; usulan berubah → `409 STALE_REVISION`.
- `POST /api/checkout/preview` juga menerima `promoSelection` `{ kind: "manual", code }`; `previous.promoSelection` manual memakai `offerId + codeId` (bukan literal). Place-order menerima bentuk request yang sama. Kode unknown/nonaktif/arsip → `409 PROMO_UNAVAILABLE` dengan pesan aman.
- Rate limit request bermuatan manual code: bucket `code:account` 20 dan `code:ip` 120 per 60 detik (lihat §5.5 spec).
- `GET /api/orders/{id}` mengungkap `promo.code` hanya untuk kode yang dipakai order itu; `GET /api/admin/orders/{id}` memakai `maskedCode` + `code` hanya untuk promo editor. Membuat Offer + satu revision draft kosong + proyeksi usage 0 + receipt + audit dalam satu commit. `201` draft baru; key+command sama → `200` Offer yang sama tanpa Offer/audit kedua; command berbeda dengan key terpakai → `409 REQUEST_KEY_CONFLICT`. `activationKind` lain → `400 INPUT_INVALID` (tidak ada default diam-diam ke `public`). Tidak ada kuota default 100.
- `GET /api/admin/discounts/{id}` — identitas/state/versions/pointer, revision live (immutable), revision draft + benefit, `usage`, dan `capacitySummary` global (`basis: "global"`, `consumedCount`, `heldCount`, `consumedAmount`, `heldAmount`, `availableCount`, `availableAmount`). Tanpa provider call. Kode `maskedCode` untuk viewer dan literal `code` hanya bila aktor adalah promo editor (`discounts:view` + `discounts:edit`). Id tak dikenal → `404 NOT_FOUND`.
- `PUT /api/admin/discounts/{id}/draft` — strict `{ expectedOfferVersion, expectedDraftVersion, terms: { name, currency:"IDR", minSubtotal, startAt?, endAt?, benefit } }`, dengan `benefit` tepat salah satu: `{ kind:"fixed_goods", paramsVersion:1, fixedAmount }` (Rupiah utuh > 0) atau `{ kind:"percentage_goods", paramsVersion:1, rate, capAmount }` (`rate` `>0..100` maksimal6 digit pecahan; `capAmount` NULL/kosong = tanpa cap, atau Rupiah utuh > 0). Field milik kind lain ikut terkirim → `400 INPUT_INVALID`; presisi rate berlebih ditolak, bukan dibulatkan. Draft tidak pernah mengubah terms live; setelah publish, simpan berikutnya membuat revision draft baru. `startAt`/`endAt` wajib ISO-8601 dengan offset eksplisit (UI memakai WIB `+07:00`), `start < end` (start inklusif/end eksklusif). Kind/versi/currency tak dikenal → `400 INPUT_INVALID`. Dua editor stale → `409 STALE_REVISION`.
- `POST /api/admin/discounts/{id}/review` — `{ expectedOfferVersion, expectedDraftVersion }`, read-only. Mengembalikan diff terms/benefit/capacity, `validations` (`TERMS_COMPLETE`, `BENEFIT_VALID`, `CAPACITY_BOUND`, `WINDOW_ORDERED`, `CODE_FREE`, `LIVE_TERMS_IMMUTABLE`), `canPublish`, dan `fingerprint` SHA-256 atas versions/pointer/revision/terms/benefit/capacity/state hasil publish. Bukan quote/order/hold.
- `POST /api/admin/discounts/{id}/publish` — `{ requestKey, expectedOfferVersion, expectedDraftVersion, expectedPolicyVersion, reviewFingerprint }`. Receipt diperiksa lebih dulu (key sama + fingerprint sama → replay; beda → `409 REQUEST_KEY_CONFLICT`). Di bawah lock, fingerprint dihitung ulang dari baris terkunci; berubah → `409 STALE_REVISION`; validasi gagal → `409 OFFER_NOT_PUBLISHABLE`. Sukses: `published_at` draft diisi, pointer dipindah, `draft → enabled` (state live lain dipertahankan), `version + 1`, receipt + audit satu commit. Tanpa provider call dan tanpa kode.
- `POST /api/admin/discounts/{id}/simulate` — `{ expectedDraftVersion, fulfillmentMethod, lines:[{ variantId, unitPrice, quantity }] (1–50), shippingCost? }`. Memakai `buildPricingSnapshot`/`evaluatePricing` bersama; PPN dari `tax.ppnRatePercent` (fallback 11); minimum dicek terhadap subtotal setelah Markdown. Kind benefit mengikuti revision draft: `fixed_goods`, `percentage_goods`, atau `shipping` (hanya cap positif). Untuk shipping, delivery berongkir positif menampilkan `shippingBeforeSubsidy`/`shippingSubsidy`/`shippingNet`; pickup/ongkir0 tidak menerapkan benefit. Response `simulation: true` + breakdown + `notice` dan tidak menulis apa pun. Literal acuan: 150000 − 17000 → net 133000, PPN 14630, total pickup 147630; shipping barang150000/ongkir30000/cap20000 → subsidi20000, net ongkir10000, total176500, payable160000.
- `PATCH /api/admin/discounts/{id}/state` — `{ requestKey, expectedVersion, state: "enabled"|"paused"|"archived" }`. `draft → enabled/paused` ditolak `409 INVALID_STATE_TRANSITION` (publish satu-satunya jalur live); archive terminal dan bukan hard delete; usage/pointer/revision tidak berubah. Receipt replay didukung.
- `PATCH /api/admin/discounts/{id}/policy` — `{ requestKey, expectedOfferVersion, expectedPolicyVersion, quotaCount, budgetAmount, perClientLimit }`. Initial/kenaikan/penghapusan batas (memperbesar) memerlukan grant `discount_capacity`; penurunan hanya `discounts:edit`. Offer live wajib menyisakan minimal satu batas (`409 CAPACITY_REQUIREMENT`). Kuota < reserved+consumed, budget < reserved+consumed amount, atau `perClientLimit` < komitmen per-akun tertinggi (lookup terindex di bawah lock Offer) → `409 CAPACITY_BELOW_COMMITMENTS`. Projection yang tidak cocok dengan ledger Redemption → `409 USAGE_DRIFT_REVIEW` (tidak ada reset/rebuild online). Receipt replay didukung.
- `GET /api/admin/discounts/{id}/usage` — dua hal yang tidak boleh dicampur: (1) `capacity`/`usage`/`availability` **global** = otoritas kapasitas (`consumed`, `held`/reserved, `availableCount`, `availableAmount`, `basis:"global"`), plus `drift` hasil rekonsiliasi terarah projection vs ledger Redemption; (2) `entries` Redemption ter-scope. Tanpa `orders:view` → `entriesAccess:"aggregate_only"`, `entries:null`, tanpa identitas order/customer/cabang. Dengan `orders:view` → `entriesAccess:"scoped"`, `scope` `{mode:"all"}` atau `{mode:"own",branchId}` (own dipin ke Home Branch server-side). Query: `page`, `limit` (≤50), `status`, `activationKind`, `branchId` (hanya all-branch), `entryId` (direct id tetap ter-scope; di luar scope → `404 NOT_FOUND`, `branchId` asing pada own → `403 DENIED`). `total`/`totalPages` adalah hitungan daftar ter-scope, bukan total global. Kode selalu `maskedCode` + `codeId`, tidak pernah literal. Entri membawa status order/payment, cabang, customer, `fulfillmentBlocked`, dan `review.latePaidReview` untuk penelusuran kasus ops (tanpa tombol reset/force-release/refund baru).
- `GET /api/admin/discounts/{id}/history` — audit Offer immutable (maks 100, `limit` opsional) dengan `action`, `policyVersion`, referensi revision/draft/code (masked), waktu, dan `actor` `{ id, identity, label, available }`. `user_id` yang menjadi NULL setelah Admin User dihapus tetap menampilkan `identity` immutable dari payload audit; `label` menjadi null dan `available:false` tanpa kehilangan entri. Literal kode tidak pernah ada di payload ini, dan grant `audit_log:view` saja bukan jalur literal.

Kode 503 `BUSY` dipakai bila lock/statement ceiling (2 dtk/5 dtk) atau serialization failure terjadi; seluruh transaksi rollback. Rincian invariant, UI, seed, dan bukti verifikasi: [discount administration](features/discount-administration.md).

## Admin — Harga Markdown per SKU

Semua endpoint membutuhkan admin session; `Cache-Control: no-store`; body memakai envelope `{ success, data }` / `{ success:false, code, error, requestId }`.

- `POST /api/admin/price-changes` — `prices:edit` global + `products:view all_branches`, gate `discounts.contractVersion=1`. Body strict `{ requestKey: UUID, source?: "manual"|"bulk"|null, reason?: string|null, rows: [{ sku, action: "set_price"|"restore_base", targetUnitPrice?: string|null, discountPercent?: string|null }] }` dengan 1..N row (batas statis `MAX_STAGE_ROWS_HARD_LIMIT=5000`; `source` default: 1 row → `manual`, >1 row → `bulk`). `set_price` memerlukan tepat satu dari target fixed (Rupiah utuh) atau persen potongan (server membekukan target fixed dari source terbaru, half-up); `restore_base` tidak menerima keduanya. Respons `201` batch `staged` dengan semua row `pending` dan preview non-otoritatif (source saat stage, effective kini, target, dampak/arah/persen, warnings); key+command sama → `200` batch yang sama; command berbeda → `409 REQUEST_KEY_CONFLICT`. Limit efektif `discount.import.maxRows` dibaca **uncached** per request: kelebihan → `400 ROW_LIMIT_EXCEEDED` tanpa mutation; config invalid → `503 IMPORT_LIMITS_INVALID` (fail closed). Row kosong/duplikat/bentuk salah → `400 INPUT_INVALID`; SKU tak dikenal atau source invalid pada row target fixed tetap di-stage dengan `variantId: null` + warning dan difinalkan `failed` saat apply, sedangkan row shortcut persen untuk SKU/source yang tidak resolvable ditolak `400 INPUT_INVALID` (target fixed tidak bisa dibekukan). Gate 0 → `503 DISCOUNTS_INACTIVE`.
- `GET /api/admin/price-changes/{id}` — `prices:view` global + products view-all. Query `page` (≥1), `limit` (default 25, maks 100), `state` (`all` default; `pending|applied|unchanged|failed`). Counts selalu menggambarkan **seluruh** batch; `rows` hanya halaman yang diminta (`preview`, `state`, `resultCode`, `actual` before/after, `appliedRevisionId`) plus `pagination { page, limit, total, totalPages }` — cukup untuk report/subset retry tanpa arsip file. Nilai `state` lain → `400 INPUT_INVALID`. Id tak dikenal/denied → `404 NOT_FOUND`/`403 DENIED`.
- `POST /api/admin/price-changes/{id}/apply` — `prices:edit`. Body `{ requestKey: UUID, previewDigest?: string|null }`. Foreground chunk: maksimum **25 row atau 5 detik** per request, tiap row satu transaksi bounded (lock batch→row→variant/source→current Markdown, validasi target terhadap source **terbaru**, revision immutable + current pointer + hasil row + audit). Respons `202` selama `pendingCount > 0`, `200` saat final; resume manual memakai request key baru dan hanya memproses row pending. Ledger `price_change_apply_request` unik `(actor_identity, request_key)`: key sama pada batch + digest sama melanjutkan/replay tanpa hasil row kedua, beda → `409 REQUEST_KEY_CONFLICT`. No-op → `unchanged` tanpa revision fiktif, tetap satu audit. Halt `POLICY_REVOKED` (grant dicabut di tengah chunk; row yang sudah commit tetap) dan `ROW_LIMIT_EXCEEDED` (batch melebihi limit baris terbaru; row pending ditahan) dikembalikan sebagai `haltReason`, bukan sukses. Bila grant sudah dicabut **sebelum** request dimulai, respons adalah `403 DENIED`; halt reason tetap dicatat pada batch dan hanya dapat dibaca viewer yang masih memegang `prices:view` + products view-all. Config limit invalid → `503 IMPORT_LIMITS_INVALID`; lock/serialization → `503 BUSY`. Counts selalu menjumlah `rowCount`; money tetap decimal string.
- `GET /api/admin/price-changes/candidates` — `prices:view` global + products view-all; query `search` (≤100 karakter, case-insensitive pada SKU dan nama produk), `page`, `limit` (default 25, maks 100), urut `sku asc`. Envelope `{ rows, pagination }`; tiap row memuat `variantId`, `sku`, `productId`, `productName`, `variantLabel`, `basePrice`, `effectiveUnitPrice`, `storedTarget`, `markdownActive`, `priceVersion`. Tanpa filter, baris dengan source tidak valid tetap dikembalikan dengan `basePrice`/`effectiveUnitPrice` null dan tetap dihitung pada total. Pencarian kosong memuat katalog. Query opsional `markdownStatus=inactive` hanya memuat target tersimpan dengan source whole-Rupiah valid yang memenuhi `source <= target`; rows dan count memakai filter/pagination yang sama lintas katalog. Nilai lain (termasuk string kosong) → `400 INPUT_INVALID`. Source nol tetap valid mengikuti projection existing; source negatif/pecahan/melebihi batas uang dikecualikan dari daftar nonaktif. Permission tetap sama. No-store; log hanya total/filter dan konteks request, bukan daftar SKU.
- `POST /api/admin/price-changes` dengan `Content-Type: multipart/form-data` — body `workbook` (file `.xlsx`), `requestKey` (UUID), `reason?` (≤500), `parentBatchId?` (UUID batch asal untuk koreksi). **Staging saja**: parser memvalidasi container/signature, satu sheet `Harga`, marker `A1 = markdown_v1` (marker lama tetap diterima sebagai alias dengan identitas internal batch tidak berubah), header resmi row 2, dan seluruh baris data sebelum transaksi apa pun; fatal (container rusak, macro, external link, encrypted/legacy OLE, sheet/marker/header salah, ZIP traversal/duplikat, batas entry/cell/text/row/byte) → `400 WORKBOOK_REJECTED` dengan `details.reason` dan **tidak** membuat batch/harga berubah. Baris yang gagal validasi (formula — cached value tidak dievaluasi, teks nominal, pecahan/0/negatif, action asing, SKU bukan text, blank price untuk `set_price`, price pada `restore_base`, SKU duplikat, `origin_row` invalid) disimpan sebagai row **failed final** dengan row number sheet, `resultCode`, dan raw action/target; baris valid tetap `pending`. Semua row blank diabaikan; baris yang hanya berisi kolom referensi diabaikan; partial tanpa SKU gagal row. Batas efektif `discount.import.maxRows`/`maxFileBytes`/`maxExpandedBytes` dibaca uncached; `content-length` di atas `maxFileBytes + 512KiB` envelope → `413 COMPRESSED_LIMIT_EXCEEDED`. Key sama + payload sama → `200` batch yang sama; payload berbeda → `409 REQUEST_KEY_CONFLICT`. `origin_row` hanya sah bila `parentBatchId` menunjuk batch yang ada dan setiap origin adalah row **failed final** milik batch itu (unik); selain itu `400 ORIGIN_INVALID` tanpa write. Isi workbook tidak pernah diarsipkan.
- `GET /api/admin/price-changes/template` — `prices:view` + products view-all; mengembalikan `.xlsx` no-store: satu sheet `Harga`, `A1 = markdown_v1`, header row 2 `sku`, `action`, `new_price`, data mulai row 3. Semua sel text ditulis sebagai inline string (literal, bukan formula).
- `POST /api/admin/price-changes/export` — `prices:view` + products view-all; body `{ variantIds: string[] }` (1..limit config, default 1000; id tak dikenal/duplikat-kosong → `400 INPUT_INVALID`). Nilai base/effective/target **selalu dari server**, bukan body. `action` diisi `set_price` dan `new_price` harga efektif saat ini (re-upload = no-op eksplisit sampai diedit); kolom referensi resmi `row_number`, `product_name`, `variant`, `source_price`, `effective_price`, `origin_row`, `status`, `error_reason` bersifat non-otoritatif.
- `GET /api/admin/price-changes/{id}/report?subset=all|failed` — `prices:view` + products view-all; `.xlsx` no-store dibentuk dari row durable (bukan file upload). `failed` hanya row final gagal dan mengisi `origin_row` dengan nomor baris row itu sendiri sehingga file dapat diperbaiki lalu diunggah sebagai batch koreksi tertaut; `all` memuat seluruh row dengan kolom `row_number`, `status` (`pending|applied|unchanged|failed`) + `error_reason` (`resultCode`). Nilai `subset` lain → `400 INPUT_INVALID`; batch tak dikenal/denied → `404`/`403`. Text selalu literal (inline string) sehingga nilai berawalan `=`, `+`, `-`, `@` tidak menjadi formula. Row yang belum final tetap muncul dengan status `pending`, bukan diklaim sukses.
- `GET /api/admin/prices/{variantId}/history` — `prices:view` global + products view-all, `page`/`limit` (≤100). Mengembalikan `{ variantId, sku, productId, productName, current, currentVersion, revisions, pagination }`; revision terbaru lebih dulu; money decimal string. Tidak mengekspos request key/fingerprint atau target SKU lain.

Rincian invariant/proyeksi/seed: [markdown pricing](features/markdown-pricing.md).

## Store — Checkout review preview

`POST /api/checkout/preview` — onboarded store client session. Untuk **pickup**, body strict `{ phone, email, pickupDate, pickupTime, selectedItemIds, promoSelection: { kind: "none" } | { kind: "public", offerId } }`. Untuk **delivery**, body strict `{ fulfillmentMethod: "delivery", itemIds, contactPhone, contactEmail, addressId | { newAddress, saveAddress, saveRequestId }, courierId, serviceId, originFingerprint, approvedPricing?, promoSelection: { kind: "none" } }`; pemilihan `public` pada delivery ditolak (`400 INPUT_INVALID`) karena pemilihan promo delivery dimiliki ticket 11. `deliveryService` pada response membawa service + pricing hasil quote terbaru. Body tidak pernah membawa uang/harga/branch/identitas: server memuat baris keranjang milik caller dengan harga varian saat ini, cabang, slot, serta rate PPN, lalu menurunkan breakdown dengan `buildPricingSnapshot` — engine yang sama dengan order yang nanti disimpan. Endpoint read-only: tidak membuat order, hold stok, address, Redemption/usage, pembayaran, ataupun provider business write.

Endpoint read-only: tidak membuat order, hold stok, address, Redemption/usage, pembayaran, ataupun provider business write.

Untuk `promoSelection.kind = "public"`, eligibility dievaluasi terhadap subtotal setelah Markdown (state/revision/waktu/minimum/verified email/benefit/kapasitas). Benefit percentage memakai `floor(subtotal × rate / 100)` lalu clip ke subtotal/cap; cap berlaku sekali per order. Kandidat tidak eligible menjawab `409 PROMO_UNAVAILABLE` / `409 PROMO_INELIGIBLE` / `409 PROMO_CAPACITY_UNAVAILABLE` atau `403 EMAIL_VERIFICATION_REQUIRED` dengan pesan aman, tanpa menimpa pilihan lama. Sukses menambah `promo: { kind, offerId, revisionId, benefitId, benefitAmount }`; `pricing.discount` = benefit Coupon setelah clip, `pricing.subtotal` sudah memperhitungkan Markdown.

Penggantian (ticket 08) menambah field opsional `previous: { reviewToken, promoSelection }` dan `acknowledgeInvalidation?: boolean`. Server memverifikasi token `previous` (tanda tangan/expiry), mencocokkan digest pilihan promo dengan payload token, lalu mengevaluasi ulang pilihan lama dan kandidat pada konteks saat ini. Perbandingan memakai total final (PPN/ongkir ikut). `replacement` berisi `{ previous: { status: "valid"|"invalid", promo, total, reason?, message? }, candidate: { promo, total }, direction: "increase"|"same"|"decrease"|null, deltaTotal, requiresIncreaseConfirmation }`; `direction: null` berarti pilihan lama sudah gugur. `requiresIncreaseConfirmation: true` menandai token dengan persyaratan acknowledgement kenaikan (`inc`), sedangkan lanjut-tanpa-promo setelah invalidation (`acknowledgeInvalidation: true` dengan `promoSelection: none`) menandai token `cwo`. Konteks yang berubah sejak review lama (cart/cabang/slot/kontak/harga) atau `previous` yang tidak cocok menjawab `409 CHECKOUT_REVIEW_REQUIRED`; kandidat gagal tidak mengganti pilihan lama. `acknowledgeInvalidation` tanpa `previous` → `400 INPUT_INVALID`.

Sukses `{ success: true, data: { pricing, promo, reviewToken, expiresAt, contextFingerprint, requiresIncreaseConfirmation, requiresContinueWithoutPromoAcknowledgement, replacement } }` dengan `Cache-Control: no-store`. `pricing` memakai nama wire checkout existing (`subtotal`, `discount` = goods discount v1, `taxableBase`, `shippingCost`, `serviceFee`, `ppnRatePercent`, `ppnAmount`, `total`; decimal string, tanpa service fee, PPN atas barang saja). `contextFingerprint` adalah SHA-256 kanonik atas selection terurut, cabang, fulfillment, slot pickup atau snapshot delivery, digest kontak, pilihan promo (`none` atau identitas Coupon), dan versi/harga breakdown. `reviewToken` bertanda tangan HMAC-SHA256 dengan kunci turunan dari `BETTER_AUTH_SECRET` dan domain separation `okcir:discounts:checkout-review:v1` (tanpa env/dependency baru), versi payload 1, TTL 10 menit, `expiresAt` ISO8601 dengan timezone. Payload token hanya memuat hash/versi/expiry — tanpa telepon, email, alamat, kode, atau rincian harga; token ini bukan kredensial auth/izin dan tidak membekukan harga, slot, atau kapasitas.

Gate `discounts.contractVersion=1` **wajib**: gate 0 menjawab 400 `{ success: false, code: "UNSUPPORTED_VERSION", error, requestId }` (header dan field `requestId`, `Cache-Control: no-store`) dan tidak pernah memakai jalur pricing legacy. Error lain konsisten: 400 `INPUT_INVALID` (shape/slot/owned selection tidak valid), 413 `INPUT_LIMIT_EXCEEDED` (body > 256 KiB, diputuskan dari ukuran saja sebelum validasi shape), 404 `NOT_FOUND` (cart item, address, atau cabang bukan milik/tidak ada), 409 `DELIVERY_REPRICE_REQUIRED` (service/origin quote berubah), 429 `RATE_LIMITED` + `Retry-After`, dan 503 `PRICING_UNAVAILABLE`/`POLICY_UNAVAILABLE` (gate/config tak terbaca, cabang belum siap, secret penanda tangan tidak tersedia, data otoritatif gagal dibaca, atau admission tidak tersedia — fail closed). Verifikasi tanda tangan, expiry, client binding via fingerprint, dan reprice context dilakukan di place-order (lihat bawah). Log memuat id/count/versi/uang aman/fingerprint saja. Lihat [versioned checkout pricing](features/versioned-checkout-pricing.md#12-review-checkout-request-key-dan-admission-ticket-02) dan [Coupon/Redemption](features/discount-redemption.md).

## Store — Coupon publik pickup

`POST /api/discounts/available` — onboarded store client, body strict `{ selectedItemIds: string[] (1–50, unik), fulfillmentMethod?: "pickup" | "delivery", shippingBeforeSubsidy?: string|number, cursor? }`. Read-only: tidak membuat order/hold/usage dan tidak memanggil provider. Setiap item membawa `benefitKind` (`fixed_goods` | `percentage_goods` | `shipping`), `rate`, `capAmount`, dan `benefitAmount` = nominal aktual untuk context ini. `shippingBeforeSubsidy` pada delivery hanya dipakai untuk menampilkan eligibility subsidi; angka ini bukan sumber uang order dan preview/place-order selalu memakai quote baru. Hanya Offer publik `enabled` dengan revision published dan waktu server aktif (start inklusif, end eksklusif) yang didiscovery; Offer lain tidak muncul. Offer relevan yang belum memenuhi minimum, verified email, atau kapasitas tetap dikembalikan `eligible:false` + `reason`/`reasonMessage` aman. Urut nama lalu Offer ID; `limit` default 25, maksimal 100; `nextCursor` opak. Selection bukan milik cart caller → `404 NOT_FOUND`; selection bercabang/ganda → `400 INPUT_INVALID`; gate `0` → `400 UNSUPPORTED_VERSION`; admission preview 60/account + 300/IP per 60 detik. Kapasitas di sini **advisory**; commit tetap dievaluasi ulang di place-order di bawah lock Offer.

### GET /api/checkout/requests/{requestKey}

Onboarded store client. Mengembalikan `{ success: true, data: { requestKey, orderId, state, paymentAvailable, redirectUrl, expiresAt } }`; `state` ∈ `payment_ready | processing | manual_review | paid | failed`. Hanya key milik client session; key/owner lain → `404 NOT_FOUND` tanpa mengungkap existence. Read-only: tidak requote, reprice, reserve, dispatch provider, membuat payment attempt, atau memperpanjang expiry — aman dipakai setelah response place-order hilang. Error baca DB → `503 POLICY_UNAVAILABLE`.

### Admission rate-limit checkout

`POST /api/checkout/preview` dan `POST /api/checkout/place-order` (gate1) memakai counter PostgreSQL `discount_request_window`: preview 60/account + 300/IP per 60 detik; place order baru 10/account + 60/IP. Melebihi batas → `429 RATE_LIMITED` dengan `Retry-After` detik dan `Cache-Control: no-store`; tanpa secret/trusted policy/IP valid → `503 POLICY_UNAVAILABLE`, tanpa fallback ke limiter lokal atau header forged. Subjek disimpan sebagai HMAC pseudonymous (raw IP/token tidak masuk log bisnis). Replay accepted dan result read tidak dihitung sebagai placement baru. Tabel window ephemeral (dibersihkan opportunistic, tanpa cron baru) dan terpisah dari `checkout_request` yang retained. Bucket manual-code 20/120 menyusul ticket 09.

## Store — Delivery placement

`POST /api/checkout/place-order` retains legacy pickup input and additionally accepts strict delivery input `{ itemIds, contactPhone, contactEmail, fulfillmentMethod: "delivery", addressId, courierId, serviceId, approvedPricing, originFingerprint }` or the same delivery approval with `{ newAddress, saveAddress: boolean, saveRequestId: UUID }` instead of `addressId`. `newAddress` uses the client address input fields documented below, including `isDefault` (only applied when `saveAddress` is true). An approved saved address is inserted in the local order transaction; repeated saves with the same client-scoped `saveRequestId` reuse the same address row. A changed destination needs a new request ID. Unsaved destinations produce only an order snapshot (nullable `address_id`). Requires onboarded client session. Delivery omits pickup slots; backend re-derives current cart/address/origin/parcels/rates and compares approval. Changed/unavailable service, pricing, or stored origin fingerprint returns 409 `{ success: false, code: "DELIVERY_REPRICE_REQUIRED", data: { services } }` before order/SO/Snap writes. Fresh service rows carry the same normalized `serviceCategoryId: number | null` as the delivery-quote response; category metadata is display-only and is not accepted as order approval input. Confirmed placement uses one goods-only SO and snapshot-priced Snap. Repayment `/api/payments/midtrans/create` uses persisted amounts, not a new quote. See [delivery orders](features/delivery-orders.md).

Pada gate `discounts.contractVersion=1`, body pickup **dan** delivery juga wajib membawa `requestKey` (UUID), `reviewToken`, dan `promoSelection: { kind: "none" }`. Key+fingerprint intent yang sama mengembalikan order yang sama (`200`) tanpa requote/reprice/reserve/dispatch ulang; intent berbeda `409 REQUEST_KEY_CONFLICT`; token hilang/kadaluarsa/tamper atau context berubah (termasuk snapshot delivery) `409 CHECKOUT_REVIEW_REQUIRED` sebelum order/hold/provider write. Order baru `201`, replay `200`, committed tetapi provider/payment masih `processing`/`manual_review` `202` dengan `orderId` — response hilang dapat dibaca lewat `GET /api/checkout/requests/{requestKey}`. Request dibatasi lebih dulu (bounds
sumber: uang integer Rupiah utuh, quantity 1..99, maksimal 50 baris, ID maksimal
128 karakter, body maksimal 256 KiB) **sebelum** read stok/region/ongkir
provider. Order yang dibuat menyimpan kolom versi
(`pricing_contract_version=1`, `pricing_engine_version=1`,
`provider_contract_version=2`) plus `pricing_snapshot` JSONB: total customer
memakai PPN atas barang saja, ongkir net terpisah dari ongkir original quote,
`service_fee` `0`. Admission gate1 memakai counter PG (10/account + 60/IP per
60 detik; `429 RATE_LIMITED` dengan `Retry-After`) dan fail closed `503
POLICY_UNAVAILABLE`. Intent SO memakai kontrak provider v2 dengan
`originalShipmentCost`, `shippingCost`, dan `expectedProviderPayable` (net barang
+ net ongkir). Input invalid → 400; body melebihi 256 KiB → 413, keduanya tanpa efek samping provider. Lihat
[versioned checkout pricing](features/versioned-checkout-pricing.md).

## Store — Delivery quotes

`POST /api/checkout/delivery-quote` — onboarded store client session; strict body `{ itemIds: string[], addressId: string }` or `{ itemIds: string[], newAddress: ClientAddressInput }`. New addresses are verified against the Shipment hierarchy but not persisted on quote. Loads owned cart/address and current server prices/parcels/origin, verifies Shipment hierarchy and returns `{ success: true, data: { services } }` with rates-based shipping and delivery PPN/total. Each service also includes `originFingerprint` (opaque SHA-256 binding to canonical branch region IDs/names/postcode, required unchanged at delivery approval) and `serviceCategoryId: number | null`, normalized from vendor `courier_service_category` (positive integer/numeric string or exact official category name). Missing/malformed metadata becomes null; unknown positive IDs are preserved. These services remain selectable under Lainnya. Browser filtering uses provider categories only and does not change request input or pricing. Success logs include category/uncategorized counts without raw provider data. 404 missing/foreign rows; 400 invalid/unready inputs; 502 unavailable/no-service quote. No order, payment, insurance purchase or booking. See [delivery quotes](features/delivery-quotes.md).

Gate `discounts.contractVersion=1` menambahkan batas: body maksimal 256 KiB,
`itemIds` maksimal 50 ID (masing-masing ≤128 karakter), dan bound uang/quantity
sumber divalidasi **sebelum** read region maupun `rates` provider; input invalid →
400 dan body melebihi 256 KiB → 413, tanpa panggilan provider. Harga per service mengikuti kontrak uang berversi
(PPN atas barang saja, ongkir original vs net customer terpisah) sehingga review
customer menampilkan angka yang sama dengan order yang disimpan. Pada gate `1`,
modul quote memakai `buildPricingSnapshot` per service (bukan formula pajak
legacy); nilai `pricing` per service berasal dari snapshot yang juga harus lolos
decoder strict, dan gate `0` tetap memakai `calculateOrderPricing` lama.

## Store — Client addresses and Shipment regions

All routes below require an onboarded store client session. See [Client address book](features/client-addresses.md) for input validation, ownership, concurrency, and provider configuration.

| Method | Route | Purpose |
|---|---|---|
| GET / POST | `/api/addresses` | List own addresses / create verified recipient address |
| PATCH / DELETE | `/api/addresses/{id}` | Replace / delete owned address (foreign IDs return 404) |
| POST | `/api/addresses/{id}/default` | Atomically set the single default |
| GET | `/api/shipment/regions?level=provinces` | Shipment provinces |
| GET | `/api/shipment/regions?level=cities\|districts\|areas&parentId={id}` | Children of a string Shipment region ID |

Address input: `{ recipientName, phone, fullAddress, provinceId, cityId, districtId, areaId, postalCode, isDefault }`; IDs/postcodes remain strings. Successful address requests return `{ success: true, data }`. Invalid input/hierarchy returns 400, missing/foreign target 404, rate limit 429, unavailable backend 503. No address/region endpoint creates an order or books a courier.

Admin branch POST/PUT requires verified `shippingProvinceId`, `shippingCityId`, `shippingDistrictId`, `shippingAreaId`, `shippingPostalCode` on every create/edit. Canonical names are resolved server-side. Only sender `shippingPhone`/`shippingAddress` remain nullable optional: omission on PUT preserves current locked-row values; null/empty clears them. Existing authorization/scope and transactional audit remain required. Full details: [branch regions](features/branch-shipping-regions.md).

## Store — Catalog (products, branches, categories, homepage)

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
- **Notes**: Filters `isActive = true`; ordered by `name` asc. Response membawa header `x-request-id` kanonik buatan server dan log memakai `requestId` yang sama; body/status tidak berubah (lihat [Header korelasi](#header-korelasi-x-request-id)).

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
- **Params**: `search` (string, optional), `category` (slug, optional), `brand` (slug, optional), `branch` (ID, optional), `minPrice` (string, optional), `maxPrice` (string, optional), `status` (string, default `"aktif"`), `hasDiscount` (`"true"` untuk Markdown aktif pada varian tersedia), `sortBy` (`"price"`|`"createdAt"`, default `"createdAt"`), `sortOrder` (`"asc"`|`"desc"`, default `"desc"`), `page` (int, default `1`), `limit` (int, default `12`, clamped to 1–100 via `parseListParams` in `apps/store/src/lib/list-params.ts`)
- **Body**: none
- **Response**: 200 `{ success: true, data: [{ id, name, slug, description, basePrice, status, createdAt, price, image, collection: string|null, gender: string|null, hasStock: boolean, lastKnownInStock: boolean }], pagination: { page, limit, total, totalPages } }`; 500 `{ success: false, error }`
- **Notes**: Hanya produk dengan varian mapped dan stok tersedia pada cabang aktif yang dikembalikan: `max(0, COALESCE(availableStock, 0) - pendingRemoteStock) > 0`. Produk habis disembunyikan sebelum sort, limit, dan count sehingga pagination konsisten. Parameter `branch` membatasi stok **dan varian sumber harga** ke cabang tersebut. `price`, filter rentang harga/Markdown dan sort harga memakai varian tersedia; `sourcePrice` berasal dari varian sumber harga yang sama. `hasStock` dan `lastKnownInStock` merefleksikan stok tersedia terakhir, bukan sekadar mapping. Checkout tetap memeriksa Jubelio live. Request memakai structured logger `products-list` dan `x-request-id`.

#### `GET` `/api/products/{id}`
- **Auth**: none
- **Purpose**: Full product detail with variants, per-variant branch availability, and categories.
- **Params**: `{id}` — accepts either the product `id` or its `slug` (looked up by id first, then by slug)
- **Body**: none
- **Response**: 200 `{ success: true, data: { ...product, variants: [{ ...variant, branchStock: [{ branchId, stock, reservedStock, pendingRemoteStock, available }] }] } }`; 404 if not found; 500 on error
- **Notes**: `variants`, `colors`, `sizes` hanya mencakup varian dengan stok tersedia pada cabang aktif/mapped. Setiap `branchStock` hanya memuat `available > 0`, dihitung sebagai `max(0, COALESCE(availableStock, 0) - pendingRemoteStock)`. Produk yang seluruh stoknya habis tetap dapat dibuka melalui URL langsung: array pilihan kosong dan UI menampilkan `Stok habis` dengan pembelian dinonaktifkan. Ukuran di UI mengikuti warna terpilih. Checkout tetap memeriksa Jubelio live.

#### `GET` `/api/homepage`
- **Auth**: none
- **Purpose**: Assemble all active homepage sections with their hydrated content (product carousels and store banners).
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success: true, data: sections[] }` where each section varies by `type`: `carousel_product` sections gain a `products` array; `store_banner` sections gain a `branches` array (active branches, `name` asc); other types pass through unchanged. Empty array if no sections. 500 `{ success: false, error }`
- **Notes**: Section aktif diurutkan `displayOrder` asc. Carousel `manual` membaca junction sesuai urutan; mode `filter` mengikuti filter katalog (`search`, `category`, `brand`, `hasDiscount`, `minPrice`, `maxPrice`, `sortOrder`), limit 1–20. **Kedua mode menyembunyikan produk tanpa stok tersedia** pada cabang aktif/mapped; mode filter menerapkan aturan sebelum limit. Harga efektif dan source diproyeksikan dari varian tersedia saja. Field `collection` dan nama `gender` tetap disertakan. `store_banner` tetap menampilkan cabang aktif tanpa filter stok produk. Read-only; keberhasilan/kegagalan dicatat melalui structured logger `homepage`.

## Store — Cart, Checkout, Orders, Account

#### `GET` `/api/cart`
- **Auth**: client-session
- **Purpose**: Get (or auto-create) the user's cart with items, variant/branch/product details, first image, and subtotal.
- **Params**: —
- **Body**: none
- **Response**: 200 `{ success, data: { id, items[], itemCount, subtotal, ppnRatePercent } }`; `ppnRatePercent` is the validated effective rate (11 fallback); 401 if unauth; 500 on error
- **Notes**: Membuat cart bila belum ada. Setiap item membawa `branchId` dan `available` (stok tersedia terakhir, 0 jika snapshot/mapping/cabang tidak tersedia). UI membatasi tombol tambah quantity berdasarkan `available`. Item lama tidak dihapus otomatis hanya karena stok habis. Subtotal memakai harga efektif varian; pemeriksaan stok live tetap dilakukan saat place-order.

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
- **Response**: 200 `{ success, message }` (`"Cart item updated"` or `"Item added to cart"`); 400 body invalid / `"Branch not available"` / stok tidak mencukupi; 401 if unauth; 404 `"Variant not found"`; 409 if Jubelio mapping is missing; 500 on error
- **Notes**: Cabang wajib aktif dan pasangan item/location Jubelio mapped. Snapshot lokal menjadi batas: quantity baru **ditambah quantity item yang sudah ada** tidak boleh melebihi `availableStock - pendingRemoteStock`; stok 0/null ditolak `400`. Transaksi mengunci row stok dan upsert memakai conditional update untuk mencegah penambahan konkuren melewati batas. Perubahan cart tidak mereservasi stok; place-order tetap memeriksa Jubelio live.

#### `PUT` `/api/cart/items/{id}`
- **Auth**: client-session
- **Purpose**: Update the quantity of a single cart item.
- **Params**: `{id}` (cart item id)
- **Body**: `{ quantity: number (int, positive) }`
- **Response**: 200 `{ success, message: "Cart item updated" }`; 400 body invalid / stok atau mapping/cabang tidak tersedia; 401 tanpa session; 404 `"Cart not found"` / `"Cart item not found"`; 500 pada kegagalan internal.
- **Notes**: Item dibatasi ke cart milik session. Cabang wajib aktif/mapped; quantity akhir tidak boleh melebihi stok tersedia terakhir. Stok habis, snapshot/mapping hilang, atau cabang nonaktif ditolak `400` tanpa menghapus/mengubah item. Row stok dikunci selama transaksi update. Tidak mereservasi stok; validasi live tetap pada place-order.

#### `DELETE` `/api/cart/items/{id}`
- **Auth**: client-session
- **Purpose**: Remove a single cart item.
- **Params**: `{id}` (cart item id)
- **Body**: none
- **Response**: 200 `{ success, message: "Cart item removed" }`; 401 if unauth; 404 `"Cart not found"`; 500 on error
- **Notes**: Deletion is scoped to the user's cart (`cartId` match). Does not touch `reservedStock` (reservations only change at place-order).

#### `POST` `/api/cart/validate-checkout`
- **Auth**: client-session
- **Purpose**: Validate the selected branch and live Jubelio stock when the customer clicks Checkout in cart, before entering `/checkout`.
- **Params**: —
- **Body**: `{ selectedItemIds: string[] (min 1) }`
- **Response**: 200 `{ success: true }` or `{ success: false, code: "BRANCH_INACTIVE", branchName, removedItemCount }`; 400 invalid body / empty cart / missing selected items / multi-branch error; 401 if unauth; 409 missing Jubelio mapping or `{ success: false, code: "CHECKOUT_STOCK_ADJUSTED", error, adjustments: [{ cartItemId, productName, requestedQuantity, availableQuantity }] }`; 503 unavailable/incomplete/inconsistent provider stock; 500 on error
- **Notes**: Enforces single-branch checkout and ownership of all selected IDs. On inactive/removed branch, deletes ALL of that branch's items from the caller's cart. For an active mapped branch, reads selected stock live and reconciles the mirror without clearing local holds. A verified shortage saves positive sellable quantities in one quantity-guarded transaction, returns 409 and keeps the customer in cart (e.g. 31 requested, 20 sellable → quantity 20). UI shows a popup, updates totals, retains available-item selection and requires another Checkout click. Zero-stock items stay in cart but are deselected; failed verification does not change quantities. No reservation, order, SO or payment is created here. Place-order still re-reads stock and acquires its atomic hold at Bayar Sekarang.

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
- **Purpose**: Read selected stock live from Jubelio, hold locally, confirm the Jubelio Sales Order, then create Midtrans Snap and remove checked-out cart items.
- **Params**: —
- **Body**: `{ phone: string (8-20), email: string (email), pickupDate: string (YYYY-MM-DD), pickupTime: string (HH:mm), selectedItemIds: string[] (min 1) }`; mode gate1 menambah `{ requestKey: UUID, reviewToken, promoSelection: { kind: "none" } | { kind: "public", offerId }, acknowledgements? }`. `acknowledgements` (ticket 08) = `{ promoIncrease?: { candidateFingerprint: 64-hex }, continueWithoutPromo?: { candidateFingerprint: 64-hex } }`; hanya persyaratan yang ditandatangani review token yang diperiksa dan fingerprint harus sama dengan fingerprint token. Ack yang hilang/berbeda kandidat → 409 `CHECKOUT_REVIEW_REQUIRED` + `data.requiresAcknowledgement` sebelum order/usage/stock dibuat; ack adalah bagian intent (replay key sama dengan ack berbeda → 409 `REQUEST_KEY_CONFLICT`).
- **Response**: 200 `{ success, orderId, redirectUrl, token }`; 400 invalid body/local stock failure; 401 if unauth; 403 verified email (Coupon); 409 insufficient provider stock, promo tidak tersedia/ineligible/kapasitas habis, atau review/context berubah; 503 unavailable/inconsistent provider stock atau ambiguous Jubelio confirmation; 500 on error; 502 on Midtrans failure (cart preserved)
- **Notes (Coupon publik, ticket 07/10)**: `promoSelection.kind = "public"` menahan satu Coupon goods (fixed atau percentage rate/cap) pada slot promo. Revalidasi eligibility (state/waktu/minimum/verified email/benefit/kapasitas) dilakukan lagi di dalam transaksi di bawah lock Offer; kapasitas habis saat commit → `409 PROMO_CAPACITY_UNAVAILABLE` tanpa order/hold parsial, bukan diskon diperkecil. Satu commit menulis order/items/snapshot, Redemption `reserved` + event, counter global/per-client, allocation `markdown`/`offer_goods` positif, stock hold, SO intent, dan accepted result. Provider line memakai `price` source + `disc_amount` Markdown+Coupon whole-line; `expected_provider_payable` = net barang. Replay `requestKey` mengembalikan order yang sama tanpa reservasi ulang. Lihat [Coupon/Redemption](features/discount-redemption.md).
- **Notes**: Enforces single-branch checkout and a Jakarta-time pickup slot. Server prices are authoritative. PPN uses `tax.ppnRatePercent` (11 fallback), applies after discount, rounds upward to whole Rupiah, and persists `ppnRate`/`ppnAmount` with the gross `total`. Before the transaction, the server reads selected pairs live via `/inventory/items/all-stocks/` and reconciles their local mirrors with CAS guards. Missing/inconsistent/failed reads fail closed without a Sales Order. The transaction creates order/items, atomically increments `pending_remote_stock` against that very observation and persists the SO create intent; `paymentMethod` stays `NULL` until the customer picks a method on the hosted Snap page. Midtrans is called only after Jubelio confirms the Sales Order; item details include PPN and sum to the gross total, with product names limited to 50 characters only in the Midtrans payload, and the Snap token offers QRIS, GoPay, cards (3DS), and VA channels (`enabled_payments`). The Midtrans expiry countdown is anchored at place-order via `expiry.start_time` so it cannot outlive the reservation TTL. A Jubelio failure never creates a Midtrans transaction. Midtrans failure triggers a confirmed SO cancel or manual review; it never blindly retries a write.
- **Notes (kontrak uang berversi, gate `discounts.contractVersion=1`)**: mode legacy `0` tetap memakai `calculateOrderPricing` dan kolom `numeric(15,2)` lama. Mode `1` membangun snapshot sebelum read stok/ongkir provider sehingga bound sumber (uang integer Rupiah utuh `0..9999999999999`, quantity 1..99, maksimal 50 baris, ID ≤128, body ≤256 KiB) gagal lebih dulu (400 untuk input invalid, 413 untuk body terlalu besar); lalu menulis kolom versi + `pricing_snapshot` + intent provider v2 dalam transaksi order. Nominal tersimpan: PPN atas barang saja, ongkir net customer terpisah dari ongkir original quote, `service_fee` `0` (bukan baris charge), `expected_provider_payable` = net barang + net ongkir. Detail Midtrans dibangun dari snapshot dan jumlah detailnya wajib tepat sama dengan total (baris service fee tidak pernah muncul). Unknown/inkonsisten versi fail closed. Rincian: [versioned checkout pricing](features/versioned-checkout-pricing.md).

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
- **Notes**: Scoped to `orders.userId = session.user.id`. `pickupCode` is only exposed when `order.status === "ready_for_pickup"` or `"completed"`; otherwise `null`. `orderItems` joined to `productVariants` for `productId` and first image by `displayOrder`. Nominal dikembalikan dari decoder versi (`readOrderPricing`), bukan master/config terbaru: order kontrak `1` mengembalikan `pricingSnapshot` (currency, source/subtotal/net goods, ongkir original/subsidy/net, `serviceFee` `0`, `taxableBase`, PPN, `total`, `expectedProviderPayable`, quoted/billed shipping, versi) dan field line (`pricingContractVersion`, `sourceUnitPrice`, `markdownAmount`, `goodsDiscountAmount`, `netLineAmount`). Versi tidak dikenal atau mismatch line → 500 fail closed, bukan nominal hasil tebak. Snapshot legacy (versi `0`) tetap disajikan dengan cents lamanya. Untuk Coupon, response menambah `promo: { name, benefitAmount, status: reserved|consumed|released, consumedAt, releasedAt } | null` hanya milik order customer itu (tanpa kode/literal Offer lain); `status` dan `fulfillmentBlockedReason` dipakai UI untuk menampilkan promo status dan paid-but-blocked secara jujur.

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
- **Response**: 401 unauthorized; 400 missing id/not pending/expired; 403 forbidden; 404 not found; 409 `{ error: "Stock has not been confirmed by Jubelio" }`; 500 provider error; 200 `{ success, redirectUrl, token }`
- **Notes**: Only owned `pending_payment` orders with an `applied` or `committed` Jubelio reserve operation can create another Midtrans session. Orders past `expiresAt` are rejected (400) — the sweep may already have released the stock. When a `snapRedirectUrl` is already stored it is returned as-is (the customer may have already chosen a method on Snap; Midtrans refuses to re-create a token for a used order_id). Otherwise a new Snap payment is created with product names limited to 50 characters in its item details and the expiry anchored to the remaining reservation TTL (`expiry.start_time`). Dekoder versi dipanggil **sebelum** early return `snapRedirectUrl`: versi snapshot tidak dikenal atau pasangan versi yang tidak konsisten membuat request gagal (500 generik) tanpa redirect maupun token baru. Item detail memakai snapshot tersimpan (line efektif, adjustment diskon, `PPN`, `SHIPPING` bila ongkir net nonzero), tanpa baris service fee, dan jumlahnya wajib sama dengan total. Lihat [versioned checkout pricing](features/versioned-checkout-pricing.md).

#### `POST` `/api/webhooks/midtrans`
- **Auth**: signature-verification (Midtrans `signature_key` = `SHA512(order_id + status_code + gross_amount + serverKey)`; plus authoritative re-verify with `getMidtransTransactionStatus`)
- **Purpose**: Receive Midtrans payment notification callbacks and finalize/fail orders accordingly.
- **Params**: —
- **Body**: `{ order_id, transaction_status, status_code, gross_amount, signature_key, fraud_status }` (raw JSON body; signature verified)
- **Response**: 400 for missing required signed fields or amount/order mismatch; 401 for invalid signature; 404 for unknown order; 503 when authoritative provider verification is unavailable; 500 on processing failure; 200 on success/idempotent skip.
- **Notes**: `signature_key`, `order_id`, `transaction_status`, `status_code`, and `gross_amount` are mandatory. Signature comparison is constant-time. Both callback and authoritative provider amounts/order IDs must match the local order. There is no unverified payload fallback; non-2xx responses intentionally allow Midtrans retry. Claim guards keep success/failure finalization idempotent against webhook/sweep races, and the authoritative `payment_type` + `transaction_id` (from `GET /v2/{order_id}/status`, never the webhook body) are persisted with the claim. `settlement` / `capture`+`fraud=accept` finalize; `expire` fails the order; **`pending`/`deny`/`cancel`/`failure` are non-terminal no-ops** (Snap allows retrying with another method on the same order) — the order stays `pending_payment`. A verified settlement for an already failed order is treated as a late settlement: the original deduction is committed when compensation has not started, or a durable `reacquire` operation is applied after confirmed compensation; unsafe states enter `manual_review`.

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
- **Notes**: Only `ready_for_pickup` orders can be completed. Loads `orderItems` to render the completed email and sends via `sendEmail` to `order.contactEmail`; email failure is logged but does not fail the request (order is already completed). Env dependency: `BETTER_AUTH_SECRET` (shared with admin app). After the `completed` status is committed, a `after()`-scheduled BEST-EFFORT channel mirror reconciliation projects `Selesai` onto the Jubelio Status Channel (ticket #06; derived ONLY from the committed local state, never from the HTTP response; a mirror failure is logged and never affects the completion, pickup or this response — the sweep re-projects completed orders GET-only by the persisted SO id).

#### `POST` `/api/cron/refresh-jubelio-stock`
- **Auth**: `X-Cron-Secret` equals configured `CRON_SECRET`; unset → 503, mismatch → 401.
- **Purpose**: Bounded recurring **read-only** provider stock refresh for mapped variants and branches (no full catalog import, adjustment write, or SO ledger write).
- **Body**: none
- **Response**: 200 `{ success: true, pages, items, observed, missing, failed }`; partial/failed reads → 503 `{ success: false, ...counts }`; unexpected error → 503.
- **Notes**: DB-backed keyset cursor advances per batch (100 IDs, max 200 pages/invocation), so a bad item cannot starve subsequent items. Only complete observations update existing `branch_stock` provider series and `provider_stock_synced_at`; pending local holds are untouched. Schedule once daily as webhook-gap reconciliation; place-order independently re-reads selected Jubelio stock before SO create. Monitor failures, run duration and mapped-row coverage. See `docs/deployment-docs/jubelio-sync.md`.

#### `POST` `/api/cron/sweep-reservations`
- **Auth**: secret-header (`X-Cron-Secret` vs `process.env.CRON_SECRET`) — **503** if env unset, **401** on mismatch
- **Purpose**: Sales-Order safety-net sweep for orders whose outcome was missed.
- **Params**: —
- **Body**: none
- **Response**: 503 `{ success: false, error: "Cron not configured" }`; 401 `{ success: false, error: "Unauthorized" }`; 500 `{ success: false, error: "Sweep failed" }`; 200 `{ success: true, scanned, finalized, failed, jubelioSync, jubelioSalesReview: { scanned, marked, failed }, settlementReview: { scanned, fulfilled, review, pending }, channelMirrorReview: { possiblySentScanned, skippedFresh, recovered, investigated, stillUnknown, pendingTerminalScanned, pendingTerminalAborted, pendingTerminalSkipped, missedOrdersScanned, missedDispatched, missedFailed, failed } }`
- **Notes**: (1) Reconciles up to 50 in-flight `jubelio_sales_operation` rows by persisted remote id + GET — a confirmed cancel is confirmed and its local hold released; invoice/payment ops are GET-verified through the settlement pipeline; aged unknown dispatches without remote ids go to `manual_review`. It never re-POSTs a write. (2) Resumes settlement for paid orders stuck in `processing` (missed webhook / crash / ambiguous step) — `ready_for_pickup` only after invoice + payment are verified; ambiguity keeps the order paid but blocked. (3) Processes up to 100 stale `pending_payment` orders: settled → paid claim + settlement pipeline; otherwise expire + fail (the failure path cancels the SO pre-invoice and releases the hold only after a confirmed cancel). (4) LAST (lowest priority): the bounded channel-status mirror reconciliation (tickets #03/#04/#05/#06) — aged possibly-sent intents (any target) are reconciled GET-ONLY by the persisted SO id (terminal orders included, never a re-POST; a fresh claim is left alone for 15 minutes; transient GET 5xx/429 stays possibly_sent for aged retry); pending intents whose committed local order went terminal (completed/cancelled) are durably superseded (pending→aborted, PENDING_TERMINAL_SUPERSEDED, no POST/GET) EXCEPT a pending `Selesai` intent whose completed order still has a fully verified SO ledger (that is the current projection and it dispatches); and mirror-eligible missed `ready_for_pickup` AND `completed` orders with no intent yet, only historical `aborted` intents, or a confirmed earlier stage (e.g. confirmed Siap Proses → next Selesai version) are dispatched best-effort (committed `ready_for_pickup` → `Siap Proses`, paid-but-blocked operator investigations → `Menunggu Verifikasi` (ticket #04), committed failed_payment orders with a safe-to-edit Sales Order → `Gagal Bayar` or the started-cancel mismatch record (ticket #05), and committed `completed` orders → `Selesai` (ticket #06); a committed `cancelled` order remains a future-facing `Dibatalkan` mapping contract only and is covered by the supersede window); resolved/in-progress orders are excluded by SQL and still-unknown intents rotate, so the bounded scan is fair across runs. Mirror failures are logged into `channelMirrorReview.failed` and never fail the sweep nor touch payment/pickup/fulfillment. Provider calls remain outside DB transactions; claim guards make webhook-vs-sweep races safe.

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
- **Purpose**: List branches (paginated, searchable).
- **Params**: query `page` (default 1), `limit` (default 20), `search` (optional — case-insensitive partial match on `name`, `code`, or `city`; trimmed, blank means no filter)
- **Body**: none
- **Response**: 200 `{ success, data: [...], pagination: { page, limit, total, totalPages } }`; 500 error
- **Notes**: Ordered by `createdAt` desc. `search` and the branch-scope predicate are applied **in SQL before the page slice**, and the same `where` feeds the `count(*)` query, so `total`/`totalPages` describe the filtered result set (a match that would sit on page 2+ is still returned). Query module: `apps/admin/src/lib/branches-list.ts`; branch scope from the Current Policy via `branchScopeFromAuthorization` — own-branch scope returns only the Home Branch, an own-branch grant without a Home Branch fails closed (403). The admin list page debounces the input (400 ms) and resets to page 1 on a new term.

#### `GET` `/api/admin/shipment/regions`
- **Auth**: admin-session (guard: branches/edit), never a store session.
- **Query**: `level=provinces|cities|districts|areas`; other than provinces, `parentId` is required (1–16 digit string).
- **Response**: 200 `{ success: true, data: [{ id, name, parentId?, postalCode? }] }`; 400 invalid query; 503 timeout/failure/malformed provider data, with safe retry feedback.
- **Notes**: Server-side credential-free Shipment GETs via `JUBELIO_SHIPMENT_URL`; no synthetic results. Lookup grants no extra mutation Branch Scope.

#### `POST` `/api/admin/branches`
- **Auth**: admin-session (guard: branches/edit, all-branch scope)
- **Purpose**: Create a branch.
- **Params**: —
- **Body**: `{ name: string, code: string, city: string, address: string, latitude?: string, longitude?: string, operatingHours: { monday?: { open, close }|null, tuesday?, ..., sunday? } (default {}), googleMapsUrl?: string (valid URL or ""), status: "aktif"|"nonaktif" (default "aktif") }`
- **Required region body**: `shippingProvinceId`, `shippingCityId`, `shippingDistrictId`, `shippingAreaId` (1–16 digit strings), `shippingPostalCode` (3–10 digits). `shippingPhone`/`shippingAddress` are optional nullable strings. Every hierarchy level and postcode is provider-verified; browser labels are ignored.
- **Response**: 201 `{ success: true, data: branch }` (the created branch row, incl. `id`); 400 invalid/missing/mismatched region; 503 region provider unavailable (no branch/audit write); 500 error
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
- **Required region body**: Same five mandatory region/postcode strings as POST, on every edit including legacy, inactive and pickup-only branches. Canonical names come from Shipment. Invalid/missing region is 400; provider failure is 503 without mutation/audit. Old clients cannot omit regions to preserve/bypass configuration.
- **Notes**: Unlike POST, `operatingHours` has no default (required) and `status` is required. `latitude`/`longitude`/`googleMapsUrl` stored null when empty. `updatedAt` set. Omitted sender phone/address preserve current values under the transaction row lock; null/empty clears them. Foreign branches are 404 for own-branch scope before provider validation. Full origin before/after audit is transactional. See [branch regions](features/branch-shipping-regions.md).

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
- **Notes**: RBAC enforced via the unified `guard` (`orders:view`) + `branchScopeFromAuthorization`: own-branch scope can only view orders whose `branchId` equals the server-pinned Home Branch; a cross-branch id maps to `404` via `crossBranchNotFound`. All-branch scope sees every order. Read-only. **Nominal kontrak berversi:** response ini memakai decoder yang sama dengan store (`readOrderPricing` dari `@marketplace/db/src/versioned-pricing`), dipanggil setelah RBAC/branch scope lolos dan sebelum DTO uang maupun workflow delivery dibangun. Nominal (`subtotal`, `discount`, `shippingCost`, `serviceFee`, `ppnRate`, `ppnAmount`, `total`) dan `pricingSnapshot` berasal dari snapshot tersimpan, bukan kolom relational/master/config terbaru; baris item memakai quantity, harga efektif, dan net line dari snapshot. Versi unknown/corrupt berhenti sebagai 500 generik dengan konteks terstruktur, tanpa reprice dan tanpa provider write. Baris service fee sendiri sudah kondisional di UI (hanya dirender bila nominal > 0).

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
- **Notes**: Reads `session.user.mustResetPassword`. Errors swallowed and returned as `authenticated: false` with `200` — no error surface to the client. Response membawa header `x-request-id` kanonik buatan server; lookup yang gagal tetap `200` dengan body yang sama dan error dinormalisasi sebelum di-log.

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


## Subsidi ongkir dan pemisahan biaya kurir (ticket 11)

- `POST /api/checkout/preview` (delivery) menerima `promoSelection` yang sama dengan pickup: `{ kind: "none" } | { kind: "public", offerId } | { kind: "manual", code }`, ditambah `previous`/`acknowledgeInvalidation` untuk penggantian. Response `pricing` adalah **net customer** (subsidi sudah diterapkan); `deliveryService.shippingCost` dan `service.shippingCost` pada snapshot tetap **original**. `promo` membawa `benefitAmount` = subsidi aktual (`min(ongkir, cap)`). Pickup/ongkir0 untuk benefit shipping dijawab `409 PROMO_INELIGIBLE` dengan reason aman `FULFILLMENT_NOT_ELIGIBLE`, bukan subsidi Rp0.
- `POST /api/checkout/place-order` (delivery) memakai approval NET yang terikat review token. Setelah quote fresh, server mengevaluasi ulang kandidat pada ongkir original, menerapkan benefit, membandingkan setiap field `pricing` net dengan `approvedPricing`, lalu membekukan snapshot: `shippingBeforeSubsidy`/quote cost original, `shippingSubsidy`=`merchantFunding`, `shippingCost` net, dan `providerBilledShippingCost` NULL sampai ada evidence. Intent Sales memakai `original_shipment_cost`, `shipping_cost` net, `grand_total` net, `add_disc`/`total_tax` 0, dan tidak pernah mengirim `shipping_cost_discount`. Quote gagal/kosong/stale tidak pernah menjadi ongkir 0.
- Redemption shipping menulis tepat satu allocation `offer_shipping` tanpa item; subsidi tidak masuk `disc_amount` barang dan tidak menambah slot goods. Packing/booking membaca ongkir original; invoice/payment/recovery membaca net.
