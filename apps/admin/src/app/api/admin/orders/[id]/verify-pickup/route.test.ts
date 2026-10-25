import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =========================================================
// POST /api/admin/orders/[id]/verify-pickup — route seam over the
// transactional finalization service
// =========================================================
// The attempt reset + VERIFY_PICKUP_CODE audit live in
// `finalizePickupCompletion` (orders-service, see orders-service.test.ts).
// These tests pin the ROUTE seam around the unavoidable external store
// order-complete HTTP boundary:
//
// - the route NEVER performs separate writes — every write goes through the
//   seam's single transaction;
// - on the happy path the seam runs after the external call succeeds;
// - on an AMBIGUOUS failure (fetch throw or non-OK answer) the route still
//   invokes the same seam, so a store-completed / local-not-audited order
//   converges idempotently;
// - when the seam does not finalize (store did not complete the order) the
//   stable 502 is returned with nothing mutated.
//
// Logging: the route uses one module-scoped facade logger, so assertions read
// the SAME stub the module created and the business facts (order id, http
// status, store status, outcome) come from the `message`. The caught value and
// the store response body are never logged — only a static error projection.

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

const fetchMock = vi.fn();

import { POST } from "./route";

/** Stub module logger milik route (dibuat saat `./route` diimpor). */
function moduleLog(): RouteModuleLogger {
  const value = captured.moduleLog;
  if (!value) throw new Error("module logger route belum dibuat");
  return value;
}

const orderRow = {
  id: "o-1",
  branchId: "b-1",
  status: "ready_for_pickup",
  pickupCode: "ABCD12",
  pickupVerificationAttempts: 1,
  pickupLockedUntil: null,
};

const completedRow = { ...orderRow, status: "completed" };

const validBody = { pickupCodeInput: "abcd12" };

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
  guardAllow({ homeBranchId: "b-1" });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("STORE_INTERNAL_URL", "http://store-internal");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  moduleLog().info.mockClear();
  moduleLog().warn.mockClear();
  moduleLog().error.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/admin/orders/[id]/verify-pickup", () => {
  it("happy path: runs the finalization seam (single tx) and returns 200", async () => {
    const fake = createFakeDb({
      selectQueue: [[orderRow], [completedRow]],
      mutationRows: [],
    });
    state.current = fake;
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/verify-pickup", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      message: "Order completed successfully",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Every write went through the seam's one transaction: exactly one update
    // (attempt reset) and one audit insert, both on the tx executor — never a
    // separate route-level write.
    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    expect(updates[0].set).toMatchObject({ pickupVerificationAttempts: 0 });
    const audits = auditInserts(fake);
    expect(audits).toHaveLength(1);
    expect(audits[0].isTx).toBe(true);
    expect(audits[0].values).toMatchObject({
      action: "VERIFY_PICKUP_CODE",
      entityType: "order",
      entityId: "o-1",
    });
    expect(fake.committed).toBe(true);
    expect(moduleLog().info).toHaveBeenCalledWith(
      expect.stringContaining(
        "verify-pickup selesai (order o-1, userId admin-1, reconciled false, outcome success)"
      )
    );
  });

  it("ambiguous fetch throw: reconciles through the seam when the store completed the order", async () => {
    const fake = createFakeDb({
      selectQueue: [[orderRow], [completedRow]],
      mutationRows: [],
    });
    state.current = fake;
    fetchMock.mockRejectedValue(new Error("network unreachable"));

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/verify-pickup", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    // The thrown value is never logged; only the static projection goes in the
    // `error` field while the business fact stays in the message.
    expect(moduleLog().warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "verify-pickup: order-complete tidak dapat dihubungi (order o-1, outcome error)"
      ),
      expect.any(Error)
    );

    // Convergence happened in the seam's one transaction; no separate writes.
    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    expect(auditInserts(fake)).toHaveLength(1);
    expect(auditInserts(fake)[0].isTx).toBe(true);
    expect(fake.committed).toBe(true);
    expect(moduleLog().info).toHaveBeenCalledWith(
      expect.stringContaining(
        "verify-pickup selesai (order o-1, userId admin-1, reconciled true, outcome success)"
      )
    );
  });

  it("ambiguous non-OK response: reconciles through the seam when the store completed the order", async () => {
    const fake = createFakeDb({
      selectQueue: [[orderRow], [completedRow]],
      mutationRows: [],
    });
    state.current = fake;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 })
    );

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/verify-pickup", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(moduleLog().error).toHaveBeenCalledWith(
      expect.stringContaining(
        "verify-pickup: order-complete menolak (order o-1, httpStatus 500, outcome error)"
      ),
      expect.any(Error)
    );

    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    expect(auditInserts(fake)).toHaveLength(1);
    expect(auditInserts(fake)[0].isTx).toBe(true);
  });

  it("returns the stable 502 with nothing mutated when the seam does not finalize (fetch throw)", async () => {
    const fake = createFakeDb({
      selectQueue: [[orderRow], [orderRow]],
      mutationRows: [],
    });
    state.current = fake;
    fetchMock.mockRejectedValue(new Error("network unreachable"));

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/verify-pickup", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Failed to complete order. Please try again.",
    });
    // No attempt reset and no audit — the verification stays retryable.
    expect(fake.ops.filter((op) => op.kind === "update")).toHaveLength(0);
    expect(fake.ops.filter((op) => op.kind === "insert")).toHaveLength(0);
    expect(moduleLog().error).toHaveBeenCalledWith(
      expect.stringContaining(
        "verify-pickup: completion tidak final (order o-1, externalOk false, httpStatus none, storeStatus ready_for_pickup, outcome error)"
      ),
      expect.any(Error)
    );
  });

  it("returns the stable 502 with nothing mutated when the seam does not finalize (non-OK response)", async () => {
    const fake = createFakeDb({
      selectQueue: [[orderRow], [orderRow]],
      mutationRows: [],
    });
    state.current = fake;
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));

    const response = await POST(
      jsonRequest("/api/admin/orders/o-1/verify-pickup", "POST", validBody),
      { params: params() }
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Failed to complete order. Please try again.",
    });
    expect(fake.ops.filter((op) => op.kind === "update")).toHaveLength(0);
    expect(fake.ops.filter((op) => op.kind === "insert")).toHaveLength(0);
  });
});
