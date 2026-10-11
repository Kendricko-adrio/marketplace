# Delivery Stage Language and Next-Step Guidance

Label: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: none
Parent: [Guided Admin Delivery Workflow](../map.md)

## Question

What business-readable stage labels, evidence descriptions, and next-step instructions should the admin see throughout the existing delivery lifecycle, including blocked and completed outcomes?

Decide a shared presentation vocabulary for list and detail:

- UI language and consistent operational terms.
- Separate payment confirmation, fulfillment eligibility, physical preparation, booking, handoff, courier progress, and arrival.
- The label/instruction associated with each supported normal state and blocker.
- Representation of missing intermediate evidence, versus a task genuinely not yet performed.
- The distinction between verified arrival and manual completion.

## Evidence and constraints

- [Proposal](../../../plan/admin-delivery-workflow-proposal.md), end-to-end example and evidence summary.
- [Delivery orders](../../../docs/features/delivery-orders.md), [fulfillment](../../../docs/features/delivery-fulfillment.md), [tracking](../../../docs/features/delivery-tracking.md), [follow-up](../../../docs/features/delivery-follow-up.md).
- [Detail UI](../../../apps/admin/src/app/admin/orders/[id]/page.tsx).
- [Administration glossary](../../../CONTEXT.md).

Keep current lifecycle semantics: payment alone does not grant packing; `processing` spans multiple physical stages; AWB is not handoff; handoff is not delivery; manual closure does not invent `DELIVERED`. No database enum redesign is implied by clearer labels.

## Resolution evidence

Record an owner-approved scenario table with input evidence, stage label, next-step instruction, and whether a normal physical action exists. Include:

- Payment pending verification and paid-but-blocked settlement.
- Eligible unpacked, packed, and known booked order.
- Recorded physical handoff without courier scan.
- Courier pickup/transit without a manual handoff stamp.
- Stable unknown booking versus outstanding dispatch.
- Verified `DELIVERED` with missing intermediate scans/POD.
- Manual completion.

Capture terminology as domain language where appropriate; keep implementation rules out of `CONTEXT.md`. Queue categorization and component layout remain later decisions.

## Work boundaries

Read-only investigation and owner interview; planning/glossary edits only. Load `grilling`, `domain-modeling`, and `development-workflow`. Claim before working. Do not invent timestamps, infer full eligibility from ID presence, or answer for the owner.

## Comments

Published after explicit owner approval of the complete map structure.

Claimed for the owner interview in the current session. Owner-confirmed direction so far: concise action-result and next-step guidance; persistent guidance on order detail with action-confirmation toasts; primary actions, failures and blockers included; text only without additional action buttons; waiting and terminal outcomes remain visible. The owner subsequently approved the complete scenario wording table and result-only success toasts through `ask_user_question`. No implementation is authorized.

## Answer

### Owner-approved presentation contract

The primary goal is concise guidance after an admin action: acknowledge the result and make the next step clear. Persistent detail guidance follows current evidence, not the last admin action. It remains visible for waiting and completed outcomes and when the detail is reopened.

- UI copy is Indonesian. The approved operational vocabulary includes “siapkan barang”, “pesan pengiriman”, and “serah terima”. These are presentation phrases, not new lifecycle entities or operational policies.
- Cover primary actions, failures and blockers. Guidance is text only, with no additional action buttons.
- Success toasts state the action result only; next-step instructions remain in the detail. Example: toast “Barang ditandai siap.” and detail “Barang siap. Pesan pengiriman.”
- Labels and guidance use the shared vocabulary below; list/detail component placement remains a later decision.
- Do not instruct packing before full existing eligibility, booking retry during ambiguity, or mandatory backfill of missing intermediate evidence.
- Failure messages must describe the actual outcome. A dispatched or ambiguous booking is not a safe “try again” failure. The table's booking warning remains applicable.

### Approved scenario table

“Physical action” identifies a normal next physical step, not permission for the viewing admin to perform it. Existing server eligibility and Home Branch authorization remain unchanged. State rows assume the relevant matching evidence and existing guards, not merely identifier presence.

| Input evidence / condition | Stage label | Persistent guidance | Normal next physical action |
|---|---|---|---|
| Payment not yet received | Menunggu pembayaran | Tunggu pembayaran pelanggan. | No; wait for payment. |
| Payment pending authoritative verification | Verifikasi pembayaran | Tunggu verifikasi pembayaran. | No; wait for verification. |
| Paid, but Jubelio settlement verification remains blocked | Verifikasi tertunda | Pembayaran diterima. Tunggu verifikasi Jubelio. | No; packing remains blocked. |
| Fully eligible delivery, not yet packed | Siapkan barang | Siapkan barang, lalu tandai siap. | Yes; prepare the goods, then record readiness. |
| Packing recorded, booking available | Barang siap | Barang siap. Pesan pengiriman. | No new physical step; booking is the next system action. |
| Known successful booking, no handoff or courier pickup evidence | Menunggu penjemputan | Tunggu kurir. Catat serah terima setelah barang diserahkan. | Yes when pickup occurs; physically hand over, then record it. |
| Physical handoff recorded, no courier progress | Diserahkan ke kurir | Barang diserahkan. Tunggu update kurir. | No; await courier evidence. |
| Verified courier PICKED_UP, including absent manual handoff stamp | Dibawa kurir | Barang dibawa kurir. Pantau pengiriman. | No; monitor progress. |
| Verified courier ON_DELIVERY, including absent manual handoff stamp | Dalam pengiriman | Barang dalam pengiriman. Pantau pengiriman. | No; monitor progress. |
| Verified DELIVERED, including missing intermediate scans, handoff stamp or POD | Barang diterima | Barang telah diterima. Pengiriman selesai. | No; completed. |
| Valid manual completion recorded | Selesai manual | Order ditutup manual. | No; terminal manual outcome, not invented arrival. |
| Durable booking_dispatched, result not recorded | Menunggu hasil booking | Hasil booking belum tersedia. Jangan pesan ulang. | No; held, not retryable or proof-releasable through the unknown-booking action. |
| Stable booking_unknown | Booking belum pasti | Konfirmasi ke Jubelio. Jangan pesan ulang. | No; obtain the existing required provider confirmation before any release. |
| Previous unknown booking released using required proof of absence and closed operation | Barang siap | Booking sebelumnya tidak terbentuk. Pesan pengiriman. | No new physical step; a separate booking approval is available. |
| Recorded physical_stock_unavailable packing failure | Stok tidak tersedia | Stok tidak tersedia. Tindak lanjuti di luar aplikasi. | No supported normal fulfillment action; external resolution. |
| Recorded damaged_goods packing failure | Barang rusak | Barang rusak. Tindak lanjuti di luar aplikasi. | No supported normal fulfillment action; external resolution. |
| Recorded paid_service_limits_exceeded packing failure | Batas layanan terlampaui | Paket melebihi batas layanan. Tindak lanjuti di luar aplikasi. | No supported normal fulfillment action; external resolution. |
| Applicable pre-completion ON_HOLD courier evidence | Pengiriman tertahan | Pengiriman tertahan. Konfirmasi ke kurir. | No normal physical instruction; investigate. |
| Applicable pre-completion RETURNED courier evidence | Barang dikembalikan | Kurir melaporkan pengembalian. Tindak lanjuti kendala. | No normal physical instruction; do not invent return receipt or stock handling. |
| Applicable pre-completion CANCELED courier evidence | Pengiriman dibatalkan | Pengiriman dibatalkan kurir. Tindak lanjuti kendala. | No normal physical instruction; shipment cancellation is not order cancellation. |
| Applicable pre-completion SHIPMENT_ISSUE courier evidence | Kendala pengiriman | Pengiriman bermasalah. Konfirmasi ke kurir. | No normal physical instruction; investigate. |

### Evidence and boundaries

Courier pickup/transit evidence takes precedence over an absent manual handoff stamp in the main guidance. Missing handoff evidence remains inspectable separately; it is not a mandatory next task. Verified DELIVERED remains completed despite absent intermediate scans or POD. Manual completion stays explicitly distinct from verified arrival.

No new database enums, operational eligibility, assignment/SLA, automatic booking, refund, order cancellation, return-stock action, polling, or customer communication feature is approved. Layout, queue categorization and exact evidence placement belong to later tickets. No new domain glossary entity was introduced; UI wording and implementation rules are intentionally not added to `CONTEXT.md`.

### Approval and verification

The owner approved the full scenario table (“Setujui tabel”) and result-only success toasts (“Hasil saja”) through `ask_user_question` in this session, following the earlier approved direction. This resolves the decision ticket only; the combined specification still requires separate complete-scope approval before Ready or implementation.

Read-only evidence reviewed: delivery orders, fulfillment, tracking and follow-up feature documents, the administration glossary, the parent map, and Local Markdown tracker conventions. No application changes, tests, provider requests, delegation, commits or remote actions were performed.
