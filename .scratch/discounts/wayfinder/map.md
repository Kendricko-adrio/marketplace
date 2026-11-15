# Wayfinder Desain Diskon

Label: wayfinder:map

## Destination

Menyelesaikan keputusan produk, finansial, UX, schema, dan integrasi agar dapat dibuat spec diskon lengkap yang siap direview pemilik: harga coret persisten per SKU dengan bulk adjustment Excel, kupon publik/kode promo, perhitungan checkout dan redemption yang aman, mapping Jubelio, serta desain database yang extensible.

Map menghasilkan keputusan untuk spec yang bisa direview, bukan persetujuan implementasi. Persetujuan complete spec serta breakdown/publikasi implementation tickets tetap menjadi gates terpisah.

## Notes

### Keputusan awal dan persetujuan publikasi

Pemilik memilih spec lengkap siap direview sebagai destination dan secara eksplisit menyetujui [proposal Wayfinder lengkap](../research/discount-wayfinder-proposal.md): 12 pertanyaan keputusan, jenis tiket, dependency graph, batasan, dan publikasi di `.scratch/discounts/`. Persetujuan diberikan melalui `ask_user_question` dengan memilih **Setujui dan publikasikan (Recommended)**. Charting tidak menyelesaikan child; semuanya dipublikasikan open/unclaimed.

Keputusan dari percakapan dan charting sebelumnya, bukan jawaban child yang dibuat-buat:

- Website mengelola diskon; Jubelio menyediakan base price sebelum diskon dan mengelola inventory/sales.
- Harga coret merupakan adjustment harga SKU persisten untuk clearance/dead stock, bukan campaign/event wajib.
- Satu harga akhir tetap per SKU berlaku di semua cabang. Input persentase menghitung harga tetap saat konfirmasi, bukan aturan persentase berkelanjutan.
- Harga coret boleh digabung dengan maksimal satu kupon ATAU satu kode promo manual, dengan satu slot bersama untuk barang/ongkir.
- Benefit awal: persentase barang dengan plafon opsional, nominal per order, dan subsidi ongkir. Klarifikasi pemilik pada sesi tiket 02: kupon/kode barang general untuk seluruh barang order pada harga setelah markdown; targeting produk/kategori/brand bukan scope fase ini. Contoh Rp450.000 × 10%, cap Rp20.000 → net barang Rp430.000 sebelum pajak/ongkir/fee.
- Customer memilih kupon publik langsung tanpa prior claim.
- Excel boleh menerapkan baris valid sambil menjelaskan setiap baris invalid; 97 sukses dan tiga error tidak boleh dilaporkan seolah seluruh 100 baris berhasil.
- Potongan barang website harus tercatat sebagai diskon SO Jubelio, bukan workaround penurunan unit price dengan diskon nol atau pembayaran provider yang dinaikkan.
- Desain extension masuk scope; implementasi benefit lanjutan bukan scope awal.

Jangan menanyakan ulang keputusan tersebut kecuali jawaban berikutnya menyebabkan perubahan scope eksplisit. Rekomendasi research yang tersisa, termasuk kuota, pembulatan, pajak, refund, dan perubahan base price, bukan default yang telah disetujui.

### Referensi, tracker, dan disiplin sesi

- [Tracker Local Markdown](../../../docs/agents/issue-tracker.md) mengatur status/claim/blocking. Map ini bukan indeks status conceptual plan kedua; [.scratch/discounts/index.md](../index.md) tetap menjadi sumber status conceptual plan.
- Referensi awal: [research diskon/produk/admin/Jubelio](../research/discounts-coupons-promo-codes.md), [research database](../research/discount-database-design.md), [glossary domain](../../../CONTEXT.md#product-pricing-and-promotions), [sales flow provider](../../../docs/features/jubelio-sales-orders.md), dan [nominal delivery](../../../docs/features/delivery-orders.md).
- Muat `development-workflow`, skill `grilling` yang sebenarnya, serta `domain-modeling` pada setiap sesi keputusan. Semua round memakai `ask_user_question` dan hanya dimulai setelah prerequisite diselesaikan. Pemeriksaan fakta adalah pekerjaan agent; jangan menjawab keputusan pemilik sendiri.
- Dokumen yang dihasilkan, termasuk map, tiket, artefak, dan jawaban berikutnya, menggunakan bahasa Indonesia sesuai [AGENTS.md](../../../AGENTS.md#6-communication-with-the-user). Istilah teknis umum dan metadata tracker tetap dipertahankan.
- Temukan child open melalui `.scratch/discounts/wayfinder/`, bukan daftar tiket open yang diduplikasi di map. Pilih child pertama yang open, unblocked, dan unclaimed kecuali pemilik menyebut yang lain. Ubah menjadi `Status: claimed` sebelum bekerja. Metadata `Blocked by` authoritative; blocker selesai hanya ketika child prerequisite resolved.
- Maksimal satu child keputusan HITL per sesi menurut wayfinder; pengecualian research tidak mengizinkan subagent atau provider writes. Charting tidak menyelesaikan child.
- Untuk child UX, muat `prototype` dan `frontend-design`; scope hanya wireframe Markdown. Tidak ada izin prototype executable, edit aplikasi, branch, atau commit.
- Fact finding baru menggunakan research existing dan pemeriksaan langsung read-only. Subagent memerlukan izin terpisah untuk effort ini; tidak ada research fork otomatis.
- Keputusan akses/akun terisolasi dan protokol request provider aktual yang bounded memerlukan izin eksplisit terpisah. Persetujuan map tidak mengizinkan login, POST SO/invoice/payment, cancellation, mirror edit, eksperimen production, atau perubahan order existing. Write ambigu tidak pernah mengizinkan blind retry.
- Selesaikan child dengan menambahkan jawaban/bukti di child, mengubah status menjadi resolved, lalu menambahkan ringkasan satu baris dengan link bernama di Decisions so far. Artefak diberi link, bukan disalin seluruhnya ke map. Pertanyaan baru yang konkret tetap melalui gates scope/publikasi yang disetujui; prerequisite yang masih kabur masuk Not yet specified.
- Setelah seluruh keputusan selesai, draft spec lengkap yang bisa direview sebagai planning. Minta persetujuan eksplisit scope/acceptance criteria sebelum Ready. Publikasi implementation tickets, implementasi, delegasi, commit, dan deployment tetap memiliki gates masing-masing.
- Hasil sintesis berikutnya: [complete spec diskon](../plan/discounts-spec.md), disusun setelah pemilik mengonfirmasi kesepahaman drafting dan kemudian disetujui lengkap melalui **Setujui spec lengkap (Recommended)**. Pemilik secara terpisah menyetujui13 slices/dependency/lokasi melalui **Setujui dan publikasikan (Recommended)**; [implementation map dan tickets](../ticket/map.md) dipublikasikan terpisah. Status plan hanya di [.scratch/discounts/index.md](../index.md). Belum ada izin eksekusi implementasi/provider requests/delegasi/commit/deployment/launch.

## Decisions so far

- [Eligibility Offer dan Dasar Perhitungan Diskon](02-offer-eligibility-and-money-basis.md#answer--keputusan-final-disetujui): resolved setelah konfirmasi pemilik; diskon barang general setelah markdown, plafon persentase opsional, minimum subtotal barang, clipping nominal, subsidi ongkir delivery, pembulatan/alokasi deterministik, serta aturan nol dan waktu aktif disepakati.

- [Kebijakan base price dan Hapus Markdown](01-markdown-base-drift-and-restore.md): fallback sementara ke base jika base ≤ target, aktif kembali saat base > target; Hapus mengikuti base terbaru, tindakan admin memakai data terbaru jika valid, dan snapshot order tetap.

- [Kontrak bulk adjustment dan partial import](05-bulk-adjustment-and-partial-import.md): Excel harga akhir/restore eksplisit, limit di `system_config`, apply bertahap dengan data terbaru, laporan partial akurat, dan retry subset gagal tanpa mengulang sukses.

- [Akses dan Izin Verifikasi Jubelio](07-jubelio-verification-access-and-permissions.md#answer): resolved; akses sandbox dan login terbukti, pemilik mengizinkan suite maksimal 5 SO serta invoice/payment/cancellation/marker pada fixtures disposable; kebijakan finance dan bukti lengkap tetap terpisah.

- [Perhitungan Pajak dan Subsidi Ongkir](04-tax-and-shipping-subsidy-accounting.md#answer--keputusan-final-disetujui): resolved; PPN hanya net barang setelah Markdown/kupon, tanpa ongkir/fee; subsidi didanai merchant; PPN website/provider tetap terpisah; snapshot pembayaran tetap, koreksi hanya order baru, approval finansial oleh pemilik.

- [Limit Redemption, Identitas, dan Kebijakan Reservation](03-redemption-limits-identity-and-reservations.md#answer--keputusan-final-disetujui): kuota/budget minimal satu wajib, jatah akun default 1 dengan verified email; hold saat order dibuat, consume saat paid terverifikasi, release hanya terminal aman; retry/ambigu tetap hold, riwayat dan snapshot tidak reset.

- [Bukti Kontrak Diskon Nonzero Jubelio](08-jubelio-nonzero-discount-evidence.md#answer--scope-terpilih-terverifikasi): resolved pada scope approved—diskon per baris/add_disc0, original sebelum subsidi + net ongkir tanpa discount field, mirror/invoice/paymentqty1/qty2 dan safe cancel terverifikasi; legacy ambiguity dipisahkan, bukan proof rollback atau izin implementasi.

- [Kontrak Mapping Provider dan Settlement](09-provider-representation-and-settlement.md#answer--kontrak-lengkap-disetujui): resolved dengan approval kontrak lengkap—harga awal + diskon per baris, payable net barang/net ongkir, verifikasi ketat, snapshot/versioning dan penahanan mismatch/ambigu. [Research09 berizin terpisah](../research/research-09-post-invoice-mirror.md#hasil-kelanjutan-dan-review-main-agent) memenuhi evidence mirror post-invoice/payment pada scope M1/M2. Kewajiban pembuktian provider Rp0 kemudian dicoret oleh pemilik; bukan izin implementasi/launch.

- [Batas scope pembatalan/refund dan safety late payment](10-cancellation-refund-and-late-payment.md#answer--batas-scope-dan-safety-disetujui): resolved; refund sepenuhnya manual di luar aplikasi tanpa sync/restore pemakaian promo; safe release unpaid serta paid-but-blocked/late-payment review tetap dipertahankan, tanpa subsystem refund baru.

- [Arsitektur Schema, Retention, dan Extensibility](11-schema-retention-and-extensibility.md#answer--logical-schema-lengkap-disetujui): resolved setelah approval kontrak lengkap—relasi order/redemption/promo dan snapshot berversi, retention tanpa cascade/purge, tanpa compatibility legacy atau arsip Excel, serta extension seam-only; bukan izin implementasi atau penutupan launch gates provider.

- [UX Admin Diskon dan Authorization](06-admin-ux-and-authorization.md#answer--wireframe-dan-matriks-authorization-disetujui): resolved setelah approval wireframe/matriks lengkap—Produk untuk harga/Excel, Diskon untuk kupon/kode, tiga kewenangan harga/promo/kapasitas terpisah, kode tersamarkan bagi viewer, detail usage scoped Orders, draft/review/publish dan konflik versi; bukan approval implementasi.

- [Acceptance End-to-End dan Kesiapan Spec](12-acceptance-and-specification-readiness.md#answer--acceptance-matrix-dan-outline-spec-disetujui): resolved setelah approval [matrix/seams/outline/gates lengkap](acceptance-12-and-specification-outline.md); konfirmasi penggantian hanya jika total naik, invalid/gugur eksplisit, UAT staging lalu publik dan pause kupon terdampak; complete spec tetap memerlukan approval terpisah; status kewajiban provider mengikuti pembaruan dan koreksi scope di bawah.

- [Koreksi scope pembayaran dan service fee](decision-zero-payment-and-no-service-fee.md): pemilik menegaskan pembayaran Rp0 tidak terjadi dalam scope operasional dan dijaga prosedur admin/pemilik bisnis; website tidak mengenakan service fee. Outstanding 2 dicoret, bukan ditunda: tidak ada kewajiban pembuktian pembayaran/provider Rp0 sebagai testing requirement atau launch gate. Contoh fee Rp2.000 ditarik; catatan lama yang bertentangan telah digantikan keputusan ini.

## Not yet specified

- Evidence post-invoice mirror tersedia pada scope M1/M2 melalui research09; integration/tests aplikasi tetap belum dilakukan. **Provider Rp0 bukan outstanding atau launch blocker** sesuai [koreksi pemilik](decision-zero-payment-and-no-service-fee.md); jangan membukanya kembali dari catatan lama. Complete spec, detail teknis, automated acceptance dan staging UAT tetap pekerjaan berikutnya.
- Strategi rollout/read projection/large job akan lebih jelas setelah keputusan nominal, import, dan retention. Jangan membaginya menjadi build tickets sekarang.
- Prerequisite compliance/identity retention mungkin muncul jika dipilih limit lintas akun atau verified phone yang lebih kuat.

## Out of scope

- Implementasi aplikasi/schema/seed, migration, eksekusi tests sebagai pekerjaan delivery implementasi, implementation tickets, dan transisi Ready selama charting.
- Harga per cabang, harga coret persentase dinamis yang persisten, wallet/claim kupon, stacking beberapa kupon/kode, dan offer awal dengan beberapa benefit.
- Targeting kupon/kode berdasarkan produk/kategori/brand dan include/exclude bukan scope fase awal; catatan research terkait hanya future-only dan bukan persetujuan implementasi.
- Implementasi cashback/points, hadiah, bundle, BOGO, tiers/subscriptions, currency lain, atau channel baru; spec hanya membahas seam untuk extension.
- Prototype executable, subagent tanpa izin terpisah, fork atau commit otomatis.
- Provider writes tanpa protokol request spesifik yang disetujui terpisah; edit order existing, eksperimen production, blind retry, atau penyamaran source.
- Commit, push, SSH, publikasi issue remote, dan deployment.
