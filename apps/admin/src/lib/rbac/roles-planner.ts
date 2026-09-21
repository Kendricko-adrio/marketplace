// =========================================================
// RBAC: pure revision/archive planning for the Roles APIs
// =========================================================
// Pure decision layer used by roles-service.ts before any DB mutation.
// Derives a complete revision/archive plan (or a stable rejection code) from
// the confirmed design (.agents/rbac-new-plan.md slice 4):
// - System Owner is immutable (OWNER_IMMUTABLE);
// - a non-Owner cannot revise the Role they hold (SELF_ROLE_REVISION);
// - optimistic version checking (STALE_VERSION);
// - Role Name normalization rules; protected system names are blocked for
//   NEW names, but retaining a Role's current (protected) name is allowed —
//   otherwise the system Roles "HQ"/"Admin" could never be revised;
// - catalog validity (INVALID_GRANTS) and view-coverage (COVERAGE_VIOLATION);
// - the Authorization Ceiling (CEILING_VIOLATION) on both the proposed and
//   the Role's current grants — a non-Owner cannot manage a Role broader
//   than their own effective grants;
// - permission reductions require a reason (REDUCTION_REASON_REQUIRED).
//
// Pure only: no DB imports, no Next.js imports. The service supplies loaded
// actor/role data and persists the plan.

import {
  checkGrantCoverage,
  normalizeRoleName,
  SYSTEM_OWNER_KEY,
  validateGrants,
  validateRoleName,
  type Grant,
} from "@marketplace/db/src/rbac/catalog";
import {
  grantDiff,
  isGrantReduction,
  withinCeiling,
  type GrantDiff,
} from "@marketplace/db/src/rbac/policy";

export interface PlannerActor {
  isOwner: boolean;
  grants: readonly Grant[];
  /** Role currently assigned to the actor (self-role protection). */
  roleId: string | null;
}

export interface PlannerRole {
  id: string;
  /** Machine key for system Roles; null for custom Roles. */
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  archived: boolean;
  version: number;
  grants: readonly Grant[];
}

export interface RevisionDraft {
  name: string;
  description?: string | null;
  grants: readonly Grant[];
}

export interface RevisionInput {
  actor: PlannerActor;
  role: PlannerRole;
  draft: RevisionDraft;
  expectedVersion: number;
  reason: string | null;
}

export type RevisionErrorCode =
  | "ROLE_NOT_FOUND"
  | "OWNER_IMMUTABLE"
  | "SELF_ROLE_REVISION"
  | "STALE_VERSION"
  | "PROTECTED_NAME"
  | "INVALID_NAME"
  | "INVALID_GRANTS"
  | "CEILING_VIOLATION"
  | "COVERAGE_VIOLATION"
  | "REDUCTION_REASON_REQUIRED";

export type RevisionPlan =
  | {
      ok: true;
      /** True when the draft removes or narrows any grant. */
      reduction: boolean;
      diff: GrantDiff;
      /** Trimmed/collapsed Role Name ready for uniqueness checks. */
      normalizedName: string;
    }
  | { ok: false; code: RevisionErrorCode };

export function planRevision(input: RevisionInput): RevisionPlan {
  const { actor, role, draft, expectedVersion, reason } = input;

  // Archived Roles cannot be revised; they must be restored first.
  if (role.archived) {
    return { ok: false, code: "ROLE_NOT_FOUND" };
  }

  // The System Owner Role is immutable: its full/all bypass is code-owned
  // and never represented by grant rows.
  if (role.key === SYSTEM_OWNER_KEY) {
    return { ok: false, code: "OWNER_IMMUTABLE" };
  }

  // A non-Owner cannot revise the Role they are assigned to.
  if (!actor.isOwner && actor.roleId !== null && actor.roleId === role.id) {
    return { ok: false, code: "SELF_ROLE_REVISION" };
  }

  // Optimistic concurrency: the draft was built from a specific version.
  if (expectedVersion !== role.version) {
    return { ok: false, code: "STALE_VERSION" };
  }

  // Role Name rules: normalization, 2–64 chars, protected system names.
  // Retaining the Role's current name is always allowed (the protected
  // names ARE the system Roles' display names).
  const nameErrors = validateRoleName(draft.name);
  const renaming =
    normalizeRoleName(draft.name) !== normalizeRoleName(role.name);
  if (nameErrors.includes("protected") && renaming) {
    return { ok: false, code: "PROTECTED_NAME" };
  }
  if (nameErrors.some((e) => e !== "protected")) {
    return { ok: false, code: "INVALID_NAME" };
  }

  // Every grant must be a supported catalog combination.
  if (validateGrants(draft.grants).length > 0) {
    return { ok: false, code: "INVALID_GRANTS" };
  }

  // Authorization ceiling on the PROPOSED grants: a non-Owner cannot
  // delegate authority (any action or scope) broader than their own.
  if (
    !actor.isOwner &&
    !withinCeiling(false, actor.grants, draft.grants)
  ) {
    return { ok: false, code: "CEILING_VIOLATION" };
  }

  // View scope must cover every edit/delete grant in the same module.
  if (checkGrantCoverage(draft.grants).length > 0) {
    return { ok: false, code: "COVERAGE_VIOLATION" };
  }

  // A non-Owner cannot manage a Role whose CURRENT grants exceed the
  // actor's own effective grants (e.g. narrowing a too-broad Role).
  if (
    !actor.isOwner &&
    !withinCeiling(false, actor.grants, role.grants)
  ) {
    return { ok: false, code: "CEILING_VIOLATION" };
  }

  const diff = grantDiff(role.grants, draft.grants);
  const reduction = isGrantReduction(role.grants, draft.grants);

  // Removals and all→own narrowings require an explicit reason.
  if (reduction && (reason === null || reason.trim() === "")) {
    return { ok: false, code: "REDUCTION_REASON_REQUIRED" };
  }

  return {
    ok: true,
    reduction,
    diff,
    normalizedName: normalizeRoleName(draft.name),
  };
}

// =========================================================
// Archive planning
// =========================================================

export interface ArchiveRole {
  id: string;
  key: string | null;
  name: string;
  isSystem: boolean;
  archived: boolean;
  version: number;
}

export interface ArchiveInput {
  role: ArchiveRole;
  /** Active (non-deactivated) users currently assigned to the Role. */
  activeUserCount: number;
  reason: string | null;
}

export type ArchiveErrorCode =
  | "ROLE_NOT_FOUND"
  | "SYSTEM_ROLE_NOT_ARCHIVABLE"
  | "REASON_REQUIRED"
  | "ROLE_HAS_ACTIVE_USERS";

export type ArchivePlan =
  | { ok: true }
  | { ok: false; code: ArchiveErrorCode };

export function planArchive(input: ArchiveInput): ArchivePlan {
  const { role, activeUserCount, reason } = input;

  // Already-archived Roles are not addressable as active Roles.
  if (role.archived) {
    return { ok: false, code: "ROLE_NOT_FOUND" };
  }

  // Owner/HQ/Admin are system Roles and can never be archived.
  if (role.isSystem) {
    return { ok: false, code: "SYSTEM_ROLE_NOT_ARCHIVABLE" };
  }

  if (reason === null || reason.trim() === "") {
    return { ok: false, code: "REASON_REQUIRED" };
  }

  if (activeUserCount > 0) {
    return { ok: false, code: "ROLE_HAS_ACTIVE_USERS" };
  }

  return { ok: true };
}