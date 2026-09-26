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
| `plan/` | Conceptual multi-feature plans + status index (`plan/index.md`) |

**Stack:** Next.js 16 (App Router) · PostgreSQL 16 + Drizzle ORM · Better Auth
(two instances) · TypeScript · Tailwind + shadcn/ui.

**Architecture facts you must know (deep-dives linked):**

- **Schema lives ONLY in `packages/db/src/schema/`.** Apps are read-only
  consumers via the `@marketplace/db` alias. → [`docs/architecture/database.md`](docs/architecture/database.md)
- **Two independent Better Auth instances** — store (`clients`, `client.*`
  cookies) vs admin (`users`, `admin.*`). → [`docs/architecture/auth.md`](docs/architecture/auth.md)
- **Route protection is per-app middleware** (store: cart/checkout/account +
  onboarding gate; admin: `/admin/*`). → [`docs/architecture/middleware.md`](docs/architecture/middleware.md)
- Each app has its own local `db` instance; the shared package's `db` is for
  scripts only. → [`docs/architecture/overview.md`](docs/architecture/overview.md)

**More context:** [`README.md`](README.md) · [`docs/README.md`](docs/README.md).

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
| `db:bootstrap-owner` | One-time System Owner bootstrap CLI (RBAC) |
| `lint` / `lint:store` / `lint:admin` | ESLint |
| `test:unit` | Vitest unit tests (workspace: store, admin, db) |
| `test:e2e` / `test:e2e:headed` | Playwright E2E — headless / visible browser |
| `test:e2e:ui` | Playwright UI mode (interactive browser runner) |
| `test:e2e:install` | Install Playwright browsers (Chromium) |

> **Testing prerequisites:** `test:unit` needs no infrastructure; `test:e2e`
> needs Postgres up + seeded, Chromium installed (`test:e2e:install`), and
> auto-starts both dev servers. See [`docs/testing/README.md`](docs/testing/README.md).

> ⚠️ **Use `db:push`, NOT `db:migrate`** (dev). The dev DB is schema-sync
> managed; the `__drizzle_migrations` journal is not kept in sync, so
> `db:migrate` replays old `CREATE TABLE`s and fails with `relation already
> exists`. Generated SQL in `packages/db/drizzle/` is the audit record — never
> hand-edit or delete it. (Deployment containers run `drizzle-kit migrate` — see
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
  bare `timestamp`; send `Date` objects on insert. (Details:
  [`docs/architecture/database.md`](docs/architecture/database.md).)
- **Logging is mandatory for backend logic** — every change to `/api/**` code
  must log through the app's structured logger (`apps/store/src/lib/logger.ts`
  / `apps/admin/src/lib/logger.ts`): minimum `info` on success, `error` with
  context on failure. Details: [`docs/features/logging.md`](docs/features/logging.md).
- Write AGENTS.md and code-facing docs in **English**.

## 4. Agent Constraints & Boundaries

- **Align and approve before acting.** Verify repo facts; ask the user about
  unresolved behavior and scope rather than guessing. For nontrivial work,
  confirm shared understanding before drafting, then obtain explicit user
  approval of the **complete** plan/spec before Ready or implementation;
  orchestrator self-review is not approval. Obtain separate approval of a
  multi-session ticket breakdown before publishing it. Small, well-defined
  requests may proceed from agreed conversational scope without a plan file.
  Stop for new product decisions; do not silently re-plan. Read the on-demand
  [`development-workflow` skill](.agents/skills/development-workflow/SKILL.md)
  for the full process and gates.
- **Subagents are opt-in and bounded.** Spawn only when the user explicitly
  authorizes delegation for the current task/session; plan approval is not
  permission. The main agent chooses bounded handoffs, owns decisions,
  integration, plan-status bookkeeping and acceptance, and validates results.
  No nested delegation without separate permission. Follow the skill's
  handoff, isolation, and loop-stop rules.
- **Plan → execute → review applies to any behavior-affecting change.** "Code"
  is broadly defined — no loopholes: app code, config/env files, schema files,
  seeders, middleware/route configs, files under `deployment/`. Pure research,
  standalone planning, and research/plan documents (e.g. under `plan/` or
  `docs/`) are exempt. Multi-feature conceptual plans live in `plan/` with
  status tracked in `plan/index.md` — see [`plan/README.md`](plan/README.md).
  Implement approved scope one verifiable slice at a time; review against the
  approved behavior and repo standards before accepting the result.
- **Load the matching skill first** — check available skills before starting:
  `tdd` (tests), `systematic-debugging` (bugs, test failures, unexpected
  behavior — never guess a fix), `nextjs` (UI), `better-auth-best-practices` (auth), `frontend-design` (design).
  If subagents are used, they must load the matching skill too; subagent use
  never bypasses a rule.
- **Use Context7** for current library/framework documentation before writing
  code — don't rely on memory for library APIs.
- **Schema edits ONLY in `packages/db/src/schema/`** — apps never define tables.
- **Never treat the two Better Auth instances interchangeably** — cross-type
  sign-in is rejected by session hooks (`INVALID_USER_TYPE`).
- **Onboarding is store-only** — never assume a `role`/onboarding field on the
  wrong table.
- **Keep the seeder in sync with schema** — when tables/columns change, update
  `packages/db/src/seed.ts` (FK-ordered `DELETE` + realistic rows) so
  `db:reset && db:seed` yields a testable DB. Details:
  [`docs/architecture/database.md`](docs/architecture/database.md).
- **Deployment-aware** — when a change touches env vars, domains/URLs/ports,
  cron/webhook endpoints, volumes/healthchecks, or build steps, update the
  matching files under `deployment/` (`common/`, `staging/`, `production/`).
  See [`docs/deployment-docs/README.md`](docs/deployment-docs/README.md).
- **Documentation is part of the task, not a follow-up** — every new/changed
  endpoint and feature needs a doc entry ([`docs/README.md`](docs/README.md)).
  When a plan in `plan/` reaches Done, the plan file is deleted (git history
  is the archive), its entry in `plan/index.md` is marked Done, and enduring
  content is distilled into `docs/` per the `docs/README.md` destination
  rules. Earlier plans under `.agents/` are grandfathered in place and are
  not required to migrate; new plans go to `plan/` only.
- **Jubelio research access.** Read-only GET requests to Jubelio may run during
  research without a separate user decision, using available credentials
  securely and reporting only redacted, relevant fields (never tokens, raw
  customer responses, or PII). Any POST (including authentication via
  `POST /login`) or other request that changes Jubelio data requires explicit
  user permission for that action/scope before it is sent. POST is not
  categorically forbidden; describe the proposed write test and safeguards
  first when applicable. Do not treat permission for one POST as permission for
  other writes or changes to existing orders.
- **No implicit commit, remote access, or push.** A plan/ticket approval does
  not authorize a commit. Commit only when the user requests or authorizes it;
  never include unrelated changes from a dirty worktree. Use the explicitly
  configured SSH connection only when the user explicitly requests the remote
  action — never initiate SSH, file transfer, remote commands, Docker
  operations, restarts, or deployment. Run `git push` only when the user
  explicitly requests it; a local commit does not imply permission to push
  or deploy it.

## 5. Testing Requirements

- **Every new feature or bug fix must ship with tests.** If no test seam
  exists, create one (extract pure helpers, expose a module-level function,
  or add an E2E spec). A task is not complete until tests cover the new behavior.
- **Before committing or opening a PR, run the test suite.** At minimum:
  - `npm run test:unit` for any logic change.
  - `npm run test:e2e` for any UI, routing, or auth change.
- **UI changes require Playwright E2E coverage.** Features touching pages,
  components, forms, or navigation get a `*.spec.ts` under `e2e/store/` or
  `e2e/admin/` asserting user-visible behavior. The canonical way to verify
  a UI feature works is to run its Playwright spec and see it pass.
- **Use the `tdd` skill** (`.agents/skills/tdd/SKILL.md`) for all test work:
  red → green loop, one vertical slice at a time, tests at public seams only,
  expected values from an independent source of truth (no tautological
  assertions). Write the failing test first for features and bug fixes.
- **Keep tests deterministic.** Do not depend on random data, time-of-day, or
  external services that are not mocked / controlled in the test environment.
- **When a Playwright run fails, read the Markdown output — do NOT open the
  screenshot/image file.** Playwright emits a text/Markdown report (snapshot,
  trace, error context) alongside any `.png` attachment. Diagnose from the
  Markdown only; opening the image wastes a turn and is forbidden.

## 6. Communication With the User

- Respond in the user's language unless they request another language. Explain
  the reasoning, relevant project context, practical consequences, and any
  important caveats in enough detail for the user to understand the decision;
  avoid unexplained jargon and unnecessary repetition.
- Ground project-specific claims in references the user can inspect: link to
  relevant code snippets (with file paths and line numbers when available),
  files, endpoints, tests, or project documentation. For library/API claims,
  cite the documentation consulted. Distinguish verified facts from assumptions
  or proposals; never invent a reference or imply a test was run when it was not.
- Give a concrete example and a realistic case when explaining a nontrivial
  behavior, recommendation, or trade-off. Show the input/action and expected
  outcome, not just a generic analogy. Keep examples short and directly tied
  to the question; for straightforward status updates, a full case study is
  unnecessary.
- Before asking the user to decide, explain what prompted the question, what
  the agent already checked, the available options and their trade-offs, and
  what changes under each option. Recommend an option with a reason when the
  evidence supports it. Do not ask the user for facts the agent can verify in
  the repo; ask only for preferences, requirements, or decisions the user owns.
- When reporting work, state what changed, why, where to inspect it, and what
  verification ran (or why it could not run). If blocked or uncertain, say so
  explicitly and give the next actionable step.

**Example — explaining a decision:** "Store and admin authentication must stay
separate: store sessions use `client.*` cookies and the `clients` table, while
admin sessions use `admin.*` and `users` (see
[`docs/architecture/auth.md`](docs/architecture/auth.md)). For example, an
admin user opening a store-only account page should not be treated as a signed-in
store client. Reusing the admin session in the store would violate that boundary."

**Example — asking with context:** "The new stock display needs a source of
truth. The schema is owned by `packages/db/src/schema/`, and the apps consume it
(see [`docs/architecture/database.md`](docs/architecture/database.md)). Should
the storefront show stock per branch (more precise, more UI complexity) or an
aggregate across branches (simpler, hides branch availability)? I recommend per
branch if customers choose a pickup location; which behavior do you want?"