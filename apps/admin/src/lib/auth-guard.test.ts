import { describe, it, expect } from "vitest";
import { getAdminAccessError, getBranchScope } from "./auth-guard";

// Backs the admin route guards' branch scoping (orders, notifications, etc.).
describe("getBranchScope", () => {
  it("gives HQ full scope", () => {
    expect(
      getBranchScope({ id: "u1", name: "HQ", email: "hq@x.com", role: "hq", branchId: null })
    ).toEqual({ mode: "all" });
  });

  it("denies branch scope to an admin without a branch", () => {
    expect(() =>
      getBranchScope({ id: "u2", name: "A", email: "a@x.com", role: "admin", branchId: null })
    ).toThrow("Admin branch assignment required");
  });

  it("scopes a branch admin to their own branch", () => {
    expect(
      getBranchScope({ id: "u3", name: "B", email: "b@x.com", role: "admin", branchId: "br-1" })
    ).toEqual({ mode: "own", branchId: "br-1" });
  });
});

describe("getAdminAccessError", () => {
  it("requires a password reset before admin access", () => {
    expect(
      getAdminAccessError({
        id: "u1",
        name: "Admin",
        email: "admin@x.com",
        role: "admin",
        branchId: "br-1",
        mustResetPassword: true,
      })
    ).toEqual({ code: "MUST_RESET_PASSWORD", error: "Password reset required" });
  });

  it("denies an unassigned branch admin", () => {
    expect(
      getAdminAccessError({
        id: "u2",
        name: "Admin",
        email: "admin@x.com",
        role: "admin",
        branchId: null,
        mustResetPassword: false,
      })
    ).toEqual({ code: "BRANCH_REQUIRED", error: "Admin branch assignment required" });
  });

  it("allows HQ without a branch", () => {
    expect(
      getAdminAccessError({
        id: "u3",
        name: "HQ",
        email: "hq@x.com",
        role: "hq",
        branchId: null,
        mustResetPassword: false,
      })
    ).toBeNull();
  });
});
