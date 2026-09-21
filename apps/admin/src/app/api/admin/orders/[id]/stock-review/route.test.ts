import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =========================================================
// POST /api/admin/orders/[id]/stock-review — route seam over the
// transactional stock-recheck claim service
// =========================================================
// The manual_review → reconciling claim + RECHECK_JUBELIO_STOCK audit live in
// `claimStockRecheck` (orders-service, see orders-service.test.ts). These
// tests pin the ROUTE seam:
//
// - the route NEVER performs separate writes — the only writes run inside the
//   service's one transaction;
// - the service's non-null `branchId` comes from the loaded order row — a
//   branchless order fails closed BEFORE the claim (no unsafe non-null
//   assertion), leaving the operation retryable;
// - the existing log events (invalid input, not claimable, queued, failure)
//   and the cross-branch 404 behaviour are preserved.

import { createFakeDb, type FakeDb } from "@/test-support/fake-db";
import {
  guardAllow,
  guardMock,
  jsonRequest,
  loggerModuleMock,
  makeLogger,
} from "@/test-support/route-test";

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

vi.mock("@/lib/rbac/guard", async () => {
  const helpers = await import("@/test-support/route-test");
  return {
    guard: helpers.guardMock,
    crossBranchNotFound: helpers.crossBranchNotFound,
  };
});

vi.mock("@/lib/logger", () => loggerModuleMock());

import { POST } from "./route";

const logger = makeLogger();

const orderRow = { branchId: "b-1" };
const branchlessOrderRow = { branchId: null };

const validBody = { operationId: "op-1" };

function params() {
  return Promise.resolve({ id: "o-1" });
}

function auditInserts(fake: FakeDb) {
  return fake.ops.filter(
    (op) => op.kind === "insert" && (op.values as { action?: string }).action !== undefined
  );
}

beforeEach(() => {
  guardMock.mockReset();
  guardAllow(logger, { homeBranchId: "b-1", scope: "all_branches" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/admin/orders/[id]/stock-review", () => {
  it("happy path: claims through the service seam (single tx) and returns 200", async () => {
    const fake = createFakeDb({
      selectQueue: [[orderRow]],
      mutationRows: [{ id: "op-1" }],
    });
    state.current = fake;

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/stock-review", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(logger.info).toHaveBeenCalledWith(
      "stock-review.queued",
      expect.objectContaining({ outcome: "success", operationId: "op-1" })
    );

    // The route performs no separate writes: exactly one update (the
    // conditional claim) and one audit insert, both on the tx executor.
    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    expect(updates[0].set).toMatchObject({ status: "reconciling" });
    const audits = auditInserts(fake);
    expect(audits).toHaveLength(1);
    expect(audits[0].isTx).toBe(true);
    expect(audits[0].values).toMatchObject({
      action: "RECHECK_JUBELIO_STOCK",
      entityType: "order",
      entityId: "o-1",
    });
    expect(fake.committed).toBe(true);
  });

  it("invalid input: 400 before any db access", async () => {
    const fake = createFakeDb();
    state.current = fake;

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/stock-review", "POST", { operationId: "" }),
      { params: params() }
    );

    expect(response.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledWith(
      "stock-review.invalid_input",
      expect.objectContaining({ outcome: "denied" })
    );
    expect(fake.ops).toHaveLength(0);
  });

  it("unknown order id: 404 with existence not disclosed", async () => {
    const fake = createFakeDb({ selectQueue: [[]] });
    state.current = fake;

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/stock-review", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(404);
    expect(fake.ops.filter((op) => op.kind === "update")).toHaveLength(0);
  });

  it("cross-branch order under own-branch scope: 404", async () => {
    guardAllow(logger, { homeBranchId: "b-1", scope: "own_branch" });
    const fake = createFakeDb({ selectQueue: [[{ branchId: "b-2" }]] });
    state.current = fake;

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/stock-review", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(404);
    expect(fake.ops.filter((op) => op.kind === "update")).toHaveLength(0);
  });

  it("branchless order: fails closed with 409 BEFORE the claim (no unsafe assertion)", async () => {
    const fake = createFakeDb({ selectQueue: [[branchlessOrderRow]] });
    state.current = fake;

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/stock-review", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Order is not branch-scoped",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "stock-review.order_branch_missing",
      expect.objectContaining({
        outcome: "denied",
        reason: "missing_order_branch",
        operationId: "op-1",
      })
    );
    // Nothing mutated, nothing audited, nothing committed.
    expect(fake.ops.filter((op) => op.kind === "update")).toHaveLength(0);
    expect(fake.ops.filter((op) => op.kind === "insert")).toHaveLength(0);
    expect(fake.committed).toBe(false);
  });

  it("operation no longer in manual_review: stable 409 without audit", async () => {
    const fake = createFakeDb({
      selectQueue: [[orderRow]],
      mutationRows: [],
    });
    state.current = fake;

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/stock-review", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Operation is no longer in manual review",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "stock-review.operation_not_claimable",
      expect.objectContaining({ outcome: "denied", operationId: "op-1" })
    );
    // The conditional claim matched no row, so the tx commits empty — but no
    // audit event may exist for a claim that did not happen.
    expect(auditInserts(fake)).toHaveLength(0);
    expect(fake.committed).toBe(true);
  });
});