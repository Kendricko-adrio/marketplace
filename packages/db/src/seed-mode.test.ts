import { describe, expect, it } from "vitest";
import { resolveSeedPlan } from "./seed-mode";

describe("resolveSeedPlan", () => {
  it("uses demo mode by default and includes catalog-dependent fixtures", () => {
    expect(resolveSeedPlan(undefined)).toEqual({
      mode: "demo",
      seedCatalog: true,
      seedCatalogDependentFixtures: true,
    });
  });

  it("uses Jubelio as catalog source without creating catalog-dependent fixtures", () => {
    expect(resolveSeedPlan("jubelio")).toEqual({
      mode: "jubelio",
      seedCatalog: false,
      seedCatalogDependentFixtures: false,
    });
  });

  it("rejects unsupported modes instead of silently seeding the wrong data", () => {
    expect(() => resolveSeedPlan("production")).toThrow(
      'SEED_MODE must be "demo" or "jubelio"'
    );
  });
});
