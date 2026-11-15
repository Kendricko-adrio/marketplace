import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// =========================================================
// GET /api/admin/branches — server-side search seam
// =========================================================
// Regression pin for the Branch admin list: the search term must narrow the
// SQL result set (name/code/city, case-insensitive) BEFORE the page slice, and
// the count query must carry the SAME predicate. Previously the term was only
// filtered in the browser over the rows of the current page, so matches living
// on page 2+ were invisible.
//
// Assertions render the recorded `.where()` argument through Drizzle's own
// Postgres dialect, so they pin the predicate semantics (target columns, bound
// value) instead of builder-object internals.

import { createFakeDb } from "@/test-support/fake-db";
import {
  guardAllow,
  guardDeny,
  guardMock,
  type RouteModuleLogger,
} from "@/test-support/route-test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

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

import { GET } from "./route";

/** Stub module logger milik route (dibuat saat `./route` diimpor). */
function moduleLog(): RouteModuleLogger {
  const value = captured.moduleLog;
  if (!value) throw new Error("module logger route belum dibuat");
  return value;
}

const dialect = new PgDialect();

function listRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost:3001/api/admin/branches${query}`);
}

function renderedWhere(where: unknown): { sql: string; params: unknown[] } | null {
  return where === undefined ? null : dialect.sqlToQuery(where as SQL);
}

/** Rows query + count query predicates, in execution order. */
function recordedWheres(): Array<{ sql: string; params: unknown[] }> {
  const selects = state.current!.ops.filter((op) => op.kind === "select");
  expect(selects).toHaveLength(2); // list rows + pagination count
  return selects.map((op) => {
    const rendered = renderedWhere(op.where);
    expect(rendered, "every list query must carry its filter").not.toBeNull();
    return rendered!;
  });
}

const pageRow = {
  id: "b-2",
  name: "Cabang Puncak",
  code: "PCK",
  city: "Bandung",
  address: "Jl. Puncak 1",
  status: "aktif",
};

beforeEach(() => {
  guardMock.mockReset();
  guardAllow();
  moduleLog().info.mockClear();
  moduleLog().warn.mockClear();
  moduleLog().error.mockClear();
  state.current = createFakeDb({
    selectQueue: [[pageRow], [{ count: "1" }]],
  });
});

describe("GET /api/admin/branches — search", () => {
  it("filters name/code/city in SQL for both the rows and the count query", async () => {
    const response = await GET(listRequest("?search=bandung"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([pageRow]);
    // The count comes from the same filtered predicate, not from the whole
    // table: one matching Branch → one page.
    expect(body.pagination).toMatchObject({ total: 1, totalPages: 1 });

    for (const where of recordedWheres()) {
      expect(where.sql).toMatch(/"branch"\."name" ilike/);
      expect(where.sql).toMatch(/"branch"\."code" ilike/);
      expect(where.sql).toMatch(/"branch"\."city" ilike/);
      // Case-insensitive partial match, not an exact match.
      expect(where.params).toEqual(["%bandung%", "%bandung%", "%bandung%"]);
    }
  });

  it("trims the term and treats a blank search as no filter", async () => {
    await GET(listRequest("?search=%20%20%20"));

    const selects = state.current!.ops.filter((op) => op.kind === "select");
    // All-branch scope + blank search → no predicate at all (no ilike, no
    // branch_id), i.e. the unfiltered list is not accidentally emptied.
    for (const op of selects) {
      expect(op.where).toBeUndefined();
    }
  });

  it("keeps the own-branch predicate together with the search filter", async () => {
    guardMock.mockReset();
    guardAllow({ scope: "own_branch", homeBranchId: "b-1" });
    state.current = createFakeDb({
      selectQueue: [[pageRow], [{ count: "1" }]],
    });

    const response = await GET(listRequest("?search=cabang"));
    expect(response.status).toBe(200);

    for (const where of recordedWheres()) {
      expect(where.sql).toMatch(/"branch"\."id" =/);
      expect(where.sql).toMatch(/"branch"\."city" ilike/);
      expect(where.params).toContain("b-1");
      expect(where.params).toContain("%cabang%");
    }
  });

  it("keeps the requested page and reports totals from the filtered count", async () => {
    state.current = createFakeDb({
      selectQueue: [[pageRow], [{ count: "23" }]],
    });

    const response = await GET(listRequest("?page=2&limit=10&search=cabang"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 23,
      totalPages: 3,
    });
  });

  it("fails closed with 403 when an own-branch grant has no Home Branch", async () => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: "admin-1" },
        policy: { policyVersion: 7, user: {} },
        authorization: { allowed: true, scope: "own_branch" },
      },
    });
    state.current = createFakeDb();

    const response = await GET(listRequest("?search=cabang"));

    expect(response.status).toBe(403);
    expect(state.current!.ops).toHaveLength(0);
  });

  it("passes the guard denial through unchanged", async () => {
    const denial = NextResponse.json(
      { success: false, error: "Forbidden", code: "DENIED" },
      { status: 403 }
    );
    guardMock.mockReset();
    guardDeny(denial);
    state.current = createFakeDb();

    const response = await GET(listRequest("?search=cabang"));

    expect(response.status).toBe(403);
    expect(state.current!.ops).toHaveLength(0);
  });
});
