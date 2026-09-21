import { describe, it, expect } from "vitest";
import {
  INITIAL_ROLE_KEYS,
  INITIAL_ROLE_SEED,
  HQ_SEED_GRANTS,
  ADMIN_SEED_GRANTS,
  type SeedGrant,
} from "./seed-defaults";

// Expected values hand-derived from the confirmed defaults
// (docs/adr + .agents/rbac-new-handoff.md): Owner full immutable with NO grant
// rows; HQ starts full all-branch (editable); Admin starts least-privilege
// branch operations with no global product re-sync and no all-scope grant.

const g = (module: string, action: string, scope: string): SeedGrant =>
  ({ module, action, scope } as unknown as SeedGrant);

describe("initial roles", () => {
  it("contains exactly the three system role keys", () => {
    expect([...INITIAL_ROLE_KEYS]).toEqual(["system_owner", "hq", "admin"]);
  });

  it("seeds exactly three roles with system flags and known display names", () => {
    expect(INITIAL_ROLE_SEED.map((r) => r.key)).toEqual([
      "system_owner",
      "hq",
      "admin",
    ]);
    expect(INITIAL_ROLE_SEED.map((r) => r.isSystem)).toEqual([
      true,
      true,
      true,
    ]);
    expect(INITIAL_ROLE_SEED.map((r) => r.name)).toEqual([
      "System Owner",
      "HQ",
      "Admin",
    ]);
  });

  it("gives the System Owner no grant rows", () => {
    const owner = INITIAL_ROLE_SEED.find((r) => r.key === "system_owner");
    expect(owner?.grants).toEqual([]);
  });

  it("seeds HQ with the full all-branch/global grant set", () => {
    expect(new Set(HQ_SEED_GRANTS)).toEqual(
      new Set([
        g("products", "view", "all_branches"),
        g("products", "edit", "all_branches"),
        g("orders", "view", "all_branches"),
        g("orders", "edit", "all_branches"),
        g("notifications", "view", "all_branches"),
        g("notifications", "edit", "all_branches"),
        g("notifications", "delete", "all_branches"),
        g("branches", "view", "all_branches"),
        g("branches", "edit", "all_branches"),
        g("branches", "delete", "all_branches"),
        g("analytics", "view", "all_branches"),
        g("audit_log", "view", "all_branches"),
        g("customers", "view", "global"),
        g("homepage", "view", "global"),
        g("homepage", "edit", "global"),
        g("homepage", "delete", "global"),
        g("pages", "view", "global"),
        g("pages", "edit", "global"),
        g("pages", "delete", "global"),
        g("users", "view", "global"),
        g("users", "edit", "global"),
        g("users", "delete", "global"),
        g("roles", "view", "global"),
        g("roles", "edit", "global"),
        g("roles", "delete", "global"),
        g("footer", "view", "global"),
        g("footer", "edit", "global"),
      ])
    );
  });

  it("seeds Admin with least-privilege own-branch grants", () => {
    expect(new Set(ADMIN_SEED_GRANTS)).toEqual(
      new Set([
        g("products", "view", "own_branch"),
        g("orders", "view", "own_branch"),
        g("orders", "edit", "own_branch"),
        g("notifications", "view", "own_branch"),
        g("notifications", "edit", "own_branch"),
        g("notifications", "delete", "own_branch"),
      ])
    );
  });

  it("gives Admin no product edit and no all-branch grant", () => {
    expect(
      ADMIN_SEED_GRANTS.some(
        (gr) => gr.module === "products" && gr.action === "edit"
      )
    ).toBe(false);
    expect(
      ADMIN_SEED_GRANTS.some((gr) => gr.scope === "all_branches")
    ).toBe(false);
  });
});