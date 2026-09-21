import { describe, it, expect } from "vitest";

import { branchScopeFromAuthorization } from "./branch-scope";

// =========================================================
// RBAC: authorization → DB-predicate branch scope (pure)
// =========================================================
// Backs every branch-aware route conversion in slice 7: the unified guard's
// successful authorization is mapped into the { mode: "all" } |
// { mode: "own"; branchId } shape used by the scoped list predicates and the
// branch-stock/notification helpers. Own-branch scope is pinned to the
// server-pinned Home Branch; a missing Home Branch fails closed instead of
// widening to all-branch.

type Authz = Parameters<typeof branchScopeFromAuthorization>[0];

function ownAuthz(homeBranchId?: string): Authz {
  return { allowed: true, scope: "own_branch", homeBranchId };
}

function allAuthz(): Authz {
  return { allowed: true, scope: "all_branches" };
}

describe("branchScopeFromAuthorization", () => {
  it("maps own_branch scope to the server-pinned Home Branch", () => {
    expect(branchScopeFromAuthorization(ownAuthz("br-1"))).toEqual({
      mode: "own",
      branchId: "br-1",
    });
  });

  it("fails closed on own_branch scope without a Home Branch (never all)", () => {
    expect(branchScopeFromAuthorization(ownAuthz(undefined))).toBeNull();
    expect(branchScopeFromAuthorization(ownAuthz(""))).toBeNull();
  });

  it("maps all_branches scope to all (no branch filter)", () => {
    expect(branchScopeFromAuthorization(allAuthz())).toEqual({ mode: "all" });
  });

  it("does not leak a homeBranchId into all-scope results", () => {
    const scope = branchScopeFromAuthorization({
      allowed: true,
      scope: "all_branches",
      homeBranchId: "br-9",
    });
    expect(scope).toEqual({ mode: "all" });
  });
});