# Marketplace Monorepo

Monorepo for the Okcir marketplace: a storefront, an admin dashboard, and
shared packages, managed with npm workspaces.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) — one app per workspace |
| Database | PostgreSQL 16 via Docker Compose, Drizzle ORM |
| Auth | Better Auth — **two separate instances** (store + admin) |
| Workspaces | npm workspaces (`apps/*`, `packages/*`) |

## Project Structure

| Path | Role |
|---|---|
| `apps/store` | Storefront, http://localhost:3000 |
| `apps/admin` | Admin dashboard, http://localhost:3001 |
| `packages/db` | 🏛️ Shared schema owner (`@marketplace/db`) |
| `packages/ui` | Shared UI components |

## Dev Setup (order matters)

1. `docker compose up -d` — starts PostgreSQL 16 on port 5432 (DB name: `storefront`)
2. `cp .env.example .env` — configure `DATABASE_URL`, `BETTER_AUTH_SECRET`, Google OAuth + SMTP vars
3. `npm install` — installs workspace deps (hoists to root)
4. `npm run db:push` — pushes schema to DB (runs in packages/db)
5. `npm run db:seed` — seeds sample data (runs in packages/db)
6. `npm run dev:store` — storefront on http://localhost:3000
7. `npm run dev:admin` — admin on http://localhost:3001

## Scripts (run from ROOT)

| Script | Purpose |
|---|---|
| `dev:store` / `dev:admin` | Run one app in dev mode |
| `dev:all` | Run both apps concurrently |
| `build:store` / `build:admin` / `build` | Production builds |
| `db:generate` | Generate Drizzle migration in `packages/db/drizzle/` |
| `db:push` | Apply schema to DB (see note below) |
| `db:seed` | Seed sample data |
| `db:reset` | Reset + reseed the DB |
| `db:import-jubelio` | Full pull from Jubelio master data (see `docs/features/jubelio-sync.md`) |
| `lint` / `lint:store` / `lint:admin` | ESLint |

> **Note on `db:push` vs `db:migrate`:** the dev DB is managed with `db:push`
> (schema-sync), **not** `db:migrate`. The `__drizzle_migrations` journal is not
> kept in sync with the push-applied DB, so `db:migrate` will try to replay old
> `CREATE TABLE` statements and fail with `relation already exists`. Use
> `db:push` to apply schema changes; treat the generated migration files in
> `packages/db/drizzle/` as the source-of-truth SQL record for review/audit.

## Documentation

- `AGENTS.md` — project rules, conventions, and dev setup details (read first)
- `docs/` — API reference (`docs/api-reference.md`) + feature docs
  (notifications, Jubelio sync, pricing, product filters, …)
- `docs/deployment-docs/` — deployment / operational steps (index: `docs/deployment-docs/README.md`)
