# 06 — Serah-terima, tracking dan penyelesaian delivery

Type: task
Status: Done — main reviewed/integrated physical handoff, independent OpenSSL signature fixture, matched known-AWB GET, fresh locked callback state, timestamp/rank progression, pre-completion exception statuses, ignored replay/late history, customer privacy and safe late POD. Fixed worker SQL/cleanup/gateway/column/import/type defects and customer pickup step. Missing billed cost gets one non-blocking known-AWB GET after durable booking. Full serial unit 105 files, 945 passed/2 skipped; mock E2E 20/20; both typechecks, focused lint, db:check and diff check pass. Migration 0031 generated/reviewed/applied; seed/deployment/docs updated. No live provider writes, callback dashboard registration, polling or deployment.
Blocked by: 05
Parent: [map implementasi](../map.md)
Spec: [Approved Ready spec](../approved-spec.md)

## Hasil yang harus bekerja

Staf berizin (`orders:edit` + Home Branch cocok) mencatat serah-terima paket ke kurir sebagai tindakan fisik tersendiri; AWB saja bukan bukti serah-terima. Customer melihat alamat tujuan, cabang asal, layanan, ongkir, serta resi/link tracking **hanya setelah tersedia**. Webhook Shipment terpisah dari Omnichannel/Midtrans; verifikasi raw body `x-jubelio-signature` hex HMAC-SHA256 (key secret, message raw body + secret), constant-time sebelum mutasi. Cocokkan AWB/order, dedupe/replay dan tolak regresi; parser toleran field baru. GET AWB yang diketahui secara reaktif/manual untuk rekonsiliasi, tanpa polling cron. `PICKED_UP` bukan selesai; `DELIVERED` terverifikasi menyelesaikan delivery walau POD kosong; simpan/tampilkan POD bila ada dan aman. Setelah `completed`, event terlambat tidak membuka ulang order.

## Acceptance / verify

- Browser/HTTP store/admin untuk handoff, resi, timeline hingga delivered; penolakan cross-branch. HTTP webhook signature valid/salah/body berubah, replay/out-of-order; status tidak digandakan atau mundur.
- DB-backed status/riwayat event yang relevan, adapter signature fixture independen, tes GET AWB dikenal, `PICKED_UP` vs `DELIVERED`, POD opsional dan no reopening `completed`.
- Main agent menjalankan red → green unit/E2E, review PII/logging, update docs API/fitur serta callback env/deployment bila diperlukan.

## Batas

Masalah yang **baru** muncul setelah `completed` ditunda ke [catatan fitur lanjutan](../../../plan/research/pengiriman-ke-rumah-jubelio-lanjutan.md). Label/manifest/pickup kurir otomatis dan notifikasi kendala otomatis bukan scope. Ikuti [approved spec](../approved-spec.md).
