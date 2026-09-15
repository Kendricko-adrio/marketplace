// =========================================================
// RBAC: pure assignment/deactivation planning for the Users APIs
// =========================================================
// Pure decision layer used by users-service.ts before any DB mutation
// (slice 5, .agents/rbac-new-plan.md):
// - every non-Owner Role assignment (including global-only Roles such as a
//   Marketing Role) requires exactly one valid Home Branch;
// - only an active System Owner may assign or reactivate the Owner Role;
// - a non-Owner actor cannot assign Roles above their Authorization Ceiling;
// - a non-Owner actor cannot change their own Role assignment;
// - a non-Owner actor cannot change their own Home Branch (self-branch pivot);
// - the last active Owner cannot be demoted or deactivated;
// - deactivation requires a reason; assignment demotions require a reason;
// - reactivation validates the retained Role and Home Branch under the
//   CURRENT policy (archived/invalid Role or missing required Home Branch
//   blocks it).
//
// Pure only: no DB imports, no Next.js imports. The service supplies loaded
// actor/target/role data and persists the plan.

import {
  SYSTEM_OWNER_KEY,
  type Grant,
} from "@marketplace/db/src/rbac/catalog";
import {
  isGrantReduction,
  withinCeiling,
} from "@marketplace/db/src/rbac/policy";

export interface PlannerActor {
  userId: string;
  /** True when the actor's assigned Role is the System Owner Role. */
  isOwner: boolean;
  /** The actor's own effective grants (their Authorization Ceiling). */
  grants: readonly Grant[];
  /** Role currently assigned to the actor (self-role protection). */
  roleId: string | null;
}

export interface PlannerRole {
  id: string;
  /** Machine key for system Roles; null for custom Roles. */
  key: string | null;
  isSystem: boolean;
  archived: boolean;
  grants: readonly Grant[];
}

export interface PlannerUser {
  id: string;
  email: string;
  roleId: string | null;
  roleKey: string | null;
  isActive: boolean;
  homeBranchId: string | null;
}

export type UsersPlanCode =
  | "BRANCH_REQUIRED"
  | "ROLE_NOT_USABLE"
  | "OWNER_ASSIGNMENT_REQUIRED"
  | "CEILING_VIOLATION"
  | "SELF_ASSIGNMENT"
  | "SELF_BRANCH"
  | "LAST_ACTIVE_OWNER"
  | "REASON_REQUIRED"
  | "REACTIVATION_BLOCKED";

export type UsersPlan =
  | { ok: true }
  | { ok: false; code: UsersPlanCode };

function isOwnerRole(role: { key: string | null } | null): boolean {
  return role?.key === SYSTEM_OWNER_KEY;
}

/** Assignment is a demotion when the next Role loses grants/scope. */
export function isAssignmentDemotion(
  currentGrants: readonly Grant[],
  nextGrants: readonly Grant[]
): boolean {
  return isGrantReduction(currentGrants, nextGrants);
}

/**
 * Home Branch rule: every non-Owner Role assignment requires exactly one
 * valid Home Branch; only the System Owner Role accepts a null branch.
 */
function assertBranchRequirement(
  role: PlannerRole,
  homeBranchId: string | null
): UsersPlan {
  if (!isOwnerRole(role) && !homeBranchId) {
    return { ok: false, code: "BRANCH_REQUIRED" };
  }
  return { ok: true };
}

/**
 * Ceiling + Owner-only assignment for a candidate Role: a non-Owner actor
 * may not assign the Owner Role nor a Role whose grants exceed the actor's
 * own effective grants. An unusable (archived) Role is rejected outright.
 */
function assertAssignmentAllowed(
  actor: PlannerActor,
  role: PlannerRole
): UsersPlan {
  if (role.archived) {
    return { ok: false, code: "ROLE_NOT_USABLE" };
  }
  if (isOwnerRole(role) && !actor.isOwner) {
    return { ok: false, code: "OWNER_ASSIGNMENT_REQUIRED" };
  }
  if (!withinCeiling(actor.isOwner, actor.grants, role.grants)) {
    return { ok: false, code: "CEILING_VIOLATION" };
  }
  return { ok: true };
}

// =========================================================
// Create
// =========================================================

export function planCreateUser(input: {
  actor: PlannerActor;
  role: PlannerRole;
  homeBranchId: string | null;
}): UsersPlan {
  const assignment = assertAssignmentAllowed(input.actor, input.role);
  if (!assignment.ok) return assignment;
  return assertBranchRequirement(input.role, input.homeBranchId);
}

// =========================================================
// Update (identity + assignment)
// =========================================================

export function planUpdateUser(input: {
  actor: PlannerActor;
  target: PlannerUser;
  currentRole: PlannerRole | null;
  nextRole: PlannerRole | null;
  nextHomeBranchId: string | null;
  /** Active users holding the Owner Role other than the target. */
  otherActiveOwnerCount: number;
  reason: string | null;
}): UsersPlan {
  const { actor, target, currentRole, nextRole } = input;

  // Self-protection: a non-Owner cannot change their own Role assignment.
  if (
    !actor.isOwner &&
    actor.userId === target.id &&
    nextRole &&
    currentRole &&
    nextRole.id !== currentRole.id
  ) {
    return { ok: false, code: "SELF_ASSIGNMENT" };
  }

  // Self-branch protection: a non-Owner cannot move their own Home Branch.
  // Branch-scoped access is granted relative to the holder's Home Branch,
  // so letting the holder pivot it would let them re-scope themselves to
  // another Branch without an authorized administrator. Owners are exempt
  // (recovery/ordinary administration) and other-user edits are unaffected.
  if (
    !actor.isOwner &&
    actor.userId === target.id &&
    input.nextHomeBranchId !== target.homeBranchId
  ) {
    return { ok: false, code: "SELF_BRANCH" };
  }

  const assignment = nextRole
    ? assertAssignmentAllowed(actor, nextRole)
    : ({ ok: true } as UsersPlan);
  if (!assignment.ok) return assignment;

  if (nextRole) {
    const branch = assertBranchRequirement(nextRole, input.nextHomeBranchId);
    if (!branch.ok) return branch;
  }

  // Last-Owner protection: the target holds the Owner Role and no OTHER
  // active Owner remains — demotion would eliminate the last Owner.
  if (
    isOwnerRole(currentRole) &&
    nextRole &&
    !isOwnerRole(nextRole) &&
    input.otherActiveOwnerCount === 0
  ) {
    return { ok: false, code: "LAST_ACTIVE_OWNER" };
  }

  // Demotions (grant reductions on the assignment) require a reason.
  if (
    currentRole &&
    nextRole &&
    nextRole.id !== currentRole.id &&
    isAssignmentDemotion(currentRole.grants, nextRole.grants) &&
    !input.reason
  ) {
    return { ok: false, code: "REASON_REQUIRED" };
  }

  return { ok: true };
}

// =========================================================
// Deactivate
// =========================================================

export function planDeactivateUser(input: {
  target: PlannerUser;
  /** Active users holding the Owner Role other than the target. */
  otherActiveOwnerCount: number;
  reason: string | null;
}): UsersPlan {
  if (!input.reason || input.reason.trim() === "") {
    return { ok: false, code: "REASON_REQUIRED" };
  }
  // The last active Owner cannot be deactivated (the System Owner Role can
  // never be eliminated).
  if (
    isOwnerRole({ key: input.target.roleKey }) &&
    input.otherActiveOwnerCount === 0
  ) {
    return { ok: false, code: "LAST_ACTIVE_OWNER" };
  }
  return { ok: true };
}

// =========================================================
// Reactivate
// =========================================================

export function planReactivateUser(input: {
  actor: PlannerActor;
  /** Retained Role; null when the assignment no longer resolves. */
  role: PlannerRole | null;
  homeBranchId: string | null;
}): UsersPlan {
  if (!input.role) {
    return { ok: false, code: "REACTIVATION_BLOCKED" };
  }
  const assignment = assertAssignmentAllowed(input.actor, input.role);
  if (!assignment.ok) {
    // Owner reactivation by a non-Owner is also an assignment violation.
    return assignment;
  }
  // An inactive Owner with no Home Branch is fine (Owner branch is
  // optional); a non-Owner without the required Home Branch is blocked —
  // an invalid reactivation state must not pass as if it were fine.
  if (!isOwnerRole(input.role) && !input.homeBranchId) {
    return { ok: false, code: "REACTIVATION_BLOCKED" };
  }
  return { ok: true };
}