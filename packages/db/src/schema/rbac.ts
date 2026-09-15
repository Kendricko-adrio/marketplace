import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  unique,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

import { roleNameNormalizedSql } from "../rbac/catalog";

// =========================================================
// RBAC: dynamic Roles + normalized scoped Permission Grants
// =========================================================
// See docs/adr/0001-application-owned-hybrid-rbac.md and
// docs/features/rbac.md. The Permission Catalog (module/action/scope
// combinations) is code-owned in packages/db/src/rbac/catalog.ts; these
// tables store Role combinations of catalog entries. Missing grants deny.
//
// `admin_role.name` is case-insensitively unique across active AND archived
// Roles via a unique expression index on the normalized (lowercased,
// whitespace-collapsed) name.
export const adminRoles = pgTable(
  "admin_role",
  {
    id: text("id").primaryKey(),
    // Machine key for system Roles (system_owner | hq | admin); null for
    // runtime-created custom Roles.
    key: text("key").unique(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    // Optimistic-concurrency version, bumped on every mutation.
    version: integer("version").notNull().default(1),
    // Set when the Role is archived (soft-deleted); null while active.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Globally case-insensitive unique Role Name, including archived Roles.
    // Canonical normalization (trim + whitespace collapse + lowercase —
    // identical to catalog.ts normalizeRoleName). 0017 shipped an untrimmed
    // expression; 0018 recreates the index with THIS canonical form.
    uniqueIndex("admin_role_name_normalized_unique").on(
      roleNameNormalizedSql(t.name)
    ),
    // Normalized Role Name rules: 2–64 characters (see catalog.ts).
    check(
      "admin_role_name_length_check",
      sql`char_length(regexp_replace(btrim(${t.name}), '\\s+', ' ', 'g')) between 2 and 64`
    ),
  ]
);

// One normalized row per (role, module, action) with an explicit scope.
// Branch-aware modules require own_branch | all_branches; global modules
// are granted globally (scope 'global' or null). Absence denies.
export const adminRoleGrants = pgTable(
  "admin_role_grant",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id")
      .notNull()
      .references(() => adminRoles.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    action: text("action").notNull(), // view | edit | delete
    // 'own_branch' | 'all_branches' for branch-aware actions; 'global' (or
    // null) for global actions.
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("admin_role_grant_tuple_unique").on(t.roleId, t.module, t.action),
    check(
      "admin_role_grant_action_check",
      sql`${t.action} in ('view', 'edit', 'delete')`
    ),
    check(
      "admin_role_grant_scope_check",
      sql`${t.scope} is null or ${t.scope} in ('own_branch', 'all_branches', 'global')`
    ),
    // Scope shape per module kind: branch-aware modules require an explicit
    // branch scope; global modules require global scope (or none).
    check(
      "admin_role_grant_module_scope_shape_check",
      sql`(
        ${t.module} in ('products', 'orders', 'notifications', 'branches', 'analytics', 'audit_log')
        and ${t.scope} in ('own_branch', 'all_branches')
      ) or (
        ${t.module} in ('customers', 'homepage', 'pages', 'users', 'roles', 'footer')
        and (${t.scope} = 'global' or ${t.scope} is null)
      )`
    ),
  ]
);

export const adminRolesRelations = relations(adminRoles, ({ many }) => ({
  grants: many(adminRoleGrants),
}));

export const adminRoleGrantsRelations = relations(adminRoleGrants, ({ one }) => ({
  role: one(adminRoles, {
    fields: [adminRoleGrants.roleId],
    references: [adminRoles.id],
  }),
}));