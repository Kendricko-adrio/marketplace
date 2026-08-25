export type SeedMode = "demo" | "jubelio";

export type SeedPlan = {
  mode: SeedMode;
  seedCatalog: boolean;
  seedCatalogDependentFixtures: boolean;
};

export function resolveSeedPlan(value: string | undefined): SeedPlan {
  const mode = (value ?? "demo").trim().toLowerCase();

  if (mode === "demo") {
    return {
      mode,
      seedCatalog: true,
      seedCatalogDependentFixtures: true,
    };
  }

  if (mode === "jubelio") {
    return {
      mode,
      seedCatalog: false,
      seedCatalogDependentFixtures: false,
    };
  }

  throw new Error(
    `SEED_MODE must be "demo" or "jubelio" (got "${value}")`
  );
}
