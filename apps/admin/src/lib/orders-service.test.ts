import { beforeEach, describe, expect, it, vi } from "vitest";

// =========================================================
// orders-service — transactional stock-review claim + pickup finalization
// =========================================================
// - `claimStockRecheck` (stock-review route): the manual_review → reconciling
//   claim and its RECHECK_JUBELIO_STOCK audit event run in ONE tx.
// - `finalizePickupCompletion` (verify-pickup route): the post-external local
//   finalization (attempt reset + VERIFY_PICKUP_CODE audit) runs in ONE tx
//   with a locked status re-check; it is the reconciliation/idempotency seam
//   for the unavoidable external store order-complete HTTP boundary.

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
  claimStockRecheck,
  finalizePickupCompletion,
  type OrderMutationContext,
} from "./orders-service";

const ctx: OrderMutationContext = {
  actorId: "actor-1",
  policyVersion: 7,
  branchId: "b-1",
};

beforeEach(() => {
  state.current = createFakeDb();
});

describe("claimStockRecheck", () => {
  it("claims the operation and writes the audit event on the same tx executor", async () => {
    const fake = createFakeDb({
      mutationRows: [{ id: "op-1" }],
    });
    state.current = fake;

    const result = await claimStockRecheck("o-1", "op-1", ctx);

    expect(result.claimed).toBe(true);
    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    expect(updates[0].set).toMatchObject({ status: "reconciling" });
    const audits = fake.ops.filter(
      (op) => op.kind === "insert" && (op.values as { action?: string }).action !== undefined
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].isTx).toBe(true);
    expect(audits[0].values).toMatchObject({
      action: "RECHECK_JUBELIO_STOCK",
      entityType: "order",
      entityId: "o-1",
    });
  });

  it("reports not-claimable (no 409-side effects) when the conditional claim matches no row", async () => {
    const fake = createFakeDb({ mutationRows: [] });
    state.current = fake;

    const result = await claimStockRecheck("o-1", "op-1", ctx);

    expect(result.claimed).toBe(false);
    // No audit event may be written for a claim that did not happen.
    expect(
      fake.ops.filter(
        (op) => op.kind === "insert" && (op.values as { action?: string }).action !== undefined
      )
    ).toHaveLength(0);
  });
});

describe("finalizePickupCompletion", () => {
  it("resets attempts and audits on one tx executor when the order is completed", async () => {
    const fake = createFakeDb({
      selectQueue: [[{ id: "o-1", status: "completed", pickupVerificationAttempts: 3 }]],
      mutationRows: [],
    });
    state.current = fake;

    const result = await finalizePickupCompletion("o-1", ctx);

    expect(result.finalized).toBe(true);
    const selects = fake.ops.filter((op) => op.kind === "select");
    expect(selects).toHaveLength(1);
    expect(selects[0].isTx).toBe(true);
    expect(selects[0].lock).toBe("update");
    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    expect(updates[0].set).toMatchObject({ pickupVerificationAttempts: 0 });
    const audits = fake.ops.filter(
      (op) => op.kind === "insert" && (op.values as { action?: string }).action !== undefined
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].isTx).toBe(true);
    expect(audits[0].values).toMatchObject({
      action: "VERIFY_PICKUP_CODE",
      entityId: "o-1",
    });
  });

  it("reports not-finalized without writing anything when the order is not completed", async () => {
    const fake = createFakeDb({
      selectQueue: [[{ id: "o-1", status: "ready_for_pickup", pickupVerificationAttempts: 1 }]],
      mutationRows: [],
    });
    state.current = fake;

    const result = await finalizePickupCompletion("o-1", ctx);

    expect(result).toEqual({ finalized: false, status: "ready_for_pickup" });
    expect(fake.ops.filter((op) => op.kind === "update")).toHaveLength(0);
    expect(fake.ops.filter((op) => op.kind === "insert")).toHaveLength(0);
  });
});