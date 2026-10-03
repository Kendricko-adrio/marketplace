---
name: development-workflow
description: Use for behavior-affecting changes in the marketplace repo to align scope before planning, gate plan/ticket approval, implement approved work, and delegate bounded subagent tasks only when authorized.
---

# Marketplace development workflow

Read [`AGENTS.md`](../../../AGENTS.md) for always-on constraints, [`plan/README.md`](../../../plan/README.md) for the plan lifecycle, and the relevant app's `AGENTS.md` before changing app code. This skill provides the detailed procedure, not authority to bypass those files. A user's concrete, already-agreed request is not an excuse to create an unnecessary plan; an ambiguous request is not permission to invent its answer.

## 1. Establish facts and select a route

- Read relevant code, tests, and docs; distinguish verified facts from assumptions. Research external facts only when they block a decision, using primary sources and a short cited note where useful. Do not repeat settled research without identifying a missing or stale fact. Library work still follows the repo's current-documentation rule.
- Bugs and regressions: load `systematic-debugging`; reproduce the user's symptom before deciding on a fix. UI/auth/test work must also load the matching project skills.
- Small, well-defined change that fits one session: align on the observable behavior in conversation; skip a multi-feature plan file and tickets. The user's clear request can establish scope; do not demand a ceremonial approval for every trivial edit.
- Multi-feature change: use `plan/` and its index. A large, foggy multi-session effort may use `wayfinder` if available to settle **decision tickets** before writing an implementation plan. Do not create a decision map for work that can be resolved in one session.
- Do not assume an upstream skill, issue tracker, remote operation, or subagent permission exists merely because a workflow example mentions it. Use installed skills where appropriate; follow this project's gates even if an upstream skill would publish or commit automatically. See [`docs/architecture/matt-skills-integration.md`](../../../docs/architecture/matt-skills-integration.md) for the imported-skill prerequisites and Pi compatibility notes.

### Imported skills in Pi

When an upstream Matt Pocock skill says "Call the Skill tool", Pi may not expose such a tool. Load the named skill's `SKILL.md` with `read` or invoke `/skill:<name>` explicitly instead; do not merely mention its name and assume it ran. The `grilling` skill's question rounds still use this project's `ask_user_question` rule. Do not let `grill-with-docs` or `wayfinder` silently launch a child, publish to a tracker, or make a product decision.

`to-spec`, `to-tickets`, `wayfinder`, and `code-review` assume a configured tracker that this repo has not set up. `plan/index.md` is **not** that tracker. Do not publish issues or default to a second local tracker without user approval of the tracker and its location. `implement` asks for a commit, `prototype` asks for a throwaway-branch commit, and `research`/`code-review`/`wayfinder` ask for subagents: these upstream instructions are conditional on this project's separate user-authorization gates. For uncommitted work, review the working-tree and staged diff too, not only a `git diff <ref>...HEAD` comparison. Do not modify vendored upstream files to resolve these differences; keep project-specific policy here.

## 2. Align before an actionable nontrivial plan/spec

- Ask only questions about decisions the user owns; look up filesystem/code/API facts yourself. Ask dependency-aware rounds where one answer affects later choices. Offer a recommendation with trade-offs, but let the user decide. If a prototype is necessary, use it to make alternatives concrete, not to select the winner on the user's behalf.
- Read back the goal, confirmed decisions, non-goals, observable acceptance/verification criteria, and remaining uncertainty. Ask for explicit confirmation of the shared understanding before writing an actionable nontrivial plan/spec. Keep unresolved choices visible as questions, not assumed implementation decisions.
- Draft the plan/spec from that understanding, including tests at public seams and deployment implications when applicable. Show the **complete** draft or a reviewable link plus an accurate decision/edge-case summary. Obtain explicit user approval of the complete scope and acceptance criteria before marking a plan `Ready`, publishing an agent-ready spec, queueing a task for an autonomous loop, or starting implementation. Editing an approved contract requires renewed approval if it changes behavior, scope, or acceptance criteria.
- `Draft` is not authorization. Record the approval and its scope in the plan's approval section and transition the index only after the gate passes. Existing `In Progress` plans are not retroactively returned to `Draft`; new decisions or scope changes still require confirmation.

## 3. Slice only when useful

- If the build spans sessions or the user requests a multi-ticket breakdown, propose tracer-bullet tickets: each delivers a narrow, independently testable end-to-end behavior (rather than a whole database/API/UI layer), with acceptance criteria and real blockers. Show the numbered breakdown and dependencies to the user; get separate approval before publishing/queueing tickets. Small work goes straight from approved conversational scope or spec to implementation.
- Tickets convey *what* must work, not a brittle list of file paths or an invitation to redesign product behavior. Carry the approved spec, testing seams, exclusions, and source-of-truth research in the handoff. **A session may cover one or several approved tickets according to the user's requested scope.** Even in a multi-ticket session, implement, test, review, and record the outcome of each verifiable slice before moving to the next; respect dependencies and do not mark blocked or unverified tickets Done. A new product decision still requires owner approval, not an agent-selected default. No second product plan is required.

## 4. Implement, review, and close

- Start from the approved behavior; make a short technical work sequence, then use `tdd` at agreed public seams. Run focused tests/typechecks as you go and the suites required by `AGENTS.md` before reporting completion. Update feature/API/deployment docs where applicable.
- If implementation reveals a new product, policy, or architecture choice outside the approved scope, stop the affected work, explain the options, and request a user decision. Do not let a worker, reviewer, or loop silently expand the spec.
- Review the changed diff against **both** repo standards and the approved spec/acceptance criteria. Verify findings against current files and test results. Check the exact changed files, including any pre-existing user changes; never claim the full suite passed if it did not run.
- The main agent owns `plan/index.md` consistency, docs extraction, and plan-file retirement at `Done` (directly or by validating an authorized handoff). Commits require user authorization; push, remote work, and deployment each require the explicit permission specified in `AGENTS.md`.

## 5. Delegation when explicitly authorized for this task/session

The main agent decides whether a bounded subagent earns its cost; authorization is opt-in, not an order to delegate every stage. Do not treat plan approval as subagent permission. Keep owner decisions, routing, integration, and final verification in the main agent.

| Stage | Good bounded handoff | Avoid |
|---|---|---|
| Fact finding | One read-only scout for a named code area, or one researcher for a specific external question; parallel only for distinct evidence | Several children each rediscovering the whole repo |
| Alignment/wayfinding | A focused research question or disposable prototype, if it unblocks a human decision | Child deciding scope or conducting the owner's interview |
| Spec/tickets | Optional read-only contradiction check on a high-risk draft | Multiple agents inventing competing actionable plans or dependencies |
| Implementation | One worker on one approved slice with exclusive ownership; parallel only for genuinely independent contracts in isolated worktrees | Overlapping writers in one checkout or a worker redesigning the feature |
| Review | One fresh read-only reviewer for a meaningful risk; two distinct angles only if justified | Endless review/polish cycles or duplicate broad reviews |

Every child gets a compact cold-start packet: objective; repo/cwd/ref; approved spec/ticket and **existing research**; exact code seam or file ownership; allowed actions (read/edit/commit/push/remote); acceptance criteria; focused validation; output/report format; and stop/escalation rules. The packet must stand alone without making the child repeat broad discovery. Require matching project skills inside the child. Do not allow nested subagents unless separately authorized.

Use one writer per checkout/worktree. If independently testable contracts warrant parallel writers, give each an exclusive boundary and isolated worktree, require durable handoffs, then let the main agent integrate and run final validation. Existing dirty changes must not be overwritten or swept into a child commit. Delegate plan-status bookkeeping only within the authorized boundary and verify it personally.

Prefer a single targeted review followed by fixing substantiated findings and **one focused recheck** of the affected area. If the same issue persists or a new owner decision is needed, stop and report the blocker instead of spawning another automatic worker/reviewer round. A child report or clean review is evidence, never acceptance authority. Do not use a tight hard tool-call budget that could interrupt a mutation mid-tool; scope the task, request a checkpoint, and escalate when blocked.
