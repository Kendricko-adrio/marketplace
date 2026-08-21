import { describe, expect, it, vi } from "vitest";
import { getPublicAppUrl } from "./public-url";

describe("getPublicAppUrl", () => {
  it("uses the configured public URL instead of the internal server origin", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://dev-store.adfsport.cloud");

    expect(getPublicAppUrl()).toBe("https://dev-store.adfsport.cloud");
    expect(getPublicAppUrl()).not.toContain("0.0.0.0");
  });
});
