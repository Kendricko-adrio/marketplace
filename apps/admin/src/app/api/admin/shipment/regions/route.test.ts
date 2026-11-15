import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { guardAllow, guardDeny, guardMock, loggerModuleMock } from "@/test-support/route-test";
import { mockShipmentRegions } from "@/test-support/shipment-regions";
vi.mock("@/lib/rbac/guard", async () => ({ guard: (await import("@/test-support/route-test")).guardMock }));
vi.mock("@/lib/logger", () => loggerModuleMock());
import { GET } from "./route";
beforeEach(() => { guardMock.mockReset(); guardAllow(); mockShipmentRegions(); });
const request = (query: string) => new NextRequest(`http://localhost/api/admin/shipment/regions?${query}`);
describe("admin Shipment hierarchy", () => {
  it("requires branches edit and returns canonical string options", async () => {
    const response = await GET(request("level=areas&parentId=010203"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: [{ id: "0102030004", name: "Kelurahan Fixture", parentId: "010203", postalCode: "01234" }] });
    // `guard` dipanggil tanpa options: request/logger dibaca dari scope HTTP wrapper.
    expect(guardMock).toHaveBeenCalledWith("branches", "edit");
  });
  it.each(["", "level=toString", "level=cities", "level=areas&parentId=abc"])("rejects invalid query %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never calls Shipment for an unauthorized session", async () => {
    guardDeny(NextResponse.json({ success: false }, { status: 401 }));
    expect((await GET(request("level=provinces"))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, [{ area_id: "4", district_id: "wrong", name: "Invalid", zipcode: "01234" }]])("fails closed for malformed provider data", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(body));
    expect((await GET(request("level=areas&parentId=010203"))).status).toBe(503);
  });
  it("maps provider timeout to safe retry response", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new DOMException("secret provider detail", "TimeoutError"));
    const response = await GET(request("level=provinces"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
