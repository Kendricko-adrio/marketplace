# plan/ — Conceptual Multi-Feature Plans

This folder is the home for **conceptual plans** that bundle multiple features
(typically 2–3+) intended to be developed in parallel or in close sequence.
A plan here is a **standalone planning document** — exempt from the
plan → execute → review loop that applies to behavior-affecting code changes
(see [`AGENTS.md`](../AGENTS.md) §4).

## When to use `plan/` vs `tasks.md`

| Situation | Where |
|---|---|
| Work bundling **2–3+ features** that need shared scope, sequencing, or parallel execution | `plan/` (this folder) |
| A single, small task (bug fix, isolated feature tweak, test addition) | [`tasks.md`](../tasks.md) only |

`tasks.md` is reserved for **small, non-plan work**. Do not duplicate plan
features as top-level tasks there; per-feature implementation work may appear
as sub-tasks whose `verify:` links back to the plan file, but **plan status
itself lives only in [`plan/index.md`](index.md)**.

## Plan lifecycle

Status is tracked in [`plan/index.md`](index.md) for the plan as a whole, and
per-feature inside each plan file (same four statuses, one per feature).

| Status | Meaning |
|---|---|
| **Draft** | Plan is being written or awaiting owner approval; features/statuses inside the file are provisional. Nothing implemented. A loop must not pick it up. |
| **Ready** | Complete plan and acceptance/verify criteria **explicitly approved by the user**; eligible for implementation within that approved scope; no code touched yet. |
| **In Progress** | Implementation started; at least one feature has begun. |
| **Done** | All features implemented, tested, verified, and enduring knowledge extracted to `docs/`. Plan file **deleted**; index entry retained with date + one-line outcome summary. |

### Transition criteria

- **Draft → Ready:** after repo facts and user decisions are aligned, show the
  complete draft (scope, non-scope, features, acceptance/verify criteria, open
  questions) to the user. Resolve all behavior-affecting open questions and
  obtain explicit approval of the **complete** scope and criteria. Record the
  approval in the plan file before updating this index. Orchestrator self-review
  alone is insufficient; neither publication nor an autonomous loop may treat
  a Draft plan as implementable.
- **Ready → In Progress:** first approved feature work starts, directly or by
  an explicitly authorized delegation. Ready approves scope, not subagents,
  commits, remote access, or deployment. If a new product decision or scope
  change appears, stop affected work and ask the user before continuing.
- **In Progress → Done:** every feature passes its verification (tests per
  `AGENTS.md` §5), enduring content is extracted to `docs/` (feature doc
  updated, `docs/api-reference.md` entries added if endpoints changed,
  deployment docs if applicable), then the plan file is deleted and the index
  entry is flipped to Done.

### Done = delete + index + docs extract

There is **no archive folder** — **git history is the archive** of the deleted
plan file. On Done:

1. All features verified (tests per `AGENTS.md` §5).
2. Enduring knowledge distilled into `docs/` per
   [`docs/README.md`](../docs/README.md) destination rules.
3. Plan file deleted (git history retains it).
4. Index entry updated to Done with date + outcome summary — the entry stays
   in the index permanently.

**The index is the single source of truth for plan status**; each plan file
tracks only per-feature status. Never keep both systems disagreeing.

### Who does the bookkeeping

The main agent owns plan-status bookkeeping — index updates and plan-file
retirement after verification. It may delegate that work only when the user
has explicitly authorized subagents for the task/session, and must validate
the result (index row matches reality, file actually deleted, docs extraction
in place) before accepting it. Existing In Progress plans remain In Progress;
new or changed behavior still needs user confirmation.

## Per-feature status convention

Inside a plan file, each feature carries its own status from the same four
values (Draft / Ready / In Progress / Done) plus its `verify:` criteria —
see [`_template.md`](_template.md).

## Grandfathered `.agents/` plans

Earlier plans live under `.agents/` (`plan.md`, `rbac-new-plan.md`,
`rbac-new-handoff.md`). They are **grandfathered in place**: untouched, with
their own tracking, and intentionally **not** indexed in
[`plan/index.md`](index.md). Until they retire, a full status check consults
both locations. **New plans go to `plan/` only.**

## Starting a new plan

Read the [`development-workflow` skill](../.agents/skills/development-workflow/SKILL.md),
resolve the user's decisions before drafting an actionable plan, then copy
[`_template.md`](_template.md) → `plan/<kebab-name>.md` and add a `Draft` row
to [`plan/index.md`](index.md). Show the finished draft for explicit user
approval before changing the index to Ready. Follow the retirement checklist
in the template when the plan completes.