import { describe, it, expect } from "vitest";
import {
  planRevision,
  planArchive,
  type RevisionInput,
  type ArchiveInput,
} from "./roles-planner";
import type { Grant } from "@marketplace/db/src/rbac/catalog";

// =========================================================
// Slice 4 — pure revision/archive planning for the Roles APIs.
// Hand-derived expectations from the confirmed design:
// ceiling on current AND proposed grants, self-role protection, System
// Owner immutability, stale optimistic version, reduction reasons, and
// archive restrictions.
// =========================================================

const own = (module: string, action: string, scope = "own_branch") =>
  ({ module, action, scope }) as Grant;
const all = (module: string, action: string) =>
  ({ module, action, scope: "all_branches" }) as Grant;
const global = (module: string, action: string) =>
  ({ module, action, scope: "global" }) as Grant;

function revisionInput(overrides: Partial<RevisionInput> = {}): RevisionInput {
  return {
    actor: {
      isOwner: false,
      grants: [
        all("products", "view"),
        all("products", "edit"),
        all("orders", "view"),
        all("orders", "edit"),
        // The default actor's ceiling includes the homepage module so the
        // default draft (homepage view/edit) is an in-ceiling revision.
        global("homepage", "view"),
        global("homepage", "edit"),
        global("roles", "view"),
        global("roles", "edit"),
        global("roles", "delete"),
        global("users", "view"),
        global("users", "edit"),
        global("users", "delete"),
      ],
      roleId: "actor-role",
    },
    role: {
      id: "target-role",
      key: null,
      name: "Marketing",
      description: null,
      isSystem: false,
      archived: false,
      version: 3,
      grants: [all("products", "view")],
    },
    draft: {
      name: "Marketing",
      description: "Homepage only",
      // Complete grant set: keeps the Role's existing products grant so no
      // grant is removed (a no-reduction revision).
      grants: [
        all("products", "view"),
        global("homepage", "view"),
        global("homepage", "edit"),
      ],
    },
    expectedVersion: 3,
    reason: null,
    ...overrides,
  };
}

describe("planRevision — accept/reject", () => {
  it("accepts a valid in-ceiling revision with no reduction", () => {
    const plan = planRevision(revisionInput());
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.reduction).toBe(false);
    }
  });

  it("rejects a stale expected version as STALE_VERSION", () => {
    const plan = planRevision(revisionInput({ expectedVersion: 2 }));
    expect(plan).toMatchObject({ ok: false, code: "STALE_VERSION" });
  });

  it("rejects revision of the System Owner as OWNER_IMMUTABLE", () => {
    const plan = planRevision(
      revisionInput({
        role: {
          id: "owner-role",
          key: "system_owner",
          name: "System Owner",
          description: null,
          isSystem: true,
          archived: false,
          version: 1,
          grants: [],
        },
      })
    );
    expect(plan).toMatchObject({ ok: false, code: "OWNER_IMMUTABLE" });
  });

  it("rejects a non-Owner revising their own Role as SELF_ROLE_REVISION", () => {
    const plan = planRevision(
      revisionInput({ actor: { isOwner: false, grants: [], roleId: "target-role" } })
    );
    expect(plan).toMatchObject({ ok: false, code: "SELF_ROLE_REVISION" });
  });

  it("an Owner may revise their own Role (self-role rule is non-Owner only)", () => {
    const plan = planRevision(
      revisionInput({
        expectedVersion: 1, // matches the role version below
        actor: { isOwner: true, grants: [], roleId: "target-role" },
        role: {
          id: "target-role",
          key: "hq",
          name: "HQ",
          description: null,
          isSystem: true,
          archived: false,
          version: 1,
          grants: [],
        },
        draft: { name: "HQ", grants: [] },
      })
    );
    // Owner revising HQ (a system role they do not hold) is fine; here the
    // owner holds the role — still allowed for system_owner bypass.
    expect(plan.ok).toBe(true);
  });

  it("rejects proposed grants above the actor ceiling", () => {
    const plan = planRevision(
      revisionInput({
        draft: {
          name: "Marketing",
          grants: [all("products", "view"), all("branches", "delete")],
        },
      })
    );
    expect(plan).toMatchObject({ ok: false, code: "CEILING_VIOLATION" });
  });

  it("rejects revisions of roles whose CURRENT grants exceed the ceiling", () => {
    const plan = planRevision(
      revisionInput({
        role: {
          id: "target-role",
          key: null,
          name: "Super",
          description: null,
          isSystem: false,
          archived: false,
          version: 1,
          grants: [global("users", "delete"), all("branches", "delete")],
        },
        draft: {
          name: "Super",
          grants: [global("users", "view")],
        },
        expectedVersion: 1, // version is not the subject of this test
      })
    );
    // Narrowing is allowed even when the current set exceeds the ceiling?
    // Design: ceiling checks current and proposed — a non-Owner cannot
    // manage a role broader than their own grants at all.
    expect(plan).toMatchObject({ ok: false, code: "CEILING_VIOLATION" });
  });

  it("rejects edit/delete grants not covered by view as COVERAGE_VIOLATION", () => {
    const plan = planRevision(
      revisionInput({
        draft: {
          name: "Marketing",
          grants: [global("homepage", "edit")],
        },
      })
    );
    expect(plan).toMatchObject({ ok: false, code: "COVERAGE_VIOLATION" });
  });

  it("rejects unsupported catalog combinations as INVALID_GRANTS", () => {
    const plan = planRevision(
      revisionInput({
        draft: {
          name: "Marketing",
          grants: [own("products", "edit")],
        },
      })
    );
    expect(plan).toMatchObject({ ok: false, code: "INVALID_GRANTS" });
  });

  it("rejects a protected name", () => {
    const plan = planRevision(revisionInput({ draft: { name: "Admin", grants: [] } }));
    expect(plan).toMatchObject({ ok: false, code: "PROTECTED_NAME" });
  });

  it("rejects an invalid (too short) name", () => {
    const plan = planRevision(
      revisionInput({ draft: { name: "A", grants: [] } })
    );
    expect(plan).toMatchObject({ ok: false, code: "INVALID_NAME" });
  });

  it("requires a reason for a reduction", () => {
    const plan = planRevision(
      revisionInput({
        draft: {
          name: "Marketing",
          grants: [], // removes products:view-own → reduction
        },
      })
    );
    expect(plan).toMatchObject({ ok: false, code: "REDUCTION_REASON_REQUIRED" });
  });

  it("accepts a reduction with a reason and reports the diff", () => {
    const plan = planRevision(
      revisionInput({
        draft: { name: "Marketing", grants: [] },
        reason: "Least-privilege review",
      })
    );
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.reduction).toBe(true);
      expect(plan.diff.removed).toEqual([all("products", "view")]);
      expect(plan.diff.added).toEqual([]);
    }
  });

  it("treats all→own narrowing as a reduction", () => {
    const plan = planRevision(
      revisionInput({
        role: {
          id: "target-role",
          key: null,
          name: "Ops",
          description: null,
          isSystem: false,
          archived: false,
          version: 1,
          grants: [all("orders", "view"), all("orders", "edit")],
        },
        draft: {
          name: "Ops",
          grants: [own("orders", "view"), own("orders", "edit")],
        },
        expectedVersion: 1, // version is not the subject of this test
        reason: "Narrow operations to the home branch",
      })
    );
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.reduction).toBe(true);
      expect(plan.diff.removed).toHaveLength(2);
    }
  });
});

describe("planArchive", () => {
  const archiveInput = (overrides: Partial<ArchiveInput> = {}): ArchiveInput => ({
    role: {
      id: "target-role",
      key: null,
      name: "Marketing",
      isSystem: false,
      archived: false,
      version: 3,
    },
    activeUserCount: 0,
    reason: "No longer used",
    ...overrides,
  });

  it("accepts archiving a custom role with no active users and a reason", () => {
    const plan = planArchive(archiveInput());
    expect(plan.ok).toBe(true);
  });

  it("blocks archiving a system role (Owner/HQ/Admin)", () => {
    const plan = planArchive(
      archiveInput({ role: { id: "hq", key: "hq", name: "HQ", isSystem: true, archived: false, version: 1 } })
    );
    expect(plan).toMatchObject({ ok: false, code: "SYSTEM_ROLE_NOT_ARCHIVABLE" });
  });

  it("blocks archiving while active users remain", () => {
    const plan = planArchive(archiveInput({ activeUserCount: 2 }));
    expect(plan).toMatchObject({ ok: false, code: "ROLE_HAS_ACTIVE_USERS" });
  });

  it("requires a reason", () => {
    const plan = planArchive(archiveInput({ reason: "  " }));
    expect(plan).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
  });

  it("blocks archiving an already-archived role", () => {
    const plan = planArchive(archiveInput({ role: { id: "t", key: null, name: "Old", isSystem: false, archived: true, version: 9 } }));
    expect(plan).toMatchObject({ ok: false, code: "ROLE_NOT_FOUND" });
  });
});