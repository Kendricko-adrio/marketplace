# 04: Physical handoff, tracking evidence, activity and money

Type: task
Status: resolved
Label: ready-for-agent
Blocked by: [01 — Evidence-aware detail and safe access](01-evidence-aware-detail-and-safe-access.md)
Parent: [Implementation effort](../map.md)
Specification: [Approved complete contract](../../../plan/admin-delivery-workflow-spec.md)

## What to build

An eligible branch operator explicitly records actual physical handoff, while authorized viewers can distinguish manual facts from courier observations, monitor progress and understand shipping costs without fabricated milestones. Waiting and arrival remain legible in Compact Operations detail, even when intermediate evidence is missing.

## Acceptance criteria

- [ ] Known booking alone shows Menunggu penjemputan, not recorded handoff. Handoff confirmation uses stored shipment/AWB context and explicitly requires goods already physically handed to the courier; no extra persisted checkbox. It is not proof of customer receipt.
- [ ] Successful handoff emits Serah terima dicatat.; fresh evidence drives Diserahkan ke kurir and neutral waiting guidance. No ordinary preparation/booking action is exposed during monitoring.
- [ ] Verified PICKED_UP/ON_DELIVERY advances the approved courier stage even without a manual handoff stamp. Missing manual evidence remains inspectable, not mandatory backfill.
- [ ] Verified DELIVERED completes with Barang diterima despite absent intermediate scans, handoff timestamp or POD. Missing values remain unavailable, not fabricated; no manual completion requirement is introduced.
- [ ] Muat ulang detail reads application state only. Perbarui tracking uses only the existing authorized known-AWB reconciliation; no provider create or automatic polling. Read-only viewers cannot invoke guarded refresh.
- [ ] Provider refresh/action failures and stale/concurrent detail use safe outcome-aware feedback without inviting a write retry or inventing event evidence.
- [ ] Unified activity timeline contains only actual applicable admin/system/courier facts, with sources and actor/time where safely available. Event time and receipt time are distinctly labelled; absent event time is not replaced by receipt time. Ignored receipts belong in separate diagnostics, not normal activity.
- [ ] Safe tracking/POD links are shown only if actually available. Progress does not manufacture scans, milestones, timestamps or physical sequence.
- [ ] Financial summary separately displays checkout shipping, booking cost and courier bill; absent bill is unavailable, never zero. Expandable differences explain that they neither increase customer payment nor block fulfillment. Diagnostics remain separate.
- [ ] Late safe evidence enrichment preserves completed/manual terminal semantics and customer DTO exclusions for internal costs/reasons/actor IDs/diagnostics.
- [ ] Keyboard dialogs/focus, labelled refresh controls and stacked mobile layout satisfy the Compact Operations contract without whole-page overflow.
- [ ] Extend tracking/handoff/browser and public reconciliation/service verification with controlled courier evidence/provider stubs, including source/time gaps, missing POD and authorization. Preserve customer-facing tracking/order regression tests; update enduring docs and structured API logs.

## Verification focus

AC11–AC16, AC25–AC26 refresh/evidence boundaries, AC30, AC32–AC33, AC38–AC39. Existing tracking public seams and controlled browser coverage remain the source of backend effect verification; independently define financial expectations (checkout 20,000, booking 25,000, absent bill) and courier evidence fixtures rather than mirroring implementation calculations.

## Boundaries and handoff

No guaranteed pickup schedule, polling/cron, tracking endpoint redesign, evidence backfill requirement, bill-as-zero fallback or customer surcharge. Manual-finish UI is ticket 07; terminal/privacy behavior cannot regress while preparing its evidence foundation. Follow the parent common contract; execution was subsequently requested by the owner.

## Answer

Implemented actual-transfer confirmation, separate application reload and guarded provider refresh, missing evidence labels, source/time-labelled applied activity and separate ignored-receipt diagnostics. Checkout shipping, booking and bill remain separate; absent prices are not zero, differences are expandable and non-commercial. Tracking/POD links require available HTTP(S) evidence. Read tracking preflight reuses existing trackability guards without contacting a provider, and distinguishes terminal informational refresh from handoff.

Focused verification: PostgreSQL/signature/tracking suite **8 passed**, controlled handoff/activity/cost Playwright scenario **1 passed**, admin typecheck and changed-file ESLint passed. Existing handoff, authorization and terminal-status guards remain intact. Ticket 07 additionally supplies identity-matched safe late metadata enrichment and manual-closure presentation; customer DTO contracts remain unchanged. See [final shared verification](../verification.md), including the unknown-eligibility tracking-control red → green correction.
