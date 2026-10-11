# Guided Admin Delivery Workflow — Implementation Tickets

Label: implementation:map

## Destination and source of truth

Implement the owner-approved [complete specification](../../plan/admin-delivery-workflow-spec.md), including its normative decision/copy artifacts and AC01–AC39, one verifiable vertical slice at a time. This map is a navigation/handoff artifact, not another conceptual-plan status index. [Plan index](../../plan/index.md) remains authoritative.

The [decision effort](../admin-delivery-workflow/map.md) and [Compact Operations prototype](../admin-delivery-workflow/prototype/README.md) remain intact. The prototype is a visual reference, not production policy, query code, auth, evidence or test results.

## Explicit approval record

In this conversation, the owner separately selected through `ask_user_question`:

1. **Konfirmasi scope (Recommended)** — confirmed the decision contract, accepted Compact Operations direction, delivery-stage filtering, and browser/read-API/service verification boundaries before the revised specification was drafted.
2. **Setujui 7 ticket (Recommended)** — approved all seven vertical slices and their blocking edges.
3. **Direktori implementation baru (Recommended)** — approved Local Markdown publication in this directory, separate from resolved decision tickets.
4. **Setujui spec lengkap (Recommended)** — approved the complete revised specification, incorporated artifacts, testing boundaries and AC01–AC39 after presentation of the reviewable document and summary. Authorized Ready and publication; did not request implementation execution.

At publication all tasks were **open**, none claimed or implemented. The owner subsequently requested execution of tickets 01–07, with focused checks per ticket and full suites only at the end. Application changes are now implemented; the remaining standard-suite regression gate and current ticket status are documented in [verification.md](verification.md) and the individual issue files. The ready-for-agent label describes approved scope, not immediate execution or removal of dependencies. Follow the configured [Local Markdown workflow](../../docs/agents/issue-tracker.md): open → claimed → resolved. A task may be claimed only after the owner requests execution and its blockers are resolved; resolve only after changes, main-agent review and required verification.

## Approved ticket graph

| Ticket | Blocked by | End-to-end result |
|---|---|---|
| [01 — Evidence-aware detail and safe access](issues/01-evidence-aware-detail-and-safe-access.md) | None | Compact detail, shared stage/guidance, truthful current access/eligibility explanations and fail-closed viewing. |
| [02 — Work queues and stage filters](issues/02-work-queues-and-stage-filters.md) | 01 | Scoped real queues/counts/pagination, navigation, stage/date filters and list restoration. |
| [03 — Guided preparation and booking](issues/03-guided-preparation-and-booking.md) | 01 | Readiness and booking confirmations, safe feedback, no duplicate or blind retry. |
| [04 — Handoff, tracking, activity and money](issues/04-handoff-tracking-activity-and-money.md) | 01 | Handoff confirmation, evidence-based progress, separate refresh, truthful timeline and cost summary. |
| [05 — Settlement and packing blockers](issues/05-settlement-and-packing-blockers.md) | 01 | Visible supported blockers, packing-failure confirmation and coherent existing follow-up. |
| [06 — Held booking and proof-release](issues/06-held-booking-and-proof-release.md) | 01, 03 | Attempt-bound proof release without create followed by separately reviewed booking. |
| [07 — Issues, manual closure and terminal safety](issues/07-issues-manual-closure-and-terminal-safety.md) | 01, 04 | Supported issues, full exceptional closure consequences, distinct terminal results and privacy. |

Dependency graph: 01 → {02, 03, 04, 05}; {01, 03} → 06; {01, 04} → 07. Numbered ordering is suggested sequencing, not extra blocking edges. Shared files are not permission for parallel writers; delegation requires separate explicit authorization and bounded ownership.

## Common implementation and verification contract

- Load development-workflow and matching nextjs/frontend-design/tdd skills before work; auth or debugging skills when applicable. Use current library documentation before coding.
- Implement production behavior afresh in existing app components/services; do not copy the prototype's simplified state engine or promote its mock-only app.
- Use current server-derived Branch Scope for rows and counts, distinct from Home Branch action eligibility. No grants are inferred from lifecycle status, paid status, identifier presence or `actor.allowed` alone.
- All AC01–AC39 remain required. Ticket mappings identify principal coverage, not exceptions from the full contract. Every slice includes its relevant public-seam tests, UI E2E, structured API logging and enduring documentation.
- Main agent owns TDD execution, integration, review and verification. Confirmed seams: admin browser journey, Orders read API/shared public evidence projection, and existing booking/tracking/follow-up services with controlled PostgreSQL/provider stubs. Expected fixtures must be independent of implementation; no live-provider dependency.
- Existing mock E2E alone cannot prove backend authorization/concurrency/no-create effects. Preserve applicable existing database/service tests and store/Pickup regressions. Before commit/PR, run the required unit and UI E2E suites; no commit is authorized merely by testing.
- New product/behavior conflicts stop the affected slice for owner decision. No implicit schema or migration redesign. If a separately justified schema change is needed, use the shared schema owner, seeder synchronization and deployment rules.
- Each slice updates relevant feature/API docs and documentation index. Baseline does not change env, cron, ports, infrastructure, callback or deployment configuration.
- Publication itself authorized no execution. Subsequent owner-requested implementation was performed by the main agent, without delegation, commits, pushes, remote operations, deployment or live-provider writes. Controlled test providers run only on loopback mocks.

## Completion

After every task is resolved with verification, extract all enduring content into documentation and retire the conceptual plan per its checklist. Preserve history/approval evidence according to repository policy; do not delete this effort or the prototype as an automatic consequence of publishing tickets.
