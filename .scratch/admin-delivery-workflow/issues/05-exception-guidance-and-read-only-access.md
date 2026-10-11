# Exception Guidance and Read-Only Access

Label: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 02, 04
Parent: [Guided Admin Delivery Workflow](../map.md)

## Question

Using the approved stage language and detail layout, how should the admin understand each existing blocker, discover permitted special handling, and recognize read-only access without being encouraged to take unsafe or unavailable actions?

Decide:

- Symptom, business impact, safe next step, and useful evidence for settlement blocks, packing failure, booking ambiguity, and existing shipment issues.
- Placement of exceptional actions separately from the normal primary action.
- How proof-release requirements and release-versus-new-booking are explained.
- Manual completion consequences and distinct completed-result copy.
- How the existing follow-up area and detail issue panel stay coherent.
- Explanations for no edit permission, absent/mismatched Home Branch, and unavailable current eligibility.
- How missing tracking evidence differs from a supported shipment exception.

## Evidence and constraints

- [Proposal](../../../plan/admin-delivery-workflow-proposal.md), exception examples.
- [Follow-up rules](../../../docs/features/delivery-follow-up.md) and [service](../../../apps/admin/src/lib/delivery-follow-up.ts).
- [Tracking rules](../../../docs/features/delivery-tracking.md).
- [Home Branch and Branch Scope language](../../../CONTEXT.md).

Do not expand supported case criteria or add new operational actions. Stable `booking_unknown` proof-release is distinct from held `booking_dispatched`. Timeout/404/elapsed time cannot prove absence. Release never books automatically. Manual completion is neither refund nor verified delivery. All mutations remain server-authorized under current policy.

## Resolution evidence

Record an approved scenario table: case, staff-visible explanation, actions/no-action reason, confirmation/evidence required, expected unchanged commercial state, and out-of-app follow-up.

Walk through a damaged item before dispatch, unknown booking without proof, current-attempt proof-release followed by separate booking approval, active dispatch, return/issue manual closure, and a Jakarta Home Branch viewer opening a Bandung order. State how completed orders stay out of open follow-up after late evidence.

## Work boundaries

Load `grilling`, `domain-modeling`, and `development-workflow`; consult resolved dependencies. Claim only when prerequisites are resolved. Planning-document edits only. If discussion requires refunds, SLA, new case types, or authorization changes, stop and seek a scope decision rather than adding them silently.

## Comments

Published after explicit owner approval of the complete map structure. Dependencies are added after all child files exist.

Claimed for the owner interview after verifying prerequisites 02 and 04 are resolved. The owner selected a visible blocker summary plus separate special-handling area, specific read-only reasons without mutation buttons, consistent follow-up summaries, two mandatory proof-release acknowledgements, full manual-completion consequences, neutral pending-evidence labels, and case-specific out-of-app guidance. After [GET lookup research](../../../plan/research/jubelio-booking-unknown-get-lookup.md), the owner chose to retain existing booking-unknown rules; no lookup/recovery extension is approved.

The owner confirmed this shared scope through `ask_user_question` and requested the complete draft. The owner then explicitly approved the complete [scenario and copy artifact](../assets/05-exception-guidance-and-read-only-access.md) by selecting “Setujui draft lengkap”. Ticket 05 is resolved; no implementation is authorized.

## Answer

The owner approved the complete [exception and read-only contract](../assets/05-exception-guidance-and-read-only-access.md), including the scenario table, special-action confirmations, read-only explanations and acceptance walkthroughs.

- Keep blocker symptom, impact and safe next step visible at the top; evidence and exceptional mutations live in a separate `Penanganan khusus` area.
- Follow-up and detail share concise stage/guidance language and existing case criteria. Handoff without progress stays neutral pending evidence, not a failure or lateness verdict. ON_HOLD/CANCELED do not independently add case membership or manual-finish eligibility.
- Stable unknown booking remains held without explicit current-attempt Jubelio confirmation of absence and operation closure. Release requires reference/reason and two mandatory acknowledgements, never creates a shipment, and precedes a separate booking approval. Outstanding dispatch offers neither proof-release nor rebooking.
- Manual completion requires current eligibility and a nonblank reason, discloses all commercial/communication non-effects, and results in `Selesai manual`, not verified arrival. Completed outcomes remain out of open follow-up after late evidence.
- Read-only viewers see specific verified edit/Home Branch restrictions without mutation buttons. Unavailable eligibility offers detail reload rather than guessed permission reasons or write retries; unavailable view policy still fails closed.
- Out-of-app guidance identifies the relevant branch staff, Jubelio support or courier without inventing assignment, SLA, refund, replacement, authorization or communication workflows.

The artifact records trade-offs, unchanged commercial states, evidence requirements and all required concrete walkthroughs. No new glossary entity was introduced. GET discovery/adoption remains outside scope following the owner's decision after research.

Verification: read-only review of resolved prerequisites, follow-up service/list/manual-finish guards, tracking rules and the administration glossary; complete artifact approval through `ask_user_question`. Only planning/research Markdown changed. No application edits, tests, builds, lint, provider writes, delegation, commits or remote operations were performed. Combined-spec approval and implementation authorization remain separate.
