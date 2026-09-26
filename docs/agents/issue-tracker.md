# Issue tracker: Local Markdown

Issues for wayfinding in this repo live as Markdown files in `.scratch/`. This tracker is separate from [`plan/index.md`](../../plan/index.md), which remains the source of truth for conceptual plan status. Publishing an actionable plan or implementation tickets still requires the approvals in [`AGENTS.md`](../../AGENTS.md) and [`development-workflow`](../../.agents/skills/development-workflow/SKILL.md).

## Conventions

- One effort per directory: `.scratch/<effort>/`.
- The wayfinding map is `.scratch/<effort>/map.md`.
- Child issues are `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`.
- A child carries `Type: research | prototype | grilling | task` and `Status: open | claimed | resolved`; its `Blocked by:` line lists the numbers of prerequisite children.
- Comments and conversation history may be appended under `## Comments`. A decision answer belongs in the child, not duplicated in the map.

## When a skill says "publish to the issue tracker"

Write the approved issue as a file under `.scratch/<effort>/`. Do not silently publish remotely or use `plan/index.md` as an issue tracker.

## When a skill says "fetch the relevant ticket"

Read its path under `.scratch/<effort>/issues/`; for a map, read `.scratch/<effort>/map.md`.

## Wayfinding operations

- **Map**: `.scratch/<effort>/map.md`, labelled `wayfinder:map`, with Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child**: `.scratch/<effort>/issues/NN-<slug>.md`, with a question, type, status, and parent map link. Child links and titles provide the identity; do not use bare issue numbers in human-facing summaries.
- **Blocking**: `Blocked by: NN, NN` near the top of the child; absent/`none` means unblocked. A child is unblocked only when every listed child has `Status: resolved`.
- **Frontier**: open, unblocked, unclaimed children, ordered by number. Open tickets are found by scanning `issues/`, not repeated in the map body.
- **Claim**: change `Status: open` to `Status: claimed` before starting work, so another session skips it.
- **Resolve**: append the answer under `## Answer`, set `Status: resolved`, then append a one-line gist and a named link to the map's Decisions so far. Record decisions in the child only; the map is an index.

Research subagents, provider requests, sandbox writes, application changes, commits, and remote publication each remain subject to the repo's separate authorization rules; the presence of a ticket does not authorize them.
