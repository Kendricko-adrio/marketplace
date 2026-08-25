import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchMastersPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sends the item name as an encoded Jubelio q filter", async () => {
    vi.stubEnv("JUBELIO_API_BASE_URL", "https://api2.jubelio.com");
    vi.stubEnv("JUBELIO_EMAIL", "test@example.com");
    vi.stubEnv("JUBELIO_PASSWORD", "secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "test-token" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], totalCount: 0 }), { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchMastersPage } = await import("./jubelio-sync.js");
    await fetchMastersPage(1, 200, "Wild Glide 38");

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api2.jubelio.com/inventory/items/masters?page=1&pageSize=200&q=Wild+Glide+38"
    );
  });
});
