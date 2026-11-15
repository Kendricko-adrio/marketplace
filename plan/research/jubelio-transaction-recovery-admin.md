# Research: Admin recovery for unresolved Jubelio transactions

## 1. Status, scope, and evidence

**Status: research only; not an approved implementation plan.**

- Research date: 2026-10-13.
- Repository baseline: `1017d26`, plus the working-tree files inspected during this conversation.
- Owner request: investigate overlap between **Review Jubelio** and order follow-up, propose a simpler admin workflow, and classify errors/failure points with concrete recovery examples.
- This note records source-code findings and recommendations. Approval to create this research file is not approval to change application behavior, schema, permissions, deployment, or provider data.
- No application files were changed for this research. Pre-existing working-tree changes, including checkout/stock work, were left untouched.

Evidence labels used below:

| Label | Meaning |
|---|---|
| **Verified code** | Behavior directly visible in the inspected repository source. Not a claim of runtime reproduction or production verification. |
| **Recorded documentation** | Existing repository documentation or earlier research. Historical provider observations were not repeated here. |
| **Proposal** | Recommended future behavior; not implemented or approved by this note. |
| **Open** | Requires an owner decision, additional validation, or an authoritative provider contract. |

**Research boundary:** no fresh external API documentation was fetched, and no authenticated Jubelio GET, authentication POST, transaction POST, or remote operation was performed. Provider semantics below are repository-observed classifications, not newly verified universal guarantees.

## 2. Executive conclusion

**Proposal:** use one **Tindak lanjut pesanan** area at `/admin/orders/follow-up`, covering unresolved pickup and delivery transactions. Remove the separate **Review Jubelio** sidebar entry only after its cases have a replacement destination. Put contextual recovery actions in order detail, not generic write-retry buttons throughout the list.

The proposed workflow must distinguish:

1. A transaction request proven not sent.
2. A transaction definitively rejected before application.
3. A transaction possibly applied remotely.
4. A known remote transaction awaiting verification.
5. Verified remote success with incomplete local persistence/accounting.
6. Invalid configuration/data or contradictory business evidence.

**Core invariant:** failure to receive a response is not proof that a transaction failed to exist. Retry a GET to inspect an existing transaction; do not blindly replay SO, invoice, payment, cancellation, or shipment writes.

**Verified code:** the current durable sales ledger deliberately grants dispatch only from `intent`, through an atomic claim to `dispatched_unknown`. It has no general retry/release workflow for an already claimed sales operation. A new button alone cannot safely add POST retry. [S05] [S06]

## 3. Current admin surfaces and their overlap

### 3.1 Review Jubelio

**Verified code:** the sidebar links to `/admin/orders/reviews`. The page fetches `GET /api/admin/reviews/sales-operations` and displays two groups: manual-review operations and paid-but-blocked orders. Its refresh button reloads the list; it does not retry a provider transaction. [S01] [S02] [S03]

The API:

- Lists `manual_review` sales operations across `create`, `cancel`, `invoice`, and `payment`.
- Lists paid orders with an explicit fulfillment block **or** `processing + paid`.
- Is read-only and guarded by `orders:view` plus server-derived branch scope.
- Does not restrict these lists to delivery.
- Limits each underlying query to 100 before applying own-branch filtering in memory. [S03]

**Verified code finding:** `processing + paid` is not a sufficient settlement-failure predicate for delivery. Successfully settled delivery orders stay `processing + paid` while the block is cleared. The review query can therefore include ordinary verified delivery work. This is a static predicate finding, not a reproduced browser/database observation. [S03] [S08]

**Verified code finding:** one order can appear in both page groups, and can have multiple operation cards. The page does not provide one consolidated recovery decision per order. [S02]

### 3.2 Delivery follow-up

**Verified code:** Orders links to `/admin/orders/follow-up`; its heading is **Tindak lanjut pengiriman**. Filters are settlement, packing, booking, and shipment. The service selects paid delivery cases and deduplicates by order ID; the earliest class in its ordering wins. [S04] [S09]

The settlement branch requires an explicit fulfillment block on a processing delivery order. It is not a general pickup/create/cancel recovery queue. The route also intersects cases with the delivery work-list projection. [S09] [S10]

**Conclusion:** the two surfaces overlap on blocked delivery settlement, but their scope is not identical. Removing Review Jubelio without expanding case discovery would lose a destination for pickup and unresolved create/cancel cases. [S03] [S09] [S10]

### 3.3 Existing detail actions

**Verified code:** order detail already shows a delivery **Langkah berikutnya** panel, a **Penanganan khusus** section, and collapsed transaction diagnostics with SO/invoice/payment IDs. There is no general sales-transaction recovery button. [S11]

The legacy stock-review action is separate: it queues safe stock reconciliation and does not retry sales-order/invoice/payment writes. It must not be repurposed merely because its name contains Jubelio review. [S12]

## 4. Current transaction lifecycle

**Verified code:** checkout acquires the local hold and records the SO intent before dispatch; Midtrans initialization starts only after the SO is confirmed. Rejected SO create releases the local hold and makes the local order failed. Ambiguous create preserves the hold and does not initialize Midtrans. [S13]

**Verified code:** authoritative Midtrans success claims `processing + paid`. The settlement pipeline then requires verified invoice and payment before fulfillment. Pickup receives `ready_for_pickup`; delivery stays processing with no pickup code. An active cancellation blocks settlement. [S08] [S14] [S15]

```text
Checkout stock/quote validation (no order yet)
    |
Local transaction: order + items + hold + SO intent
    |
F1: POST SO create
    |
F2: independent SO GET confirmation
    |
F3: Midtrans payment initialization
    |
F4: authoritative Midtrans payment verification
    |
F5: POST invoice conversion
    |
F6: invoice GET + SO linkage + local request verification
    |
F7: POST invoice payment in Jubelio
    |
F8: payment GET + invoice association + amount verification
    |
    +-- Pickup: ready_for_pickup -> verification -> completed
    |
    +-- Delivery: processing -> packing -> F9 booking -> F10 tracking

F11: best-effort channel-status mirror, separate from fulfillment authority

Failure/expiry branch:
    F12: pre-invoice SO cancellation + confirmation

Cross-cutting boundary:
    F13: remote success followed by incomplete local persistence/accounting
```

**Recorded documentation:** Jubelio payment represents the goods-only settlement envelope, not necessarily the website total including PPN/shipping. Verification must use the appropriate frozen request, not the Midtrans total by default. For pickup, goods 100000 and website total 111000 correspond to a Jubelio amount of 100000. [S07] [S20]

## 5. Proposed error taxonomy

**Proposal:** these are internal recovery classes, not new enum values already implemented. Store them as structured evidence rather than derive permission to retry from free-text `lastError`. Classification, lifecycle eligibility, and authorization are separate decisions.

### A. Temporary failure before transaction dispatch

- **Meaning:** durable evidence proves the business transaction request did not leave the process, or an authoritative supported rejection proves it was not applied.
- **Examples:** `QUEUE_FULL`, `QUEUE_TIMEOUT`, or authentication transport failure before the business POST. A provider 429 can belong here only where its pre-apply semantics are established.
- **UI:** “Permintaan belum dikirim karena koneksi Jubelio sedang terganggu.”
- **Action:** **Coba kirim lagi**, only while the order is still eligible.
- **Flow:** recheck state/prerequisites -> create an auditable authorized attempt -> claim once -> POST once -> verify.
- **Guard:** no retry for terminal/expired orders merely because the transport failure is transient. Do not revive a rejected checkout order whose hold was already released.

**Verified code:** sales `postOnce` classifies pre-send auth/queue failures separately from transport failures after possible dispatch. Queue codes are already defined. This classification is not persisted comprehensively by the current lifecycle. [S16] [S17] [S06]

### B. Temporary verification failure with a known remote identity

- **Meaning:** the remote ID is known, but confirmation GET is temporarily unavailable.
- **Examples:** invoice GET timeout; payment GET 429/5xx.
- **UI:** “Transaksi memiliki referensi, tetapi belum berhasil diverifikasi.”
- **Action:** **Periksa status Jubelio**.
- **Flow:** GET existing transaction -> verify identity/linkage/items/money -> persist confirmation if valid.
- **Guard:** no second create/payment POST. Transient GET failure keeps the case unresolved; contradictory data routes to E.

**Verified code:** known-ID invoice/payment recovery exists, but manual-review recovery forwarding in the settlement entry point is limited to blocked delivery. It is not a general admin/pickup recovery command. [S06] [S08]

### C. Unknown write outcome

- **Meaning:** the request may have been applied; available evidence cannot establish success or safe absence.
- **Examples:** business POST timeout/network interruption; 5xx after dispatch; unreadable/missing returned ID; process crash after dispatch claim.
- **UI:** “Hasil transaksi belum pasti. Jangan kirim ulang.”
- **Action:** **Periksa status Jubelio** when supported known-ID verification is available; otherwise **Lihat langkah penanganan** for provider escalation.
- **Flow:** known ID -> GET verification; no ID -> authoritative provider investigation; unresolved evidence -> retain hold/block.
- **Guard:** timeout, 404, elapsed time, and an empty search result are not by themselves proof that the original operation is permanently closed without applying.

**Verified code:** claimed sales writes cannot be re-POSTed; the gateway classifies business write 5xx and transport ambiguity conservatively. [S05] [S16]

**Recorded documentation:** earlier Shipment research establishes a known-AWB GET route, not a supported reference-only discovery or terminal-negative guarantee. This is an evidence gap, not proof that Jubelio has no such capability. [S24]

### D. Invalid configuration or request

- **Meaning:** repeating unchanged inputs will not fix the underlying problem.
- **Examples:** missing/invalid credentials or payment account; invalid amount/payment type; wrong branch/item/tax mapping; provider access denied.
- **UI:** “Konfigurasi atau data integrasi perlu diperbaiki.”
- **Action:** **Lihat langkah penanganan**; enable a future retry only after repair, proof of non-application, and eligibility checks.
- **Guard:** separate transient authentication service failure from invalid credentials. Do not assume every 4xx is retryable, and do not infer retry safety solely from a displayed HTTP status.

**Verified code:** the sales gateway exposes `ambiguous` and `retryable` error attributes and validates payment inputs. The current invoice/payment lifecycle often records both definitive and ambiguous failures as manual review, losing the distinction in the persisted status. [S16] [S18] [S06]

### E. Remote verification mismatch

- **Meaning:** reads succeed, but remote evidence does not match the expected transaction.
- **Examples:** wrong contact/location; different item quantities/prices; different invoice amount; payment associated with another or multiple invoices; canceled SO.
- **UI:** “Data Jubelio tidak sesuai dengan pesanan.”
- **Action:** **Lihat perbedaan transaksi** and escalate.
- **Guard:** no manual “mark verified”, blind replacement transaction, or fulfillment override. A later valid GET could establish recovery, but cannot be presumed in advance.

**Verified code:** invoice verification compares the confirmed create payload to invoice goods/contact/location; payment verification checks the invoice association and expected amount. The proposal should preserve and explicitly specify verification requirements rather than weaken them for convenience. [S06]

### F. Incomplete local persistence/accounting after remote success

- **Meaning:** remote success is established, but local bookkeeping is incomplete.
- **Examples:** confirmed SO accounting interrupted; confirmed ledger state not reflected on the order; known booking result not committed locally.
- **UI:** “Transaksi diproses, tetapi data pesanan belum selesai diperbarui.”
- **Action:** **Periksa & pulihkan data**.
- **Flow:** retain/verify remote evidence -> perform idempotent local repair -> re-evaluate unresolved prerequisites.
- **Guard:** never create a second remote transaction to repair local DB state. If remote-success evidence was lost, classify as C instead of asserting success.

**Verified code:** confirmed SO/cancel accounting has a guarded local recovery routine. Booking persistence failure leaves dispatch ambiguity rather than permission to rebook. Midtrans metadata persistence failure also does not trigger another external create. These are separate collaborators, not one existing universal repair API. [S06] [S19] [S23]

### G. Business/lifecycle conflict

- **Meaning:** a commercial or physical state prevents automatic continuation, independently of network health.
- **Examples:** paid after cancellation started; physical goods unavailable/damaged; parcel exceeds paid service limits; returned shipment.
- **UI:** a specific business explanation, not a generic connection error.
- **Action:** the applicable business-resolution procedure, not generic Jubelio retry.
- **Guard:** preserve authoritative paid status; do not create replacement SO/invoice/payment or a refund automatically.

**Verified code / recorded documentation:** late settlement after an active cancel is blocked, and packing failure/manual finish have their own constrained procedures. Manual finish is not a refund or proof of customer receipt. [S15] [S20]

### Non-error and low-priority conditions

**Proposal:** distinguish these from the seven recovery classes:

- **In progress:** fresh dispatch has no settled result yet. Show “Sedang diproses”; no replay or timer-based release.
- **Normal awaiting payment:** not an integration failure. Keep outside the exception queue unless specific conflicting evidence exists.
- **Informational sync issue:** channel marker differs or its mirror failed. Show diagnostics without blocking already verified fulfillment.
- **Admin UI read failure:** show reload/error state; do not invent an order incident.
- **Action response lost:** re-read detail before asserting failure or offering a repeat write.
- **Permission/stale-state refusal:** enforce scope and reload instructions; a 403/409 from the admin action is not evidence of a failed Jubelio transaction.

**Verified code / recorded documentation:** the channel mirror is best effort and has its own versioned intent ledger; delivery presentation already warns against assuming a failed post-action read means the preceding write failed. [S21] [S22]

## 6. Failure-point coverage matrix

**Proposal:** this matrix identifies suitable destinations and action types. It is not a guarantee that the current code can recover every row.

| Point | Possible failure/evidence | Proposed destination/action | Existing support and constraints |
|---|---|---|---|
| Before local order | Stock GET, shipping quote, validation, or transaction rollback | Checkout feedback and infrastructure diagnostics; not an order case without an order | Checkout fails closed before SO dispatch. [S13] |
| F1 SO create | Pre-send failure, definitive rejection, ambiguous POST | Unresolved SO in follow-up; GET/escalation when ambiguous | Definitive rejection currently fails the local order and releases its hold: customer re-checkout, not admin revival. [S13] |
| F2 SO confirmation | GET unavailable or snapshot mismatch | Verify existing SO if a trustworthy ID is retained; otherwise escalate | Create ID is not persisted until gateway confirmation succeeds; manual-review create has no general recovery transition. [S05] [S06] [S18] |
| F3 Midtrans initialization | Payment create failure; metadata persistence failure | Handle any unresolved SO cleanup; optional payment diagnostics | Existing create failure invokes compensation/cancel; persistence failure after success is treated differently. No general admin re-charge button. [S13] [S23] |
| F4 Midtrans verification | Missing webhook/status GET unavailable; identity/amount mismatch | Optional separate payment-verification capability | Existing webhook re-verifies authoritative status; sweep handles stale pending orders. No manual paid override. [S14] [S25] |
| F5 Invoice conversion | Not sent, rejected, ambiguous POST | Contextual retry only with structured non-application evidence; otherwise verify/escalate | Existing invoice lifecycle routes definitive and ambiguous failures to manual review. [S06] |
| F6 Invoice verification | GET/linkage unavailable or goods mismatch | GET existing invoice; retain block on mismatch | Known-ID manual-review recovery exists for blocked delivery; ID capture boundary needs improvement. [S06] [S08] [S18] |
| F7 Jubelio invoice payment | Pre-send failure, rejection, ambiguous POST | Contextual safe retry or existing-payment verification/escalation | This records payment in Jubelio, not another customer charge in Midtrans. [S06] [S07] |
| F8 Payment verification | GET unavailable, missing ID, wrong association/amount | GET when identity is known; otherwise escalation | Payment ID is persisted after gateway verification, so confirmation-read failure can lose the recovery handle. [S06] [S18] |
| F9 Shipment booking | Create timeout, malformed result, crash, persistence failure | Existing booking follow-up and provider-confirmation procedure | All gateway errors after the booking claim currently go to unknown; no generic safe-pre-send retry path exists. [S19] [S26] |
| F10 Shipment tracking | Known-AWB GET unavailable; missing progress; RETURNED/SHIPMENT_ISSUE | Read-only status refresh and operational follow-up | Known AWB/Shipment ID/order identity must match. Tracking failure does not permit rebooking. ON_HOLD/CANCELED alone are not new case/manual-close authority. [S20] [S22] [S27] |
| F11 Channel mirror | Marker GET/edit unresolved or mismatch | Low-priority diagnostics, not the urgent transaction queue by default | Separate ledger; aged unknown edit recovery is GET-only; never gates pickup/payment. [S21] |
| F12 SO cancellation | Cancel timeout, refusal, active invoice, late payment conflict | Cancellation/cleanup case even when order is failed | Must not disappear simply because the local order is terminal. Confirm remote cancellation; no manual stock increment. [S06] [S15] |
| F13 Local persistence | Remote result known but DB/accounting unfinished | Local repair, possibly preceded by GET verification | SO accounting is recoverable; other repairs require individually defined public seams and evidence. [S06] [S19] [S23] |
| Physical/business issue | Packing failure, damaged goods, service limit, return | Existing business follow-up | No automatic refund, SO cancel, stock adjustment, or communication flow is implied. [S20] |

**Open:** immediate Midtrans verification, general remote-ID linkage, Shipment adoption, and channel-mirror recovery controls are scope extensions. Do not silently bundle them into a sales retry implementation.

## 7. Current recovery gaps to account for

### 7.1 Remote IDs can be lost before local persistence

**Verified code:** SO create performs its confirmation GET inside the gateway before returning the ID. Invoice conversion also performs invoice GET and SO linkage checks before returning to the lifecycle, where `persistJubelioSalesInvoiceId` is called. Payment create returns its ID only after GET verification. If those gateway reads fail, the lifecycle does not receive the ID through a structured durable result; the ID may exist in contextual logs but not as a usable ledger identity. [S06] [S18]

**Proposal:** durably capture a returned remote ID at the POST-response boundary, before subsequent GETs, without marking it confirmed. Preserve independent verification before fulfillment. A design must also handle the crash window between receiving an ID and saving it; early capture reduces risk but does not eliminate all unknown outcomes.

### 7.2 Persisted status is not enough to authorize retry

**Verified code:** invoice/payment failures can both end in `manual_review` regardless of definitive versus ambiguous error. The durable ledger stores status, timestamps, counts, IDs, request snapshot, and error text, but not a complete normalized failure-phase/non-application proof record. [S05] [S06]

**Proposal:** record structured dispatch phase, failure class/reason, known IDs, verification result, and evidence provenance. Never grant a legacy row safe retry merely by parsing its old error message. Insufficient evidence defaults to held/escalation.

### 7.3 GET recovery does not imply continuation permission

**Verified code:** `readOnlyRecovery` refuses missing invoice/payment operations and does not create a new intent/POST for them. Manual-review recovery forwarding is restricted to blocked delivery in settlement. The confirmation helper's manual-review exception applies only to invoice/payment, not create/cancel. [S05] [S06] [S08]

**Proposal:** separate **Periksa status** (GET/reconciliation) from **Lanjutkan proses** (a first-time eligible write) and **Coba kirim lagi** (a specifically authorized new attempt). A successful invoice GET must not covertly dispatch payment under a read-only button.

### 7.4 Existing intent/crash paths need individual inspection

**Verified code:** `ensureJubelioInvoice/Payment` do not simply resume every existing `intent`; non-confirmed/non-unknown/non-review existing rows fall through to held/review behavior. Missing payment-account configuration can leave an intent, because the manual-review transition only accepts `dispatched_unknown`. The sweep's unknown-operation pass delegates invoice/payment reconciliation to those ensure functions; no-ID invoice/payment crash paths are not a universal stale-to-review recovery path. [S05] [S06] [S08]

**Implication:** do not claim the current sweep recovers every aged unknown or every never-sent intent. Reproduce and specify each supported path before changing it. These are static findings, not executed regression tests.

### 7.5 Sales and Shipment retry authority are different

**Verified code / recorded documentation:** booking release is already a trusted human attestation for stable `booking_unknown`, with proof tied to the current attempt. Release archives the original request and permits a separate later booking approval. Active/crashed `booking_dispatched` is not releasable by this mechanism. Sales create/cancel/invoice/payment do not have an equivalent general release contract. [S19] [S20] [S24]

**Proposal:** reuse the safety principles, not the booking endpoint/schema verbatim. Any sales absence-proof or remote-linkage extension needs its own approved evidence and authorization contract.

## 8. Proposed simplified admin experience

**Proposal:** one route and one row per order, with all unresolved issues retained beneath the summary.

```text
Pesanan
  Delivery | Pickup | Semua
  Tindak lanjut (count of distinct orders with unresolved cases)

Tindak lanjut pesanan
  Filter: Semua | Transaksi Jubelio | Packing | Booking/pengiriman

  Order       Method     Main issue                 Action
  #ABC123     Pickup     Invoice belum verified     Buka & tangani
  #DEF456     Delivery   Booking belum pasti        Buka & tangani
```

Recommendations:

- Expand follow-up discovery beyond delivery, including unresolved create/cancel and pickup settlement.
- Redirect `/admin/orders/reviews` to the replacement transaction filter only after case parity is established.
- Base queue membership on unresolved evidence, not blanket `processing + paid` or a single block string.
- Preserve secondary issues when consolidating an order; resolving invoice must not hide an unresolved payment/cancel.
- Keep failed/expired orders with unresolved remote liabilities visible. A terminal order need not reopen fulfillment to remain a cleanup case.
- Apply branch scope before pagination/counts; do not retain the current global limit-then-filter behavior.
- Put writes in detail with context and confirmation, not generic table-row retry buttons.
- Keep mirror-only and infrastructure problems out of the urgent queue by default.

Example detail:

```text
#ABC123 | Pickup | Pembayaran diterima

Invoice Jubelio belum terverifikasi.
Periksa transaksi yang sudah dibuat. Tidak membuat invoice baru.

[ Periksa status Jubelio ]

Last checked: 10:32 WIB
> Detail teknis & riwayat
```

### Primary action by condition

| Evidence | Proposed primary action | Must not do |
|---|---|---|
| Fresh dispatch | “Sedang diproses” / disabled write | Timer-based release/replay |
| Known ID awaiting GET | Periksa status Jubelio | Create a replacement transaction |
| Proven transient non-application + eligible | Coba kirim lagi, with explicit confirmation | Reset old evidence or retry terminal order |
| Next operation never attempted + prerequisites verified | Lanjutkan proses Jubelio, with explicit confirmation | Treat absence of one field as proof of no prior dispatch |
| Config/data/mismatch/unknown without usable identity | Lihat langkah penanganan | Mark verified manually |
| Verified remote result, local state incomplete | Periksa & pulihkan data | Replay remote POST |

**Proposal:** show the issue, business impact, next action, and last check prominently. Collapse remote IDs, error codes, attempt/actor/time, provider proof references, and verification history into diagnostics. Do not expose tokens, raw provider responses, stored PII payloads, or secrets.

## 9. Concrete recovery scenarios

All examples are **proposed flows with illustrative values**, not newly observed provider transactions.

### 9.1 Invoice confirmation read times out, ID retained

```text
Midtrans paid
 -> invoice identity durably captured
 -> invoice GET times out
 -> order remains paid and fulfillment blocked (class B)
 -> admin selects Periksa status Jubelio
 -> GET invoice + SO linkage + frozen goods verification
 -> invoice verified
 -> payment has provably never been attempted
 -> admin separately approves Lanjutkan proses Jubelio
 -> one payment POST + GET verification
 -> pickup ready / delivery ready for packing
```

Expected outcome: no second invoice and no new Midtrans charge. The first button remains a read/reconciliation action. Current recovery is narrower; this scenario requires the proposed ID-capture and continuation design.

### 9.2 Payment POST times out and no payment ID is known

```text
Invoice verified
 -> payment POST
 -> response lost; identity unknown (class C)
 -> no payment retry button
 -> provider escalation
    -> payment found: no duplicate; linkage design required
    -> authoritative closed-without-payment proof: evaluate a new attempt
    -> no certainty: retain the block
```

Expected outcome: the customer remains paid. A successful invoice does not prove payment absence. Neither linkage nor proof-based sales release is currently a general implemented admin action.

### 9.3 Queue failure before invoice dispatch

```text
Paid order + confirmed active SO
 -> QUEUE_FULL before business POST (class A)
 -> durable non-send evidence recorded
 -> admin selects Coba kirim lagi
 -> recheck paid/current state, active cancel, invoice prerequisites
 -> authorized auditable attempt -> one claim -> one POST -> GET
```

If the new POST itself times out, the case changes to C; the same immediate retry permission does not survive that new ambiguity.

### 9.4 Payment expires and cancellation times out

```text
Payment expires
 -> local order failed_payment
 -> cancel SO request
 -> response timeout (class C)
 -> cancellation cleanup remains visible despite terminal local status
 -> GET known SO
    -> canceled: finish verified reconciliation/accounting
    -> active/unavailable: remain unresolved; no automatic replay
```

Expected outcome: do not manually increase local stock because a timeout occurred. Confirmed create already accounted its local hold; cancellation recovery must not subtract it again. Provider availability is restored through confirmed cancellation and the appropriate stock sync/accounting behavior. [S06] [S07]

### 9.5 Late payment after cancellation starts

```text
Expiry starts SO cancellation
 -> authoritative Midtrans settlement arrives later
 -> keep paid
 -> cancellation and fulfillment evidence conflict (class G)
 -> block fulfillment
 -> operator investigates commercial/stock resolution outside the normal retry path
```

Expected outcome: no automatic replacement SO, invoice, payment, refund, or pickup code. This matches the existing fail-closed principle. [S15]

### 9.6 Shipment booking timeout

```text
Verified settlement + packed goods
 -> booking attempt 1
 -> timeout -> booking_unknown
 -> obtain provider confirmation
    -> booking exists: do not rebook; linkage/adoption is unresolved extension
    -> original operation closed with no booking:
       record proof for current attempt -> release -> packed
       separately approve booking attempt 2
    -> outcome unresolved: stay held
```

Expected outcome: release itself performs no booking POST. A new unknown outcome requires new proof for that attempt. A live/crashed `booking_dispatched` cannot use this existing release path. [S20]

### 9.7 Remote success with incomplete local accounting

```text
SO GET verified and operation confirmed
 -> local hold accounting transaction interrupted (class F)
 -> reconciliation checks confirmed-but-unaccounted operation
 -> guarded local accounting commits once
 -> no new SO create
```

Expected outcome: repair bookkeeping without consuming another order's hold or creating another SO. Existing accounting uses a transactional accounted marker. [S06]

### 9.8 Admin request response is lost

```text
Admin approves an action
 -> backend completes it
 -> browser response fails
 -> UI reports that result/detail could not be confirmed
 -> reload order detail
 -> derive actions from latest authoritative state
```

Expected outcome: the UI does not assert “transaction failed” and does not re-enable the same write just because the response could not be read. Concurrent admin/webhook/cron progress must be handled by server claims and fresh eligibility checks. [S22]

## 10. Safety constraints for a future design

**Proposal:** preserve these constraints in any separately approved implementation:

1. No blind replay of possibly applied writes.
2. GET checks, first-time continuation, and retry attempts have distinct contracts and truthful UI labels.
3. No manual “paid”, “verified”, or “ready” override without authoritative evidence.
4. Preserve Midtrans-paid status when Jubelio settlement is blocked; Jubelio payment retry is not customer re-charge.
5. Preserve the goods-only verification envelope and frozen order request.
6. Retain history; do not erase/reset a previous dispatch to make it appear never sent. Any new attempt needs durable authorization/evidence and an atomic single-winner claim.
7. Recheck current order, cancellation, prerequisites, permissions, and branch eligibility server-side; stale browser evidence is not authority.
8. Global visibility must not silently grant cross-Home-Branch mutation rights. The sales recovery authorization policy still needs explicit agreement; existing delivery mutations require current active admin + `orders:edit` + exact Home Branch. [S09] [S20]
9. Provider I/O stays outside DB transactions; intent/evidence/audit transitions must have defined failure and concurrency semantics.
10. Resolve a case only when remote evidence is verified, local state is consistent, and no related blocker remains. HTTP 200, a click, or a terminal order status is not enough.
11. Do not promise automatic discovery/linkage for unknown IDs without an authoritative supported contract.
12. Keep unconfirmed absence, mismatches, and unresolved operation ownership fail-closed. A retry counter/backoff is not proof of safety.

## 11. Open decisions and research questions

This note does not settle these choices or publish implementation tickets:

- Should the first implementation cover sales transaction recovery only, retaining existing Shipment procedures, or also extend booking recovery classification?
- Should immediate Midtrans verification be included, or remain existing webhook/sweep behavior and a separate future capability?
- Which sales recovery actors can mutate: exact Home Branch only, or a specifically approved central-operations policy?
- What evidence authorizes a new sales attempt after definitive rejection or provider-confirmed absence? Which provider confirmation is sufficient and who may attest it?
- How are remote IDs captured durably before GET without weakening verification or losing a crash window?
- What supported lookup/linkage procedure exists when SO/payment/AWB identity was not retained? Is reference search available, and does it provide a terminal-negative guarantee?
- What configuration/request repair is permitted for never-sent or definitively rejected intents? How are old and repaired snapshots preserved?
- What distinguishes a stalled never-sent intent from a fresh active dispatch, and how are conflicting workers fenced?
- Where should mirror-only/infrastructure diagnostics live so they do not clutter the urgent transaction queue?
- What retry cooldown, bounded backoff, and escalation policy should apply after safety eligibility is established? No values are approved here.

**Provider questions:** confirm supported idempotency behavior per write endpoint, duplicate-write behavior after timeout, reference lookup consistency, final-negative semantics, and the supported recovery process for a lost response. Do not infer these from correlation fields or apply Omnichannel guarantees to the separate Shipment API. [S24]

## 12. Suggested verification targets, not executed

These are recommendations for a future approved spec, not claims of current coverage/pass:

- Safe-not-sent failure followed by exactly one authorized new POST.
- Unknown outcome produces zero replay POSTs, including concurrent clicks, cron, and webhook races.
- Known-ID GET recovery succeeds for explicitly supported pickup/delivery types; mismatch/unknown identity remains blocked.
- POST ID is retained when subsequent GET fails; local persistence failure never becomes provider rejection.
- Verified invoice followed by never-attempted payment requires a separate continuation contract.
- Current intent, missing account configuration, no-ID crash, manual-review create/cancel, and legacy rows are explicitly exercised.
- Failed/expired cancellation cleanup remains discoverable without reopening fulfillment.
- Normal verified processing delivery is excluded from transaction-failure membership.
- One order row preserves multiple unresolved issues; scoped counts/pagination cannot hide own-branch cases behind another branch's query limit.
- Booking release retains current proof/current-attempt/no-POST semantics; active dispatch is not releasable.
- Browser response loss, stale state, denied permissions, cross-branch access, and failed post-action reads never enable unsafe writes.
- Mirror-only failures do not block verified fulfillment.
- Unit/service/real-PG tests at public seams plus Playwright coverage for the actual menu, detail actions, confirmation, result messaging, and navigation.

Existing test sources were inspected as evidence of intended scenarios, not executed: sales review fixtures, durable sales operations, settlement, and known-ID delivery recovery. [S28] [S29] [S30] [S31]

## 13. Verification performed and limitations

- Read the relevant admin pages/routes/services, store checkout/webhook/settlement/gateway/ledger code, shared schema, and existing feature/research documentation.
- Compared queue predicates with committed delivery settlement behavior.
- Traced gateway ID-return boundaries through lifecycle persistence.
- Checked repository placement conventions and working-tree status.
- Checked all 31 source paths and cited line numbers; reviewed citation formatting. `git diff --check` reported no whitespace errors in tracked changes; the new note was checked separately for trailing whitespace.
- Wrote this single research artifact; no app/schema/config/deployment edits.
- No tests, builds, lint, typechecks, browser session, live database reproduction, provider calls, delegation, commit, push, or deployment were performed for this research.
- Findings marked Verified code describe the inspected source, including local changes, not a clean-build or production guarantee. Runtime regressions must be reproduced with tests before fixes.
- Some older general order-flow prose describes retired adjustment behavior. The current sales source and focused sales/delivery docs own the flow used here; this note does not revive the adjustment path.

## 14. Source ledger

Line references describe the inspected snapshot and may shift after edits. Function names and linked feature sections identify the authoritative seams.

[S01]: ../../apps/admin/src/components/AdminSidebar.tsx#L69
[S02]: ../../apps/admin/src/app/admin/orders/reviews/page.tsx
[S03]: ../../apps/admin/src/app/api/admin/reviews/sales-operations/route.ts
[S04]: ../../apps/admin/src/app/admin/orders/page.tsx#L79
[S05]: ../../apps/store/src/lib/jubelio-sales-operations.ts
[S06]: ../../apps/store/src/lib/jubelio-sales-lifecycle.ts
[S07]: ../../docs/features/jubelio-sales-orders.md
[S08]: ../../apps/store/src/lib/jubelio-sales-settlement.ts
[S09]: ../../apps/admin/src/lib/delivery-follow-up.ts
[S10]: ../../apps/admin/src/app/api/admin/orders/follow-up/route.ts
[S11]: ../../apps/admin/src/app/admin/orders/[id]/page.tsx#L541
[S12]: ../../apps/admin/src/app/api/admin/orders/[id]/stock-review/route.ts
[S13]: ../../apps/store/src/app/api/checkout/place-order/route.ts#L740
[S14]: ../../apps/store/src/app/api/webhooks/midtrans/route.ts
[S15]: ../../apps/store/src/lib/order-finalize.ts#L335
[S16]: ../../apps/store/src/lib/jubelio-sales-client.ts#L795
[S17]: ../../apps/store/src/lib/jubelio-request-scheduler.ts
[S18]: ../../apps/store/src/lib/jubelio-sales-client.ts#L1690
[S19]: ../../apps/admin/src/lib/shipment-fulfillment.ts#L446
[S20]: ../../docs/features/delivery-follow-up.md
[S21]: ../../docs/features/jubelio-sales-orders.md#channel-status-mirror--siap-proses-ticket-03
[S22]: ../../docs/features/admin-delivery-workflow.md
[S23]: ../../apps/store/src/lib/payment-initialization.ts
[S24]: ./jubelio-booking-unknown-get-lookup.md
[S25]: ../../apps/store/src/app/api/cron/sweep-reservations/route.ts
[S26]: ../../apps/admin/src/lib/jubelio-shipment-client.ts#L182
[S27]: ../../docs/features/delivery-tracking.md
[S28]: ../../e2e/admin/sales-review-queue.spec.ts
[S29]: ../../apps/store/src/lib/jubelio-sales-operations.db.test.ts
[S30]: ../../apps/store/src/lib/jubelio-sales-settlement.test.ts
[S31]: ../../apps/store/src/lib/jubelio-sales-recovery.db.test.ts

| Source | Owner / subject |
|---|---|
| [S01] | Sidebar Review Jubelio entry |
| [S02] | Read-only review page and duplicate display groups |
| [S03] | Review API membership, scope, and limits |
| [S04] | Orders navigation |
| [S05] | Durable intent/claim/outcome/recovery transitions |
| [S06] | SO/create/cancel/invoice/payment lifecycle and local accounting |
| [S07] | Focused sales flow, monetary envelope, recorded provider observations |
| [S08] | Settlement eligibility, delivery/pickup distinction, sweep recovery |
| [S09] | Delivery cases, deduplication, mutation guards, release/finish |
| [S10] | Follow-up route and delivery-list intersection |
| [S11] | Detail guidance/actions/diagnostics |
| [S12] | Separate legacy stock-review command |
| [S13] | Current checkout create/rejection/payment initialization boundary |
| [S14] | Authoritative Midtrans webhook processing |
| [S15] | Paid/failure claims and late-settlement conflict |
| [S16] | Sales auth, GET/POST error classification |
| [S17] | Queue error codes and pre-dispatch scheduler |
| [S18] | SO/invoice/payment gateway confirmation boundaries |
| [S19] | Shipment dispatch, unknown state, and persistence |
| [S20] | Delivery proof release, business follow-up, GET-only recovery |
| [S21] | Informational channel mirror and independent recovery contract |
| [S22] | Admin presentation and post-action read safety |
| [S23] | External payment success versus local metadata persistence failure |
| [S24] | Earlier reference-lookup/negative-proof research limits |
| [S25] | Sweep execution, Midtrans checks, local accounting and mirror passes |
| [S26] | Separate Shipment gateway, no automatic booking retry |
| [S27] | Known-AWB tracking, signed callbacks, identity and terminal safety |
| [S28] | Existing review/blocked-pickup E2E fixture assertions |
| [S29] | Durable sales operations concurrency test source |
| [S30] | Settlement test source |
| [S31] | Local accounting and known-ID delivery recovery test source |
