# 03: Guided preparation and booking confirmations

Type: task
Status: resolved
Label: ready-for-agent
Blocked by: [01 — Evidence-aware detail and safe access](01-evidence-aware-detail-and-safe-access.md)
Parent: [Implementation effort](map.md)
Specification: [Approved complete contract](../plan/admin-delivery-workflow-spec.md)

## What to build

An authorized, fully eligible staff member can prepare goods, record readiness and consciously approve a shipment booking from Compact Operations detail. The interface acknowledges actual results and keeps the latest next step visible while preventing ambiguous/stale outcomes from inviting another provider write.

## Acceptance criteria

- [ ] Siapkan barang includes short advisory checks for goods, quantity, condition and packaging, without a persisted checklist. Readiness has the exact approved short confirmation: marking ready does not book shipment.
- [ ] Full existing authorization/settlement/fulfillment guards control readiness and booking. Paid status, processing, ID presence or a Home Branch hint alone never make the action eligible.
- [ ] Before booking, review immutable goods/quantity, recipient/destination, checkout service and stored shipping charge. No editing destination/service or substitution/re-quote is offered.
- [ ] Confirmation explains the provider booking request, that booking is not handoff, and that an uncertain result must not be retried. Use the exact approved confirmation fields/copy from the normative artifact.
- [ ] Guidance remains text-only, with at most one separately exposed normal primary action. Success toasts contain only Barang ditandai siap. or Pengiriman berhasil dipesan.; persistent guidance derives from fresh evidence, not the last click.
- [ ] During submission disable duplicate interaction and show processing feedback. Server atomic claims/at-most-once semantics remain authoritative across concurrent callers.
- [ ] Known complete booking displays Menunggu penjemputan and real AWB without implying physical handoff or customer arrival. Ambiguous results receive no success toast; outstanding dispatch and stable unknown retain their distinct approved stage/next-step meanings with no blind retry.
- [ ] Failed detail reload never implies the previous write failed or re-enables booking from stale data. Show the approved stale text and offer read reload; current unknown eligibility has no mutations.
- [ ] Server conflict shows the approved changed-condition guidance. No automatic write retry; fresh state determines availability. Fresh permission denial is explained only from trustworthy current facts.
- [ ] Confirmation supports keyboard/focus return and small screens; Compact Operations hierarchy remains intact.
- [ ] Extend controlled booking browser coverage and public booking service/database checks for authorization, ambiguity, concurrent at-most-once effects and duplicate prevention. Document updated UI/API behavior, maintain structured contextual logs, and preserve existing store/immutable-order regressions.

## Verification focus

AC08–AC11, AC24 as applicable, AC28–AC29, AC32, AC38–AC39. Use existing admin booking mock E2E and production booking/readiness public service seams with provider stubs. UI mocks verify presentation, not proof of at-most-once effects. Write failing tests per behavior slice before implementation; main agent executes checks.

## Boundaries and handoff

No automatic booking, ordinary retry, force-paid/verified action, destination/service editing, persisted checklist or provider activation. Proof-release is ticket 06 and must use this ticket's separate review path rather than a new rebooking shortcut. Follow the parent common contract; execution was subsequently requested by the owner.

## Answer

Added advisory preparation, separate readiness/booking dialogs with immutable goods/recipient/address/service/checkout charge, result-only toasts, a synchronous submission latch and stale-eligibility hiding. A failed post-write detail read never re-enables booking. Conflict/unknown outcomes offer read reload, not retry. Known booking success requires the booked response.

Focused browser verification passed: frozen booking review + failed reload/no repeat, and readiness confirmation/no booking + fresh persistent guidance (two separately targeted scenarios in `e2e/admin/delivery-actions.spec.ts`). Existing authorization/parallel-claim/ambiguity service coverage passed with the foundation; no booking service behavior was changed for this ticket. Changed-file ESLint and admin typecheck passed. See tickets 04–07 for integrated handoff and exceptional confirmations, and [final shared verification](verification.md) for full-suite results and the remaining standard-suite gate.
