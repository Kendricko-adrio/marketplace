# 07: Shipment issues, manual closure and terminal safety

Type: task
Status: resolved
Label: ready-for-agent
Blocked by: [01 — Evidence-aware detail and safe access](01-evidence-aware-detail-and-safe-access.md), [04 — Handoff, tracking, activity and money](04-handoff-tracking-activity-and-money.md)
Parent: [Implementation effort](../map.md)
Specification: [Approved complete contract](../../../plan/admin-delivery-workflow-spec.md)

## What to build

Authorized viewers understand courier issues and neutral pending evidence; an eligible resolver can choose exceptional manual closure with its full consequences disclosed. Verified arrival and manual completion stay visibly different, and late courier evidence never turns a completed order back into active/open follow-up work.

## Acceptance criteria

- [ ] Applicable pre-completion RETURNED/SHIPMENT_ISSUE use the exact approved label/guidance and existing follow-up membership, with actual supporting evidence rather than inferred physical return receipt.
- [ ] ON_HOLD/CANCELED show visible approved warnings but do not alone add case membership or grant manual finish. Shipment cancellation is explicitly not order/SO cancellation.
- [ ] Recorded handoff with absent/WAITING progress remains neutral pending evidence, discoverable in existing Monitoring/follow-up contexts without lateness/failure/SLA claims. Manual finish is not promoted as the next step or remedy for missing scans.
- [ ] Existing complete booked-ledger/settlement/authorization/evidence guards determine exceptional action availability. AWB alone, blocked settlement, packing failure, unknown booking or unsupported status alone cannot grant manual finish. Fresh server guards remain authoritative even if the browser is stale.
- [ ] Selesaikan manual lives in Penanganan khusus, not alongside a routine primary task. Confirmation includes actual order/AWB/supporting evidence and a mandatory nonblank reason.
- [ ] Full approved consequence copy states completed/paid with Selesai manual, not confirmation of customer receipt, DELIVERED or POD; no refund, stock adjustment, SO cancellation or automatic communication. Business/customer coordination remains external.
- [ ] Successful result-only toast is Order ditutup manual.; persistent Selesai manual remains distinct from verified Barang diterima. Actual manual reason/actor/time are admin-only and missing evidence stays unavailable.
- [ ] Both terminal outcomes stay out of active work and open follow-up, even after late issue/progress receipts. Only existing safe enrichment is applied; ignored receipts remain diagnostic, not new active warnings or reopened tasks.
- [ ] Customer-facing payloads continue excluding manual reasons, actors, provider diagnostics and booking/billing costs after manual closure and later enrichment.
- [ ] Read-only viewers and unresolved/stale eligibility have no exceptional mutation controls. Conflict/read-failure messages offer read reload without automatic closure/write retry. Dialogs preserve keyboard focus and mobile readability.
- [ ] Public service/PostgreSQL/provider-stub checks prove required reason/guards, completed/paid effects, terminal safety and privacy, not just UI visibility. Extend follow-up/tracking browser and store DTO regression coverage; verify queue/history integration after ticket 02 is available without adding an artificial blocker. Update enduring docs and structured logs.

## Verification focus

AC12–AC14 as applicable, AC21–AC29 as applicable, AC32–AC33, AC38–AC39. Reuse existing finishManually/list/tracking public-service seams and controlled browser scenarios. Independently specified fixtures include RETURNED/SHIPMENT_ISSUE, physical handoff, verified transit, AWB-only, unknown booking, blocked settlement, packing failure and both completed outcomes with late evidence.

## Boundaries and handoff

No refund, cancellation, replacement, return-stock action, automatic communication, new issue criteria or post-completion reopening/dispute workflow. Ticket 04 supplies actual evidence/activity/completion presentation; no missing evidence is fabricated to enable closure. Follow the parent common contract; execution was subsequently requested by the owner.

## Answer

Implemented approved issue/pending-evidence guidance and guarded manual closure under Penanganan khusus. The dialog requires a nonblank reason and discloses no verified arrival/POD, refund, stock adjustment, SO cancellation or automatic communication. Completed/paid Selesai manual remains distinct from Barang diterima. Existing complete manual-finish predicates are shared with read preflight; AWB/ON_HOLD/CANCELED alone do not grant closure. Identity-matched safe late tracking/POD enrichment retains terminal lifecycle/stage and never reopens active work/cases; ignored receipts remain diagnostic and customer DTO privacy remains intact.

Focused manual-closure browser and public-service/DB guard/terminal checks passed. Full unit suite passes; real isolated follow-up/manual finish and store tracking/privacy journeys pass in the 49-test mock suite. Main-agent review, admin typecheck and changed-file ESLint passed. Enduring feature/API documentation covers consequences, terminal enrichment and privacy. [Final shared verification](../verification.md); ticket 02 retains the wider standard regression gate.
