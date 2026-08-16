# Project Documentation — Marketplace

Documentation is **mandatory, not optional** — treat doc updates as part of the
work, not a follow-up. This file is the index of `docs/` and the rules for
where a new doc belongs.

## Folder Structure

Docs are organized by **purpose**, not by app. Before writing any doc, decide
which category it belongs to, then place it in the matching folder:

| Folder / file | Content |
|---|---|
| `docs/api-reference.md` | HTTP endpoints **of our own apps** — a single file at the root. Every new/changed `route.ts` (store & admin, including webhooks, cron, internal) is recorded here. |
| `docs/features/` | **Feature** docs (user-facing or operational): design, invariants, env/secrets, flow. One file per feature, e.g. `docs/features/stock-reservation.md`. |
| `docs/deployment-docs/` | **Deployment/operational** docs: VPS setup, Docker, Caddy, server cron, troubleshooting. One topic per file. |
| `docs/<vendor>-api/` | **Third-party API** references the project uses (OpenAPI spec + explaining README), e.g. `docs/jubelio-api/`. |
| `docs/architecture/` | **Internal codebase reference**: structure, DB, auth, middleware (index: `docs/architecture/README.md`). |

## Deciding the Folder (agent-authorized)

- **Our own API endpoint** (new or changed route) → `docs/api-reference.md`,
  following the existing entry format (method, path, auth, body, response,
  purpose).
- **Feature** (user-facing or operational: Jubelio sync, stock reservation,
  new admin module, checkout changes, new payment path, etc.) →
  `docs/features/<feature>.md`.
- **Deployment/operational step** (new env var, domain/URL/port, cron/webhook
  on the server, volume/healthcheck/Dockerfile, etc.) → `docs/deployment-docs/`.
- **Third-party API** (spec/docs of an external service used by the code) →
  `docs/<vendor>-api/` (e.g. `docs/jubelio-api/`).
- **Internal codebase architecture** (schema, auth, middleware, structure) →
  `docs/architecture/`.

Agents must judge for themselves whether a doc fits one of the folders above.
If nothing fits (a category that has never existed), **create a new folder**
under `docs/` with a descriptive kebab-case name and a `README.md` explaining
its contents and when to use it. Do **not** force a doc into a wrong folder
just because that folder exists — a new folder is better than a misplaced doc.

Before placing a doc, check the live folder structure with `ls docs/` (do not
rely on memory) and update `docs/features/` / `docs/deployment-docs/`
index/README if any of them mention a file that moved.

## Rules

- **Keep `docs/api-reference.md` fresh**: every new/changed endpoint is
  recorded, and entries whose behavior changed are updated too.
- When a doc references deployment steps already in `docs/deployment-docs/`,
  keep those files in sync.
- A feature that touches many files → one doc in `docs/features/` (don't
  scatter files across the `docs/` root).

## Index

| Area | Where to start |
|---|---|
| API reference (our endpoints) | `docs/api-reference.md` |
| Features | `docs/features/` (e.g. `stock-reservation.md`, `jubelio-sync.md`) |
| Deployment / ops | `docs/deployment-docs/README.md` |
| Third-party APIs | `docs/jubelio-api/README.md` |
| Internal architecture | `docs/architecture/README.md` |
