# 03 — Markdown manual dari admin sampai pembayaran

Label: ready-for-agent
Type: task
Status: open
Assignee: none
Blocked by: 02
Parent: [Map implementasi diskon](../map.md)
Spec: [Complete spec](../../../plan/discounts-spec.md)
Acceptance IDs: M01, M02, M03, F02, T06, P01, P02, P03, A01, A04, D01, D02

## Perilaku yang dibangun

Admin berwenang mengubah/menghapus Markdown satu SKU melalui stage→review→apply. Customer melihat harga SKU yang sama pada seluruh cabang dan seluruh surface, lalu membayar nominal tersebut; potongan tercatat sebagai whole-line discount di Jubelio, bukan source price diturunkan atau payment dinaikkan.

Reuse checkout review/idempotency02 dan snapshot01. Buat batch satu-row/manual dengan durable result/revision/audit yang dapat diperluas04, bukan direct-update bypass.

## Acceptance criteria

- [ ] Base SKU300000/target150000 → effective150000; katalog/homepage/detail/cart/preview/checkout konsisten. Coretan berasal dari variant yang sama, bukan group RRP atau harga variant lain. Filter/sort/range memakai effective projection yang sama.
- [ ] Base menjadi120000 atau sama150000 → tanpa coretan/badge, target tetap tersimpan; base naik400000 → target150000 aktif kembali. Harga sama antar-cabang, stock tetap branch-scoped; sync source tidak menghapus/menimpa target.
- [ ] Target baru positif dan di bawah source terbaru saat apply; stale source/Markdown memakai data terbaru tanpa review ulang wajib. Restore melepas Markdown terbaru, memakai base terbaru, tidak menghidupkan target lama lagi. Histori/version monotonic tetap.
- [ ] Review admin menunjukkan actual current/base/target/dampak, termasuk kenaikan. Apply/result/revision/current pointer/audit satu transaksi; replay tidak membuat perubahan/audit ganda. No-op tidak membuat revision fiktif.
- [ ] `prices:view/edit` dan products view-all ditegakkan pada direct URL/API/history/stage/apply. Re-sync permission bukan harga permission; fresh HQ defaults sesuai spec, custom roles tidak auto-grant. Roles ceiling/coverage/current policy termasuk revoke race tetap berlaku.
- [ ] Order contoh source300000→target150000, PPN11% → customer166500/provider150000; provider price300000/disc_amount150000 whole-line, add_disc0/tax0/fee0. Qty2 tidak mengalikan diskon dua kali.
- [ ] Order/request/snapshots lama tidak direprice setelah set/restore/source sync. Review checkout yang stale ditolak sebelum order commit; replay accepted order tetap sama.
- [ ] Create/invoice/payment/recovery/mirror mendukung kontrak diskon baru dengan independent expected money/IDs/linkage verification. Mirror pre/post invoice informational, preserve money/IDs dan omit shipping discount field. Zero-discount guard dilonggarkan hanya pada validated versioned path, bukan dihapus global.
- [ ] Mismatch1/timeout/5xx/missing ID/GET fail menahan tahap berikut, menjaga intent/known IDs dan paid-but-blocked. Tidak blind retry/cancel ambigu. Bukti M1/M2 dipakai bounded, bukan dites ulang otomatis.
- [ ] FK revision/current/variant/order references menjaga histori, schema/seed/shared projection dan logs/docs ikut diperbarui; writer gate tetap0 di environment operasional.

## Verifikasi

L/H/B: seluruh surface, variant pairing/filter/sort dan fallback/restore dengan source updates terkendali. T real PG: concurrent apply/source update, one-row replay/no-op/current grants, audit actual before-after dan retention SQL seam. H external controlled SO→invoice→payment→mirror dengan literal independent qty1/qty2; B admin review sampai store checkout/detail/repayment. Pertahankan tests baseline01/02.

## Batas dan penyelesaian

Bulk/Excel ditangani04/05; jangan membangun seluruh import pipeline di sini. Tidak ada Offer/Redemption, service fee atau proof pembayaran/provider Rp0. Baca [kontrak bersama](../map.md#kontrak-bersama-untuk-semua-ticket); izin eksekusi dan semua tindakan sensitif tetap terpisah. Main agent menjalankan tests/review dan merekam Answer sebelum resolved.
