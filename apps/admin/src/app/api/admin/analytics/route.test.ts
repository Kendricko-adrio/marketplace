import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// =========================================================
// GET /api/admin/analytics — route seam over the consolidated queries
// =========================================================
// These tests pin the ROUTE seam: guard requirements, the additive response
// contract (original fields + averageOrderValue + a 30-entry zero-filled WIB
// trend), the exactly-four-concurrent-queries shape, fail-closed branch scope,
// and failure logging — with a fake executor standing in for Drizzle.

import { createFakeDb } from "@/test-support/fake-db";
import {
  guardAllow,
  guardDeny,
  guardMock,
  loggerModuleMock,
  makeLogger,
} from "@/test-support/route-test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// Frozen clock: 2025-06-15T18:30Z = 2025-06-16T01:30 WIB → the 30 WIB trend
// days are 2025-05-18 … 2025-06-16 (hand-computed literals below).
const FROZEN_NOW = new Date("2025-06-15T18:30:00Z");

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

import { GET } from "./route";

const logger = makeLogger();

function getRequest(): NextRequest {
  return new NextRequest("http://localhost:3001/api/admin/analytics");
}

// Renders a recorded `.where()` argument through Drizzle's Postgres dialect —
// the SQL text + parameters the DB would actually receive. This asserts the
// SEMANTICS of the predicate (which column, which bound value) without
// coupling to builder-object internals; the real-DB E2E spec remains the
// authority for exact revenue-aggregate behavior.
const dialect = new PgDialect();

function renderedWhere(where: unknown): {
  sql: string;
  params: unknown[];
} | null {
  return where === undefined ? null : dialect.sqlToQuery(where as SQL);
}

// One row per started query, consumed in build order: KPI, trend, statuses,
// recent orders.
const kpiRow = {
  totalRevenue: "240000",
  revenueOrderCount: "3",
  monthlyRevenue: "80000.50",
  weeklyOrders: "2",
  totalOrders: "10",
  totalCustomers: "4",
};
const trendRows = [
  { day: "2025-05-19", revenue: "40000.50", orders: "1" },
  { day: "2025-06-16", revenue: "120000", orders: "2" },
];
const statusRows = [
  { status: "completed", count: "6" },
  { status: "pending_payment", count: "4" },
];
const recentRow = {
  id: "o-1",
  total: "111000",
  status: "completed",
  createdAt: new Date("2025-06-15T10:00:00Z"),
  customer: "John Doe",
};

beforeEach(() => {
  vi.useFakeTimers({ now: FROZEN_NOW });
  guardMock.mockReset();
  guardAllow(logger);
  state.current = createFakeDb({
    selectQueue: [[kpiRow], trendRows, statusRows, [recentRow]],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/admin/analytics", () => {
  it("requires the analytics view grant via the unified guard", async () => {
    await GET(getRequest());

    expect(guardMock).toHaveBeenCalledWith(
      "analytics",
      "view",
      expect.objectContaining({ request: expect.anything() })
    );
  });

  it("returns the additive contract: original fields + averageOrderValue + 30-day WIB trend", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    const body = await response.json();

    // Original fields preserved.
    expect(body.success).toBe(true);
    expect(body.data.totalRevenue).toBe(240000);
    expect(body.data.monthlyRevenue).toBe(80000.5);
    expect(body.data.totalOrders).toBe(10);
    expect(body.data.weeklyOrders).toBe(2);
    expect(body.data.totalCustomers).toBe(4);
    expect(body.data.ordersByStatus).toEqual([
      { status: "completed", count: 6 },
      { status: "pending_payment", count: 4 },
    ]);
    expect(body.data.recentOrders).toHaveLength(1);
    expect(body.data.recentOrders[0]).toMatchObject({
      id: "o-1",
      total: "111000",
      status: "completed",
      customer: "John Doe",
    });

    // AOV worked example: 240000 qualifying revenue / 3 qualifying orders.
    expect(body.data.averageOrderValue).toBe(80000);

    // Trend: exactly 30 entries, oldest → newest, zero-filled.
    const trend = body.data.trend;
    expect(trend).toHaveLength(30);
    expect(trend[0]).toEqual({ date: "2025-05-18", revenue: 0, orders: 0 });
    expect(trend[1]).toEqual({ date: "2025-05-19", revenue: 40000.5, orders: 1 });
    expect(trend[28]).toEqual({ date: "2025-06-15", revenue: 0, orders: 0 });
    expect(trend[29]).toEqual({ date: "2025-06-16", revenue: 120000, orders: 2 });
    // Sparse aggregates only land inside the window (zero elsewhere).
    const nonZero = trend.filter(
      (p: { revenue: number }) => p.revenue !== 0
    );
    expect(nonZero).toHaveLength(2);
    // Success log outcome preserved.
    expect(logger.info).toHaveBeenCalledWith(
      "analytics.summary",
      expect.objectContaining({ outcome: "success", scope: "all" })
    );
  });

  it("averageOrderValue is zero when there are no qualifying orders", async () => {
    state.current = createFakeDb({
      selectQueue: [
        [{ ...kpiRow, totalRevenue: "0", revenueOrderCount: "0" }],
        [],
        statusRows,
        [],
      ],
    });

    const response = await GET(getRequest());
    const body = await response.json();

    expect(body.data.averageOrderValue).toBe(0);
  });

  it("runs exactly four select queries, started before Promise.all", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);

    const selects = state.current!.ops.filter((op) => op.kind === "select");
    expect(selects).toHaveLength(4);
    // Every query was explicitly started (.execute) — no lazily-dropped
    // builder and no sequential await chain beyond the single Promise.all.
    expect(selects.every((op) => op.executed)).toBe(true);
    expect(state.current!.ops.every((op) => !op.isTx)).toBe(true);
    // All-branch scope applies NO branch predicate: KPI/status/recent wheres
    // are absent (undefined) and the trend where is only the created_at
    // window bound — nothing targets branch_id.
    for (const op of selects) {
      const rendered = renderedWhere(op.where);
      if (!rendered) continue;
      expect(rendered.sql).not.toContain("branch_id");
      expect(rendered.params).not.toContain("b-1");
    }
  });

  it("resolves own-branch scope against the pinned Home Branch", async () => {
    guardMock.mockReset();
    guardAllow(logger, { scope: "own_branch", homeBranchId: "b-1" });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    const selects = state.current!.ops.filter((op) => op.kind === "select");
    expect(selects).toHaveLength(4);
    // Every query is narrowed to the pinned Home Branch: each where argument
    // renders to SQL that predicates on orders.branch_id with the pinned id
    // (KPI/status/recent carry exactly that filter; the trend adds its
    // created_at window bound on top).
    for (const op of selects) {
      expect(op.where).toBeDefined();
      const rendered = renderedWhere(op.where)!;
      expect(rendered.sql).toContain("branch_id");
      expect(rendered.params).toContain("b-1");
    }
  });

  it("fails closed with 403 when an own-branch grant has no Home Branch", async () => {
    guardMock.mockReset();
    guardMock.mockResolvedValue({
      ok: true,
      ctx: {
        user: { id: "admin-1" },
        policy: { policyVersion: 7, user: {} },
        // own-branch authorization without a server-pinned Home Branch.
        authorization: { allowed: true, scope: "own_branch" },
      },
      logger,
    });
    state.current = createFakeDb();

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "Forbidden",
      code: "DENIED",
    });
    expect(state.current!.ops).toHaveLength(0);
  });

  it("passes the guard denial through unchanged", async () => {
    const denial = NextResponse.json(
      { success: false, error: "Forbidden", code: "DENIED" },
      { status: 403 }
    );
    guardDeny(denial);
    state.current = createFakeDb();

    const response = await GET(getRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "Forbidden",
      code: "DENIED",
    });
    expect(state.current!.ops).toHaveLength(0);
  });

  it("logs the failure and returns the stable 500 when a query rejects", async () => {
    state.current = createFakeDb({
      selectQueue: [[kpiRow], trendRows, statusRows, [recentRow]],
      failSelect: () => true,
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      success: false,
      error: "Failed to fetch analytics",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "analytics.failure",
      expect.objectContaining({ outcome: "error" })
    );
  });
});