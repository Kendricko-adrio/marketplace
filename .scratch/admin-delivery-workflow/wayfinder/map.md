# Guided Admin Delivery Workflow

Label: wayfinder:map

## Destination

Resolve the product and UX decisions needed to turn the [delivery workflow proposal](../plan/admin-delivery-workflow-proposal.md) into a complete specification ready for separate owner approval. The specification must explain normal delivery and supported exceptions from customer payment through arrival, with clear list/detail guidance for branch staff.

This is decision planning, not implementation. Reaching the destination does not mark the conceptual plan Ready or authorize app changes.

## Notes

### Owner-confirmed framing and publication approval

The owner selected and approved the following framing in this conversation:

- Destination: a complete specification ready for approval, not immediate implementation.
- Storage: the existing Local Markdown tracker under `.scratch/admin-delivery-workflow/`.
- Scope: clarify the existing delivery flow; do not add new operational rules.
- Primary user: branch staff performing packing, booking, and physical handoff. Existing scope-authorized cross-branch visibility remains supported.
- The six decision-ticket questions and dependencies were presented together and explicitly approved before publication.
- All children start open. Charting does not resolve them. No delegation, live-provider work, commits, or implementation was authorized.

These are map framing decisions from charting, not answers to its child tickets. The proposal's recommendations remain proposals unless subsequently confirmed in a ticket.

### Sources and session discipline

- Tracker mechanics: [Local Markdown tracker](../../../docs/agents/issue-tracker.md). This map is not a second conceptual-plan status index; [.scratch/admin-delivery-workflow/index.md](../index.md) remains authoritative for plan status.
- Starting artifact: [proposal](../plan/admin-delivery-workflow-proposal.md). Its sample copy, defaults, and layouts are discussion material, not settled product choices.
- Existing constraints: [delivery orders](../../../docs/features/delivery-orders.md), [fulfillment](../../../docs/features/delivery-fulfillment.md), [tracking](../../../docs/features/delivery-tracking.md), and [follow-up](../../../docs/features/delivery-follow-up.md).
- Terminology: [administration glossary](../../../CONTEXT.md). In particular, Branch Scope visibility is different from Home Branch action eligibility. Record genuinely resolved new domain terms in the glossary, not implementation details.
- Every session loads [development-workflow](../../../.agents/skills/development-workflow/SKILL.md) and the real `grilling` and `domain-modeling` skills. Use `ask_user_question` for decision rounds; never answer for the owner or ask them for facts that can be checked in the repository.
- For the wireframe child, also load `prototype` and `frontend-design`. Its prototype is bounded to Markdown wireframes; no app code, executable prototype, branch creation, or automatic commit.
- Discover open children from `.scratch/admin-delivery-workflow/wayfinder/`; choose the first open, unblocked, unclaimed child unless the owner names another. Claim it before working. Dependencies are wired in the children; resolved prerequisites determine the frontier.
- Work through no more than one decision ticket per session, as required by wayfinder. Record the answer in the child and only a named-link gist here. Charting itself resolves none.
- Existing provider and authorization rules are constraints: verified payment and settlement before fulfillment; no blind booking retry; known AWB is not handoff/delivery; verified delivery differs from manual closure; mutations remain server-authorized.
- Findings requiring a new operational policy must be escalated as a scope change rather than silently added. No assignment, SLA, or automation decisions belong to this map.
- New fact-finding can be performed directly from local code/docs. No research subagent is launched automatically; separate explicit delegation permission is required.
- After decisions are resolved, prepare the reviewable full specification as a planning document. Obtain separate approval of its complete scope/acceptance criteria before Ready. Build-ticket publication requires its own approval; commits, remote access, and deployment retain their separate gates.

## Decisions so far

- [Delivery Work Navigation](01-delivery-work-navigation.md): owner approved keeping delivery inside Orders, with Delivery / Pickup / Semua tabs and a single work-filter dropdown; login stays on Dashboard, Orders defaults to Delivery work, and existing follow-up and branch authorization boundaries remain intact.

- [Delivery Stage Language and Next-Step Guidance](02-delivery-stage-language-and-guidance.md): owner-approved concise Indonesian scenario copy, current-evidence guidance on detail, result-only success toasts, text-only next steps, and distinct blocker/waiting/verified-arrival/manual-completion messages. Decision resolved; no implementation authorized.

- [Work Queue Priorities and Filters](03-work-queue-priorities-and-filters.md): owner approved no default date restriction across queues/history, oldest-created-first ordering, optional visible date filtering, 20-row pagination and scope-aware filtered/base totals. Normal work, existing follow-up, monitoring with issue warnings, completed history and all-delivery search have approved membership; rows show operational summaries and contextual navigation without mutations. Decision resolved; no implementation authorized.

- [Guided Detail Wireframes and Action Confirmations](04-guided-detail-wireframes-and-confirmations.md): owner approved the complete six-state normal wireframe, prominent next-step panel, readiness/booking/handoff confirmations, source-labelled timeline, separate refresh controls and financial hierarchy. Decision resolved; no implementation authorized.

- [Exception Guidance and Read-Only Access](05-exception-guidance-and-read-only-access.md): owner approved the complete scenario/copy artifact, visible blocker summary with separate special handling, specific read-only reasons without mutation buttons, two proof-release acknowledgements and separate new-booking approval, full manual-completion consequences, neutral pending evidence and unchanged existing case/authorization/terminal rules. GET discovery remains outside scope after research. Decision resolved; no implementation authorized.

- [UX Contract and Acceptance Criteria](06-ux-contract-and-acceptance-criteria.md): owner confirmed the combined contract and AC01–AC33 matrix; no new product decision remained. Complete [reviewable specification](../plan/admin-delivery-workflow-spec.md) drafted at ticket resolution, initially Draft pending separate approvals. Subsequent owner approvals and publication are recorded below; this does not retroactively turn decision-ticket resolution into implementation approval.

## Subsequent design, specification and publication approvals

- The owner authorized an isolated Next.js [Compact Operations prototype](../prototype/README.md), explicitly excluding edits to existing implementation. Owner feedback accepted the visual direction and requested a delivery-stage filter. Prototype browser observations are not production acceptance results.
- After requesting to-spec and to-tickets, the owner confirmed the combined scope and browser/read-API/service test boundaries, separately approved seven vertical tickets/dependencies, and approved Local Markdown publication in `.scratch/admin-delivery-workflow/ticket/`.
- The complete revised [specification](../plan/admin-delivery-workflow-spec.md), with user stories, incorporated artifacts and AC01–AC39, was presented and explicitly approved through `ask_user_question` by selecting **Setujui spec lengkap (Recommended)**. The [plan index](../index.md) is now Ready.
- The separately approved [implementation effort](../ticket/map.md) has been published with seven open/unclaimed tasks. Existing decision tickets and prototype remain intact. Specification/publication work does not authorize starting implementation, delegation, provider requests, commits or deployment.

## Remaining gates and engineering detail

- All six decision tickets are resolved; complete-spec and ticket publication approvals are recorded separately above. No unresolved owner-owned product decision remains in the approved contract.
- Exact visual spacing/density/responsive execution and safe list/detail evidence/policy/activity/query projection remain engineering responsibilities within the confirmed contract, not implicit permission to change product behavior.
- Any newly discovered behavior-affecting conflict must return to the owner. Implementation execution still requires a subsequent user request; separate delegation/commit/provider/remote/deployment gates remain unchanged.

## Out of scope

- Application implementation, build tickets, automated execution, live-provider writes/activation, commits, remote publication, and deployment.
- New operational policies: staff assignment/claim ownership, mandatory persisted checklists, SLA thresholds, or automatic escalation.
- Automatic booking/release, blind retry, force-paid/force-verified actions, or changes to Home Branch authorization.
- Refund, cancellation, replacement shipment, return-stock handling, post-completion reopening, or customer communication integrations.
- Storefront redesign, new delivery notifications, courier collection scheduling guarantees, and new tracking polling/cron.
- Changes to immutable checkout destination/service or commercial ledgers during fulfillment.
