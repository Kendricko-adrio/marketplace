import { defineConfig } from "vitest/config";

// Monorepo unit-test workspace. Each package owns its own aliases and
// environment (see apps/*/vitest.config.mts and packages/db/vitest.config.mts).
// Run from the repo root with `npm run test:unit` (vitest run).
export default defineConfig({
  test: {
    projects: [
      "./apps/store/vitest.config.mts",
      "./apps/admin/vitest.config.mts",
      "./packages/db/vitest.config.mts",
      "./apps/jubelio-mock/vitest.config.mts",
      "./apps/jubelio-webhook-simulator/vitest.config.mts",
    ],
  },
});
