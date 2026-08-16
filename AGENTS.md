# AGENTS.md — Marketplace Monorepo

## 1. Project Overview & Architecture

**Okcir marketplace** is an e-commerce monorepo: a storefront for customers, an
admin dashboard for operations, and a shared database package, managed with npm
workspaces. Products, stock, and branch data are synced from **Jubelio**
(master-data API, see `docs/features/jubelio-sync.md`).

| Path | Role |
|---|---|
| `apps/store` | Storefront (customers) — http://localhost:3000 |
| `apps/admin` | Admin dashboard (ops) — http://localhost:3001 |
| `packages/db` | 🏛️ Shared schema owner (`@marketplace/db`) |

**Stack:** Next.js 16 (App Router) · PostgreSQL 16 + Drizzle ORM · Better Auth
(two instances) · TypeScript · Tailwind + shadcn/ui.

**Architecture facts you must know (deep-dives linked):**

- **Schema lives ONLY in `packages/db/src/schema/`.** Apps are read-only
  consumers via the `@marketplace/db` alias (no rebuild needed).
  → [`docs/architecture/database.md`](docs/architecture/database.md)
- **Two independent Better Auth instances** — store (`clients` table,
  `client.*` cookies) and admin (`users` table, `admin.*` cookies). Never
  interchangeable. → [`docs/architecture/auth.md`](docs/architecture/auth.md)
- **Route protection is per-app middleware** (store: cart/checkout/account +
  onboarding gate; admin: `/admin/*`). → [`docs/architecture/middleware.md`](docs/architecture/middleware.md)
- Each app has its own local `db` instance; the shared package's `db` is for
  scripts only. → [`docs/architecture/overview.md`](docs/architecture/overview.md)

More context: [`README.md`](README.md) (project overview) and
[`docs/README.md`](docs/README.md) (docs index).

## 2. Build, Test, & Run Commands

Run all `db:*` scripts from the **root** (they `cd` into `packages/db`).

### Dev setup (order matters)

1. `docker compose up -d` — PostgreSQL 16 on port 5432 (DB: `storefront`)
2. `cp .env.example .env` — configure `DATABASE_URL`, `BETTER_AUTH_SECRET`,
   Google OAuth + SMTP vars
3. `npm install` — installs workspace deps (hoisted to root)
4. `npm run db:push` — apply schema
5. `npm run db:seed` — seed sample data
6. `npm run dev:store` — storefront on http://localhost:3000
7. `npm run dev:admin` — admin on http://localhost:3001

### Common scripts

| Script | Purpose |
|---|---|
| `dev:store` / `dev:admin` / `dev:all` | Run one app / both apps in dev |
| `build` / `build:store` / `build:admin` | Production build(s) |
| `db:generate` / `db:push` | Generate Drizzle migration / apply to DB |
| `db:seed` / `db:reset` | Seed / reset + reseed the DB |
| `db:studio` / `db:check` | Drizzle Studio / schema check |
| `db:import-jubelio` | Pull Jubelio master data |
| `lint` / `lint:store` / `lint:admin` | ESLint |

> ⚠️ **Use `db:push`, NOT `db:migrate`** (dev). The dev DB is schema-sync
> managed; the `__drizzle_migrations` journal is not kept in sync, so
> `db:migrate` replays old `CREATE TABLE`s and fails with `relation already
> exists`. Treat the generated SQL in `packages/db/drizzle/` as the audit
> record. (Deployment containers do run `drizzle-kit migrate` — see
> `docs/deployment-docs/`.)

## 3. Coding Style & Conventions

- **TypeScript everywhere**; Next.js App Router, Server Components by default.
- **shadcn/ui** components in `apps/<app>/src/components/ui/`; app components
  in `apps/<app>/src/components/`.
- **Route conventions:** store under `/{products,cart,checkout,account,
  onboarding,login,register,forgot-password,reset-password,auth/verify}`;
  admin under `/admin/{dashboard,products,orders,users,marketing,analytics}`.
- **Path aliases:** `@/*` → `src/*`; `@marketplace/db` → `packages/db/src`
  (details: [`docs/architecture/overview.md`](docs/architecture/overview.md)).
- **Every timestamp column uses `timestamptz`** (`withTimezone: true`) — never
  bare `timestamp`. Send `Date` objects on insert.
  (Details: [`docs/architecture/database.md`](docs/architecture/database.md).)
- **Docs are mandatory** — every new/changed endpoint and feature needs a doc
  entry. Folder rules: [`docs/README.md`](docs/README.md).
- Write AGENTS.md and code-facing docs in **English**.

## 4. Agent Constraints & Boundaries

- **Schema edits ONLY in `packages/db/src/schema/`** — apps are read-only
  consumers and never define tables.
- **Run `db:*` scripts only from the root** via `npm run db:*`.
- **Never treat the two Better Auth instances interchangeably** — store vs
  admin are distinct; cross-type sign-in is rejected by session hooks
  (`INVALID_USER_TYPE`).
- **Onboarding is store-only** — never assume a `role`/onboarding field on the
  wrong table.
- **Keep the seeder in sync with schema** — when tables/columns change, update
  `packages/db/src/seed.ts` (add a `DELETE` respecting FK order + realistic
  rows) so `db:reset && db:seed` yields a testable DB.
- **Use Context7** for current library/framework documentation before writing
  code — don't rely on memory for library APIs.
- **Every task requires unit tests** — follow the `tdd` skill
  (`.claude/skills/tdd/SKILL.md`): red → green loop, one vertical slice at a
  time, tests at public seams only (never internals), expected values from an
  independent source of truth (no tautological assertions). Write the failing
  test first for features and bug fixes.
- **Load the matching skill first** — e.g. `tdd` for tests, `systematic-debugging`
  for bugs, `nextjs` for UI, `better-auth-best-practices` for auth,
  `frontend-design` for web design. Check available skills before starting a task.
- **Deployment-aware** — when a change touches env vars, domains/URLs/ports,
  cron/webhook endpoints, volumes/healthchecks, or build steps, update the
  matching files under `deployment/` (`common/`, `staging/`, `production/`).
  See [`docs/deployment-docs/README.md`](docs/deployment-docs/README.md).
- **Documentation is part of the task, not a follow-up.** See
  [`docs/README.md`](docs/README.md) for where each doc belongs.
- **Use `systematic-debugging` before guessing fixes** on any bug, test
  failure, or unexpected behavior.
