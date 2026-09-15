# Audit Log

## Purpose

Track significant mutations in a single `audit_log` table, viewable by admins
via one list endpoint (`GET /api/admin/audit-log`). Authorization-related
mutations (Roles, Users, Branches) and order stock operations write their audit
event **in the same DB transaction as the mutation itself** — a failed audit
write aborts the mutation, and a committed mutation always carries its event.
Coverage is broad but not universal: homepage, static-page, and footer
mutations, and notification deletes, keep no audit trail (see Gaps).

## Data model

Table: `audit_log` (owned by `packages/db/src/schema/system.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `userId` | text, FK → `users.id`, `onDelete: "set null"` | Null for system/webhook writes |
| `action` | text, not null | e.g. `ROLE_UPDATED`, `USER_DEACTIVATED`, `VERIFY_PICKUP_CODE` |
| `entityType` | text, not null | e.g. `admin_role`, `user`, `branch`, `order`, `product` |
| `entityId` | text | Nullable (null for bulk webhook writes) |
| `changes` | jsonb | JSON diff/summary of the change (shape per action below) |
| `ipAddress` | text | Nullable; only the Jubelio webhook populates it (`x-forwarded-for`) |
| `policyVersion` | integer | **RBAC extension** — the Policy version (the actor's `role.version`) in force when the event was written; null on legacy/unclassified rows |
| `branchScope` | text | **RBAC extension** — `'global' \| 'single_branch' \| 'dual_branch' \| null` (null = legacy unclassified events) |
| `branchId` | text, FK → `branches.id`, `onDelete: "set null"` | First Branch context (see classification below) |
| `relatedBranchId` | text, FK → `branches.id`, `onDelete: "set null"` | Second Branch for reassignment events |
| `createdAt` | timestamptz, not null, default now | |

Relations: `user` (→ users), `branch` (→ branches via `branchId`),
`relatedBranch` (→ branches via `relatedBranchId`).

### Branch classification (`branchScope` + `branchId`/`relatedBranchId`)

- **`global`** — the event is not tied to a Branch: Role definitions,
  identity-only User changes, Branch create/delete, system/webhook-tagged
  writers that classify themselves. No branch tags set (except `branchId`
  context on deactivate/reactivate, which tag for information but classify
  global).
- **`single_branch`** — the event concerns exactly one Branch; `branchId`
  carries it. Used by `UPDATE_BRANCH`, and by order events
  (`RECHECK_JUBELIO_STOCK`, `VERIFY_PICKUP_CODE` — `branchId` = the order's
  Branch, server-resolved, never client-supplied).
- **`dual_branch`** — reassignment moves; **`branchId` carries the OLD
  Branch, `relatedBranchId` the NEW Branch**. Only User assignment changes
  that move a Home Branch produce this.
- **`null`** — legacy unclassified rows (the store Jubelio webhook writer and
  seed data): no `policyVersion`, no `branchScope`. They are invisible to
  own-branch scope in the list endpoint.

Branch references use `onDelete: "set null"`, so Audit Events survive later
Branch deletion; the deleted Branch's identity is retained in the `changes`
JSON payload.

### `policyVersion`

Integer copied from the actor's Current Policy (`policy.policyVersion` =
their `role.version`) at write time. It records which authorization state was
in force when the mutation happened, independent of the target's later
versions. Null only on legacy rows (store webhook, seed data). The Role
restore event additionally records the target's new version inside `changes`
as `policyVersionAfter` — the row's own `policyVersion` is always the
**actor's** version.

## The unified writer

`writeAuditEvent` (`apps/admin/src/lib/rbac/audit-writer.ts`) is the single
RBAC-era seam. It accepts an executor (the `db` or a **transaction**) and
inserts one immutable row with actor, action, entity, `changes`,
`policyVersion`, `branchScope`, `branchId`, `relatedBranchId`, and
`ipAddress`. Drizzle inserts are awaited, so a failed audit write aborts the
surrounding mutation transaction instead of committing silently. Legacy
writers (store webhook, seed) insert directly and leave the RBAC extension
columns null.

## Writers (who writes what)

Every `audit_log` insert site (grep of `apps/store/src`, `apps/admin/src`,
`packages/db/src`):

| Action | Writer | entityType | entityId | userId | branchScope / branch tags | policyVersion | `changes` |
|---|---|---|---|---|---|---|---|
| `ROLE_CREATED` | `roles-service.ts` (`POST /api/admin/roles`) | `admin_role` | roleId | actor | `global` | actor's | `{ name, description, grants, cloneFromId }` |
| `ROLE_UPDATED` | `roles-service.ts` (`PUT /api/admin/roles/{id}`) | `admin_role` | roleId | actor | `global` | actor's | `{ before: { name, description, grants }, after: { name, description, grants }, diff: { added, removed }, reduction, reason }` |
| `ROLE_ARCHIVED` | `roles-service.ts` (`DELETE /api/admin/roles/{id}`) | `admin_role` | roleId | actor | `global` | actor's | `{ before: { name, grants }, reason }` |
| `ROLE_RESTORED` | `roles-service.ts` (`POST /api/admin/roles/{id}/restore`) | `admin_role` | roleId | actor | `global` | actor's | `{ before: { name, archivedAt }, after: { name, grants }, policyVersionAfter }` |
| `USER_CREATED` | `users-service.ts` (`POST /api/admin/users`) | `user` | userId | actor | `global` | actor's | `{ name, email, username, roleId, roleKey, branchId, isActive: true, mustResetPassword: true }` |
| `USER_UPDATED` (assignment change) | `users-service.ts` (`PUT /api/admin/users/{id}`) | `user` | userId | actor | `dual_branch` when old AND new Home Branch exist and differ (`branchId` = old, `relatedBranchId` = new); `single_branch` when exactly one exists; `global` when neither | actor's | `{ before: { roleId, roleKey, branchId }, after: { roleId, roleKey, branchId }, demotion, reason }` |
| `USER_UPDATED` (identity only) | `users-service.ts` (`PUT /api/admin/users/{id}`) | `user` | userId | actor | `global` | actor's | `{ before: { name, email }, after: { name, email } }` |
| `USER_DEACTIVATED` | `users-service.ts` (`POST /api/admin/users/{id}/deactivate`) | `user` | userId | actor | `global` | actor's | `{ before: { isActive: true }, after: { isActive: false }, roleId, branchId, reason }` |
| `USER_REACTIVATED` | `users-service.ts` (`POST /api/admin/users/{id}/reactivate`) | `user` | userId | actor | `global` | actor's | `{ before: { isActive: false }, after: { isActive: true }, roleId, branchId, reason }` |
| `CREATE_BRANCH` | `branches-service.ts` (`POST /api/admin/branches`) | `branch` | branchId | actor | `global` | actor's | `{ name: { from: null, to } }` |
| `UPDATE_BRANCH` | `branches-service.ts` (`PUT /api/admin/branches/{id}`) | `branch` | branchId | actor | `single_branch`, `branchId` = updated Branch | actor's | `{ name: { from, to }, status: { from, to } }` |
| `DELETE_BRANCH` | `branches-service.ts` (`DELETE /api/admin/branches/{id}`) | `branch` | branchId | actor | `global` (Branch row is gone; identity retained in `changes`) | actor's | `{ name: { from, to: null } }` |
| `RECHECK_JUBELIO_STOCK` | `orders-service.ts` (`POST /api/admin/orders/{id}/stock-review`) | `order` | orderId | actor | `single_branch`, `branchId` = order's Branch | actor's | `{ operationId, status: { from: "manual_review", to: "reconciling" } }` |
| `VERIFY_PICKUP_CODE` | `orders-service.ts` (`POST /api/admin/orders/{id}/verify-pickup`) | `order` | orderId | actor | `single_branch`, `branchId` = order's Branch | actor's | `{ status: { from: "ready_for_pickup", to: "completed" } }` |
| `JUBELIO_SYNC_ADMIN` | `apps/admin/src/app/api/admin/products/[id]/sync/route.ts` | `product` | product id | **acting admin** | `global` | actor's | `{ itemGroupId, ...syncResult }` |
| `JUBELIO_SYNC_WEBHOOK` | `apps/store/src/app/api/webhooks/jubelio/route.ts` | `product` | Jubelio `itemGroupId` (string) | null | **null** (legacy unclassified) | null | per-action summary (`update-product`/`update-price`/`update-qty`/ignored) |
| `UPDATE_STOCK`, `BACKUP_DATABASE`, `UPDATE_ORDER_STATUS` | `packages/db/src/seed.ts` (sample data only) | mixed | sample ids | mixed | null | null | demo payloads |

Notes:

- `actor` above means the acting admin (`user.id`) from the Current Policy
  context; `policyVersion` "actor's" means the actor's policy version in force
  when they acted.
- The old claim that `JUBELIO_SYNC_ADMIN` leaves `userId: null` is stale —
  the acting admin is now recorded.
- `USER_UPDATED` writes **one** event per PUT: the assignment shape (with
  branch tags) when the Role/Home-Branch assignment changed, the identity
  shape when only name/email changed — never both in one event.
- `RECHECK_JUBELIO_STOCK` is written only when the conditional claim
  (`manual_review → reconciling`) actually succeeds — a no-op claim writes
  nothing at all.
- `VERIFY_PICKUP_CODE` is written by the reconciliation seam
  (`finalizePickupCompletion`) only when the order is `completed`; an
  ambiguous store-call failure that leaves the order uncompleted stays
  retryable and writes nothing.
- The seed rows are demo data, not produced by real flows.

## Endpoint: `GET /api/admin/audit-log`

`apps/admin/src/app/api/admin/audit-log/route.ts` — the unified `guard`
(`audit_log:view`) + `branchScopeFromAuthorization` (Current Policy). There is
no `withAuth`, no static `admin`/`hq` role allowlist, and no hardcoded
branch name — the legacy patterns are gone.

- **Auth**: admin-session (guard: `audit_log:view`). Branch-aware:
  `audit_log` grants carry `own_branch`/`all_branches` scope.
- **Params**: `limit` (default 50).
- **Response 200**: `{ success: true, data: [{ ...auditLog row (incl. policyVersion, branchScope, branchId, relatedBranchId), user: { id, name, email } | { name: "System", email: null } }] }` — newest first. 403 `{ success: false, error: "Forbidden", code: "DENIED" }` when an own-branch grant has no Home Branch (fail closed); 500 `"Failed to fetch audit log"`.
- **Branch scope filtering** (the real access control, applied in SQL):
  - **own-branch scope** → only events tagged to the server-pinned Home
    Branch:
    - `single_branch` events whose `branchId` = Home Branch, **plus**
    - `dual_branch` reassignment events whose `branchId` (old) **or**
      `relatedBranchId` (new) = Home Branch.
    - `global` and legacy unclassified events (`branchScope` null — e.g.
      system/product-sync/webhook rows) are **excluded**.
  - **all-branch scope** → branch-tagged and global events alike.
- **Notes**: Left-joins `users` on `auditLogs.userId`; a missing user
  (deleted, or `userId` null for webhooks) is normalized to
  `{ name: "System", email: null }`. No pagination cursor — only `limit`.

There is **no admin UI page** for the audit log — only the API route exists.

## Gaps

- **Endpoints that do not write audit**: admin mutation endpoints for
  **homepage sections, static pages, and footer** perform mutations without
  any `audit_log` row. Notification deletes
  (`/api/admin/notifications/*`) also keep no audit trail. (Roles, Users,
  Branches, order stock operations, product sync, and the Jubelio webhook all
  write events — see Writers.)
- `ipAddress` is only captured for webhook writes.
- No pagination cursor, no action/entity filters on the list endpoint.
- Legacy unclassified rows (store webhook, seed) carry no
  `policyVersion`/`branchScope`, so own-branch viewers never see product-sync
  system events.

## Invariants

- `userId` is FK to `users.id` with `onDelete: "set null"` — deleting
  (or deactivating) a user must never cascade-delete audit rows.
- `branchId`/`relatedBranchId` are FKs to `branches.id` with
  `onDelete: "set null"` — deleting a branch keeps the event and its
  identity in `changes`.
- Webhook writes always use `userId: null`; the list endpoint must render
  them as `{ name: "System", email: null }`.
- Every Roles/Users/Branches/order-operation mutation writes its audit event
  **inside the same transaction as the mutation** — a failed audit write
  aborts the mutation (no committed change without its event).
- `policyVersion`/`branchScope` are stamped on every RBAC-era event; only
  legacy rows (store webhook, seed) have them null.
- Audit rows are insert-only — no code path updates or deletes them (except
  the seeder's full-table wipe).

## Env

None — the audit log has no environment variables.

## Verification

- `npm run db:seed` → legacy sample `audit_log` rows (`UPDATE_STOCK`,
  `BACKUP_DATABASE`, `UPDATE_ORDER_STATUS`) with null RBAC columns.
- Create/revise/archive/restore a Role → one `ROLE_*` row per mutation with
  the actor's `policyVersion`, `branchScope: "global"`, and the full
  before/after grant payloads; a Home-Branch move via
  `PUT /api/admin/users/{id}` → `USER_UPDATED` with `branchScope:
  "dual_branch"`, `branchId` = old Home Branch, `relatedBranchId` = new.
- Update a Branch → `UPDATE_BRANCH` row with `branchScope: "single_branch"`
  and `branchId` = the Branch; delete the Branch afterwards → its audit rows
  survive with `branchId: null`.
- Verify pickup on an order → `VERIFY_PICKUP_CODE` row with
  `branchScope: "single_branch"`, `branchId` = the order's Branch, and the
  actor's `policyVersion` stamped.
- `GET /api/admin/audit-log?limit=10` → newest first; with an own-branch
  `audit_log` grant the result contains only `single_branch` Home-Branch
  events and `dual_branch` reassignments touching the Home Branch — no
  `global`/unclassified rows; with an all-branch grant, global events appear
  too. Webhook rows show `user: { name: "System", email: null }`.
- An own-branch grant without a Home Branch → `403 DENIED` (fail closed).

See `docs/api-reference.md` → `GET /api/admin/audit-log` for the endpoint
contract.