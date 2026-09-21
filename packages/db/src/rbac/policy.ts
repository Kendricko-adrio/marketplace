// =========================================================
// RBAC: Pure authorization policy
// =========================================================
// Pure functions over the code-owned catalog. No DB imports. The DB-backed
// resolver (apps/admin/src/lib/rbac/resolver.ts) loads the Policy and calls
// into this module.

import {
  CATALOG,
  isBranchModule,
  SYSTEM_OWNER_KEY,
  type Grant,
  type GrantScope,
  type ModuleKey,
  type ActionKey,
  type BranchScope,
} from "./catalog";

export type { Grant } from "./catalog";

export interface PolicyUser {
  isActive: boolean;
  /** Server-trusted Home Branch id; null for System Owners (and invalid states). */
  homeBranchId: string | null;
}

export interface PolicyRole {
  key: string;
  isSystem: boolean;
  archived: boolean;
  grants: readonly Grant[];
}

export interface Policy {
  user: PolicyUser;
  role: PolicyRole;
}

export type AuthorizeResult =
  | {
      allowed: true;
      /** Granted scope after server-side pinning. */
      scope: BranchScope | "global";
      /** Home Branch id for own_branch scope; undefined otherwise. */
      homeBranchId?: string;
    }
  | {
      allowed: false;
      reason: string;
      scope?: undefined;
      homeBranchId?: undefined;
    };

const OWN: BranchScope = "own_branch";
const ALL: BranchScope = "all_branches";
const GLOBAL: GrantScope = "global";

function isActionSupported(module: ModuleKey, action: ActionKey): boolean {
  return (CATALOG as Record<string, unknown>)[module] !== undefined &&
    (CATALOG as Record<string, Record<string, unknown>>)[module][action] !==
      undefined;
}

function defaultScopeFor(module: ModuleKey): GrantScope {
  return isBranchModule(module) ? ALL : GLOBAL;
}

/**
 * Authorize a single module/action (optionally requiring a specific branch
 * scope) against the loaded Current Policy. Deny by default:
 * - inactive users and archived Roles are denied;
 * - absent grants are denied;
 * - own-branch grants pin the server-trusted Home Branch (never a
 *   client-supplied branch id);
 * - a missing Home Branch fails closed on own-branch grants;
 * - the System Owner has a code-owned full/all bypass with no grant rows.
 */
export function authorize(
  policy: Policy,
  module: ModuleKey,
  action: ActionKey,
  requiredScope?: BranchScope | "global"
): AuthorizeResult {
  if (!isActionSupported(module, action)) {
    return { allowed: false, reason: `unsupported_action:${module}:${action}` };
  }
  if (!policy.user.isActive) {
    return { allowed: false, reason: "inactive_user" };
  }
  if (policy.role.archived) {
    return { allowed: false, reason: "archived_role" };
  }

  // System Owner: code-owned full/all bypass. Not represented by grant rows
  // and not weakened by Role revisions. An unsupported required scope (e.g.
  // branches:delete own_branch) is still denied — the bypass only covers
  // catalog-supported actions/scopes.
  if (policy.role.key === SYSTEM_OWNER_KEY) {
    const allowedScopes = (CATALOG as Record<string, Record<string, readonly string[] | undefined>>)[
      module
    ]?.[action] as readonly BranchScope[] | undefined;
    if (requiredScope && allowedScopes && !allowedScopes.includes(requiredScope as BranchScope)) {
      return { allowed: false, reason: "unsupported_scope" };
    }
    return {
      allowed: true,
      scope: requiredScope ?? defaultScopeFor(module),
      ...(requiredScope === OWN && policy.user.homeBranchId
        ? { homeBranchId: policy.user.homeBranchId }
        : {}),
    };
  }

  const grant = policy.role.grants.find(
    (gr) => gr.module === module && gr.action === action
  );
  if (!grant) {
    return { allowed: false, reason: `missing_grant:${module}:${action}` };
  }

  if (grant.scope === GLOBAL) {
    return { allowed: true, scope: GLOBAL };
  }

  // Branch-aware grant.
  if (requiredScope === ALL && grant.scope !== ALL) {
    return { allowed: false, reason: "insufficient_scope" };
  }
  if (grant.scope === OWN) {
    if (!policy.user.homeBranchId) {
      return { allowed: false, reason: "missing_home_branch" };
    }
    return { allowed: true, scope: OWN, homeBranchId: policy.user.homeBranchId };
  }
  return { allowed: true, scope: ALL };
}

// =========================================================
// Authorization Ceiling
// =========================================================
// A non-Owner administrator can manage only Roles whose current and proposed
// grants are both no broader than the administrator's own effective grants.

function grantCoveredBy(grant: Grant, actorGrants: readonly Grant[]): boolean {
  if (isBranchModule(grant.module)) {
    if (grant.scope === GLOBAL) return false;
    return actorGrants.some(
      (actor) =>
        actor.module === grant.module &&
        actor.action === grant.action &&
        (actor.scope === grant.scope || actor.scope === ALL)
    );
  }
  return actorGrants.some(
    (actor) => actor.module === grant.module && actor.action === grant.action
  );
}

export function withinCeiling(
  isActorOwner: boolean,
  actorGrants: readonly Grant[],
  candidateGrants: readonly Grant[]
): boolean {
  if (isActorOwner) return true;
  return candidateGrants.every((grant) =>
    grantCoveredBy(grant, actorGrants)
  );
}

// =========================================================
// Grant diff
// =========================================================
// Compares the complete before/after grant sets of a Role revision. A
// reduction is any removal or a all→own narrowing; additions and widenings
// (own→all) are not reductions.

export interface GrantDiff {
  added: Grant[];
  removed: Grant[];
}

const grantKey = (grant: Grant): string =>
  `${grant.module}:${grant.action}:${grant.scope}`;

/**
 * Semantically compares the complete before/after grant sets, per
 * (module, action): removals (including all→own narrowing) are reported as
 * `removed`, additions/widenings (own→all) as `added`. Equal scopes produce
 * no diff entries.
 *
 * Presentation rule (follow-up review): a scope change is presented on ONE
 * side only — a narrowing appears solely as the loss of the broader grant,
 * a widening solely as the gain of the broader grant. Listing the narrowed
 * own-branch grant under `added` would present a reduction as a new
 * capability; the resulting complete after-set is already captured by the
 * audit event's full before/after payloads.
 */
export function grantDiff(
  before: readonly Grant[],
  after: readonly Grant[]
): GrantDiff {
  const byAction = (
    grants: readonly Grant[]
  ): Map<string, Grant> => {
    const map = new Map<string, Grant>();
    for (const grant of grants) {
      map.set(`${grant.module}:${grant.action}`, grant);
    }
    return map;
  };
  const beforeMap = byAction(before);
  const afterMap = byAction(after);
  const added: Grant[] = [];
  const removed: Grant[] = [];
  for (const [key, afterGrant] of afterMap) {
    const beforeGrant = beforeMap.get(key);
    if (!beforeGrant) {
      added.push(afterGrant);
    } else if (grantKey(beforeGrant) !== grantKey(afterGrant)) {
      // Scope change on the same module/action: narrowing (→ own) is a
      // reduction shown as the loss of the broader grant; widening (→ all)
      // is an addition shown as the gain of the broader grant.
      if (afterGrant.scope === ALL) {
        added.push(afterGrant); // own → all widening
      } else {
        removed.push(beforeGrant); // all → own narrowing
      }
    }
  }
  for (const [key, beforeGrant] of beforeMap) {
    if (!afterMap.has(key)) removed.push(beforeGrant);
  }
  return { added, removed };
}

export function isGrantReduction(
  before: readonly Grant[],
  after: readonly Grant[]
): boolean {
  const diff = grantDiff(before, after);
  return diff.removed.length > 0;
}