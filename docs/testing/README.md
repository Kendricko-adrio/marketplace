# Testing

Unit and E2E test infrastructure for the marketplace monorepo.

| Tool | Covers | Config |
|---|---|---|
| **Vitest** | Unit tests (pure logic, no DB/browser) | `vitest.config.ts` (root workspace → per-package configs) |
| **Playwright Test** | Automated E2E (login flow, authenticated smoke) | `playwright.config.ts` + `e2e/` |

Run everything from the repo root.

## Prerequisites

- **Unit tests**: none — pure logic only.
- **E2E tests**:
  - PostgreSQL up (`docker compose up -d`) with schema + seed applied:
    `npm run db:push && npm run db:seed`.
  - Playwright browsers installed (once): `npm run test:e2e:install`.
  - The dev servers are started automatically by Playwright's `webServer`
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
e2e/
  config.ts               # auth-state paths + TEST_USERS (env-overridable)
  auth.setup.ts           # logs in once per app, saves storageState
  store/                  # storefront specs (baseURL http://localhost:3000)
    login.spec.ts         # login flow (valid / invalid / redirect)
    account.spec.ts       # authenticated smoke (reuses saved session)
  admin/                  # admin specs (baseURL http://localhost:3001)
    login.spec.ts         # login flow (valid / invalid / redirect)
    dashboard.spec.ts     # authenticated smoke (reuses saved session)
apps/*/vitest.config.ts   # per-app unit config (aliases, include)
packages/db/vitest.config.ts
```

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
- **Stale auth state** — delete `e2e/.auth/` and re-run; Playwright regenerates
  it from the setup project.
