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
 * - BOTH apps receive the SAME TEST-ONLY deterministic `BETTER_AUTH_SECRET`
 *   (`MOCK_SHARED_AUTH_SECRET` below) so the existing admin → store
 *   verify-pickup HMAC contract works without depending on a developer's
 *   local env files. The two Better Auth instances stay independent (own
 *   cookie names, tables and guards); only this shared signing value is
 *   supplied. It is a mock fixture, never a real credential, and must never
 *   be copied into any deployment/environment configuration.
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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// --- Artifact log untuk spec korelasi logging pada server NYATA --------------
//
// Satu direktori per run, DI LUAR repo (tmpdir sistem). Proses app pada harness
// menulis stdout mentahnya ke file di bawah; spec membaca file itu sebagai
// artifact eksternal — bukan lewat import logger app/core, bukan route
// interception browser.
//
// File config ini dievaluasi di proses runner DAN di setiap worker, jadi nilai
// yang sudah ada WAJIB dipakai ulang: tanpa reuse, worker akan membuat direktori
// kedua dan mem-poll file yang tidak pernah ditulis oleh server yang berjalan.
const LOGGING_DIR =
  process.env.E2E_LOGGING_DIR && process.env.E2E_LOGGING_DIR.length > 0
    ? process.env.E2E_LOGGING_DIR
    : mkdtempSync(join(tmpdir(), "marketplace-logging-"));

process.env.E2E_LOGGING_DIR = LOGGING_DIR;
process.env.E2E_LOGGING_STORE_LOG = join(LOGGING_DIR, "store-stdout.log");
process.env.E2E_LOGGING_ADMIN_LOG = join(LOGGING_DIR, "admin-stdout.log");

// TEST-ONLY shared signing secret (deterministic, >= 32 chars).
//
// admin `verify-pickup` signs its call to the store's internal
// `/api/internal/order-complete` with `HMAC-SHA256(BETTER_AUTH_SECRET, orderId)`,
// and that route FAILS CLOSED with 403 "Unauthorized" when
// `BETTER_AUTH_SECRET` is absent (`computeExpectedSecret()` returns "").
// Better Auth itself keeps working in dev through the library's development
// fallback secret, which is why sign-in succeeds while the pickup completion
// was rejected — the failure was missing test env wiring, not pricing/RBAC.
// Both webServer entries below therefore get the SAME value: this is a
// test-environment fixture only, derived from no developer secret, never
// logged and never reused outside this isolated mock config.
const MOCK_SHARED_AUTH_SECRET = "mock-e2e-only-shared-auth-secret-do-not-reuse";

export default defineConfig({
  testDir: "./e2e",
  // ONLY the mock-only specs (versioned checkout/settlement, checkout review
  // preview, pickup, delivery, shipment, admin discounts, real-server logging
  // correlation) — this config must never run the live-cleanup checkout.spec.ts
  // or the other shared-config specs.
  testMatch: /(?:discounts-prototype|stock-visibility|versioned-checkout|versioned-settlement|checkout-review|pickup|addresses|branch-origin|branch-form-layout|delivery-quote|delivery-order|shipment-booking|shipment-tracking|delivery-follow-up|discounts-admin|discounts-coupon|discounts-usage|markdown|markdown-settlement|price-change|price-change-bulk|price-change-excel|price-change-prototype|logging)-mock.spec.ts/,
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
      testMatch: /(?:discounts-prototype|stock-visibility|versioned-checkout|versioned-settlement|checkout-review|pickup|addresses|branch-origin|branch-form-layout|delivery-quote|delivery-order|shipment-booking|shipment-tracking|delivery-follow-up|discounts-admin|discounts-coupon|discounts-usage|markdown|markdown-settlement|price-change|price-change-bulk|price-change-excel|price-change-prototype|logging)-mock.spec.ts/,
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
      // Runner test-only: menjalankan `next dev` yang sama, tetapi stdout mentah
      // proses app direkam ke E2E_LOGGING_STORE_LOG untuk spec korelasi logging.
      // Port, env, dan `reuseExistingServer` tidak berubah.
      command: `node ../../e2e/support/logging-server.mjs store ${STORE_PORT}`,
      cwd: "apps/store",
      url: STORE_PUBLIC_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        // Ticket 02: clock admission terkontrol. Hanya aktif pada mock +
        // database disposable (dijaga di checkout-admission.ts), sehingga
        // test paralel/admission deterministik tanpa memakai jam dinding.
        E2E_CHECKOUT_ADMISSION_NOW: "2040-01-02T12:00:10Z",
        // Shared secret test-only untuk endpoint sweep yang dipakai spec 02.
        CRON_SECRET: "checkout02-cron-fixture-only",
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
        // TEST-ONLY fixture: lets the store's internal order-complete route
        // verify the admin HMAC without any developer .env secret. Keep in
        // sync with the admin webServer entry (same constant).
        BETTER_AUTH_SECRET: MOCK_SHARED_AUTH_SECRET,
      },
    },
    {
      // Runner test-only yang sama untuk admin (E2E_LOGGING_ADMIN_LOG).
      command: `node ../../e2e/support/logging-server.mjs admin ${ADMIN_PORT}`,
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
        // TEST-ONLY fixture: verify-pickup signs order-complete with this same
        // value (see MOCK_SHARED_AUTH_SECRET).
        BETTER_AUTH_SECRET: MOCK_SHARED_AUTH_SECRET,
      },
    },
  ],
});