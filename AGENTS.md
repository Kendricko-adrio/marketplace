# AGENTS.md

High-signal notes for agents working in this repo.

## Tech Stack

- Next.js 16.1.1 + React 19 + TypeScript (strict)
- Tailwind CSS 3 + shadcn/ui
- Drizzle ORM + PostgreSQL (`pg` driver)
- Better Auth (Drizzle adapter, bcryptjs passwords, optional Google OAuth)

## Dev Setup (order matters)

1. `docker compose up -d` — starts PostgreSQL 16 on port 5432
2. Ensure `.env` exists at root (it is already committed but gitignored; contains `DATABASE_URL` and auth secrets)
3. `npm run db:push` — **required** before dev server works; pushes schema to DB
4. `npm run db:seed` — optional; creates sample products, users, orders, vouchers, banners
5. `npm run dev`

## Database & Schema

- Drizzle config: `drizzle.config.ts` reads `DATABASE_URL` from `.env` via `dotenv/config`
- Schema is modular under `src/db/schema/` (auth, products, orders, cart, marketing, system)
- **All schema modules are re-exported from `src/db/schema/index.ts`** — this is the entrypoint Drizzle uses
- Seed script is `src/db/seed.ts` and is **destructive**: it clears all tables before inserting

## Auth

- Better Auth catch-all API route: `src/app/api/auth/[...all]/route.ts`
- Custom middleware (`src/middleware.ts`) protects `/cart`, `/checkout`, `/account`, `/admin` by checking the `better-auth.session_token` cookie
- Users have a `role` field: `customer` | `admin` | `staff`
- Auth client: `src/lib/auth-client.ts`; provider wrapper: `src/providers/auth-provider.tsx`

## Environment Variables

Key vars in `.env`:
- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — auth signing secret
- `BETTER_AUTH_URL` — base URL of the app (e.g. `http://localhost:3000`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — optional OAuth

## Scripts

- `npm run dev` — Next.js dev server
- `npm run build` — production build
- `npm run lint` — runs `eslint` directly (not `next lint`)
- `npm run db:generate` — generate Drizzle migrations
- `npm run db:push` — push schema changes to DB
- `npm run db:studio` — Drizzle Studio
- `npm run db:seed` — seed sample data

## Testing

- **No test runner is configured.** Do not attempt to run tests.

## Conventions

- Path alias `@/*` maps to `./src/*`
- shadcn/ui components live in `src/components/ui/`
- Tailwind CSS variables and base styles are in `src/app/globals.css`
- ESLint 9 config extends `eslint-config-next` (core-web-vitals + typescript)

## Available Skills

This repo includes local OpenCode skills under `.agents/skills/`:

- **caveman** — Ultra-compressed communication mode. Cuts token usage ~75% by speaking like caveman while keeping full technical accuracy. Supports intensity levels: lite, full (default), ultra, wenyan-lite, wenyan-full, wenyan-ultra.
- **better-auth-best-practices** — Configure Better Auth server and client, set up database adapters, manage sessions, add plugins, and handle environment variables.
- **frontend-design** — Create distinctive, production-grade frontend interfaces with high design quality.
- **nextjs** — Next.js App Router expert guidance for routing, Server Components, Server Actions, caching, layouts, middleware/proxy, data fetching, rendering strategies, and deployment.

### Preferred Mode

**Always use caveman skill with `full` mode** for maximum token efficiency. Switch levels with `/caveman lite|full|ultra` only when explicitly requested.

## Knowledge Enrichment

**Always use Context7** to enrich models' knowledge before making any technical decision or implementation in this project. Query Context7 for up-to-date documentation on libraries, frameworks, and APIs to ensure accuracy.
