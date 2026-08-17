import { describe, expect, it } from "vitest";
import { seedCleanupEntries } from "./seed-cleanup";

describe("seed cleanup order", () => {
  it("deletes admin users before branches because the FK is restrictive", () => {
    const names = seedCleanupEntries.map(([name]) => name);
    expect(names.indexOf("users")).toBeLessThan(names.indexOf("branches"));
  });
});
