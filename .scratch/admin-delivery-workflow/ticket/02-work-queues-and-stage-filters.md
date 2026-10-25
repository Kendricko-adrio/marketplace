# 02: Delivery work queues, navigation and stage filters

Type: task
Status: claimed
Label: ready-for-agent
Blocked by: [01 — Evidence-aware detail and safe access](01-evidence-aware-detail-and-safe-access.md)
Parent: [Implementation effort](map.md)
Specification: [Approved complete contract](../plan/admin-delivery-workflow-spec.md)

## What to build

A branch Admin User opening Orders finds the right delivery work without older unfinished orders being hidden, can narrow it to a specific stage such as Siapkan barang, and can return from contextual detail/follow-up without losing their place. The real scoped read query, counts, pagination and Compact Operations table must agree; filtering a loaded client page is not sufficient.

## Acceptance criteria

- [ ] Login still lands on Dashboard. Orders defaults to Delivery / Perlu dikerjakan with Delivery/Pickup/Semua tabs and one work-queue dropdown. Pickup verification and general search/history retain their context and existing behavior.
- [ ] Queue membership follows the approved evidence table, not this viewer's mutation authority. Eligible unpacked/packed/booked-awaiting-handoff are actionable; pending payment/verification are all-delivery-only; completed results belong to Selesai and all-delivery, not active/open follow-up.
- [ ] Existing follow-up remains the sole case source/area. Handoff without courier progress is visible in Monitoring and the existing pending-evidence follow-up without failure/lateness copy. ON_HOLD/CANCELED warn in Monitoring without new case criteria.
- [ ] Tahap delivery defaults to Semua tahap and exposes all unique approved business stage labels, including stages absent from prototype fixtures. Released/ordinary ready goods both match Barang siap.
- [ ] Queue, selected stage, server-derived Branch Scope, branch/search and date restrictions intersect before pagination. Monitoring + Siapkan barang shows an explicit empty state without widening queue or silently clearing the stage. Delivery-specific filtering does not replace general status or Pickup filters; existing follow-up kind filtering is retained.
- [ ] All queues/history default to no creation-date restriction, globally ascending creation time with stable ties, and up to 20 rows per page. Order age does not imply stage age, lateness or SLA.
- [ ] Applied dates show selected range and narrowing warning. Both matching and no-date base counts retain identical authorized scope/queue/stage/search/branch filters; only dates are removed from base count. Counts are not loaded-row lengths. For 12 matching out of 40 same-stage base results, show 12 of 40.
- [ ] Queue/filter changes reset to page one. Return from detail/follow-up restores queue, stage, other filters and page where valid, without stranding a viewer on an invalid empty later page.
- [ ] Compact rows show reference/date, customer, origin branch, payment, stage, next step/blocker and contextual navigation. Rows navigate only, never write; stage/guidance match detail. Missing reliable stage timestamps are not inferred from generic update time.
- [ ] Filters are labelled/keyboard-operable. Mobile table scrolling stays inside its container, with no page overflow; guidance remains readable and status is not colour-only.
- [ ] Read API/public service tests cover authorized membership and counts with results beyond page one and tied creation times. Admin Playwright covers visible navigation/filter intersections/restoration/empty states; preserve Pickup, general search, scope and store regressions. Add enduring feature/API documentation and structured logs for changed API behavior.

## Verification focus

AC01–AC07, AC11–AC14 queue membership, AC21–AC22 queue membership, AC25, AC32, AC34–AC39. The confirmed seams are the public Orders read API/query service and browser journey. Independently specified fixtures must include older unfinished work, all blocked/payment/completed outcomes, overlapping pending evidence, unauthorized branches and more than 20 rows; never derive expectations from the current loaded page or the production classifier itself.

## Boundaries and handoff

No new Delivery workspace, pending-payment dropdown, case ledger, assignment, SLA, automatic mutation or Home Branch override. Do not copy prototype filtering/pagination: its 15 fixtures and one page do not represent the production query. Follow the parent common contract; execution was subsequently requested by the owner.

## Implementation and verification gate

Application changes are implemented: Delivery/Pickup/Semua, evidence-based work queues, full stage filter, scoped server intersections/counts before 20-row stable pagination, no date default, narrowing warnings, contextual return URLs, safe empty/page-clamp behavior and contained mobile scrolling. Existing follow-up remains the case source. Feature/API documentation is complete in `docs/features/admin-delivery-workflow.md` and `docs/api-reference.md`.

Focused PostgreSQL verification passed the independently specified 40-order scenario (stable page boundaries, authorized scope, queue/stage/search/branch intersections and 12 dated out of 40 no-date results). Focused browser navigation/restoration/mobile verification passed. The existing general-history browser regression was updated for `tab=all`, current branch-name column and independent first-page DB expectations; it passes focused and in the reviewed full standard run. The obsolete whole-branch timestamp mutation was removed. Real controlled Pickup/store delivery/tracking regressions pass in the 49-test isolated mock suite.

**Remain claimed:** the required wider standard regression gate is not green: final standard E2E is 93 passed / 26 failed / 25 not run. Legacy catalog/branch/stock-review fixture assumptions are demonstrably invalid in this database, but not every failure has been fully classified against a prior baseline. Do not waive store regression coverage or reset the owner's DB. See [final verification and next gate](verification.md).
