import { db } from "@/db";
import * as schema from "@/db";
import { eq } from "drizzle-orm";

import {
  authorize as policyAuthorize,
  withinCeiling,
  type AuthorizeResult,
  type Policy,
  type PolicyUser,
  type PolicyRole,
} from "@marketplace/db/src/rbac/policy";
import type { Grant } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// RBAC: current-policy resolver (DB-backed)
// =========================================================
// The policy is resolved from the database on every request — never cached
// in the session — so role/grant/assignment changes apply on the next
// request. This module is the seam between the shared schema and the pure
// policy model in @marketplace/db/src/rbac/policy.

export interface AdmissionInput {
  isActive: boolean | null;
  roleId: string | null;
  /** True when the assigned Role row exists and is not archived. */
  roleExists: boolean;
  roleArchived: boolean;
}

export type AdmissionResult =
  | { admitted: true }
  | {
      admitted: false;
      reason: "inactive_user" | "archived_role" | "missing_assignment";
    };

/**
 * Session admission decision: an active user with an existing, non-archived
 * Role assignment is admitted; every other state fails closed with a stable
 * reason.
 */
export function admissionDecision(input: AdmissionInput): AdmissionResult {
  if (!input.isActive) {
    return { admitted: false, reason: "inactive_user" };
  }
  if (!input.roleId || !input.roleExists) {
    return { admitted: false, reason: "missing_assignment" };
  }
  if (input.roleArchived) {
    return { admitted: false, reason: "archived_role" };
  }
  return { admitted: true };
}

export interface LoadedPolicy {
  user: {
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    homeBranchId: string | null;
  };
  role: {
    id: string;
    /** Machine key; null for custom Roles. */
    key: string | null;
    name: string;
    isSystem: boolean;
    archived: boolean;
    /** Optimistic-concurrency version of the Role row. */
    version: number;
    grants: Grant[];
  };
  /** role.version — the policy version reported by /api/admin/policy/me. */
  policyVersion: number;
}

type Database = typeof db;

/**
 * Load the current policy for a user: user (assignment/activity/home
 * branch), Role, and the complete grant set. Returns null when the user or
 * the assigned Role cannot be found (fail closed downstream).
 */
export async function loadPolicy(
  userId: string,
  database: Database = db
): Promise<LoadedPolicy | null> {
  const userRows = await database
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      isActive: schema.users.isActive,
      branchId: schema.users.branchId,
      roleId: schema.users.roleId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const user = userRows[0];
  if (!user) return null;

  if (!user.roleId) return null;

  const roleRows = await database
    .select({
      id: schema.adminRoles.id,
      key: schema.adminRoles.key,
      name: schema.adminRoles.name,
      isSystem: schema.adminRoles.isSystem,
      version: schema.adminRoles.version,
      archivedAt: schema.adminRoles.archivedAt,
    })
    .from(schema.adminRoles)
    .where(eq(schema.adminRoles.id, user.roleId))
    .limit(1);

  const role = roleRows[0];
  if (!role) return null;

  const grants = await database
    .select({
      module: schema.adminRoleGrants.module,
      action: schema.adminRoleGrants.action,
      scope: schema.adminRoleGrants.scope,
    })
    .from(schema.adminRoleGrants)
    .where(eq(schema.adminRoleGrants.roleId, role.id));

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      homeBranchId: user.branchId,
    },
    role: {
      id: role.id,
      key: role.key,
      name: role.name,
      isSystem: role.isSystem,
      archived: role.archivedAt !== null,
      version: role.version,
      grants: grants.map((g) => ({
        module: g.module as Grant["module"],
        action: g.action as Grant["action"],
        scope: (g.scope ?? "global") as Grant["scope"],
      })),
    },
    policyVersion: role.version,
  };
}

/** Convert a loaded policy into the pure policy-model shape. */
export function toPolicy(loaded: LoadedPolicy): Policy {
  const user: PolicyUser = {
    isActive: loaded.user.isActive,
    homeBranchId: loaded.user.homeBranchId,
  };
  const role: PolicyRole = {
    key: loaded.role.key ?? "",
    isSystem: loaded.role.isSystem,
    archived: loaded.role.archived,
    grants: loaded.role.grants,
  };
  return { user, role };
}

/** Authorize a module/action against a loaded policy. */
export function authorizeLoaded(
  loaded: LoadedPolicy,
  module: Parameters<typeof policyAuthorize>[1],
  action: Parameters<typeof policyAuthorize>[2],
  requiredScope?: Parameters<typeof policyAuthorize>[3]
): AuthorizeResult {
  return policyAuthorize(toPolicy(loaded), module, action, requiredScope);
}

export { withinCeiling };