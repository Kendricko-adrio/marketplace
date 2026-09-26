# 05: Gagal Bayar dan pembayaran terlambat tanpa marker basi

**Parent:** [Spesifikasi Ready — cermin Status Channel](../spec-draft.md)

**What to build:** Setelah order benar-benar `failed_payment`, SO yang masih aktif **dan aman diedit** dapat menampilkan **Gagal Bayar**. Jika jalur pembatalan SO telah dimulai atau dikonfirmasi, **lewati edit dan simpan mismatch persisten**; marker di Jubelio boleh tertinggal, sedangkan pembatalan/pelepasan stok tidak ditunda. Jika pembayaran datang terlambat, cermin mengikuti keadaan lokal terbaru yang aman, bukan mengirim ulang marker lama.

**Blocked by:** #04 (late-paid yang memerlukan investigasi operator memakai perilaku #04).

**Status:** Done lokal setelah tes seam PostgreSQL/race cancel, review independen, dan verifikasi gabungan #04–#06; belum commit/deploy dan tidak memberi izin POST Jubelio uji/live.

## Acceptance criteria

- [x] Satu penolakan metode bayar yang nonterminal tidak memicu Gagal Bayar; tanpa SO create terkonfirmasi tidak ada edit marker. Target hanya berasal dari transisi status lokal yang sudah commit.
- [x] Begitu intent cancel SO dimulai, mungkin-terkirim, atau terkonfirmasi—atau GET menunjukkan SO telah canceled—tidak ada POST edit Gagal Bayar, termasuk dari intent cermin pending/sweep yang berpacu dengan cancel. Mismatch dan alasan aman dari PII disimpan serta dicatat terstruktur, tanpa menunda cancel atau melepas hold sebelum aturan lama terpenuhi.
- [x] Jika cancel tidak pernah dimulai dan SO masih aktif, edit yang aman memakai klaim at-most-once, full-save fail-closed, dan GET sebagaimana #03; ambiguitas tidak memberi izin POST kedua.
- [x] Late settlement sesudah cancel yang dimulai tetap paid-but-blocked/manual investigation menurut alur lama; jika settlement selanjutnya benar-benar diverifikasi dan lokal menjadi `ready_for_pickup`, proyeksi mengikuti Siap Proses. Target Gagal Bayar lama yang ambigu tidak diterobos atau dikirim ulang buta.
- [x] Tes seam per-order PostgreSQL untuk transisi gagal, race cancel vs intent/dispatch dan late-paid menunjukkan **nol POST edit** ketika cancel sudah dimulai, serta catatan mismatch yang dapat ditemukan; dokumentasi fitur diperbarui.

**Verification (lokal, 2026-09-26):** tes seam mirror PostgreSQL + tes HTTP cron/order-complete gabungan **98 lulus, 1 environment-guard skip** (DB tersedia); parent menjalankan `npm run test:unit` **852 lulus, 2 skip, 0 gagal**, typecheck store/admin/db serta lint berkas terkait lulus. Review independen menerima #05. Klaim Gagal Bayar memeriksa cancel aktif secara atomik; setelah GET/persist snapshot, pemilik klaim memeriksa lagi tepat sebelum POST. Tes balapan membuktikan nol POST saat cancel sudah terkomit di batas-batas tersebut; masih ada celah sangat kecil antara pemeriksaan terakhir dan POST karena vendor tidak menyediakan CAS, sesuai risiko residual spesifikasi. Marker diproyeksikan oleh sweep terjadwal, bukan hook baru di jalur fail; SO/provider nyata tidak disentuh. Tidak ada E2E (UI/routing tidak berubah), commit, push, atau deployment.
