import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { guardAllow, guardDeny, guardMock } from "@/test-support/route-test";

const state = vi.hoisted(() => ({ list: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("@/features/customers/customer-list-repository", () => ({ listCustomers: state.list }));
vi.mock("@/lib/rbac/guard", () => ({ guard: guardMock }));
vi.mock("@/lib/logger", async () => ({
  ...await (await import("@/test-support/route-test")).loggerModuleMock(),
  createModuleLogger: () => ({ info: state.info, error: state.error }),
}));
import { GET } from "./route";

const request = (query = "") => new NextRequest(`http://localhost:3001/api/admin/customers${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  guardAllow({ scope: "global" });
  state.list.mockResolvedValue({ rows: [], total: 23, page: 2, totalPages: 3 });
});

it("authorizes the global directory, normalizes query and returns paginated metadata", async () => {
  const response = await GET(request("?page=2&limit=10&search=%20Andi%20"));
  expect(guardMock).toHaveBeenCalledWith("customers", "view");
  expect(state.list).toHaveBeenCalledWith({ page: 2, limit: 10, search: "Andi" });
  expect(await response.json()).toEqual({ success: true, data: [], pagination: { page: 2, limit: 10, total: 23, totalPages: 3 } });
  expect(state.info).toHaveBeenCalled();
  expect(JSON.stringify(state.info.mock.calls)).not.toContain("Andi");
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("uses default limit 10, normalizes invalid page and caps limit at 100", async () => {
  await GET(request("?page=-2"));
  expect(state.list).toHaveBeenLastCalledWith({ page: 1, limit: 10, search: "" });
  await GET(request("?limit=999"));
  expect(state.list).toHaveBeenLastCalledWith({ page: 1, limit: 100, search: "" });
});

it.each([401, 403])("passes through %s without reading customer data", async (status) => {
  guardDeny(NextResponse.json({ success: false, error: "Denied" }, { status }));
  expect((await GET(request())).status).toBe(status);
  expect(state.list).not.toHaveBeenCalled();
});

it("returns and logs a safe failure without exposing private DB messages", async () => {
  state.list.mockRejectedValue(new Error("SQL private@example.test"));
  const response = await GET(request("?search=private"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ success: false, error: "Gagal memuat customer." });
  expect(state.error).toHaveBeenCalled();
  expect(JSON.stringify(state.error.mock.calls)).not.toContain("private");
});
