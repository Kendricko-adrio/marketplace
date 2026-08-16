# Audit Log

## Purpose

Track significant mutations (mostly sync webhooks and order completion) in a
single `audit_log` table, viewable by admins via one list endpoint. Coverage is
**partial** — several admin mutation endpoints do not write audit entries (see
Gaps).

## Data model

Table: `audit_log` (owned by `packages/db/src/schema/system.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `userId` | text, FK → `users.id`, `onDelete: "set null"` | Null for system/webhook writes |
| `action` | text, not null | e.g. `JUBELIO_SYNC_WEBHOOK`, `VERIFY_PICKUP_CODE` |
| `entityType` | text, not null | e.g. `product`, `order`, `branch_stock`, `system` |
| `entityId` | text | Nullable (null for bulk webhook writes) |
| `changes` | jsonb | JSON diff/summary of the change |
| `ipAddress` | text | Nullable; only webhooks populate it (`x-forwarded-for`) |
| `createdAt` | timestamptz, not null, default now | |

## Writers (who writes what)

Complete list of `auditLogs` insert sites (grep of `apps/store/src`,
`apps/admin/src`, `packages/db/src`):

| Action | Writer | entityType | entityId | userId | changes |
|---|---|---|---|---|---|
| `JUBELIO_SYNC_WEBHOOK` | `apps/store/src/app/api/webhooks/jubelio/route.ts` | `product` | `itemGroupId` (string) | null | `summary` (per action: `update-product`/`update-price`/`update-qty`/ignored) |
| `JUBELIO_SYNC_ADMIN` | `apps/admin/src/app/api/admin/products/[id]/sync/route.ts` | `product` | product `id` | null | `{ itemGroupId, ...result }` |
| `VERIFY_PICKUP_CODE` | `apps/admin/src/app/api/admin/orders/[id]/verify-pickup/route.ts` | `order` | order `id` | acting admin (`user.id`) | `{ status: { from: "ready_for_pickup", to: "completed" } }` |
| `UPDATE_STOCK` | `packages/db/src/seed.ts` (sample data only) | `product_variant` | variant id | admin | `{ stock: { from: 30, to: 50 } }` |
| `BACKUP_DATABASE` | `packages/db/src/seed.ts` (sample data only) | `system` | null | null | `{ status: "success" }` |
| `UPDATE_ORDER_STATUS` | `packages/db/src/seed.ts` (sample data only) | `order` | `"sample-order-id"` | hq | `{ status: { from: "processing", to: "completed" } }` |

Notes:

- Webhook writers (`JUBELIO_SYNC_WEBHOOK`) set `userId: null` and populate `ipAddress` from the `x-forwarded-for` header.
- Admin-initiated writers (`JUBELIO_SYNC_ADMIN`, `VERIFY_PICKUP_CODE`) leave `ipAddress: null`; `JUBELIO_SYNC_ADMIN` also leaves `userId: null` (the acting admin is not recorded).
- The seed rows are demo data, not produced by real flows.

## Endpoint: `GET /api/admin/audit-log`

`apps/admin/src/app/api/admin/audit-log/route.ts` — auth: admin-session
(roles `admin`, `hq` via `withAuth`).

- **Params**: `limit` (default 50).
- **Response 200**: `{ success: true, data: [{ ...auditLogs, user: { id, name, email } | { name: "System", email: null } }] }` — newest first.
- **Notes**: Left-joins `users` on `auditLogs.userId`; a missing user (deleted, or `userId` null for webhooks) is normalized to `{ name: "System", email: null }`. No pagination cursor — only `limit`. Read-only.

There is **no admin UI page** for the audit log — only the API route exists.

## Gaps

- **Endpoints that do not write audit** (noted in `docs/api-reference.md` appendix): admin upsert/delete endpoints for **products, pages (homepage sections), footer, users** perform mutations without any `audit_log` row. Notification deletes (`/api/admin/notifications/*`) also keep no audit trail.
- `JUBELIO_SYNC_ADMIN` does not record the acting admin's `userId` (always null).
- `ipAddress` is only captured for webhook writes.
- No pagination cursor, no action/entity filters on the list endpoint.

## Invariants

- `userId` is FK to `users.id` with `onDelete: "set null"` — deleting a user must never cascade-delete audit rows.
- Webhook/system writes always use `userId: null`; the list endpoint must render them as `{ name: "System", email: null }`.
- Audit rows are insert-only — no code path updates or deletes them (except the seeder's full-table wipe).

## Env

None — the audit log has no environment variables.

## Verification

- `npm run db:seed` → 3 sample `audit_log` rows (`UPDATE_STOCK`, `BACKUP_DATABASE`, `UPDATE_ORDER_STATUS`).
- POST a signed Jubelio webhook payload → 200 and a new `audit_log` row with `userId: null`, `ipAddress` set, `changes` containing the summary.
- Verify pickup on an order → `VERIFY_PICKUP_CODE` row with the acting admin's `userId` and `changes.status.from = "ready_for_pickup"`.
- `GET /api/admin/audit-log?limit=10` → newest first, webhook rows show `user: { name: "System", email: null }`.
- Delete an admin user → their audit rows survive with `userId: null`.

See `docs/api-reference.md` → `GET /api/admin/audit-log` for the endpoint contract and the appendix for the audit-coverage caveat.
