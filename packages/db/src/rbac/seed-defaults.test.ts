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
        // Discount administration: two Global Modules, view/edit each.
        g("discounts", "view", "global"),
        g("discounts", "edit", "global"),
        g("discount_capacity", "view", "global"),
        g("discount_capacity", "edit", "global"),
        // Markdown price administration (ticket03): global view/edit each.
        g("prices", "view", "global"),
        g("prices", "edit", "global"),
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

  it("gives fresh HQ the two discount modules as global view/edit and fresh Admin none", () => {
    // Spec §7.3: `discounts` and `discount_capacity` are two separate Global
    // Modules, each with exactly view + edit. A fresh HQ therefore gets the
    // four approved global rows (no delete, never a branch scope), while a
    // fresh Admin keeps least-privilege branch operations and gets none.
    const discountTuples = (grants: readonly SeedGrant[]): string[] =>
      grants
        .filter(
          (gr) =>
            gr.module === "discounts" || gr.module === "discount_capacity"
        )
        .map((gr) => `${gr.module}:${gr.action}:${gr.scope}`);

    expect(new Set(discountTuples(HQ_SEED_GRANTS))).toEqual(
      new Set([
        "discounts:view:global",
        "discounts:edit:global",
        "discount_capacity:view:global",
        "discount_capacity:edit:global",
      ])
    );
    expect(discountTuples(ADMIN_SEED_GRANTS)).toEqual([]);
  });
});