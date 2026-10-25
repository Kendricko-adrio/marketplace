---
name: development-workflow
description: Use for behavior-affecting changes in the marketplace repo to align scope before planning, gate plan/ticket approval, implement approved work, and delegate bounded subagent tasks only when authorized.
---

# Marketplace development workflow

Read [`AGENTS.md`](../../../AGENTS.md) for always-on constraints, [`.scratch/README.md`](../../../.scratch/README.md) for the plan lifecycle, and the relevant app's `AGENTS.md` before changing app code. This skill provides the detailed procedure, not authority to bypass those files. A user's concrete, already-agreed request is not an excuse to create an unnecessary plan; an ambiguous request is not permission to invent its answer.

## 1. Establish facts and select a route

- Read relevant code, tests, and docs; distinguish verified facts from assumptions. Research external facts only when they block a decision, using primary sources and a short cited note where useful. Do not repeat settled research without identifying a missing or stale fact. Library work still follows the repo's current-documentation rule.
- Bugs and regressions: load `systematic-debugging`; reproduce the user's symptom before deciding on a fix. UI/auth/test work must also load the matching project skills.
- Small, well-defined change that fits one session: align on the observable behavior in conversation; skip a multi-feature plan file and tickets. The user's clear request can establish scope; do not demand a ceremonial approval for every trivial edit.
- Perubahan multi-feature: simpan artefak di `.scratch/<feature>/` dan status plan di `index.md` milik fitur tersebut. Gunakan satu slug stabil lintas sesi, research, wayfinding, dan implementasi; jangan membuat folder `<feature>-implementation` atau global status index. Effort besar lintas sesi boleh memakai `wayfinder` untuk menyelesaikan **decision tickets** sebelum implementation plan; pekerjaan satu sesi tidak memerlukan decision map.
- Do not assume an upstream skill, issue tracker, remote operation, or subagent permission exists merely because a workflow example mentions it. Use installed skills where appropriate; follow this project's gates even if an upstream skill would publish or commit automatically. See [`docs/architecture/matt-skills-integration.md`](../../../docs/architecture/matt-skills-integration.md) for the imported-skill prerequisites and Pi compatibility notes.

### Imported skills in Pi

When an upstream Matt Pocock skill says "Call the Skill tool", Pi may not expose such a tool. Load the named skill's `SKILL.md` with `read` or invoke `/skill:<name>` explicitly instead; do not merely mention its name and assume it ran. The `grilling` skill's question rounds still use this project's `ask_user_question` rule. Do not let `grill-with-docs` or `wayfinder` silently launch a child, publish to a tracker, or make a product decision.

Tracker Local Markdown sudah dikonfigurasi di [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md). Output `research` masuk `.scratch/<feature>/research/`; output `to-spec` dan plan/proposal masuk `plan/` di dalam fitur; map dan decision tickets `wayfinder` masuk `wayfinder/`; output `to-tickets`, implementation map, handoff, dan verification masuk `ticket/`. Prototype opsional masuk `prototype/`. Gunakan [`panduan artefak`](../../../.scratch/README.md) dan [`template plan`](../../../.scratch/templates/plan.md). Penempatan ini mengesampingkan contoh path upstream, tanpa mengubah vendored skills. `index.md` fitur menavigasi artefak dan mencatat status plan, bukan tracker status ticket kedua. Publikasi breakdown tetap perlu approval user; mengganti tracker atau publikasi remote perlu izin tersendiri. `implement` asks for a commit, `prototype` asks for a throwaway-branch commit, and `research`/`code-review`/`wayfinder` ask for subagents: these upstream instructions are conditional on this project's separate user-authorization gates. For uncommitted work, review the working-tree and staged diff too, not only a `git diff <ref>...HEAD` comparison. Do not modify vendored upstream files to resolve these differences; keep project-specific policy here.

## 2. Align before an actionable nontrivial plan/spec

- Ask only questions about decisions the user owns; look up filesystem/code/API facts yourself. Ask dependency-aware rounds where one answer affects later choices. Offer a recommendation with trade-offs, but let the user decide. If a prototype is necessary, use it to make alternatives concrete, not to select the winner on the user's behalf.
- Read back the goal, confirmed decisions, non-goals, observable acceptance/verification criteria, and remaining uncertainty. Ask for explicit confirmation of the shared understanding before writing an actionable nontrivial plan/spec. Keep unresolved choices visible as questions, not assumed implementation decisions.
- Draft the plan/spec from that understanding, including tests at public seams and deployment implications when applicable. Show the **complete** draft or a reviewable link plus an accurate decision/edge-case summary. Obtain explicit user approval of the complete scope and acceptance criteria before marking a plan `Ready`, publishing an agent-ready spec, queueing a task for an autonomous loop, or starting implementation. Editing an approved contract requires renewed approval if it changes behavior, scope, or acceptance criteria.
- `Draft` is not authorization. Record the approval and its scope in the plan's approval section and transition the index only after the gate passes. Existing `In Progress` plans are not retroactively returned to `Draft`; new decisions or scope changes still require confirmation.
- Carry a **technical blueprint** and a **UX blueprint** inside the same spec/plan file whenever the work touches code. They are an advisory checklist, not an extra gate: fill what applies, record every empty part as an open item, and never claim the design is complete while a path, state, or label is still undecided. For a small single-session change, 4–6 lines (files touched + relevant UI states) are enough.

### Technical blueprint

- File table: full `path`, create/modify, a 1–3 line responsibility, the layer from [`docs/architecture/code-organization.md`](../../../docs/architecture/code-organization.md) (`route.ts` / `-service.ts` / `-repository.ts` / `-client.ts` / UI component / `packages/db/src/schema/`), and the test seam. Full paths, never bare filenames — bare names are what make an implementer write the same module twice in two places.
- Exported contract for each new or contract-changing file: function/type names and parameters, **without bodies**. This is the seam neighbouring slices code against, not an implementation manual.
- Non-obvious structure decisions (new module, new folder, splitting a file, shared vs app-local) with the reason and the rejected alternative.
- `discovery:` marker with a concrete question wherever a file is genuinely unknown. An unknown is a discovery task; guessing it mid-implementation is not.

### UX blueprint

Required when the change affects UI; otherwise write `N/A — <reason>`.

- The agreed **reference page/pattern** compared for cross-page consistency, and the hierarchy with its single dominant primary action.
- **Component reuse map**: existing shared component (with path) versus new, and which variant applies.
- **State matrix** per screen with final labels/copy: idle, loading, empty, error, success, disabled/permission-restricted, unsaved. A state that is not in the table will not be implemented.
- Target viewport, responsive behaviour, and the keyboard/focus/contrast points to verify.
- When the owner asks for a prototype, record it as the **binding** reference for screen structure, flow, action naming, and states — while existing tokens and shared components remain the source of truth for visuals. Never copy prototype CSS or introduce ad-hoc values, fonts, or palettes.

### Blueprint checklist (advisory)

- [ ] File table: path, action, responsibility, layer, test seam
- [ ] Exported contract (names + parameters) for new or contract-changing files
- [ ] Non-obvious structure decisions with rejected alternatives
- [ ] `discovery:` markers where paths are genuinely unknown
- [ ] (UI) Agreed reference page/pattern + component reuse map
- [ ] (UI) State matrix + final labels/copy per screen
- [ ] (UI) Target viewport, responsive, keyboard/focus, contrast
- [ ] (UI) Requested prototype recorded as the binding reference

## 3. Slice only when useful

- If the build spans sessions or the user requests a multi-ticket breakdown, propose tracer-bullet tickets: each delivers a narrow, independently testable end-to-end behavior (rather than a whole database/API/UI layer), with acceptance criteria and real blockers. Show the numbered breakdown and dependencies to the user; get separate approval before publishing/queueing tickets. Small work goes straight from approved conversational scope or spec to implementation.
- Tickets convey *what* must work and inherit the approved technical/UX blueprint; they are not an invitation to redesign product behavior. A ticket may refine a file name or placement only while the approved layer convention and exported contracts stay intact, and the deviation is written to the plan's deviation log and reported to the owner. A new module, a new behavior, or a state/label outside the approved blueprint still needs an owner decision. Carry the approved spec, blueprint, testing seams, exclusions, and source-of-truth research in the handoff. **A session may cover one or several approved tickets according to the user's requested scope.** Even in a multi-ticket session, implement, test, review, and record the outcome of each verifiable slice before moving to the next; respect dependencies and do not mark blocked or unverified tickets Done. A new product decision still requires owner approval, not an agent-selected default. No second product plan is required.

## 4. Implement, review, and close

- Start from the approved behavior; make a short technical work sequence, then use `tdd` at agreed public seams. Run focused tests/typechecks as you go and the suites required by `AGENTS.md` before reporting completion. Update feature/API/deployment docs where applicable.
- If implementation reveals a new product, policy, or architecture choice outside the approved scope, stop the affected work, explain the options, and request a user decision. Do not let a worker, reviewer, or loop silently expand the spec.
- Review the changed diff against **both** repo standards and the approved spec/acceptance criteria, plus the approved blueprints: a file outside the file table, a state/label missing from the state matrix, or an invented component is a review finding even when the tests pass. Verify findings against current files and test results. Check the exact changed files, including any pre-existing user changes; never claim the full suite passed if it did not run.
- Main agent bertanggung jawab atas konsistensi `.scratch/<feature>/index.md`, ekstraksi enduring docs, dan penutupan plan saat `Done` (langsung atau memvalidasi handoff yang diizinkan). Simpan file plan beserta research/decision/ticket/evidence; jangan hapus plan saat Done. Index mencatat tanggal, hasil, dan bukti verifikasi tanpa menduplikasi status ticket. Plan legacy juga mengikuti layout ini; status lama tidak dinaikkan atau di-reset hanya karena migrasi. Commits require user authorization; push, remote work, and deployment each require the explicit permission specified in `AGENTS.md`.

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
