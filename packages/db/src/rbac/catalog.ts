import { sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";

// =========================================================
// RBAC: Permission Catalog (code-owned)
// =========================================================
// The fixed set of Modules and Actions that Roles may be granted.
// Clients create Role combinations from catalog entries; they cannot invent
// unenforced permissions. Only actions backed by real application behavior
// appear here. Missing grants deny.
//
// Branch-aware modules carry a Branch Scope per action (own_branch |
// all_branches). Global modules carry no scope — their actions are granted
// globally or not at all. Uploads are NOT a module: upload/delete
// authorization follows the validated owning purpose/folder (see the
// purpose map used by the upload route).

export const BRANCH_MODULES = [
  "products",
  "orders",
  "notifications",
  "branches",
  "analytics",
  "audit_log",
] as const;

export const GLOBAL_MODULES = [
  "customers",
  "homepage",
  "pages",
  "users",
  "roles",
  "footer",
] as const;

export type BranchModule = (typeof BRANCH_MODULES)[number];
export type GlobalModule = (typeof GLOBAL_MODULES)[number];
export type ModuleKey = BranchModule | GlobalModule;

export const ALL_MODULES: readonly ModuleKey[] = [
  ...BRANCH_MODULES,
  ...GLOBAL_MODULES,
];

export type ActionKey = "view" | "edit" | "delete";

export type BranchScope = "own_branch" | "all_branches";
export type GrantScope = BranchScope | "global";

export interface Grant {
  module: ModuleKey;
  action: ActionKey;
  scope: GrantScope;
}

// CATALOG[module][action] = list of allowed BranchScopes for branch modules;
// an empty array means a global action (scope "global" only); a missing
// action key means the module/action combination is not grantable at all.
export const CATALOG: {
  readonly [M in ModuleKey]: Partial<Record<ActionKey, readonly BranchScope[]>>;
} = {
  // Branch-aware modules
  products: {
    // View own (products carried by the Home Branch + branch-scoped stock)
    // or all. Global Jubelio re-sync is the only product edit and it is
    // all-branch only; there is no product delete.
    view: ["own_branch", "all_branches"],
    edit: ["all_branches"],
  },
  orders: {
    view: ["own_branch", "all_branches"],
    edit: ["own_branch", "all_branches"],
  },
  notifications: {
    view: ["own_branch", "all_branches"],
    edit: ["own_branch", "all_branches"],
    delete: ["own_branch", "all_branches"],
  },
  branches: {
    view: ["own_branch", "all_branches"],
    edit: ["own_branch", "all_branches"],
    // Create requires edit-all; deleting a Branch is an all-branch operation.
    delete: ["all_branches"],
  },
  analytics: {
    view: ["own_branch", "all_branches"],
  },
  audit_log: {
    view: ["own_branch", "all_branches"],
  },
  // Global modules
  customers: {
    view: [],
  },
  homepage: {
    view: [],
    edit: [],
    delete: [],
  },
  pages: {
    view: [],
    edit: [],
    delete: [],
  },
  users: {
    view: [],
    edit: [],
    delete: [],
  },
  roles: {
    // delete means archive.
    view: [],
    edit: [],
    delete: [],
  },
  footer: {
    view: [],
    edit: [],
  },
};

export function isBranchModule(module: ModuleKey): boolean {
  return (BRANCH_MODULES as readonly string[]).includes(module);
}

// =========================================================
// System Roles and protected Role Names
// =========================================================

export const SYSTEM_ROLE_KEYS = ["system_owner", "hq", "admin"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const SYSTEM_OWNER_KEY: SystemRoleKey = "system_owner";

// Normalized display names that cannot identify a custom Role. Seeded from
// the Initial Roles' display names ("System Owner", "HQ", "Admin").
export const PROTECTED_ROLE_NAMES: readonly string[] = [
  "system owner",
  "hq",
  "admin",
];

// =========================================================
// Role Name normalization / validation
// =========================================================
// Role Names are normalized and case-insensitively unique across active and
// archived Roles: trimmed, internal whitespace runs collapsed to single
// spaces, lowercased. 2–64 characters; Unicode letters and numbers plus
// spaces, hyphens, and underscores.

const NAME_ALLOWED = /^[\p{L}\p{N}][\p{L}\p{N}\- _]*$/u;
const NAME_MIN = 2;
const NAME_MAX = 64;

export function normalizeRoleName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

// The canonical Role-Name normalization in SQL, shared by the
// admin_role_name_normalized_unique expression index, the roles-service
// duplicate predicate, and the 0018 cutover preflight/backfill: collapse
// runs of whitespace INSIDE a trim, then lowercase — identical to
// normalizeRoleName (collapse → trim → lower).
export function roleNameNormalizedSql(nameColumn: SQLWrapper): SQL {
  return sql`lower(btrim(regexp_replace(${nameColumn}, '\\s+', ' ', 'g')))`;
}

export function validateRoleName(name: string): string[] {
  const errors: string[] = [];
  const normalized = normalizeRoleName(name);
  if (normalized.length < NAME_MIN || normalized.length > NAME_MAX) {
    errors.push("length");
  }
  if (!NAME_ALLOWED.test(normalized)) {
    errors.push("character");
  }
  if ((PROTECTED_ROLE_NAMES as readonly string[]).includes(normalized)) {
    errors.push("protected");
  }
  return errors;
}

// =========================================================
// Grant-set validation
// =========================================================
// Validates each grant against the catalog: the module must exist, the
// action must be supported for that module, and the scope must be one of the
// allowed scopes for that module/action (global modules require "global",
// branch modules require own_branch or all_branches).

export function validateGrants(grants: readonly Grant[]): string[] {
  const errors: string[] = [];
  // One normalized row per (role, module, action) — a draft with two rows
  // for the same tuple would violate admin_role_grant_tuple_unique.
  const seen = new Set<string>();
  for (const grant of grants) {
    const tuple = `${grant.module}:${grant.action}`;
    if (seen.has(tuple)) {
      errors.push("duplicate");
      continue;
    }
    seen.add(tuple);
    const actions = (CATALOG as Record<string, unknown>)[grant.module];
    if (!actions) {
      errors.push("module");
      continue;
    }
    const scopes = (actions as Record<string, unknown>)[grant.action];
    if (scopes === undefined) {
      errors.push("action");
      continue;
    }
    const allowed = scopes as readonly BranchScope[];
    if (allowed.length === 0) {
      if (grant.scope !== "global") {
        errors.push("scope");
      }
    } else if (
      grant.scope !== "own_branch" &&
      grant.scope !== "all_branches"
    ) {
      errors.push("scope");
    } else if (!allowed.includes(grant.scope)) {
      errors.push("scope");
    }
  }
  return errors;
}

// =========================================================
// Grant coverage
// =========================================================
// View access must cover every edit/delete grant in the same module:
// - Global modules: edit/delete require the module's view.
// - Branch modules: all-branch edit/delete requires all-branch view;
//   own-branch edit/delete requires at least own-branch view.

export function checkGrantCoverage(grants: readonly Grant[]): string[] {
  const errors: string[] = [];
  const has = (module: ModuleKey, action: ActionKey, scope: GrantScope) =>
    grants.some(
      (gr) =>
        gr.module === module && gr.action === action && gr.scope === scope
    );
  const hasCoveringView = (grant: Grant): boolean => {
    if (isBranchModule(grant.module)) {
      // all-branch view covers every branch scope; own-branch view only
      // covers own-branch mutations.
      if (has(grant.module, "view", "all_branches")) return true;
      return (
        grant.scope === "own_branch" && has(grant.module, "view", "own_branch")
      );
    }
    return has(grant.module, "view", "global");
  };

  for (const grant of grants) {
    if (grant.action === "edit" || grant.action === "delete") {
      if (!hasCoveringView(grant)) {
        errors.push("view");
      }
    }
  }
  return errors;
}

// =========================================================
// Set-level grant classification
// =========================================================
// Coverage is a SET property, not a per-grant property: an edit/delete grant
// is only invalid when the rest of the retained set cannot cover it.
// Classifying each retained grant in isolation
// (checkGrantCoverage([grant])) falsely flags valid grants such as
// products:edit:all that are retained together with products:view:all.
//
// Classification rules:
// 1. A grant whose module/action/scope shape is not in the current catalog
//    is invalid (the catalog may have changed since the grant was written).
// 2. A duplicate (module, action) tuple is invalid — only its first
//    occurrence is retained.
// 3. A catalog-valid edit/delete grant without a covering view in the
//    remainder of the valid set is invalid. View grants themselves are
//    always catalog-valid, so one pass is sufficient: removing an invalid
//    mutation never invalidates another grant's view coverage.
export function classifyGrantSet(grants: readonly Grant[]): {
  valid: Grant[];
  invalid: Grant[];
} {
  const valid: Grant[] = [];
  const invalid: Grant[] = [];
  const seen = new Set<string>();
  for (const grant of grants) {
    const tuple = `${grant.module}:${grant.action}`;
    if (seen.has(tuple) || validateGrants([grant]).length > 0) {
      invalid.push(grant);
      continue;
    }
    seen.add(tuple);
    valid.push(grant);
  }
  // Coverage against the valid remainder; the mutating grant itself is the
  // one invalidated when its covering view is missing.
  for (const grant of valid) {
    if (
      (grant.action === "edit" || grant.action === "delete") &&
      !hasCoveringViewInSet(grant, valid)
    ) {
      invalid.push(grant);
    }
  }
  return {
    valid: valid.filter((grant) => !invalid.includes(grant)),
    invalid,
  };
}

function hasCoveringViewInSet(
  grant: Grant,
  set: readonly Grant[]
): boolean {
  if (isBranchModule(grant.module)) {
    if (
      set.some(
        (gr) =>
          gr.module === grant.module &&
          gr.action === "view" &&
          gr.scope === "all_branches"
      )
    ) {
      return true;
    }
    return (
      grant.scope === "own_branch" &&
      set.some(
        (gr) =>
          gr.module === grant.module &&
          gr.action === "view" &&
          gr.scope === "own_branch"
      )
    );
  }
  return set.some(
    (gr) =>
      gr.module === grant.module && gr.action === "view" && gr.scope === "global"
  );
}