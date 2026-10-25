import { beforeEach, describe, expect, it, vi } from "vitest";

// =========================================================
// PUT + DELETE /api/admin/branches/[id] — route seam over the
// transactional service (BRANCH_IN_USE recheck runs inside the tx)
// =========================================================

import { createFakeDb } from "@/test-support/fake-db";
import {
  guardAllow,
  guardMock,
  jsonRequest,
  type RouteModuleLogger,
} from "@/test-support/route-test";

const state = vi.hoisted(() => ({
  current: null as import("@/test-support/fake-db").FakeDb | null,
}));

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

import { DELETE, PUT } from "./route";
import { branchRegion, mockShipmentRegions } from "@/test-support/shipment-regions";

/** Stub module logger milik route (dibuat saat `./route` diimpor). */
function moduleLog(): RouteModuleLogger {
  const value = captured.moduleLog;
  if (!value) throw new Error("module logger route belum dibuat");
  return value;
}

const branchId = "b-1";

const existingRow = {
  id: branchId,
  name: "Lama",
  code: "BRX",
  status: "aktif",
};

const updateBody = {
  ...branchRegion,
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
  mockShipmentRegions();
  guardMock.mockReset();
  guardAllow();
  moduleLog().info.mockClear();
  moduleLog().warn.mockClear();
  moduleLog().error.mockClear();
  setupDb();
});

describe("PUT /api/admin/branches/[id]", () => {
  it("requires region completion on every edit without mutation or audit", async () => {
    const fake = setupDb({ selectQueue: [[existingRow]] });
    const body: Record<string, unknown> = { ...updateBody };
    delete body.shippingProvinceId;
    const response = await PUT(jsonRequest(`/api/admin/branches/${branchId}`, "PUT", body), routeParams());
    expect(response.status).toBe(400);
    expect(fake.ops.filter((op) => op.kind !== "select")).toHaveLength(0);
  });
  it.each(Object.keys(branchRegion).flatMap((field) => [undefined, null, "", "abc", "9999"].map((value) => ({ field, value }))))("rejects $field=$value without mutation or audit", async ({ field, value }) => {
    const fake = setupDb({ selectQueue: [[existingRow]] });
    const response = await PUT(jsonRequest(`/api/admin/branches/${branchId}`, "PUT", { ...updateBody, [field]: value }), routeParams());
    expect(response.status).toBe(400);
    expect(fake.ops.filter((op) => op.kind !== "select")).toHaveLength(0);
  });

  it("own-branch editing conceals another branch before region lookup", async () => {
    guardAllow({ scope: "own_branch", homeBranchId: "other" });
    const fake = setupDb({ selectQueue: [[existingRow]] });
    expect((await PUT(jsonRequest(`/api/admin/branches/${branchId}`, "PUT", updateBody), routeParams())).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(fake.ops.filter((op) => op.kind !== "select")).toHaveLength(0);
  });

  it("own-branch editing can complete its Home Branch", async () => {
    guardAllow({ scope: "own_branch", homeBranchId: branchId });
    setupDb({ selectQueue: [[existingRow], [existingRow]] });
    expect((await PUT(jsonRequest(`/api/admin/branches/${branchId}`, "PUT", updateBody), routeParams())).status).toBe(200);
  });

  it("provider failure leaves mutation and audit untouched", async () => {
    const fake = setupDb({ selectQueue: [[existingRow]] });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Timeout"));
    const response = await PUT(jsonRequest(`/api/admin/branches/${branchId}`, "PUT", updateBody), routeParams());
    expect(response.status).toBe(503);
    expect(fake.ops.filter((op) => op.kind !== "select")).toHaveLength(0);
  });

  it("audits region changes from the locked row, preserving omitted sender values", async () => {
    const fake = setupDb({ selectQueue: [[existingRow], [{ ...existingRow, shippingProvinceId: "09", shippingProvince: "Before", shippingPhone: "0219999" }]] });
    expect((await PUT(jsonRequest(`/api/admin/branches/${branchId}`, "PUT", updateBody), routeParams())).status).toBe(200);
    const audit = fake.ops.find((op) => op.kind === "insert")!.values;
    expect(audit).toMatchObject({ changes: { shippingProvinceId: { from: "09", to: "01" }, shippingProvince: { from: "Before", to: "Provinsi Fixture" }, shippingAreaId: { from: null, to: "0102030004" } } });
    expect((audit as { changes: Record<string, unknown> }).changes).not.toHaveProperty("shippingPhone");
  });

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

  it("does not overwrite concurrent sender fields when PUT omits them", async () => {
    const fake = setupDb({ selectQueue: [
      [{ ...existingRow, shippingPhone: "021111111", shippingAddress: "Old origin", shippingPostalCode: "01234", shippingAreaId: null }],
      [{ ...existingRow, shippingPhone: "021222222", shippingAddress: "New origin", shippingPostalCode: "54321", shippingAreaId: "01010101" }],
    ] });
    const response = await PUT(jsonRequest(`/api/admin/branches/${branchId}`, "PUT", updateBody), routeParams());
    expect(response.status).toBe(200);
    const mutation = fake.ops.find((op) => op.kind === "update")!.set as Record<string, unknown>;
    for (const field of ["shippingPhone", "shippingAddress"]) expect(mutation[field]).toBeUndefined();
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
    expect(moduleLog().warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "branches.update ditolak: branch hilang di tengah request (branchId b-1, reason branch_deleted_concurrently, outcome denied)"
      )
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
    expect(moduleLog().error).toHaveBeenCalledWith(
      expect.stringContaining("branches.update gagal: transaksi DB (branchId b-1, outcome error)"),
      expect.anything()
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
    expect(moduleLog().warn).toHaveBeenCalledWith(
      expect.stringContaining("branches.delete ditolak: branch masih menjadi Home Branch admin (branchId b-1, reason home_branch_assignment, outcome denied)")
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