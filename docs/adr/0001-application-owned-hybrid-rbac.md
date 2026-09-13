---
status: accepted
---

# Application-owned hybrid RBAC for admin authorization

The admin app will keep Better Auth responsible for identity and sessions while Marketplace owns dynamic Roles, normalized Permission Grants, and per-request branch policy in its shared database model. Authorization combines RBAC module/action grants with server-derived Home Branch attributes, is enforced by centralized application guards plus scoped Drizzle queries/object checks, and retains a code-owned immutable System Owner bypass. Better Auth Organization dynamic access control was rejected because its roles are organization-membership scoped and would introduce an active-organization model that does not match the existing single admin realm; PostgreSQL RLS was deferred because propagating request identity safely through the pooled connection layer would add substantial migration and operational complexity without matching the repository's current enforcement pattern.
