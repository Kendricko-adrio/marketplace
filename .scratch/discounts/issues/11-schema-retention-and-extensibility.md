# Arsitektur Schema, Retention, dan Extensibility

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: 01, 05, 03, 09, 10
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Schema dan kontrak transaksi/snapshot final apa yang merepresentasikan perilaku yang sudah disetujui tanpa menggeneralisasi mekanisme masa depan secara berlebihan?

Putuskan current/history markdown dan baris partial import; identity/revision/benefit/condition/typed targets offer; ownership kode dan kapasitas bersama per akun/identitas lebih kuat jika dipilih; reservation/events/allocations; idempotency checkout; nominal lokal/provider immutable; indexes dan bounded lock ordering; counter used voucher legacy tanpa bukti personal; retention untuk cascade client/order; seeds dan deployment kompatibel; extensions bertipe/berversi dan ledger yang diperlukan nanti.

## Referensi dan batasan

- [Proposal research database](../../../plan/research/discount-database-design.md).
- Jawaban resolved wajib dari Kebijakan Perubahan Base Price dan Restore Harga Coret; Kontrak Bulk Adjustment dan Partial Import; Limit Redemption, Identitas, dan Kebijakan Reservation; Kontrak Mapping Provider dan Settlement; serta Kebijakan Pembatalan, Refund, dan Pembayaran Terlambat.
- [Kepemilikan schema, timestamps, dan seeding](../../../docs/architecture/database.md).
- [Schema voucher legacy](../../../packages/db/src/schema/marketing.ts).
- [Relasi order/client saat ini](../../../packages/db/src/schema/orders.ts).
- [Ledger provider existing](../../../packages/db/src/schema/jubelio-sales.ts).

Jumlah/nama tabel, JSON extensions, dan constraints dalam research masih usulan. Harga tetap lintas cabang dan kupon publik tanpa prior claim sudah disepakati. Benefit baru tetap memerlukan evaluator/testing dan kadang migration/ledger khusus; database yang fleksibel tidak berarti izin menjalankan kode bebas atau aturan stacking baru.

## Bukti penyelesaian

Logical schema final yang direview pemilik, matriks tanggung jawab constraint/transaksi, contoh use case independen, kebijakan retention/counter legacy, serta strategi compatibility/extension. Jangan mengarang riwayat redemption per customer atau mereset usage nyata tanpa kebijakan yang disetujui.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `grilling`, `domain-modeling`, `codebase-design`, `development-workflow`, dan research existing. Hanya artefak planning/pemeriksaan read-only. Tidak ada edit shared schema, generated SQL, migration execution, seed, build/test/lint/typecheck, request provider, atau subagent.

## Keputusan sesi — Ronde 1

Jawaban pemilik melalui `ask_user_question`; belum approval logical schema/kontrak lengkap:

- Akun/order yang memiliki transaksi dan histori promo dilindungi dari hard-delete. Tidak membangun workflow penghapusan/anonimisasi baru pada fase awal.
- Pemilik menegaskan aplikasi belum running. Voucher legacy berarti sistem voucher existing, tetapi compatibility fitur lama, migrasi pemakaian, dan backfill personal tidak perlu menjadi scope desain ini. Tidak perlu mempertahankan fitur existing yang menghambat desain baru. Ini bukan izin menjalankan reset/delete data; tidak ada histori personal atau saldo budget yang boleh dikarang.
- Extensibility berupa seam dan kontrak parameter bertipe/berversi. Tabel targeting produk/kategori/brand serta ledger reward/cashback tidak dibuat sebelum fiturnya disetujui.

### Ronde 2 — retention dan kode

- Tidak ada purge otomatis histori harga/promo, hasil import, snapshot, pemakaian, atau events pada fase awal. Ini keputusan aplikasi, bukan penetapan masa retensi legal.
- File Excel asli tidak diarsipkan. Simpan catatan baris, status/error, actor, dan perubahan aktual; laporan dapat dibentuk dari catatan tersebut.
- Teks kode yang pernah diterbitkan tetap dimiliki promo asal dan tidak boleh digunakan oleh promo lain, termasuk setelah diarsipkan.

### Ronde 3 — jalur aktivasi

- Satu promo hanya memiliki satu jalur aktivasi pada fase awal: Coupon publik melalui picker, atau Manual Promo Code melalui input kode. Tidak ada promo dengan kedua jalur sekaligus.
- Beberapa kode pada promo manual tetap berbagi identitas promo, kuota, budget, dan jatah akun sesuai tiket 03. Tidak ada perpindahan kode ke promo lain.

### Checkpoint kesepahaman

Pemilik mengonfirmasi rangkuman sesi melalui `ask_user_question` dengan jawaban “Iya sesuai”, sekaligus menanyakan apakah desain memiliki relasi order dengan voucher/kode seperti `HEMAT17AGUSTUS`. Rangkuman yang dikonfirmasi mencakup Markdown current/history dan hasil import, identitas/revision promo dengan satu benefit dan jalur aktivasi terpisah, snapshot/alokasi/reservation/events serta idempotency checkout, retention, pengabaian compatibility/backfill legacy, dan extension berupa seam saja. Draft logical schema boleh disusun untuk direview; ini belum approval desain lengkap atau izin implementasi. Klarifikasi relasi: usulan menghubungkan order ke satu redemption, lalu ke identitas promo, revision yang dipakai, dan code bila aktivasi manual; Coupon publik tidak memiliki code. Relasi ini belum diimplementasikan.

### Draft logical schema lengkap

Pemilik kemudian menyetujui penjelasan relasi order–promo dan mengizinkan close jika tidak ada item grilling tersisa. Tidak ada frontier keputusan produk tambahan. Untuk memenuhi bukti penyelesaian serta gate review dokumen lengkap, agent menyusun [draft logical schema, retention, dan extension](../contract-11-schema-retention-and-extensibility.md). Draft memuat logical records/cardinality, constraint-versus-transaction matrix, snapshot nominal/provider, lock ordering/indexes, contoh independen, retention/legacy, seed/deployment dan extension strategy. [Glossary domain](../../../CONTEXT.md#product-pricing-and-promotions) ditambah istilah Offer, Offer Revision, Redemption, dan Promo Reservation dari keputusan yang sudah dikonfirmasi.

Pada checkpoint draft, status tetap claimed hingga pemilik menyetujui dokumen lengkap yang baru tersedia; approval akhir dicatat di bawah. Tidak ada implementasi atau provider request. Pemeriksaan dokumen dan `git diff --check` pada dokumen tracked tidak menemukan whitespace error; warning LF/CRLF dari Git bukan kegagalan test. Unit/E2E/build/lint/typecheck tidak dijalankan karena sesi planning-only.

## Answer — logical schema lengkap disetujui

Pemilik menyetujui [kontrak logical schema, retention, dan extension lengkap](../contract-11-schema-retention-and-extensibility.md) melalui `ask_user_question` dengan memilih **Setuju, tutup tiket (Recommended)** setelah menerima link reviewable dan ringkasan cakupan. Tidak ada frontier grilling tersisa; tiket resolved sebagai keputusan planning, bukan approval implementasi atau kesiapan launch.

- Markdown current/history dan batch/row results terpisah; apply row atomik, bounded dan retry-safe; file Excel asli tidak diarsipkan.
- Stable offer/revision dan tepat satu benefit saat publish. Satu jalur aktivasi per promo: public picker atau manual code. Semua kode pada promo manual berbagi kapasitas; literal/owner kode yang diterbitkan tidak dapat dialihkan.
- Order memiliki maksimal satu redemption yang menghubungkan offer/revision/code, ditambah immutable money snapshots dan component allocations. Reservation/events, projection usage dan checkout idempotency mempunyai kontrak transaksi serta ownership yang eksplisit.
- Matriks DB constraint versus transaksi, urutan lock target, indexes dan contoh nominal independen tersedia pada kontrak. Detail physical implementation/bounded execution dan verifikasi concurrency tetap pekerjaan complete spec/implementasi.
- Hard-delete client/order bertransaksi diblokir; FK retention tidak menghapus evidence via cascade. Histori tanpa purge otomatis; bukan keputusan masa retensi legal atau workflow anonimisasi.
- Karena aplikasi belum running, tidak ada compatibility/backfill voucher legacy; tidak mengarang histori personal, membuka saldo budget fiktif, atau menjalankan reset/delete data.
- Extension cukup seam/typed versioned params; tidak ada tabel targeting/condition engine generik atau ledger cashback/reward/refund fase awal. Seed/deployment/version compatibility harus mengikuti kontrak saat implementasi.

Pada approval awal, dua launch gates provider09 masih terbuka. Status terkini: evidence mirror M1/M2 tersedia; kewajiban pembuktian pembayaran/provider Rp0 dicoret pemilik, bukan ditunda, sesuai [koreksi scope tanpa service fee](../decision-zero-payment-and-no-service-fee.md). Catatan gate lama bukan kewajiban aktif. Tidak ada perubahan shared schema/app/config/seed, SQL/migration, unit/E2E/build/lint/typecheck, provider request, subagent, commit atau deployment. Hanya dokumen planning/glossary/tracker dan pemeriksaan lokal read-only.

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Belum ada desain schema dalam research yang diterima sebagai implementation spec.
