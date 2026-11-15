import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const schema = await import("@marketplace/db/src/schema");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { ...schema, db: drizzle({ client: { query: state.query } as never }) };
});

import { getCustomerSummary, listCustomers } from "./customer-list-repository";

beforeEach(() => state.query.mockReset());

it("searches name/email/phone before paging, escaping literal wildcard characters in both queries", async () => {
  state.query.mockResolvedValueOnce({ rows: [["1"]] });
  state.query.mockResolvedValueOnce({ rows: [] });
  const result = await listCustomers({ page: 99, limit: 10, search: "  A%_\\  " });
  expect(result).toMatchObject({ total: 1, page: 1, totalPages: 1 });
  for (const [query, params] of state.query.mock.calls) {
    expect(query.text).toMatch(/"client"\."name" ilike/);
    expect(query.text).toMatch(/"client"\."email" ilike/);
    expect(query.text).toMatch(/"client"\."phone" ilike/);
    expect(params.slice(0, 3)).toEqual(["%A\\%\\_\\\\%", "%A\\%\\_\\\\%", "%A\\%\\_\\\\%"]);
  }
});

it("returns page 1 of 1 for an empty directory", async () => {
  state.query.mockResolvedValueOnce({ rows: [["0"]] });
  state.query.mockResolvedValueOnce({ rows: [] });
  expect(await listCustomers({ page: 20, limit: 10, search: "" })).toEqual({
    rows: [], total: 0, page: 1, totalPages: 1,
  });
});

it("aggregates global summary without loading customer profiles or multiplying customers by orders", async () => {
  state.query.mockResolvedValueOnce({ rows: [["23", "15"]] });
  state.query.mockResolvedValueOnce({ rows: [["31"]] });
  expect(await getCustomerSummary()).toEqual({
    registered: 23, onboarded: 15, pending: 8, totalOrders: 31,
  });
  for (const [query] of state.query.mock.calls) {
    expect(query.text).not.toContain('"email"');
    expect(query.text).not.toContain('"phone"');
    expect(query.text).not.toContain("group by");
  }
});

it("returns page 3 of 23 customers with a bounded stable query and ISO dates", async () => {
  state.query.mockResolvedValueOnce({ rows: [["23"]] });
  state.query.mockResolvedValueOnce({ rows: [[
    "c-21", "Customer 21", "21@example.test", null, null, null, false,
    "2040-01-01T00:00:00Z", "2040-01-01T00:00:00Z", "4",
  ]] });
  const result = await listCustomers({ page: 3, limit: 10, search: "" });
  expect(result).toMatchObject({ total: 23, page: 3, totalPages: 3 });
  expect(result.rows[0]).toMatchObject({
    id: "c-21", orderCount: 4, createdAt: "2040-01-01T00:00:00.000Z",
  });
  const [countQuery] = state.query.mock.calls[0];
  expect(countQuery.text).not.toContain("join");
  const [rowsQuery, params] = state.query.mock.calls[1];
  expect(rowsQuery.text).toMatch(/order by "client"\."created_at" desc, "client"\."id" desc/);
  expect(rowsQuery.text).toMatch(/limit \$\d+ offset \$\d+/);
  expect(params).toEqual([10, 20]);
});
