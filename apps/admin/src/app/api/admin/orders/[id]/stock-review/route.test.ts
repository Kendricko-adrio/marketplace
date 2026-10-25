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
//
// Logging: the route uses one module-scoped facade logger, so assertions read
// the SAME stub the module created (`captured.moduleLog`) and the business
// facts (order id, operation id, outcome) are asserted from the `message` —
// the contract forbids free business fields on the log record.

import { createFakeDb, type FakeDb } from "@/test-support/fake-db";
import {
  guardAllow,
  guardMock,
  jsonRequest,
  type RouteModuleLogger,
} from "@/test-support/route-test";

const state = vi.hoisted(() => ({ current: null as FakeDb | null }));

/**
 * Stub module logger yang dipakai route. `vi.hoisted` menjaga container ini
 * sudah ada saat factory mock dievaluasi (import `./route` berjalan lebih dulu
 * daripada body file test).
 */
const captured = vi.hoisted(() => ({
  moduleLog: null as RouteModuleLogger | null,
}));

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

vi.mock("@/lib/logger", async () => {
  const helpers = await import("@/test-support/route-test");
  // Route membuat logger sekali di module scope; satu stub dibagikan supaya
  // assertion membaca event yang benar-benar ditulis route.
  const shared = helpers.makeModuleLogger();
  captured.moduleLog = shared;
  return {
    ...(await helpers.loggerModuleMock()),
    createModuleLogger: () => shared,
  };
});

import { POST } from "./route";

/** Stub module logger milik route (dibuat saat `./route` diimpor). */
function moduleLog(): RouteModuleLogger {
  const value = captured.moduleLog;
  if (!value) throw new Error("module logger route belum dibuat");
  return value;
}

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
  guardAllow({ homeBranchId: "b-1", scope: "all_branches" });
  moduleLog().info.mockClear();
  moduleLog().warn.mockClear();
  moduleLog().error.mockClear();
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
    expect(moduleLog().info).toHaveBeenCalledWith(
      expect.stringContaining(
        "stock-review queued (order o-1, operation op-1, scope all, outcome success)"
      )
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
    expect(moduleLog().warn).toHaveBeenCalledWith(
      expect.stringContaining("stock-review ditolak: body tidak valid")
    );
    expect(moduleLog().warn).toHaveBeenCalledWith(
      expect.stringContaining("order o-1, outcome denied")
    );
    // Warn-only: the denied path never escalates to an error line.
    expect(moduleLog().error).not.toHaveBeenCalled();
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
    guardAllow({ homeBranchId: "b-1", scope: "own_branch" });
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
    expect(moduleLog().warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "stock-review ditolak: order tanpa branch (order o-1, operation op-1, reason missing_order_branch, outcome denied)"
      )
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
    expect(moduleLog().warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "stock-review ditolak: operation tidak lagi manual_review (order o-1, operation op-1, outcome denied)"
      )
    );
    // The conditional claim matched no row, so the tx commits empty — but no
    // audit event may exist for a claim that did not happen.
    expect(auditInserts(fake)).toHaveLength(0);
    expect(fake.committed).toBe(true);
  });
});
