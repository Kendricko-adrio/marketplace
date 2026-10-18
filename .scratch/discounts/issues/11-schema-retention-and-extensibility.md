# Arsitektur Schema, Retention, dan Extensibility

Label: wayfinder:grilling
Type: grilling
Status: open
Assignee: none
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

## Comments

Dipublikasikan setelah proposal map lengkap disetujui. Belum ada desain schema dalam research yang diterima sebagai implementation spec.
