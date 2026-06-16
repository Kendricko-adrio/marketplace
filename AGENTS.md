# AGENTS.md — Marketplace Monorepo

## Tech Stack

- Next.js 16.1.1 + React 19 + TypeScript (strict)
- Tailwind CSS 3 + shadcn/ui
- Drizzle ORM + PostgreSQL (`pg` driver)
- Better Auth (Drizzle adapter)
- **npm workspaces** monorepo (apps/store, apps/admin, packages/db)

## Project Structure

```
marketplace/
├── apps/
│   ├── store/          ← Customer-facing storefront (port 3000)
│   │   └── src/app/    ← Next.js app router (products, cart, checkout, account)
│   │
│   └── admin/          ← Admin dashboard (port 3001)
│       └── src/app/admin/ ← Next.js app router (dashboard, orders, products, users)
│
├── packages/
│   └── db/             ← 🏛️ SHARED SCHEMA OWNER (packages/db)
│       ├── src/schema/ ← All table definitions
│       ├── src/index.ts← DB connection
│       ├── drizzle.config.ts ← Schema owner config
│       └── package.json ← name: "@marketplace/db"
│
├── docker-compose.yml  ← PostgreSQL 16
├── package.json        ← Workspaces config + root scripts
└── .env                ← Shared environment (DATABASE_URL, BETTER_AUTH_SECRET)
```

## Dev Setup (order matters)

1. `docker compose up -d` — starts PostgreSQL 16 on port 5432
2. `cp .env.example .env` — configure DATABASE_URL
3. `npm install` — installs workspace deps (hoists to root)
4. `npm run db:push` — pushes schema to DB (from packages/db)
5. `npm run db:seed` — seeds sample data
6. `npm run dev:store` — storefront on http://localhost:3000
7. `npm run dev:admin` — admin on http://localhost:3001

## Database & Schema

**OWNER: `packages/db/`**  
Apps DO NOT own schema. They consume via workspace dependency.

```ts
// In store or admin — import from shared package
import { db } from "@/db";  // resolves to src/db/index.ts
import { users, products } from "@/db";  // re-exported from packages/db
```

**Schema changes:**
1. Edit `packages/db/src/schema/*.ts`
2. `npm run db:generate` — generate migration
3. `npm run db:push` — apply to DB
4. No sync needed — apps auto-use latest via workspace link

## Auth

- Better Auth catch-all: both `apps/store/src/app/api/auth/[...all]` and `apps/admin/src/app/api/auth/[...all]`
- Shared users table (in packages/db)
- Roles: `customer` | `admin` | `staff`
- Middleware in each app protects respective routes

## Workspace Scripts (run from ROOT)

| Command | What it does |
|---------|-------------|
| `npm run dev:store` | Start storefront |
| `npm run dev:admin` | Start admin panel |
| `npm run dev:all` | Start both (requires `concurrently`) |
| `npm run db:push` | Push schema to DB |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Seed sample data |
| `npm run build` | Build store + admin |

## Path Aliases

| Alias | Resolves to |
|-------|------------|
| `@/*` | `./src/*` (per app) |
| `@/db` | `./src/db/index.ts` (per app) |
| `@marketplace/db` | `../../packages/db/src/index.ts` |

## Conventions

- shadcn/ui components: `src/components/ui/`
- Store-specific: `apps/store/src/components/`
- Admin-specific: `apps/admin/src/components/`
- Shared types/logic: consider `packages/shared/` (if needed)

## ⚠️ RULES

- **Schema edits ONLY in `packages/db/`**
- **Store and admin NEVER edit `packages/db/` — read-only consumers**
- **Run `db:push` / `db:migrate` only from root via `npm run db:push`**
