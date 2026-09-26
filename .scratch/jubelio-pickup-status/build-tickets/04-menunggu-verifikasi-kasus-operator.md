# 04: Menunggu Verifikasi hanya untuk kasus operator

**Parent:** [Spesifikasi Ready — cermin Status Channel](../spec-draft.md)

**What to build:** Operator melihat **Menunggu Verifikasi** hanya bila Midtrans sah `paid` dan settlement menghasilkan `manual_review` atau blokir eksplisit yang memerlukan investigasi manusia. Verifikasi invoice/payment yang singkat (`pending`/`in_flight`) bukan insiden; sukses cepat melompat langsung dari Belum Bayar ke Siap Proses. Cermin memakai pengaman edit/recovery #03 dan tidak menentukan hak pickup.

**Blocked by:** #03.

**Status:** Done lokal setelah tes seam PostgreSQL, kontrak HTTP cron, review independen, dan verifikasi gabungan #04–#06; belum commit/deploy dan tidak memberi izin POST Jubelio uji/live.

## Acceptance criteria

- [x] Intent Menunggu Verifikasi hanya muncul sesudah keadaan paid-but-blocked untuk investigasi operator terkomit. Callback mentah atau sekadar masuk antrean admin (yang juga memuat paid-but-blocked `processing`) tidak menjadi trigger.
- [x] Jalur verifikasi cepat atau `in_flight`/`pending` tanpa blokir operator tidak mengirim label. Ketika investigasi terselesaikan lalu order `ready_for_pickup`, target cermin terbaru menjadi Siap Proses, tanpa edit basi yang mengalahkannya.
- [x] Edit gagal/ambigu tetap persisten, direkonsiliasi dengan GET tanpa POST ulang; kegagalan cermin tidak mengubah status paid, blokir settlement nyata, atau kelayakan pickup.
- [x] Tes seam per-order PostgreSQL dan respons provider terkontrol menguji tiga jalur (manual review, verifikasi singkat, sukses cepat), serta urutan intent/versi; dokumentasi alur dan log diperbarui.

**Verification (lokal, 2026-09-26):** tes seam mirror PostgreSQL + tes HTTP cron/order-complete gabungan **98 lulus, 1 environment-guard skip** (DB tersedia); parent menjalankan `npm run test:unit` **852 lulus, 2 skip, 0 gagal**, typecheck store/admin/db dan lint berkas terkait lulus. Review read-only independen menerima #04 dengan catatan: bila settlement menjadi ready setelah pembacaan kondisi blokir namun sebelum POST yang sudah diklaim, marker Menunggu Verifikasi dapat terkirim sementara. Target Siap Proses berikutnya menunggu hasil intent lama/penanganan operator; tidak dijanjikan batas waktu koreksi. Ini sejenis celah transisi lokal yang telah dicatat untuk #03, bukan izin mengulang POST ambigu. Sweep #04/#05 kini menyaring SO id yang tidak positif agar baris malformed tidak menghabiskan jendela berbatas (dua tes red→green tambahan). Tidak ada E2E karena UI/routing tidak berubah, atau request provider nyata, commit, push, maupun deployment.
