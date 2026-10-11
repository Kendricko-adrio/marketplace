# Combined Delivery UX Contract and Acceptance Matrix

Decision review for [ticket 06](../issues/06-ux-contract-and-acceptance-criteria.md). Planning only. The owner confirmed shared understanding through `ask_user_question` by selecting “Konfirmasi contract (Recommended)”; this is not complete-spec approval or permission to implement. All expected behavior below derives from resolved owner decisions, not proposal recommendations. No tests were executed.

## 1. Review result and sources of truth

Reviewed complete answers for [navigation](../issues/01-delivery-work-navigation.md), [stage language](../issues/02-delivery-stage-language-and-guidance.md), [queues](../issues/03-work-queue-priorities-and-filters.md), [detail](../issues/04-guided-detail-wireframes-and-confirmations.md), and [exceptions/access](../issues/05-exception-guidance-and-read-only-access.md), including the approved [normal wireframes](04-guided-detail-wireframes.md) and [exception artifact](05-exception-guidance-and-read-only-access.md).

No new unresolved product decision was identified within the approved scope. List/detail vocabulary, navigation, evidence requirements, normal actions and exceptional handling can form one coherent contract.

Important reconciliation findings:

- **Monitoring and existing follow-up can overlap.** Ticket 03 puts handoff without scans in Monitoring. Ticket 05 preserves its existing pending-evidence shipment follow-up membership. The existing [service](../../../apps/admin/src/lib/delivery-follow-up.ts), `list()` shipment condition, includes booked orders with recorded handoff and absent/WAITING tracking. These are two views of the same order, not competing case ledgers or proof of failure. Neither approved ticket requires mutually exclusive Monitoring/follow-up membership. Preserve both and use neutral pending-evidence copy.
- **Text-only guidance does not remove existing actions.** Ticket 02 prohibits additional buttons embedded in instructional copy; ticket 04 separately permits at most one existing normal primary fulfillment action. Exceptional actions remain separate in `Penanganan khusus`.
- **Order stage is not viewer permission.** A Bandung order can remain `Siapkan barang` for a Jakarta viewer. Keep that truthful stage and explain the verified read-only restriction; do not expose mutation buttons.
- **Terminal outcomes precede active guidance.** Missing intermediate evidence and late courier receipts never reopen completed work. Manual completion remains `Selesai manual` even if later safe evidence enriches the history.
- **Approved answers override historical draft wording.** Ticket 04's asset retains an obsolete pre-approval footer; the resolved ticket explicitly records complete artifact approval. The starting proposal's open questions, sample labels and suggested columns are not additional owner decisions. They must be superseded in the combined specification, not reopened or copied as requirements.

## 2. Confirmed combined scope

Keep delivery inside Orders with Delivery / Pickup / Semua; login stays on Dashboard and Orders opens Delivery / `Perlu dikerjakan`. Restore prior queue/filter/page on return where valid. Use the existing follow-up area as the sole case source.

Use Indonesian evidence-based stage and next-step copy from ticket 02 in list and detail, including visible waiting and completed outcomes. Physical readiness, booking, handoff and courier arrival are distinct facts. No new lifecycle enums or operational policy.

All queues/history have no default date restriction, oldest-created-first stable pagination, and up to 20 rows per page. Optional creation-date filters show the range, narrowing warning, matching count and same-scope base count with only the date restriction removed. Counts and membership are applied before pagination. Queue membership depends on order evidence, not the viewer's mutation authority.

Place next-step/blocker guidance prominently, with goods, immutable destination/service, AWB/tracking, source-labelled activity and a three-value financial summary. Missing evidence is labelled, never invented. Separate normal fulfillment, special handling, detail reload and authorized known-AWB tracking refresh. Apply existing full server eligibility and authorization; `actor.allowed` and identifier presence alone are insufficient.

## 3. Observable acceptance matrix

Each row supplies controlled input/action and independently observable outcomes for future verification. References to actions always assume complete existing authorization and eligibility unless the row explicitly tests their absence.

| ID | Input / action | Observable expected outcome | Source |
|---|---|---|---|
| AC01 | Bandung staff logs in, opens Orders, then switches tabs | Dashboard remains login landing; Orders opens Delivery / Perlu dikerjakan; Pickup verification remains accessible in Pickup; Semua supports general search/history | 01 |
| AC02 | Open detail or follow-up from a filtered queue, then return | Restore preceding queue/filter/page where still valid; changed filters reset to the first results page | 01, 03 |
| AC03 | Unfinished eligible order created yesterday; no manual date filter | Discoverable in Perlu dikerjakan; no default today-only restriction and no lateness claim | 03 |
| AC04 | 40 authorized selected-queue orders, 12 matching an applied date range | Show 12 matching out of 40 base results, visible range and narrowing warning; clearing date restores 40; unauthorized orders contribute to neither count | 03 |
| AC05 | More than 20 authorized results, including equal creation times | At most 20 per page; globally oldest-created-first with stable tie ordering, not page-local sorting or stage-age priority | 03 |
| AC06 | Payment absent or awaiting authoritative verification | Menunggu pembayaran / Verifikasi pembayaran with wait guidance; all-delivery search only, no normal fulfillment action | 02, 03 |
| AC07 | Payment verified but Jubelio settlement blocked | Verifikasi tertunda in list/detail and existing follow-up; visible reason; no packing, force-verified or repeat-payment instruction | 02, 03, 05 |
| AC08 | Fully eligible unprepared delivery; record readiness after preparation | Siapkan barang in active queue; short advisory checks and readiness confirmation; result-only toast Barang ditandai siap.; fresh detail shows Barang siap; no provider booking from readiness | 02, 03, 04 |
| AC09 | Goods ready; open booking confirmation | Review frozen goods, recipient/destination, service, checkout shipping and provider-request consequences; no address/service editing; booking and handoff are explicitly distinct | 04 |
| AC10 | Submit booking and attempt duplicate submission | Processing feedback disables duplicate submission; existing server at-most-once claim remains authoritative; no automatic retry | 04, existing booking guards |
| AC11 | Known successful complete booking without handoff/pickup | Menunggu penjemputan in active work; real AWB shown; no claim that goods have been handed over or delivered; confirm actual physical handoff before recording it | 02, 03, 04 |
| AC12 | Record physical handoff, no scan or WAITING | Diserahkan ke kurir with waiting guidance in Monitoring; also discoverable in existing pending-evidence shipment follow-up; no failure/lateness/SLA verdict or invented pickup | 02, 03, 05; existing list() |
| AC13 | Verified PICKED_UP/ON_DELIVERY without manual handoff stamp | Dibawa kurir / Dalam pengiriman in Monitoring; actual courier source visible; absent manual stamp remains inspectable, not a required backfill or packing task | 02, 03, 04 |
| AC14 | Verified matching DELIVERED without scans, handoff timestamp or POD | Barang diterima and completed/paid; Selesai history, no active/open follow-up or manual completion requirement; missing values visibly unavailable | 02, 03, 04, 05 |
| AC15 | Inspect timeline with event time absent but receipt time known | Show actual source and separately labelled receipt time; no fabricated event time, completed progress milestone or normal activity from ignored receipts | 04, 05 |
| AC16 | Checkout shipping 20,000; booking 25,000; no courier bill | Show three distinct values, bill unavailable rather than zero; differences do not increase customer payment or block fulfillment; expandable cost differences/diagnostics | 04 |
| AC17 | Report one of three supported packing failures before dispatch, including damage after readiness | Visible precise blocker and existing packing follow-up; processing/paid retained; normal fulfillment blocked; no resume/refund/replacement action; explain external resolution and commercial non-effects | 02, 05 |
| AC18 | Stable booking_unknown with no complete current-attempt proof | Booking belum pasti; no ordinary retry; proof form cannot submit without reference, reason, correct attempt and both acknowledgements; timeout/404/empty result/elapsed time insufficient | 02, 05 |
| AC19 | Explicit Jubelio absence/operation-closure proof for current unknown attempt; release | Release records proof and returns ledger to packed without provider create; fresh detail shows released-state Barang siap; next booking requires separate full review/approval; old proof cannot release a later attempt | 02, 05 |
| AC20 | Outstanding booking_dispatched, even after elapsed time | Menunggu hasil booking; no proof-release or rebooking control; no timer-based eligibility or lookup/adoption recovery promise | 02, 05 |
| AC21 | Applicable pre-completion RETURNED/SHIPMENT_ISSUE | Visible approved issue label/guidance and existing follow-up; no inferred physical return receipt, refund or stock action; manual finish only under all existing guards | 02, 03, 05 |
| AC22 | Applicable pre-completion ON_HOLD/CANCELED alone | Monitoring warning with approved wording; no new follow-up case or manual-finish eligibility solely from status; shipment cancellation is not order cancellation | 02, 03, 05 |
| AC23 | Eligible manual finish chosen with complete booked ledger plus supported issue/physical evidence | Separate special handling; nonblank reason and full consequence confirmation; completed/paid with Selesai manual; no DELIVERED/POD, refund, stock adjustment, SO cancellation or automatic communication | 05 |
| AC24 | AWB alone, settlement block, packing failure or unknown booking | These conditions do not permit manual finish; unavailable controls cannot bypass server rejection | 05 |
| AC25 | Late issue/progress/evidence after verified delivery or manual closure | Remains terminal and out of active/open follow-up; distinct completion copy retained; safe enrichment only under existing tracking rules; ignored receipts remain diagnostic | 02, 03, 05 |
| AC26 | Authorized view but missing edit, missing Home Branch or Jakarta Home viewing Bandung | Truthful operational stage and applicable specific verified reasons; no normal/special mutation buttons or provider refresh; visible evidence/read reload remain within view access | 01, 03, 05 |
| AC27 | View access valid but current action eligibility cannot be established | Kelayakan tindakan belum dapat dipastikan.; offer detail reload, no mutations or guessed Home Branch denial | 05 |
| AC28 | Booking write followed by failed detail reload | Local stale-result explanation; never equate failed read with failed write or enable another booking from stale state; reread before next action | 04, 05 |
| AC29 | Concurrent client changes order; server rejects stale submission | Kondisi order telah berubah.; detail reload offered, no automatic write retry; fresh state determines next available action | 04, 05 |
| AC30 | Compare Muat ulang detail and Perbarui tracking | First reads application detail only; second uses existing authorized known-AWB reconciliation, not booking; read-only viewers cannot invoke guarded refresh; no polling introduced | 04, 05 |
| AC31 | Current protected view policy unavailable | Existing fail-closed navigation/data hiding; do not retain protected order detail as a read-only fallback | 05 |
| AC32 | Compare list, follow-up summary and reopened detail for identical evidence | Same approved stage and safe-next-step meaning; row controls navigate only; blockers remain visible outside collapsed diagnostics; no duplicate independent case source | 01–05 |
| AC33 | Inspect customer-facing payload after manual completion and cost/evidence enrichment | Existing privacy boundary preserved: internal reasons, actor IDs, provider diagnostics and booking/billing costs do not leak into customer DTOs | 04, 05; existing DTO boundaries |

## 4. Verification seams investigated, not executed

Existing public-seam coverage to preserve/extend:

- [Admin booking mock E2E](../../../e2e/admin/shipment-booking-mock.spec.ts): packing/booking, AWB/costs, authorization, concurrency and ambiguous outcomes.
- [Admin follow-up mock E2E](../../../e2e/admin/delivery-follow-up-mock.spec.ts): scoped/filterable follow-up, read-only controls, packing failure, proof-release without automatic create and manual finish.
- [Tracking mock E2E](../../../e2e/store/shipment-tracking-mock.spec.ts): handoff, guarded reconciliation, signed completion, customer privacy and late evidence.
- [Delivery order mock E2E](../../../e2e/store/delivery-order-mock.spec.ts): immutable order data and payment/settlement prerequisites.
- Existing [follow-up service](../../../apps/admin/src/lib/delivery-follow-up.ts) exposes `list`, `failPacking`, `releaseBooking` and `finishManually`; its database test seam and booking/tracking public seams support guard/effect verification.

Future implementation needs deterministic unit/public-service tests for shared evidence projection and authorized queue filtering/counting, plus admin Playwright coverage for AC01–AC32's visible behavior. Existing store specs provide regression coverage, not permission for storefront redesign. Mock UI tests alone do not prove server authorization or provider side effects; retain database/service concurrency and no-create checks. Write failing tests before each implementation slice; main agent owns execution. No live-provider writes are required.

## 5. Exclusions and remaining engineering work

No assignment, SLA, automatic escalation, persisted checklist, new case criteria, blind retry, automatic booking/release, provider search/adoption, refund, cancellation, replacement, return-stock action, reopening, new customer communication, storefront redesign, polling/cron, live-provider activation, deployment, commits or delegation.

No further owner-owned product uncertainty was found. Remaining implementation design includes safe list/detail policy/evidence projection, query/filter/count integration, reliable activity projection and responsive spacing. These are agent investigation/design responsibilities within the approved contract, not permission to invent behavior. Any newly discovered product conflict must stop the affected work for owner decision.

After shared-understanding confirmation, the [complete reviewable specification](../../../plan/admin-delivery-workflow-spec.md) was drafted under `plan/`. It remains Draft until explicit complete-spec approval. Implementation-ticket breakdown/publication requires separate approval. This matrix and ticket resolution do not pass either gate.
