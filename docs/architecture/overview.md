# Overview — Structure, Stack & Connections

Deep-dive companion to AGENTS.md §1. Covers the full project structure, the
tech stack, how each app talks to the database, and path aliases.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) — one app per workspace |
| Database | PostgreSQL 16 via Docker Compose (dev), Drizzle ORM |
| Auth | Better Auth — **two separate instances** (store + admin) |
| Password hashing | `bcryptjs` |
| UI | Tailwind CSS + shadcn/ui |
| Workspaces | npm workspaces (`apps/*`, `packages/*`) |

## Project Structure

```
marketplace/
├── apps/
│   ├── store/      # Storefront (customers)      — http://localhost:3000
│   │   └── src/{app,components,db,lib,providers,middleware.ts}
│   └── admin/      # Admin dashboard (ops)       — http://localhost:3001
│       └── src/{app,components,db,lib,providers,middleware.ts}
├── packages/
│   └── db/         # 🏛️ Shared schema owner (@marketplace/db)
│       └── src/{schema/,seed.ts,reset.ts,import-jubelio.ts,jubelio-sync.ts,ids.ts}
├── deployment/     # Docker/Caddy per environment (see docs/deployment-docs/)
└── docs/           # Project documentation (see docs/README.md)
```

Each app mirrors the same layout: its own `src/db/index.ts` (local `db`
instance + schema re-export), `lib/auth.ts`, `providers/`, and `middleware.ts`.

## How Each App Connects to the Database

**Each app creates its OWN Drizzle `db` instance locally** using a `pg.Pool`
(connection pool). The shared package's `db` instance is used for scripts
(seed/reset/import) only — **never at app runtime**.

```ts
// In store or admin — local db instance + schema re-export
import { db } from "@/db";                 // resolves to ./src/db/index.ts
import { clients, products } from "@/db";  // re-exported from @marketplace/db

// The schema source is read directly from the shared package via path alias:
// apps/<app>/src/db/index.ts does: import * as schema from "@marketplace/db/src/schema"
```

Because the app imports the **schema source** (not a built `dist/`), schema
changes need **no rebuild/sync** in the apps.

## Path Aliases

Defined per-app in `apps/<app>/tsconfig.json` (there is no root alias):

| Alias | Resolves to |
|---|---|
| `@/*` | `./src/*` (both apps) |
| `@marketplace/db` and `@marketplace/db/*` | `../../packages/db/src/*` |
| `@db/*` | store: undefined · admin: `./src/db/*` |
| `@/db` | `./src/db/index.ts` (both apps) |

## See Also

- [database.md](database.md) — schema ownership & DB management
- [auth.md](auth.md) — the two Better Auth instances
- [middleware.md](middleware.md) — route protection per app
- [../README.md](../README.md) — index of all project docs
