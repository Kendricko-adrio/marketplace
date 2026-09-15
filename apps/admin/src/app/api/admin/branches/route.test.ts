import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// =========================================================
// POST /api/admin/branches — route seam over the transactional service
// =========================================================
// The mutation + audit transaction lives in branches-service (see
// branches-service.test.ts); these tests pin the ROUTE seam: guard
// requirements, stable responses, and failure logging — with the real
// service running against a fake executor.

import { createFakeDb, type FakeDb } from "@/test-support/fake-db";
import {
  guardAllow,
  guardDeny,
  guardMock,
  jsonRequest,
  loggerModuleMock,
  makeLogger,
} from "@/test-support/route-test";

const state = vi.hoisted(() => ({ current: null as import("@/test-support/fake-db").FakeDb | null }));

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

const validBody = {
  name: "Branch Baru",
  code: "BRX",
  city: "Jakarta",
  address: "Jl. Testing 1",
  latitude: "-6.2",
  longitude: "106.8",
  operatingHours: {},
  googleMapsUrl: "",
  status: "aktif",
};

const createdRow = { id: "b-new", name: "Branch Baru", code: "BRX" };

beforeEach(() => {
  guardMock.mockReset();
  guardAllow(logger);
  state.current = createFakeDb({ mutationRows: [createdRow] });
});

describe("POST /api/admin/branches", () => {
  it("requires the all-branches edit scope", async () => {
    await POST(jsonRequest("/api/admin/branches", "POST", validBody));

    expect(guardMock).toHaveBeenCalledWith(
      "branches",
      "edit",
      expect.objectContaining({ requiredScope: "all_branches" })
    );
  });

  it("returns 201 with the created row and runs mutation + audit in one tx", async () => {
    const fake = createFakeDb({ mutationRows: [createdRow] });
    state.current = fake;

    const response = await POST(
      jsonRequest("/api/admin/branches", "POST", validBody)
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, data: createdRow });

    const inserts = fake.ops.filter((op) => op.kind === "insert");
    expect(inserts).toHaveLength(2); // branch row + audit event
    expect(inserts.every((op) => op.isTx)).toBe(true);
    expect(fake.committed).toBe(true);
  });

  it("passes the guard denial through unchanged", async () => {
    const denial = NextResponse.json(
      { success: false, error: "Forbidden", code: "DENIED" },
      { status: 403 }
    );
    guardDeny(denial);
    state.current = createFakeDb();

    const response = await POST(
      jsonRequest("/api/admin/branches", "POST", validBody)
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "Forbidden",
      code: "DENIED",
    });
    expect(state.current!.ops).toHaveLength(0);
  });

  it("returns the stable 400 for an invalid body without touching the db", async () => {
    state.current = createFakeDb();

    const response = await POST(
      jsonRequest("/api/admin/branches", "POST", { name: "" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "Invalid request body",
    });
    expect(state.current!.ops).toHaveLength(0);
  });

  it("logs context and returns the stable 500 when the tx fails", async () => {
    const fake = createFakeDb({
      mutationRows: [createdRow],
      failInsert: (values) =>
        (values as { action?: string }).action === undefined,
    });
    state.current = fake;

    const response = await POST(
      jsonRequest("/api/admin/branches", "POST", validBody)
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Failed to create branch",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "branches.create.db_failure",
      expect.objectContaining({ branchId: expect.any(String) })
    );
  });
});