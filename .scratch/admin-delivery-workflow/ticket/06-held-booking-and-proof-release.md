# 06: Held booking and current-attempt proof-release

Type: task
Status: resolved
Label: ready-for-agent
Blocked by: [01 — Evidence-aware detail and safe access](01-evidence-aware-detail-and-safe-access.md), [03 — Guided preparation and booking](03-guided-preparation-and-booking.md)
Parent: [Implementation effort](map.md)
Specification: [Approved complete contract](../plan/admin-delivery-workflow-spec.md)

## What to build

An eligible branch operator sees why an uncertain provider booking is held, can record the existing explicit proof for the current unknown attempt, and must separately approve any subsequent booking. The interface never converts an outstanding dispatch, timeout or absence of lookup results into safe rebooking permission.

## Acceptance criteria

- [ ] Outstanding booking_dispatched shows Menunggu hasil booking; stable booking_unknown shows Booking belum pasti. Both keep no-blind-retry guidance and recorded attempt/dispatch context, with missing facts labelled honestly.
- [ ] No elapsed-time rule, proof-release/rebooking button, adoption or invented recovery operation is offered for outstanding dispatch, including a crashed request. External Jubelio coordination is explained without promising automatic recovery.
- [ ] Unknown booking blocker/duplicate-shipment impact is visible at the top. Existing proof-release is separated in Penanganan khusus, only for a currently authorized eligible viewer.
- [ ] Form binds proof to the current displayed attempt and requires Jubelio source, nonblank confirmation reference/reason and two initially unchecked mandatory acknowledgements: no booking exists for this attempt, and the original operation for this attempt is closed.
- [ ] Explain that timeout, 404, empty results and elapsed time are not absence proof. If certainty is unavailable or a booking exists, remain held and coordinate externally; no lookup/adoption extension is added.
- [ ] Server/current-attempt validation, stale/repeated-proof rejection, unique review archive and concurrent release loser behavior remain intact. Attempts stay monotonic; UI checks do not replace guards.
- [ ] Successful release records/archives proof, returns unknown to packed and emits Tahanan booking dilepas. with zero provider create. Fresh authoritative detail shows Barang siap with Booking sebelumnya tidak terbentuk. Pesan pengiriman.
- [ ] New booking uses ticket 03's full separate review/approval. No create automatically follows release; a later unknown attempt requires fresh proof and cannot be released by evidence for the prior attempt.
- [ ] Read-only/unknown-eligibility/stale/conflict states have no bypass or write retry. Follow-up/detail summaries and stage filters use the shared vocabulary and sole case source.
- [ ] Controlled public-service/PostgreSQL/provider-stub tests prove release has no create and stale/concurrent proof cannot authorize another attempt; existing attempt-two at-most-once behavior passes. Browser verifies required fields/acknowledgements and separate booking review, including keyboard/mobile dialogs. Update enduring feature/API docs and structured logs without raw proof payloads.

## Verification focus

AC18–AC20, AC24, AC26–AC29 as applicable, AC32–AC33, AC38–AC39. Reuse follow-up releaseBooking public seam, existing current-attempt/concurrent release and proof-approved reattempt checks, and admin booking/follow-up mock E2E. No live Jubelio requests are needed.

## Boundaries and handoff

No blind retry, auto-release, auto-book, timer eligibility, provider discovery/adoption or proof inferred from transport failures. Ticket 03 is a genuine prerequisite because release must feed its distinct booking approval, not an implementation-only shortcut. Follow the parent common contract; execution was subsequently requested by the owner.

## Answer

Implemented distinct unknown/outstanding-dispatch guidance and a separated current-attempt proof dialog. Reference/reason are mandatory; two acknowledgements start unchecked and independently block submission. Timeout/404/empty results/time are explicitly not proof. Successful release requires a fresh read, retains archived proof/attempt history, and exposes ticket 03's separate booking review without automatic create. Outstanding dispatch has no release or timer shortcut.

Focused proof browser scenario and public-service/DB proof/concurrency checks passed. The controlled real follow-up journey proves release creates no booking; existing stale/repeated/current-attempt and at-most-once attempt-two tests pass in the full unit suite. The reviewed isolated full E2E suite passes all 49 tests. Main-agent review, admin typecheck and changed-file ESLint passed; enduring docs updated. [Final shared verification](verification.md).
