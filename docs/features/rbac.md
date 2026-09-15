# Admin RBAC (Roles & Grants)

> Status: **shipped**. The application-owned hybrid RBAC described here
> (dynamic Roles + normalized scoped Permission Grants, per
> `docs/adr/0001-application-owned-hybrid-rbac.md`) is the only runtime
> authorization model. The legacy hardcoded `admin`/`hq` roles, the
> `permission` table, the `users.role` column, the static `HQ_PERMISSIONS`
> map, and the `/api/admin/permissions` endpoints were all removed by the
> slice-9 cutover (migration `0018`; deployment runbook:
> `docs/deployment-docs/rbac-rollout.md`). The historical design notes live in
> `docs/features/rbac-custom-roles-research.md`.

## Permission Catalog (code-owned)

The catalog lives in `packages/db/src/rbac/catalog.ts` (pure, no DB imports;
tested by `packages/db/src/rbac/catalog.test.ts`). Roles are combinations of
catalog entries; clients cannot invent unenforced permissions. Missing grants
deny. Uploads are not a standalone module: upload/delete authorization follows
the validated owning purpose/folder (see [Purpose-bound uploads](#purpose-bound-uploads)).

Branch-aware modules (grants carry a Branch Scope, `own_branch` or
`all_branches`):

| Module | Actions / scopes |
|---|---|
| `products` | `view: own/all`; `edit: all` (global Jubelio re-sync); no delete |
| `orders` | `view: own/all`; `edit: own/all`; no delete |
| `notifications` | `view/edit/delete: own/all` |
| `branches` | `view: own/all`; `edit: own/all`; `delete: all` (create requires edit-all) |
| `analytics` | `view: own/all` |
| `audit_log` | `view: own/all` |

Global modules (grants carry no scope; granted globally or not at all):

| Module | Actions |
|---|---|
| `customers` | `view` only |
| `homepage` | `view/edit/delete` |
| `pages` | `view/edit/delete` |
| `users` | `view/edit/delete` |
| `roles` | `view/edit/delete` (delete means archive) |
| `footer` | `view/edit` |

## Policy rules (`packages/db/src/rbac/policy.ts`)

- **Role Name** — normalized (trimmed, whitespace runs collapsed, lowercased),
  2–64 characters, Unicode letters/numbers plus spaces, hyphens, underscores;
  case-insensitively unique across active **and** archived Roles (DB
  expression index `admin_role_name_normalized_unique`); protected system
  names (`system owner`, `hq`, `admin`) cannot identify a custom Role.
- **Permission Coverage** — view must cover every edit/delete grant in the
  same module; all-branch edit/delete requires all-branch view.
- **System Owner bypass** — the `system_owner` Role key grants a code-owned
  full/all bypass with no editable grant rows; it cannot be weakened, and
  catalog-unsupported scopes (e.g. `branches:delete own_branch`) are still
  denied.
- **Authorization Ceiling** — a non-Owner can manage only Roles whose current
  and proposed grants are contained within the actor's own effective grants.
- **Grant diff** — removals and all→own narrowings are reductions (a reason is
  required); additions/widenings are not.
- **Optimistic concurrency** — every Role carries a `version`; revisions must
  send `expectedVersion` and fail with a stale-version conflict otherwise.

## Policy resolution and guard

The runtime authorization path is DB-backed on **every request**; nothing is
cached in the session:

- `apps/admin/src/lib/rbac/resolver.ts` — `loadPolicy(userId)` reads the user
  (assignment/activity/Home Branch), the assigned Role, and its complete grant
  set. `admissionDecision()` is the pure session-admission rule: an active
  user with an existing, non-archived Role assignment is admitted; inactive
  users, archived-Role assignees, and missing assignments fail closed with
  stable reasons (`inactive_user`, `archived_role`, `missing_assignment`).
- `apps/admin/src/lib/rbac/guard.ts` — the unified API guard: 401
  (`UNAUTHENTICATED`) for a missing session, 403 with stable codes for
  denials, structured `warn` logs on every denial and `error` logs on failure
  (`rbac.guard_failure`).

| Response | Code | Meaning |
|---|---|---|
| 401 | `UNAUTHENTICATED` | No admin session |
| 403 | `MUST_RESET_PASSWORD` | Password reset required before any protected call |
| 403 | `NO_ACCESS` | Policy unresolvable or admission denied (inactive user, archived Role, missing assignment) |
| 403 | `DENIED` | Admitted but the grant (module/action/scope) is missing |
| 404 | `NOT_FOUND` | Cross-branch object reference (`crossBranchNotFound`) — existence never disclosed |
| 500 | `INTERNAL` | Unexpected guard failure |

- Own scope is pinned server-side to the user's Home Branch; a
  client-supplied `branchId` can never widen it. `objectScopeViolation()` maps
  cross-branch object ids to 404; generic module/action denial stays 403.
- `GET /api/admin/policy/me` returns the caller's Current Policy: Role
  identity (`key`/`name`/`isSystem`/`archived`), the exact grants/scopes, Home
  Branch, `policyVersion` (the Role's optimistic version), and
  `mustResetPassword`. It is authentication-only (any admitted session) so a
  deny-all user can discover it has no access; unauthenticated callers get
  401.
- Session creation (`apps/admin/src/lib/auth.ts` `session.create.before`)
  rejects inactive users (`INACTIVE_USER`), missing or archived Role
  assignments (`INVALID_ROLE_ASSIGNMENT`), keeping sign-in and API admission
  aligned.

### Server pages

`apps/admin/src/lib/rbac/page-guard.ts` — server layouts/pages remain
authoritative: every protected admin page re-loads the DB-backed Current
Policy on navigation via `pagePolicyGuard(module, action)` /
`pagePermissionOrRedirect(...)`. Unauthenticated → `/login?callbackUrl=…`;
`mustResetPassword` → `/reset-password?force=1`; any policy denial → the
shared `/admin/no-access` screen.

### Client policy states and revalidation

`apps/admin/src/lib/rbac/policy-client.ts` holds the pure state machine
consumed by the auth provider, sidebar, and Role UI. The browser mirrors the
server policy through `GET /api/admin/policy/me` with four statuses:

| Status | Meaning |
|---|---|
| `loading` | Policy not yet resolved |
| `ready` | Resolved with at least one view grant (the Owner resolves `ready` despite zero grant rows — the bypass is code-owned) |
| `no-access` | Resolved (or `policy/me` answered 403) with no view grant at all → No-Access screen with recovery + logout |
| `unavailable` | The refresh **failed** (network/5xx/401): stale policy and protected navigation/data are cleared; nothing stale survives into this state |

Policy is revalidated on App Router navigation, window focus, and after any
403 (`createPolicyAwareFetch`). A failed refresh never logs the user out —
recovery actions are explicit, and a successful retry restores the policy.

## Roles lifecycle (API + UI)

`apps/admin/src/lib/rbac/roles-service.ts` + routes under
`/api/admin/roles` (full contracts in `docs/api-reference.md`):

- `GET /api/admin/roles` — searchable list; archived Roles behind an explicit
  `?archived=true` filter; System Owner visible but immutable.
- `POST /api/admin/roles` — create from a final deny-all/cloned draft
  (`cloneFromId`); only Save creates; 201 with the created Role.
- `GET/PUT/DELETE /api/admin/roles/{id}` — detail (grants + user counts;
  archived Roles fetchable for restore review), atomic complete-draft
  revision (`expectedVersion`, reduction requires `reason`), archive
  (custom Roles only, reason required, blocked while active users remain:
  `ROLE_HAS_ACTIVE_USERS`).
- `GET /api/admin/roles/{id}/impact` — preview the affected users for a draft
  before it is applied.
- `POST /api/admin/roles/{id}/restore` — validated restore review + restore of
  an archived Role.
- Guard errors map to stable HTTP statuses (`roles-http.ts`: e.g.
  `ROLE_NOT_FOUND` → 404, `SELF_ROLE_REVISION`/`SYSTEM_ROLE_NOT_ARCHIVABLE` →
  403, `ROLE_HAS_ACTIVE_USERS` → 409).
- Every mutation writes an immutable audit event **in the same transaction**
  (`audit-writer.ts`): `ROLE_CREATED`, `ROLE_UPDATED` (with full before/after
  grant payloads and the mandatory reduction reason), `ROLE_ARCHIVED`,
  `ROLE_RESTORED`, each stamped with the actor, the `policyVersion` in force,
  and `branchScope: "global"`. A failed audit write aborts the mutation.
- UI: `/admin/roles` (searchable list, archived filter, System Owner visible)
  and `/admin/roles/[id]` (editor, impact confirmation, stale-version
  conflict, archived mode + restore review).

## Users lifecycle (API + UI)

`apps/admin/src/lib/rbac/users-service.ts` + routes under
`/api/admin/users` (full contracts in `docs/api-reference.md`):

- Strict payloads: assignment uses `roleId` plus a mandatory Home Branch for
  every non-Owner Role; the legacy `role` field/filter is rejected (400,
  `LEGACY_FILTER_REMOVED` on the list filter).
- Create/update validate the assignment (valid active Role, mandatory Home
  Branch, Authorization Ceiling, Owner-only promotion) in one transaction with
  the user/account insert; users are created with `isActive = true` and
  (typically) `mustResetPassword = true`.
- **Soft deactivation replaces hard delete**: `DELETE /api/admin/users/{id}`
  answers 405 directing callers to `POST /api/admin/users/{id}/deactivate`
  (reason required, sessions revoked in-transaction, sign-in blocked, identity
  and audit attribution retained). Reactivation validates under the current
  policy (missing Home Branch / unusable Role fail closed). The last-active
  System Owner cannot be demoted.
- `POST /api/admin/users/{id}/reset-password` — mode-specific bodies
  (`generate` / `manual`), revokes all target sessions, returns the plaintext
  password exactly once, never logged.
- Audit events: `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`,
  `USER_REACTIVATED`.

## Purpose-bound uploads

Uploads are not a standalone permission module. The validated owning
folder maps to the module/action whose edit authority governs writing
(and deleting) files there
(`apps/admin/src/lib/rbac/upload-purposes.ts`):

| Folder | Owning authority |
|---|---|
| `products` | `products:edit` (catalog scope is all-branch only, so branch-scoped editors cannot upload product images) |
| `homepage` | `homepage:edit` |
| `orders` | `orders:edit` |

An unknown folder maps to no purpose and the upload route fails closed —
a caller is never authorized merely because they are authenticated. Delete
URLs are canonicalized and validated **before** the purpose is derived, so
`/uploads/products/../homepage/x` can never be authorized as
`products:edit` and delete a homepage asset.

## Branch-scope predicate

`apps/admin/src/lib/rbac/branch-scope.ts` maps a successful authorization into
the DB-predicate scope used by scoped list queries: `{ mode: "all" }` or
`{ mode: "own", branchId }` pinned to the server-trusted Home Branch. An
own-branch authorization without a Home Branch returns `null` and the route
answers 403 — never an all-branch widening (defence in depth; the resolver
already denies the grant).

## Initial Roles (seeded)

`packages/db/src/rbac/seed-defaults.ts` (mirrored idempotently by migration
0018 and `ensure-roles.ts`):

- **System Owner** (`system_owner`, isSystem, never archivable) — zero grant
  rows; the bypass is code-owned.
- **HQ** (`hq`, isSystem, never archivable, grants/details editable) — starts
  full/all-branch on every branch module plus all global grants.
- **Admin** (`hq`'s least-privilege counterpart; isSystem, never archivable) —
  starts branch operations only: `products view-own`,
  `orders view/edit-own`, `notifications view/edit/delete-own`; **no** global
  product re-sync and **no** all-scope grants.

## Invariants (do NOT violate)

- The catalog is the only source of grantable module/action/scope
  combinations; DB rows outside it are invalid (and `classifyGrantSet` prunes
  them).
- Missing grants deny; own-branch grants fail closed without a Home Branch.
- The System Owner bypass is code-owned and cannot be weakened or edited via
  the Roles UI.
- Authorization Ceiling: no non-Owner can create or grant themselves broader
  rights than they already hold.
- Role deletion is archive-only; archived Role Names stay reserved.
- Every Roles/Users mutation and its audit event commit in **one**
  transaction; a failed audit write aborts the mutation.
- Branch scope is server-derived from the Current Policy — client-supplied
  `branchId` can only narrow an all-branch view, never widen an own-branch
  one; cross-branch object ids answer 404.
- `roleId` and `isActive` are server-owned (`input: false` in the admin Better
  Auth config); clients cannot self-assign.

## Verification

- Unit: `packages/db/src/rbac/*.test.ts` (catalog, policy, seed defaults,
  bootstrap), `apps/admin/src/lib/rbac/*.test.ts` (resolver, guard,
  grant-matrix, roles/users services, branch-scope, upload-purposes,
  cutover guards).
- E2E (`e2e/admin/`): `rbac.spec.ts` (policy discovery, legacy endpoints gone,
  branch scope), `rbac-security.spec.ts` (branch-aware security matrix for
  Products/Orders/Notifications/Branches/Analytics/Audit Log with own/all
  actors), `roles-api.spec.ts` (Role query/create/revise/impact/archive/
  restore APIs + denials), `roles-ui.spec.ts` (list, editor, impact, conflict,
  archive/restore, No-Access and Policy-Unavailable states, revalidation on
  navigation/focus/403), `users-rbac.spec.ts` (strict payloads, ceiling,
  deactivation/reactivation, last-active-Owner protection).
- Manual: `npm run db:seed` → three system Roles; sign in as `admintoko`
  (Admin Role, Home Branch Jakarta Pusat) → scoped lists; sign in as
  `hqmanager` (HQ Role) → all-branch data; `GET /api/admin/permissions` → 404;
  `GET /api/admin/policy/me` → exact grants/scopes.
- Deployment: `docs/deployment-docs/rbac-rollout.md` (verified backup/restore,
  paired migrate, Owner bootstrap with second-run `OWNER_EXISTS`, smoke
  tests, monitoring, paired rollback).