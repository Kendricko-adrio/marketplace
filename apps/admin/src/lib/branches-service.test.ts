import { beforeEach, describe, expect, it, vi } from "vitest";

// =========================================================
// branches-service — transactional mutation + audit seams
// =========================================================
// Every branch mutation (create/update/delete) and its audit event MUST run
// inside ONE local DB transaction, with the tx executor passed to
// `writeAuditEvent`. The delete path additionally locks the branch row and
// re-checks BRANCH_IN_USE *inside* that transaction so a concurrent admin
// assignment cannot slip between check and delete.
//
// The seam under test is the service boundary against the Drizzle executor;
// the fake executor records which executor ran which statement and simulates
// commit/rollback around the transaction callback.

import { createFakeDb, type FakeDb } from "../test-support/fake-db";

const state = vi.hoisted(() => ({ current: null as FakeDb | null }));

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  return {
    ...actual,
    get db() {
      return state.current!.db;
    },
  };
});

import {
  BranchServiceError,
  createBranch,
  deleteBranch,
  updateBranch,
  type BranchMutationContext,
} from "./branches-service";

const ctx: BranchMutationContext = { actorId: "actor-1", policyVersion: 7 };

const branchInput = {
  name: "Branch Baru",
  code: "BRX",
  city: "Jakarta",
  address: "Jl. Testing 1",
  latitude: "-6.2",
  longitude: "106.8",
  operatingHours: {},
  googleMapsUrl: null,
  status: "aktif" as const,
};

const existingBranchRow = {
  id: "b-1",
  name: "Lama",
  code: "BRX",
  city: "Jakarta",
  address: "Jl. Testing 1",
  status: "aktif",
};

function auditInsertOps(fake: FakeDb) {
  return fake.ops.filter((op) => op.kind === "insert" && op.values !== undefined);
}

beforeEach(() => {
  state.current = createFakeDb();
});

describe("createBranch", () => {
  it("runs the insert and the audit event on the same tx executor", async () => {
    const fake = createFakeDb({
      mutationRows: [{ id: "b-new", ...branchInput }],
    });
    state.current = fake;

    const created = await createBranch({ ...branchInput, id: "b-new" }, ctx);

    expect(created.id).toBe("b-new");
    const inserts = fake.ops.filter((op) => op.kind === "insert");
    expect(inserts).toHaveLength(2); // branch row + audit event
    expect(inserts.every((op) => op.isTx)).toBe(true);
    // The audit event must receive the tx executor, not the raw db.
    const [branchInsert, auditInsert] = inserts;
    expect(branchInsert.values).toMatchObject({ id: "b-new", name: "Branch Baru" });
    expect(auditInsert.values).toMatchObject({
      action: "CREATE_BRANCH",
      entityType: "branch",
      entityId: "b-new",
    });
  });

  it("propagates an audit-write failure so the insert rolls back", async () => {
    const fake = createFakeDb({
      mutationRows: [{ id: "b-new" }],
      failInsert: (values) => (values as { action?: string }).action !== undefined,
    });
    state.current = fake;

    await expect(createBranch({ ...branchInput, id: "b-new" }, ctx)).rejects.toThrow();
    expect(fake.rolledBack).toBe(true);
    // Both statements ran inside the (aborted) tx — nothing is committed.
    expect(fake.committed).toBe(false);
  });
});

describe("updateBranch", () => {
  it("locks the branch row, re-checks existence, updates and audits in one tx", async () => {
    const fake = createFakeDb({
      selectQueue: [[existingBranchRow]],
      mutationRows: [],
    });
    state.current = fake;

    const previous = await updateBranch("b-1", { ...branchInput, status: "nonaktif" as const }, ctx);

    expect(previous.name).toBe("Lama");
    const selects = fake.ops.filter((op) => op.kind === "select");
    expect(selects).toHaveLength(1);
    expect(selects[0].isTx).toBe(true);
    expect(selects[0].lock).toBe("update");
    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    const auditOps = auditInsertOps(fake);
    expect(auditOps).toHaveLength(1);
    expect(auditOps[0].isTx).toBe(true);
    expect(auditOps[0].values).toMatchObject({
      action: "UPDATE_BRANCH",
      entityId: "b-1",
      changes: { status: { from: "aktif", to: "nonaktif" } },
    });
  });

  it("throws NOT_FOUND and skips the update + audit when the recheck finds no row", async () => {
    const fake = createFakeDb({ selectQueue: [[]] });
    state.current = fake;

    await expect(
      updateBranch("gone", { ...branchInput, status: "nonaktif" as const }, ctx)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(fake.ops.filter((op) => op.kind === "update")).toHaveLength(0);
    expect(auditInsertOps(fake)).toHaveLength(0);
  });
});

describe("deleteBranch", () => {
  it("deletes and audits on the same tx executor", async () => {
    const fake = createFakeDb({
      // 1) locked branch row, 2) no assigned admins
      selectQueue: [[existingBranchRow], []],
      mutationRows: [],
    });
    state.current = fake;

    const deleted = await deleteBranch("b-1", ctx);

    expect(deleted.name).toBe("Lama");
    const selects = fake.ops.filter((op) => op.kind === "select");
    expect(selects).toHaveLength(2);
    expect(selects.every((op) => op.isTx)).toBe(true);
    expect(selects[0].lock).toBe("update");
    const deletes = fake.ops.filter((op) => op.kind === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].isTx).toBe(true);
    const auditOps = auditInsertOps(fake);
    expect(auditOps[0].values).toMatchObject({
      action: "DELETE_BRANCH",
      entityId: "b-1",
    });
  });

  it("rejects with BRANCH_IN_USE (checked inside the tx) and skips delete + audit", async () => {
    const fake = createFakeDb({
      // 1) locked branch row, 2) one assigned admin
      selectQueue: [[existingBranchRow], [{ id: "admin-1" }]],
      mutationRows: [],
    });
    state.current = fake;

    await expect(deleteBranch("b-1", ctx)).rejects.toMatchObject({
      code: "BRANCH_IN_USE",
    });
    expect(fake.committed).toBe(false);
    expect(fake.ops.filter((op) => op.kind === "delete")).toHaveLength(0);
    expect(auditInsertOps(fake)).toHaveLength(0);
  });

  it("throws NOT_FOUND when the locked recheck finds no row", async () => {
    const fake = createFakeDb({ selectQueue: [[]] });
    state.current = fake;

    await expect(deleteBranch("gone", ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fake.ops.filter((op) => op.kind === "delete")).toHaveLength(0);
  });

  it("exposes BRANCH_IN_USE as a BranchServiceError the route can map", async () => {
    const fake = createFakeDb({
      selectQueue: [[existingBranchRow], [{ id: "admin-1" }]],
    });
    state.current = fake;

    const error = await deleteBranch("b-1", ctx).catch((e) => e);
    expect(error).toBeInstanceOf(BranchServiceError);
    expect(error.code).toBe("BRANCH_IN_USE");
  });
});