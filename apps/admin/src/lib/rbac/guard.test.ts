import { describe, it, expect } from "vitest";

import { objectScopeViolation } from "./guard";

// =========================================================
// Slice 3 — object-scope helper: cross-branch object IDs must not disclose
// existence (404) while generic denials remain 403. Pure seam tests.
// =========================================================

describe("objectScopeViolation", () => {
  it("flags an own-scope object from another branch as cross-branch", () => {
    expect(
      objectScopeViolation(
        { allowed: true, scope: "own_branch", homeBranchId: "br-1" },
        "br-2"
      )
    ).toBe("cross_branch");
  });

  it("accepts an own-scope object from the Home Branch", () => {
    expect(
      objectScopeViolation(
        { allowed: true, scope: "own_branch", homeBranchId: "br-1" },
        "br-1"
      )
    ).toBeNull();
  });

  it("does not restrict all-branch scope", () => {
    expect(
      objectScopeViolation({ allowed: true, scope: "all_branches" }, "br-9")
    ).toBeNull();
  });

  it("does not restrict global scope (global modules have no branch)", () => {
    expect(
      objectScopeViolation({ allowed: true, scope: "global" }, null)
    ).toBeNull();
  });

  it("treats a null object branch as cross-branch for own scope (fail closed)", () => {
    expect(
      objectScopeViolation(
        { allowed: true, scope: "own_branch", homeBranchId: "br-1" },
        null
      )
    ).toBe("cross_branch");
  });

  it("ignores null object branch for all scope", () => {
    expect(
      objectScopeViolation({ allowed: true, scope: "all_branches" }, null)
    ).toBeNull();
  });
});