# Marketplace Administration Context

The language used for staff identity, authorization, and branch-bounded administration in the marketplace back office.

## Language

**Admin User**:
A staff identity that can sign in to the administration application. Each Admin User has exactly one Role and, unless that Role is System Owner, one Home Branch; both assignments change as one validated unit.
_Avoid_: Customer, Client, member

**Inactive Admin User**:
An Admin User whose sign-in and active sessions are disabled while identity and audit attribution are retained. Reactivation is a validated user edit.
_Avoid_: deleted user, archived role

**Role Assignment**:
The pairing of an Admin User with one Role and the required Home Branch. User editing authority may assign existing Roles within the actor's Authorization Ceiling without granting authority to revise those Roles.
_Avoid_: permission edit, role inheritance

**Role**:
A job function with an immutable identity, an editable unique display name, and a set of Permission Grants. Each Admin User has one Role; HQ and Admin are initial Roles, and authorized administrators may create more.
_Avoid_: user type, account type

**Archived Role**:
A previously usable Role retained for history but unavailable for assignments or authorization. A Role can be archived only after it has no active Admin Users and may later be restored after policy validation.
_Avoid_: deleted role, inactive permission

**System Owner**:
A visible, protected Role used for recovery and ordinary sign-in. Its authority cannot be weakened; multiple Admin Users may hold it, but the final System Owner cannot be demoted or deleted. The first Owner is bootstrapped only while no Owner exists; later Owners are assigned by an active Owner.
_Avoid_: HQ, super admin

**Initial Roles**:
The System Owner, HQ, and Admin Roles supplied by the product. System Owner has immutable full access; HQ starts with editable all-branch access; Admin starts with least-privilege branch operations and no global product re-sync. HQ and Admin remain available but their display details and grants may change.
_Avoid_: hardcoded login types, permanent HQ superuser

**Permission Catalog**:
The application-defined set of Modules and Actions that Roles may be granted, including a dedicated Roles Module. Administrators may combine catalog entries into Roles but cannot invent unenforced permissions.
_Avoid_: dynamic endpoint, free-form permission

**Role Administration**:
The delegable authority to view, create, change, archive, and restore Roles through the Roles Module. Role viewers can inspect every Role for internal transparency, while mutation remains bounded by the Authorization Ceiling. HQ receives this authority initially; it is not defined by the Role's name.
_Avoid_: HQ-only page, hardcoded role gate

**Authorization Ceiling**:
The rule that a non-Owner administrator can manage only Roles whose current and proposed Permission Grants are contained within that administrator's own access. The System Owner is the recovery exception.
_Avoid_: role-manager superuser, implicit escalation

**Self-Role Protection**:
The rule that a non-Owner administrator cannot change the Role currently assigned to them or change that Role's definition.
_Avoid_: self-demotion confirmation

**Permission Grant**:
An allowance for one Role to perform one supported Action in one Module with a defined Branch Scope. Each module exposes only Actions backed by real behavior, and a missing grant means access is denied.
_Avoid_: access flag, role check

**Permission Coverage**:
The invariant that view access must cover every edit or delete grant in the same Module. All-branch edit/delete requires all-branch view; own-branch edit/delete requires at least own-branch view.
_Avoid_: headless mutation grant

**Role Revision**:
One coherent, versioned change to a Role's identity details and complete grant set. A revision is accepted atomically or rejected when based on stale role state, and reductions disclose their affected Admin Users before confirmation.
_Avoid_: per-switch save, partial matrix update

**Authorization Change**:
An immutable, attributable record of creating, revising, archiving, restoring, assigning, or deactivating authorization subjects, including the target, policy version, reason, and complete before/after difference. A reason is mandatory when access is reduced, a Role is archived, an Admin User is demoted, or an Admin User is deactivated.
_Avoid_: console message, mutable activity entry

**Role Clone**:
An optional starting copy of another Role's Permission Grants when creating a Role. Without a selected source, a new Role starts with no access.
_Avoid_: inherited role, default Admin access

**Current Policy**:
The latest Role, assignment, and Permission Grant state used for every new request, including requests from Admin Users whose sessions predate a policy change.
_Avoid_: login-time permission snapshot, stale role cache

**No-Access State**:
The safe signed-in state for an Admin User whose Role has no view grant. It exposes no administrative data while retaining account recovery actions such as changing password and signing out.
_Avoid_: failed login, silent redirect loop

**Home Branch**:
The single branch assigned to every Admin User except a System Owner. It supplies the trusted branch identity used by own-branch Permission Grants even when the user's current grants are all-branch; becoming operationally inactive does not erase that relationship or historical scope.
_Avoid_: selected branch, active branch

**Branch Scope**:
The boundary attached independently to a Permission Grant for branch-owned data: either the Admin User's Home Branch or all branches.
_Avoid_: role scope, UI filter

**Global Module**:
A Module whose data has no branch ownership. Its Actions are either not granted or granted globally; own-branch scope is not offered.
_Avoid_: all-branch module, branchless scope

**Product Scope**:
Own-branch product visibility is limited to products carried by the Home Branch and its stock. Operations that change the shared Jubelio-backed product master require all-branch scope.
_Avoid_: branch-owned product master

**Customer Directory**:
The global view of storefront customers. A customer is not owned by a branch, even when the customer's orders belong to different branches.
_Avoid_: branch customer

**User Directory**:
The global view of Admin Users. User administration does not acquire branch ownership from an Admin User's Home Branch.
_Avoid_: branch-owned user list

**Branch Administration**:
Administration of branch records. Own-branch scope permits viewing and editing the Home Branch; creating or deleting a branch requires all-branch scope.
_Avoid_: self-delete branch, own-branch creation

**Branch Analytics**:
Operational aggregates whose orders, revenue, recent activity, and distinct transacting customers are limited to the Admin User's Home Branch. All-branch analytics aggregate the whole business.
_Avoid_: globally filtered dashboard

**Audit Event**:
An immutable record of an attributable administrative or system action with explicit branch context when the affected data belongs to a branch. Own-branch access excludes global and system-wide events.
_Avoid_: debug log, mutable history

**Footer Module**:
The Global Module governing storefront footer configuration and its link destinations.
_Avoid_: HQ-only footer

**Managed Media**:
An uploaded asset authorized through the Module that owns its purpose, rather than through a standalone or authentication-only upload privilege.
_Avoid_: generic admin upload

**Authorized Branch**:
The branch target established from current server-side policy. Own-branch access is pinned to the Admin User's Home Branch; all-branch access may explicitly select a branch. An object outside the Authorized Branch is presented as not found rather than disclosed as forbidden.
_Avoid_: client-supplied ownership, active branch session

**Pickup Verification**:
The physical confirmation that an order was collected at its branch. It always requires the order branch to equal the Admin User's Home Branch, even when the Role has all-branch Order editing.
_Avoid_: remote HQ pickup, all-branch pickup override

**Edit Action**:
The Action that permits modifying data and, where scope can authorize a new target, creating data in a Module. Creating a branch is an explicit all-branch operation.
_Avoid_: update-only permission
