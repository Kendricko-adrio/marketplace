import { describe, it, expect } from "vitest";
import { getBranchScope } from "./auth-guard";

// Backs the admin route guards' branch scoping (orders, notifications, etc.).
describe("getBranchScope", () => {
  it("gives HQ full scope", () => {
    expect(
      getBranchScope({ id: "u1", name: "HQ", email: "hq@x.com", role: "hq", branchId: null })
    ).toEqual({ mode: "all" });
  });

  it("gives an admin without a branch full scope (HQ-like)", () => {
    expect(
      getBranchScope({ id: "u2", name: "A", email: "a@x.com", role: "admin", branchId: null })
    ).toEqual({ mode: "all" });
  });

  it("scopes a branch admin to their own branch", () => {
    expect(
      getBranchScope({ id: "u3", name: "B", email: "b@x.com", role: "admin", branchId: "br-1" })
    ).toEqual({ mode: "own", branchId: "br-1" });
  });
});
