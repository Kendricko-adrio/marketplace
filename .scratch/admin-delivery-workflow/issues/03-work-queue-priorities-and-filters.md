# Work Queue Priorities and Filters

Label: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: none (01 and 02 resolved)
Parent: [Guided Admin Delivery Workflow](../map.md)

## Question

Given the selected navigation and stage language, which queue categories, row information, filter defaults, ordering, and contextual navigation make branch work easiest to find without hiding unfinished orders?

Decide:

- How approved stages map to actionable work, follow-up, monitoring, completed history, and pending payment.
- Whether physically handed-over shipments awaiting electronic evidence belong to monitoring, without labeling them late or failed.
- Date-filter defaults and visible warnings when filters narrow active work.
- Oldest-first or another ordering supported by existing facts, without a new SLA policy.
- Essential row columns and secondary information.
- Contextual row navigation versus generic detail navigation.
- Scope-aware totals, pagination expectations, and consistent list/detail meaning.

## Evidence and constraints

- [Proposal](../../../plan/admin-delivery-workflow-proposal.md), operations queue recommendations.
- [Orders UI](../../../apps/admin/src/app/admin/orders/page.tsx), including today's default date range.
- [Orders API](../../../apps/admin/src/app/api/admin/orders/route.ts).
- [Follow-up service](../../../apps/admin/src/lib/delivery-follow-up.ts).

The current list has order/customer/branch data without shipment evidence joined into its query. Scope-aware queue filtering/counting cannot be inferred from a single client page. Row actions should not silently execute physical/provider mutations. Additional case types, assignment, and SLA are out of scope.

## Approved decisions

- Default date scope: no date filter for all queues and history, including pending-payment and completed orders. Authorization/branch scope and the selected queue still apply; this does not combine all stages into every queue.
- Default ordering: order creation time ascending (oldest-created orders first), not stage age. This ordering does not introduce an SLA or imply that older orders are late.
- Optional manual filters on order creation date remain available. Applied filters show the selected date range and a warning that orders outside that range are not displayed. Their exact count semantics remain unresolved.
- Normal queue membership: eligible unpacked (`Siapkan barang`), packed (`Barang siap`), and booked without handoff/pickup evidence (`Menunggu penjemputan`) belong to actionable work. Recorded handoff without a scan, verified pickup, and normal transit belong to monitoring. Verified delivery and valid manual completion belong to completed history, with distinct outcome labels.
- Essential row information: order reference/creation date, customer, branch, payment, stage, next step or blocker, and navigation. Service and destination are not required queue columns.
- Row navigation is contextual and opens the relevant detail section; it never performs a mutation or adds buttons to the text-only guidance approved in ticket 02.
- Blockers are separate from normal actionable work and use the existing follow-up area/source: blocked settlement, packing failures, held booking (`booking_dispatched`/`booking_unknown`), and applicable pre-completion `RETURNED`/`SHIPMENT_ISSUE`.
- `Menunggu pembayaran` and `Verifikasi pembayaran` appear in all-delivery search, not actionable work or courier monitoring. No dedicated pending-payment dropdown choice is added.
- Applicable pre-completion `ON_HOLD`/`CANCELED` remain discoverable in monitoring with the approved issue labels/guidance and a visible warning. They are not presented as normal transit and do not create new follow-up case types.
- Add a `Selesai` dropdown filter containing verified delivery and valid manual completion. Both outcomes also remain searchable in all delivery, with distinct labels.
- Pagination uses 20 orders per page, with oldest-created ordering across pages, not page-local sorting.
- When a date filter is applied, show matching results alongside the total for the same authorized scope, queue, and other filters with only the date restriction removed (for example, 12 matching results out of 40). Never use the loaded page length as the total.
- The owner explicitly confirmed these decisions through `ask_user_question`. The owner subsequently approved the complete resolution below and authorized marking this ticket resolved. Prerequisites 01 and 02 have been verified as resolved.

## Resolution evidence

Record the approved queue membership/defaults and an example list with at least: an unfinished order from yesterday, an eligible paid order, a packed order, a booking hold, a handed-over shipment without a scan, an in-transit order, and two distinct completed outcomes.

Specify what branch staff and scope-authorized all-branch viewers see, what each row action does, and how applied date filters affect counts/results. Distinguish order age from stage age where stage timestamps are unavailable.

## Answer — owner-approved complete resolution

### Queue and navigation contract

Keep the approved Orders navigation: default Delivery / `Perlu dikerjakan`, with Pickup and Semua still available. The Delivery work dropdown exposes actionable work, access to existing follow-up, monitoring, `Selesai`, and `Semua delivery`. Returning from detail/follow-up restores the preceding list and applied filters. Follow-up remains the single existing case source, not an independent new exception queue.

All queues and history default to no order-date restriction and creation-time ascending. Older orders are not automatically late. Use creation time as order age; show stage age only where reliable stage evidence exists, never inferred from generic update time. Exact same-time ordering must remain stable for pagination without implying a new operational priority.

Essential row information is reference/creation date, customer, origin branch, payment, approved stage, next step/blocker, and contextual navigation. Service/destination and other detailed evidence are secondary detail information, not required queue columns. Guidance wording follows ticket 02 in list and detail. Navigation only opens the relevant detail section, retaining the existing action authorization/eligibility checks.

### Required example list

Illustrative orders are all within the viewer's authorized scope. The IDs and relative dates below are examples, not live records or an SLA.

| Order / evidence | Membership | Stage / next step | Contextual navigation destination |
|---|---|---|---|
| A101, created yesterday, eligible and still unpacked | Perlu dikerjakan; Semua delivery | Siapkan barang / Siapkan barang, lalu tandai siap. | Goods/preparation section |
| A102, created today, paid and fully eligible, unpacked | Perlu dikerjakan; Semua delivery | Siapkan barang / Siapkan barang, lalu tandai siap. | Goods/preparation section |
| A103, packed, booking available | Perlu dikerjakan; Semua delivery | Barang siap / Barang siap. Pesan pengiriman. | Shipment booking review section |
| A104, stable booking_unknown | Existing follow-up; Semua delivery | Booking belum pasti / Konfirmasi ke Jubelio. Jangan pesan ulang. | Booking blocker/evidence section; existing follow-up remains accessible |
| A105, recorded handoff, no courier scan | Monitoring; Semua delivery | Diserahkan ke kurir / Barang diserahkan. Tunggu update kurir. | Handoff/tracking evidence section; no late/failure claim |
| A106, verified ON_DELIVERY | Monitoring; Semua delivery | Dalam pengiriman / Barang dalam pengiriman. Pantau pengiriman. | Tracking section |
| A107, verified DELIVERED | Selesai; Semua delivery | Barang diterima / Barang telah diterima. Pengiriman selesai. | Completion/history section |
| A108, valid manual completion | Selesai; Semua delivery | Selesai manual / Order ditutup manual. | Manual outcome/history section; no invented DELIVERED/POD |
| A109, known booking without handoff or pickup evidence | Perlu dikerjakan; Semua delivery | Menunggu penjemputan / Tunggu kurir. Catat serah terima setelah barang diserahkan. | Handoff section |
| A110, pending payment | Semua delivery only | Menunggu pembayaran / Tunggu pembayaran pelanggan. | Payment section |
| A111, applicable pre-completion ON_HOLD | Monitoring with warning; Semua delivery | Pengiriman tertahan / Pengiriman tertahan. Konfirmasi ke kurir. | Tracking issue/evidence section; no new follow-up case |
| A112, applicable pre-completion CANCELED | Monitoring with warning; Semua delivery | Pengiriman dibatalkan / Pengiriman dibatalkan kurir. Tindak lanjuti kendala. | Tracking issue/evidence section; not order cancellation or a new follow-up case |

Within actionable work, A101 appears before A102 because its creation date is older. Other rows follow their actual creation dates, not the illustrative reference number. Blockers are excluded from normal actionable work; completed orders stay out of active/follow-up/monitoring queues. Pending authoritative verification follows the same all-delivery-only placement as pending payment.

### Scope, counts, and filters

- A branch staff member sees only orders permitted by existing Branch Scope. An authorized all-branch viewer uses the same queue/navigation but may see multiple permitted origin branches; the origin-branch column remains visible. Existing branch-scope defaults do not change.
- Visibility is not mutation permission. An all-branch viewer may open another branch's relevant detail section, but existing Home Branch and edit-permission restrictions remain enforced and explained. Queue membership reflects order evidence, not whether this viewer can act.
- Counts and membership apply authorized scope and filters before pagination. With 40 authorized orders in the selected queue and 12 matching an applied creation-date range, show 12 results out of 40, not the length of the current page. Keep a visible date range and narrowing warning. Clear the date filter to restore all 40; unauthorized orders never contribute to either total.
- Pages contain up to 20 results. Filtering must not leave the viewer stranded on an empty later page; return to the first results page. Returning from detail restores the previous queue/filter/page where still valid.
- A date filter does not change an order's stage or queue eligibility. An unfinished order from yesterday remains in the unfiltered active queue, even if a manually applied today-only range hides it.

### Non-scope and approval

No application/query implementation, new SLA/assignment/case types, database lifecycle changes, automatic mutations, invented stage timestamps, or changed authorization is included. No tests are needed or claimed for these planning-only edits. Approval of this complete ticket resolves a product decision only; it does not approve implementation or the complete parent specification.

## Work boundaries

Load the resolved prerequisite answers only as needed, plus `grilling`, `domain-modeling`, and `development-workflow`. Claim only when prerequisites are resolved. Planning-document edits only; no query implementation or invented timestamp/SLA semantics.

## Comments

Published after explicit owner approval of the complete map structure. Dependencies are added after all child files exist. Claimed for the owner interview in the current session after verifying prerequisites 01 and 02 are resolved. After dependency-aware question rounds, the owner explicitly selected `Setujui resolution` through `ask_user_question`, approving the complete resolution and marking this ticket resolved. No implementation is authorized.
