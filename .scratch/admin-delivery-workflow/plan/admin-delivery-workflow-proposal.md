# Proposal: Guided Admin Delivery Workflow

> **Historical proposal only — superseded for scope by the [complete reviewable Draft specification](admin-delivery-workflow-spec.md).** All six decision tickets are now resolved and shared understanding is confirmed; the historical open questions and recommendations below are not current decisions. Complete-spec approval remains pending. This proposal is not an approved implementation specification.
> Plan-level status is tracked in [index.md](../index.md). All proposed features are Draft.
> The user requested a proposed solution and a detailed example from payment through arrival. No app behavior, schema, provider integration, or deployment is changed by this document.
> Narrative follows the repository's English documentation convention; proposed customer/admin UI copy is in Indonesian.

## 1. Goal and motivation

Make delivery handling understandable without requiring staff to interpret technical statuses or memorize the process.

Every order should immediately answer:

1. **Where is this delivery now?**
2. **What should I do next?**
3. **If I cannot continue, why, and who needs to follow up?**

The recommended direction is an **operations work queue plus a guided order detail**, not merely a visual refresh of transaction records.

### Verified problems in the current UI

- The [Orders list](../../../apps/admin/src/app/admin/orders/page.tsx) still describes a pickup-only model, shows Pickup Date, and offers a pickup verification navigation item without distinguishing delivery rows.
- Its default order-date range is today. An unfinished order placed yesterday can therefore be excluded from the default list.
- List tabs follow commercial order status, not delivery tasks; there is no packing/booking/handoff stage or next-action column.
- The [detail page](../../../apps/admin/src/app/admin/orders/[id]/page.tsx) exposes delivery actions, but its delivery stepper only removes the pickup step from the general stepper. It does not explain the physical delivery lifecycle.
- The detail page shows a generic delivery-ready-to-process message for `processing` orders, even though some of those orders are blocked or already booked/in transit.
- Pickup-oriented labels such as `Pickup Location` and `Pengambilan diblokir` remain on delivery detail. Internal terminology such as `snapshot kanonis` and raw tracking codes appears prominently.
- An [existing follow-up page](../../../apps/admin/src/app/admin/orders/follow-up/page.tsx) already covers exceptions, but ordinary orders do not have an equivalent task-oriented queue.

These are source-code observations, not findings from a usability session or a live-provider test.

## 2. Existing behavior that must remain intact

This proposal improves how existing behavior is presented. It does not redefine payment, delivery evidence, or authorization.

| Existing rule | Consequence for the proposed UX |
|---|---|
| Authoritative Midtrans verification is necessary, but matching verified Jubelio invoice/payment is also required. | `Lunas` does not automatically mean `Siap dipacking`. |
| Delivery uses one existing Sales Order and frozen checkout data. | No new SO, re-quote, or silent replacement of the customer's address/service during fulfillment. |
| Most active delivery stages retain `processing / paid`. | Show a separate derived delivery stage instead of treating `Processing` as an operational instruction. |
| Booking persists a durable claim before one provider create request. | Booking is a deliberate action; ambiguous outcomes must never invite a blind retry. |
| AWB/resi is not physical handoff, and handoff is not delivery. | Booking, handoff, and arrival must be separate visual facts. |
| Verified `DELIVERED` can complete the order without a manual handoff stamp or POD. | Do not require staff to fabricate missing intermediate evidence to complete the progress display. |
| Manual completion does not invent `DELIVERED` or POD. | Display `Selesai manual`, not `Terkirim`, for that outcome. |
| Viewing another branch does not grant permission to mutate its orders. | Explain read-only access and the required Home Branch. |
| There is currently no tracking cron or browser polling on delivery detail. | Do not promise continuously live tracking. Show last-update information and the existing read-only refresh action when eligible. |
| Packing failure/manual resolution does not refund, cancel SO, adjust stock, or send communications. | Clearly state which follow-up still happens outside the application. |

Sources: [delivery orders](../../../docs/features/delivery-orders.md), [fulfillment](../../../docs/features/delivery-fulfillment.md), [tracking](../../../docs/features/delivery-tracking.md), and [follow-up](../../../docs/features/delivery-follow-up.md). The older general [order-flow document](../../../docs/features/order-flow.md) is pickup-oriented; the delivery-specific documents govern the delivery example below.

## 3. Proposed scope

### Feature A — Delivery operations queue

**Status: Draft**

Within Orders, offer `Semua / Delivery / Pickup`. In the delivery view, group orders by operational attention:

| Queue | Intended contents | Purpose |
|---|---|---|
| `Perlu diproses` | Eligible packing, booking, or waiting for physical handoff. | Staff work to do. |
| `Perlu tindak lanjut` | Settlement blocks, packing failures, uncertain booking, and supported shipment follow-up cases. | Explain and investigate blockers. |
| `Dalam pengiriman` | Verified normal courier progress, plus clearly labeled pending-progress cases after recorded handoff. | Monitoring, not another booking task. |
| `Selesai` | Delivered or manually completed orders, distinctly labeled. | Historical outcomes. |
| `Semua delivery` | Includes pending payment and other commercial outcomes. | Search/history without pretending every order needs staff action. |

Recommended table columns:

- Order reference and order date.
- Customer summary.
- Origin branch; especially useful for all-branch viewers.
- Service and destination city/area summary, rather than a full address in the queue.
- Payment status.
- Delivery stage.
- **Next step or blocker**.
- **Contextual navigation action**.

Example:

| Order | Payment | Delivery stage | Next step | Navigation |
|---|---|---|---|---|
| #A102 | Lunas | Perlu packing | Periksa barang dan siapkan paket | `Proses packing` |
| #A103 | Lunas | Siap booking | Booking layanan yang dipilih customer | `Review booking` |
| #A104 | Lunas | Resi tersedia | Serahkan paket saat kurir datang | `Lihat serah-terima` |
| #A105 | Lunas | Booking belum pasti | Konfirmasi hasil ke Jubelio; jangan booking ulang | `Tinjau kendala` |
| #A106 | Lunas | Dalam perjalanan | Pantau progres kurir | `Lihat tracking` |

**Safety:** list actions navigate to the relevant detail section. They do not immediately pack, book, hand over, or complete an order.

**Recommended date behavior:** the active work queues include unfinished orders regardless of creation date by default. A date filter remains optional and visibly indicates when it narrows the queue. History can retain explicit date filtering. Exact defaults require owner approval.

**Recommended ordering:** older actionable orders first within a queue. Show order creation time, and stage time only where a reliable timestamp exists. Do not infer packing time from a generic `updatedAt`. Do not label an order late without an agreed SLA.

**Provisional verification criteria:** an unfinished order from yesterday is discoverable by default; delivery rows have no pickup action; filters/counts include only authorized branch scope and match paginated results; list guidance agrees with detail guidance.

### Feature B — Guided delivery detail

**Status: Draft**

Recommended information hierarchy:

1. Order identity, `Delivery` badge, payment status, branch, and operational stage.
2. **Next-step panel** with why the action is available, a practical instruction, one primary action, and relevant warnings.
3. Delivery progress with evidence and timestamps where known.
4. Items/variants/quantities and packing guidance.
5. Frozen destination and selected service; booked resi and safe tracking link when available.
6. Customer/contact and commercial payment breakdown.
7. Operational activity history.
8. Collapsible technical diagnostics and provider references.

Use neutral, readable operational styling. Do not communicate status through color alone. Important blockers remain visible rather than being hidden in diagnostics.

The primary action changes with the stage. Secondary navigation/refresh remains available. Exceptional mutations live in a clearly separated `Penanganan khusus` area with explanatory confirmation.

**Recommended packing checklist:** initially guidance, not a new persisted checklist:

- Product, variant, and quantity match the order.
- Goods are physically available and undamaged.
- Packaging is ready and suitable for the purchased service.
- Destination label matches the checkout destination.

A mandatory, persisted checklist would add new behavior and requires a separate decision.

**Provisional verification criteria:** each normal stage exposes the correct instruction; read-only users see a reason rather than unexplained missing buttons; blocked orders are never described as ready; manual completion is not described as verified delivery.

### Feature C — Actionable exception handling

**Status: Draft**

Reuse the existing follow-up area as the case source rather than inventing a second independent exception system. Make it easier to discover from Orders and link a case to its relevant detail panel.

Translate internal conditions into **symptom → impact → safe next step**. Technical codes remain available under diagnostics.

Example:

> **Booking belum dapat dipastikan**
> Permintaan sudah dikirim, tetapi hasil booking belum terkonfirmasi.
> Jangan booking ulang karena pengiriman ganda bisa terbentuk.
> Hubungi Jubelio untuk memastikan hasil permintaan sebelumnya.

The exact queue mapping for tracking states outside the existing follow-up criteria remains an open decision. In particular, do not silently treat every `ON_HOLD`/`CANCELED` observation as a new existing case type.

**Provisional verification criteria:** unknown booking never offers an ordinary retry; active dispatch does not offer proof-release; approved release does not book automatically; special actions retain existing evidence/authorization rules; completed orders do not re-enter open follow-up.

## 4. Detailed end-to-end example

### Example assumptions

All people, references, times, services, and amounts below are fictional. The timestamps illustrate sequencing, **not an SLA, service guarantee, or measured integration timing**.

- Display order reference: `#A102` (illustrative; the real application retains its full order ID).
- Customer/recipient: Rina (fictional).
- Origin: Bandung branch.
- Destination: a fictional address in Bandung, with full destination and contact frozen at checkout.
- Selected service: `Kurir Contoh — Regular` (not a claim about an enabled courier).
- Goods: two units of Product A at Rp50,000 each.
- Goods subtotal: **Rp100,000**.
- Approved checkout shipping: **Rp20,000**.
- Example website PPN: **11% of Rp120,000 = Rp13,200**.
- Discount/service fee: zero in this example.
- Customer payment: **Rp133,200**.
- Jubelio goods-only invoice/payment: **Rp100,000**.
- Admin: an active user with `orders:edit` and Home Branch Bandung.
- The order/Sales Order and immutable checkout snapshots already exist before payment starts.

### Step 1 — Customer pays, but confirmation has not arrived yet

**Example time: Monday, 09:00.** Rina finishes paying Rp133,200 on Midtrans.

**System:** a customer return/redirect is not sufficient proof of settlement. Until authoritative verification has completed, the application must reflect its confirmed local state, not grant packing from the browser's claim of payment success.

**Proposed list:**

| Payment | Stage | Next step | Action |
|---|---|---|---|
| Menunggu konfirmasi | Menunggu pembayaran terverifikasi | Belum ada tindakan packing | `Lihat detail` |

**Proposed detail:**

```text
#A102 · Delivery · Cabang Bandung

MENUNGGU KONFIRMASI PEMBAYARAN
Packing belum dapat dimulai sampai pembayaran terverifikasi.
Jika customer sudah membayar, jangan meminta pembayaran ulang
hanya berdasarkan keterlambatan pembaruan halaman.

[Lihat rincian pembayaran]
```

**Admin:** does not pack, book, or manually mark payment as paid. If confirmation remains unresolved, use the established support/reconciliation process; this proposal does not add a force-paid button or a timer-based verdict.

**Customer:** consults confirmed order information. Any storefront copy change is outside this admin-first proposal and requires separate approval.

### Step 2 — Payment verified and fulfillment eligibility checked

**Example time: Monday, 09:01.** Authoritative Midtrans verification confirms the payment. The order becomes `processing / paid`.

**System:** Jubelio invoice/payment must also be verified against the matching SO and frozen goods-only amount. Verification of Rp100,000 is appropriate here; matching the Jubelio ledger against website total Rp133,200 would be wrong.

Two possible views:

| Eligibility | List stage | Guidance | Primary mutation |
|---|---|---|---|
| Jubelio settlement not verified/blocked | Verifikasi transaksi tertahan | Pembayaran lunas; pemenuhan belum bisa dimulai | None |
| Matching invoice/payment verified; all fulfillment guards pass | Perlu packing | Periksa barang dan siapkan paket | `Tandai packing selesai` |

**Normal example:** verification succeeds; no shipment ledger exists yet.

```text
LANGKAH BERIKUTNYA: SIAPKAN PAKET
Pembayaran dan transaksi Jubelio sudah terverifikasi.

Barang: Product A · varian sesuai pesanan · 2 unit
Tujuan: alamat checkout Rina
Layanan: Kurir Contoh — Regular

Periksa barang, jumlah, kondisi, dan kesiapan paket.

[Tandai packing selesai]    [Laporkan kendala barang]
```

**Admin:** retrieves the two correct items, inspects their condition, prepares the parcel, and checks the destination label. The application does not claim that these physical activities happened until staff records completion.

**Progress:** verification is complete; packing is the current task. There is no pickup code or pickup-ready instruction.

### Step 3 — Admin records packing completion

**Example time: Monday, 09:15.** Staff finishes preparing the parcel and clicks `Tandai packing selesai`.

**Existing action:** `POST /api/admin/orders/{id}/delivery/packing`.

**System:** rechecks current authorization and eligibility, persists the validated booking request from immutable checkout data, records packed state and its audit. It does **not** book with the courier yet.

**Result:** order remains `processing / paid`; shipment becomes `packed`.

**Proposed feedback:** `Packing selesai. Paket siap untuk booking pengiriman.`

**List:** stage changes to `Siap booking`; next step becomes `Review layanan dan booking pengiriman`.

```text
LANGKAH BERIKUTNYA: BOOKING PENGIRIMAN
Paket sudah ditandai siap.

Penerima: Rina
Tujuan: alamat yang disetujui saat checkout
Layanan: Kurir Contoh — Regular
Ongkir checkout: Rp20.000

Booking memakai data checkout; bukan alamat/layanan baru.

[Booking pengiriman]    [Laporkan kendala barang]
```

**Proposed booking confirmation:** show recipient, destination, service, and the fact that approval sends a real booking request. Packing completion is shown as a completed fact, not as another enabled button.

### Step 4 — Admin books shipment; resi is confirmed

**Example time: Monday, 09:17.** Admin reviews the booking summary and confirms.

**Existing action:** `POST /api/admin/orders/{id}/delivery/book`.

**System:** claims a durable booking attempt, commits it, then sends one shipment-create request. The example returns a confirmed resi `DEMO-AWB-001` and shipment identity.

While the UI awaits a response, proposed text is `Mengirim permintaan booking…` and repeat submission is disabled. If it does not resolve, do not turn a timeout into a definitive failure or retry invitation; use the held-case behavior in section 6.

**Result:** shipment becomes `booked`; order remains `processing / paid`.

**Cost example:**

| Ledger | Amount | Interpretation |
|---|---|---|
| Approved checkout shipping | Rp20,000 | Customer-approved website shipping. |
| Provider booking price | Rp25,000 | Known booking cost. |
| Provider billed shipping, when verified | Rp30,000 | Actual bill, not a replacement customer charge. |

Differences do not increase Rina's payment. If the bill is not yet known, show `Tagihan belum tersedia`, not Rp0 or an assumed Rp30,000. Put cost comparisons below the operational action rather than making them compete with it.

```text
LANGKAH BERIKUTNYA: SERAHKAN PAKET KE KURIR
Booking berhasil. Resi tersedia, tetapi serah-terima fisik
belum dicatat.

Resi: DEMO-AWB-001                       [Salin resi]
Layanan: Kurir Contoh — Regular

Klik hanya setelah paket benar-benar diserahkan ke kurir.

[Catat serah-terima ke kurir]    [Perbarui tracking]
```

**List:** `Resi tersedia` → `Serahkan paket saat kurir datang`.

**Admin:** keeps the ready parcel available and follows the branch's courier handoff procedure. A booking response must not be represented as a promise that a courier will arrive at a particular time; collection arrangements are not newly defined by this proposal.

### Step 5 — Physical handoff occurs

**Example time: Monday, 13:00.** The courier arrives and staff physically hands over the correct parcel. Staff then records handoff.

**Existing action:** `POST /api/admin/orders/{id}/delivery/handoff`.

**System:** persists handoff actor/time and audit. The order is **not completed** by this action.

**Result:** shipment remains `booked`, with `handedOverAt`; order remains `processing / paid`. Electronic courier progress may not have arrived yet.

```text
PAKET SUDAH DISERAHKAN KE KURIR
Serah-terima dicatat: Senin, 13.00
Menunggu pembaruan status dari kurir.

Resi: DEMO-AWB-001
Status kurir terverifikasi: belum tersedia

[Perbarui tracking]    [Buka tracking kurir, jika tersedia]
```

**List:** `Diserahkan · menunggu update kurir`; next step `Pantau progres pengiriman`.

**Admin:** no longer packs or books this order. Lack of an electronic scan is pending evidence, not proof that handoff failed or the shipment is late.

**Important alternate path:** if verified courier `PICKED_UP` arrives without a manual handoff stamp, show the courier pickup evidence and `Serah-terima manual belum dicatat`. Do not make normal progress look like an untouched parcel or fabricate the stamp.

### Step 6 — Courier confirms pickup and transit

**Example time: Monday, 13:20.** A valid, matching courier observation indicates `PICKED_UP`. Later, Tuesday at 08:00, it indicates `ON_DELIVERY`.

**System:** the dedicated signed callback or existing read-only reconciliation applies matching verified observations. Unknown/mismatched shipments and stale events cannot drive progress.

**List:** `Dalam perjalanan`; next step `Pantau status kurir`; action `Lihat tracking`.

```text
PAKET DALAM PERJALANAN
Status kurir: Dalam pengantaran
Pembaruan terakhir diterima: Selasa, 08.00
Waktu kejadian kurir: tampilkan hanya jika tersedia dan valid

Tidak ada tindakan packing atau booking yang diperlukan.

[Lihat tracking kurir]    [Perbarui tracking]

RIWAYAT OPERASIONAL
✓ Transaksi terverifikasi
✓ Packing selesai
✓ Booking berhasil · DEMO-AWB-001
✓ Serah-terima dicatat · Senin, 13.00
✓ Diambil kurir · berdasarkan bukti kurir
● Dalam pengantaran
○ Terkirim
```

**Admin:** monitors exceptions, not routine progress as an open problem. Refresh uses the existing read-only lookup of the stored AWB; it does not create another booking.

**Customer:** existing customer order detail can expose the confirmed resi, safe link, applied tracking timeline, and delivery status. Internal booking costs, staff IDs, technical diagnostics, and manual-resolution reasons remain private.

### Step 7 — Goods arrive; verified delivery completes the order

**Example time: Tuesday, 11:30.** The courier delivers the parcel to Rina and submits matching verified `DELIVERED` evidence.

**System:** applies the verified delivery observation and changes the order to `completed`, while preserving `paid`. Normal completion does not require an admin to click `Selesaikan manual` or enter a pickup code.

**List:** `Terkirim` in `Selesai`; next step `Tidak ada tindakan`; action `Lihat riwayat`.

```text
PENGIRIMAN SELESAI
Kurir mengonfirmasi paket terkirim.

Pembayaran: Lunas
Hasil: Terkirim berdasarkan konfirmasi kurir
Waktu terkirim: tampilkan jika bukti waktunya tersedia
Resi: DEMO-AWB-001

[Lihat riwayat]    [Buka bukti pengiriman, jika tersedia]
```

**POD:** a safe provider proof link appears only if available. Missing POD is not an invented proof and does not by itself prevent verified delivery completion.

**Admin:** no further normal fulfillment action is needed. If a later stale or issue event arrives, the completed order is not reopened into the operational queue. Post-completion disputes are outside this proposal.

**Evidence nuance:** if `DELIVERED` is verified without all intermediate scans or a manual handoff, still show delivery completion. Mark missing intermediate details as `Tidak tercatat`, rather than generating fake timestamps or forcing staff to fill them in.

## 5. Summary: what staff sees throughout the example

| Step | Confirmed commercial state | Delivery evidence | Proposed label | Staff's next step |
|---|---|---|---|---|
| Payment awaiting verification | `pending_payment / pending` | No shipment | Menunggu konfirmasi | Wait for verified payment; no fulfillment mutation. |
| Payment verified, settlement unresolved | `processing / paid` | Not eligible | Verifikasi tertahan | Follow up; no force-verified action. |
| Fully eligible | `processing / paid` | No shipment | Perlu packing | Check goods and prepare parcel. |
| Packing recorded | `processing / paid` | `packed` | Siap booking | Review and book shipment. |
| Booking confirmed | `processing / paid` | `booked`, known AWB | Resi tersedia | Physically hand over when courier arrives. |
| Physical handoff recorded | `processing / paid` | Handoff stamp, no scan yet | Diserahkan; menunggu update | Monitor; refresh when appropriate. |
| Courier progress verified | `processing / paid` | `PICKED_UP` / `ON_DELIVERY` | Dalam perjalanan | Monitor, not rebook. |
| Delivery verified | `completed / paid` | `DELIVERED` | Terkirim | View history; no normal mutation. |

The labels are a **derived view of evidence**, not proposed replacements for database status values.

## 6. Detailed exception examples

### A. Customer paid, but Jubelio settlement remains blocked

**Situation:** Rp133,200 payment is confirmed, but the matching goods-only Jubelio invoice/payment is not fully verified.

**UI:** `Lunas · Pemenuhan tertahan`.

**Guidance:** `Pembayaran customer sudah diterima. Packing belum dapat dimulai karena verifikasi transaksi Jubelio belum selesai.`

**Admin:** reviews the case/escalates through the operational support process. There is no `Tandai lunas` or `Paksa verifikasi` action. Existing system recovery is read-only for known invoice/payment IDs and never bypasses unknown or mismatched evidence.

**Outcome:** once all matching evidence is confirmed and other guards pass, the order becomes actionable for packing. Time elapsed alone never makes it eligible.

### B. Physical goods cannot be fulfilled

**Situation:** at 09:10, staff discovers one of the two units is damaged, before any booking dispatch.

**Action:** `Laporkan kendala barang` → choose `Barang rusak` → review consequences → confirm.

**Confirmation copy:** `Pesanan tetap lunas dan masuk tindak lanjut. Aksi ini tidak melakukan refund atau membatalkan transaksi.`

**Result:** existing `damaged_goods` flag blocks normal fulfillment; order remains `processing / paid` and enters packing follow-up.

**Next instruction:** `Koordinasikan penyelesaian dan komunikasi customer di luar aplikasi.` Do not offer an unimplemented resume/refund/replacement action.

### C. Booking request times out

**Situation:** the create request was dispatched, but the result is unknown. A shipment might exist at the provider.

**UI:** `Booking belum pasti · Ditahan`.

**Forbidden shortcut:** no `Coba booking lagi` button. A timeout, HTTP 404, empty dashboard, or elapsed time is not proof that no booking exists.

**Guided next step:** contact Jubelio/provider with the relevant order/attempt reference; ask whether the original operation is closed and whether any booking formed.

For a stable `booking_unknown` state only:

1. Staff obtains explicit confirmation that the original operation is closed and no booking exists.
2. Staff opens the special resolution form and records the provider confirmation reference and reason.
3. Proposed UI makes both attestations explicit: original operation closed, and no booking formed for the current attempt.
4. Existing release records the proof and changes the ledger back to `packed`; it does **not** create a shipment.
5. The next-step panel offers a separate booking review/approval for the next attempt.

A still-active/crashed `booking_dispatched` is held and **does not offer this release action**. If confirmation is unavailable, leave the case held and escalate outside the app. If the provider says a booking exists, do not release/rebook; follow the established escalation process. Automatic adoption of an unknown remote shipment is not part of this proposal.

### D. Parcel handed over but no tracking update

**Situation:** staff recorded handoff at 13:00; no courier observation has been received.

**UI:** `Diserahkan · Menunggu update kurir`, with recorded handoff time and last available evidence.

**Admin:** can use eligible `Perbarui tracking` or follow up operationally. The UI must not call this `Terlambat` or `Gagal` simply because no scan exists. An SLA/aging escalation rule is a future owner decision.

### E. Return or shipping issue before completion

**Situation:** verified `RETURNED` or `SHIPMENT_ISSUE` appears while the order is still processing.

**UI:** prominent issue banner, safe explanation, resi, last known evidence, and navigation to follow-up.

**Admin:** investigates and coordinates the business resolution outside the app. If existing manual-finish eligibility is satisfied, `Selesaikan manual` is available only in the special-handling area, with mandatory reason and explicit consequences.

**Confirmation copy:** `Aksi ini menutup order secara manual. Tidak menandai paket DELIVERED, tidak melakukan refund, dan tidak mengirim komunikasi otomatis.`

**Outcome:** show `Selesai manual`, keeping the distinction from successful courier delivery. Do not imply that selecting a reason implements a refund, return-stock workflow, or automatic customer notification.

### F. Admin can view, but cannot act

**Situation:** an all-branch viewer whose Home Branch is Jakarta opens this Bandung order.

**UI:** `Hanya dapat dilihat. Tindakan pemenuhan memerlukan orders:edit dan Home Branch yang sesuai dengan cabang order.`

**Admin:** views progress or coordinates with Bandung staff. No cross-branch action bypass is introduced. The same clear explanation applies to users without edit permission or without a suitable Home Branch; authorization remains server-enforced.

### G. A mutation succeeds but the detail refresh fails

**Situation:** booking may have succeeded, but the page cannot retrieve fresh order detail.

**Proposed UI:** `Status terbaru belum dapat dimuat. Muat ulang detail sebelum melakukan tindakan berikutnya.` Keep stale mutation controls locked until authoritative fresh data is available.

Do not show a generic booking-failed message with a retry button. Retrying a **read** is different from repeating a booking **write**. Concurrent/stale clients should refresh after a conflict and show the actual recorded state.

## 7. Design and engineering considerations for a future specification

These are recommendations, not an approved implementation sequence or ticket breakdown.

### Consistent operational projection

List and detail should consume the same conceptual stage/guidance rules. The rules must consider:

- Commercial terminal states before offering any active task.
- Delivery method, payment, settlement verification, immutable-data validity, cancellation guards, and physical-failure flags.
- Shipment claim state and verified courier evidence.
- Manual completion versus verified delivery.
- Actor edit permission/current Home Branch separately from stage: an order can need packing even when the viewer cannot perform it.

Do not let a client infer full eligibility from `processing`, a non-null invoice ID, or a Home Branch boolean alone. The current detail API's `actor.allowed` represents a Home Branch match, not complete action authorization; existing mutation services still own the full checks.

The [list API](../../../apps/admin/src/app/api/admin/orders/route.ts) currently returns order/customer/branch data without a shipment join. The [detail API](../../../apps/admin/src/app/api/admin/orders/[id]/route.ts) already reads shipment and tracking evidence. Delivery-stage filtering, accurate counts, and consistent guidance therefore require backend work, not just new table badges.

Scope queue filters/counts on the server before pagination. Do not calculate the queue total from one loaded page. Return only the summaries needed; no raw provider payloads, secrets, or full destination dumps in the list.

### Evidence-aware progress

Prefer separate facts for payment, physical packing/handoff, and courier observations. A linear visual progression is useful, but should not imply that every intermediate event was recorded.

Use provider event time only where valid; otherwise label received time explicitly. Never present a receipt timestamp as the actual arrival time. Ignored events belong in diagnostics, not the main operational history.

### Activity versus diagnostics

The proposed main history uses business-readable milestones. Existing audit/tracking data can supply evidence, but a readable packing/booking/handoff history may need an additional safe projection; the current tracking DTO alone is not a complete operational activity feed.

Diagnostics can retain SO/invoice/payment IDs, attempt number, internal state, ignored-event reasons, and cost ledgers. Relevant blockers remain prominent even when diagnostics are collapsed.

### Confirmation and feedback

- Give booking/handoff/special resolution explicit consequence copy.
- Confirm physical handoff means the package has already been handed over, not merely that an AWB exists.
- For proof-release, require clear human acknowledgement of the two claims rather than silently implying them from nonblank text fields.
- Distinguish `Muat ulang detail` and `Perbarui tracking` from mutation retries.
- Disable duplicate mutation submission; reread authoritative state before offering the next action.
- Provide safe tracking/POD anchors only where available. No fabricated links or remote proof-image fetching.
- Keep instructions accessible with text labels, readable layout, keyboard access, and non-color-only status cues.

### Deployment implications

The recommended baseline does not introduce new environment variables, provider endpoints, cron jobs, webhook contracts, or infrastructure. If a future decision adds notification delivery, polling/scheduling, or new configuration, its deployment files/docs require a separate scoped update and approval.

## 8. Non-scope

- New payment verification rules, force-paid/force-verified controls, or new Sales Orders.
- Changing database lifecycle enums merely to obtain clearer labels.
- Refunds, SO cancellation, return-stock adjustment, replacement shipment, address/service edits after checkout, or COD.
- Automatic booking, automatic proof-release, or blind booking retry.
- New courier collection scheduling guarantees.
- A mandatory persisted packing checklist, print-label integration, assignment/claim ownership, or an SLA policy without approval.
- New customer emails, WhatsApp integration, or customer communication log.
- Storefront redesign; customer descriptions above explain the existing information boundary.
- Tracking cron/polling, live-provider activation/write tests, remote operations, commits, or deployment.
- Post-completion disputes/reopening.

## 9. Decisions needed before an implementation-ready spec

1. **Navigation:** delivery work queues inside Orders (recommended), or a separate delivery workspace? Inside Orders preserves the existing entry point; a separate workspace offers focus but adds navigation.
2. **Language:** use Indonesian operational copy consistently (recommended), or retain an English admin interface? Examples here do not establish the final localization policy.
3. **Active queue date/order defaults:** include all unfinished orders by default and oldest-first (recommended), or another explicit time window/order? Any restrictive default risks hiding older work.
4. **Packing checklist:** advisory only (recommended baseline), or mandatory and persisted? Persistence changes workflow/data requirements.
5. **Follow-up grouping:** exactly mirror current supported cases first (recommended), or expand states such as `ON_HOLD`/`CANCELED` into new queue rules?
6. **Aging/SLA:** show timestamps only (recommended baseline), or define priority thresholds/escalation? Thresholds require actual operational policy; they must not be invented from this example.
7. **Activity scope:** provide a business-readable milestone history in the first delivery, or initially retain existing tracking/technical history beneath the guided panels?

These questions are intentionally unresolved. This document is sufficient for discussing the proposal, not for autonomous implementation.

## 10. Provisional acceptance and verification

To be finalized with the owner before approval:

- Payment awaiting verification cannot expose an actionable fulfillment mutation.
- Paid-but-blocked orders explain the blocker and never say `Siap diproses`.
- Eligible orders move through packing → booking → handoff → monitoring with consistent list/detail instructions.
- Successful booking exposes resi but not a claim of handoff or arrival.
- Handoff without tracking remains pending evidence, not an automatic shipping issue or late order.
- Verified pickup/transit without a manual handoff stamp is represented truthfully.
- Verified `DELIVERED` completes without a manual action, intermediate-scan requirement, or mandatory POD.
- Manual completion is distinctly labeled and never invents courier delivery evidence.
- Unknown/dispatched booking prevents blind retry; proof-release remains restricted and never automatically books.
- Read-only/cross-Home users get clear explanations without mutation access.
- Yesterday's unfinished work is visible in active queues under the recommended default.
- Counts, pagination, filters, and branch scope agree; no client-page-only grouping is presented as a full queue.
- Internal evidence/costs/reasons do not leak into customer DTOs.
- Stale/refetch-failed views cannot invite duplicate booking.
- Completed orders stay out of open queues after late issue events.

Future implementation must use TDD at public seams and Playwright coverage of visible behavior. Relevant existing coverage to extend/reuse:

- [Delivery order mock E2E](../../../e2e/store/delivery-order-mock.spec.ts).
- [Admin packing/booking mock E2E](../../../e2e/admin/shipment-booking-mock.spec.ts).
- [Shipment tracking mock E2E](../../../e2e/store/shipment-tracking-mock.spec.ts).
- [Admin follow-up mock E2E](../../../e2e/admin/delivery-follow-up-mock.spec.ts).
- [Shipment fulfillment DB tests](../../../apps/admin/src/lib/shipment-fulfillment.db.test.ts).
- [Follow-up DB tests](../../../apps/admin/src/lib/delivery-follow-up.db.test.ts).

Proposed additional coverage: stage/action consistency, blocker precedence, scope-aware queue counts/pagination, date defaults, read-only explanations, missing-evidence rendering, and refresh-failure safety. Use deterministic local/mock providers; do not make live-provider writes part of default verification.

**Verification performed for this document:** source/document review only. No unit tests, E2E, build, lint, provider requests, or deployment are claimed.

## 11. Approval and lifecycle

- Proposal/document request: authorized by the user's request in this conversation.
- Shared implementation scope: **not yet confirmed**.
- Complete implementation scope and acceptance criteria: **not approved**.
- Features A/B/C: **Draft**; nothing implemented.
- No implementation-ticket breakdown has been proposed or published.
- The owner approved charting the [Guided Admin Delivery Workflow wayfinder map](../wayfinder/map.md) with six decision tickets, using the existing Local Markdown tracker. Its confirmed framing is an approval-ready specification, clarification of the existing flow, and branch staff as the primary audience. All children are initially open; map publication is not approval of this proposal's recommendations or implementation.

After decisions are settled, this proposal can be revised into a complete reviewable plan/spec. Explicit approval is required before Ready or implementation; delegation, commits, remote operations, and deployment each retain their separate authorization requirements.

If the resulting plan eventually reaches Done: verify every approved feature, extract enduring behavior/API docs into `docs/`, simpan file plan sesuai kebijakan artefak terbaru, dan catat hasil Done in [index.md](../index.md), following [plan lifecycle](../../README.md).
