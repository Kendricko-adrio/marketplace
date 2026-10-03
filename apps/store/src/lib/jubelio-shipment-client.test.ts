import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./logger", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }), serializeError: () => ({ name: "Error" }) }));
const input = { origin: { zipcode: "10110", name: "Branch", phone: "021999999" }, destination: { zipcode: "01234", area_id: "01010101" }, weight: 290, items: [{ item_name: "Fixture", value: 100000, quantity: 1, weight: 250, length: 30, width: 20, height: 10 }] };
beforeEach(() => {
  vi.resetModules(); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("APP_ENV", "staging"); vi.stubEnv("E2E_PROVIDER_MOCKS", "true");
  vi.stubEnv("JUBELIO_SHIPMENT_URL", "http://127.0.0.1:3112"); vi.stubEnv("JUBELIO_SHIPMENT_CLIENT_ID", "fixture"); vi.stubEnv("JUBELIO_SHIPMENT_CLIENT_SECRET", "fixture-secret");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Shipment HTTP runtime", () => {
  it.each(["http://127.0.0.1:3112/path", "http://127.0.0.1:3112?token=x", "http://user:pass@127.0.0.1:3112", "https://example.com"])("rejects non-bare E2E origin %s before any network", async (url) => {
    vi.stubEnv("JUBELIO_SHIPMENT_URL", url); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { createJubelioShipmentGateway } = await import("./jubelio-shipment-client");
    await expect(createJubelioShipmentGateway().rates(input)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects APP_ENV production even when NODE_ENV is test", async () => {
    vi.stubEnv("APP_ENV", "production"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { createJubelioShipmentGateway } = await import("./jubelio-shipment-client");
    await expect(createJubelioShipmentGateway().rates(input)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("refreshes expired tokens without extending the provider lifetime", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (url: string) => Response.json(url.endsWith("generate-token") ? { token: "fixture", expires_in: "1" } : [])); vi.stubGlobal("fetch", fetch);
    const { createJubelioShipmentGateway } = await import("./jubelio-shipment-client");
    await createJubelioShipmentGateway().rates(input); vi.advanceTimersByTime(1500); await createJubelioShipmentGateway().rates(input);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("generate-token"))).toHaveLength(2);
  });
  it("sends only documented rate fields, and one provider failure is never retried", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ token: "fixture", expires_in: 86400 })).mockResolvedValueOnce(Response.json({ error: "failed" }, { status: 500 })); vi.stubGlobal("fetch", fetch);
    const { createJubelioShipmentGateway } = await import("./jubelio-shipment-client");
    await expect(createJubelioShipmentGateway().rates(input)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ origin: { zipcode: "10110" }, destination: { zipcode: "01234", area_id: "01010101" }, weight: 290, items: [{ quantity: 1, weight: 250, length: 30, width: 20, height: 10 }] });
  });
});
