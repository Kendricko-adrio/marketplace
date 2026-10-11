# UX Contract and Acceptance Criteria

Label: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04, 05
Parent: [Guided Admin Delivery Workflow](../map.md)

## Question

Do the resolved navigation, vocabulary, queue, detail, and exception decisions form a complete, coherent UX contract for the payment-to-arrival flow, and what observable acceptance criteria must the reviewable specification contain?

Check the combined contract with the owner:

- A branch staff member can discover each task and knows when no action is needed.
- List/detail stage, next step, and blockers agree.
- All physical/provider actions respect existing eligibility and evidence rules.
- Defaults do not hide older unfinished work or invent lateness.
- Read-only, refresh-failed, concurrent, and missing-evidence states remain understandable and safe.
- Normal delivered completion differs from manual closure; terminal outcomes remain terminal.
- The scope exclusions and outstanding uncertainties are explicit.

## Evidence and constraints

- Resolved named child answers are the source of product decisions; proposal recommendations are not substitutes for owner answers.
- [Starting proposal](../../../plan/admin-delivery-workflow-proposal.md).
- [Development workflow](../../../.agents/skills/development-workflow/SKILL.md) and [plan lifecycle](../../../plan/README.md).
- Existing mock E2E: [delivery order](../../../e2e/store/delivery-order-mock.spec.ts), [booking](../../../e2e/admin/shipment-booking-mock.spec.ts), [tracking](../../../e2e/store/shipment-tracking-mock.spec.ts), [follow-up](../../../e2e/admin/delivery-follow-up-mock.spec.ts).

Test-seam and repository facts are the agent's investigation responsibility. Product expectations are the owner's decisions. No tests or implementation are executed by this decision ticket.

## Resolution evidence

Obtain confirmation of shared understanding and record an acceptance scenario matrix covering the normal journey and exceptions. Link the complete reviewable specification under `plan/` when drafted from the confirmed decisions; keep conceptual status Draft until the owner explicitly approves the complete specification.

If contradictions reveal a new unsettled product decision, leave it open or create a precisely scoped child instead of substituting the agent's answer. Separate specification approval and implementation-ticket approval remain required; resolving this child alone is not approval of either.

## Work boundaries

Load `grilling`, `domain-modeling`, and `development-workflow`; read relevant resolved child answers. Claim only when all prerequisites are resolved. Planning-document work only. No app changes, build-ticket publication, delegation, commits, provider work, or deployment.

## Comments

Published after explicit owner approval of the complete map structure. Dependencies are added after all child files exist.

Claimed at the owner's request to review tickets 01–05 and resolve this ticket if no further investigation or product decisions are needed. All five prerequisites are resolved. Their complete answers and the approved ticket 04/05 artifacts have been reviewed alongside existing follow-up membership/guards and existing E2E test seams. The [combined contract review and acceptance matrix](../assets/06-ux-contract-and-acceptance-matrix.md) records the findings. No new product decision was identified. The owner confirmed the combined contract through `ask_user_question` by selecting “Konfirmasi contract (Recommended)”, authorizing the Draft specification and resolution of this ticket. The [complete reviewable specification](../../../plan/admin-delivery-workflow-spec.md) is now available; complete-spec approval remains separate. No implementation or test execution was performed.

## Answer

### Complete and coherent UX contract

The resolved navigation, language, queue, detail and exception decisions are consistent within the approved scope. No new owner-owned product choice or further fact-finding is required to resolve this decision ticket. Exact decisions remain sourced to tickets 01–05 and their approved artifacts, not the starting proposal's recommendations.

The [combined review and AC01–AC33 acceptance matrix](../assets/06-ux-contract-and-acceptance-matrix.md) records observable input/action/outcome scenarios for normal payment-to-arrival flow, blockers, filters/counts/pagination, authorization, missing evidence, stale/concurrent states, privacy and terminal outcomes.

Important reconciliations:

- Handoff without a courier scan remains Monitoring and also discoverable in existing pending-evidence shipment follow-up. Existing `list()` membership confirms this overlap; neither view declares failure or lateness or creates another case source.
- Text-only next-step guidance coexists with at most one separately presented existing normal primary action. Exceptional mutations stay in `Penanganan khusus`.
- Order stage is independent of viewer permission; specific verified read-only reasons explain unavailable controls without changing the stage.
- Verified arrival and manual closure remain distinct terminal outcomes despite missing intermediate evidence or late receipts.
- Ticket 04's explicit complete-artifact approval overrides its asset's historical pre-approval footer. Old proposal labels and unresolved-question text are superseded by resolved decisions, not fresh product uncertainty.

### Specification and approval boundaries

After the owner confirmed shared understanding, the [complete Draft specification](../../../plan/admin-delivery-workflow-spec.md) was written with normative decision/artifact links, all acceptance criteria, verification seams, scope exclusions, remaining engineering responsibilities and deployment/documentation expectations. `plan/index.md` remains Draft.

This resolves the decision ticket only. Explicit approval of the complete specification is still required before Ready or implementation. Separate implementation-ticket breakdown/publication approval also remains required. No implementation tickets were published.

### Verification and remaining uncertainty

Reviewed full tickets 01–05, approved normal/exception artifacts, existing follow-up documentation and service membership/mutation guards, and existing booking/follow-up/tracking/delivery-order E2E test seams. Planning Markdown and local link/status consistency were checked. Tests were not executed because this ticket changes no executable behavior.

No unresolved product expectation was identified. Safe list/detail projection, query/count integration, reliable activity projection and responsive spacing remain bounded engineering work for a future approved implementation. Newly discovered behavior-affecting gaps must return to the owner rather than being answered by the agent.

No app/config/schema edits, provider work, tests/build/lint/typecheck, delegation, commits, remote operations or deployment were performed for this ticket.
