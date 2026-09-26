# Architecture Docs — Marketplace

Internal reference for how the codebase is structured and worked with. These
docs are the deep-dive companions to `AGENTS.md` (which keeps the rules and
commands) and are aimed at anyone — agent or human — modifying this repo.

## When to read what

| File | Use it when… |
|---|---|
| [overview.md](overview.md) | You need the full project structure, tech stack, how each app connects to the DB, or path aliases. |
| [database.md](database.md) | You are changing the schema, generating/pushing migrations, or wondering about `db:push` vs `db:migrate` / timestamp conventions. |
| [auth.md](auth.md) | You are touching authentication, sign-in/sign-up, sessions, roles, or the Better Auth instances. |
| [middleware.md](middleware.md) | You are adding/changing route protection, the onboarding gate, or the admin password-reset gate. |
| [code-organization.md](code-organization.md) | You need the agreed feature-first folder structure and Route Handler/service/repository boundaries for a refactor. |
| [nextjs-api-organization-research.md](nextjs-api-organization-research.md) | You want the source research behind that code-organization decision. |
| [agent-workflow-research.md](agent-workflow-research.md) | You want the source research behind the agent planning workflow. |
| [matt-skills-integration.md](matt-skills-integration.md) | You need the vendored Matt Pocock skill list, prerequisites, and Pi/project-policy adaptations. |

## Rule of thumb

- `AGENTS.md` = the rules, commands, and boundaries you must not violate.
- `docs/architecture/` = the *how it works* detail behind those rules.
- `docs/` root (`../README.md`) = the index of *all* project docs + the rules
  for where a new doc belongs.
