# Koordinasi Recovery Manual dan Sistem

Label: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 06
Parent: [Recovery Transaksi Jubelio dan Tindak Lanjut Terpadu](../map.md)

## Pertanyaan

Bagaimana recovery yang dipicu admin, settlement/sweep workers existing, dan tindakan operator bersamaan dikoordinasikan dengan tetap menjaga hasil yang sesuai bukti serta attempt history yang durable?

Putuskan kontrak operasional yang dapat diamati; detail implementasi service/schema tetap menjadi pekerjaan engineering pada spec berikutnya:

- Tindakan yang secara eksplisit manual dibandingkan otomatis, dan apakah automation baru diinginkan setelah safe eligibility ditetapkan. Dukungan sweep existing bukan jaminan retry universal.
- Cara menampilkan tindakan in-progress, bagaimana admin mengetahui hasil sudah selesai atau proses stalled, dan bukti yang mengizinkan takeover atau repair lokal. Timer saja tidak boleh mengizinkan replay POST yang hasilnya belum pasti.
- Cara dua operator, duplicate clicks, webhook, dan sweep bekerja bersama; actor yang kalah/stale tidak boleh dispatch write kedua atau menimpa bukti verified yang lebih baru.
- Hasil yang membedakan verifikasi remote, repair lokal, pekerjaan queued, verifikasi pending, hasil unresolved, dan success. Jangan menyatakan operasi berhasil hanya karena sudah masuk queue.
- Cooldown yang terlihat pengguna, batas pemeriksaan ulang, bounded backoff atau ekspektasi eskalasi bila relevan; nilainya tidak diwarisi dari contoh research.
- Kebutuhan history attempt/actor/time/proof/result dan audit attribution; pemicu manual harus dapat dibedakan dari reconciliation sistem.
- Perlakuan saat success provider terbukti tetapi persistence/audit/repair metadata lokal gagal, termasuk respons browser hilang dan reload follow-up.
- Pemilik authority recovery pada batas admin/store tanpa memakai auth instance yang salah atau mengekspos internal credentials ke browser.

## Bukti dan batasan

- [Retry Aman dan Kelanjutan Operasi Pertama](06-safe-retry-and-first-time-continuation.md) beserta prasyaratnya.
- [Research: gap persistence dan respons hilang](../../../plan/research/jubelio-transaction-recovery-admin.md#7-current-recovery-gaps-to-account-for).
- [Sweep](../../../apps/store/src/app/api/cron/sweep-reservations/route.ts), [reconciliation settlement](../../../apps/store/src/lib/jubelio-sales-settlement.ts), dan [durable claims/accounting](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts).
- [Contoh completion admin-to-store existing](../../../apps/admin/src/app/api/admin/orders/[id]/verify-pickup/route.ts): bukti batas service existing, bukan desain recovery API yang sudah dipilih.
- [Arsitektur auth](../../../docs/architecture/auth.md), [aturan audit](../../../docs/features/audit-log.md), dan [safety setelah tindakan admin](../../../docs/features/admin-delivery-workflow.md).

Jumlah write retry atau lamanya waktu tunggu tidak menggantikan bukti bahwa transaksi tidak diterapkan. Ticket ini tidak mengizinkan eksperimen provider otomatis atau deployment scheduler.

## Bukti penyelesaian

Catat ownership tindakan/sistem, ekspektasi pemicu/hasil, pilihan timing, kebutuhan audit, dan walkthrough:

- HQ dan sweep mencapai operasi eligible yang sama; hanya satu dispatch ke provider.
- GET tetap gagal setelah pemeriksaan berulang; status pending/eskalasi sesuai bukti, bukan false failure/success.
- Operasi remote confirmed tetapi accounting/audit lokal gagal selesai; repair tanpa POST lain.
- Backend menyelesaikan write tetapi browser kehilangan respons; baca state terbaru sebelum tindakan berikutnya.
- Permission recovery dicabut ketika pekerjaan pending: jelaskan checks saat submission/execution dan attribution tanpa melemahkan Current Policy.

Pertahankan kontrak sesuai scope tindakan yang dipilih; kebijakan SLA/assignment/komunikasi baru berada di luar scope.

## Batas pekerjaan

Dokumen planning dan diskusi pengguna; claim terlebih dahulu dan load skills yang diwajibkan map. Tidak ada perubahan worker/cron/config/env, DB, test runs, internal calls, provider requests, deployment, atau delegation. Jangan menyelesaikan wireframes pada sesi ini.

## Komentar

Dipublikasikan pada 2026-10-13 setelah approval pengguna. Publikasi tidak menyiratkan keputusan timing, automation, coordinator, atau ownership.
