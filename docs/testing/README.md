# Testing

Unit and E2E test infrastructure for the marketplace monorepo.

| Tool | Covers | Config |
|---|---|---|
| **Vitest** | Unit tests (pure logic + stateful Jubelio mock contract) | `vitest.config.ts` (root workspace → per-package configs) |
| **Playwright Test** | Automated E2E (login flow, authenticated smoke) | `playwright.config.ts` + `e2e/` |

Run everything from the repo root.

## Prerequisites

- **Unit tests**: none — pure logic only.
- **E2E tests**:
  - PostgreSQL up (`docker compose up -d`) with schema + seed applied:
    `npm run db:push && npm run db:seed`.
  - Playwright browsers installed (once): `npm run test:e2e:install`.
  - The Jubelio mock and dev servers are started automatically by Playwright's `webServer`
    (and **reused** if you already have `npm run dev:store` / `dev:admin`
    running).

## Scripts

| Script | What it does |
|---|---|
| `npm run test` | Unit tests, then E2E tests |
| `npm run test:unit` | Run all Vitest projects (headless) |
| `npm run test:unit:watch` | Watch mode |
| `npm run test:e2e` | Playwright headless |
| `npm run test:e2e:headed` | Open a visible browser window |
| `npm run test:e2e:ui` | Playwright UI mode (pick tests, inspect traces live) |
| `npm run test:e2e:debug` | Run with the Playwright inspector (step through) |
| `npm run test:e2e:install` | Install Chromium (and other browsers if configured) |
| `npm run test:e2e:report` | Open the last HTML report |

Use `--headed`, `--ui`, or `--debug` to watch the browser do the work.

## Test users

E2E tests sign in with the **seeder credentials** (see `packages/db/src/seed.ts`):

| App | User | Credentials | Used for |
|---|---|---|---|
| Store | `john@example.com` | `password123` | Authenticated session (auth setup completes onboarding) |
| Store | `jane@example.com` | `password123` | Fresh-login flow (never onboarded → lands on `/onboarding`) |
| Admin | `admintoko` (or `admin@store.com`) | `admin123` | Admin login + dashboard session |

Override via env vars when your local DB differs:

```sh
E2E_STORE_EMAIL=... E2E_STORE_PASSWORD=...
E2E_STORE_FRESH_EMAIL=... E2E_STORE_FRESH_PASSWORD=...
E2E_ADMIN_IDENTIFIER=... E2E_ADMIN_PASSWORD=...
```

## Layout

```
playwright.config.ts      # projects: setup, store, admin + webServer
apps/jubelio-mock/        # stateful HTTP mock for Jubelio stock adjustments
e2e/
  config.ts               # auth-state paths + TEST_USERS (env-overridable)
  auth.setup.ts           # logs in once per app, saves storageState
  store/                  # storefront specs (baseURL http://localhost:3000)
    login.spec.ts         # login flow (valid / invalid / redirect)
    account.spec.ts       # authenticated smoke (reuses saved session)
    products.spec.ts      # infinite scroll, sidebar filters, pricing, grey-out
    product-detail.spec.ts# metadata (brand/gender/category/price/discount/stock)
    checkout.spec.ts      # cart → checkout → PPN snapshot → local payment boundary; vouchers
    onboarding.spec.ts   # fresh user → /onboarding → cookie (isolated user via pg)
    static-pages.spec.ts  # CMS pages + footer rendering
  admin/                  # admin specs (baseURL http://localhost:3001)
    login.spec.ts         # login flow (valid / invalid / redirect)
    dashboard.spec.ts     # authenticated smoke (reuses saved session)
    products.spec.ts      # list/search/detail, sync + upload APIs
    orders.spec.ts        # list/detail + PPN snapshot, verify-pickup, audit-log entry
    users.spec.ts         # generated reset password → forced-reset login
    rbac.spec.ts          # current-policy guards: HQ-only roles page (policy → No-Access), removed legacy /api/admin/permissions endpoints (404), /api/admin/policy/me resolution, branch-scoped orders
    roles-api.spec.ts     # Roles API: denials without Roles grants, create/unique-name/coverage validation, stale-version 409, reduction reason + audit, archive/restore review
    roles-ui.spec.ts      # Roles UI: list/search/archived filter, immutable System Owner, deny-all create, clone, editor, reduction impact dialog, stale-conflict retry, archive/restore, No-Access + Policy-Unavailable states
    users-rbac.spec.ts    # Users APIs under current policy: strict payloads (legacy `role` rejected), valid roleId + Home Branch, ceiling/Owner-only/self-protection, deactivation + session revoke, last-active-Owner invariant
    rbac-security.spec.ts # branch-aware security matrix: own-branch Admin vs cross-branch viewer vs all-branch HQ across Products/Orders/Notifications/Branches/Analytics/Audit Log, fail-closed pickup; plus a Homepage-only Marketing custom Role (Global Module access with a mandatory Home Branch, unrelated modules deny/hide, next-request grant-reduction enforcement without logout)
    analytics.spec.ts     # metrics endpoint invariants (revenue semantics vs independent SQL), 30-day WIB trend, RBAC deny/redirect/sidebar, dashboard UI (skeleton/retry/no-polling, chart + accessible table)
    notifications.spec.ts # long-poll, mark-all-read
    cms.spec.ts           # homepage/pages/footer + floating WhatsApp render
apps/*/vitest.config.ts   # per-app unit config (aliases, include)
packages/db/vitest.config.ts
```

### E2E pitfalls (learned the hard way)

- `npm run dev:store` starts both the storefront and Jubelio mock. Playwright
  starts them as separate managed processes. Non-production stock writes never
  use the live Jubelio host.
- Mock controls: `POST http://127.0.0.1:3002/__control/reset`, then
  `PUT /__control/scenario` with one of `success`, `insufficient-stock`,
  `server-error`, `rate-limit-once`, `unauthorized-once`,
  `timeout-before-apply`, `timeout-after-apply`, or `malformed-success`.
- `checkout.spec.ts` asserts successful reserve-before-Midtrans, PPN display
  and persisted pricing snapshot, provider snapshot persistence, rejection,
  and late-settlement re-acquisition.
- `cms.spec.ts` saves/enables/disables WhatsApp and restores the complete footer
  JSON. `users.spec.ts` verifies generated-password reset through login.
- For late settlement, Playwright sets the non-production-only
  `MIDTRANS_MOCK_API_BASE_URL` to the local mock. Configure an authoritative
  status with `PUT /__control/midtrans-status`; production ignores this URL.

- The store Playwright project sends `x-e2e-payment-mock: true`. The route
  accepts it only outside production and redirects to the local
  `/checkout/payment-test` page, so CI never creates a real Midtrans charge.
- Checkout uses deterministic seeded fixtures and cleans up orders plus stock
  reservations in `afterAll`, keeping repeated runs isolated.
- Unit tests remain infrastructure-free; E2E requires the disposable seeded
  PostgreSQL database described above.

- **React hydration race**: filling a controlled input right after navigation
  gets reverted when hydration takes over. Wait for a client-side signal first
  (submit button `toBeEnabled()`, or `waitForResponse` on a useEffect fetch).
- **Windows/Turbopack**: local runs use four workers. Higher parallelism can
  produce transient `EPERM` manifest-renames; CI remains serialized.
- **Shared state**: specs that share a user's cart or mutate DB rows must use
  `test.describe.configure({ mode: "serial" })` — `fullyParallel: true` is on.
- **Heavy pages**: `waitForURL` with `{ waitUntil: "commit" }` when the target
  page loads slowly under parallel load.
- **DB fixtures**: specs that need deterministic data (fresh users, order
  status, notifications, footer brand) create/reset rows via `pg` in
  `beforeAll`/`afterAll` (see `onboarding.spec.ts`, `orders.spec.ts`,
  `notifications.spec.ts`, `cms.spec.ts`). The admin RBAC suite follows the
  same pattern with run-unique fixture names (a `RUN` suffix from
  `Date.now().toString(36)`, e.g. `E2E Roles UI <case> <RUN>`), so repeated
  runs stay isolated even though archived Role Names stay reserved by design.
- **Reserved identities live forever**: archived Role Names and deactivated
  users' emails/usernames are reserved by design — also *within one spec
  run*. Two tests in the same file that each archive/deactivate their own
  fixture must give the fixture a per-test unique suffix (`${RUN}-${attempt}`),
  or the second `beforeEach` hits `409 DUPLICATE_NAME` / a reserved email (see
  the Marketing Role fixtures in `rbac-security.spec.ts`).
- **FK-order cleanup**: rows inserted by direct `pg` access must be deleted in
  foreign-key order in `afterAll` — sessions → accounts → audit trail →
  users → grants → roles (the `user.role_id` FK is `RESTRICT`, so every user
  holding a fixture Role goes before the `admin_role` rows). See the
  `afterAll` blocks in `roles-ui.spec.ts`, `users-rbac.spec.ts`, and
  `rbac-security.spec.ts`.
- **Serial / one worker**: specs that share one fixture set or mutate shared
  Owner state run with `test.describe.configure({ mode: "serial" })`
  (`roles-ui.spec.ts`, `users-rbac.spec.ts`); `rbac-security.spec.ts` keeps
  the file-level `default` mode precisely because each test would otherwise
  re-run `beforeAll` in its own worker and collide on the fixed fixture keys
  (unique `pickup_code`, inflated analytics counts). Do not raise worker
  parallelism for these files.
- **Playwright failure diagnosis**: when a run fails, diagnose from the
  Markdown/text output only (error context, snapshot text, trace) — do not
  open the screenshot/image attachments; reading them wastes a turn and is
  forbidden in this repo (see `AGENTS.md`).

### Auth pattern (important)

Playwright's best practice is **"login once, reuse everywhere"**:

1. `e2e/auth.setup.ts` signs in the store customer (and completes onboarding
   so the `client.onboarding=1` cookie is saved) and the admin user, then saves
   `storageState` to `e2e/.auth/*.json` (gitignored).
2. The `store` and `admin` projects load those sessions by default, so **new
   spec files are automatically authenticated**.
3. **Login-flow specs opt out** so they test an unauthenticated user:

   ```ts
   test.use({ storageState: { cookies: [], origins: [] } });
   ```

## Adding tests

- **Unit tests** (public seams only — see the `tdd` skill): colocate
  `*.test.ts` next to the code under `apps/*/src` or `packages/db/src`. Example:
  `apps/admin/src/lib/login-utils.test.ts` tests the `isEmail` helper the login
  form uses. Keep tests to pure logic — no DB or browser. React component tests
  would need `jsdom` + Testing Library added on demand (see the Vitest configs).
  Policy-matrix tests stay hand-independent: derive the attempted
  module/action/scope set from `CATALOG` itself (see the
  "deny-by-default catalog matrix" block in `packages/db/src/rbac/policy.test.ts`
  — a deny-all Role must deny EVERY catalog attempt) so a catalog change
  automatically extends the matrix.
- **E2E specs**: drop a `*.spec.ts` into `e2e/store/` or `e2e/admin/`. Prefer
  role-based locators (`getByRole`, `getByLabel`) and web-first assertions
  (`expect(...).toBeVisible()`). For a flow that needs its own login, opt out
  of the saved session as shown above.

## CI

`playwright.config.ts` is CI-aware: `forbidOnly`, `retries: 2`, single worker,
and `reuseExistingServer: false` (servers are freshly started). The same
`webServer` entries run the apps; ensure the DB is seeded in the CI job first.

## Troubleshooting

- **`webServer` timeout / 500 on startup** — the store/admin dev server needs
  the DB; check Postgres is up and `npm run db:seed` succeeded.
- **Login lands somewhere unexpected** — the store middleware forces
  `/onboarding` until the `client.onboarding=1` cookie exists. The auth-setup
  completes onboarding for saved sessions; fresh logins in specs assert the
  `/onboarding` landing.
- **RBAC specs bounce off `/login`** — the saved admin project session is the
  branch-admin `admintoko` (Admin Role). Specs that need another identity
  (HQ role manager `hqmanager`, fixture users) must start from an isolated
  empty context — `test.use({ storageState: { cookies: [], origins: [] } })`
  or a fresh `browser.newContext()` — and prove the identity switch via
  `/api/admin/me` before asserting policy behavior; otherwise `/login`
  redirects straight back to `/admin`.
- **Playwright failures** — diagnose from the Markdown/text report only; never
  open the `.png`/image attachments (see the pitfalls above).
- **Stale auth state** — delete `e2e/.auth/` and re-run; Playwright regenerates
  it from the setup project.
