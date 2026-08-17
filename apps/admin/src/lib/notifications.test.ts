import { describe, it, expect } from "vitest";
import { getNotificationScope, buildScopeCondition } from "./notifications";

// Backs the notifications list/poll/mark-all-read routes' branch scoping.
describe("getNotificationScope", () => {
  it("gives HQ full scope", () => {
    expect(
      getNotificationScope({ id: "u1", name: "HQ", email: "hq@x.com", role: "hq", branchId: null })
    ).toEqual({ mode: "all" });
  });

  it("scopes a branch admin to their branch", () => {
    expect(
      getNotificationScope({ id: "u2", name: "A", email: "a@x.com", role: "admin", branchId: "br-9" })
    ).toEqual({ mode: "own", branchId: "br-9" });
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
