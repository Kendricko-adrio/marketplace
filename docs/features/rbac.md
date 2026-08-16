# Admin RBAC (Roles & Permissions)

Role-based access control for the admin app (`apps/admin`). Two hardcoded roles
— `admin` (branch staff) and `hq` (head office) — with a per-module
view/edit/delete permission matrix stored in the `permission` table. HQ is an
implicit superuser; only the `admin` role is configurable.

## Model

Table: `permission` (exported as `permissions`, owned by
`packages/db/src/schema/permissions.ts`)

| Column | Notes |
|---|---|
| `id` | `text` primary key (UUID) |
| `role` | `text` — `admin` \| `hq` |
| `module` | `text` — one of `moduleNames` |
| `canView` | `boolean`, default `false` |
| `canEdit` | `boolean`, default `false` (edit **includes create**) |
| `canDelete` | `boolean`, default `false` |
| `createdAt` / `updatedAt` | `timestamptz` per project convention |

Unique constraint `permission_role_module_unique` on `(role, module)` — one row
per role per module.

Modules (`moduleNames`, shared between schema and app code):

| Module | Label (UI) |
|---|---|
| `products` | Produk |
| `orders` | Pesanan |
| `branches` | Cabang |
| `homepage` | Homepage |
| `pages` | Halaman |
| `users` | Pengguna |
| `notifications` | Notifikasi |

### HQ = implicit superuser

`HQ_PERMISSIONS` in `apps/admin/src/lib/permissions-shared.ts` returns
`canView/canEdit/canDelete = true` for **every** module. It is kept in code (not
the DB) deliberately — "prevents accidental lockout from the management page".
`getPermissionsForRole("hq")` short-circuits to this map and never touches the
DB.

### Admin role resolution

`getPermissionsForRole("admin")` (`apps/admin/src/lib/permissions.ts`):

1. Reads all `permission` rows for the role.
2. Builds a map; any module **without** a row defaults to
   `{ canView: false, canEdit: false, canDelete: false }` (deny by default).

Helpers: `checkPermission(map, module, action)`, `hasPermission(role, module,
action)`, `getFirstViewableModule(map)` (used to pick a landing page),
`getAllPermissions()`, `upsertPermission(role, module, perms)` (insert +
`onConflictDoUpdate` on `(role, module)`).

## Branch scope

Admin users are scoped to a branch via `users.branchId` (FK to `branches.id`,
`onDelete: "set null"` — see `packages/db/src/schema/auth.ts`). HQ has
`branchId = null`.

`getBranchScope(user)` in `apps/admin/src/lib/auth-guard.ts`:

| User | Scope |
|---|---|
| `role === "hq"` **or** `branchId` null | `{ mode: "all" }` — sees every branch |
| `role === "admin"` with `branchId` | `{ mode: "own", branchId }` — only that branch |

The same pattern is applied per feature, e.g. `getNotificationScope()` /
`buildScopeCondition()` in `apps/admin/src/lib/notifications.ts` (notifications
are filtered by `branchId` for branch admins, unfiltered for HQ), and the
orders API rejects orders belonging to a different branch
(`apps/admin/src/app/api/admin/orders/[id]/route.ts`).

## Guards

`apps/admin/src/lib/auth-guard.ts`:

- `withAuth(handler, allowedRoles = ["admin"])` — session required (401),
  role must be in `allowedRoles` (403).
- `withPermission(handler, module, action)` — session required (401), then
  `getPermissionsForRole(role)` + `checkPermission` (403). Used by feature
  routes (e.g. notifications, orders).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/admin/permissions` | admin-session, **role: hq** | List all permission rows |
| PUT | `/api/admin/permissions` | admin-session, **role: hq** | Upsert one permission |
| GET | `/api/admin/permissions/me` | admin-session | Current user's role + resolved permission map |

`PUT` body: `{ role, module, canView, canEdit, canDelete }`. Validation:

- `role` required, and **must be `"admin"`** — `"Only the admin role can be
  modified"` (400). HQ rows cannot be written via the API.
- `module` must be in `moduleNames` (400 otherwise).
- `canView`/`canEdit`/`canDelete` must be booleans (400 otherwise).

`GET /api/admin/permissions/me` is open to any authenticated admin (no role
restriction) — the client uses it to render/hide UI.

Full endpoint docs: `docs/api-reference.md`.

## Roles page (`/admin/roles`)

`apps/admin/src/app/admin/roles/page.tsx` + `roles-client.tsx`:

- **HQ-only hardcoded gate**: no session → redirect `/login?callbackUrl=/admin/roles`;
  `role !== "hq"` → redirect `/admin?error=forbidden`. (Server-side, not a
  permission-map check.)
- Renders a matrix: HQ row (read-only, "Akses penuh" badge) + Admin row
  (editable switches).
- Switches: `canEdit`/`canDelete` are disabled unless `canView` is on.
- Per-module "Simpan" button → `PUT /api/admin/permissions` with
  `role: "admin"`.
- Note shown in UI: disabling "Lihat" hides the module from the sidebar and
  blocks page + API access; "Edit" includes creating new data.

## Seeded defaults

`packages/db/src/seed.ts` seeds only the `admin` role (HQ needs no rows):

| Module | canView | canEdit | canDelete |
|---|---|---|---|
| products | ✅ | ✅ | ❌ |
| orders | ✅ | ✅ | ❌ |
| branches | ❌ | ❌ | ❌ |
| homepage | ❌ | ❌ | ❌ |
| pages | ❌ | ❌ | ❌ |
| users | ❌ | ❌ | ❌ |
| notifications | ✅ | ✅ | ✅ |

## Invariants (do NOT violate)

- **HQ cannot be edited via the permissions API** — `PUT` rejects any `role`
  other than `"admin"`; HQ's full access lives in code
  (`HQ_PERMISSIONS`), never in the DB.
- **`users.role` is `input: false`** in the admin Better Auth config
  (`apps/admin/src/lib/auth.ts`) — clients cannot set their own role at
  signup; it defaults to `"admin"`.
- Missing permission rows resolve to **all-false** (deny by default) — a
  module with no row is inaccessible to branch admins.
- Branch admins are always scoped to their own `branchId`; HQ sees all.
  Scope checks are applied in the data layer (query conditions), not just the
  UI.
- Roles are hardcoded (`admin` \| `hq`) — the permission table configures
  modules per role, it does not define new roles.

## Verification

- `npm run db:seed` → `permission` table has 7 rows, all `role = "admin"`,
  matching the seeded defaults table above.
- `npm run dev:admin` → log in as HQ: `/admin/roles` renders both rows, HQ
  switches disabled; toggle a module off for admin and save → the admin user
  loses the sidebar link and gets 403 on that module's API.
- Log in as a branch admin (`role = "admin"`, `branchId` set): `GET
  /api/admin/permissions/me` returns the resolved map; orders/notifications
  lists only contain that branch's data.
- `PUT /api/admin/permissions` with `role: "hq"` → 400
  `"Only the admin role can be modified"`.
- `GET /api/admin/permissions` as a branch admin → 403.
