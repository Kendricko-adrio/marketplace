# 03: Siap Proses dengan edit SO tahan crash

**Parent:** [Spesifikasi Ready — cermin Status Channel](../spec-draft.md) · [bukti edit sekali](../edit-channel-status-results-2026-09-26.md) · [bukti jurnal terbatas](../accounting-one-shot-results.md)

**What to build:** Operator melihat **Siap Proses** di Status Channel hanya setelah invoice **dan** payment Jubelio terverifikasi dan order lokal sudah `ready_for_pickup`. Ini irisan pertama untuk cermin pasca-create: intent persisten → satu klaim dispatch → edit full-payload yang fail-closed → GET verifikasi/recovery. Kegagalan cermin tidak menghalangi pickup yang sah. Jangan memecah ledger menjadi tiket horizontal tanpa perilaku yang dapat diverifikasi.

**Blocked by:** #02.

**Status:** Done lokal setelah tes PostgreSQL/gateway/cron dan review read-only independen; belum commit/deploy, tidak memberi izin POST Jubelio uji/live.

## Acceptance criteria

- [x] Target **Siap Proses** berasal dari status lokal yang *sudah commit* beserta invoice/payment terverifikasi; `paid` Midtrans saja atau `in_flight` tidak cukup. Status lokal dan izin pickup tetap otoritatif.
- [x] Intent bertahap/berversi dan SO ID tercatat sebelum POST. Klaim atomik per SO menjamin dua pemanggil webhook/sweep tidak mengirim dua edit untuk intent yang sama; target baru tidak mendahului edit lama yang mungkin terkirim.
- [x] GET pra-edit dan payload allowlist full-save mempertahankan SO ID/nomor, ID detail, source, lokasi, item, jumlah, harga, uang, invoice link, serta field wajib yang tervalidasi. GET pasca-edit memeriksa marker dan atribut inti. SO berubah, canceled, data wajib hilang, atau payload berisiko menulis ulang item/uang → **nol POST edit**, catatan mismatch tahan crash dan log terstruktur aman dari PII.
- [x] Timeout/5xx/respons rusak/crash sesudah klaim ditandai *possibly sent*; sweep berbatas hanya GET menggunakan SO ID tersimpan, tanpa re-POST otomatis. Mismatch/unknown dapat dicari dari order/SO melalui mekanisme operasional terdokumentasi, tanpa perluasan antrean/UI admin.
- [x] Rekonsiliasi menemukan intent order `ready_for_pickup` ataupun terminal, tidak hanya `processing + paid`. Kegagalan cermin tidak mengubah payment status, pickup code, blokir fulfillment, atau izin verify-pickup; schema/seeder, dokumen feature, serta dokumen deployment bila cron/env berubah diperbarui.
- [x] Tes seam per-order dengan PostgreSQL dan respons provider terkontrol membuktikan race/crash/GET-only/noninterferensi; tes boundary gateway memeriksa full-payload dan satu POST. Hasil mock/HTTP 200 tidak diklaim sebagai bukti keamanan finansial universal.

**Verification (lokal, 2026-09-26):** parent menjalankan `npm run db:push` lalu memverifikasi tabel intent dan index unik parsial per SO; `npm run test:unit`: **790 lulus, 2 skip, 0 gagal** (tes seam mirror PostgreSQL **42 lulus**, 1 environment-blocker skip karena DB tersedia). Tes gateway edit, settlement, cron HTTP, typecheck store/DB, dan ESLint berkas #03 lulus; review read-only independen menerima perbaikan blocker kode provider `EDIT_` serta disposisi `pending` terminal dengan abort atomik dan versi baru setelah late-ready. Tidak ada request Jubelio nyata, E2E (tidak ada perubahan UI/routing), commit, push, atau deployment. `npm run lint:store` menyeluruh masih gagal pada `apps/store/src/components/Header.tsx:39` yang tidak berubah dan di luar #03.

**Risiko residual:** tidak ada compare-and-swap vendor antara GET dan POST (risiko yang diterima pemilik dalam spesifikasi); sweep dibatasi jumlah baris tetapi belum memiliki deadline internal sehingga dapat melewati timeout cron 55 detik bila provider melambat. Ada celah waktu kecil antara pembacaan status lokal `ready_for_pickup` dan POST edit bila order berubah ke `completed`; target berikutnya ditangani tiket #06. Cermin tetap best effort dan tidak mengubah izin pickup. Investigation/rejected membutuhkan tindakan operator tersendiri; contoh pencarian ada di `docs/features/jubelio-sales-orders.md`. Bukti provider satu fixture bukan sertifikasi keamanan finansial universal.
