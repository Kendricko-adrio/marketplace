# Plan: <title>

> Status of the plan as a whole is tracked in [`index.md`](index.md) only —
> never in this file. This file tracks **per-feature** status below.

## Goal / Motivation

<Why this plan exists; what problem it solves; links to related docs.>

## Scope

<What is in this plan; describe observable acceptance criteria.>

## Approval

- Shared understanding confirmed by the user: <link to conversation/decision record; pending until confirmed>
- Complete scope and acceptance/verify criteria approved by the user: <link to approval; pending until approved>

Do not mark this plan or a feature Ready while approval is pending or a
behavior-affecting decision is unresolved. Approval of the plan does not
approve subagents, commits, remote access, or deployment.

## Non-scope

<Explicitly out of scope; possible follow-ups.>

## Features

| # | Feature | Status | verify: | Notes |
|---|---|---|---|---|
| 1 | <feature name> | Draft | <command or observable behavior> | <deps, ordering> |
| 2 | | Draft | | |

Per-feature status values (same lifecycle as the plan):
- **Draft** — feature defined but not started.
- **Ready** — feature fully specified within the user's approved plan scope;
  eligible for implementation.
- **In Progress** — implementation started.
- **Done** — feature implemented, its `verify:` passes (tests per `AGENTS.md`
  §5), and its docs are updated.

## Implementation notes

<Sequencing, dependencies, and independently verifiable vertical slices.
Subagent lanes are optional and require separate user authorization; do not
assign overlapping writers to one checkout.>

## Open questions

- <question — resolution; unresolved behavior-affecting questions block Ready>

## Retirement checklist (when the plan reaches Done)

- [ ] Every feature's `verify:` passes (tests per `AGENTS.md` §5).
- [ ] Enduring content extracted to `docs/` per `docs/README.md` destination
      rules (feature docs updated; `docs/api-reference.md` entries added if
      endpoints changed; deployment docs if applicable).
- [ ] Plan file deleted (git history is the archive).
- [ ] [`index.md`](index.md) entry updated to **Done** with date + one-line
      outcome summary (validated by the main agent; delegation only if authorized).