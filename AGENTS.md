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
- **Backend structure and logging follow the `maintainable-code` skill** —
  feature-first `route.ts` → `*-service.ts` → `*-repository.ts` / `*-client.ts`,
  one service per business operation, no query inside `route.ts`, and
  module-scoped loggers that are never passed as parameters. Read
  [`.agents/skills/maintainable-code/SKILL.md`](.agents/skills/maintainable-code/SKILL.md)
  and [`docs/architecture/code-organization.md`](docs/architecture/code-organization.md)
  before writing or restructuring backend code.
- **Logging is mandatory for backend logic** — every change to `/api/**` code
  must log through the app's structured logger (`apps/store/src/lib/logger.ts`
  / `apps/admin/src/lib/logger.ts`): minimum `info` on success, `error` with
  context on failure. Details: [`docs/features/logging.md`](docs/features/logging.md).
- Keep AGENTS.md in **English**. For generated documents, follow the
  **Indonesian documentation policy** in §6.

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
- **Write the technical and UX blueprint before implementation.** A nontrivial
  spec/plan carries, inside the same file, the file-level technical blueprint
  (full paths, responsibility, layer, exported contract, test seam) and the UX
  blueprint (reference page, component reuse map, state matrix with final copy,
  viewport/accessibility). Both are an **advisory checklist**: unfilled parts
  become open items, and a requested prototype is the binding reference for
  flow, structure, and states while existing tokens/components stay the visual
  source of truth. A small single-session change may use a 4–6 line mini
  version. Details: [`development-workflow` §2](.agents/skills/development-workflow/SKILL.md)
  and [`ux-design` §3](.agents/skills/ux-design/SKILL.md).
- **Subagents are opt-in, bounded, and edit-only implementers.** Spawn only
  when the user explicitly authorizes delegation for the current task/session;
  plan approval is not permission. For implementation handoffs, subagents may
  read and edit files (including code, tests, and docs), but must not run unit
  tests, E2E tests, builds, lint, typechecks, or other validation commands.
  They hand back their changes and a concise report, then stop. The main agent
  owns integration, review, and all validation: inspect the changes, run the
  relevant tests/checks, and decide any follow-up edits. No nested subagents
  without separate permission. Follow the skill's handoff, isolation, and
  loop-stop rules. Implementation handoffs use the project `implementer` agent
  ([`.agents/agents/implementer.md`](.agents/agents/implementer.md)), whose tool
  allowlist has no shell — a child cannot run validation even by accident. The
  main agent owns the verification ladder in §5.
- **Plan → execute → review applies to any behavior-affecting change.** "Code"
  is broadly defined — no loopholes: app code, config/env files, schema files,
  seeders, middleware/route configs, files under `deployment/`. Pure research,
  standalone planning, and research/plan documents (e.g. under `plan/` or
  `docs/`) are exempt. Multi-feature conceptual plans live in `plan/` with
  status tracked in `plan/index.md` — see [`plan/README.md`](plan/README.md).
  Implement approved scope one verifiable slice at a time; review against the
  approved behavior and repo standards before accepting the result.
- **Load the matching skill first** — the lookup is mandatory before
  implementation, for the main agent **and** for an authorized implementer
  subagent: `ux-design` (all coding; mandatory UX and cross-page consistency
  gates for frontend), `maintainable-code` (backend structure, service/repository
  boundaries, contextual logging), `tdd` (tests), `systematic-debugging` (bugs,
  test failures, unexpected behavior — never guess a fix), `nextjs` (UI),
  `better-auth-best-practices` (auth), `frontend-design` (visual polish within
  the established design system). If subagents are used, they must load the
  matching skill too; subagent use never bypasses a rule, and loading a skill
  never grants scope, delegation, or commit/remote permission that the user did
  not approve separately.
- **Mandatory UX skill lookup before coding, especially frontend development.**
  Read [`.agents/skills/ux-design/SKILL.md`](.agents/skills/ux-design/SKILL.md)
  in full before any coding task; merely naming the skill is not loading it.
  For frontend development (pages, components, forms, navigation, layout,
  styling, themes/tokens, and interaction states), apply its task-flow,
  clickability, concise-copy, spacing, accessibility, and cross-page consistency
  gates. Reuse the established shared components and design tokens; do not
  invent a different visual style per page. `ux-design` usability and consistency
  requirements take precedence over conflicting aesthetic advice in
  `frontend-design`. For backend-only work without UX impact, record that the
  visual gates are not applicable. This requirement also applies to authorized
  implementer subagents; the main agent still owns all validation.
- **Context7 inquiry is mandatory before implementation.** Model knowledge stops
  at its training cut-off, so never write library/framework API code from
  memory. Before the first code slice that touches an external package
  (Next.js 16, React, Drizzle ORM/drizzle-kit, Better Auth, Zod, Tailwind,
  Playwright, Vitest, etc.):
  1. `mcp__context7__resolve_library_id` with `{ libraryName: "<package>" }`
     to get the canonical library ID for the installed version.
  2. `mcp__context7__query_docs` with
     `{ libraryId: "<id>", query: "<specific API question>" }` for every
     uncertain signature, option, migration, or deprecation.
  3. Record the library ID and what was confirmed in the plan/ticket/slice notes
     (e.g. `Context7 checkpoint: <id> — <what was verified>`), so review can
     audit it.
  These tools come from the project server in `.pi/mcp.json` (OAuth, exposure
  `direct`). If a lookup fails with `needs sign-in`, run `/mcp login context7`
  (or `pi mcp login context7`) and retry. Skip the lookup only when the slice
  touches no external API surface (pure refactor of already-confirmed code,
  CSS/layout tweaks, docs, repo-internal logic), and say so in one line.
  Subagents cannot call MCP tools (the `implementer` allowlist has neither
  shell nor MCP), so the main agent runs the inquiry and passes the confirmed
  signatures/options into the handoff packet; "the subagent should check
  Context7" is not a valid handoff. If Context7 is unreachable, fall back to
  the installed package types/source in `node_modules` or official vendor docs
  and state which source replaced it — silent guessing is a violation. Setup:
  [`docs/agents/mcp-tooling.md`](docs/agents/mcp-tooling.md).
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
- **Frontend acceptance also requires the `ux-design` review gate.** The main
  agent must inspect the rendered UI and relevant interaction states, compare
  it against an agreed peer-page/shared-pattern reference, and verify cross-page
  consistency alongside the required Playwright coverage. JSX inspection or a
  passing click test alone does not establish good UX. If browser verification
  is blocked, report that limitation and do not claim frontend completion.
- **Use the `tdd` skill** (`.agents/skills/tdd/SKILL.md`) for all test work:
  one vertical slice at a time, tests at public seams only, expected values
  from an independent source of truth (no tautological assertions), and write
  the failing test first for features and bug fixes. When an implementation is
  delegated, the subagent authors/updates tests but does not execute them; the
  main agent runs the tests and completes the red → green verification loop.
- **Verification ladder — cheap per slice, expensive per batch.** Batching test
  runs is allowed; skipping verification is not.
  - **L0 (every slice, seconds):** `npm run verify:types:store` and/or
    `npm run verify:types:admin` (`tsc --noEmit`, incremental).
  - **L1 (every slice):** `npm run verify:unit:slice -- <explicit test paths>` —
    only the files the slice touched. Never leave the file list implicit.
  - **L2 (every batch of tickets):** `npm run verify:batch:unit` (serial, compact
    reporter) plus only the mock E2E specs the batch touched:
    `npm run verify:batch:e2e -- e2e/store/<spec>-mock.spec.ts`.
  - **L3 (before commit/PR, and at the integration ticket):** the full suites
    required above. The legacy `npm run test:e2e` still needs separate
    authorization.
  - A ticket may sit at `claimed` until its batch gate passes, but it is never
    `resolved` without recorded L2/L3 evidence. Keep output bounded: capture to a
    log outside the repo or print only summary/FAIL lines, and never re-run a
    suite that already passed — record its summary line as evidence instead. New
    mock specs must also be added to `playwright.mock.config.ts` `testMatch`, or
    they silently never run.
- **Keep tests deterministic.** Do not depend on random data, time-of-day, or
  external services that are not mocked / controlled in the test environment.
- **When a Playwright run fails, read the Markdown output — do NOT open the
  screenshot/image file.** Playwright emits a text/Markdown report (snapshot,
  trace, error context) alongside any `.png` attachment. Diagnose from the
  Markdown only; opening the image wastes a turn and is forbidden.

## 6. Communication With the User

- **Generate all documentation in Indonesian**, unless the user explicitly
  requests another language. This includes research notes, proposals, wayfinder
  maps and decision tickets, specifications, plans, ADRs, architecture/feature/API
  documentation, and agent-facing handoffs. Preserve commonly used English
  technical/product terms, code/API/database identifiers, file paths, commands,
  and machine-readable tracker metadata keys/values rather than translating
  them awkwardly or breaking automation. AGENTS.md remains the English-language
  agent instruction file; this exception does not make English the default for
  other generated documents. Existing documents outside the requested scope do
  not need wholesale translation, but newly generated content must follow this
  policy.
- Respond in the user's language unless they request another language. When
  responding in Indonesian, keep commonly used English technical and product
  terms in English rather than translating them literally or awkwardly. This
  applies broadly, not just to specific examples such as interface, mock,
  testing, develop, and UAT. Explain the reasoning, relevant project context,
  practical consequences, and any important caveats in enough detail for the
  user to understand the decision; avoid unexplained jargon and unnecessary
  repetition.
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