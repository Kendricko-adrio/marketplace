import { describe, expect, it } from "vitest";

import type { Grant } from "@marketplace/db/src/rbac/catalog";
import {
  planCreateUser,
  planDeactivateUser,
  planReactivateUser,
  planUpdateUser,
  isAssignmentDemotion,
  type PlannerActor,
  type PlannerRole,
  type PlannerUser,
} from "./users-planner";

// =========================================================
// Hand-derived fixture grants (catalog baseline, seed defaults)
// =========================================================
const HQ_GRANTS: Grant[] = [
  { module: "users", action: "view", scope: "global" },
  { module: "users", action: "edit", scope: "global" },
  { module: "users", action: "delete", scope: "global" },
  { module: "orders", action: "view", scope: "all_branches" },
  { module: "orders", action: "edit", scope: "all_branches" },
];

const ADMIN_GRANTS: Grant[] = [
  { module: "orders", action: "view", scope: "own_branch" },
  { module: "orders", action: "edit", scope: "own_branch" },
];

const USERS_MANAGER_GRANTS: Grant[] = [
  { module: "users", action: "view", scope: "global" },
  { module: "users", action: "edit", scope: "global" },
  { module: "homepage", action: "view", scope: "global" },
];

const MARKETING_GRANTS: Grant[] = [
  { module: "homepage", action: "view", scope: "global" },
];

const OWNER_ACTOR: PlannerActor = {
  userId: "actor-owner",
  isOwner: true,
  grants: [],
  roleId: "role-owner",
};

const HQ_ACTOR: PlannerActor = {
  userId: "actor-hq",
  isOwner: false,
  grants: HQ_GRANTS,
  roleId: "role-hq",
};

const LIMITED_ACTOR: PlannerActor = {
  userId: "actor-limited",
  isOwner: false,
  grants: USERS_MANAGER_GRANTS,
  roleId: "role-users-manager",
};

const HQ_ROLE: PlannerRole = {
  id: "role-hq",
  key: "hq",
  isSystem: true,
  archived: false,
  grants: HQ_GRANTS,
};

const ADMIN_ROLE: PlannerRole = {
  id: "role-admin",
  key: "admin",
  isSystem: true,
  archived: false,
  grants: ADMIN_GRANTS,
};

const OWNER_ROLE: PlannerRole = {
  id: "role-owner",
  key: "system_owner",
  isSystem: true,
  archived: false,
  grants: [],
};

const MARKETING_ROLE: PlannerRole = {
  id: "role-marketing",
  key: null,
  isSystem: false,
  archived: false,
  grants: MARKETING_GRANTS,
};

const BRANCH_ID = "branch-1";

describe("planCreateUser — assignment requirements", () => {
  it("accepts a valid non-Owner Role with a Home Branch", () => {
    const plan = planCreateUser({
      actor: HQ_ACTOR,
      role: ADMIN_ROLE,
      homeBranchId: BRANCH_ID,
    });
    expect(plan.ok).toBe(true);
  });

  it("requires a Home Branch for every non-Owner Role, including global-only Roles", () => {
    // Marketing is a global-only Role — it STILL requires a Home Branch.
    const plan = planCreateUser({
      actor: OWNER_ACTOR,
      role: MARKETING_ROLE,
      homeBranchId: null,
    });
    expect(plan).toEqual({ ok: false, code: "BRANCH_REQUIRED" });

    const hqWithoutBranch = planCreateUser({
      actor: OWNER_ACTOR,
      role: HQ_ROLE,
      homeBranchId: null,
    });
    expect(hqWithoutBranch).toEqual({ ok: false, code: "BRANCH_REQUIRED" });
  });

  it("allows a null Home Branch only for the System Owner Role", () => {
    const plan = planCreateUser({
      actor: OWNER_ACTOR,
      role: OWNER_ROLE,
      homeBranchId: null,
    });
    expect(plan.ok).toBe(true);
  });

  it("rejects an archived Role assignment", () => {
    const plan = planCreateUser({
      actor: HQ_ACTOR,
      role: { ...ADMIN_ROLE, archived: true },
      homeBranchId: BRANCH_ID,
    });
    expect(plan).toEqual({ ok: false, code: "ROLE_NOT_USABLE" });
  });

  it("rejects Owner assignment by a non-Owner actor", () => {
    const plan = planCreateUser({
      actor: HQ_ACTOR,
      role: OWNER_ROLE,
      homeBranchId: null,
    });
    expect(plan).toEqual({ ok: false, code: "OWNER_ASSIGNMENT_REQUIRED" });
  });

  it("allows an Owner actor to assign the Owner Role", () => {
    const plan = planCreateUser({
      actor: OWNER_ACTOR,
      role: OWNER_ROLE,
      homeBranchId: null,
    });
    expect(plan.ok).toBe(true);
  });

  it("rejects assignments above the actor's Authorization Ceiling", () => {
    // The users-manager actor may not create an Admin Role user whose
    // grants (orders edit/view) exceed the actor's own grants.
    const plan = planCreateUser({
      actor: LIMITED_ACTOR,
      role: ADMIN_ROLE,
      homeBranchId: BRANCH_ID,
    });
    expect(plan).toEqual({ ok: false, code: "CEILING_VIOLATION" });
  });

  it("accepts assignments within the actor's ceiling", () => {
    const plan = planCreateUser({
      actor: LIMITED_ACTOR,
      role: MARKETING_ROLE,
      homeBranchId: BRANCH_ID,
    });
    expect(plan.ok).toBe(true);
  });
});

describe("planUpdateUser — self-protection, ceiling, and last Owner", () => {
  const baseTarget: PlannerUser = {
    id: "target-1",
    email: "target@example.com",
    roleId: "role-admin",
    roleKey: "admin",
    isActive: true,
    homeBranchId: BRANCH_ID,
  };

  it("accepts an unchanged non-Owner assignment", () => {
    const plan = planUpdateUser({
      actor: HQ_ACTOR,
      target: baseTarget,
      currentRole: ADMIN_ROLE,
      nextRole: ADMIN_ROLE,
      nextHomeBranchId: BRANCH_ID,
      otherActiveOwnerCount: 1,
      reason: null,
    });
    expect(plan.ok).toBe(true);
  });

  it("a non-Owner cannot change their own Role assignment", () => {
    const plan = planUpdateUser({
      actor: { ...HQ_ACTOR, userId: baseTarget.id, roleId: "role-admin" },
      target: baseTarget,
      currentRole: ADMIN_ROLE,
      nextRole: HQ_ROLE,
      nextHomeBranchId: null,
      otherActiveOwnerCount: 1,
      reason: "promote",
    });
    expect(plan).toEqual({ ok: false, code: "SELF_ASSIGNMENT" });
  });

  it("rejects a demotion of the last active Owner", () => {
    const plan = planUpdateUser({
      actor: OWNER_ACTOR,
      target: {
        ...baseTarget,
        roleId: "role-owner",
        roleKey: "system_owner",
      },
      currentRole: OWNER_ROLE,
      nextRole: ADMIN_ROLE,
      nextHomeBranchId: BRANCH_ID,
      otherActiveOwnerCount: 0,
      reason: "demote",
    });
    expect(plan).toEqual({ ok: false, code: "LAST_ACTIVE_OWNER" });
  });

  it("allows demoting an Owner when another active Owner remains", () => {
    const plan = planUpdateUser({
      actor: OWNER_ACTOR,
      target: {
        ...baseTarget,
        roleId: "role-owner",
        roleKey: "system_owner",
      },
      currentRole: OWNER_ROLE,
      nextRole: ADMIN_ROLE,
      nextHomeBranchId: BRANCH_ID,
      otherActiveOwnerCount: 1,
      reason: "promote successor",
    });
    expect(plan.ok).toBe(true);
  });

  it("requires a reason for an assignment demotion (reduction)", () => {
    const plan = planUpdateUser({
      actor: HQ_ACTOR,
      target: baseTarget,
      currentRole: HQ_ROLE,
      nextRole: ADMIN_ROLE,
      nextHomeBranchId: BRANCH_ID,
      otherActiveOwnerCount: 1,
      reason: null,
    });
    expect(plan).toEqual({ ok: false, code: "REASON_REQUIRED" });

    const withReason = planUpdateUser({
      actor: HQ_ACTOR,
      target: baseTarget,
      currentRole: HQ_ROLE,
      nextRole: ADMIN_ROLE,
      nextHomeBranchId: BRANCH_ID,
      otherActiveOwnerCount: 1,
      reason: "restructure",
    });
    expect(withReason.ok).toBe(true);
  });

  it("reassignment to an archived Role is rejected", () => {
    const plan = planUpdateUser({
      actor: HQ_ACTOR,
      target: baseTarget,
      currentRole: ADMIN_ROLE,
      nextRole: { ...ADMIN_ROLE, archived: true },
      nextHomeBranchId: BRANCH_ID,
      otherActiveOwnerCount: 1,
      reason: null,
    });
    expect(plan).toEqual({ ok: false, code: "ROLE_NOT_USABLE" });
  });

  it("reassignment to a Role above the actor's ceiling is rejected", () => {
    const plan = planUpdateUser({
      actor: LIMITED_ACTOR,
      target: {
        ...baseTarget,
        roleId: "role-marketing",
        roleKey: null,
      },
      currentRole: MARKETING_ROLE,
      nextRole: HQ_ROLE,
      nextHomeBranchId: null,
      otherActiveOwnerCount: 1,
      reason: null,
    });
    expect(plan).toEqual({ ok: false, code: "CEILING_VIOLATION" });
  });

  it("a non-Owner Role assignment requires a Home Branch", () => {
    const plan = planUpdateUser({
      actor: OWNER_ACTOR,
      target: baseTarget,
      currentRole: ADMIN_ROLE,
      nextRole: MARKETING_ROLE,
      nextHomeBranchId: null,
      otherActiveOwnerCount: 1,
      reason: null,
    });
    expect(plan).toEqual({ ok: false, code: "BRANCH_REQUIRED" });
  });

  it("non-Owner actor cannot reassign an Owner Role", () => {
    const plan = planUpdateUser({
      actor: HQ_ACTOR,
      target: {
        ...baseTarget,
        roleId: "role-owner",
        roleKey: "system_owner",
      },
      currentRole: OWNER_ROLE,
      nextRole: OWNER_ROLE,
      nextHomeBranchId: null,
      otherActiveOwnerCount: 1,
      reason: null,
    });
    expect(plan).toEqual({ ok: false, code: "OWNER_ASSIGNMENT_REQUIRED" });
  });
});

describe("planUpdateUser — self-branch pivot protection", () => {
  const selfTarget: PlannerUser = {
    id: "actor-hq",
    email: "hq@example.com",
    roleId: "role-hq",
    roleKey: "hq",
    isActive: true,
    homeBranchId: BRANCH_ID,
  };

  it("a non-Owner with users:edit cannot move their own Home Branch", () => {
    const plan = planUpdateUser({
      actor: HQ_ACTOR, // same userId as the target: self edit
      target: selfTarget,
      currentRole: HQ_ROLE,
      nextRole: HQ_ROLE,
      nextHomeBranchId: "branch-2",
      otherActiveOwnerCount: 1,
      reason: "relocate myself",
    });
    expect(plan).toEqual({ ok: false, code: "SELF_BRANCH" });
  });

  it("a non-Owner may still edit their own identity fields (branch unchanged)", () => {
    const plan = planUpdateUser({
      actor: HQ_ACTOR,
      target: selfTarget,
      currentRole: HQ_ROLE,
      nextRole: HQ_ROLE,
      nextHomeBranchId: BRANCH_ID, // unchanged
      otherActiveOwnerCount: 1,
      reason: null,
    });
    expect(plan.ok).toBe(true);
  });

  it("a non-Owner may move ANOTHER user's Home Branch", () => {
    const plan = planUpdateUser({
      actor: HQ_ACTOR,
      target: { ...selfTarget, id: "someone-else" },
      currentRole: HQ_ROLE,
      nextRole: HQ_ROLE,
      nextHomeBranchId: "branch-2",
      otherActiveOwnerCount: 1,
      reason: "relocate staff",
    });
    expect(plan.ok).toBe(true);
  });

  it("an Owner actor may still change their own Home Branch (recovery)", () => {
    const ownerSelf: PlannerUser = {
      id: "actor-owner",
      email: "owner@example.com",
      roleId: "role-owner",
      roleKey: "system_owner",
      isActive: true,
      homeBranchId: null,
    };
    const plan = planUpdateUser({
      actor: OWNER_ACTOR,
      target: ownerSelf,
      currentRole: OWNER_ROLE,
      nextRole: OWNER_ROLE,
      nextHomeBranchId: BRANCH_ID,
      otherActiveOwnerCount: 1,
      reason: "recovery",
    });
    expect(plan.ok).toBe(true);
  });

  it("the self-branch verdict also fires when the assignment is unchanged but inactive", () => {
    const plan = planUpdateUser({
      actor: HQ_ACTOR,
      target: { ...selfTarget, isActive: false },
      currentRole: HQ_ROLE,
      nextRole: HQ_ROLE,
      nextHomeBranchId: "branch-2",
      otherActiveOwnerCount: 1,
      reason: "reactivation prep",
    });
    expect(plan).toEqual({ ok: false, code: "SELF_BRANCH" });
  });
});

describe("planDeactivateUser — reason and last-Owner protection", () => {
  const baseTarget: PlannerUser = {
    id: "target-1",
    email: "target@example.com",
    roleId: "role-admin",
    roleKey: "admin",
    isActive: true,
    homeBranchId: BRANCH_ID,
  };

  it("requires a reason", () => {
    const plan = planDeactivateUser({
      target: baseTarget,
      otherActiveOwnerCount: 1,
      reason: null,
    });
    expect(plan).toEqual({ ok: false, code: "REASON_REQUIRED" });
  });

  it("blocks deactivating the last active Owner", () => {
    const plan = planDeactivateUser({
      target: {
        ...baseTarget,
        roleId: "role-owner",
        roleKey: "system_owner",
      },
      otherActiveOwnerCount: 0,
      reason: "offboarding",
    });
    expect(plan).toEqual({ ok: false, code: "LAST_ACTIVE_OWNER" });
  });

  it("accepts a reasoned deactivation with another active Owner present", () => {
    const plan = planDeactivateUser({
      target: {
        ...baseTarget,
        roleId: "role-owner",
        roleKey: "system_owner",
      },
      otherActiveOwnerCount: 1,
      reason: "offboarding",
    });
    expect(plan.ok).toBe(true);
  });

  it("accepts deactivating an inactive-user-agnostic non-Owner", () => {
    const plan = planDeactivateUser({
      target: baseTarget,
      otherActiveOwnerCount: 1,
      reason: "offboarding",
    });
    expect(plan.ok).toBe(true);
  });
});

describe("planReactivateUser — validated users:edit reactivation", () => {
  const baseTarget: PlannerUser = {
    id: "target-1",
    email: "target@example.com",
    roleId: "role-admin",
    roleKey: "admin",
    isActive: false,
    homeBranchId: BRANCH_ID,
  };

  it("accepts a valid non-Owner reactivation with Role and Home Branch", () => {
    const plan = planReactivateUser({
      actor: HQ_ACTOR,
      role: ADMIN_ROLE,
      homeBranchId: BRANCH_ID,
    });
    expect(plan.ok).toBe(true);
  });

  it("blocks reactivation onto an archived Role", () => {
    const plan = planReactivateUser({
      actor: HQ_ACTOR,
      role: { ...ADMIN_ROLE, archived: true },
      homeBranchId: BRANCH_ID,
    });
    expect(plan).toEqual({ ok: false, code: "ROLE_NOT_USABLE" });
  });

  it("blocks reactivation when the required Home Branch is missing", () => {
    const plan = planReactivateUser({
      actor: HQ_ACTOR,
      role: ADMIN_ROLE,
      homeBranchId: null,
    });
    expect(plan).toEqual({ ok: false, code: "REACTIVATION_BLOCKED" });
  });

  it("blocks reactivation of an Owner Role by a non-Owner actor", () => {
    const plan = planReactivateUser({
      actor: HQ_ACTOR,
      role: OWNER_ROLE,
      homeBranchId: null,
    });
    expect(plan).toEqual({ ok: false, code: "OWNER_ASSIGNMENT_REQUIRED" });
  });

  it("blocks reactivation onto a Role above the actor's ceiling", () => {
    const plan = planReactivateUser({
      actor: LIMITED_ACTOR,
      role: ADMIN_ROLE,
      homeBranchId: BRANCH_ID,
    });
    expect(plan).toEqual({ ok: false, code: "CEILING_VIOLATION" });
  });
});

describe("isAssignmentDemotion", () => {
  it("is true when the next Role loses grants", () => {
    expect(isAssignmentDemotion(HQ_GRANTS, ADMIN_GRANTS)).toBe(true);
  });

  it("is false for unchanged or widened grants", () => {
    expect(isAssignmentDemotion(ADMIN_GRANTS, ADMIN_GRANTS)).toBe(false);
    expect(isAssignmentDemotion(ADMIN_GRANTS, HQ_GRANTS)).toBe(false);
  });
});