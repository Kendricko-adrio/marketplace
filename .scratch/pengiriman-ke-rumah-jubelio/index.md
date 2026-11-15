# pengiriman-ke-rumah-jubelio

Navigasi artefak fitur ini; aturan layout dan lifecycle: [panduan](../README.md).
Status plan hanya dicatat di sini. Status ticket tetap di masing-masing ticket.

## Status plan

| Plan | Status | Features | Notes / Outcome |
|---|---|---|---|
| [Pengiriman ke rumah via Jubelio Shipment](../../docs/features/home-delivery.md) | Done | [7 approved implementation tickets] | Ticket 01 Done: mock-only pickup E2E 2/2, DB-backed ledger and full unit suite verified; no live-provider writes. Ticket 02 Done: address/origin mock E2E, real-DB ownership/default concurrency, master parcel/fallback tests and full serial unit suite verified. Ticket 03 Done: rates-only quote, stale selection and server pricing E2E verified; full serial unit 914 passed/2 skipped, mock E2E 10/10. Ticket 04 Done: immutable snapshot, reprice approval and delivery settlement verified; serial unit 923 passed/2 skipped and mock E2E 13/13. Ticket 05 Done: packing/booking claims and ambiguity verified; serial unit 937 passed/2 skipped and mock E2E 16/16. Ticket 06 Done: handoff/signature/tracking/privacy verified; serial unit 945 passed/2 skipped and mock E2E 20/20. Ticket 07 Done: scope/physical failure/proof-approved release/manual finish and GET-only recovery verified. Final serial unit 953 passed/2 ready-infrastructure sentinels skipped; mock E2E 22/22, types/lint/schema/diff pass. Enduring docs published; Ready source preserved with implementation evidence; no live operational activation. Post-completion issues deferred in [future note](research/pengiriman-ke-rumah-jubelio-lanjutan.md). |

Catatan status dan hasil test di atas dipindahkan dari index lama, bukan verifikasi baru.
Plan Done yang dahulu sudah dihapus tidak direkonstruksi; outcome dan docs tetap tersedia.

### Adjustment status, notifikasi, dan email

| Plan | Status | Notes / Outcome |
|---|---|---|
| [Penyelarasan status, notifikasi, dan email order](plan/penyelarasan-status-notifikasi-email-spec.md) | Done | Implementasi selesai dan diverifikasi 2026-11-10 (mock/loopback, tanpa provider write). Evidence: [implementasi-dan-verifikasi](ticket/implementasi-dan-verifikasi.md) — L3 unit 184 file/2152 passed (12 skipped), mock E2E 12 passed (dua spec baru + shipment tracking + delivery follow-up), `db:check` lulus, migration 0057 hasil generator. Database development pengguna sudah menerapkan 14 statement verbatim migration 0057 (dua statement drift diskon lama dilewati karena kolomnya sudah ada; `db:push` dihentikan karena constraint diskon lama). Suite default dengan database dev: 169 file lulus, 9 file gagal — semuanya test lama yang menolak database non-disposable (sudah begitu sebelum perubahan ini). Tidak ada commit, remote action, atau deployment.

## Artefak

### plan

- [Spec penyelarasan status, notifikasi, dan email order](plan/penyelarasan-status-notifikasi-email-spec.md)

### ticket

- [Implementasi dan verifikasi (AC → bukti, deviasi)](ticket/implementasi-dan-verifikasi.md)

### wayfinder

- [Penyelarasan status, notifikasi, dan email delivery — sesi klarifikasi, belum spec](wayfinder/penyelarasan-status-notifikasi-email.md)

### research

- [research/jubelio-booking-unknown-get-lookup.md](research/jubelio-booking-unknown-get-lookup.md)
- [research/jubelio-so-shipment-ongkir-benchmark.md](research/jubelio-so-shipment-ongkir-benchmark.md)
- [research/ongkir-multi-item-kurir-indonesia.md](research/ongkir-multi-item-kurir-indonesia.md)
- [research/pengiriman-ke-rumah-jubelio-lanjutan.md](research/pengiriman-ke-rumah-jubelio-lanjutan.md)
- [research/pengiriman-ke-rumah-jubelio.md](research/pengiriman-ke-rumah-jubelio.md)

**Batas migrasi:** map `.scratch/pengiriman-ke-rumah-jubelio-implementation/map.md`
 yang dirujuk index lama tidak tersedia di checkout sebelum migrasi. Tidak dibuat ulang.
