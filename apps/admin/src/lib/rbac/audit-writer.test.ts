import { describe, it, expect } from "vitest";

import { writeAuditEvent } from "./audit-writer";

// =========================================================
// Slice 4 follow-up review — audit-writer regression coverage.
// Drizzle query builders are LAZY: `executor.insert(t).values(v)` only runs
// when the chain is awaited. The writer must therefore await the insert —
// otherwise authorization audit events are silently never written. These
// tests pin that the insert actually executes (and that failures propagate
// so a failed audit write rolls the mutation transaction back).
// =========================================================

interface ExecutedInsert {
  table: unknown;
  values: Record<string, unknown>;
}

interface FakeExecutor {
  inserts: ExecutedInsert[];
  /** Fails the insert when set (simulates a DB error). */
  failure?: Error;
  insert(table: unknown): {
    values(values: Record<string, unknown>): Promise<{ rowCount: number }>;
  };
}

function fakeExecutor(failure?: Error): FakeExecutor {
  const inserts: ExecutedInsert[] = [];
  return {
    inserts,
    failure,
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          const promise = Promise.resolve().then(() => {
            if (failure) throw failure;
            inserts.push({ table, values });
            return { rowCount: 1 };
          }) as Promise<{ rowCount: number }>;
          return promise;
        },
      };
    },
  };
}

const baseInput = {
  actorId: "actor-1",
  action: "ROLE_UPDATED",
  entityType: "admin_role",
  entityId: "role-1",
  changes: { before: { name: "A" }, after: { name: "B" } },
  policyVersion: 7,
  branchScope: "global" as const,
};

describe("writeAuditEvent", () => {
  it("actually executes the insert (the chain is awaited)", async () => {
    const fake = fakeExecutor();
    await writeAuditEvent(fake as never, baseInput);
    expect(fake.inserts).toHaveLength(1);
  });

  it("records actor, action, entity, diff, policy version, and branch scope", async () => {
    const fake = fakeExecutor();
    await writeAuditEvent(fake as never, baseInput);
    const row = fake.inserts[0]!.values;
    expect(row.userId).toBe("actor-1");
    expect(row.action).toBe("ROLE_UPDATED");
    expect(row.entityType).toBe("admin_role");
    expect(row.entityId).toBe("role-1");
    expect(row.changes).toEqual(baseInput.changes);
    expect(row.policyVersion).toBe(7);
    expect(row.branchScope).toBe("global");
    expect(row.branchId).toBeNull();
    expect(row.relatedBranchId).toBeNull();
  });

  it("defaults optional classification fields to null", async () => {
    const fake = fakeExecutor();
    await writeAuditEvent(fake as never, {
      actorId: null,
      action: "ROLE_CREATED",
      entityType: "admin_role",
      entityId: "role-2",
    });
    const row = fake.inserts[0]!.values;
    expect(row.userId).toBeNull();
    expect(row.policyVersion).toBeNull();
    expect(row.branchScope).toBeNull();
    expect(row.changes).toBeNull();
  });

  it("propagates insert failures so mutation transactions roll back", async () => {
    const fake = fakeExecutor(new Error("audit insert failed"));
    await expect(
      writeAuditEvent(fake as never, baseInput)
    ).rejects.toThrow("audit insert failed");
  });
});