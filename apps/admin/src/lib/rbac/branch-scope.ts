import type { BranchScope } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// RBAC: authorization → DB-predicate branch scope (pure)
// =========================================================
// Maps the unified guard's successful authorization into the branch predicate
// shape used by scoped list queries and the branch-stock/notification
// helpers: `{ mode: "all" }` (no branch filter) or `{ mode: "own", branchId }`
// pinned to the server-trusted Home Branch.
//
// Fail closed: an own-branch authorization without a server-pinned Home
// Branch returns `null` — never an all-branch widening. (The policy resolver
// already denies own-branch grants without a Home Branch; this is defence in
// depth for the route seam.) Callers turn `null` into a 403 denial.

export type BranchPredicateScope =
  | { mode: "all" }
  | { mode: "own"; branchId: string };

export interface BranchAuthorization {
  allowed: true;
  scope: BranchScope | "global";
  homeBranchId?: string;
}

export function branchScopeFromAuthorization(
  authorization: BranchAuthorization
): BranchPredicateScope | null {
  if (authorization.scope === "own_branch") {
    if (!authorization.homeBranchId) return null; // fail closed
    return { mode: "own", branchId: authorization.homeBranchId };
  }
  // all_branches (and the theoretical global scope on a branch module) see
  // every branch — no branch filter.
  return { mode: "all" };
}