import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const request = { ref_no: "order-fixture", courier_id: 13, courier_service_id: 1327, is_cod: false, origin: { name: "Origin", phone: "021123456", address: "Origin street", zipcode: "10110" }, destination: { name: "Recipient", phone: "08123456789", address: "Destination street", zipcode: "01234" }, items: [{ item_name: "Fixture", quantity: 1, value: 100000, weight: 250, length: 10, width: 10, height: 10 }] };
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
const booked = { shipment_id: 6001, awb: "AWB6001", price: 25000 };
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("E2E_PROVIDER_MOCKS", "true");
  vi.stubEnv("JUBELIO_SHIPMENT_URL", "http://127.0.0.1:3112");
  vi.stubEnv("JUBELIO_SHIPMENT_CLIENT_ID", "fixture"); vi.stubEnv("JUBELIO_SHIPMENT_CLIENT_SECRET", "fixture-secret");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("admin Shipment transport boundaries", () => {
  it("never extends a provider's short token lifetime", async () => {
    let now = 100000; vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ token: "short", expires_in: 1 })).mockResolvedValueOnce(response(booked)).mockResolvedValueOnce(response({ token: "fresh", expires_in: 3600 })).mockResolvedValueOnce(response(booked));
    vi.stubGlobal("fetch", fetchMock);
    const { createJubelioShipmentGateway } = await import("./jubelio-shipment-client");
    const gateway = createJubelioShipmentGateway(); await gateway.createShipment(request);
    now += 1100; await gateway.createShipment(request);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/generate-token"))).toHaveLength(2);
  });
  it.each(["NODE_ENV", "APP_ENV"])("production %s cannot use E2E mode", async (key) => {
    vi.stubEnv(key, "production"); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { createJubelioShipmentGateway } = await import("./jubelio-shipment-client");
    await expect(createJubelioShipmentGateway().createShipment(request)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["https://provider.example.test", "http://127.0.0.1:3112/path", "http://127.0.0.1:3112?x=1"])("E2E fails closed for %s", async (url) => {
    vi.stubEnv("JUBELIO_SHIPMENT_URL", url); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { createJubelioShipmentGateway } = await import("./jubelio-shipment-client");
    await expect(createJubelioShipmentGateway().createShipment(request)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not retry a failed booking, and absent billed cost stays unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ token: "token", expires_in: 3600 })).mockResolvedValueOnce(response(booked)).mockRejectedValueOnce(new Error("timeout after apply")); vi.stubGlobal("fetch", fetchMock);
    const { createJubelioShipmentGateway } = await import("./jubelio-shipment-client"); const gateway = createJubelioShipmentGateway();
    expect((await gateway.createShipment(request)).price_bill).toBeUndefined();
    const wire = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(wire).toMatchObject({ is_cod: false, shipping_insurance: 0 });
    await expect(gateway.createShipment(request)).rejects.toThrow();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/shipments/create"))).toHaveLength(2);
  });
});
