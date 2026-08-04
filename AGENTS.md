# AGENTS.md — Marketplace Monorepo

## Tech Stack

See `package.json` (root + each workspace) for the canonical dependency list. Points not obvious from the manifest: Better Auth runs as **two separate instances** (see Auth); `bcryptjs` for password hashing; npm workspaces monorepo (`apps/store`, `apps/admin`, `packages/db`).

## Project Structure

Run `ls`/`find` for the live tree. In short: `apps/store` (storefront, port 3000), `apps/admin` (admin, port 3001), and `packages/db` (🏛️ shared schema owner). Each app has its own `src/db/index.ts` (local `db` instance + schema re-export), `lib/auth.ts`, `providers/`, and `middleware.ts`.

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

> **Note on `db:push` vs `db:migrate`:** this project's dev DB is managed with
> `db:push` (schema-sync), not `db:migrate`. The `__drizzle_migrations` journal
> is NOT kept in sync with the push-applied DB, so `db:migrate` will try to
> replay old `CREATE TABLE` statements and fail with `relation already exists`.
> Use `db:push` to apply schema changes; treat the generated migration files in
> `packages/db/drizzle/` as the source-of-truth SQL record for review/audit.

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

See the `scripts` block in the root `package.json` for the full list (`dev:store`, `dev:admin`, `dev:all`, `build:store`, `build:admin`, `db:generate`, `db:push`, `db:migrate`, `db:studio`, `db:seed`, `db:check`, `db:reset`, `lint`, `lint:store`, `lint:admin`). Run all `db:*` scripts from the root via `npm run db:*`.

## Path Aliases

Defined per-app in `apps/<app>/tsconfig.json` (no root alias). `@/*` → `./src/*` in both apps; `@marketplace/db` and `@marketplace/db/*` → `../../packages/db/src/*`; `@db/*` is store-undefined, admin → `./src/db/*`. The `db` instance is imported as `@/db` (`./src/db/index.ts`) in both apps, and `apps/<app>/src/db/index.ts` imports schema source directly via `@marketplace/db/src/schema` (not the built `dist/`).

## Conventions

- shadcn/ui components: `apps/<app>/src/components/ui/`
- App-specific components: `apps/<app>/src/components/`
- Shared schema/logic lives in `packages/db/` (no `packages/shared/` exists yet).
- Store routes follow: `/{products,cart,checkout,account,onboarding,login,register,
  forgot-password,reset-password,auth/verify}`.
- Admin routes follow: `/admin/{dashboard,products,orders,users,marketing,analytics}`.

## Documentation

Project documentation lives in `docs/` (repo root). It is **mandatory, not
optional** — treat doc updates as part of the work, not a follow-up.

- **API additions**: whenever a new HTTP endpoint is added — any new `route.ts`
  under `apps/store/src/app/api/**` or `apps/admin/src/app/api/**`, including
  webhooks, cron, and internal routes — update `docs/api-reference.md` with the
  endpoint's method, path, auth, body, response, and purpose, following the
  existing entry format. Do not leave `docs/api-reference.md` stale; if an
  existing endpoint's behavior changes, update its entry too.
- **Feature additions**: every new user-facing or operational feature (e.g. SOH
  third-party sync, stock reservation, a new admin module, a checkout-flow
  change, a new payment path) must have documentation under `docs/` describing
  the design, invariants, env/secrets, and operational steps. If the feature
  spans multiple files, create a dedicated `docs/<feature>.md`.
- When a doc references deployment/operational steps that are already covered by
  `deployment/README.md`, keep that file in sync as well.

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
- **ALWAYS USE CONTEXT7 FOR ENRICH YOUR KNOWLEDGE ON THE LIBRARY OR FRAMEWORK THAT HIS PROJECT USE** - 
  you have a cut off time knowledge so to make sure that you have an updated documentation,
  use context7 for asking the documentation that you need.
- **Dokumentasi WAJIB, bukan opsional** — setiap penambahan API baru harus
  dicatat di `docs/api-reference.md`, dan setiap fitur baru harus punya doc
  sendiri di `docs/` (lihat bagian **Documentation** di atas). Jangan anggap
  tugas selesai sebelum doc ter-update.
- **Setiap kolom datetime/timestamp WAJIB punya timezone** — di
  `packages/db/src/schema/`, selalu pakai `timestamp("col", { withTimezone: true })`
  (→ Postgres `timestamptz`). Jangan pakai `timestamp("col")` polos (→
  `timestamp without time zone`), karena nilai tersimpan sebagai wall-clock tanpa
  label zona dan bergantung pada session `timezone` Postgres — berisiko inkonsistensi
  antara data yang di-insert dari app (`new Date()` → UTC) vs `defaultNow()`/`now()`
  (→ jam lokal session). Dengan `withTimezone: true`, Postgres selalu menyimpan UTC
  secara absolut dan mengonversi ke zona client saat dibaca. Pengecualian: tipe
  `date` (calendar date murni tanpa waktu, mis. `birthDate`) tidak butuh timezone.
  Saat insert dari app, kirim `Date` objek (bukan string lokal) agar `pg` driver
  serialisasi via `toISOString()` (UTC). Pastikan juga session `timezone` Postgres
  di-set ke `UTC` (default di env dev; verifikasi via `SHOW timezone;`).