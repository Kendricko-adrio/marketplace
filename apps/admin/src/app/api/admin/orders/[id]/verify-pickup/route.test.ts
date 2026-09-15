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

const fetchMock = vi.fn();

import { POST } from "./route";

const logger = makeLogger();

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
  guardAllow(logger, { homeBranchId: "b-1" });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("STORE_INTERNAL_URL", "http://store-internal");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
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
    expect(logger.info).toHaveBeenCalledWith(
      "verify-pickup.completed",
      expect.objectContaining({ outcome: "success", reconciled: false })
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
    expect(logger.warn).toHaveBeenCalledWith(
      "verify-pickup.order_complete_unreachable",
      expect.objectContaining({ outcome: "error" })
    );

    // Convergence happened in the seam's one transaction; no separate writes.
    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    expect(auditInserts(fake)).toHaveLength(1);
    expect(auditInserts(fake)[0].isTx).toBe(true);
    expect(fake.committed).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "verify-pickup.completed",
      expect.objectContaining({ outcome: "success", reconciled: true })
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
    expect(logger.error).toHaveBeenCalledWith(
      "verify-pickup.order_complete_failed",
      expect.objectContaining({ outcome: "error", httpStatus: 500 })
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
    expect(logger.error).toHaveBeenCalledWith(
      "verify-pickup.completion_not_finalized",
      expect.objectContaining({ outcome: "error", storeStatus: "ready_for_pickup" })
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