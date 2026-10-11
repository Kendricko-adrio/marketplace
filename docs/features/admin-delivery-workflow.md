# Guided admin delivery workflow

## Navigation and work discovery

Login still lands on Dashboard. **Orders** opens **Delivery / Perlu dikerjakan**. The **Pickup** tab retains order-status/pickup-date filtering and verification; **Semua** provides general order search/history. Delivery work is selected with one dropdown; **Tindak lanjut** opens the existing follow-up area, not a second case ledger. The sidebar highlights only the most-specific visible route, using path-segment boundaries: Review Jubelio activates its own menu, while ordinary order detail/follow-up routes retain Pesanan.

| Work view | Evidence-based membership |
|---|---|
| Perlu dikerjakan | Verified settled, unblocked processing/paid delivery with a valid snapshot: unpacked, packed, or known booking awaiting physical handoff/courier progress |
| Monitoring | Eligible known booking with recorded handoff or verified PICKED_UP/ON_DELIVERY; ON_HOLD/CANCELED remain visible with warnings |
| Tindak lanjut | Existing settlement, packing, booking and shipment case source; its original criteria/precedence remain authoritative |
| Selesai | Verified arrival or recorded manual completion, labelled distinctly |
| Semua delivery | Authorized delivery history, including unpaid, blocked and completed orders |

Membership describes order evidence, not this viewer's mutation authority. Monitoring and follow-up can overlap: recorded handoff without courier progress already meets the existing pending-evidence shipment case condition. Missing scans do not mean failure, lateness or an SLA violation. ON_HOLD/CANCELED alone create no additional case or manual-close eligibility.

**Tahap delivery** is a separate single-select filter, initially **Semua tahap**. It exposes all approved business labels, not only stages present on the current page. Ordinary ready goods and a proof-released booking both match **Barang siap**.

Queue, stage, server-authorized Branch Scope, optional branch, search and creation dates intersect **before pagination**. For example, Monitoring + Siapkan barang stays selected and shows an explicit empty state; the system does not pull preparation orders into Monitoring. All views default to **no creation-date restriction**, oldest-created-first with stable ID ties, and **20 rows per page**. Order creation age is not stage age.

Optional dates show their range and a narrowing warning. Counts show matching results and the authorized no-date base, keeping every other filter unchanged. For 40 same-stage base results with 12 inside the date range, the UI shows **12 hasil dari 40 tanpa batas tanggal**, not the length of the loaded page. Filter changes reset page one; invalid later pages clamp to the last available page. Contextual detail/follow-up links carry a local `returnTo` URL so Back restores the preceding queue, stage, filters and valid page.

Compact rows show reference/date, customer, origin branch, payment, stage, next step and detail navigation. Orders uses the shared admin Table primitives, matching Products/Users header colours, cell spacing, row borders and hover treatment rather than a custom dark header. This is table presentation only: columns, filters, queries, pagination and actions are unchanged. Rows never mutate delivery state. Wide tables scroll inside their container on small screens; the admin shell stacks, guidance wraps, and status is not colour-only.

## Shared evidence and safe access

List, follow-up and detail use `apps/admin/src/lib/delivery-workflow.ts` for stage/guidance. Payment remains separate from physical progress. The prominent **Langkah berikutnya** panel persists when waiting, blocked or completed.

| Evidence | Stage | Persistent guidance |
|---|---|---|
| Unpaid | Menunggu pembayaran | Tunggu pembayaran pelanggan. |
| Explicit authoritative verification pending | Verifikasi pembayaran | Tunggu verifikasi pembayaran. |
| Paid, settlement unverified/blocked | Verifikasi tertunda | Pembayaran diterima. Tunggu verifikasi Jubelio. |
| Settled, unpacked | Siapkan barang | Siapkan barang, lalu tandai siap. |
| Packed | Barang siap | Barang siap. Pesan pengiriman. |
| Known booking, no handoff/progress | Menunggu penjemputan | Tunggu kurir. Catat serah terima setelah barang diserahkan. |
| Recorded handoff, no courier progress | Diserahkan ke kurir | Barang diserahkan. Tunggu update kurir. |
| Verified PICKED_UP | Dibawa kurir | Barang dibawa kurir. Pantau pengiriman. |
| Verified ON_DELIVERY | Dalam pengiriman | Barang dalam pengiriman. Pantau pengiriman. |
| Verified DELIVERED | Barang diterima | Barang telah diterima. Pengiriman selesai. |
| Recorded manual completion | Selesai manual | Order ditutup manual. |
| booking_dispatched | Menunggu hasil booking | Hasil booking belum tersedia. Jangan pesan ulang. |
| booking_unknown | Booking belum pasti | Konfirmasi ke Jubelio. Jangan pesan ulang. |
| Proven unknown booking released | Barang siap | Booking sebelumnya tidak terbentuk. Pesan pengiriman. |
| physical_stock_unavailable | Stok tidak tersedia | Stok tidak tersedia. Tindak lanjuti di luar aplikasi. |
| damaged_goods | Barang rusak | Barang rusak. Tindak lanjuti di luar aplikasi. |
| paid_service_limits_exceeded | Batas layanan terlampaui | Paket melebihi batas layanan. Tindak lanjuti di luar aplikasi. |
| Pre-completion ON_HOLD | Pengiriman tertahan | Pengiriman tertahan. Konfirmasi ke kurir. |
| Pre-completion RETURNED | Barang dikembalikan | Kurir melaporkan pengembalian. Tindak lanjuti kendala. |
| Pre-completion CANCELED | Pengiriman dibatalkan | Pengiriman dibatalkan kurir. Tindak lanjuti kendala. |
| Pre-completion SHIPMENT_ISSUE | Kendala pengiriman | Pengiriman bermasalah. Konfirmasi ke kurir. |

Shipment cancellation is not order cancellation. A terminal lifecycle without arrival/manual evidence is labelled **Order tidak aktif**, not fabricated arrival. Courier pickup/transit takes precedence over an absent manual handoff; verified arrival needs neither intermediate scans nor POD. Manual closure remains manual even after late observations.

Settlement interpretation is shared with the existing packing guard (`delivery-settlement.ts`): IDs alone do not prove verification; invoice/payment ledgers must be confirmed and match, with no active cancellation. The projection supports Verifikasi pembayaran only when explicitly supplied authoritative pending-verification evidence. The current Midtrans deferred path does **not** persist that evidence, so ordinary pending orders remain Menunggu pembayaran. No new payment state, schema or provider lookup is introduced.

The detail GET adds `workflow.stage`, `workflow.access`, `workflow.eligibility`, `workflow.tracking` and `workflow.special`. Current server-resolved orders edit permission and Home Branch restrictions are independent of orders view Branch Scope. Verified missing edit permission, absent Home Branch and Home Branch mismatch are explained specifically, together where applicable. Authorized viewers retain truthful evidence but receive no unauthorized fulfillment/special/provider-refresh controls.

Preflights reuse the existing fulfillment, tracking and special-action guards in read-only transactions. They do not change a ledger or contact a provider. This is a presentation hint, **not a write authorization token**: actual mutations recheck current server state and complete guards. `actor.allowed`, generic processing/paid status and ID presence never independently grant buttons.

When action eligibility is unknown, hide writes and show **Kelayakan tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan.** Unavailable current view policy instead hides protected navigation/data under the existing fail-closed policy; it is not a read-only fallback.

## Guided normal actions

At most one normal primary fulfillment action is available. Exceptional mutations are separated under **Penanganan khusus**.

- **Tandai siap:** advisory inspection of goods, quantity, condition and packaging; a short confirmation explicitly says shipment is not booked. No stored checklist. Result toast: **Barang ditandai siap.**
- **Pesan pengiriman:** review frozen goods, recipient/phone, full destination, courier/service and checkout shipping. The review dialog separates goods and destination into labelled bordered sections, places courier/service beside an emphasized checkout shipping amount (stacked on small screens), and groups booking cautions in an amber note. Item variants and quantity badges remain distinct; a divider separates the action footer. The dialog has mobile side gutters and contained scrolling. Opening or dismissing it does not submit a booking. Confirmation sends the existing provider request; booking does not imply handoff. Duplicate submissions are latched/disabled. Only a known booked result receives **Pengiriman berhasil dipesan.** Ambiguity never receives a success toast or blind retry.
- **Catat serah terima:** review known service/AWB and confirm actual physical transfer. No new persisted checkbox; handoff is not customer receipt. Result toast: **Serah terima dicatat.**

Results belong in toasts; next steps belong in the persistent panel after a fresh detail read. A conflict shows **Kondisi order telah berubah. Muat ulang detail sebelum melanjutkan.** A failed post-action read shows **Detail belum berhasil diperbarui. Muat ulang detail untuk memastikan hasil.** It does not declare the preceding write failed and does not re-enable writes. No automatic write retry is introduced. Dialogs have accessible titles, dismissal, contained scrolling and focus restoration.

**Muat ulang detail** reads latest application state. **Perbarui tracking** separately runs the existing authorized known-AWB reconciliation; it does not create a shipment or introduce polling. Read-only viewers can retain safe links but do not gain provider-refresh authority.

## Special handling and commercial non-effects

- **Settlement blocked:** packing/booking and force-verification are unavailable. Coordinate with Jubelio support; do not ask the customer to pay again solely because of the blocker. Recovery stays the existing system-only process.
- **Packing failure:** only physical_stock_unavailable, damaged_goods and paid_service_limits_exceeded, under existing pre-dispatch guards (including damage after readiness). Confirmation explains fulfillment blocking while order stays processing/paid. It performs no refund, SO cancellation, stock reversal or automatic communication. Result: **Kendala barang dicatat.** Business resolution/customer coordination remain outside the app; there is no resume/replacement/re-quote shortcut.
- **Outstanding dispatch:** no release, retry, timer-based recovery or shipment adoption. Coordinate externally while the result remains unrecorded.
- **Stable unknown booking:** release requires the current attempt, nonblank reference/reason and two initially unchecked acknowledgements: Jubelio confirmed **no booking formed** and **the original operation is closed**. Timeout, 404, empty lookup and elapsed time are not proof. If unknown or a booking exists, keep the hold and coordinate externally.
- **Proof-release:** the existing atomic release archives proof/request evidence, returns to packed and preserves monotonic attempts. It sends **zero provider create requests**. After a fresh detail read, any new booking needs a separate complete review/approval. Stale/repeated proof cannot release another attempt. Result: **Tahanan booking dilepas.**
- **RETURNED/SHIPMENT_ISSUE and pending evidence:** investigate externally. Manual finish is available only under the complete existing booked-ledger/settlement/authorization/evidence guards. ON_HOLD/CANCELED alone do not expand eligibility.
- **Manual finish:** mandatory nonblank reason and full confirmation. It completes the order while remaining paid, but confirms no customer receipt, creates no DELIVERED/POD, refund, stock adjustment, SO cancellation or automatic communication. Result: **Order ditutup manual.** The reason/actor/time remain admin-only. Terminal outcomes stay outside active work/open follow-up; late evidence never reopens them.

Operational authority remains [delivery fulfillment](delivery-fulfillment.md), [tracking](delivery-tracking.md) and [follow-up](delivery-follow-up.md), not the presentation projection.

## Evidence, activity and money

Readiness, booking, handoff, failure and manual-close facts use actual admin actor/time fields. Applied courier receipts identify their source and distinguish **Waktu kejadian** from **Update diterima sistem**. Missing event time, handoff, AWB, links or POD says Belum tersedia/Belum tercatat. Ignored receipts belong in diagnostics, not normal activity; no progress or mandatory backfill is invented. Tracking/POD links accept only HTTP(S).

Show **Ongkir checkout**, **Biaya booking** and **Tagihan courier** separately, with expandable differences. For example, checkout Rp20,000 and booking Rp25,000 with no courier bill displays both actual values and **Belum ada tagihan**, not Rp0. The Rp5,000 difference is internal: it neither raises customer payment nor blocks fulfillment. Goods/destination/service retain existing immutable snapshot rules. Customer DTOs continue excluding internal costs, reasons, actors and diagnostics.

## Read API and implementation seams

- `GET /api/admin/orders?fulfillment=delivery&queue=actionable|monitoring|completed|all&stage=<exact label>&page=1`, plus optional `branchId`, `search`, `from`, `to` (YYYY-MM-DD). Invalid delivery queue/stage/date filters return 400. Own scope remains pinned server-side even with a branchId parameter. Delivery rows include `{id,createdAt,status,paymentStatus,total,fulfillmentMethod,customer,branch,stage}`; pagination adds `baseTotal` alongside page/limit/total/totalPages.
- `fulfillment=pickup` preserves status/pickup-date filters; omitted fulfillment retains general history. Lists use ascending creation/ID ordering and fixed 20-row pages.
- `GET /api/admin/orders/follow-up` retains kind filtering and existing case membership, adding stage/branch/search/creation-date filters and the same pagination/count semantics. It serves projected stage/guidance on the existing safe case summaries.
- `GET /api/admin/orders/{id}` remains orders:view + Branch Scope (cross-scope IDs remain 404). See [API reference](../api-reference.md#admin--delivery-workflow-projection).

`delivery-work-list.ts` loads authorized delivery evidence/settlement rows in a read-only repeatable-read transaction, then intersects projection/queue/stage/date filters and totals on the server before slicing pages. It currently materializes the scoped result set rather than pushing the projection into SQL; no client-page filtering is used. Fulfillment/tracking/follow-up preflight methods reuse their mutation guard predicates without effects. Backend routes retain structured success/failure logs.

No schema, environment variable, deployment endpoint, cron, provider-write activation or infrastructure change is part of this workflow.

## Verification seams

- `apps/admin/src/lib/delivery-workflow.test.ts`: independent stage/access expectations.
- `apps/admin/src/lib/shipment-fulfillment.db.test.ts`: authorization, settlement, read-only preflight, at-most-once booking; scoped queue/filter/count scenario with 40 orders, stable 20-row pages and 12/40 dated results.
- `apps/admin/src/lib/delivery-follow-up.db.test.ts`: scope, all packing reasons/non-effects, current-attempt release/concurrency, complete manual-finish guards.
- `packages/db/src/shipment-tracking.test.ts`: authorization, monotonic/terminal evidence, missing POD and safe enrichment.
- `e2e/admin/delivery-workflow.spec.ts`, `delivery-queues.spec.ts`, `delivery-actions.spec.ts`: visible guidance/access/filter intersections/restoration, confirmations, stale safety, keyboard focus and mobile layout. HTTP presentation fixtures do not prove backend effects.
- Existing shipment-booking/follow-up mock browser journeys verify real service effects with controlled providers; store pickup/delivery/tracking mock specs retain commercial/privacy regression coverage.

Execution results and any suite-wide blockers belong in the implementation effort's verification record, not this enduring behavior contract.
