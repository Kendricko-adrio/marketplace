# 07 — Daftar tindak lanjut kendala sebelum order selesai

Type: task
Status: Done — main reviewed and repaired schema omissions, stale Home and missing settlement gates, client/server import boundary, evidence-pending queue, fixtures and final-state E2E waits. Proof-approved release archives original attempt and permits one atomic attempt-2 POST, never an automatic retry. Manual finish requires known booking and issue/handoff/progress evidence; unknown booking cannot finish. Known-ID delivery settlement GET recovery and missing-ID/no-intent safety verified. Migration 0032 regenerated with explicit owner approval; db:push retained old CHECK, so the two generated constraint statements were applied transactionally after inspection. Full serial unit 106 files, 953 passed/2 infrastructure-failure sentinels skipped because PostgreSQL is ready; full isolated mock E2E 22/22; both typechecks, focused lint, db:check and diff check pass. Seed cleanup and enduring docs updated. No live writes/deployment/commit/push.
Blocked by: 04, 05, 06
Parent: [map implementasi](../map.md)
Spec: [Approved Ready spec](../approved-spec.md)

## Hasil yang harus bekerja

Satu area admin dengan filter/alasan aman mencakup settlement paid-but-blocked, packing gagal, booking ambigu, serta `RETURNED`/`SHIPMENT_ISSUE` **sebelum** order selesai. Settlement ambigu tetap paid, tidak booking dan tidak ada tombol admin “tandai terverifikasi”; pemulihan hanya GET-only sistem. Packing gagal ditandai “tidak dapat dipenuhi” dengan alasan baku dan keluar dari antrean normal. Booking ambigu ditahan; lepaskan hanya setelah kepastian booking pertama tidak ada, tanpa retry create buta. Pengiriman bermasalah dan bukti elektronik macet dapat selesai manual dengan alasan wajib + Audit Event. Visibilitas `orders:view` + Branch Scope; semua tindakan `orders:edit` + Home Branch cocok, termasuk owner. Setelah diagnosis dan solusi jelas, staf mengabari customer secara manual di luar aplikasi.

## Acceptance / verify

- Browser/HTTP daftar/filter dan aksi sah vs tanpa izin/cross-branch; alasan wajib dan Audit Event. Mock settlement ambigu, packing gagal, timeout booking dan callback issue/returned; tidak ada fulfillment saat blocked, create ganda, refund atau komunikasi otomatis.
- DB-backed klaim/transisi manual, replay/settlement vs booking yang relevan; unit/E2E relevan. Main agent menjalankan red → green, review akses/PII, dokumentasi endpoint/fitur dan deployment bila terdampak.

## Batas

Tidak mengimplementasikan refund, retur fisik, cancel SO berbayar, eskalasi Jubelio otomatis, atau penanganan masalah yang **baru** muncul pasca-`completed` ([catatan lanjutan](../../../plan/research/pengiriman-ke-rumah-jubelio-lanjutan.md)). Pertahankan semua safety guard yang sudah dibangun di tiket sebelumnya. Ikuti [approved spec](../approved-spec.md).
