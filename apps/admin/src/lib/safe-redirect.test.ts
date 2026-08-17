import { describe, expect, it } from "vitest";
import { safeAdminRedirect } from "./safe-redirect";

describe("safeAdminRedirect", () => {
  it("keeps an internal admin path", () => {
    expect(safeAdminRedirect("/admin/orders?status=ready")).toBe(
      "/admin/orders?status=ready"
    );
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/login",
    "javascript:alert(1)",
    null,
  ])("falls back for an unsafe callback: %s", (callback) => {
    expect(safeAdminRedirect(callback)).toBe("/admin");
  });
});
