# New RBAC — Implementation Plan

**Branch:** `feature/rbac-new`  
**Status:** Design confirmed; implementation pending.

Canonical inputs: `CONTEXT.md`, `.agents/rbac-new-handoff.md`, `docs/features/rbac-custom-roles-research.md`, `docs/adr/0001-application-owned-hybrid-rbac.md`, and the legacy behavior in `docs/features/rbac.md`.

## Delivery rules

- Follow `.agents/skills/tdd/SKILL.md`: one vertical slice at a time, public-seam failing test first, smallest green change, then focused regression.
- Before implementation load `tdd`, `nextjs`, and `better-auth-best-practices`. Use `systematic-debugging` for every unexpected result.
- Before version-sensitive code, verify current Better Auth 1.6.29, Next.js 16, Drizzle ORM 0.45.x, and drizzle-kit 0.31.x APIs through Context7 and local Next docs.
- Schema changes belong only in `packages/db/src/schema/`. Run every `db:*` command from the repository root and use `db:push`, not `db:migrate`, for the development database.
- Every changed `/api/**` handler must use `apps/admin/src/lib/logger.ts`: success `info`, contextual denial `warn`, and failure `error` with `serializeError`. Never log passwords, session tokens, or sensitive payloads.
- Update API, feature, architecture, testing, and deployment documentation in the same slice as behavior.
- UI/routing/auth changes require Playwright coverage. Diagnose failed Playwright runs from Markdown output, never screenshots.
- Preserve unrelated working-tree changes. Stage explicit RBAC paths, never `git add -A`.

## Common HTTP semantics

| Condition | Status |
|---|---:|
| Missing admin session | 401 |
| Generic module/action denial | 403 |
| Ceiling, self-role, or Owner-only violation | 403 with stable code |
| Cross-branch object ID | 404 |
| Invalid input, grant coverage, or missing reason | 400 |
| Duplicate Role Name | 409 |
| Stale optimistic version | 409 `STALE_VERSION` |
| Invalid state transition, including last Owner or assigned Role/Branch | 409 |
| Unexpected failure | 500 plus structured error log |

## Target data model

Create `packages/db/src/schema/rbac.ts`:

- `admin_role`: immutable `id` and machine `key`; editable `name` and `description`; `isSystem`; optimistic `version`; nullable `archivedAt`; timestamptz creation/update fields.
- Globally case-insensitive unique Role Name, including archived Roles, implemented with a unique expression index on normalized/lower name.
- `admin_role_grant`: normalized row per `(roleId,module,action)`, nullable scope for global actions and `own_branch|all_branches` for branch-aware actions; FK to Role with cascade; unique tuple and database checks for action/scope shape.
- In `users`, add `roleId` FK with `ON DELETE RESTRICT` and `isActive`. Preserve legacy `role` only during the maintenance-window transition and drop it in slice 9.
- Extend `audit_log` with policy version and branch classification capable of representing global, one-branch, and old+new branch assignment events. Audit branch references must survive later Branch deletion.

Code-owned catalog:

- Branch-aware: Products (`view own/all`, `edit all`), Orders (`view/edit own/all`), Notifications (`view/edit/delete own/all`), Branches (`view/edit own/all`, delete all; create requires edit-all), Analytics (`view own/all`), Audit Log (`view own/all`).
- Global: Customers (`view`), Homepage (`view/edit/delete`), Pages (`view/edit/delete`), Users (`view/edit/delete`), Roles (`view/edit/delete`, where delete means archive), Footer (`view/edit`).
- Upload authorization follows a validated owning purpose/folder; there is no Upload module.
- Missing grants deny. View scope must cover edit/delete scope.

Initial Roles:

- `system_owner`: immutable code-owned full/all bypass and no editable grant rows.
- `hq`: system Role, not archivable, initially full/all but grants and display details editable.
- `admin`: system Role, not archivable, initially Products view-own; Orders view/edit-own; Notifications view/edit/delete-own; no global product re-sync.

---

## Slice 1 — Permission catalog and pure policy model

### Red tests

Add `packages/db/src/rbac/catalog.test.ts` and `policy.test.ts` against exported public functions:

- Role Name normalization, 2–64 character rules, Unicode letters/numbers/spaces/hyphen/underscore, protected names, and invalid characters.
- Catalog rejects unknown/unsupported module-action-scope combinations, such as Product edit-own, Branch delete-own, Customer edit, global scope on a global module, or missing scope on a branch module.
- Coverage rejects edit/delete not covered by view and all-branch mutation covered only by own-view.
- Authorization denies absent grants, pins own scope to Home Branch, returns all scope correctly, denies archived/inactive policy, and gives System Owner the code-owned bypass.
- Authorization ceiling compares each action and scope; own cannot authorize all and absent global authority cannot delegate it.
- Grant diff identifies removal and all→own narrowing as reductions, while additions/widening are not reductions.

Expected values must be hand-derived from the confirmed catalog, not generated by the implementation.

### Green implementation

Create:

- `packages/db/src/rbac/catalog.ts`: catalog, types, system keys, protected names, Role Name normalization/validation, grant-set validation.
- `packages/db/src/rbac/policy.ts`: pure authorization, coverage, ceiling, grant diff, and reduction functions.

No DB imports in this slice.

### Verification and docs

- Run focused DB unit tests, then `npm run test:unit`.
- Rewrite the permission-catalog section of `docs/features/rbac.md`, clearly marking that legacy runtime remains until slice 9.
- Context7 checkpoint: Drizzle check constraints and expression unique indexes before slice 2.

---

## Slice 2 — Schema, migration, seed defaults, and Owner bootstrap CLI

### Red tests

Add:

- `packages/db/src/rbac/seed-defaults.test.ts`: exact Initial Role keys and exact HQ/Admin grants; Owner has no grant rows; Admin has no Product edit or all-scope grant.
- `packages/db/src/rbac/bootstrap-owner.test.ts`: exported bootstrap decision rejects an existing Owner, invalid identity/password, and missing input; accepts a valid first Owner with no Home Branch and forced password reset.
- A DB integration/script seam proving a fresh reset+seed creates exactly three Initial Roles, normalized grants, and populated user `roleId` assignments.

### Green implementation

- Add `packages/db/src/schema/rbac.ts`; export it from `schema/index.ts`; add `roleId`/`isActive` to `auth.ts`; extend `system.ts` audit columns.
- Add relations, indexes, unique/check constraints, and timestamptz fields.
- Generate `packages/db/drizzle/0017_*.sql` via root `npm run db:generate`; inspect generated SQL for both tables, expression index, checks, FKs, and audit/user columns. Apply locally with `npm run db:push`.
- Add pure defaults in `packages/db/src/rbac/seed-defaults.ts`; update `seed.ts` and `seed-cleanup.ts` in safe FK order. Assign seeded Admin/HQ users through `roleId` while the legacy role column temporarily coexists.
- Add `packages/db/src/rbac/bootstrap-owner-core.ts` and `packages/db/src/bootstrap-owner.ts`.
- Add root script `db:bootstrap-owner`.
- CLI accepts explicit name/email/username/password input, hashes with the admin auth convention, creates user+credential+Owner assignment transactionally, sets `mustResetPassword`, emits structured JSON logs, and exits non-zero with `OWNER_EXISTS` after an Owner exists. Never ship default production credentials or a web bootstrap endpoint.
- Protect concurrent first-Owner attempts with transaction-level serialization/locking verified against current PostgreSQL/Drizzle APIs; do not rely on a race-prone count alone.

### Verification and docs

- `npm run test:unit`, `npm run db:check`, `npm run db:reset && npm run db:seed`.
- Verify a second bootstrap invocation refuses without creating data.
- Update `docs/features/rbac.md`, `docs/features/seeding.md`, `docs/architecture/database.md`, root script documentation, and add `docs/deployment-docs/rbac-owner-bootstrap.md` with staging/production container commands and secret-handling guidance.
- Context7 checkpoint: Drizzle transaction locks/advisory locks, generated check/expression index support; Better Auth additional-field/database-hook signatures for slice 3.

---

## Slice 3 — Current-policy resolver, Owner bypass, ceiling, guard, and session admission

### Red tests

- Public admission decision admits active users with active Roles and rejects inactive users, archived Roles, and missing assignments using stable reasons.
- Unified authorization context returns denied or an allowed own/all scope; own branch is server-pinned.
- Object-scope helper maps mismatched branch objects to not-found.
- `GET /api/admin/policy/me`: unauthenticated 401; seeded Admin returns Role identity, exact current grants/scopes, Home Branch, and policy version.
- Owner policy allows every catalog action with all scope despite having no grant rows.

### Green implementation

Create:

- `apps/admin/src/lib/rbac/resolver.ts`: DB-backed `loadPolicy(userId)` and authorization entry point. Read user, Role, and grants on every request; do not cache policy in the session.
- `apps/admin/src/lib/rbac/guard.ts`: unified guard passing `{user,policy,scope}` and shared object-branch check.
- `apps/admin/src/app/api/admin/policy/me/route.ts`.

Update:

- `apps/admin/src/lib/auth.ts`: replace enum-like legacy role additional field with server-owned `roleId` and `isActive`; session creation checks active user, existing/non-archived Role, and valid assignment. Do not touch store auth.
- Keep `apps/admin/src/lib/auth-guard.ts` only as a temporary compatibility delegate until slice 9.

Every policy route and guard denial uses structured logging.

### Verification and docs

- Focused auth/policy tests, `npm run test:unit`, and initial policy endpoint Playwright assertions in `e2e/admin/rbac.spec.ts`.
- Update `docs/architecture/auth.md`, `docs/api-reference.md`, and policy-resolution sections of `docs/features/rbac.md`.
- Blocking Context7/local-doc check: Better Auth 1.6.29 session hook, additional-field typing and session storage behavior; Next.js 16 route handlers and async headers/params.

---

## Slice 4 — Role query, create, revise, impact, archive, and restore APIs

### Contracts

Create routes under `apps/admin/src/app/api/admin/roles/`:

- `GET /roles?q=&archived=` requires `roles:view`; default excludes archived; returns identity, system/archive flags, version, user count, and grants.
- `POST /roles` requires `roles:edit`; atomically creates a deny-all or optional cloned draft with final name/description/grants; returns 201.
- `GET /roles/[id]` requires `roles:view`.
- `PUT /roles/[id]` requires `roles:edit`; receives expected version and complete identity/grant draft. Reject stale versions, invalid coverage/catalog combinations, edits to System Owner, self-role revision by non-Owner, and current or proposed grants above the actor ceiling. Reductions require reason.
- `POST /roles/[id]/impact` previews reductions and affected active users.
- `DELETE /roles/[id]` requires `roles:delete`; archives custom Roles only, requires reason, and blocks when active users remain. Owner/HQ/Admin cannot be archived.
- `GET /roles/[id]/restore` returns a review draft and invalid retained grants under the current catalog.
- `POST /roles/[id]/restore` requires `roles:edit`, expected version, reviewed complete draft, current catalog/coverage/ceiling validation, and name uniqueness before activation.

### Red tests

Add `e2e/admin/roles-api.spec.ts` and pure revision-planning tests:

- Missing Roles grants yield 403.
- Names are case-insensitively unique across active+archived Roles; protected/invalid names fail.
- Invalid scope/coverage fails.
- Ceiling checks both current and proposed grants.
- Non-Owner cannot revise the Role assigned to them.
- Concurrent revisions from one base version: first succeeds, second returns 409 `STALE_VERSION` without partial grant replacement.
- Reduction without reason fails; confirmed reduction writes full before/after audit data and policy version.
- Assigned custom Role cannot archive; system Roles cannot archive; archived names remain reserved.
- Restore revalidates retained grants and bumps version.

### Green implementation

- Create `apps/admin/src/lib/rbac/roles-service.ts` and `audit-writer.ts`.
- Each mutation runs in one DB transaction: lock/re-read Role, check expected version, validate, mutate complete grant set, bump version, write immutable audit event, commit.
- Convert unique/constraint races into stable 409/400 responses.
- Log every success, denial, conflict, and failure with actor/target/version context.

### Verification and docs

- Focused API E2E, policy unit tests, `npm run test:unit`.
- Update `docs/api-reference.md`, Role lifecycle in `docs/features/rbac.md`, and authorization audit event shapes in `docs/features/audit-log.md`.
- Context7 checkpoint: Drizzle `.for("update")`, transactions, conflict/error mapping.

---

## Slice 5 — Dynamic User assignment, deactivation/reactivation, and session revocation

### Red tests

Add `e2e/admin/users-rbac.spec.ts` and extend existing user tests:

- User creation requires valid active `roleId`; every non-Owner Role, including HQ/global-only Roles, requires one valid Home Branch.
- Role+Home Branch is atomic: invalid branch/Role leaves no partial user/account row.
- Assigning grants above the actor ceiling returns 403; only an active Owner can assign Owner.
- Non-Owner cannot change their own Role assignment.
- Deactivation requires reason, retains Role/Home Branch/email/username/audit identity, revokes every existing session, and blocks future sign-in.
- Last active Owner cannot be demoted or deactivated, including under concurrent requests.
- Reactivation is a validated `users:edit` operation within ceiling; archived/invalid Role or missing required Home Branch blocks it.
- Reserved inactive email/username still conflict.
- Legacy `role:"hq"` payload is rejected.

### Green implementation

Update user routes and forms:

- User list/detail returns Role object and `isActive`; filters use `roleId` and activity.
- Create/update uses strict schemas with `roleId`, Home Branch, activity, and reason.
- Validate Role assignment, ceiling, self-protection, Owner-only promotion, and Home Branch in one transaction.
- Replace hard deletion with soft deactivation. Remove DELETE behavior or return explicit 405 directing callers to deactivation.
- Revoke sessions transactionally by the Better Auth-supported mechanism confirmed through Context7; if direct `admin_session` deletion remains correct for this configuration, centralize and test it.
- Record `USER_CREATED`, assignment change, demotion, deactivation, and reactivation audit events. Reassignment events carry old and new branch context.
- Update `UserForm.tsx`, user new/edit clients, and reset-password guard usage.

### Verification and docs

- Focused user RBAC E2E, existing `users.spec.ts`, unit suite.
- Update user endpoint docs, Role Assignment/user lifecycle in `docs/features/rbac.md`, and session revocation in `docs/architecture/auth.md`.
- Context7 checkpoint: Better Auth DB-backed session revocation semantics and Zod strict-object behavior.

---

## Slice 6 — Role UI, impact confirmation, safe browser states, and policy revalidation

### Red Playwright tests

Add `e2e/admin/roles-ui.spec.ts` and rewrite legacy RBAC UI assertions:

- Roles viewer sees searchable active list with explicit archived filter; System Owner is visible and immutable.
- New Role starts deny-all or copies a selected clone; unsupported actions/scopes cannot be selected; only final Save creates it.
- Editor saves complete draft once. A reduction shows exact grant diff and affected users and requires explicit reason/confirmation.
- Two editors demonstrate visible stale-version conflict with no overwrite.
- Archive block/success and restore review-draft behavior are visible.
- User with no view grants lands in No-Access State with only password recovery and logout.
- Failed policy refresh clears stale protected navigation/data and shows distinct Policy-Unavailable State with retry/recovery/logout; successful retry restores current policy.
- Policy revalidates on App Router navigation, window focus, and after a 403 without logout.

### Green implementation

- Replace the old matrix under `apps/admin/src/app/admin/roles/` with searchable list, new page, detail/editor page, grant matrix, scope controls, clone, impact confirmation, archive, and restore review.
- Add `apps/admin/src/app/admin/no-access/page.tsx` and a Policy-Unavailable component/state.
- Update `apps/admin/src/providers/auth-provider.tsx` to consume `/api/admin/policy/me`, expose explicit loading/ready/no-access/unavailable states, clear stale policy on failure, and centralize refresh triggers.
- Update `AdminSidebar.tsx` and `admin/layout.tsx` to use policy rather than Role names. Server layout remains authoritative.
- Remove old UI imports such as `HQ_PERMISSIONS` as soon as unused.

### Verification and docs

- Focused Roles UI E2E plus dashboard/sidebar regressions and unit tests for any extracted policy-state helper.
- Update Role UI, revalidation, No-Access, and Policy-Unavailable sections in `docs/features/rbac.md`.
- Context7/local Next docs checkpoint: pathname/navigation observation, Server/Client boundaries, redirects, async APIs, and route conventions in Next.js 16.

---

## Slice 7 — Branch-aware module conversion

Convert Products, Orders, Notifications, Branches, Analytics, and Audit Log route-by-route. Each route first gets a failing list/object/mutation test, then the smallest guard+predicate change and structured logs.

### Products

Files: product list/detail/sync routes and existing branch-stock helpers/tests.

- Own-view lists only products carried by Home Branch and only branch-scoped stock.
- Non-carried detail ID returns 404.
- Jubelio re-sync requires Product edit-all; view or impossible edit-own cannot trigger it.

### Orders

Files: list/detail, stock-review, and verify-pickup routes.

- Own predicates are applied in list query and object lookup/mutation.
- Cross-branch IDs return 404.
- Pickup verification always requires `order.branchId === actor.homeBranchId`, even with edit-all.

### Notifications

Files: `apps/admin/src/lib/notifications.ts` and all notification routes.

- Replace Role/nullable-branch inference with policy scope.
- Explicitly test that missing Home Branch denies/fails closed rather than becoming all-scope.

### Branches

Files: branch list/detail routes.

- Own-view/edit reaches only Home Branch; another Branch ID returns 404.
- Create requires edit-all and delete requires delete-all.
- Delete returns 409 `BRANCH_IN_USE` while any active or inactive user retains it as Home Branch.

### Analytics

File: analytics route and spec.

- Own scope filters order count, paid revenue, statuses, recent activity, and distinct transacting customers to Home Branch.
- Distinct customer requires at least one Order in scope.
- Null-branch Orders are excluded from own and included in all-scope analytics.

### Audit Log

File: audit route and spec.

- Own scope sees events tagged to Home Branch and assignment moves involving it as old or new Branch.
- Own scope never sees global/system/product-sync events.
- All scope sees branch and global events.

### Verification and docs

Add/extend `e2e/admin/rbac-security.spec.ts`, products/orders/notifications/analytics specs, branch-stock and notification unit tests. Run full admin E2E after focused tests.

Update `docs/features/rbac.md`, analytics, audit-log, notifications, branch/product/order docs, and every touched endpoint in `docs/api-reference.md`.

Context7 checkpoint: conditional Drizzle SQL predicate composition and Next.js async route params.

---

## Slice 8 — Global modules, helper routes, link destinations, and purpose-bound uploads

### Red tests and conversions

- Customers: `customers:view` controls global list/detail; no mutation grant/action exists.
- Homepage and preview/reorder routes: map actual read/edit/delete behavior to global Homepage actions.
- Pages: map list/detail/create/update/delete to global Pages actions.
- Users and Roles: verify all pages/routes use their global grants.
- Footer and linkable destinations: replace HQ-only gates with Footer view/edit. Link destination reads follow Footer view.
- Brands/categories are Product-owned helper resources: reads require Product view; mutations/global master changes require Product edit-all.
- Upload route validates folder/purpose before authorization and maps each allowed purpose to its owning module/action. Upload and delete require the owning edit authority. Never authorize a caller merely because they are authenticated.
- Keep `/api/admin/me` and session-check authentication-only where they contain no protected business data.

Create a pure folder/purpose mapping with unit tests. Playwright must prove view-only mutation denial, global access independent of Home Branch, and upload denial/success for Products/Homepage/other supported folders.

### Verification and docs

- Full admin unit/E2E regressions, especially CMS/customer/upload specs.
- Update every touched endpoint in `docs/api-reference.md` and authorization sections of Footer, Homepage, Pages, Customer, and Upload feature docs.
- All touched routes use structured logger success/error/denial records.

---

## Slice 9 — Remove hardcoded Admin/HQ authorization and legacy permission paths

### Red permanent guards

Add a repository-level test/script that fails when authorization code contains:

- `HQ_PERMISSIONS`;
- imports/use of the legacy `permissions` table;
- `users.role` or literal Role-name authorization;
- `hqOnly` navigation gates;
- legacy `/api/admin/permissions` or `/permissions/me` client calls.

Allow literal names only in seed/migration/display fixtures where they are not authorization decisions.

Playwright verifies old permission endpoints are gone (404) and `/api/admin/policy/me` remains functional.

### Green cutover

- Delete legacy `apps/admin/src/lib/permissions.ts`, `permissions-shared.ts`, obsolete auth guard paths, old permission API routes, old roles matrix, and legacy tests.
- Replace all remaining role-name branches in layouts, sidebar, users/orders/notifications pages, helpers, and routes.
- Remove `packages/db/src/schema/permissions.ts`, exports, legacy seed rows/cleanup, and `admin-default-permissions.test.ts` expectations.
- Generate `packages/db/drizzle/0018_*.sql`: make `users.role_id` non-null after verified backfill, drop `permission`, drop `users.role`, and ensure indexes/FKs. Inspect generated SQL and apply with `db:push` in development.
- Better Auth exposes only current server-owned assignment fields; no dual role representation survives.

### Verification and docs

- Grep guard, unit suite, fresh reset/seed, `npm run build:admin`, focused and full admin E2E.
- Fully rewrite `docs/features/rbac.md` as current behavior. Finalize `docs/architecture/database.md`, `docs/architecture/auth.md`, and remove legacy API entries.

---

## Slice 10 — Security matrix, migration rehearsal, documentation, and rollout

### Automated matrix

Finalize `e2e/admin/rbac-security.spec.ts` and pure policy matrix coverage for:

- System Owner immutable bypass, Owner-only promotion, and final active Owner protection.
- Editable HQ constrained by current grants and self-role protection.
- Marketing Role with only Homepage access despite mandatory Home Branch.
- Branch order operator list/object/mutation boundaries and cross-branch 404.
- Pickup physical Home Branch rule.
- Role-manager ceiling for role creation/revision and user assignment.
- Permission reduction impact/reason/audit/version and next-request enforcement.
- Deny-all No-Access versus refresh-failure Policy-Unavailable.
- Inactive sign-in/session rejection, reserved identity, reactivation, attribution retention.
- Archived Role filtering/name reservation/reviewed restore.
- Branch reassignment visible in old and new Branch audit scopes; global sync hidden from own audit.
- Branch deletion blocked by active or inactive assignees.
- Null-branch analytics behavior and scoped distinct-customer count.
- Purpose-bound upload authorization.
- Deny-by-default for every catalog module/action.

Fixtures must create independent deterministic actors/roles and clean them in FK order. Avoid sharing mutable permission state across parallel specs; mark suites serial where unavoidable.

### Migration and seed rehearsal

On a disposable database:

1. Exercise the pre-cutover schema/data and preserve product/branch/order/business rows.
2. Apply generated migrations as deployment will.
3. Verify role backfill, grant defaults, non-null `roleId`, dropped legacy columns/table, unchanged business-row counts, and audit continuity.
4. Run reset+seed and assert exact Initial Roles/grants.
5. Run bootstrap Owner once successfully and a second time expecting `OWNER_EXISTS`.

### Documentation

Finalize:

- `docs/api-reference.md` for every changed/new/removed route.
- `docs/features/rbac.md` and affected feature docs.
- `docs/architecture/auth.md`, `database.md`, and middleware/overview references if changed.
- `docs/testing/README.md` with new specs, fixtures, and commands.
- `docs/deployment-docs/rbac-owner-bootstrap.md`.
- New `docs/deployment-docs/rbac-rollout.md` and deployment index entry.

### Rollout

Document the accepted maintenance window:

1. Backup with `pg_dump` and verify restore capability.
2. Deploy one code/schema version; run deployment migration container.
3. Run the one-time Owner bootstrap securely.
4. Smoke-test Owner Roles access, HQ current policy, Admin branch scope, session revocation, audit events, and structured denial logs.
5. Monitor unexpected 401/403/404 rates and DB constraint errors.

Rollback is a paired operation: restore the pre-cutover DB backup and redeploy the previous image. There is no dual-read/write compatibility path by design.

## Final validation commands

Run from repository root:

```bash
git status --short
npm run lint:admin
npm run test:unit
npm run db:check
npm run db:reset
npm run db:seed
npm run db:bootstrap-owner -- --name "System Owner" --email owner@example.invalid --username owner --password '<secure-test-password>'
# Repeat bootstrap and assert non-zero OWNER_EXISTS.
npm run build:admin
npm run build
npm run test:e2e
```

Do not run `db:generate` as a final no-op validation that might create an unintended file; generate and inspect migrations deliberately in slices 2 and 9, then use `db:check` for drift.

## Completion criteria

- All 10 slices completed in order using red→green evidence.
- Dynamic Roles and normalized scoped grants are the only authorization model.
- System Owner is immutable, recoverable, and cannot be eliminated.
- Every admin route and object seam is catalog-authorized server-side.
- Cross-branch IDs do not disclose existence.
- No stale browser permission survives refresh failure.
- Authorization changes are transactional, concurrency-safe, reasoned where required, and indefinitely auditable.
- Legacy role strings, permission table, hardcoded Admin/HQ authorization, and old endpoints are absent.
- Fresh migration/seed/bootstrap rehearsal, unit tests, full Playwright suite, lint, and builds pass.
- API, feature, architecture, testing, deployment, rollout, and rollback documentation matches shipped behavior.
