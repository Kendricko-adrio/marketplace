# Guided Delivery Detail — Owner Review Draft

Non-executable Markdown prototype for ticket 04. No implementation is authorized.

## Selected direction

- Next-step panel at the top, retaining the approved ticket 02 guidance.
- At most one existing primary fulfillment action per stage, subject to server eligibility and authorization. Guidance itself remains text only.
- Short advisory packing guidance, no checkbox or persisted checklist.
- Short readiness confirmation, full booking review, explicit physical-handoff confirmation.
- One source-labelled activity timeline, with event time distinct from receipt time.
- Separate detail reload and provider tracking refresh controls; no automatic polling.
- Processing, stale-data and conflict messages next to the action.
- Visible financial summary with expandable differences; expandable technical diagnostics.

Trade-offs: stronger operational focus and booking review require more vertical space. A unified timeline needs explicit source/time labels. Visible financial summaries add information but avoid hiding cost differences. No checkbox is required for physical handoff, so its confirmation wording must be unambiguous.

## Shared layout

```text
ORDER #[id] — [approved stage]                 [Muat ulang detail]
┌ Langkah berikutnya ──────────────────────────────────────┐
│ [approved persistent guidance]                           │
│ [stage-specific advisory/context]                        │
│ [one existing primary action, when allowed]               │
│ [processing, stale or conflict message when applicable]   │
└──────────────────────────────────────────────────────────┘
Progress delivery — based on available evidence
Barang                         Tujuan dan service
[items and quantities]         [frozen order destination/service]
Resi dan tracking              [Perbarui tracking, when allowed]
[known AWB, safe link, known courier status]
Activity delivery — source-labelled events
Keuangan pengiriman
  Ongkir checkout | Biaya booking | Tagihan courier
  [Rincian selisih ▸]
[Technical diagnostics ▸]
```

Destination, goods and service use the existing immutable order snapshot; this prototype offers no editing or service substitution. Missing values are labelled unavailable, not invented. A known AWB does not imply physical handoff. Progress must not fill in missing intermediate evidence. Tracking refresh appears only with a known shipment and existing authorization. `actor.allowed` is a Home Branch hint, not complete mutation authorization.

## 1. Eligible packing

```text
ORDER #[id] — Siapkan barang
┌ Langkah berikutnya ──────────────────────────────────────┐
│ Siapkan barang, lalu tandai siap.                         │
│ Periksa barang, jumlah, kondisi, dan kemasan sesuai       │
│ layanan yang dipilih.                                    │
│ [Tandai siap]                                            │
└──────────────────────────────────────────────────────────┘
Barang: [snapshot items and quantities]
Tujuan / service: [snapshot]
Resi: Belum tersedia
```

Action is shown as available only when existing full eligibility and authorization permit it; payment alone is insufficient.

Confirmation:

```text
Tandai barang siap?
Pastikan barang, jumlah, kondisi, dan kemasan
sudah diperiksa sesuai layanan yang dipilih.

Tindakan ini mencatat barang siap.
Pengiriman belum dipesan.
[Batal] [Tandai siap]
```

Success toast: `Barang ditandai siap.` Persistent guidance moves to the current evidence-based stage.

## 2. Goods ready / booking review

```text
ORDER #[id] — Barang siap
┌ Langkah berikutnya ──────────────────────────────────────┐
│ Barang siap. Pesan pengiriman.                           │
│ [Pesan pengiriman]                                       │
└──────────────────────────────────────────────────────────┘
Barang | Tujuan dan service: [frozen snapshot]
Resi: Belum tersedia
```

Confirmation:

```text
Pesan pengiriman?
Barang: [snapshot items and quantities]
Tujuan: [order recipient and address]
Kurir / service: [checkout selection]
Ongkir checkout: [stored quote]

Data mengikuti order saat checkout.
Konfirmasi mengirim permintaan booking ke provider.
Booking belum berarti barang diserahkan ke kurir.
Jika hasil belum pasti, jangan pesan ulang.
[Batal] [Pesan pengiriman]
```

Checkout shipping charge is not a guarantee of booking or billed price. During submission, the primary button becomes disabled `Memproses booking…`; repeated submission is not invited. Known success toast: `Pengiriman berhasil dipesan.` Ambiguous outcomes do not receive a success toast or a blind retry instruction.

## 3. Confirmed booking awaiting physical handoff

```text
ORDER #[id] — Menunggu penjemputan
┌ Langkah berikutnya ──────────────────────────────────────┐
│ Tunggu kurir. Catat serah terima setelah barang           │
│ diserahkan.                                             │
│ [Catat serah terima]                                     │
└──────────────────────────────────────────────────────────┘
Resi: [known AWB] | Kurir / service: [known booking]
Serah terima manual: Belum tercatat
```

Confirmation:

```text
Catat serah terima?
Kurir / service: [known booking]
Resi: [AWB]

Lakukan hanya setelah barang benar-benar
Anda serahkan kepada kurir.
Ini bukan bukti barang diterima pelanggan.
[Batal] [Barang sudah diserahkan]
```

Success toast: `Serah terima dicatat.` No persisted confirmation checkbox or invented courier scan.

## 4. Recorded handoff awaiting courier scan

```text
ORDER #[id] — Diserahkan ke kurir
┌ Langkah berikutnya ──────────────────────────────────────┐
│ Barang diserahkan. Tunggu update kurir.                   │
│ [No primary fulfillment action]                          │
└──────────────────────────────────────────────────────────┘
Serah terima: [recorded admin/time, where available]
Tracking: [actual known evidence; no invented pickup event]
[Perbarui tracking, when allowed]
```

Waiting guidance remains visible. Provider refresh is separate from fulfillment action.

## 5. Normal courier progress

```text
ORDER #[id] — Dalam pengiriman
┌ Langkah berikutnya ──────────────────────────────────────┐
│ Barang dalam pengiriman. Pantau pengiriman.              │
│ [No primary fulfillment action]                          │
└──────────────────────────────────────────────────────────┘
Resi: [AWB] | Tracking: [safe available link]
Activity delivery
• Barang dalam pengiriman — Sumber: courier
  Waktu kejadian: [verified time, or Tidak tersedia]
  Update diterima sistem: [recorded receipt time if available]
Serah terima manual: [actual record, or Belum tercatat]
```

For verified PICKED_UP instead of ON_DELIVERY, use `Dibawa kurir` and `Barang dibawa kurir. Pantau pengiriman.` Missing manual handoff is inspectable but not a mandatory backfill task.

## 6. Verified delivery

```text
ORDER #[id] — Barang diterima
┌ Langkah berikutnya ──────────────────────────────────────┐
│ Barang telah diterima. Pengiriman selesai.               │
│ [No primary fulfillment action]                          │
└──────────────────────────────────────────────────────────┘
Activity delivery
• Barang diterima — Sumber: courier
  Waktu kejadian: [verified time, or Tidak tersedia]
  Update diterima sistem: [recorded receipt time if available]
Bukti penerimaan: [safe available link, or Belum tersedia]
```

Verified DELIVERED remains completed even without intermediate scans, manual handoff or POD. Do not fabricate those events. Manual completion remains distinct as `Selesai manual` / `Order ditutup manual.` It is not presented as verified arrival.

## Unified timeline and financial detail

Show only actual applicable activity; ignored technical receipts belong in diagnostics, not the normal timeline. Admin facts use recorded actor/time where available. Courier observations identify their source and distinguish event time from receipt time. If only receipt time exists, do not relabel it as courier event time or use it to infer physical sequence.

Illustrative financial values, not live order evidence:

```text
Keuangan pengiriman
Ongkir checkout    Rp20.000
Biaya booking     Rp25.000
Tagihan courier   Belum ada tagihan
[Rincian selisih ▸]
```

Absent billed cost is not zero. Existing cost differences do not increase customer payment or block normal fulfillment. Diagnostics remain expandable and separate from normal activity.

## Refresh, stale data and conflict feedback

- `Muat ulang detail`: read the latest application state; no booking or provider tracking request.
- `Perbarui tracking`: request provider observations for the stored known AWB through the existing reconciliation flow; no new booking.
- Refresh success toasts describe results only; next-step guidance remains in the detail.
- After failed detail reload: retain a visible local message `Detail belum berhasil diperbarui. Muat ulang detail untuk memastikan hasil.` Do not assume the preceding write failed or re-enable a repeated booking based solely on the stale view.
- When booking outcome is uncertain: `Hasil booking belum pasti. Jangan pesan ulang.` Actual outstanding dispatch follows ticket 02 wording rather than being mislabelled as a stable unknown outcome.
- On server conflict: `Kondisi order telah berubah. Muat ulang detail sebelum melanjutkan.` Offer detail reload, not an automatic retry.
- No invented automatic refresh, polling, or changed server eligibility. This document specifies presentation, not new backend operations.

Final exception and read-only-access presentation belongs to ticket 05.

## Approval boundary

This is a complete ticket 04 wireframe draft for owner review, not an implementation spec approval. Ticket 04 remains open until the owner accepts this artifact. Combined scope and implementation require their separate approval gates.

## Sources

- [Ticket 04](../04-guided-detail-wireframes-and-confirmations.md)
- [Approved ticket 02 terminology](../02-delivery-stage-language-and-guidance.md)
- [Delivery fulfillment](../../../../docs/features/delivery-fulfillment.md)
- [Delivery tracking](../../../../docs/features/delivery-tracking.md)
