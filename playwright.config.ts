import { defineConfig, devices } from "@playwright/test";
import { AUTH } from "./e2e/config";

const IS_CI = !!process.env.CI;

/**
 * Playwright E2E configuration for the marketplace monorepo.
 *
 * - `setup` project logs in once per app and saves the session to
 *   `e2e/.auth/*.json` (see e2e/auth.setup.ts). The `store`/`admin` projects
 *   depend on it and load that session by default, so every test file starts
 *   authenticated. Login-flow specs opt out with
 *   `test.use({ storageState: { cookies: [], origins: [] } })`.
 * - `store` / `admin` projects scope test files to their own app + baseURL.
 * - Local dev servers are reused when already running (`reuseExistingServer`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  // Turbopack on Windows can contend on .next manifest renames with the host's
  // default 8 workers. Four still exercises parallel browser behavior without
  // turning compiler file locks into application failures.
  workers: IS_CI ? 1 : 4,
  reporter: IS_CI
    ? [["dot"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "on-failure" }]],
  use: {
    // Next.js dev servers compile on first request — allow for that.
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testDir: "./e2e",
      testMatch: /auth\.setup\.ts/,
      use: { baseURL: "http://localhost:3000" },
    },
    {
      name: "store",
      testDir: "./e2e/store",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3000",
        storageState: AUTH.store,
        extraHTTPHeaders: { "x-e2e-payment-mock": "true" },
      },
      dependencies: ["setup"],
    },
    {
      name: "admin",
      testDir: "./e2e/admin",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3001",
        storageState: AUTH.admin,
      },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "npm run dev:jubelio-mock",
      url: "http://localhost:3002/health",
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev:store:app",
      url: "http://localhost:3000",
      env: {
        MIDTRANS_MOCK_API_BASE_URL: "http://127.0.0.1:3002",
      },
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
    },
    {
      command: "npm run dev:admin",
      url: "http://localhost:3001",
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
    },
  ],
});
