import { describe, expect, it } from "vitest";
import { assertSeedEnvironmentSafe } from "./seed-safety";

describe("assertSeedEnvironmentSafe", () => {
  it("rejects production even when a seed command is invoked accidentally", () => {
    expect(() =>
      assertSeedEnvironmentSafe({ NODE_ENV: "production" })
    ).toThrow("Refusing to seed a production database");
  });

  it("allows development and test environments", () => {
    expect(() => assertSeedEnvironmentSafe({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSeedEnvironmentSafe({ NODE_ENV: "test" })).not.toThrow();
  });
});
