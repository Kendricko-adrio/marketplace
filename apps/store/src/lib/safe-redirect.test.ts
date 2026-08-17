import { describe, expect, it } from "vitest";
import { safeStoreRedirect } from "./safe-redirect";

describe("safeStoreRedirect", () => {
  it("keeps an internal store path", () => {
    expect(safeStoreRedirect("/checkout?step=2")).toBe("/checkout?step=2");
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "javascript:alert(1)",
    null,
  ])("falls back for an unsafe callback: %s", (callback) => {
    expect(safeStoreRedirect(callback)).toBe("/");
  });
});
