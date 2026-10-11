# Guided Detail Wireframes and Action Confirmations

Label: wayfinder:prototype
Type: prototype
Status: resolved
Blocked by: 02
Parent: [Guided Admin Delivery Workflow](../map.md)

## Question

Which information hierarchy and low-fidelity detail layout make the existing normal delivery steps clear, and what context/consequence copy should precede packing, booking, and physical handoff?

Use owner-reviewed Markdown wireframes to decide:

- Next-step panel prominence and one primary physical action per stage.
- Placement of progress, goods, frozen destination/service, resi/tracking, financial detail, and technical diagnostics.
- Advisory packing guidance without creating a mandatory persisted checklist.
- Booking/handoff confirmation content and post-action feedback.
- Presentation of manual facts versus courier observations, including missing timestamps.
- Read refresh versus tracking refresh, stale detail, duplicate submission, and conflict guidance.
- A readable normal activity timeline without invented evidence.

## Evidence and constraints

- [Proposal](../../../plan/admin-delivery-workflow-proposal.md), detailed walkthrough and information hierarchy.
- [Current detail page](../../../apps/admin/src/app/admin/orders/[id]/page.tsx).
- [Detail API](../../../apps/admin/src/app/api/admin/orders/[id]/route.ts).
- [Fulfillment](../../../docs/features/delivery-fulfillment.md) and [tracking](../../../docs/features/delivery-tracking.md).

Use the prerequisite's approved terminology. Existing `actor.allowed` is a Home Branch hint, not full mutation authorization. No physical handoff is inferred from an AWB. A stale/refetch-failed view must not invite a repeated booking write.

## Resolution evidence

Create a bounded asset under `../assets/` only when this child is worked, and link it from the child. Compare concrete layouts through the question tool's previews where helpful; do not select the winner for the owner.

Include wireframe states for eligible packing, booking review, confirmed booking awaiting handoff, handoff awaiting scan, normal transit, and confirmed delivery. Record the chosen layout/confirmations and its trade-offs in the child answer; final exception presentation belongs to the dependent child.

## Work boundaries

Load `prototype`, `frontend-design`, `grilling`, `domain-modeling`, and `development-workflow`. This is a **Markdown-only, non-executable prototype** for a decision. No app code/config/schema changes, new branch, commit, provider request, or implicit subagent is authorized. Claim only when prerequisites are resolved; the owner must react to and select the artifact before resolution.

## Comments

Published after explicit owner approval of the complete map structure. Dependencies are added after all child files exist.

Claimed for the owner wireframe interview in the current session after verifying ticket 02 is resolved. The owner selected the top next-step panel, short advisory packing guidance, short readiness confirmation, full booking review, explicit physical-handoff confirmation, unified source-labelled timeline, separate refresh controls, local stale/conflict feedback, and visible financial summary with expandable detail through `ask_user_question`.

A [complete Markdown wireframe draft](../assets/04-guided-detail-wireframes.md) is available for owner review. It covers the six required normal states and confirmation/feedback choices with trade-offs. The owner explicitly accepted the complete artifact through `ask_user_question` by selecting “Setujui wireframe”. No application code, provider request, validation run, delegation, commit or remote action was performed.

## Answer

The owner approved the [complete six-state Markdown wireframe](../assets/04-guided-detail-wireframes.md). It is the resolution artifact for this ticket and records the chosen confirmations, evidence presentation, refresh behavior, financial hierarchy and trade-offs.

- Keep the next-step panel at the top and guidance visible during waiting and completion; expose at most one existing primary fulfillment action when eligible and authorized.
- Use short advisory packing guidance without a persisted checklist.
- Confirm readiness briefly; review frozen goods, destination, service, checkout charge and consequences before booking; explicitly confirm completed physical handoff without an additional checkbox.
- Keep success toasts result-only and next-step instructions persistent, following ticket 02.
- Use one timeline with explicit admin/system/courier sources and separate event/receipt times. Never fabricate missing handoff, scans, timestamps or POD.
- Separate detail reload from known-AWB provider tracking refresh. Show processing/stale/conflict feedback locally; do not invite duplicate booking or equate failed refetch with failed write.
- Show the three distinct financial values in a summary with expandable differences; keep technical diagnostics separate and expandable.

Trade-offs and each of the six normal-state layouts are documented in the approved artifact. Final exception and read-only-access presentation remains ticket 05 scope. This approval resolves ticket 04 only; it does not authorize application changes or approve the combined implementation specification.

Verification consisted of read-only review of prerequisite ticket 02 and delivery fulfillment/tracking documentation, followed by the owner's explicit artifact approval. Tests were not run because changes are non-executable Markdown only.
