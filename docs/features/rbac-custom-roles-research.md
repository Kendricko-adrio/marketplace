# Research: Custom Admin Roles and Branch-Scoped Authorization

**Research date:** 2026-09-08

**Scope:** Admin application only (`apps/admin`); storefront authentication remains separate.

## Research question

How should the current two-role admin authorization model evolve so authorized staff can create roles such as **Marketing**, assign module-level `view` / `edit` / `delete` rights, and independently limit each right to the user's own branch or allow it across all branches?

## Executive summary

1. The current application is not yet a dynamic-role system. `users.role` and `permission.role` are free-text values without a role-definition table, while authentication, user management, layouts, APIs, sidebar labels, tests, and seeds explicitly assume only `admin` and `hq`.[^code-auth-schema][^code-auth-config][^code-permission-schema]
2. Runtime-created roles fit standard RBAC: users are assigned roles and roles are assigned operation/object permissions. NIST identifies users, roles, permissions, operations, and objects as the basic RBAC elements.[^nist-rbac]
3. “Own branch” versus “all branches” is an object-level condition, not role membership alone. It should be modeled as a hybrid policy: **RBAC grant + branch attribute/relationship predicate**. OWASP specifically notes that pure RBAC is weak for horizontal/object-level decisions and recommends ABAC/ReBAC where relationships or attributes determine access.[^owasp-abac]
4. The best fit for this repository is likely a first-class, database-backed application authorization model rather than adopting Better Auth's Organization plugin. Better Auth's Admin plugin custom roles are supplied in code, while its runtime role CRUD belongs to Organization dynamic access control and is scoped by `organizationId` / active organization.[^ba-admin][^ba-org] This repository has one internal admin realm and already models branches as business entities, not Better Auth organizations.
5. A safe target should retain a protected bootstrap role (currently HQ), keep the permission vocabulary code-owned, deny missing grants by default, evaluate authorization on every server request, and push branch predicates into database queries or object checks—not merely hide UI controls.[^owasp-default][^owasp-every-request][^owasp-location]
6. These findings were subsequently worked through in a `grill-with-docs` design session. Settled terminology is recorded in [`CONTEXT.md`](../../CONTEXT.md), the architecture choice in [ADR 0001](../adr/0001-application-owned-hybrid-rbac.md), and the remaining frontier in [the next-session handoff](../../.agents/rbac-new-handoff.md).

## 1. Current repository facts

### 1.1 Roles are labels, not domain records

- `users.role` is `text`, defaults to `admin`, and is documented in source as `admin | hq`; `users.branchId` is a nullable FK with `ON DELETE RESTRICT`.[^code-auth-schema]
- There is no `roles` table and no FK from a user to a role definition.
- `permission` stores a role **string**, module string, and three booleans. Uniqueness is `(role, module)`, not a role ID FK.[^code-permission-schema]
- The fixed module vocabulary is currently `products`, `orders`, `customers`, `branches`, `homepage`, `pages`, `users`, and `notifications`; the action vocabulary is `view | edit | delete`. “Edit” currently also means create.[^code-permission-schema][^current-rbac-doc]

Consequence: inserting `marketing` into `permission.role` alone would not make it a valid login role, selectable user role, protected role-management subject, or consistently labelled role.

### 1.2 Authentication rejects a new role today

The admin Better Auth instance is version **1.6.29** and currently loads only the username plugin. Its own `user.additionalFields.role` declaration is the literal type list `["admin", "hq"]`, and its session-create hook rejects every other role with `INVALID_USER_TYPE`.[^code-auth-config][^code-auth-client]

Therefore, a database-only `marketing` row would still be unable to create an admin session.

### 1.3 HQ is an application-coded superuser

- `getPermissionsForRole("hq")` bypasses the database and returns `HQ_PERMISSIONS`, where every current module/action is allowed.[^code-permission-resolution][^code-hq]
- The roles page and permission API compare `session.user.role` directly with `hq`; only the literal `admin` role can be edited.[^code-roles-layout][^code-permission-api]
- User deletion protects the last literal HQ account, and self-demotion logic also depends on the literal.[^code-user-detail-api]

This is useful anti-lockout behavior, but it must become an explicit protected-system-role invariant rather than remain scattered string comparisons.

### 1.4 Branch scope is separate and inconsistently resolved

The generic branch helper currently resolves:

```text
hq                  -> all branches
non-hq + branchId   -> own branch
non-hq + no branch  -> error
```

This behavior is encoded in `getBranchScope` and tested directly.[^code-auth-guard][^test-auth-guard]

However, `getNotificationScope` differs: **any** user without a branch receives all-branch scope. That is harmless only while the login hook admits exactly `admin | hq` and layouts reject unassigned admins; it becomes a privilege-escalation risk once arbitrary role names exist.[^code-notification-scope]

Branch enforcement currently exists mainly in:

- orders: list predicates and detail/action ownership checks;
- products: catalog availability and stock rows/totals;
- notifications: list and mutation predicates.

Several authenticated areas are not branch-filtered today, including analytics, audit log, user listing, branch listing, customer history, CMS, and upload flows. Whether each becomes branch-aware is a product decision, not something the current generic role matrix can infer.[^code-orders-list][^code-products-list][^code-notifications][^code-users-list]

### 1.5 Hardcoded assumptions are broad

A dynamic-role implementation must replace or deliberately preserve assumptions in at least these seams:

- auth role typing and session admission;
- `AuthContext` and `withAuth`'s default role allowlist;
- top-level branch assignment gate;
- role-management page/API;
- user create/edit schemas and UI;
- sidebar `hqOnly` items and labels;
- HQ-only footer/link-destination routes;
- orders and notification UI flags;
- last-HQ protections;
- seeds, unit tests, and Playwright saved sessions.

The repository already has useful public test seams for permission resolution, branch-scope resolution, branch-stock filtering, notification scope, role-page access, `/permissions/me`, and branch-scoped order/product behavior.[^test-permissions][^test-rbac-e2e]

### 1.6 Documentation drift already exists

`docs/features/rbac.md` says a null branch receives all scope and that the user-branch FK uses `SET NULL`. Current source instead throws for a branchless non-HQ user and uses `ON DELETE RESTRICT`.[^current-rbac-doc][^code-auth-schema][^code-auth-guard]

The redesign should correct this drift as part of the same delivery, not carry it forward.

## 2. Standards and security findings

### 2.1 What belongs in RBAC

NIST describes RBAC administration as assigning users to roles and assigning privileges to roles. The current standard's reference model includes users, roles, permissions, operations, and objects; its administrative specification includes role/assignment/permission management.[^nist-rbac]

For this application, the direct RBAC concepts are:

```text
User -> Role -> Grant(module, action)
```

Examples:

```text
Marketing -> homepage:view
Marketing -> homepage:edit
Branch Operator -> orders:view
```

Roles may be runtime data while the valid module/action vocabulary remains code-owned. Keeping that vocabulary fixed is important because every permission still needs a corresponding server enforcement point.

### 2.2 What belongs in branch scope

An “own branch” rule evaluates trusted attributes/relationships at request time:

```text
subject.homeBranchId == resource.branchId
```

That is ABAC when expressed as subject/object attribute equality, and it can be described as ReBAC when expressed as both subject and resource belonging to the same branch.[^owasp-abac]

The safe decision rule is:

```text
ALLOW only when:
  role grants (module, action)
  AND
  the grant's branch-scope predicate passes
otherwise DENY
```

This avoids encoding branch IDs into role names such as `marketing-jakarta`, which would cause role explosion and make permissions harder to audit.[^owasp-abac]

### 2.3 Required enforcement properties

OWASP's first-party Authorization Cheat Sheet supports these invariants:

- **least privilege:** grant only operations needed for the job and periodically review them;[^owasp-least]
- **deny by default:** no matching allow means deny, including new modules and missing rows;[^owasp-default]
- **validate every request:** one missed route can compromise confidentiality or integrity;[^owasp-every-request]
- **server-side authority:** client checks may improve UX but must never decide access;[^owasp-location]
- **specific-object checks:** knowing or altering a resource ID must not bypass ownership/scope checks;[^owasp-idor]
- **automated unit and integration tests:** test default denial, failure handling, and attribute policies.[^owasp-tests]

The existing `withPermission` direction is compatible with this guidance, but its output must include data scope and every affected handler must actually consume that scope.

## 3. Better Auth fit analysis

### 3.1 Current application does not use Better Auth authorization plugins

The admin auth configuration uses Better Auth for identity/session handling plus the username plugin. The role matrix, guards, user CRUD, and role page are application code.[^code-auth-config][^code-permission-resolution]

That separation means dynamic authorization can be redesigned without moving user authentication to a different Better Auth plugin.

### 3.2 Admin plugin custom roles are code-defined

Better Auth Admin plugin documentation creates an access-control statement, constructs role objects with `ac.newRole(...)`, and passes those roles to both the server and client plugin configuration.[^ba-admin] Its documented Admin endpoints assign configured roles to users, but the documented custom-role flow does not provide database-backed application role-definition CRUD.

This is a mismatch for “users can add a Marketing role at runtime.”

### 3.3 Organization plugin dynamic roles are runtime data, but organization-scoped

Better Auth Organization dynamic access control explicitly:

- creates roles at runtime;
- persists them in `organizationRole`;
- requires `organizationId` or defaults to the active organization;
- assigns roles on organization membership records;
- requires asynchronous/server-backed `hasPermission` for dynamic roles;
- adds organization/member/invitation tables and active-organization session fields.[^ba-org]

It is a strong fit when each authorization tenant is a Better Auth organization. It is not automatically a fit for this system's requirement, because branches are already inventory/order entities and the requested **all branches** grant crosses those entities. Adopting it would introduce organization membership/active-context semantics that the current single-realm admin app does not otherwise need.

### 3.4 Research recommendation

Unless the client intends each branch to become a true tenant/organization with multi-membership and active-organization switching, retain Better Auth for authentication and build the dynamic role model in the shared application schema.

This is not a recommendation to trust a custom mechanism casually. The authorization vocabulary, central resolver, scope predicates, privilege-escalation rules, audit events, and tests must be explicit and security-reviewed.

## 4. Candidate target model (to validate through grilling)

This is a research-backed starting point, **not yet an approved design**.

### 4.1 First-class roles

```text
admin_role
- id (immutable UUID/text PK)
- key (stable unique machine key)
- name (editable unique display name)
- description
- is_system
- is_superuser
- created_at / updated_at

user
- role_id -> admin_role.id
- branch_id -> branch.id (home/assigned branch)
```

Using an immutable role ID avoids breaking assignments and grants when “Marketing” is renamed.

### 4.2 Normalized grants

A normalized grant avoids contradictory states such as `canView=false` plus `viewScope=all`:

```text
admin_role_grant
- role_id
- module
- action       // view | edit | delete
- scope        // own_branch | all_branches
- unique(role_id, module, action)

absence of row = no access
```

An alternative is one row per role/module with three enum columns:

```text
view_scope / edit_scope / delete_scope
= none | own_branch | all_branches
```

Both encode the same policy. The normalized form is easier to extend with a future `create`, `approve`, or `export` action; the wide form is closer to the current UI and schema. This trade-off requires an explicit decision.

### 4.3 Fixed permission vocabulary

Users should be able to create **roles and grant combinations**, not arbitrary module/action strings. New modules/actions need code, server guards, data-scope rules, tests, and documentation before they can be granted.

### 4.4 Protected bootstrap authority

A system role replacing the scattered HQ literals should be:

- seeded and non-deletable;
- guaranteed full access in a way that cannot be removed by an ordinary matrix edit;
- required to have at least one active user;
- the only bootstrap authority until delegated role-management rules are explicitly designed.

Whether its display name can be changed, whether another role may manage roles, and whether superuser bypass lives in code or data are open decisions.

### 4.5 Central authorization result

Instead of separate permission and branch helpers, a server resolver should produce one decision context:

```text
authorize(userId, module, action)
  -> denied
  -> allowed with own-branch scope and branchId
  -> allowed with all-branch scope
```

List queries consume the returned SQL scope; detail/mutation handlers verify the target object's branch before reading or changing it. Client permission data mirrors the result only for navigation/control visibility.

## 5. Module-scope analysis

The phrase “data di branch-nya atau all branch” is unambiguous for some modules but not all:

| Module / area | Current ownership signal | Decision still needed |
|---|---|---|
| Orders | `orders.branchId` | Straightforward own/all for view/edit; define delete if introduced/used. |
| Notifications | `notifications.branchId` | Straightforward own/all; unify branchless behavior. |
| Products | global product master + per-branch `branch_stock` | Does own-scope cover stock only, visibility of carried products, or editing global product metadata too? |
| Customers | customer is global; orders have branches | Is a customer “own” if they have any order at the user's branch, only latest order there, or are customers always global? |
| Users | admin user has `branchId` | Can own-scope roles manage users at their branch? Can they assign roles whose grants exceed their own? |
| Branches | each row is itself a branch | Does own mean view/edit own branch; is delete-own ever safe? |
| Homepage / Pages / Footer | global content, no branch owner | Scope may be `global` only; “own branch” has no data predicate unless content becomes branch-specific. |
| Analytics / Audit Log / Upload | currently outside the main module matrix or role-only | Must either gain explicit modules/scopes or remain protected system capabilities. |
| Roles | no current module entry | Needs a dedicated management capability or protected-system-only rule. |

A UI must not offer “own branch” for a resource that cannot enforce it. Unsupported combinations should be absent or disabled, not silently interpreted as all branches.

## 6. Migration implications

A safe rollout will need a staged data migration rather than changing role strings in place:

1. Introduce role definitions and the new grant representation in `packages/db/src/schema/`.
2. Seed/backfill protected HQ and ordinary Admin definitions.
3. Backfill user assignments and convert existing permission rows.
4. Add FK/uniqueness/check constraints only after data is valid.
5. Change auth/session typing and guards to accept valid database-backed admin users.
6. Migrate every server authorization seam before enabling role CRUD in the UI.
7. Remove legacy role-string and boolean paths only after parity tests pass.

The exact compatibility strategy (dual-read/dual-write versus one maintenance-window migration) depends on deployment tolerance and must be decided during grilling.

## 7. Principal risks

1. **Horizontal privilege escalation:** an own-branch user manipulates an ID or query parameter to reach another branch.
2. **Role-management escalation:** a user creates or assigns a role with permissions broader than they possess.
3. **Lockout:** the last protected superuser is demoted/deleted or the protected role loses role-management access.
4. **Branchless fail-open:** a missing `branchId` becomes all-branch access, as the current notification helper would do.
5. **Partial migration:** custom roles can authenticate but hardcoded `admin`/`hq` checks hide pages or deny APIs inconsistently.
6. **Unsupported scope:** UI stores own-branch scope for global data but the backend has no enforceable ownership predicate.
7. **Stale authorization:** role or grant changes do not take effect consistently across active sessions.
8. **Incomplete endpoint coverage:** analytics/audit/CMS/helper endpoints remain outside the new policy map.
9. **Unsafe deletion:** deleting an assigned role leaves users orphaned or silently falls back to excess access.
10. **Unlogged policy changes:** an authorization change cannot be attributed during an incident or audit.

## 8. Research-time decision checklist

> **Status:** The questions below were the initial research frontier and have now been answered. They are retained as research traceability, not as the current open list. See [`CONTEXT.md`](../../CONTEXT.md) for settled language and [`.agents/rbac-new-handoff.md`](../../.agents/rbac-new-handoff.md) for the small remaining frontier.

The detailed implementation plan originally depended on these product decisions:

1. Is HQ a permanently protected superuser, or should even HQ permissions be editable?
2. Who may create/edit/delete roles: protected HQ only, or any role granted a dedicated role-management capability?
3. Does each user have exactly one role or multiple roles?
4. Is every non-superuser assigned exactly one home branch, even if all of their current grants are all-branch?
5. Is scope selected independently for each action (`orders:view=all`, `orders:edit=own`), once per module, or once per role?
6. Does `edit` continue to include create, or should `create` become a distinct action?
7. How should role deletion work when users are assigned: block, require reassignment, or archive?
8. Must role/grant changes affect active sessions immediately?
9. What does own-branch mean for products, customers, users, and branches?
10. Are global resources and currently role-only routes brought into the permission vocabulary now?
11. Is a maintenance-window migration acceptable, or is a backward-compatible staged rollout required?
12. What audit history and approval controls are required for role, grant, and assignment changes?

## 9. Sources

### External primary / owner sources

[^nist-rbac]: NIST Computer Security Resource Center, **Role Based Access Control**, including the current-standard summary and core elements: https://csrc.nist.gov/projects/role-based-access-control#rbac-standard
[^owasp-least]: OWASP Cheat Sheet Series, **Authorization — Enforce Least Privileges**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#enforce-least-privileges
[^owasp-default]: OWASP Cheat Sheet Series, **Authorization — Deny by Default**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#deny-by-default
[^owasp-every-request]: OWASP Cheat Sheet Series, **Authorization — Validate the Permissions on Every Request**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#validate-the-permissions-on-every-request
[^owasp-abac]: OWASP Cheat Sheet Series, **Authorization — Prefer Attribute and Relationship Based Access Control over RBAC**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#prefer-attribute-and-relationship-based-access-control-over-rbac
[^owasp-idor]: OWASP Cheat Sheet Series, **Authorization — Ensure Lookup IDs Are Not Accessible Even When Guessed**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#ensure-lookup-ids-are-not-accessible-even-when-guessed-or-cannot-be-tampered-with
[^owasp-location]: OWASP Cheat Sheet Series, **Authorization — Verify Checks Are Performed in the Right Location**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#verify-that-authorization-checks-are-performed-in-the-right-location
[^owasp-tests]: OWASP Cheat Sheet Series, **Authorization — Create Unit and Integration Test Cases**: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html#create-unit-and-integration-test-cases-for-authorization-logic
[^ba-admin]: Better Auth official docs, **Admin plugin — Access Control / Custom Permissions**: https://www.better-auth.com/docs/plugins/admin#custom-permissions
[^ba-org]: Better Auth official docs, **Organization plugin — Dynamic Access Control**: https://www.better-auth.com/docs/plugins/organization#dynamic-access-control ; official source implementation conditionally registering dynamic role endpoints and schema: https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/organization/organization.ts

### Repository primary sources

[^code-auth-schema]: `packages/db/src/schema/auth.ts:87-105`
[^code-permission-schema]: `packages/db/src/schema/permissions.ts:5-55`
[^code-auth-config]: `apps/admin/src/lib/auth.ts:1-8,30-34,74-111`
[^code-auth-client]: `apps/admin/src/lib/auth-client.ts:1-7`
[^code-permission-resolution]: `apps/admin/src/lib/permissions.ts:13-35,69-96`
[^code-hq]: `apps/admin/src/lib/permissions-shared.ts:3-24`
[^code-roles-layout]: `apps/admin/src/app/admin/roles/layout.tsx:8-22`; `apps/admin/src/app/admin/roles/page.tsx:10-45`
[^code-permission-api]: `apps/admin/src/app/api/admin/permissions/route.ts:8-114`
[^code-user-detail-api]: `apps/admin/src/app/api/admin/users/[id]/route.ts:56-61,100-156,211-226`
[^code-auth-guard]: `apps/admin/src/lib/auth-guard.ts:7-38,43-130`
[^code-notification-scope]: `apps/admin/src/lib/notifications.ts:5-30`
[^code-orders-list]: `apps/admin/src/app/api/admin/orders/route.ts:15-167`; `apps/admin/src/app/api/admin/orders/[id]/route.ts:16-151`
[^code-products-list]: `apps/admin/src/app/api/admin/products/route.ts:20-202`; `apps/admin/src/app/api/admin/products/[id]/route.ts:22-182`
[^code-notifications]: `apps/admin/src/lib/notifications.ts:27-30,148-150,231-290`
[^code-users-list]: `apps/admin/src/app/api/admin/users/route.ts:12-266`
[^current-rbac-doc]: `docs/features/rbac.md:1-164`
[^test-auth-guard]: `apps/admin/src/lib/auth-guard.test.ts:4-66`
[^test-permissions]: `apps/admin/src/lib/permissions.test.ts:20-72`; `apps/admin/src/lib/branch-stock.test.ts:103-215`; `apps/admin/src/lib/notifications.test.ts:4-27`
[^test-rbac-e2e]: `e2e/admin/rbac.spec.ts:6-65`; `e2e/admin/products.spec.ts:18-284`
