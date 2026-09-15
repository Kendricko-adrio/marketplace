# New RBAC — Next-Session Handoff

## Status

Research and the full `grill-with-docs` design tree are complete. The user confirmed the final shared understanding. No RBAC production code or schema has been implemented yet, and the detailed implementation plan is still pending planner execution.

Current branch: `feature/rbac-new`

Canonical reading order for the next session:

1. `AGENTS.md`
2. `apps/admin/AGENTS.md`
3. `CONTEXT.md` — canonical settled domain language
4. `docs/features/rbac-custom-roles-research.md` — primary-source research and current-code inventory
5. `docs/adr/0001-application-owned-hybrid-rbac.md` — accepted architecture decision
6. `docs/features/rbac.md` — current/legacy behavior to replace
7. This handoff

Before touching files, run `git status --short`. The following unrelated storefront changes existed before this RBAC session and must not be staged, overwritten, reverted, or included in RBAC commits:

- `apps/store/src/app/checkout/page.tsx`
- `apps/store/src/components/Header.tsx`
- `docs/features/order-flow.md`
- `e2e/store/checkout.spec.ts`

## Skills and process

1. Load the real `grilling` and `domain-modeling` skills before asking more questions.
2. Ask each remaining frontier round only through `ask_user_question`, with prerequisites respected.
3. Update `CONTEXT.md` immediately when additional domain terms are settled.
4. Do not implement yet. When the frontier is empty, tell the user the shared understanding is complete and ask for confirmation.
5. Then invoke the `planner` subagent with the research, glossary, ADR, code inventory, and all confirmed decisions.
6. Save the detailed implementation plan as `.agents/rbac-new-plan.md`; do not overwrite the unrelated `.agents/plan.md`.
7. The plan must prescribe TDD red → green vertical slices and include unit + Playwright coverage, structured backend logging, schema/seed/migration work, API/feature/architecture/testing docs, and deployment/bootstrap instructions.
8. Before any later implementation session, load `tdd`, `nextjs`, `better-auth-best-practices`, and use Context7 for current APIs. Use `systematic-debugging` for every unexpected result.

## Settled decisions

### Architecture

- Better Auth remains responsible for admin authentication and sessions.
- Marketplace owns dynamic authorization in its shared schema and admin server code.
- Do not adopt Better Auth Organization dynamic access control.
- Do not introduce PostgreSQL RLS in this change.
- Use centralized server authorization plus scoped Drizzle predicates/object checks.
- `users.role` is replaced by an immutable `roleId` FK; do not retain dual role fields after cutover.
- Policy is resolved from the database on every request; role/grant/assignment changes apply on the next request.

### Role model and bootstrap

- One Role per Admin User.
- Runtime-created custom Roles are supported.
- System Owner, HQ, and Admin are initial roles.
- System Owner is visible but immutable, has a code-owned full-access/all-branch bypass, and is not represented by editable grant rows.
- Multiple System Owners are allowed, but at least one must remain.
- Only an existing System Owner may assign another Owner.
- Initial Owner is created through a one-time CLI that refuses to run once an Owner exists; no default production credential or bootstrap web endpoint.
- Every non-Owner Admin User, including HQ and global-only roles such as Marketing, always has exactly one Home Branch.
- HQ and Admin cannot be archived; their display name, description, and grants may be edited.
- Custom role names are editable while internal identity stays immutable.
- Custom roles may be archived only after no active users remain and may later be restored after validation.
- A new role starts deny-all or from an optional clone; the draft stays client-side and is created atomically only on final save.

### Grants and governance

- Permission modules/actions are a fixed, code-owned catalog. Clients create role combinations, not new permission names.
- Store one normalized grant per `(roleId, module, action)` with a scope; absence means deny.
- Scope is independently chosen per action.
- Branch-aware actions use `own_branch` or `all_branches`; global actions use none/global only.
- `edit` includes create when creation can be authorized. Creating a new Branch is an explicit all-branch operation.
- Only actions backed by real application behavior appear in the catalog.
- View scope must cover edit/delete scope in the same module.
- Add a global Roles module. `view` lists all roles/matrices for transparency, `edit` creates/revises/restores, and `delete` archives.
- A non-Owner role manager may manage only roles whose current and proposed grants are both no broader than the actor's own effective grants.
- A non-Owner cannot change their own role assignment or revise the role currently assigned to them.
- `users:edit` may assign an existing role without `roles:edit`, but only within the actor's authorization ceiling.
- Role + Home Branch assignment is one validated transaction.
- Role revisions save the complete identity/grant draft atomically with optimistic version checking.
- Permission reductions show the grant diff and affected users before explicit confirmation.

### Final permission catalog baseline

Branch-aware:

| Module | Supported actions/scopes |
|---|---|
| Products | `view: own/all`; `edit: all` for global Jubelio re-sync; no delete |
| Orders | `view: own/all`; `edit: own/all`; no delete |
| Notifications | `view/edit/delete: own/all` |
| Branches | `view/edit: own/all`; create requires edit-all; `delete: all` |
| Analytics | `view: own/all` |
| Audit Log | `view: own/all` |

Global:

| Module | Supported actions |
|---|---|
| Customers | `view` only |
| Homepage | `view/edit/delete` |
| Pages | `view/edit/delete` |
| Users | `view/edit/delete` |
| Roles | `view/edit/delete` (`delete` means archive) |
| Footer | `view/edit` |

Uploads are not a standalone module. Upload/delete authorization follows the validated owning purpose/folder (for example Products or Homepage).

### Branch semantics

- Own scope is always pinned server-side to the user's Home Branch; client `branchId` cannot override it.
- All scope may expose an explicit branch filter/target selector.
- Cross-branch object IDs return 404 to avoid disclosing existence; generic module denial remains 403.
- Product own-view means only products carried by the Home Branch and branch-scoped stock. Global product re-sync requires edit-all.
- Customer Directory is global; customers do not become branch-owned through orders.
- User Directory is global; users are not filtered by Home Branch.
- Branch own-scope permits viewing/editing the Home Branch; create/delete requires all scope.
- Analytics own-scope filters order/revenue/recent activity to Home Branch and counts distinct customers who transacted there.
- Audit own-scope shows only branch-tagged events for Home Branch; all-scope also sees global/system events.
- A Home Branch becoming inactive does not erase user scope or historical access.
- Pickup verification remains a physical own-branch-only operation, even for a user with Orders edit-all.

### UX and lifecycle

- Role management UI is a searchable role list plus a dedicated detail/editor page, not one unbounded matrix.
- A signed-in user with no view grants sees a safe No-Access page with only account recovery/logout actions.
- Browser permission state revalidates on navigation/window focus and after a 403; no forced logout and no realtime socket are required for ordinary policy changes.
- Users are soft-deactivated rather than hard-deleted; deactivation revokes sessions and preserves audit attribution. Reactivation is a validated user edit.

### Audit and migration

- Extend the existing `audit_log` rather than creating a separate RBAC audit table.
- Authorization changes store actor, target, policy version, branch context where applicable, and full before/after diff.
- A reason is mandatory for permission/scope reductions, role archive, user demotion, and user deactivation.
- Preserve all product/branch/order/business data during migration.
- The product is not live and has no production admin users, so a maintenance-window cutover is acceptable; a zero-downtime dual-read/write design is unnecessary.
- Default grants: Owner full immutable; HQ starts full all-branch but editable; Admin starts with Product view-own, Orders view/edit-own, Notifications view/edit/delete-own, and no global product re-sync.

## Closed final design frontier

The user confirmed the final shared understanding with these decisions:

1. Inactive Admin Users retain their Role and Home Branch; email and username remain reserved; reactivation is a validated `users:edit` operation within the actor's Authorization Ceiling.
2. Audit Events and Authorization Changes are retained indefinitely and have no admin-facing delete operation.
3. Role Names are normalized and case-insensitively unique across active and archived Roles, use 2–64 Unicode letters/numbers plus spaces, hyphens, and underscores, and cannot use protected system names. Archived names are not reusable.
4. Custom Roles have no product-defined cap.
5. Archived Roles are hidden from the ordinary list behind an explicit filter. Restore opens a review draft and activates only after current-policy validation.
6. A failed browser policy refresh clears stale permission state and protected data/navigation, entering a Policy-Unavailable State with retry and account-recovery/logout actions.
7. Orders with no Branch appear only in all-branch analytics. Distinct customer counts include only customers with at least one Order in the authorized scope.
8. Home Branch reassignment Audit Events belong to both old and new Branches. Product synchronization and system-wide events are global.
9. Branch deletion is blocked while the Branch remains assigned as the Home Branch of any active or inactive Admin User.
10. The user confirmed the complete Owner, editable HQ, Marketing-homepage-only, branch order operator, permission reduction, deactivation, audit, policy-refresh, and cross-branch-ID scenarios.

The design frontier is empty. Do not ask more product questions unless planning uncovers a genuine contradiction. The next action is to invoke the `planner` subagent and save `.agents/rbac-new-plan.md`.

## Required plan structure after confirmation

The planner should produce vertical slices in this order:

1. Permission catalog and pure policy model/tests.
2. Shared DB schema, generated migration, seed defaults, and one-time Owner bootstrap CLI/tests.
3. Current-policy resolver, System Owner bypass, authorization ceiling, unified guard/scope types, and auth/session admission tests.
4. Role query/CRUD/revision/archive/restore APIs with optimistic concurrency, structured logs, and audit writes.
5. Dynamic User role/Home Branch assignment, soft-deactivation/reactivation, session revocation, and ceiling protections.
6. Role list/editor/clone/impact-confirmation UI plus No-Access page and client policy revalidation.
7. Branch-aware conversion of Products, Orders, Notifications, Branches, Analytics, and Audit Log at both list and object-mutation seams.
8. Global conversion of Customers, Homepage, Pages, Users, Roles, Footer, link destinations, and purpose-bound uploads.
9. Removal of every hardcoded `admin`/`hq` authorization branch and legacy permission schema path.
10. Full unit/E2E security matrix, migration/seed verification, docs, lint/build, and rollout/rollback checklist.

For every slice, require a failing public-seam test first, smallest green implementation, focused regression, structured backend logging, and documentation in the same slice.

## Suggested prompt for the next session

> Continue New RBAC planning on `feature/rbac-new`. The design frontier is closed and the user confirmed the shared understanding. Read `CONTEXT.md`, `docs/features/rbac-custom-roles-research.md`, `docs/adr/0001-application-owned-hybrid-rbac.md`, and `.agents/rbac-new-handoff.md`. Preserve unrelated working-tree changes. Do not implement. Invoke the `planner` subagent and write its complete TDD implementation plan to `.agents/rbac-new-plan.md`.
