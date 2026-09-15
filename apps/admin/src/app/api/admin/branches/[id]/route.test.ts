import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// =========================================================
// PUT + DELETE /api/admin/branches/[id] — route seam over the
// transactional service (BRANCH_IN_USE recheck runs inside the tx)
// =========================================================

import { createFakeDb } from "@/test-support/fake-db";
import {
  guardAllow,
  guardMock,
  jsonRequest,
  loggerModuleMock,
  makeLogger,
  type RouteLogger,
} from "@/test-support/route-test";

const state = vi.hoisted(() => ({
  current: null as import("@/test-support/fake-db").FakeDb | null,
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

vi.mock("@/lib/logger", () => loggerModuleMock());

import { DELETE, PUT } from "./route";

const logger = makeLogger();
const branchId = "b-1";

const existingRow = {
  id: branchId,
  name: "Lama",
  code: "BRX",
  status: "aktif",
};

const updateBody = {
  name: "Baru",
  code: "BRX",
  city: "Jakarta",
  address: "Jl. Testing 1",
  operatingHours: {},
  status: "nonaktif",
};

function routeParams() {
  return { params: Promise.resolve({ id: branchId }) };
}

function setupDb(
  config: Parameters<typeof createFakeDb>[0] = {}
): ReturnType<typeof createFakeDb> {
  const fake = createFakeDb(config);
  state.current = fake;
  return fake;
}

beforeEach(() => {
  guardMock.mockReset();
  guardAllow(logger);
  setupDb();
});

describe("PUT /api/admin/branches/[id]", () => {
  it("returns 200 and runs the mutation + audit in one tx", async () => {
    const fake = setupDb({
      // 1) route pre-check, 2) service locked recheck
      selectQueue: [[existingRow], [existingRow]],
    });

    const response = await PUT(
      jsonRequest(`/api/admin/branches/${branchId}`, "PUT", updateBody),
      routeParams()
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { id: branchId } });

    const updates = fake.ops.filter((op) => op.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].isTx).toBe(true);
    const inserts = fake.ops.filter(
      (op) => op.kind === "insert" && (op.values as { action?: string }).action !== undefined
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].isTx).toBe(true);
    expect(inserts[0].values).toMatchObject({ action: "UPDATE_BRANCH" });
  });

  it("maps a vanished-mid-request branch to the stable 404", async () => {
    setupDb({
      // 1) route pre-check finds the row, 2) tx recheck finds it gone
      selectQueue: [[existingRow], []],
    });

    const response = await PUT(
      jsonRequest(`/api/admin/branches/${branchId}`, "PUT", updateBody),
      routeParams()
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: "Branch not found",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "branches.update.vanished_mid_request",
      expect.anything()
    );
  });

  it("logs context and returns the stable 500 when the tx fails", async () => {
    setupDb({
      selectQueue: [[existingRow], [existingRow]],
      failUpdate: () => true,
    });

    const response = await PUT(
      jsonRequest(`/api/admin/branches/${branchId}`, "PUT", updateBody),
      routeParams()
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Failed to update branch",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "branches.update.db_failure",
      expect.objectContaining({ outcome: "error" })
    );
  });
});

describe("DELETE /api/admin/branches/[id]", () => {
  it("requires the all-branches delete scope", async () => {
    await DELETE(jsonRequest(`/api/admin/branches/${branchId}`, "DELETE"), routeParams());

    expect(guardMock).toHaveBeenCalledWith(
      "branches",
      "delete",
      expect.objectContaining({ requiredScope: "all_branches" })
    );
  });

  it("returns 200 and runs delete + audit in one tx", async () => {
    const fake = setupDb({
      // 1) locked branch row, 2) no assigned admins
      selectQueue: [[existingRow], []],
    });

    const response = await DELETE(
      jsonRequest(`/api/admin/branches/${branchId}`, "DELETE"),
      routeParams()
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const deletes = fake.ops.filter((op) => op.kind === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].isTx).toBe(true);
    const selects = fake.ops.filter((op) => op.kind === "select");
    expect(selects[0].lock).toBe("update");
    const inserts = fake.ops.filter(
      (op) => op.kind === "insert" && (op.values as { action?: string }).action !== undefined
    );
    expect(inserts[0].isTx).toBe(true);
    expect(inserts[0].values).toMatchObject({ action: "DELETE_BRANCH" });
  });

  it("maps BRANCH_IN_USE (rechecked inside the tx) to the stable 409", async () => {
    setupDb({
      // 1) locked branch row, 2) one assigned admin
      selectQueue: [[existingRow], [{ id: "admin-1" }]],
    });

    const response = await DELETE(
      jsonRequest(`/api/admin/branches/${branchId}`, "DELETE"),
      routeParams()
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "BRANCH_IN_USE",
      error:
        "Branch masih memiliki admin. Pindahkan admin sebelum menghapus branch.",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "branches.delete.branch_in_use",
      expect.objectContaining({ outcome: "denied" })
    );
    expect(state.current!.ops.filter((op) => op.kind === "delete")).toHaveLength(0);
  });

  it("maps a missing branch to the stable 404", async () => {
    setupDb({ selectQueue: [[]] });

    const response = await DELETE(
      jsonRequest(`/api/admin/branches/${branchId}`, "DELETE"),
      routeParams()
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: "Branch not found",
    });
  });
});