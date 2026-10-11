# 05: Settlement and packing-failure guidance

Type: task
Status: resolved
Label: ready-for-agent
Blocked by: [01 — Evidence-aware detail and safe access](01-evidence-aware-detail-and-safe-access.md)
Parent: [Implementation effort](../map.md)
Specification: [Approved complete contract](../../../plan/admin-delivery-workflow-spec.md)

## What to build

Branch staff can understand why a paid delivery cannot proceed, report one of the existing pre-dispatch packing failures when eligible, and discover the corresponding existing follow-up/detail context without assuming the app has resolved the commercial problem.

## Acceptance criteria

- [ ] Paid-but-blocked settlement shows Verifikasi tertunda and the approved next step/impact at the top. Packing/booking and force-verified bypass are unavailable; safe references do not imply verified settlement merely because IDs exist.
- [ ] Settlement recovery remains existing system-only behavior; detail reload is a read, not a new recovery/create action. Explain external Jubelio coordination without asking the customer to pay again solely due to the blocker.
- [ ] Eligible pre-dispatch reporting exposes only physical_stock_unavailable, damaged_goods and paid_service_limits_exceeded with their approved staff-readable labels. Damage discovered after readiness may be reported only under existing guards.
- [ ] Confirmation discloses fulfillment blocking, unchanged processing/paid, and no refund, SO cancellation, stock rollback or automatic communication. No new reason/case type or required stored checklist is introduced.
- [ ] Result-only toast is Kendala barang dicatat.; persistent stage/guidance reflect the recorded reason, never a claim of commercial resolution.
- [ ] After recorded packing failure, normal packing/booking/handoff and ineligible special actions remain unavailable under existing guards. No resume, replacement, service substitution, re-quote or automatic extra charge shortcut appears.
- [ ] Visible symptom/impact/safe-next-step is outside collapsed diagnostics. Special handling shows only recorded evidence and the approved external branch/customer coordination guidance.
- [ ] Existing follow-up case source and kind filtering remain unchanged. Summary wording matches detail; Lihat detail navigates contextually without mutation or a second case ledger. Delivery-stage filtering, when introduced by ticket 02, preserves the same projected meaning.
- [ ] Read-only and unknown-eligibility viewers receive the specific safe explanations with no reporting/mutation controls; stale/conflict feedback uses read reload rather than repeat writes.
- [ ] Controlled browser/service tests cover all three reasons, pre-dispatch and post-readiness reporting, settlement/authorization denials and unchanged commercial effects. Update feature/API documentation and structured contextual logs; preserve existing paid-order/store behavior.

## Verification focus

AC07, AC17, AC24, AC26–AC29 as applicable, AC32–AC33, AC38–AC39. Reuse existing follow-up list/failPacking and settlement public-service/database tests plus mock browser seams. Assert unchanged order/payment and absence of commercial/provider effects at the public boundary; do not infer them from disabled UI alone.

## Boundaries and handoff

No refund, cancellation, return-stock adjustment, replacement, supported resume, new communication integration, SLA or admin settlement bypass. This ticket can be verified through existing follow-up/detail even before the new work-list ticket; no artificial dependency on ticket 02 is required. Follow the parent common contract; execution was subsequently requested by the owner.

## Answer

Implemented prominent settlement/failure symptom, impact and external coordination guidance; the three existing failure codes use approved labels. The separated reporting dialog explains processing/paid and fulfillment blocking, with no refund, SO cancellation, stock reversal or automatic communication. Result-only toast and fresh detail drive persistent failure guidance; no resume/force-verification action is introduced. Special-action preflight reuses existing guards without writes/providers. Follow-up retains the original case source and shared stage vocabulary.

Focused reporting browser verification passed; focused public-service/DB checks passed and the full unit suite covers all existing reasons and commercial non-effects. The real isolated follow-up journey verifies post-readiness reporting, paid order/audit effects and read-only behavior. Final isolated full E2E: 49 passed. Main-agent review, admin typecheck and changed-file ESLint passed; enduring feature/API docs updated. [Final results and the separate ticket-02 standard-suite gate](../verification.md).
