import { describe, it, expect } from "vitest";
import {
  authorize,
  withinCeiling,
  grantDiff,
  isGrantReduction,
  type Policy,
  type Grant,
} from "./policy";
import {
  ALL_MODULES,
  CATALOG,
  type ActionKey,
  type BranchScope,
  type ModuleKey,
} from "./catalog";

const g = (module: string, action: string, scope: string): Grant =>
  ({ module, action, scope } as unknown as Grant);

function makePolicy(
  grants: Grant[],
  opts: {
    isActive?: boolean;
    homeBranchId?: string | null;
    roleKey?: string;
    archived?: boolean;
  } = {}
): Policy {
  return {
    user: {
      isActive: opts.isActive ?? true,
      homeBranchId:
        opts.homeBranchId === undefined ? "branch-jkt" : opts.homeBranchId,
    },
    role: {
      key: opts.roleKey ?? "custom",
      isSystem: opts.roleKey === "system_owner" || opts.roleKey === "hq",
      archived: opts.archived ?? false,
      grants,
    },
  };
}

describe("authorization", () => {
  it("denies absent grants", () => {
    const policy = makePolicy([g("orders", "view", "own_branch")]);
    expect(authorize(policy, "products", "view").allowed).toBe(false);
    expect(authorize(policy, "orders", "edit").allowed).toBe(false);
  });

  it("pins own scope to the Home Branch", () => {
    const policy = makePolicy([g("orders", "view", "own_branch")]);
    const result = authorize(policy, "orders", "view");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("own_branch");
    expect(result.homeBranchId).toBe("branch-jkt");
  });

  it("returns all scope correctly", () => {
    const policy = makePolicy([g("orders", "edit", "all_branches")]);
    const result = authorize(policy, "orders", "edit");
    expect(result.allowed).toBe(true);
    expect(result.scope).toBe("all_branches");
  });

  it("denies when the requested scope is broader than the grant", () => {
    const policy = makePolicy([g("orders", "view", "own_branch")]);
    expect(authorize(policy, "orders", "view", "all_branches").allowed).toBe(
      false
    );
  });

  it("allows a broader grant to satisfy a narrower request", () => {
    const policy = makePolicy([g("orders", "view", "all_branches")]);
    expect(authorize(policy, "orders", "view", "own_branch").allowed).toBe(
      true
    );
  });

  it("denies inactive users and archived roles", () => {
    const grants = [g("orders", "view", "all_branches")];
    expect(
      authorize(makePolicy(grants, { isActive: false }), "orders", "view")
        .allowed
    ).toBe(false);
    expect(
      authorize(makePolicy(grants, { archived: true }), "orders", "view")
        .allowed
    ).toBe(false);
  });

  it("fails closed on own scope when the Home Branch is missing", () => {
    const policy = makePolicy([g("orders", "view", "own_branch")], {
      homeBranchId: null,
    });
    expect(authorize(policy, "orders", "view").allowed).toBe(false);
  });

  it("gives System Owner the code-owned bypass for every catalog action", () => {
    const policy = makePolicy([], {
      roleKey: "system_owner",
      homeBranchId: null,
    });
    for (const module of ALL_MODULES) {
      for (const action of ["view", "edit", "delete"] as const) {
        const result = authorize(policy, module, action);
        if (result.allowed) {
          expect(result.scope).toBe(
            [
              "products",
              "orders",
              "notifications",
              "branches",
              "analytics",
              "audit_log",
            ].includes(module)
              ? "all_branches"
              : "global"
          );
        } else {
          // Only truly unsupported actions (e.g. products:delete) may deny.
          expect(result.reason).toMatch(/unsupported/i);
        }
      }
    }
  });

  it("System Owner bypass does not fabricate unsupported actions", () => {
    const policy = makePolicy([], { roleKey: "system_owner" });
    expect(authorize(policy, "products", "delete").allowed).toBe(false);
    expect(authorize(policy, "branches", "delete", "own_branch").allowed).toBe(
      false
    );
  });
});

// =========================================================
// Slice 10 — exhaustive deny-by-default matrix (hand-independent)
// =========================================================
// The attempted matrix is DERIVED from CATALOG itself — every module, every
// action key, and every supported required scope, plus unsupported
// module/action and module/scope combinations. The expectation is uniform and
// hand-independent: for a non-Owner Role with an EMPTY grant set, EVERY
// attempted action is denied. No grant list is hand-enumerated; if the
// catalog grows, the matrix grows with it automatically.
describe("deny-by-default catalog matrix", () => {
  interface Attempt {
    module: ModuleKey;
    action: ActionKey;
    requiredScope?: BranchScope | "global";
  }

  const attempts: Attempt[] = [];
  for (const module of ALL_MODULES) {
    for (const action of ["view", "edit", "delete"] as ActionKey[]) {
      const scopes = CATALOG[module][action];
      if (scopes === undefined) {
        // Unsupported module/action combination — still attempted.
        attempts.push({ module, action });
      } else if (scopes.length === 0) {
        // Global action: attempted with and without the explicit scope.
        attempts.push({ module, action });
        attempts.push({ module, action, requiredScope: "global" });
      } else {
        attempts.push({ module, action });
        // Each supported scope, plus the unsupported "global" scope on a
        // branch-aware module.
        for (const scope of scopes) {
          attempts.push({ module, action, requiredScope: scope });
        }
        attempts.push({ module, action, requiredScope: "global" });
      }
    }
  }

  it("attempts every catalog module, action, and supported scope", () => {
    // Coverage sanity: every catalog module is exercised.
    for (const module of ALL_MODULES) {
      expect(
        attempts.some((a) => a.module === module),
        `module ${module} must be attempted`
      ).toBe(true);
    }
    // Unsupported combinations are attempted too (they deny by
    // unsupported_action, not by a missing grant).
    expect(
      attempts.some((a) => a.module === "products" && a.action === "delete")
    ).toBe(true);
    expect(
      attempts.some((a) => a.module === "customers" && a.action === "edit")
    ).toBe(true);
    expect(attempts.length).toBeGreaterThanOrEqual(ALL_MODULES.length * 2);
  });

  it("denies EVERY attempted catalog module/action for a Role with no grants", () => {
    const policy = makePolicy([], { roleKey: "custom_deny_all" });
    const allowed = attempts.filter(
      (a) => authorize(policy, a.module, a.action, a.requiredScope).allowed
    );
    expect(allowed).toEqual([]);
  });

  it("every supported attempt denies with the exact missing-grant reason; only unsupported combinations reason unsupported", () => {
    const policy = makePolicy([], { roleKey: "custom_deny_all" });
    for (const attempt of attempts) {
      const result = authorize(
        policy,
        attempt.module,
        attempt.action,
        attempt.requiredScope
      );
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        if (CATALOG[attempt.module][attempt.action] === undefined) {
          expect(result.reason).toBe(
            `unsupported_action:${attempt.module}:${attempt.action}`
          );
        } else {
          // A supported combination with no grant denies SPECIFICALLY for
          // the missing grant — never for a weaker generic reason.
          expect(result.reason).toBe(
            `missing_grant:${attempt.module}:${attempt.action}`
          );
        }
      }
    }
  });

  it("denies every grant-independent request regardless of Home Branch state", () => {
    // The deny verdict must not depend on the hand: absent grants deny for
    // a Home-Branched user and for a Home-Brancheless user alike, and for
    // an inactive user.
    for (const homeBranchId of ["branch-jkt", null] as const) {
      for (const isActive of [true, false] as const) {
        const policy = makePolicy([], { homeBranchId, isActive });
        for (const attempt of attempts) {
          expect(
            authorize(
              policy,
              attempt.module,
              attempt.action,
              attempt.requiredScope
            ).allowed
          ).toBe(false);
        }
      }
    }
  });
});

describe("authorization ceiling", () => {
  it("own cannot authorize all", () => {
    const actor = [g("orders", "view", "own_branch")];
    expect(
      withinCeiling(false, actor, [g("orders", "view", "all_branches")])
    ).toBe(false);
    expect(
      withinCeiling(false, actor, [g("orders", "view", "own_branch")])
    ).toBe(true);
  });

  it("absent global authority cannot be delegated", () => {
    const actor = [
      g("products", "edit", "own_branch"),
      g("products", "view", "own_branch"),
    ];
    expect(
      withinCeiling(false, actor, [g("products", "edit", "all_branches")])
    ).toBe(false);
    // A grant the actor does not hold at all cannot be delegated.
    expect(withinCeiling(false, actor, [g("homepage", "edit", "global")])).toBe(
      false
    );
  });

  it("System Owner is the recovery exception", () => {
    expect(withinCeiling(true, [], [g("homepage", "edit", "global")])).toBe(
      true
    );
  });

  it("a covered actor grant satisfies the candidate", () => {
    const actor = [g("orders", "view", "all_branches")];
    expect(
      withinCeiling(false, actor, [g("orders", "view", "own_branch")])
    ).toBe(true);
  });
});

describe("grant diff", () => {
  it("identifies removals as reductions", () => {
    const before = [g("orders", "view", "own_branch")];
    const after: Grant[] = [];
    expect(isGrantReduction(before, after)).toBe(true);
    expect(grantDiff(before, after).removed).toEqual([
      { module: "orders", action: "view", scope: "own_branch" },
    ]);
    expect(grantDiff(before, after).added).toEqual([]);
  });

  it("identifies all→own narrowing as a reduction", () => {
    const before = [g("orders", "view", "all_branches")];
    const after = [g("orders", "view", "own_branch")];
    expect(isGrantReduction(before, after)).toBe(true);
    // A narrowing is a REDUCTION: it is presented as the loss of the broader
    // grant only. Listing the narrowed own-branch grant under `added` would
    // present a permission reduction as if a new capability was gained.
    expect(grantDiff(before, after).removed).toEqual([
      { module: "orders", action: "view", scope: "all_branches" },
    ]);
    expect(grantDiff(before, after).added).toEqual([]);
  });

  it("presents own→all widening as an addition only", () => {
    const before = [g("orders", "view", "own_branch")];
    const after = [g("orders", "view", "all_branches")];
    expect(isGrantReduction(before, after)).toBe(false);
    expect(grantDiff(before, after).added).toEqual([
      { module: "orders", action: "view", scope: "all_branches" },
    ]);
    expect(grantDiff(before, after).removed).toEqual([]);
  });

  it("additions and widenings are not reductions", () => {
    const before: Grant[] = [];
    const after = [g("orders", "view", "own_branch")];
    expect(isGrantReduction(before, after)).toBe(false);
    expect(isGrantReduction(after, [g("orders", "view", "all_branches")])).toBe(
      false
    );
    expect(isGrantReduction(before, before)).toBe(false);
  });
});
