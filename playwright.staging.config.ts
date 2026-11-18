import { defineConfig } from "@playwright/test";

// Opt-in terpisah: tidak mewarisi auth setup, webServer, atau provider mocks.
if (process.env.STAGING_SMOKE !== "true") throw new Error("STAGING_SMOKE=true required");
for (const [key, origin] of Object.entries({
  STAGING_STORE_URL: "https://dev-store.adfsport.cloud",
  STAGING_ADMIN_URL: "https://dev-admin.adfsport.cloud",
})) {
  if (process.env[key] && process.env[key] !== origin) throw new Error(`${key}: staging origin mismatch`);
  process.env[key] = origin;
}
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["store/staging-deployment.spec.ts", "admin/staging-deployment.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  forbidOnly: true,
  outputDir: "playwright/results/staging",
  reporter: [["line"], ["html", { outputFolder: "playwright/reports/staging", open: "never" }]],
  use: { browserName: "chromium", serviceWorkers: "block", trace: "off", screenshot: "off", video: "off", ignoreHTTPSErrors: false },
  projects: [
    { name: "staging-store-desktop", testMatch: "store/staging-deployment.spec.ts", use: { viewport: { width: 1440, height: 900 } } },
    { name: "staging-store-mobile", testMatch: "store/staging-deployment.spec.ts", use: { viewport: { width: 390, height: 844 } } },
    { name: "staging-admin", testMatch: "admin/staging-deployment.spec.ts", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
