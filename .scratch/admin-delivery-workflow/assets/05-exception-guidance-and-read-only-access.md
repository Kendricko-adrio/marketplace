# Exception Guidance and Read-Only Access — Owner-Approved Contract

Complete decision artifact for ticket 05. Non-executable Markdown only. Status: owner-approved through `ask_user_question` (“Setujui draft lengkap”). This resolves ticket 05 but does not approve implementation or the combined specification.

## 1. Confirmed direction and boundaries

The owner confirmed shared understanding before drafting:

- Keep the approved ticket 02 stage language and ticket 04 detail hierarchy.
- Keep a visible symptom, impact and safe-next-step summary at the top. Evidence and exceptional mutations belong in a separate `Penanganan khusus` area, not alongside the normal primary action.
- Read-only viewers see specific reasons and coordination guidance without mutation buttons.
- Follow-up lists show concise, consistent case and safe-next-step summaries; full evidence and confirmations live on detail. List actions navigate, not mutate.
- Proof-release uses the existing rules with two mandatory acknowledgements; release and new booking remain separate approvals.
- Manual finish discloses all existing consequences, retains mandatory reason and uses a distinct completed result.
- Handoff without courier progress uses neutral pending-evidence language.
- Out-of-app guidance names the relevant branch staff, Jubelio support or courier without inventing assignments, SLA, refund or communication workflows.

Trade-offs: separate special handling requires additional navigation within detail but reduces confusion with normal fulfillment. Hiding unauthorized buttons reduces clutter; visible reasons preserve discoverability of the access boundary. Two proof acknowledgements and full manual-finish warnings add friction deliberately.

All action availability below assumes the existing complete server guards. Stage, payment, identifiers and `actor.allowed` alone are not authorization. No case criteria, commercial policy, mutation, retry, shipment adoption or permission rule is added.

## 2. Detail and follow-up presentation

```text
ORDER #[id] · Delivery · [order branch] · [approved stage]
[Payment status]                              [Muat ulang detail]

LANGKAH BERIKUTNYA
[Approved ticket 02 persistent guidance]
[Dampak: why normal fulfillment cannot continue, when applicable]
[Safe next step / coordination, when applicable]
[Specific read-only or eligibility explanation, when applicable]
[At most one existing normal primary action, only when available]

[Existing progress, goods, frozen destination/service, resi/tracking]

PENANGANAN KHUSUS
[Kendala / pending evidence and relevant recorded facts]
[Permitted exceptional action, only when authorized and eligible]
[Explanation when no special action is available]

[Existing source-labelled activity, financial summary, diagnostics]
```

Relevant blockers are never hidden exclusively in diagnostics. Show only recorded facts and safe references: packing reason/actor/time where available; booking attempt and dispatch time; known AWB/Shipment ID; applicable courier status and event/receipt time; existing proof-review references and manual reason where authorized. Missing values say `Belum tersedia` or `Belum tercatat`, not invented timestamps. Raw provider payloads and errors remain excluded from business copy.

Follow-up uses the same stage/guidance vocabulary and the existing settlement/packing/booking/shipment case source. Display a short case summary and safe next step; `Lihat detail` navigates to the relevant special-handling section. Do not introduce an independent case ledger or mutations on list rows.

A shipment pending-evidence row shows `Diserahkan ke kurir` with `Menunggu update kurir`, not a red failure/late verdict. Existing RETURNED/SHIPMENT_ISSUE cases remain distinct from pending evidence. ON_HOLD/CANCELED can be shown as detail warnings using approved ticket 02 wording; those statuses alone do not create new follow-up membership. Existing membership from another valid condition still applies.

## 3. Scenario contract

The commercial-state column describes the result of supported special handling or continued waiting, not a promise that external business resolution has occurred. Reconciliation can apply subsequent verified delivery evidence under existing tracking rules.

| Case / input evidence | Staff-visible explanation and safe next step | Actions or no-action reason | Required confirmation / useful evidence | Commercial state | Out-of-app follow-up |
|---|---|---|---|---|---|
| Paid, settlement verification blocked | **Verifikasi tertunda**. `Pembayaran diterima. Tunggu verifikasi Jubelio.` Impact: `Barang belum dapat diproses karena verifikasi transaksi Jubelio belum selesai.` | No packing/booking/manual verification bypass. Detail reload reads current state; system recovery is existing behavior. | Existing verification outcome and safe SO/invoice/payment references where available; ID presence does not prove verification. | Remains processing/paid while blocked. | Coordinate with Jubelio support about the unverified transaction; do not request another customer payment solely because of the blocker. |
| Physical stock unavailable before any booking dispatch | **Stok tidak tersedia**. `Stok tidak tersedia. Tindak lanjuti di luar aplikasi.` | Authorized eligible staff can report the existing packing failure. Once recorded, normal fulfillment and manual finish remain blocked; no new resume/refund action. | Mandatory `physical_stock_unavailable`; frozen goods/quantity and recorded report evidence. | Reporting retains processing/paid; no refund, SO cancellation, stock rollback or automatic communication. | Branch staff coordinate business resolution and customer communication outside the app. |
| Damaged goods before dispatch, including after readiness is recorded | **Barang rusak**. `Barang rusak. Tindak lanjuti di luar aplikasi.` | `Laporkan kendala barang` only under existing pre-dispatch eligibility. After reporting, packing/booking/handoff are blocked; no supported replacement or resume button. | Mandatory `damaged_goods`; goods and existing report actor/time where recorded. | Processing/paid remains; no automatic commercial resolution. | Branch staff coordinate resolution and customer communication outside the app. |
| Parcel exceeds the paid service limits before dispatch | **Batas layanan terlampaui**. `Paket melebihi batas layanan. Tindak lanjuti di luar aplikasi.` | Report existing packing failure if eligible; no service substitution, re-quote or automatic extra charge. | Mandatory `paid_service_limits_exceeded`; frozen selected service and goods. | Processing/paid remains; no refund/cancellation/stock action/communication. | Branch staff coordinate business resolution outside the app. |
| Stable booking_unknown without required proof | **Booking belum pasti**. `Konfirmasi ke Jubelio. Jangan pesan ulang.` Impact: `Booking mungkin sudah terbentuk. Memesan ulang dapat membuat pengiriman ganda.` | No ordinary retry. An authorized eligible viewer can open the release form, but cannot submit without complete proof. | Current attempt/reference and dispatch evidence; timeout, 404, elapsed time or empty results are not absence proof. | Processing/paid; booking remains unknown/held. | Ask Jubelio whether the original operation is closed and whether any shipment formed. If unresolved, remain held and escalate. |
| Stable booking_unknown with explicit current-attempt confirmation of absence and closure | Same unknown guidance until release succeeds. Form explains `Melepas tahanan tidak memesan pengiriman baru.` | Existing proof-release only. After confirmed release and a fresh detail read, show **Barang siap** / `Booking sebelumnya tidak terbentuk. Pesan pengiriman.` Booking requires separate review/approval. | Jubelio source, nonblank confirmation reference/reason, current attempt, two required acknowledgements. Server rejects stale/repeated proof and conflicting release. | Release retains processing/paid, changes shipment to packed, archives proof/request evidence; attempt count is not reset. No provider create is sent by release. | Obtain and retain the explicit support confirmation; a subsequent unknown attempt requires fresh proof for that attempt. |
| Outstanding booking_dispatched, including crashed dispatch | **Menunggu hasil booking**. `Hasil booking belum tersedia. Jangan pesan ulang.` Impact: `Permintaan sudah dikirim; hasilnya belum tercatat.` | No retry or proof-release through the unknown-booking action. No invented timer or recovery button. | Actual dispatched state, current attempt and recorded dispatch time. Time elapsed does not make it releasable. | Processing/paid; dispatched remains held. | Coordinate with Jubelio support; do not claim the UI can automatically recover/adopt a shipment. |
| Known complete booking and physical handoff; latest status absent/WAITING | **Diserahkan ke kurir**. `Barang diserahkan. Tunggu update kurir.` Evidence marker: `Menunggu update kurir`. | Existing eligible tracking refresh is separate from detail reload. No normal packing/booking action. Manual finish may exist under current physical-evidence guards, but is not promoted as the next step or a fix for missing scans. | Known shipment identity, actual handoff record, available courier evidence; no invented pickup or lateness. | Pending evidence alone retains processing/paid. Optional valid manual finish uses the separate closure contract. | Coordinate with courier if needed; no SLA or mandatory escalation threshold is defined. |
| Applicable pre-completion RETURNED | **Barang dikembalikan**. `Kurir melaporkan pengembalian. Tindak lanjuti kendala.` | Existing tracking refresh if permitted; `Selesaikan manual` only with complete booked ledger, all existing guards and reason. Not a return-receipt/stock/refund action. | Matching applied courier evidence, known AWB/Shipment ID, valid event time or labelled receipt time. | Observation remains processing/paid unless existing terminal rules apply; valid manual finish becomes completed/paid. | Courier investigation and branch business/customer coordination outside the app. |
| Applicable pre-completion SHIPMENT_ISSUE | **Kendala pengiriman**. `Pengiriman bermasalah. Konfirmasi ke kurir.` | Same existing eligible refresh/manual-finish boundaries; no rebooking/replacement shortcut. | Applied issue evidence and complete booked ledger; reason mandatory for manual finish. | Processing/paid until valid existing completion; manual finish becomes completed/paid. | Confirm the issue with courier and coordinate business resolution outside the app. |
| Applicable pre-completion ON_HOLD | **Pengiriman tertahan**. `Pengiriman tertahan. Konfirmasi ke kurir.` | Visible detail warning; status alone is not a new follow-up case or a manual-finish eligibility grant. Other existing physical evidence can independently satisfy manual-finish guards. | Applied observation and known shipment identity; do not infer an issue solely from missing evidence. | Warning itself does not change commercial state. | Confirm hold circumstances with courier. |
| Applicable pre-completion CANCELED | **Pengiriman dibatalkan**. `Pengiriman dibatalkan kurir. Tindak lanjuti kendala.` Clarify `Pembatalan pengiriman bukan pembatalan order.` | No order-cancellation/refund/new-booking shortcut. Status alone does not expand follow-up/manual-finish criteria. | Applied courier cancellation evidence; independent existing guards remain necessary. | No automatic order cancellation or refund. | Confirm with courier and coordinate business resolution with branch staff. |
| Known complete booked ledger, physical handoff or verified PICKED_UP/ON_DELIVERY; owner chooses manual closure | Retain current stage until closure. Explain that manual finish is an exceptional order closure, not routine progress or verified arrival. | Existing `Selesaikan manual` only if all current guards pass. Never require closure because intermediate scans are missing. | Nonblank reason and full consequence confirmation; AWB alone is insufficient. | Valid closure becomes completed/paid; no DELIVERED/POD is fabricated. | Any unresolved business/customer coordination remains outside the app. |
| Verified DELIVERED, even with absent handoff/intermediate scans/POD | **Barang diterima**. `Barang telah diterima. Pengiriman selesai.` | No new fulfillment/manual-finish action. History and available safe links remain readable. | Verified matching applied delivery evidence; missing timestamps/POD remain visibly unavailable. | Completed/paid. | No new in-app reopening/dispute workflow. |
| Valid manual closure | **Selesai manual**. `Order ditutup manual.` Supporting copy: `Penutupan manual bukan konfirmasi barang diterima pelanggan.` | No new fulfillment mutation; inspect recorded reason/history under existing admin visibility. | Actual manual reason/actor/time; never invent courier delivery evidence. | Completed/paid. | Any unresolved business resolution or customer communication is outside the app. |
| Late courier issue/progress/evidence after either completed outcome | Retain the completed outcome. Late diagnostic receipts do not become a new active warning/next task. Safe evidence enrichment follows existing tracking rules. | No reopening, retry or open follow-up. | Actual safe applied/enrichment evidence; ignored receipts stay diagnostic. | Remains completed/paid. | Post-completion disputes are outside this ticket. |

## 4. Special-action confirmations and results

### Packing failure

Show the three existing mandatory reason choices using the scenario labels. No new free-form case type is introduced.

```text
Laporkan kendala barang?
Kendala: [selected standard reason]

Kendala ini memblokir proses pemenuhan berikutnya.
Order tetap dalam proses dan pembayaran tetap lunas.
Tindakan ini tidak melakukan refund, membatalkan SO,
mengembalikan stok, atau mengirim komunikasi otomatis.
Koordinasikan penyelesaian dan komunikasi pelanggan
bersama staff cabang di luar aplikasi.

[Batal] [Laporkan kendala]
```

Success toast: `Kendala barang dicatat.` The persistent panel changes to the recorded reason, not a claim that the commercial problem was resolved.

### Proof-approved booking release

```text
Lepas tahanan booking?
Order: [reference] · Percobaan: [current attempt]

Sumber bukti: Konfirmasi Jubelio
Referensi konfirmasi: [required]
Alasan / ringkasan konfirmasi: [required]

[ ] Jubelio mengonfirmasi booking tidak terbentuk
    untuk percobaan ini.
[ ] Jubelio mengonfirmasi operasi permintaan awal
    untuk percobaan ini sudah ditutup.

Timeout, 404, hasil pencarian kosong, dan waktu tunggu
bukan bukti bahwa booking tidak terbentuk.
Jika belum ada kepastian, jangan lepaskan tahanan.

Tindakan ini mencatat bukti dan mengembalikan pengiriman
ke tahap Barang siap. Tidak memesan pengiriman baru.
Booking berikutnya memerlukan review dan persetujuan terpisah.

[Batal] [Lepas tahanan booking]
```

Both unchecked acknowledgements are mandatory; no silent/default attestation. The form binds proof to the displayed current attempt. Existing strict proof fields and server validation remain unchanged. Success toast: `Tahanan booking dilepas.` After fresh authoritative detail, the next-step panel follows the released-state copy in section 3. No create follows release automatically. Outstanding dispatch does not expose this release control.

If Jubelio confirms a booking exists, do not submit absence proof or book again; coordinate outside the app. No shipment adoption feature is approved. Provider lookup research does not alter this contract.

### Manual finish

```text
Selesaikan order secara manual?
Order: [reference] · Resi: [known AWB]
Bukti saat ini: [actual supporting issue/handoff/courier evidence]
Alasan penutupan: [required nonblank reason]

Order akan ditutup dengan hasil Selesai manual.
Pembayaran tetap lunas.
Tindakan ini:
• Tidak mengonfirmasi barang diterima pelanggan
  dan tidak membuat status DELIVERED atau bukti penerimaan.
• Tidak melakukan refund.
• Tidak menyesuaikan stok.
• Tidak membatalkan Sales Order (SO).
• Tidak mengirim komunikasi otomatis.

Penyelesaian bisnis dan komunikasi pelanggan, jika masih
diperlukan, tetap dilakukan di luar aplikasi.

[Batal] [Selesaikan manual]
```

Success toast: `Order ditutup manual.` Completed detail retains **Selesai manual** / `Order ditutup manual.` It does not adopt **Barang diterima** merely because the commercial status is completed. Internal reason and actor details remain admin-only under existing DTO boundaries.

## 5. Read-only access and unavailable eligibility

The operational stage describes the order, not the viewing admin's permissions. A Bandung order can still need packing while a Jakarta viewer is read-only. Keep the stage visible but accompany action-oriented stage guidance with an explicit viewer restriction; do not expose mutation buttons in either normal or special handling.

| Verified viewer condition | Visible copy | Safe next step / controls |
|---|---|---|
| No orders:edit grant | `Hanya dapat dilihat. Anda tidak memiliki izin mengubah order.` | `Koordinasikan tindakan dengan staff yang memiliki izin dan Home Branch sesuai cabang order.` No mutation buttons. |
| No Home Branch | `Hanya dapat dilihat. Tindakan pemenuhan memerlukan Home Branch yang sesuai dengan cabang order. Akun Anda belum memiliki Home Branch.` | Coordinate with authorized branch staff; no Home Branch selector/bypass is introduced. Owner/global visibility does not grant physical-action authority. |
| Home Branch Jakarta, order branch Bandung | `Hanya dapat dilihat. Home Branch Anda: Jakarta. Cabang order: Bandung. Tindakan pemenuhan harus dilakukan oleh staff dengan Home Branch Bandung dan izin yang sesuai.` | Coordinate with Bandung staff. Choosing a list filter does not change Home Branch. |
| Fresh detail gives a supported known blocker | Show the exact scenario blocker, not a generic permission denial. | Wait/investigate under that scenario; no unavailable mutation. |
| Current action eligibility cannot be established or refreshed, but view access remains valid | `Kelayakan tindakan belum dapat dipastikan. Muat ulang detail sebelum melanjutkan.` | No mutation buttons until fresh eligibility can be established. Offer `Muat ulang detail`, not repeat booking. Do not falsely attribute the restriction to Home Branch or invent a technical diagnosis. |
| Server rejects a stale/conflicting submission | `Kondisi order telah berubah. Muat ulang detail sebelum melanjutkan.` | Read current state; no automatic mutation retry. Fresh server permission denial follows the applicable specific restriction. |

If multiple verified access restrictions apply, show the applicable reasons together; do not imply that solving one grants full eligibility. Do not infer a specific denial reason from the Home Branch boolean alone. Precise reasons require trustworthy current policy/detail information; unavailable facts use the eligibility-unavailable copy rather than guesses.

Read-only does not hide already-authorized order evidence. Detail reload and safe links may remain under existing view access. Provider tracking refresh is still subject to its existing edit/Home Branch/eligibility guards even though its provider request is a GET; it is not offered to an unauthorized viewer.

This is distinct from **Policy-Unavailable State**: if current view policy cannot be refreshed, follow the existing fail-closed policy that hides protected navigation/data. Do not retain protected order detail as a read-only fallback.

## 6. Required walkthroughs and acceptance checks

1. **Damaged before dispatch:** eligible Bandung staff discovers damage after readiness. They choose Barang rusak, review unchanged commercial consequences, and confirm. The result is processing/paid with a packing follow-up case, no book/handoff/resume/refund control, and external coordination guidance.
2. **Unknown booking without proof:** show Booking belum pasti and no retry. Release cannot be submitted without reference/reason/current-attempt proof and both acknowledgements. Timeout, 404 or an empty dashboard cannot substitute for proof.
3. **Proof-release then booking:** record explicit absence/closure for current attempt 1. Release archives proof and returns to packed without provider create. Fresh detail shows Barang siap. A separate full booking review and approval can claim attempt 2. Proof for attempt 1 cannot release a later unknown attempt.
4. **Active dispatch:** Menunggu hasil booking remains held, with no release/rebook control regardless of elapsed time. Available references assist external investigation but no GET discovery/adoption operation is added.
5. **Return/issue manual closure:** applied RETURNED/SHIPMENT_ISSUE plus complete booked ledger and all other guards permits exceptional manual finish. Mandatory reason and full consequence copy precede completion. The result is completed/paid and Selesai manual, not verified arrival or commercial resolution.
6. **Jakarta viewer / Bandung order:** a scope-authorized viewer sees order evidence and the true operational stage, with the explicit branch mismatch explanation. Normal and special mutation controls are absent. Server authorization remains authoritative.
7. **Pending tracking:** actual handoff plus absent/WAITING tracking may appear in existing shipment follow-up as Menunggu update kurir. No failure, lateness or invented SLA. Missing intermediate evidence on verified transit/delivery never becomes mandatory backfill.
8. **Late evidence after completion:** delivered and manually completed orders remain out of open follow-up after late issue/progress receipts. Manual-result copy stays distinct; safe tracking/POD/billing enrichment follows current terminal rules.
9. **Access/eligibility uncertainty:** missing edit, absent Home Branch, mismatch and unavailable eligibility have distinct explanations. Stale/refetch-failed booking views never offer another write from assumed failure. Policy unavailable follows fail-closed data hiding, not read-only fallback.
10. **Supported criteria only:** ON_HOLD/CANCELED warnings do not independently broaden follow-up or manual-finish eligibility. AWB alone, packing failure, blocked settlement and unknown booking do not permit manual completion.

These are future implementation acceptance expectations, not executed test results. The combined specification must separately define and approve public-seam TDD and Playwright coverage before implementation.

## 7. Sources, research and approval boundary

- [Ticket 05](../issues/05-exception-guidance-and-read-only-access.md)
- [Approved ticket 02 stage copy](../issues/02-delivery-stage-language-and-guidance.md)
- [Approved ticket 04 normal layout](../assets/04-guided-detail-wireframes.md)
- [Follow-up policy](../../../docs/features/delivery-follow-up.md) and [service](../../../apps/admin/src/lib/delivery-follow-up.ts), especially existing list membership and manual-finish guards.
- [Tracking rules](../../../docs/features/delivery-tracking.md)
- [Administration glossary](../../../CONTEXT.md)
- [GET lookup research](../../../plan/research/jubelio-booking-unknown-get-lookup.md): owner chose existing rules; no GET search/recovery extension enters this ticket.

No new domain glossary entity is introduced. UI copy and implementation rules do not belong in CONTEXT.md. No application changes, provider writes, validation runs, delegation, commits or remote actions are authorized by this artifact. The owner approved the complete artifact, including all scenario rows, confirmation/read-only copy and acceptance walkthroughs, through `ask_user_question` by selecting “Setujui draft lengkap”. This resolves ticket 05 only; combined-spec approval remains separate.
