import { describe, it, expect } from "vitest";

import { buildScopeCondition, notificationScopeFromAuthorization } from "./notifications";

// =========================================================
// RBAC: notifications scope (slice 7)
// =========================================================
// The notification list/poll/mark-read/delete helpers scope every query by
// the caller's Current Policy, not by the legacy Role/nullable-branch
// inference. Own-branch scope is pinned to the server-pinned Home Branch;
// a missing Home Branch fails closed (never widens to all-branch).

type Authz = Parameters<typeof notificationScopeFromAuthorization>[0];

function ownAuthz(homeBranchId?: string): Authz {
  return { allowed: true, scope: "own_branch", homeBranchId };
}

describe("notificationScopeFromAuthorization", () => {
  it("maps own_branch policy scope to the Home Branch", () => {
    expect(notificationScopeFromAuthorization(ownAuthz("br-1"))).toEqual({
      mode: "own",
      branchId: "br-1",
    });
  });

  it("fails closed on own-branch scope without a Home Branch", () => {
    // A branch operator whose Home Branch is missing must not become an
    // all-scope reader: the route turns this into a denial.
    expect(notificationScopeFromAuthorization(ownAuthz(undefined))).toBeNull();
  });

  it("maps all-branch policy scope to all (no filter)", () => {
    expect(
      notificationScopeFromAuthorization({
        allowed: true,
        scope: "all_branches",
      })
    ).toEqual({ mode: "all" });
  });
});

describe("buildScopeCondition", () => {
  it("returns undefined for full scope (no filter)", () => {
    expect(buildScopeCondition({ mode: "all" })).toBeUndefined();
  });

  it("returns a branch equality condition for own scope", () => {
    const cond = buildScopeCondition({ mode: "own", branchId: "br-9" });
    expect(cond).toBeTruthy();
  });
});