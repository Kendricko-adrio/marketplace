# AGENTS.md — Marketplace Monorepo

## Tech Stack

- Next.js 16.1.1 + React 19.2.3 + TypeScript (strict)
- Tailwind CSS 3 + shadcn/ui (Radix primitives)
- Drizzle ORM 0.45 + PostgreSQL (`pg` driver, node-postgres `Pool`)
- Better Auth 1.4 (Drizzle adapter) — **two separate instances** (see Auth)
- `bcryptjs` for password hashing
- **npm workspaces** monorepo (apps/store, apps/admin, packages/db)

## Project Structure

```
marketplace/
├── apps/
│   ├── store/                       ← Customer storefront (port 3000)
│   │   └── src/
│   │       ├── app/                 ← App router: products, cart, checkout,
│   │       │                        │   account, onboarding, login, register,
│   │       │                        │   auth/verify, forgot/reset-password,
│   │       │                        │   api/auth/[...all]
│   │       ├── components/          ← Store-specific components (ui/ = shadcn)
│   │       ├── db/index.ts         ← Local `db` instance + schema re-export
│   │       ├── lib/auth.ts         ← Store Better Auth instance ("client" prefix)
│   │       ├── lib/email.ts        ← Nodemailer verification email sender
│   │       ├── providers/          ← Client-side React providers
│   │       └── middleware.ts       ← Auth + onboarding gate
│   │
│   └── admin/                       ← Admin dashboard (port 3001)
│       └── src/
│           ├── app/                ← App router: admin/{dashboard,products,
│           │                       │   orders,users,marketing,analytics},
│           │                       │   login, api/auth/[...all]
│           ├── components/         ← Admin-specific components (ui/ = shadcn)
│           ├── db/index.ts         ← Local `db` instance + schema re-export
│           ├── lib/auth.ts         ← Admin Better Auth instance ("admin" prefix)
│           ├── providers/
│           └── middleware.ts       ← Admin route protection
│
├── packages/
│   └── db/                         ← 🏛️ SHARED SCHEMA OWNER
│       ├── src/
│       │   ├── schema/             ← All table definitions
│       │   │   ├── index.ts       ← Barrel re-export of all schema modules
│       │   │   ├── auth.ts        ← clients + users (admin) + sessions/accounts
│       │   │   ├── products.ts
│       │   │   ├── orders.ts
│       │   │   ├── cart.ts
│       │   │   ├── marketing.ts
│       │   │   └── system.ts
│       │   ├── index.ts            ← DB connection (Pool + drizzle)
│       │   ├── seed.ts             ← Seed script
│       │   └── reset.ts            ← DB reset script
│       ├── drizzle.config.ts       ← Schema owner config (loads ../../.env)
│       ├── drizzle/                ← Generated migrations
│       └── package.json            ← name: "@marketplace/db"
│
├── docker-compose.yml              ← PostgreSQL 16-alpine (DB: storefront)
├── package.json                    ← Workspaces config + root scripts
├── .env                            ← Shared env (DATABASE_URL, BETTER_AUTH_SECRET,
│                                    │   GOOGLE_CLIENT_ID/SECRET, SMTP_*)
└── .env.example
```

## Dev Setup (order matters)

1. `docker compose up -d` — starts PostgreSQL 16 on port 5432 (DB name: `storefront`)
2. `cp .env.example .env` — configure `DATABASE_URL`, `BETTER_AUTH_SECRET`, Google OAuth + SMTP vars
3. `npm install` — installs workspace deps (hoists to root)
4. `npm run db:push` — pushes schema to DB (runs in packages/db)
5. `npm run db:seed` — seeds sample data (runs in packages/db)
6. `npm run dev:store` — storefront on http://localhost:3000
7. `npm run dev:admin` — admin on http://localhost:3001

## Database & Schema

**OWNER: `packages/db/`** — the only place schema tables are defined.
Apps consume the schema via the `@marketplace/db` workspace package.

**Important:** Each app creates its OWN `drizzle` `db` instance locally
(`apps/<app>/src/db/index.ts`) using a `pg.Pool`. The shared package's
`db` instance is used for scripts (seed/reset) only — not at app runtime.

```ts
// In store or admin — local db instance + schema re-export
import { db } from "@/db";                 // resolves to ./src/db/index.ts
import { clients, products } from "@/db";   // re-exported from @marketplace/db

// Schema source is read directly from the shared package via path alias
// (apps/<app>/src/db/index.ts does: import * as schema from "@marketplace/db/src/schema")
```

**Schema changes:**
1. Edit `packages/db/src/schema/*.ts`
2. `npm run db:generate` — generate migration in `packages/db/drizzle/`
3. `npm run db:push` — apply to DB
4. No rebuild/sync needed — apps read schema source via path alias

## Auth (Better Auth) — Two Separate Instances

The store and admin run **independent** Better Auth instances with
different user tables, cookie prefixes, and feature sets.

| Aspect              | Store (`apps/store/src/lib/auth.ts`)             | Admin (`apps/admin/src/lib/auth.ts`)                 |
|---------------------|-------------------------------------------------|------------------------------------------------------|
| Cookie prefix       | `client` (e.g. `client.session_token`)         | `admin` (e.g. `admin.session_token`)                |
| User table          | `clients` (no `role` field)                     | `users` (has `role` column)                          |
| Session table       | `clientSessions`                                | `adminSessions`                                      |
| Account table       | `clientAccounts`                                | `adminAccounts`                                      |
| Verification table  | `clientVerifications`                           | `adminVerifications`                                 |
| Social login        | Google OAuth                                    | none                                                 |
| Email verification  | Required (`sendOnSignUp: true`, 1h expiry)      | not configured                                       |
| Username plugin     | no                                              | yes (`better-auth/plugins` `username`)               |
| Onboarding gate     | yes (`onboardingCompleted` field + middleware)  | no                                                   |
| Extra user fields   | phone, birthDate, gender, onboardingCompleted   | role (`admin` \| `hq`, default `admin`, input:false) |

- Both instances use the Drizzle adapter with `provider: "pg"` and `bcryptjs` hashing.
- Session lifetime: 7 days, updateAge 1 day (both apps).
- Cross-app protection: each instance's `session.create.before` hook rejects
  users of the wrong type (admin trying to sign in on store, or vice versa)
  by throwing `APIError("FORBIDDEN", { code: "INVALID_USER_TYPE" })`.
- Better Auth catch-all route: `apps/store/src/app/api/auth/[...all]/route.ts`
  and `apps/admin/src/app/api/auth/[...all]/route.ts`.

### Roles

- **Admin roles** (column on `users` table): `admin` | `hq` (default `admin`).
  The role field is `input: false` — cannot be set by clients at signup.
- **Store users (`clients`)** have NO role column; access control is handled
  by separate tables/instances, not a unified role enum.

## Middleware

- **Store** (`apps/store/src/middleware.ts`): protects `/cart`, `/checkout`,
  `/account`; redirects unauthenticated users to `/login?callbackUrl=`.
  Also enforces an onboarding gate — logged-in users without
  `client.onboarding=1` cookie are redirected to `/onboarding` except for a
  bypass list (`/onboarding`, `/auth/verify`, `/api/auth`, `/api/onboarding`,
  `/forgot-password`, `/reset-password`, `/logout`).
- **Admin** (`apps/admin/src/middleware.ts`): protects `/admin/*`; redirects
  unauthenticated users to `/login?callbackUrl=`. Redirects authenticated
  users away from `/login`.

## Workspace Scripts (run from ROOT)

| Command            | What it does                                   |
|--------------------|------------------------------------------------|
| `npm run dev`      | Alias for `dev:store`                          |
| `npm run dev:store`| Start storefront (port 3000)                   |
| `npm run dev:admin`| Start admin (port 3001)                        |
| `npm run dev:all`  | Start both via `concurrently`                 |
| `npm run build`    | `build:store` + `build:admin`                 |
| `npm run build:store` | Build storefront                            |
| `npm run build:admin`| Build admin                                  |
| `npm run db:generate` | Generate migration (packages/db)           |
| `npm run db:push`  | Push schema to DB (packages/db)               |
| `npm run db:migrate`| Run migrations (packages/db)                 |
| `npm run db:studio`| Drizzle Studio (packages/db)                 |
| `npm run db:seed`  | Seed sample data (packages/db)               |
| `npm run db:check` | `drizzle-kit check` (packages/db)            |
| `npm run db:reset` | Reset DB via `packages/db/src/reset.ts`      |
| `npm run lint`     | Lint store + admin                            |
| `npm run lint:store`| Lint storefront                              |
| `npm run lint:admin`| Lint admin                                   |

## Path Aliases

Defined per-app in `apps/<app>/tsconfig.json` (no root alias).

| Alias               | Store resolves to                  | Admin resolves to                  |
|---------------------|------------------------------------|------------------------------------|
| `@/*`               | `./src/*`                          | `./src/*`                          |
| `@marketplace/db`   | `../../packages/db/src/index.ts`   | `../../packages/db/src/index.ts`   |
| `@marketplace/db/*` | `../../packages/db/src/*`          | `../../packages/db/src/*`          |
| `@db/*`             | _(not defined in store)_           | `./src/db/*`                       |

- The `db` instance is imported as `@/db` (i.e. `./src/db/index.ts`) in both apps.
- `apps/<app>/src/db/index.ts` imports schema source directly via
  `@marketplace/db/src/schema` (not the built `dist/`).

## Conventions

- shadcn/ui components: `apps/<app>/src/components/ui/`
- App-specific components: `apps/<app>/src/components/`
- Shared schema/logic lives in `packages/db/` (no `packages/shared/` exists yet).
- Store routes follow: `/{products,cart,checkout,account,onboarding,login,register,
  forgot-password,reset-password,auth/verify}`.
- Admin routes follow: `/admin/{dashboard,products,orders,users,marketing,analytics}`.

## Skills Usage

Agent **wajib** selalu memanfaatkan skills yang tersedia untuk setiap tugas
yang sesuai. Sebelum mengerjakan request, cek daftar `available_skills` dan
gunakan skill yang paling relevan via tool `skill`.

### Wajib Selalu Dipakai (sesuai konteks)

| Kondisi / Permintaan User                    | Skill yang HARUS digunakan         |
|----------------------------------------------|------------------------------------|
| Debug error, bug, test failure, perilaku tak terduga | `systematic-debugging`     |
| Setup/konfigurasi/troubleshooting Better Auth | `better-auth-best-practices`       |
| Membangun/edit halaman, komponen, atau UI Next.js | `nextjs` + `next-best-practices` |
| Membuat UI/web design (komponen, halaman, poster) | `frontend-design`            |
| Pertanyaan tentang library/framework/SDK/API/CLI | `context7-mcp` (via Context7 MCP) |
| Operasi model Azure Foundry (deploy/finetune/eval) | `microsoft-foundry` / sub-skills |

### Aturan

- **Jangan menyelesaikan tugas tanpa cek skills terlebih dahulu.** Jika ada
  skill yang cocok, WAJIB load skill tersebut via tool `skill` sebelum bertindak.
- **Debugging**: setiap kali user melaporkan error, bug, crash, test gagal,
  atau perilaku tak terduga — WAJIB load skill `systematic-debugging` lebih
  dulu dan ikuti workflow-nya. Jangan langsung menebak fix.
- **Library/framework**: sebelum menulis kode yang memakai library eksternal
  (React, Next.js, Drizzle, Better Auth, Tailwind, dll), fetch dokumentasi
  terbaru via Context7 MCP — jangan andalkan ingatan.
- Jika beberapa skill relevan sekaligus (mis. debug UI Next.js), load semua
  skill yang berlaku secara berurutan.
- Setelah skill dimuat, ikuti instruksi/pola dari skill tersebut; jangan
  menyimpang tanpa alasan yang jelas.

## ⚠️ RULES

- **Schema edits ONLY in `packages/db/src/schema/`** — apps are read-only consumers.
- **Apps never own table definitions** — they only create a local `db` connection
  and re-export the shared schema.
- **Run `db:*` scripts only from root** via `npm run db:*` (they `cd` into packages/db).
- **Do not edit the two Better Auth instances interchangeably** — store (`client`
  prefix, `clients` table) and admin (`admin` prefix, `users` table) are distinct;
  cross-type login is rejected by session hooks.
- **Onboarding flow is store-only** — never assume a `role`/onboarding field on
  the wrong table.
- **Seeder stays in sync with schema** — whenever a new table/column is added or
  removed in `packages/db/src/schema/`, also update
  `packages/db/src/seed.ts` so `npm run db:reset && npm run db:seed` produces a
  fully populated, testable DB without manual data entry. Add a `DELETE` for any
  new table (top of `seed()`, respecting FK order) and realistic sample rows.