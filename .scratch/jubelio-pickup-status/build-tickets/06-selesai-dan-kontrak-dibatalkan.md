# 06: Selesai setelah pickup; Dibatalkan tetap future-facing

**Parent:** [Spesifikasi Ready — cermin Status Channel](../spec-draft.md)

**What to build:** Sesudah order store benar-benar berstatus `completed`, operator melihat **Selesai** pada Status Channel secara best effort, termasuk ketika respons store ke admin gagal tetapi completion lokal sudah commit. **Dibatalkan** tetap pemetaan untuk status lokal `cancelled` di masa depan: belum ada penulis runtime untuk status itu dan tiket ini tidak menambah jalur pembatalan baru.

**Blocked by:** #03. Secara teknis tidak menunggu #04/#05; jangan menjalankan penulis paralel pada kode yang sama tanpa batas kepemilikan/integrasi yang aman.

**Status:** Done lokal setelah integrasi conflict-aware dengan #04/#05, tes PostgreSQL/HTTP, review independen, dan verifikasi gabungan; belum commit/deploy dan tidak memberi izin POST Jubelio uji/live.

## Acceptance criteria

- [x] Selesai dipicu hanya dari transisi `completed` yang sudah commit, bukan dari keberhasilan verifikasi kode yang belum menyelesaikan order atau status HTTP admin semata.
- [x] Timeout/ambiguity edit tidak membatalkan pickup/audit completion. Recovery menemukan order completed, melakukan GET dengan SO ID yang diketahui tanpa POST ulang, serta menjaga urutan target.
- [x] Pemetaan Dibatalkan diuji hanya untuk transisi `cancelled` yang sah bila kelak tersedia; tanpa jalur runtime aktif, tidak membuat API/UI cancel baru atau menjanjikan E2E yang belum mungkin.
- [x] Tes seam per-order PostgreSQL untuk completion dan respons admin yang ambigu; tes endpoint pickup/store yang terdampak, serta Playwright bila UI/routing berubah. Dokumentasi final-state mismatch dan aturan pickup diperbarui tanpa menjadikan channel marker sebagai syarat verify-pickup.

**Verification (lokal, 2026-09-26):** parent menjalankan seam mirror PostgreSQL + kontrak HTTP cron/order-complete **98 lulus, 1 environment-guard skip**, serta `npm run test:unit` **852 lulus, 2 skip, 0 gagal**; typecheck store/admin/db dan lint berkas terkait lulus. Integrasi dari worktree isolasi hanya memindahkan delta #06 dan mempertahankan #04/#05. Tes red→green membuktikan completed→Selesai, pending Selesai yang valid tetap dispatchable pada batas tulis (invoice/payment/create id harus positif), crash/GET-only recovery, serta Dibatalkan mapping-only tanpa runtime dispatch. Review read-only independen menerima #06. Tidak ada Playwright karena UI/routing tidak berubah; tidak ada provider nyata, commit, push, atau deployment. Risiko residual vendor GET→POST tanpa CAS dan jeda sweep tetap berlaku.
