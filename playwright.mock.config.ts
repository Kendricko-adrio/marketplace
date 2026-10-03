/**
 * Mock-only Playwright configuration for ticket 01 (nominal pickup regression).
 *
 * This config is SELF-CONTAINED and ISOLATED from the shared live E2E config
 * (playwright.config.ts):
 * - It starts its OWN store/admin/jubelio-mock servers on dedicated ports
 *   and REJECTS reuse (`reuseExistingServer: false`): an occupied port fails
 *   the run loudly instead of silently reusing a shared live-traffic server.
 * - It overrides ALL provider bases to the loopback mock — the Jubelio stock
 *   sync (`JUBELIO_API_BASE_URL`), the Midtrans status boundary
 *   (`MIDTRANS_MOCK_API_BASE_URL`) and the NEW test-only sales seam
 *   (`JUBELIO_SALES_MOCK_API_BASE_URL` + `E2E_PROVIDER_MOCKS=true`, which the
 *   main agent implements after this spec goes red).
 * - It FAILS CLOSED: `JUBELIO_SALES_TEST_ACCOUNT_ENABLED=false` overrides the
 *   root .env (loaded by next.config.ts without override) so this run can
 *   NEVER fall back to a live Jubelio account while the seam is missing.
 *   JUBELIO_* credentials are fakes; live traffic would fail login anyway.
 * - The admin side is wired for verify-pickup: `STORE_INTERNAL_URL` points at
 *   the isolated store origin (the shared root .env pins :3000).
 *
 * There is NO `setup` project and no storageState: the spec creates its own
 * sessions through the public HTTP sign-in seam (Better Auth route handlers
 * are same-origin, so they work on isolated ports), while the UI login flows
 * cannot be reused here — the two apps' `.env.local` files lock
 * `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL` to the canonical ports with
 * `override: true`, which beats webServer env overrides
 * (`e2e/auth.setup.ts` therefore cannot target this config's ports until the
 * env wiring is generalized; see the ticket handoff).
 *
 * Run: npx playwright test --config=playwright.mock.config.ts
 */
import { defineConfig, devices } from "@playwright/test";

// Dedicated isolated ports (distinct from the live config's 3000/3001/3002).
// Browser-facing origins use `localhost` (cookies are port-independent, so
// the shared auth states remain origin-compatible); server-to-server and
// control-plane URLs use the bare loopback (`127.0.0.1`) because the mock
// server binds that host only.
const MOCK_PORT = 3112;
const STORE_PORT = 3110;
const ADMIN_PORT = 3111;

const MOCK_LOCAL_URL = `http://127.0.0.1:${MOCK_PORT}`;
const STORE_LOCAL_INTERNAL_URL = `http://127.0.0.1:${STORE_PORT}`;
const STORE_PUBLIC_URL = `http://localhost:${STORE_PORT}`;
const ADMIN_PUBLIC_URL = `http://localhost:${ADMIN_PORT}`;

// The spec reads these at runtime; keep them in sync with its fallbacks.
process.env.E2E_PROVIDER_MOCKS = "true";
process.env.E2E_MOCK_STORE_BASE_URL = STORE_PUBLIC_URL;
process.env.E2E_MOCK_ADMIN_BASE_URL = ADMIN_PUBLIC_URL;
process.env.E2E_MOCK_API_BASE_URL = MOCK_LOCAL_URL;
process.env.MIDTRANS_SERVER_KEY = "pickup-mock-only-server-key";

process.env.JUBELIO_SHIPMENT_WEBHOOK_SECRET = "fixture-shipment-secret";

export default defineConfig({
  testDir: "./e2e",
  // ONLY the mock-only pickup spec — this config must never run the live-cleanup
  // checkout.spec.ts or the other shared-config specs.
  testMatch: /(?:pickup|addresses|branch-origin|delivery-quote|delivery-order|shipment-booking|shipment-tracking|delivery-follow-up)-mock\.spec\.ts/,
  fullyParallel: false,
  workers: 1, // single fixture identity (john) — serial DB + cart ordering
  forbidOnly: true,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-mock", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: STORE_PUBLIC_URL,
    extraHTTPHeaders: { "x-e2e-payment-mock": "true" },
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "pickup-mock",
      testDir: "./e2e",
      testMatch: /(?:pickup|addresses|branch-origin|delivery-quote|delivery-order|shipment-booking|shipment-tracking|delivery-follow-up)-mock\.spec\.ts/,
      // No storageState/project auth: sessions are created in the spec via the
      // public HTTP sign-in seam against the isolated origins.
    },
  ],
  webServer: [
    {
      command: "npx tsx src/server.ts",
      cwd: "apps/jubelio-mock",
      url: `${MOCK_LOCAL_URL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        JUBELIO_MOCK_PORT: String(MOCK_PORT),
        JUBELIO_MOCK_HOST: "127.0.0.1",
      },
    },
    {
      command: `npx next dev -p ${STORE_PORT}`,
      cwd: "apps/store",
      url: STORE_PUBLIC_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // --- Provider-mock seam under test (ticket 01; parent implements) ---
        // E2E-only flag + loopback-only sales mock base URL. The sales runtime
        // must accept this pair for E2E runs and still reject non-loopback
        // values; until implemented the gateway stays disabled (red, safe).
        E2E_PROVIDER_MOCKS: "true",
        JUBELIO_SALES_MOCK_API_BASE_URL: MOCK_LOCAL_URL,
        // Every provider base (stock sync included) points at the loopback mock.
        JUBELIO_API_BASE_URL: MOCK_LOCAL_URL,
        JUBELIO_SHIPMENT_URL: MOCK_LOCAL_URL,
        JUBELIO_SHIPMENT_CLIENT_ID: "fixture-shipment-client",
        JUBELIO_SHIPMENT_CLIENT_SECRET: "fixture-shipment-secret",
        MIDTRANS_MOCK_API_BASE_URL: MOCK_LOCAL_URL,
        MIDTRANS_SERVER_KEY: "pickup-mock-only-server-key",
        // No real email may leave the isolated test run.
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1",
        SMTP_USER: "",
        SMTP_PASS: "",
        // Fail closed BEFORE the seam exists: root .env enables the live
        // isolated test account; this run must never touch it.
        JUBELIO_SALES_TEST_ACCOUNT_ENABLED: "false",
        // Fake credentials: the mock ignores them; anything live fails login.
        JUBELIO_EMAIL: "e2e-mock@example.test",
        JUBELIO_PASSWORD: "not-a-real-password",
        // Settlement parameters (mock accepts any non-negative account id).
        JUBELIO_PAYMENT_ACCOUNT_ID: "2",
        JUBELIO_PAYMENT_TYPE: "0",
        JUBELIO_ITEM_TAX_ID: "1",
        JUBELIO_ITEM_UNIT: "Buah",
        // Mock-run traffic budget: 500 ms keeps every real mock path far below
        // the client timeout while giving the ambiguity test a client-side
        // timeout window shorter than the mock's 1s delayed response.
        JUBELIO_STOCK_TIMEOUT_MS: "500",
        // App-facing URLs on the isolated origin (see .env.local stomp note above).
        BETTER_AUTH_URL: STORE_PUBLIC_URL,
        NEXT_PUBLIC_APP_URL: STORE_PUBLIC_URL,
      },
    },
    {
      command: `npx next dev -p ${ADMIN_PORT}`,
      cwd: "apps/admin",
      url: ADMIN_PUBLIC_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // verify-pickup completes the order through the isolated store's
        // internal endpoint (root .env pins :3000 — overridden here).
        E2E_PROVIDER_MOCKS: "true",
        STORE_INTERNAL_URL: STORE_LOCAL_INTERNAL_URL,
        JUBELIO_SHIPMENT_URL: MOCK_LOCAL_URL,
        JUBELIO_SHIPMENT_CLIENT_ID: "fixture-shipment-client",
        JUBELIO_SHIPMENT_CLIENT_SECRET: "fixture-shipment-secret",
        JUBELIO_SHIPMENT_TIMEOUT_MS: "500",
        BETTER_AUTH_URL: ADMIN_PUBLIC_URL,
        NEXT_PUBLIC_APP_URL: ADMIN_PUBLIC_URL,
      },
    },
  ],
});