import { describe, it, expect } from "vitest";
import {
  BRANCH_MODULES,
  GLOBAL_MODULES,
  CATALOG,
  normalizeRoleName,
  validateRoleName,
  validateGrants,
  checkGrantCoverage,
  classifyGrantSet,
  isBranchModule,
  SYSTEM_ROLE_KEYS,
  PROTECTED_ROLE_NAMES,
  type Grant,
} from "./catalog";

// Expected values below are hand-derived from the confirmed catalog in
// docs/features/rbac.md / .agents/rbac-new-handoff.md — not from the code.

describe("role name normalization", () => {
  it("trims, lowercases, and collapses whitespace runs", () => {
    expect(normalizeRoleName("  Marketing   Team  ")).toBe("marketing team");
    expect(normalizeRoleName("Sales\tOps")).toBe("sales ops");
  });

  it("keeps unicode letters, digits, hyphens, and underscores", () => {
    expect(normalizeRoleName("Århus-Ops_2")).toBe("århus-ops_2");
  });
});

describe("role name validation", () => {
  it("accepts valid names", () => {
    expect(validateRoleName("Marketing Team")).toEqual([]);
    expect(validateRoleName("Tim 2")).toEqual([]);
    expect(validateRoleName("Ops-Tim")).toEqual([]);
    expect(validateRoleName("ops_tim")).toEqual([]);
    expect(validateRoleName("Århus-Ops_2")).toEqual([]);
  });

  it("rejects names shorter than 2 characters", () => {
    expect(validateRoleName("A")).toContain("length");
    expect(validateRoleName("")).toContain("length");
  });

  it("rejects names longer than 64 characters", () => {
    expect(validateRoleName("a".repeat(65))).toContain("length");
    expect(validateRoleName("a".repeat(64))).toEqual([]);
  });

  it("rejects invalid characters", () => {
    expect(validateRoleName("Sales!")).toContain("character");
    expect(validateRoleName("Sales/Senior")).toContain("character");
  });

  it("rejects protected system names case-insensitively", () => {
    expect(validateRoleName("System Owner")).toContain("protected");
    expect(validateRoleName("system owner")).toContain("protected");
    expect(validateRoleName("HQ")).toContain("protected");
    expect(validateRoleName("hq")).toContain("protected");
    expect(validateRoleName("Admin")).toContain("protected");
    expect(validateRoleName("admin")).toContain("protected");
  });
});

describe("permission catalog shape", () => {
  it("splits modules into branch-aware and global groups", () => {
    expect([...BRANCH_MODULES].sort()).toEqual(
      [
        "products",
        "orders",
        "notifications",
        "branches",
        "analytics",
        "audit_log",
      ].sort()
    );
    expect([...GLOBAL_MODULES].sort()).toEqual(
      [
        "customers",
        "homepage",
        "pages",
        "users",
        "roles",
        "footer",
      ].sort()
    );
    for (const m of BRANCH_MODULES) expect(isBranchModule(m)).toBe(true);
    for (const m of GLOBAL_MODULES) expect(isBranchModule(m)).toBe(false);
  });

  it("supports exactly the confirmed module/action combinations", () => {
    expect(CATALOG.products.view).toEqual(["own_branch", "all_branches"]);
    expect(CATALOG.products.edit).toEqual(["all_branches"]);
    expect(CATALOG.products.delete).toBeUndefined();
    expect(CATALOG.orders.view).toEqual(["own_branch", "all_branches"]);
    expect(CATALOG.orders.edit).toEqual(["own_branch", "all_branches"]);
    expect(CATALOG.notifications.delete).toEqual([
      "own_branch",
      "all_branches",
    ]);
    expect(CATALOG.branches.view).toEqual(["own_branch", "all_branches"]);
    expect(CATALOG.branches.edit).toEqual(["own_branch", "all_branches"]);
    expect(CATALOG.branches.delete).toEqual(["all_branches"]);
    expect(CATALOG.analytics.view).toEqual(["own_branch", "all_branches"]);
    expect(CATALOG.audit_log.view).toEqual(["own_branch", "all_branches"]);
    expect(CATALOG.customers.view).toEqual([]);
    expect(CATALOG.customers.edit).toBeUndefined();
    expect(CATALOG.homepage.edit).toEqual([]);
    expect(CATALOG.pages.delete).toEqual([]);
    expect(CATALOG.users.delete).toEqual([]);
    expect(CATALOG.roles.view).toEqual([]);
    expect(CATALOG.roles.edit).toEqual([]);
    expect(CATALOG.roles.delete).toEqual([]);
    expect(CATALOG.footer.edit).toEqual([]);
  });

  it("names the three system role keys", () => {
    expect([...SYSTEM_ROLE_KEYS]).toEqual(["system_owner", "hq", "admin"]);
    // Protected display names cover every system Role (case-insensitively).
    expect(PROTECTED_ROLE_NAMES.length).toBe(SYSTEM_ROLE_KEYS.length);
    for (const key of SYSTEM_ROLE_KEYS) {
      const displayName = key === "system_owner" ? "system owner" : key;
      expect(PROTECTED_ROLE_NAMES).toContain(displayName);
    }
  });
});

describe("grant-set validation", () => {
  const g = (
    module: string,
    action: string,
    scope: string | null
  ): Grant => ({ module, action, scope } as unknown as Grant);

  it("accepts valid catalog grants", () => {
    expect(validateGrants([g("products", "view", "own_branch")])).toEqual([]);
    expect(validateGrants([g("products", "edit", "all_branches")])).toEqual([]);
    expect(validateGrants([g("customers", "view", "global")])).toEqual([]);
    expect(validateGrants([g("footer", "edit", "global")])).toEqual([]);
  });

  it("rejects unknown modules and unsupported actions", () => {
    expect(validateGrants([g("customer", "view", "global")])).toContain(
      "module"
    );
    expect(validateGrants([g("products", "delete", "all_branches")])).toContain(
      "action"
    );
    expect(validateGrants([g("customers", "edit", "global")])).toContain(
      "action"
    );
  });

  it("rejects duplicate module/action rows (unique tuple violation)", () => {
    // The schema enforces one row per (roleId, module, action); a draft with
    // two rows for the same tuple must be rejected before it reaches the DB.
    expect(
      validateGrants([
        g("orders", "view", "own_branch"),
        g("orders", "view", "all_branches"),
      ])
    ).toContain("duplicate");
    expect(
      validateGrants([
        g("homepage", "edit", "global"),
        g("homepage", "edit", "global"),
      ])
    ).toContain("duplicate");
  });

  it("rejects unsupported scope combinations", () => {
    // Product edit-own is not supported (re-sync is global-only).
    expect(validateGrants([g("products", "edit", "own_branch")])).toContain(
      "scope"
    );
    // Branch delete-own is not supported (delete is all-branch only).
    expect(validateGrants([g("branches", "delete", "own_branch")])).toContain(
      "scope"
    );
    // Global scope on a branch-aware module.
    expect(validateGrants([g("products", "view", "global")])).toContain(
      "scope"
    );
    // Missing scope on a branch-aware module.
    expect(validateGrants([g("orders", "view", null)])).toContain("scope");
    // Own/all scope on a global module.
    expect(validateGrants([g("users", "edit", "own_branch")])).toContain(
      "scope"
    );
    expect(validateGrants([g("roles", "view", "all_branches")])).toContain(
      "scope"
    );
  });
});

describe("grant coverage", () => {
  const g = (
    module: string,
    action: string,
    scope: string
  ): Grant => ({ module, action, scope } as unknown as Grant);

  it("rejects edit/delete without a covering view grant", () => {
    expect(checkGrantCoverage([g("orders", "edit", "own_branch")])).toContain(
      "view"
    );
    expect(checkGrantCoverage([g("homepage", "delete", "global")])).toContain(
      "view"
    );
  });

  it("rejects an all-branch mutation covered only by own-branch view", () => {
    expect(
      checkGrantCoverage([
        g("orders", "view", "own_branch"),
        g("orders", "edit", "all_branches"),
      ])
    ).toContain("view");
    expect(
      checkGrantCoverage([
        g("products", "view", "own_branch"),
        g("products", "edit", "all_branches"),
      ])
    ).toContain("view");
  });

  it("accepts covering combinations", () => {
    expect(
      checkGrantCoverage([
        g("orders", "view", "all_branches"),
        g("orders", "edit", "own_branch"),
      ])
    ).toEqual([]);
    expect(
      checkGrantCoverage([
        g("orders", "view", "own_branch"),
        g("orders", "edit", "own_branch"),
      ])
    ).toEqual([]);
    expect(
      checkGrantCoverage([
        g("homepage", "view", "global"),
        g("homepage", "delete", "global"),
      ])
    ).toEqual([]);
  });
});
// =========================================================
// Set-level invalid-grant classification (review fix)
// =========================================================
// Coverage is a SET property: an edit/delete grant is only invalid when the
// REST of the retained set cannot cover it. Classifying each grant in
// isolation (checkGrantCoverage([grant])) falsely flags valid grants such
// as products:edit:all retained together with products:view:all.
describe("set-level grant classification", () => {
  const g = (
    module: string,
    action: string,
    scope: string | null
  ): Grant => ({ module, action, scope } as unknown as Grant);

  it("classifies a fully valid retained set as all-valid", () => {
    const set = [
      g("products", "view", "all_branches"),
      g("products", "edit", "all_branches"), // covered by view:all
      g("orders", "view", "own_branch"),
      g("orders", "edit", "own_branch"), // covered by view:own
      g("customers", "view", "global"),
    ];
    const { valid, invalid } = classifyGrantSet(set);
    expect(valid).toEqual(set);
    expect(invalid).toEqual([]);
  });

  it("flags only the uncovered mutation, keeping covered grants valid", () => {
    // products:edit:all IS valid when view:all is present, but here the
    // covering view is missing → only the edit grant is invalid.
    const view = g("products", "view", "own_branch");
    const editAll = g("products", "edit", "all_branches");
    const { valid, invalid } = classifyGrantSet([view, editAll]);
    expect(valid).toEqual([view]);
    expect(invalid).toEqual([editAll]);
  });

  it("treats a mutation covered by the valid remainder as valid", () => {
    // homepage:delete alone fails checkGrantCoverage, but together with its
    // view grant the whole set is valid.
    const set = [g("homepage", "view", "global"), g("homepage", "delete", "global")];
    const { valid, invalid } = classifyGrantSet(set);
    expect(valid).toEqual(set);
    expect(invalid).toEqual([]);
  });

  it("classifies catalog-unsupported grants as invalid even in a set", () => {
    const good = g("footer", "view", "global");
    const badScope = g("products", "edit", "own_branch"); // scope unsupported
    const badAction = g("customers", "delete", "global"); // action unsupported
    const { valid, invalid } = classifyGrantSet([good, badScope, badAction]);
    expect(valid).toEqual([good]);
    expect(invalid).toEqual([badScope, badAction]);
  });

  it("marks duplicate tuples as invalid, keeping the first row", () => {
    const own = g("orders", "view", "own_branch");
    const all = g("orders", "view", "all_branches");
    const { valid, invalid } = classifyGrantSet([own, all]);
    expect(valid).toEqual([own]);
    expect(invalid).toEqual([all]);
  });

  it("classifies every mutation of an empty set as valid (deny-all)", () => {
    expect(classifyGrantSet([])).toEqual({ valid: [], invalid: [] });
  });

  it("invalidates an uncovered mutation while KEEPING a later dependent view", () => {
    // An uncovered delete is invalid; the unrelated global view stays valid
    // even when ordered after the invalid grant.
    const bad = g("pages", "delete", "global");
    const good = g("footer", "view", "global");
    const { valid, invalid } = classifyGrantSet([bad, good]);
    expect(valid).toEqual([good]);
    expect(invalid).toEqual([bad]);
  });
});
