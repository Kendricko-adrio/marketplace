import type { Grant, GrantScope } from "./catalog";

// =========================================================
// Initial Role seed defaults (pure — no DB imports)
// =========================================================
// Hand-derived from the confirmed design (.agents/rbac-new-handoff.md,
// docs/adr/0001-application-owned-hybrid-rbac.md):
// - System Owner: immutable code-owned full/all bypass, NO grant rows.
// - HQ: system Role (not archivable), starts full/all-branch, grants and
//   display details editable.
// - Admin: system Role (not archivable), starts least-privilege branch
//   operations: Products view-own; Orders view/edit-own; Notifications
//   view/edit/delete-own; NO global product re-sync and NO all-scope grant.

export interface SeedGrant {
  module: string;
  action: string;
  scope: GrantScope;
}

export const INITIAL_ROLE_KEYS = [
  "system_owner",
  "hq",
  "admin",
] as const;

export const HQ_SEED_GRANTS: SeedGrant[] = [
  // Branch-aware modules — full, all-branch
  { module: "products", action: "view", scope: "all_branches" },
  { module: "products", action: "edit", scope: "all_branches" },
  { module: "orders", action: "view", scope: "all_branches" },
  { module: "orders", action: "edit", scope: "all_branches" },
  { module: "notifications", action: "view", scope: "all_branches" },
  { module: "notifications", action: "edit", scope: "all_branches" },
  { module: "notifications", action: "delete", scope: "all_branches" },
  { module: "branches", action: "view", scope: "all_branches" },
  { module: "branches", action: "edit", scope: "all_branches" },
  { module: "branches", action: "delete", scope: "all_branches" },
  { module: "analytics", action: "view", scope: "all_branches" },
  { module: "audit_log", action: "view", scope: "all_branches" },
  // Global modules
  { module: "customers", action: "view", scope: "global" },
  { module: "homepage", action: "view", scope: "global" },
  { module: "homepage", action: "edit", scope: "global" },
  { module: "homepage", action: "delete", scope: "global" },
  { module: "pages", action: "view", scope: "global" },
  { module: "pages", action: "edit", scope: "global" },
  { module: "pages", action: "delete", scope: "global" },
  { module: "users", action: "view", scope: "global" },
  { module: "users", action: "edit", scope: "global" },
  { module: "users", action: "delete", scope: "global" },
  { module: "roles", action: "view", scope: "global" },
  { module: "roles", action: "edit", scope: "global" },
  { module: "roles", action: "delete", scope: "global" },
  { module: "footer", action: "view", scope: "global" },
  { module: "footer", action: "edit", scope: "global" },
];

export const ADMIN_SEED_GRANTS: SeedGrant[] = [
  { module: "products", action: "view", scope: "own_branch" },
  { module: "orders", action: "view", scope: "own_branch" },
  { module: "orders", action: "edit", scope: "own_branch" },
  { module: "notifications", action: "view", scope: "own_branch" },
  { module: "notifications", action: "edit", scope: "own_branch" },
  { module: "notifications", action: "delete", scope: "own_branch" },
];

export interface SeedRole {
  key: (typeof INITIAL_ROLE_KEYS)[number];
  name: string;
  isSystem: boolean;
  grants: SeedGrant[];
}

export const INITIAL_ROLE_SEED: readonly SeedRole[] = [
  {
    key: "system_owner",
    name: "System Owner",
    isSystem: true,
    grants: [], // code-owned full/all bypass — never stored as grant rows
  },
  {
    key: "hq",
    name: "HQ",
    isSystem: true,
    grants: HQ_SEED_GRANTS,
  },
  {
    key: "admin",
    name: "Admin",
    isSystem: true,
    grants: ADMIN_SEED_GRANTS,
  },
];

// Re-exported helper for callers that need typed Grant rows (e.g. the
// resolver); seed rows use the same shape.
export function seedGrantToGrant(grant: SeedGrant): Grant {
  return {
    module: grant.module as Grant["module"],
    action: grant.action as Grant["action"],
    scope: grant.scope,
  };
}