# Plan: Guided Admin Delivery Workflow — Reviewable Specification

> Plan-level status is tracked only in [index.md](../index.md). Every feature below is Ready: the owner explicitly approved this complete revised specification, its artifacts/testing boundaries and AC01–AC39. This document supersedes the [starting proposal](admin-delivery-workflow-proposal.md). This request authorizes specification/ticket publication, not starting implementation.

## 1. Goal and audience

Make the existing payment-to-arrival delivery flow understandable to branch staff performing preparation, booking and physical handoff. Every delivery should communicate its current evidence-based stage, safe next step and any blocker. Scope-authorized all-branch viewers use the same experience without gaining cross-Home mutation authority.

This is a presentation/discoverability improvement to existing behavior, not a new fulfillment, commercial or authorization policy.

### Problem Statement

Branch staff need to find unfinished delivery work, distinguish payment and settlement from physical progress, and understand the next safe action without interpreting generic lifecycle statuses or provider diagnostics. Date defaults can hide older unfinished work; shipment identity alone can be mistaken for handoff or arrival. Scope-authorized viewers also need to understand why seeing an order does not authorize acting on it.

### Solution

Use a Compact Operations presentation inside existing Orders: an information-dense, readable work list and an evidence-aware detail with prominent persistent next-step guidance. Separate queue, delivery stage and payment; add an explicit stage filter; review consequences before existing actions. Keep exceptional handling discoverable but separate, and preserve existing server policies, commercial behavior and provider safety.

### User Stories

1. As a branch Admin User, I want login to retain Dashboard, so that existing entry behavior remains familiar.
2. As a branch Admin User, I want Orders to open Delivery / Perlu dikerjakan, so that ordinary delivery work is immediately discoverable.
3. As a Pickup operator, I want Pickup and its verification context retained, so that delivery improvements do not disrupt collection work.
4. As an order viewer, I want general search/history retained in Semua, so that I can investigate orders beyond active delivery work.
5. As a branch Admin User, I want queue membership based on current order evidence, so that blocked or completed orders are not mistaken for routine tasks.
6. As a branch Admin User, I want older unfinished orders visible without a default date restriction, so that yesterday's work does not disappear.
7. As a branch Admin User, I want oldest-created-first stable pagination, so that ordering is predictable across pages without implying an SLA.
8. As a branch Admin User, I want to filter Tahap delivery to Siapkan barang, so that I can focus on preparation work.
9. As a branch Admin User, I want the stage filter to intersect queue, search, branch and dates, so that selecting a stage does not silently broaden my work view.
10. As an authorized viewer, I want matching and no-date base totals under identical scope and stage filters, so that I know how much work date filtering hides.
11. As a branch Admin User, I want my preceding queue, filters and valid page restored after detail/follow-up, so that I do not lose my place.
12. As an authorized viewer, I want stage and next-step meaning to agree across list, follow-up and detail, so that I do not receive contradictory guidance.
13. As a branch Admin User, I want guidance visible at the top even when waiting or complete, so that reopening a detail explains its current state.
14. As a preparer, I want short advisory inspection guidance, so that I check goods without a new mandatory stored checklist.
15. As a preparer, I want readiness confirmation to distinguish readiness from booking, so that marking ready does not imply a provider request.
16. As a booking operator, I want frozen goods, recipient, destination, service and checkout shipping reviewed before booking, so that I can approve the correct existing order context.
17. As a booking operator, I want duplicate submission blocked and ambiguity explained without retry, so that an uncertain outcome does not create another shipment.
18. As a handoff operator, I want confirmation tied to the known shipment and actual physical transfer, so that a resi is not mistaken for handoff or arrival.
19. As a monitoring viewer, I want absent courier progress described neutrally, so that missing scans do not invent failure or lateness.
20. As a monitoring viewer, I want detail reload distinct from authorized tracking reconciliation, so that I know which control contacts the provider.
21. As an authorized viewer, I want timeline sources and event/receipt times explicit, so that I can distinguish staff facts from courier observations.
22. As an authorized viewer, I want missing handoff, timestamps, tracking links and POD labelled honestly, so that absent evidence is not fabricated or turned into mandatory backfill.
23. As an admin viewer, I want checkout shipping, booking cost and courier bill shown separately, so that an absent bill is not zero and differences are not a customer surcharge.
24. As a branch Admin User, I want settlement blockers and supported packing failures explained with external next steps, so that I do not bypass eligibility or assume commercial resolution.
25. As a packing operator, I want existing failure-report consequences confirmed, so that I understand fulfillment is blocked without refund, stock reversal or SO cancellation.
26. As an authorized booking operator, I want unknown booking distinguished from outstanding dispatch, so that proof-release is not offered for an unreleasable request.
27. As an authorized booking operator, I want current-attempt absence and operation-closure proof explicitly acknowledged, so that timeout or stale proof is not treated as permission to rebook.
28. As an authorized booking operator, I want release and new booking separately approved, so that releasing a hold never automatically creates a shipment.
29. As an authorized resolver, I want manual finish separate from normal work with a mandatory reason and full consequences, so that closure is not mistaken for verified arrival or business resolution.
30. As an authorized viewer, I want courier issues surfaced without new case criteria, so that ON_HOLD/CANCELED alone do not grant extra actions.
31. As an authorized viewer, I want verified arrival and manual closure distinctly labelled and terminal, so that late evidence cannot reopen active work.
32. As a scope-authorized cross-branch viewer, I want specific edit/Home Branch restrictions and no mutation controls, so that visibility is not confused with physical-action authority.
33. As an authorized viewer with uncertain action eligibility, I want safe read reload rather than guessed denial or write retry, so that stale state cannot invite duplicate booking.
34. As an Admin User in Policy-Unavailable State, I want protected data hidden, so that a failed policy refresh does not preserve stale access.
35. As a small-screen user, I want stacked detail and contained table scrolling with accessible controls, so that compact density remains usable without whole-page horizontal overflow.
36. As a customer, I want internal costs, manual reasons, actors and diagnostics excluded from my payload, so that admin presentation improvements preserve privacy.

## 2. Approval and normative sources

- Shared understanding: confirmed through `ask_user_question` in the ticket 06 review session by selecting **Konfirmasi contract (Recommended)** after reading the combined-review summary and acceptance-matrix link. The owner authorized drafting this complete specification and resolving ticket 06. See [ticket 06](../wayfinder/06-ux-contract-and-acceptance-criteria.md).
- Complete specification scope and acceptance/verification criteria: **explicitly owner-approved** through `ask_user_question` by selecting **Setujui spec lengkap (Recommended)** after the complete revised document and change summary were presented. Approval includes incorporated artifacts, confirmed testing boundaries and AC01–AC39; it authorizes Ready and publication of the separately approved tickets, not execution in this request.
- Prototype/design feedback: owner accepted Compact Operations and requested delivery-stage filtering; the isolated prototype demonstrated these choices. It did not approve backend behavior or implementation.
- Updated shared understanding: owner selected **Konfirmasi scope (Recommended)** through `ask_user_question`, confirming decision contract + Compact Operations + stage filtering and browser/read-API/service test boundaries before this revision was drafted.
- Implementation-ticket breakdown: owner separately selected **Setujui 7 ticket (Recommended)**, approving the seven vertical slices and dependencies in section 12. Publication was subsequently authorized by the separate complete-spec approval recorded above.
- Tracker location: owner selected **Direktori implementation baru (Recommended)**, authorizing Local Markdown publication under `.scratch/admin-delivery-workflow/ticket/` after complete-spec approval. Existing decision tickets/prototype stay intact.
- Implementation execution, delegation, commits, remote operations, provider work and deployment: not authorized by this document.

The following linked artifacts are normative parts of this reviewable specification, not optional background:

1. [Navigation decision](../wayfinder/01-delivery-work-navigation.md).
2. [Approved stage/guidance table](../wayfinder/02-delivery-stage-language-and-guidance.md).
3. [Queue membership/defaults/counts](../wayfinder/03-work-queue-priorities-and-filters.md).
4. [Approved normal layout and confirmations](../wayfinder/assets/04-guided-detail-wireframes.md), with approval recorded in [ticket 04](../wayfinder/04-guided-detail-wireframes-and-confirmations.md). Its historical pre-approval footer is superseded by the ticket's explicit approval record.
5. [Approved exception/copy/access contract](../wayfinder/assets/05-exception-guidance-and-read-only-access.md).
6. [Combined review and acceptance matrix AC01–AC33](../wayfinder/assets/06-ux-contract-and-acceptance-matrix.md). All rows remain required acceptance criteria; this revision adds AC34–AC39 below.
7. [Compact Operations prototype and limitations](../prototype/README.md), with [interactive presentation](../prototype/app/page.jsx) and [visual theme](../prototype/app/prototype.css). These are visual reference sources only. The mock membership/policy logic, fixture values and generated progress are not operational authority.

These sources carry the exact Indonesian wording and confirmation fields. Recommendations/sample copy in the old proposal do not override them. Existing [delivery orders](../../../docs/features/delivery-orders.md), [fulfillment](../../../docs/features/delivery-fulfillment.md), [tracking](../../../docs/features/delivery-tracking.md) and [follow-up](../../../docs/features/delivery-follow-up.md) remain the authority for unchanged operational rules. Any genuine conflict discovered during implementation requires owner review, not silent reinterpretation.

## 3. Navigation and work discovery

- Login continues to land on Dashboard. Opening Orders defaults to Delivery / `Perlu dikerjakan`.
- Keep Delivery / Pickup / Semua tabs and one Delivery work-filter dropdown, not a new independent delivery workspace or another status-tab row.
- Dropdown provides actionable work, access to existing follow-up, Monitoring, `Selesai` and `Semua delivery`. No additional pending-payment filter.
- Pickup retains its verification context. Semua remains general order search/history.
- Returning from detail/follow-up restores prior queue, filters and page where still valid. Changing filters returns to the first results page.
- Use current Branch Scope and branch-scope defaults. Home Branch remains an action boundary, not a visibility filter chosen by the user.
- Follow-up is the existing area and sole case source. Navigation does not create a second case ledger.

### Queue membership

| Evidence | Work views |
|---|---|
| Fully eligible unpacked | Perlu dikerjakan; Semua delivery |
| Packed and booking available | Perlu dikerjakan; Semua delivery |
| Known successful booking without handoff/pickup | Perlu dikerjakan; Semua delivery |
| Recorded handoff without progress | Monitoring; existing pending-evidence shipment follow-up; Semua delivery |
| Verified PICKED_UP / ON_DELIVERY | Monitoring; Semua delivery |
| Blocked settlement, supported packing failure, booking_dispatched / booking_unknown | Existing corresponding follow-up; Semua delivery; not normal actionable work |
| Applicable pre-completion RETURNED / SHIPMENT_ISSUE | Existing shipment follow-up; Semua delivery |
| Applicable pre-completion ON_HOLD / CANCELED | Monitoring with issue warning; Semua delivery; status alone adds no follow-up case |
| Pending payment / verification | Semua delivery only |
| Verified delivery / valid manual completion | Selesai and Semua delivery, with distinct outcome labels; not active or open follow-up |

Monitoring and follow-up are not required to be disjoint. Recorded handoff with absent/WAITING courier evidence already meets the existing service's pending-evidence shipment condition. Preserve discoverability in both views with neutral language, not a new failure criterion. Another existing case condition may independently apply to an order; retain existing service membership/precedence rather than introducing new case types.

### Filters, order and totals

All queues and history default to no creation-date restriction. Sort globally by creation time ascending with stable tie ordering for pagination; do not sort only the current client page. Creation age is not stage age or an SLA verdict.

Provide a separate **Tahap delivery** single-select dropdown, default **Semua tahap**, alongside the work queue and other list filters. Expose the unique approved business stage labels from section 4, not raw lifecycle enums. Released booking and ordinary ready goods share **Barang siap**, while their persistent guidance can differ. Stage filtering intersects queue membership, authorized branch scope, search and dates; it never moves an order from another queue or widens permission. This is delivery-specific filtering in delivery work/search and its existing follow-up context, not a replacement for general order-status or Pickup filters. Keep existing follow-up kind filtering and the single case source.

For example, `Perlu dikerjakan + Siapkan barang` shows only eligible unpacked orders. `Monitoring + Siapkan barang` has no matches and shows an explicit empty state with a suggestion to adjust filters; do not silently clear the stage or change queue. The selected stage remains visible and is restored on return, and changing it resets results to page one. Apply stage filtering and both counts on the server before pagination, not only to loaded rows.

Optional creation-date filters display the selected range and a narrowing warning. Show matching results and the total under identical authorized scope, queue and other filters with only the date restriction removed. The no-date base total retains the selected delivery stage as well as queue, scope, search and branch filters. Example: 12 matching results out of 40 authorized base results of the same stage/queue. Neither total is the length of the loaded page. Pages contain up to 20 orders.

Required row fields: reference/creation date, customer, origin branch, payment, approved delivery stage, next step/blocker and contextual navigation. Service/destination are not required queue columns. Row controls only open the relevant detail section; they never perform writes.

## 4. Evidence-based stage and next step

Use the approved ticket 02 wording consistently across list, follow-up summaries and detail. Instructions derive from current authoritative evidence, not the last local click. They remain visible when waiting, terminal and reopened.

| Condition | Stage | Persistent guidance |
|---|---|---|
| Payment not received | Menunggu pembayaran | Tunggu pembayaran pelanggan. |
| Awaiting authoritative payment verification | Verifikasi pembayaran | Tunggu verifikasi pembayaran. |
| Paid, Jubelio settlement blocked | Verifikasi tertunda | Pembayaran diterima. Tunggu verifikasi Jubelio. |
| Fully eligible, unpacked | Siapkan barang | Siapkan barang, lalu tandai siap. |
| Packed, booking available | Barang siap | Barang siap. Pesan pengiriman. |
| Known booking, no handoff/pickup | Menunggu penjemputan | Tunggu kurir. Catat serah terima setelah barang diserahkan. |
| Recorded handoff, no courier progress | Diserahkan ke kurir | Barang diserahkan. Tunggu update kurir. |
| Verified PICKED_UP | Dibawa kurir | Barang dibawa kurir. Pantau pengiriman. |
| Verified ON_DELIVERY | Dalam pengiriman | Barang dalam pengiriman. Pantau pengiriman. |
| Verified DELIVERED | Barang diterima | Barang telah diterima. Pengiriman selesai. |
| Valid manual completion | Selesai manual | Order ditutup manual. |
| Outstanding booking_dispatched | Menunggu hasil booking | Hasil booking belum tersedia. Jangan pesan ulang. |
| Stable booking_unknown | Booking belum pasti | Konfirmasi ke Jubelio. Jangan pesan ulang. |
| Proven unknown booking released | Barang siap | Booking sebelumnya tidak terbentuk. Pesan pengiriman. |
| physical_stock_unavailable | Stok tidak tersedia | Stok tidak tersedia. Tindak lanjuti di luar aplikasi. |
| damaged_goods | Barang rusak | Barang rusak. Tindak lanjuti di luar aplikasi. |
| paid_service_limits_exceeded | Batas layanan terlampaui | Paket melebihi batas layanan. Tindak lanjuti di luar aplikasi. |
| Applicable pre-completion ON_HOLD | Pengiriman tertahan | Pengiriman tertahan. Konfirmasi ke kurir. |
| Applicable pre-completion RETURNED | Barang dikembalikan | Kurir melaporkan pengembalian. Tindak lanjuti kendala. |
| Applicable pre-completion CANCELED | Pengiriman dibatalkan | Pengiriman dibatalkan kurir. Tindak lanjuti kendala. |
| Applicable pre-completion SHIPMENT_ISSUE | Kendala pengiriman | Pengiriman bermasalah. Konfirmasi ke kurir. |

Terminal outcomes suppress active next-task guidance. Verified courier pickup/transit takes precedence over an absent manual handoff stamp. Verified DELIVERED completes despite absent intermediate evidence or POD. Manual completion never becomes inferred verified arrival. No database enum redesign is required.

Order stage and viewing-admin eligibility are separate. `processing`, paid status, ID presence or `actor.allowed` alone never grant a mutation.

## 5. Guided detail and normal actions

The approved six-state wireframe is the behavioral hierarchy contract: prominent next-step/blocker panel; evidence-aware progress; goods and immutable destination/service; resi/tracking; source-labelled activity; financial summary and expandable differences; separate expandable diagnostics. The owner's accepted Compact Operations prototype supplies the visual direction without replacing the wireframe's exact copy or any supported state.

### Compact Operations visual contract

- Retain the live admin shell, authentication and Current Policy behavior. Do not recreate the prototype's fictional workspace/user, disabled sidebar items, prototype banner, scenario/viewer toolbar, reset control or fixed demo date in production.
- Use the existing admin design system and deep navy / slate / teal palette. Keep an information-dense table with restrained borders, clear reference/date and readable stage/next-step columns, not a decorative dashboard or new Kanban workflow.
- Payment and delivery stage are separate visually and semantically. Status colours accompany explicit text rather than being the only signal; pending evidence must not look like failure or lateness.
- Detail places concise identity/payment/stage above the prominent next-step panel. Desktop may use the prototype's two-column grouping for goods/tracking and destination/activity; smaller screens stack these sections without losing guidance or controls.
- Compact does not mean clipped guidance or inaccessible controls: readable wrapping, labelled filters, keyboard-operable navigation and confirmations, visible focus, focus restoration after dialogs, and disabled processing states are required.
- Wide list tables scroll inside their container on small screens; the page itself must not overflow horizontally. Filters and relevant controls remain reachable. No new responsive workflow or mandatory extra step is introduced.
- Show the financial summary without hiding the three values behind diagnostics. Expandable differences, special evidence and technical diagnostics follow the agreed hierarchy; blocker symptom/impact remains visible outside collapsed sections.
- Exact spacing, breakpoints and typography are engineering details within this direction. Do not copy mock calculations, unavailable links, fabricated actor/date labels or a fixture-derived completed progress milestone into production. Rebuild using existing application components and trustworthy evidence.

Guidance is text only. Separately expose at most one existing normal primary fulfillment action when eligible and authorized. Exceptional mutations belong in `Penanganan khusus`, not beside the normal action as an alternative routine step.

- **Preparation:** short advisory inspection of goods, quantity, condition and packaging; no persisted checklist. Short readiness confirmation explains that readiness does not book shipment. Success toast: `Barang ditandai siap.`
- **Booking:** full review of frozen goods, recipient/destination, service and checkout shipping; confirmation explains provider request, no handoff implication and no blind retry. During submission disable duplicate interaction. Known success toast: `Pengiriman berhasil dipesan.` No success toast for an ambiguous result.
- **Handoff:** confirm the package was actually handed to courier, with stored booking/AWB context. No extra persisted checkbox. This is not proof of customer receipt. Success toast: `Serah terima dicatat.`
- **Monitoring/completion:** no normal preparation/booking action. Refresh and safe links remain separate and guarded by existing policy.

Success toasts contain results only; the persistent panel carries the current next step. Failures communicate the actual known outcome rather than assuming a dispatched write failed.

### Evidence, history and money

Never manufacture scans, timestamps, handoff, POD or links. Label unavailable facts. Show actual admin/system/courier sources and distinguish event time from receipt time. Ignored receipts belong in diagnostics, not the normal activity timeline. Missing intermediate evidence is inspectable, not mandatory backfill.

Keep goods, destination and service immutable under existing snapshot rules. Display checkout shipping, booking cost and courier bill separately; an absent bill is unavailable, not zero. Differences do not increase customer payment or block normal fulfillment. Customer DTOs continue excluding internal costs/reasons/actor IDs and diagnostics.

## 6. Exceptions and safety

Use the full approved ticket 05 scenario/copy artifact for symptom, impact, safe next step, evidence, confirmation and commercial non-effects.

- **Settlement blocked:** no packing or force-verified action. Existing system-only recovery and external Jubelio coordination remain unchanged.
- **Packing failure:** only the three existing codes, under pre-dispatch guards. The order stays processing/paid; normal fulfillment is blocked. No supported resume/refund/replacement/stock/cancellation shortcut. Explain external business resolution and customer communication.
- **Unknown booking:** no blind retry. Explicit Jubelio confirmation for the current attempt must attest both absence and closure of the original operation, with required reference/reason and two unchecked mandatory acknowledgements. Timeout, 404, empty lookup and elapsed time are not proof.
- **Proof-release:** releases to packed and archives proof without sending provider create. Require fresh detail and a separate booking review/approval. Attempts are monotonic; stale/repeated proof cannot release another attempt.
- **Outstanding dispatch:** no proof-release, rebooking, elapsed-time rule or invented recovery/adoption button.
- **Handoff without scans:** neutral pending evidence. Existing manual finish may be eligible under complete guards, but is not promoted as a remedy for absent tracking.
- **RETURNED/SHIPMENT_ISSUE:** investigate; manual finish only under complete existing booked-ledger/settlement/authorization/evidence guards.
- **ON_HOLD/CANCELED:** visible warnings, no independent expansion of follow-up/manual-finish criteria. Shipment cancellation is not order cancellation.
- **Manual finish:** exceptional closure with nonblank reason and full confirmation of no verified arrival/POD, refund, stock adjustment, SO cancellation or automatic communication. Result completed/paid with `Selesai manual`; reason remains admin-only.
- **Late evidence:** terminal outcomes remain terminal, out of open follow-up and active queues; only existing safe enrichment is permitted.

## 7. Read-only, stale and concurrent states

Verified missing edit permission, absent Home Branch and Home Branch mismatch get their specific approved explanations, shown together if multiple apply. Retain truthful order stage and authorized evidence, but show no normal/special mutation controls. List branch selection does not change Home Branch. Guarded provider refresh also remains unavailable to unauthorized viewers.

If view access remains valid but current action eligibility is unknown, show `Kelayakan tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan.` No guessed restriction or mutation button until fresh eligibility is established.

Distinguish two controls:

- `Muat ulang detail`: read latest application state, no provider booking/tracking request.
- `Perbarui tracking`: existing authorized known-AWB reconciliation, not provider create; no polling.

Failed detail reload shows `Detail belum berhasil diperbarui. Muat ulang detail untuk memastikan hasil.` It must not imply the preceding write failed or re-enable duplicate booking. On server conflict show `Kondisi order telah berubah. Muat ulang detail sebelum melanjutkan.` Offer read reload, not automatic write retry.

Unavailable protected view policy follows existing fail-closed hiding of navigation/data, not a retained read-only detail fallback.

## 8. Features and acceptance/verification contract

| # | Feature | Status | verify: | Dependencies |
|---|---|---|---|---|
| 1 | Delivery navigation and evidence-based queues | Ready | AC01–AC07, AC11–AC14, AC21–AC22, AC25, AC32, AC34–AC37, AC39; authorized membership/counts/stage filtering before pagination, preserved pickup/search | Shared evidence/policy projection |
| 2 | Guided normal detail, confirmations and evidence | Ready | AC08–AC16, AC26–AC30, AC32–AC33, AC38–AC39; consistent labels, Compact Operations hierarchy, truthful activity/money, refresh/concurrency safety | Same projection as list; existing fulfillment/tracking guards |
| 3 | Coherent existing exceptions and read-only handling | Ready | AC07, AC12, AC17–AC31, AC33, AC34–AC39 as applicable; coherent follow-up filtering and unchanged evidence/authorization/commercial/terminal rules | Existing follow-up source and approved detail hierarchy |

The complete [AC01–AC33 matrix](../wayfinder/assets/06-ux-contract-and-acceptance-matrix.md#3-observable-acceptance-matrix) is incorporated into this specification. It covers controlled inputs/actions and observable outcomes, including normal payment-to-arrival flow and exceptions. Acceptance expectations are not executed results.

### Additional observable acceptance criteria

| ID | Controlled input / action | Observable expected outcome |
|---|---|---|
| AC34 | Open Delivery; select Siapkan barang within Perlu dikerjakan | Default is Semua tahap; selected stage shows only eligible unpacked orders in that queue. All unique approved section 4 stage labels are available, including stages absent from the prototype. Released and ordinary ready orders match the single Barang siap choice. |
| AC35 | Combine a stage with branch/search/date, or select Monitoring + Siapkan barang | All filters intersect the authorized result set before pagination. No incompatible-stage order is pulled from another queue; no-match state explains adjustment without silently changing selection. Unauthorized orders are not disclosed through rows or counts. |
| AC36 | 40 authorized same-queue/same-stage/search/branch results; 12 match dates; result set spans multiple pages | Show 12 matching out of 40 same-stage base results, removing dates only. With date cleared, retain stage and restore 40; globally oldest-first stable ordering and 20-row pages still apply. |
| AC37 | Open contextual detail or existing follow-up, return, then change stage | Restore preceding stage/queue/filter/page where valid; changing stage resets to page one. Existing follow-up kind filtering and membership remain available from the single case source. |
| AC38 | Inspect list and six normal detail states plus blockers/read-only under live admin shell | Compact Operations density/hierarchy follows accepted direction, with separate payment and stage text, prominent persistent guidance, at most one authorized normal primary action, separated special handling, three financial values, and no prototype controls/mock identity. Approved copy and all real supported states remain authoritative. |
| AC39 | Use keyboard for filters, row navigation and confirmations; inspect desktop and 390px mobile viewport | Controls have accessible names and visible focus; dialogs support dismissal and return focus; guidance remains readable. Detail stacks on smaller screens, list scrolling is contained, and no whole-page horizontal overflow or colour-only state indication occurs. |

### Testing Decisions — confirmed seams and required future testing

Preserve/extend [admin booking mock E2E](../../../e2e/admin/shipment-booking-mock.spec.ts), [admin follow-up mock E2E](../../../e2e/admin/delivery-follow-up-mock.spec.ts), [tracking mock E2E](../../../e2e/store/shipment-tracking-mock.spec.ts) and [delivery order mock E2E](../../../e2e/store/delivery-order-mock.spec.ts). Existing booking, tracking and follow-up database/service tests remain necessary for server authorization, concurrency and no-provider-create effects; UI mocks alone cannot prove these.

The owner confirmed these testing boundaries before drafting this revision:

1. **Admin browser journey:** visible Orders/detail/follow-up navigation, stage filters, confirmations, accessible controls, responsive layout and safe state handling. Reuse the existing controlled mock Playwright seams, while preserving Pickup and store regression coverage.
2. **Orders read API / shared evidence projection:** authoritative stage, safe viewer-eligibility summaries and authorized queue/filter/count/pagination behavior, including same-stage no-date totals and orders outside the loaded page. Prefer public request/service seams, not private query-builder assertions.
3. **Existing booking / tracking / follow-up public services with controlled PostgreSQL and provider stubs:** fresh authorization, settlement/evidence guards, at-most-once and concurrent claims, proof/current-attempt release without provider create, terminal semantics and customer privacy. Keep the existing seam rather than inventing a parallel operational engine.

Good tests assert externally observable results/effects from independently specified fixtures, not expectations computed by the same projection under test. Do not duplicate coverage at every helper or use UI mocks to claim backend effects. Shared projection tests may use a small pure public interface when needed for exhaustive stage combinations; this is a testability seam, not a second source of lifecycle truth.

Future implementation must add deterministic public-seam tests for shared stage projection, authorized queue membership/counting/stage-filtering/pagination and policy/eligibility summaries. Add admin Playwright coverage for visible navigation, list/detail consistency, confirmation copy, read-only reasons, missing evidence and stale/conflict safety. Existing store specs provide regression verification, not new storefront scope.

Use project TDD: failing test first, one verifiable slice at a time, independent expected values, no live-provider dependency. Main agent executes verification. At minimum before commit/PR: `npm run test:unit` for logic and `npm run test:e2e` for UI/routing/auth, plus relevant service/database checks with their required infrastructure. This specification does not authorize starting tests or implementation now.

## 9. Implementation Decisions, documentation and deployment

These are bounded implementation decisions and investigation responsibilities, not authorization to execute:

- Derive the same operational meaning in list/detail; separate order evidence from full viewing-admin action eligibility.
- Scope queue/stage membership and both counts on the server before pagination. Extend the existing Orders read contract with safe operational summaries and explicit delivery work/stage filters while preserving existing consumers. Validate filter inputs without widening Current Policy scope. Never derive full queue totals from loaded client rows.
- The existing detail read contract already contains shipment/tracking evidence; its Home Branch hint is not full action eligibility. Safely expose trustworthy current access/eligibility reasons and available activity evidence rather than granting actions from a UI boolean.
- Reuse existing booking, handoff, reconciliation and special-resolution services/routes. UI confirmation improves informed use; it does not change service eligibility, accepted proof shape, audit requirements, or provider side effects.
- Safely project only necessary summaries, current policy/eligibility reasons and real activity evidence. No raw provider errors, secrets or unnecessary destination/customer data.
- Preserve existing server guards and provider at-most-once semantics; presentation is never an authorization substitute.
- Implement and verify vertical behavior slices only after complete-spec approval. New product choices require renewed owner decision; delegation remains opt-in.
- Update enduring feature/API documentation and `docs/README.md` for implemented behavior. Use shared schema owner only if a separately justified schema change is needed; no schema change is approved merely by this UI contract.
- Baseline adds no env variables, provider endpoints, callback changes, cron, ports, build steps or infrastructure. Existing deployment files remain unchanged. Any newly required deployment-affecting change must receive its own scope decision and corresponding deployment-doc/config updates.

## 10. Out of Scope and open questions

No assignment/claim ownership, SLA, automatic escalation, mandatory persisted checklist, new follow-up types, database lifecycle redesign, automatic booking/release, blind retry, provider lookup/adoption extension, refunds, order/SO cancellation, replacement, return-stock handling, checkout destination/service edits, post-completion reopening/disputes, customer communication integrations, storefront redesign, courier collection guarantees, tracking cron/polling, live-provider activation/write tests, commits, remote operations or deployment.

No unresolved owner-owned product decision was identified after combining tickets 01–05 and confirming the contract. After subsequent owner feedback, Compact Operations and stage filtering are incorporated in this revision with their added acceptance criteria. Remaining engineering detail: safe projection/query design, reliable available activity data and visual spacing/responsive execution. These must preserve the agreed hierarchy and behavior; missing repo facts are the implementing agent's responsibility. A behavior-affecting gap discovered later blocks the affected slice until the owner decides.

**Approval gates passed for publication:** the revised complete document, incorporated artifacts, confirmed testing boundaries and AC01–AC39 received explicit owner approval after review. The seven-ticket breakdown and new Local Markdown implementation location also have separate owner approval. Do not start implementation merely while preparing/publishing these planning artifacts; execution still requires a subsequent request.

## 11. Verification performed and retirement

Performed for specification work: read-only source/decision/artifact review, current Orders list/detail API and follow-up contract/test-seam inspection, and Markdown/link/status consistency review. No production application/config/schema changes, unit/E2E suites, builds, lint, typechecks, provider requests, delegation, commits or remote operations were performed for this planning revision.

The separately owner-authorized isolated Next.js prototype was built and browser-inspected earlier. Its smoke observations are documented in its README; they are not production test results or acceptance of AC01–AC39.

When implementation eventually reaches Done:

- [ ] All approved feature verification passes, including UI E2E and applicable service/database coverage.
- [ ] Enduring content is extracted into `docs/` with API/deployment documentation as applicable.
- [ ] Plan tetap disimpan bersama artefak fitur setelah Done.
- [ ] `.scratch/admin-delivery-workflow/index.md` retains a Done entry with date and outcome, and obsolete proposal bookkeeping is retired consistently.

## 12. Separately approved implementation-ticket breakdown

The owner approved these seven tracer-bullet slices and their blocking edges before publication. Each ticket includes relevant public-seam tests, UI E2E and enduring documentation for its own behavior. There is no backend-only foundation ticket or test/documentation ticket deferred to the end. Existing business services remain operational authority.

| # | Ticket | Blocked by | Demoable delivery and principal acceptance mapping |
|---|---|---|---|
| 01 | Evidence-aware detail foundation and safe viewer access | None | Live-admin Compact Operations detail frame; shared authoritative stage/guidance; trustworthy edit/Home Branch/eligibility reasons; fail-closed view policy; read-only evidence without mutation controls. AC06–AC07 stage meaning, AC26–AC27, AC31–AC32, AC38–AC39; exhaustive section 4 stage projection. |
| 02 | Delivery work queues, navigation and stage filters | 01 | Real scoped Orders membership/counts before pagination; Delivery/Pickup/Semua; existing follow-up entry; no-date defaults; oldest-first stable 20-row pages; stage/search/branch/date intersection and state restoration. AC01–AC07, AC11–AC14 queue membership, AC21–AC22 queue membership, AC25, AC32, AC34–AC39. |
| 03 | Guided preparation and booking confirmations | 01 | Advisory preparation, readiness confirmation, frozen full booking review, result-only toasts, duplicate-submit disabling, unknown/dispatched outcomes and stale/conflict read reload without write retry. AC08–AC11, AC24 as applicable, AC28–AC29, AC32, AC38–AC39; existing booking authorization/at-most-once regression. |
| 04 | Physical handoff, tracking evidence, activity and money | 01 | Actual-handoff confirmation; separate detail/provider refresh; neutral pending evidence; verified courier progress/arrival without mandatory backfill; real source/time labels and financial hierarchy. AC11–AC16, AC25–AC26 refresh/evidence boundaries, AC30, AC32–AC33, AC38–AC39. |
| 05 | Settlement and packing-failure guidance | 01 | Visible settlement blocker and three supported packing-failure explanations/report confirmations; corresponding existing follow-up summaries and contextual detail; unchanged processing/paid and external coordination. AC07, AC17, AC24, AC26–AC29 as applicable, AC32–AC33, AC38–AC39. |
| 06 | Held booking and current-attempt proof-release | 01, 03 | Unknown versus outstanding dispatch; required current-attempt reference/reason/two acknowledgements; guarded release with archived proof and zero provider create; fresh detail followed by separate booking confirmation. AC18–AC20, AC24, AC26–AC29 as applicable, AC32–AC33, AC38–AC39; service concurrency/current-attempt/no-create regression. |
| 07 | Shipment issues, manual closure and terminal safety | 01, 04 | RETURNED/SHIPMENT_ISSUE versus ON_HOLD/CANCELED; guarded exceptional reason/confirmation; manual outcome distinct from verified arrival; completed exclusion from active/follow-up, late safe enrichment and customer privacy. AC12–AC14 as applicable, AC21–AC29 as applicable, AC32–AC33, AC38–AC39. |

Dependencies are functional gates, not implied parallel-worker permission. Ticket 01 creates the reusable stage/view-access/detail contract. Ticket 06 requires ticket 03's separate booking confirmation path. Ticket 07 requires ticket 04's evidence/activity/completion presentation. Other numbered ordering is a suggested execution order; it must not be converted to unnecessary blocking edges. A single main agent may execute sequentially after separately requested implementation; delegation remains opt-in.

Each published ticket must link this specification and the decision/artifact sources, declare its exact criteria and applicable negative/concurrency cases, and retain exclusions. Approval of the breakdown does not imply all acceptance criteria have been verified or a ticket has started.

## 13. Further Notes and handoff

- Published [Local Markdown implementation effort](../ticket/map.md): one task file per approved ticket and a navigation/approval map. The resolved decision effort is not overwritten or renumbered.
- The conceptual plan status remains solely in `.scratch/admin-delivery-workflow/index.md`. Local task workflow follows the configured tracker: open → claimed → resolved. A ready-for-agent label may be attached only after complete-spec approval, but does not remove genuine ticket blockers. No task is claimed during publication.
- Keep the prototype available as visual reference during review. Do not promote its throwaway source into production or automatically commit/delete it. Its hardcoded fixtures, single-page pagination and simplified guards must be replaced by real contracts with deterministic tests.
- Implementation/API/feature documentation belongs in enduring docs as each slice ships; final retirement follows section 11. No deployment changes are part of baseline.
- New behavior conflicts or unavailable evidence must return to the owner; neither the ticket implementer nor the prototype supplies authority to invent operational recovery.
- Full-spec approval authorizes Ready/publication only for this request. Execution, commits, provider operations, delegation and deployment are not being requested in this planning task.
