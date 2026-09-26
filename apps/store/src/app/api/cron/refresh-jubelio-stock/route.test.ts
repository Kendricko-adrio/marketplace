import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const refresh = vi.fn();
vi.mock("@marketplace/db/src/jubelio-stock-refresh", () => ({ refreshMappedJubelioStock: refresh }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ requestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), requestId: "test" }), serializeError: (e: unknown) => String(e), withRequestId: (response: Response) => response }));

const request = (secret?: string) => new NextRequest("http://localhost/api/cron/refresh-jubelio-stock", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} });

describe("stock refresh cron HTTP seam", () => {
  afterEach(() => { vi.unstubAllEnvs(); refresh.mockReset(); });
  it("fails closed on missing or wrong secret without reading provider stock", async () => {
    const { POST } = await import("./route");
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "valid");
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
  });
  it("reports partial observations as failure and successful reads as success", async () => {
    const { POST } = await import("./route");
    vi.stubEnv("CRON_SECRET", "valid");
    refresh.mockResolvedValueOnce({ pages: 1, items: 2, observed: 1, missing: 1, failed: 0 })
      .mockResolvedValueOnce({ pages: 1, items: 2, observed: 2, missing: 0, failed: 0 });
    expect((await POST(request("valid"))).status).toBe(503);
    const ok = await POST(request("valid"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).observed).toBe(2);
  });
});
