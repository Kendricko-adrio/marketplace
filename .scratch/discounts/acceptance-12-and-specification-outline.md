# Acceptance diskon dan outline complete spec

Status: **Disetujui pemilik** — artefak keputusan planning tiket 12.
Sumber: [Acceptance End-to-End dan Kesiapan Spec](issues/12-acceptance-and-specification-readiness.md).

**Koreksi scope pemilik sesudah approval awal:** [tanpa pembayaran Rp0 dan tanpa service fee](decision-zero-payment-and-no-service-fee.md). Outstanding 2 dicoret, bukan ditunda; pembuktian pembayaran/provider Rp0 bukan acceptance requirement atau launch gate. Catatan approval lama di §9 adalah histori.

Dokumen ini menggabungkan keputusan menjadi acceptance matrix, test seams, gates, dan outline spec. Bukan complete implementation spec, hasil tests fitur, persetujuan Ready, atau izin implementasi/provider request/deployment.

## 1. Kesepahaman dan batas

Pemilik mengonfirmasi rangkuman melalui `ask_user_question` dengan memilih **Sesuai, buat draft (Recommended)**. Setelah menerima dokumen lengkap dan ringkasannya, pemilik menyetujuinya melalui **Setuju, tutup tiket 12 (Recommended)**. Approval mencakup acceptance matrix, test seams, outline dan gates di sini; bukan complete implementation spec.

Keputusan sesi:

- Coupon publik dan Manual Promo Code memakai satu slot bersama untuk barang/ongkir, di samping Markdown. Memilih promo lain adalah penggantian, bukan stacking.
- Sebelum order dibuat, penggantian promo valid meminta konfirmasi tambahan hanya jika **total pembayaran final naik**. Jika sama/turun, Pilih/Terapkan langsung mengganti promo dan menampilkan total baru. Membatalkan konfirmasi mempertahankan pilihan lama.
- Percobaan kode invalid/kehabisan kuota tidak mengganti promo lama yang masih valid. Jika promo lama sendiri sudah tidak valid, berlaku penanganan promo gugur di bawah.
- Kupon publik relevan yang belum eligible terlihat disabled beserta alasan. Ini bukan publikasi kode manual tersembunyi atau janji reservation.
- Promo terpilih yang gugur akibat perubahan cart/fulfillment memerlukan pilihan ulang: promo lain atau persetujuan eksplisit Lanjut tanpa promo dengan total baru. Tidak diam-diam menaikkan tagihan.
- Setelah development dan automated tests, pemilik serta tester melakukan UAT di staging; kemudian rilis langsung publik. Tidak ada cohort pengguna internal terpisah di production. Pilihan awal “internal lalu publik” dikoreksi karena pemilik sebelumnya mengira itu pemisahan tests aplikasi dan API external.
- Jika satu kupon salah hitung sementara checkout lain terbukti aman, hentikan kupon itu untuk order baru. Alur yang belum terbukti aman ditahan jika dampak meluas/belum jelas. Tidak menambah emergency-switch subsystem atau mengubah nominal order yang sudah dibuat.

Keputusan prerequisite tetap berlaku: tidak ada prior claim, multi-benefit/stacking offer, harga per cabang, targeting produk/kategori/brand, background Excel job, refund/retur aplikasi, migrasi/backfill usage voucher legacy, atau reward/cashback. Tidak membuat konfigurasi/endpoint/permission fisik baru melalui dokumen acceptance ini.

## 2. Sumber keputusan yang authoritative

| Kontrak | Sumber |
| --- | --- |
| Markdown, fallback, restore, harga terbaru saat apply | [Kebijakan base price dan restore](issues/01-markdown-base-drift-and-restore.md) |
| Eligibility, benefit, minimum, waktu, rounding/alokasi, batas nol | [Eligibility dan dasar perhitungan](issues/02-offer-eligibility-and-money-basis.md) |
| Identitas, limits, budget, reservation, anti-abuse | [Limit dan reservation](issues/03-redemption-limits-identity-and-reservations.md) |
| PPN, funding merchant, uang customer dan repayment | [Pajak dan subsidi ongkir](issues/04-tax-and-shipping-subsidy-accounting.md) |
| Excel, partial apply, konflik harga, resume/retry | [Bulk adjustment dan partial import](issues/05-bulk-adjustment-and-partial-import.md) |
| UX admin, permissions, audit, kode sensitif | [Wireframe dan matriks authorization](wireframe-06-admin-discounts-and-authorization.md) |
| Izin provider terbatas dan evidence terdahulu | [Akses verifikasi](issues/07-jubelio-verification-access-and-permissions.md), [evidence diskon nonzero](research-08-evidence.md), [lifecycle terpilih](research-08-selected-lifecycle.md) |
| Mapping, nominal immutable, mismatch/ambiguity, launch gates | [Kontrak provider](contract-09-provider-representation-and-settlement.md) |
| Safe unpaid release, late paid, batas refund eksternal | [Cancellation dan late payment](issues/10-cancellation-refund-and-late-payment.md) |
| Ownership, snapshots, transaksi, retention, compatibility/extension | [Logical schema](contract-11-schema-retention-and-extensibility.md) |

[Verification matrix research awal](../../plan/research/discounts-coupons-promo-codes.md#11-verification-matrix-for-a-later-implementation) adalah bahan penelusuran, bukan otoritas untuk membuka kembali scope. Usulan lama tentang code binding/OTP, refund tooling, atau legacy migration tidak menjadi acceptance fase awal.

## 3. Test seams dan standar bukti

Seams berikut diajukan untuk persetujuan bersama matrix. Nama endpoint baru/signature module belum ditetapkan; complete spec harus memetakannya ke interface konkret sebelum tests ditulis.

| Kode | Public seam | Bukti yang diterima |
| --- | --- | --- |
| L | Interface pricing/evaluator dengan authoritative inputs | Expected literals dari contoh independen; eligibility, rounding, allocation, versions. Jangan memanggil engine yang diuji untuk membuat expected value. |
| T | Interface transaksi checkout, lifecycle promo, admin publish/apply dengan PostgreSQL nyata | Jalankan operasi melalui service/API publik; amati hasil/order/usage/status melalui interface baca yang disepakati. Tidak mock lock/counter dan tidak mengintip private helpers. Untuk kontrak schema sendiri, constraint/write/delete adalah seam DB yang diuji langsung. |
| H | HTTP aplikasi store/admin dan batas integrasi external yang dikontrol | Server authority, ownership/current policy, canonical request/replay, snapshot, expected/observed provider contract. Mock hanya external boundaries, waktu, atau failure injection yang terkendali. |
| B | Browser Playwright + HTTP aplikasi nyata | Perilaku terlihat, total/feedback, pemilihan promo, admin review/partial/retry, authorization dan order detail. UI changes wajib E2E; bukan cukup component snapshot atau stubbed checkout response. |
| P | Protokol verifikasi Jubelio yang diizinkan terpisah | Actual request intent dan GET independen yang dihubungkan ke expected snapshot, IDs, uang dan state. Hasil mock H/B tidak membuktikan perilaku provider. |
| D | Schema/deployment readiness di lingkungan disposable/berizin | Review SQL/seed/version compatibility, rehearsal migration dan rollout/rollback yang menjaga evidence. Bukan izin reset atau eksperimen data nyata. |

Tests harus deterministic: fixtures terisolasi, clock/failure dikontrol, tidak bergantung external service acak. Implementasi mengikuti TDD satu vertical slice: failing test → implementasi minimal → verifikasi. Penyusunan matrix tidak berarti seluruh tests ditulis lebih dahulu.

## 4. Acceptance matrix

**Status seluruh baris: belum diverifikasi pada implementasi diskon baru.** Bukti provider terdahulu hanya berlaku dalam batas yang ditautkan pada §2 dan §6; bukan green test aplikasi.

### 4.1 Harga dan Excel — sumber 01/05/06/11

| ID | Skenario | Hasil yang harus dapat diamati | Seam |
| --- | --- | --- | --- |
| M01 | Base300000/target150000, variant sama di cabang berbeda | Harga barang efektif150000 konsisten pada katalog/detail/cart/checkout; stock tetap sesuai cabang dan PPN belum termasuk pada product/cart. | L,H,B |
| M02 | Base menjadi120000 atau sama150000, lalu naik400000 | Fallback ke base tanpa coretan/badge ketika base≤target; target tersimpan aktif kembali ketika base>target. Kupon tetap dievaluasi terpisah. | L,H,B |
| M03 | Ganti/hapus Markdown; base/target berubah setelah preview | Set memakai target tetap jika masih valid terhadap base terbaru; restore melepas Markdown terbaru. Kondisi aktual before/after diaudit; snapshot order lama tetap. | L,T,H,B |
| X01 | Upload/preview lalu Apply; shortcut persen UI | Upload tidak mengubah harga. Review menampilkan dampak kenaikan/penurunan, SKU terpilih lintas halaman, target fixed. Shortcut persen dari base dibulatkan nearest/half-up, berbeda dari floor benefit kupon. | L,H,B |
| X02 | File fatal versus row invalid/duplikat | Rusak/versi/header/sheet/macro/batas menolak seluruh file sebelum harga live berubah. Formula/teks nominal/SKU invalid menggagalkan row terkait; semua row SKU duplikat gagal. Blank bukan restore. | L,H,B |
| X03 | 100 row:97 applied/3 failed; ada no-op atau pending | Status/count/report membedakan applied/unchanged/failed/pending; row gagal tidak menulis harga; pending bukan sukses final; laporan error memuat nomor row dan alasan. | T,H,B |
| X04 | Koneksi putus setelah60 committed,37 pending,3 failed | Resume request sama memproses37 pending tanpa mengulang committed/final failed. Koreksi3 gagal memakai linked batch baru dengan preview/apply; audit tidak ganda. | T,H,B |
| X05 | Source/Markdown/variant/current permission berubah saat apply/resume | Revalidasi data/izin terbaru; target valid tetap diterapkan tanpa review ulang wajib, invalid gagal row. Pencabutan izin menghentikan write berikutnya; hasil committed tetap akurat. | T,H,B |
| X06 | Batas config1000 row/SKU,5 MiB file,25 MiB dekompresi | Tepat batas dapat diproses bila input valid; melampaui batas ditolak. Eksekusi row bounded/foreground, bukan transaksi1000 row atau janji background job. Batas ini belum benchmark/SLA. | L,T,H |

### 4.2 Pilihan customer dan eligibility — sumber 02/03/06/11/12

| ID | Skenario | Hasil yang harus dapat diamati | Seam |
| --- | --- | --- | --- |
| C01 | Pilih Coupon publik atau masukkan Manual Promo Code | Tidak ada prior claim. Satu order maksimal satu redemption untuk barang/ongkir; tidak ada slot kedua. Public/manual adalah jalur promo terpisah. | T,H,B |
| C02 | Penggantian valid membuat total final naik/sama/turun | Naik: tampilkan total/selisih dan konfirmasi sebelum mengganti; batal mempertahankan lama. Sama/turun: Pilih/Terapkan mengganti langsung dan memperbarui breakdown. Yang dibandingkan total final, bukan nominal benefit saja. | L,H,B |
| C03 | Kode baru invalid/kehabisan kuota; lama masih valid | Alasan terlihat dan pilihan lama tetap; tidak mengubah total atau melakukan reservation dari preview. | H,B |
| C04 | Minimum gugur setelah cart berubah; subsidi delivery dipilih lalu pickup | Promo invalid tidak bisa dibawa ke order. Customer diminta memilih ulang atau menyetujui lanjut tanpa promo dengan total baru. Kupon publik belum eligible disabled dengan alasan; manual code tidak didiscovery sebagai kupon publik. | L,H,B |
| C05 | Waktu tepat mulai/akhir, minimum, email, input/kode canonical | Server authoritative; mulai inklusif/akhir eksklusif, input WIB. Minimum memakai subtotal setelah Markdown. Store account/email verified wajib; trim+uppercase konsisten dan canonical unique. Detail panjang/charset/rate precision harus ditetapkan complete spec. | L,T,H,B |
| C06 | Budget/jatah habis antara preview dan place order | Preview bukan janji slot. Place order yang tidak dapat reserve benefit penuh ditolak tanpa order/stock hold parsial atau diam-diam checkout dengan tagihan lebih tinggi. | T,H,B |
| C07 | Guessing/repeated requests dan IP bersama | Rate limiting akun/IP ditegakkan pada HTTP seam; IP bukan identitas customer. Tidak membuka kode tersembunyi. Angka/window dan perilaku limit wajib dirinci serta direview dalam complete spec; bukan diasumsikan sudah disepakati. | H,B |

### 4.3 Uang, limits dan transaksi — sumber 02/03/04/09/11

| ID | Skenario | Hasil yang harus dapat diamati | Seam |
| --- | --- | --- | --- |
| F01 | Capped/uncapped/fixed/shipping/qty>1 pada order terpisah | Hasil literal §5 cocok; cap/fixed sekali per order, largest remainder deterministic, jumlah alokasi tepat, tidak negatif, tidak menggandakan whole-line discount atau mencampur slot. | L,T,H,B |
| F02 | PPN/ongkir serta payment/repayment, tanpa service fee | PPN ceil sekali atas net barang saja; customer total dan rincian Midtrans cocok snapshot. Website tidak mengenakan service fee. Funding merchant/biaya kurir terpisah; tidak memotong subsidi dua kali. | L,H,B |
| F03 | Benefit0 dan invalid config | Invalid publication/benefit0 ditolak tanpa usage. Pembuktian alur pembayaran/provider Rp0 dicoret oleh pemilik dan bukan acceptance requirement; lihat koreksi scope di atas. | L,T,H,B |
| T01 | Dua akun berebut satu kuota/budget terakhir; satu akun berebut jatah terakhir | Hanya kapasitas yang sah berhasil. Budget memakai seluruh benefit aktual; tidak partial discount karena sisa budget kurang. Uji jatah akun1 dan configurable2 dengan PG nyata. | T,H |
| T02 | Rename/revision/pause/kode baru/email berubah; beberapa kode satu promo | Kapasitas/riwayat bersama tidak reset; order dengan hold tetap snapshot lama. Email baru wajib verified untuk penggunaan berikutnya. Limit adalah akun, bukan orang/IP unik. | T,H,B |
| T03 | Edit limit/publish/pause bersamaan reserve | Keputusan serial konsisten, tidak oversell; penurunan di bawah consumed+hold ditolak; minimal kuota atau budget wajib. Semua write paths mengikuti bounded lock ordering tanpa HTTP di dalam lock. | T,H |
| T04 | Checkout replay paralel, isi berubah/key sama, crash sebelum/sesudah commit | Key+fingerprint sama mengembalikan order yang sama; berbeda ditolak. Tidak ada order/redemption/stock intent parsial atau duplicate dispatch. Uang browser tidak menjadi authority. | T,H,B |
| T05 | Duplicate/out-of-order paid/expiry callbacks dan webhook/sweep races | Reserve/consume/release serta events/projection berubah atomik sekali; tidak double-use/release atau counters negatif. Drift ditahan untuk review, bukan reset otomatis. | T,H |
| T06 | Price/promo/tax/quote/address berubah setelah order diterima | Order detail, repayment, provider intent/mirror/recovery memakai snapshot dan versi tersimpan; unknown version ditahan, tidak dihitung ulang memakai master terbaru. | L,T,H,B |

### 4.4 Provider dan safety lifecycle — sumber 07/08/09/10/11

| ID | Skenario | Hasil yang harus dapat diamati | Seam |
| --- | --- | --- | --- |
| P01 | Create SO, invoice, payment qty1/qty2, fixed/capped, shipping | Expected uang dari snapshot: unit price awal, diskon whole-line, add_disc0, original/net ongkir, shipping discount field omitted, tax/fee provider0. Linkage IDs, identity/baris/uang dikonfirmasi GET independen; payment exact net barang+net ongkir. | L,H,P |
| P02 | Timeout/5xx/sukses tanpa ID/GET confirmation gagal/mismatch Rp1 | Tahan tahap berikutnya; simpan intent/ID/evidence aman; tidak blind retry write atau membayar nominal dinaikkan. Provider ambiguity bukan rollback. Paid tetap dicatat dan consumed, tetapi fulfillment blocked bila settlement belum terbukti. | T,H,B,P |
| P03 | Status mirror sebelum dan sesudah invoice/payment | Mirror tidak mengubah IDs, relasi dokumen atau uang; status bukan bukti paid/izin fulfillment. Bukti pre-invoice tidak memenuhi post-invoice launch gate. Kegagalan mirror tidak membatalkan paid yang terbukti. | H,P |
| S01 | Payment attempt ditolak/retry/deadline lewat/provider ambiguous | Hold tetap; retry order sama tidak menambah usage atau memperpanjang deadline. Deadline hanya memicu pemeriksaan, bukan release otomatis. | T,H,B |
| S02 | Unpaid terminal dan SO aman dibatalkan | Release sekali setelah bukti authoritative dan kondisi provider aman; kuota/budget/jatah kembali. Tidak mengizinkan cancel post-invoice/refund. | T,H,B,P |
| S03 | Paid setelah safe release/cancel; paid tetapi provider blocked | Paid diakui; late paid tidak merebut kapasitas yang sudah dilepas atau membuat transaksi pengganti. Fulfillment ditahan sesuai kontrak; review ops existing, bukan auto-refund. | T,H,B |
| S04 | Refund manual eksternal setelah paid | Tidak ada fitur/event sync/refund ledger/restore jatah baru; snapshot dan consumed tetap. Tidak menganggap nilai alokasi sebagai keputusan nominal atau hak refund. | T,H |

### 4.5 Admin, retention, extension dan cutover — sumber 05/06/11

| ID | Skenario | Hasil yang harus dapat diamati | Seam |
| --- | --- | --- | --- |
| A01 | URL/API/export/apply/resume tanpa grant atau setelah dicabut | Server current policy menolak. Hak harga/promo/kapasitas terpisah; operasi harga global juga perlu Products:view seluruh cabang. Tidak ada bypass via re-sync atau stale login. | T,H,B |
| A02 | Pengelola promo tanpa hak kapasitas menetapkan/menaikkan/menghapus limit | Capacity increase/initial assignment ditolak tanpa grant tambahan. Default HQ seed baru mendapat tiga kewenangan; default Admin tidak. Grants role existing custom tidak diubah otomatis; ceiling/coverage/self-protection berlaku. | T,H,B |
| A03 | Viewer melihat API/export/riwayat/audit dan redemption cabang lain | Kode lengkap hanya bagi pengelola; viewer masked di seluruh saluran. Aggregate global boleh terlihat, daftar/order/customer mengikuti Orders permission/scope. Audit:view bukan jalan membuka kode. | H,B |
| A04 | Draft/review/publish, dua admin mengedit versi sama | Draft tidak mengubah live. Diff/publish eksplisit; stale revision ditolak dan wajib reload/review, bukan force-overwrite. Actor/waktu/actual before-after/version/batch tercatat, tanpa tokens/kode sensitif di log umum. | T,H,B |
| D01 | Salah owner FK, benefit/slot ganda, kode lama dialihkan, hard-delete transaksi | Ownership/one-slot/one-benefit/canonical reservation dan retention constraints teruji di PG; evidence tidak hilang via cascade. Histori tanpa purge otomatis; Excel asli tidak diarsipkan durable. | T,H |
| D02 | Schema/seed/cutover reader-writer versions | Schema hanya packages/db; timestamps timestamptz. Seed FK-ordered/config/fixtures konsisten. Migration rehearsal dan rollback/version fences menjaga snapshot; reader lama tidak memproses versi baru yang tidak dikenal. Tidak ada legacy dual-write/backfill atau izin reset data nyata. | T,D |
| D03 | Unknown benefit/params version; future targeting/reward | Unknown ditolak pada publish/evaluation. Typed/versioned seam tersedia tanpa tabel targeting kosong, generic condition engine atau ledger reward hipotetis. Benefit baru memerlukan persetujuan/code/tests tersendiri. | L,T,H |
| R01 | UAT staging lalu rilis; satu kupon ditemukan bermasalah | Bukti staging pemilik/tester tercatat, tanpa internal-production cohort tambahan. Kupon bermasalah dihentikan untuk order baru; alur lain hanya berjalan jika terbukti aman. Snapshot/order lama tidak diubah atau dibatalkan massal. | H,B,D |

## 5. Contoh nominal independen

Setiap baris adalah order terpisah; PPN11% hanya ilustrasi, bukan rate pajak baru. Ongkir nol kecuali dinyatakan; website tidak mengenakan service fee. Literals ini berasal dari kontrak dan aritmetika contoh, bukan output evaluator yang akan diuji.

| Kasus | Expected |
| --- | --- |
| Markdown+persentase | Base300000 → target150000;10% → benefit15000,net135000,PPN14850,customer149850,provider135000. Provider whole-line discount165000. |
| Persentase capped | Subtotal450000;10% cap20000 → benefit20000,net430000,PPN47300,customer477300,provider430000. |
| Persentase uncapped | Subtotal450000;10% → benefit45000,net405000,PPN44550,customer449550,provider405000. |
| Fixed dua baris | Subtotal150000+100000;fixed25000 → alokasi15000+10000,net225000,PPN24750,customer249750,provider225000. |
| Quantity2 | Source unit100000,target90000,qty2;10% → Markdown20000,kupon18000,net162000,PPN17820,customer179820. Provider gross200000/disc38000/payable162000. |
| Shipping subsidy | Net barang150000;ongkir30000,cap20000 → subsidi20000,net ongkir10000,PPN16500,customer176500,provider160000; biaya kurir/funding tetap terpisah. |
| Shipping clipped | Net barang150000;ongkir12000,cap20000 → subsidi12000,net ongkir0,PPN16500,customer166500,provider150000; sisa8000 hangus. |
| Rounding berbeda | Benefit10% dari100005 →10000,net90005; PPN dari dasar100005 →11001. Shortcut UI target85% dari base100001 →85001. |
| Benefit0 | Subtotal50;1% →0; promo tidak diterapkan, tanpa penggunaan kuota/jatah. |

Contoh fee Rp2.000 serta skenario pembuktian pembayaran/provider Rp0 sebelumnya ditarik sesuai [koreksi pemilik](decision-zero-payment-and-no-service-fee.md). Pencegahan pembayaran Rp0 dijaga melalui prosedur admin dan pemilik bisnis, bukan requirement pembuktian tambahan.

## 6. Evidence dan release gates

### G1 — selesai keputusan tiket 12

Pemilik menyetujui **seluruh dokumen ini**, termasuk matrix/seams/outline/batas dan gap di bawah. Setelah itu tiket dapat resolved sebagai keputusan planning. Ini tidak berarti tests berjalan, complete spec disetujui, atau launch diizinkan.

### G2 — complete spec siap direview, lalu approval terpisah

Draft complete spec harus mengikuti outline §8, menghubungkan setiap acceptance ID ke interface/test/evidence, dan memperlihatkan gap serta owner secara eksplisit. Outline tidak menggantikan complete spec. Sebelum Ready/implementasi scope terkait, selesaikan keputusan behavior yang menghalangi kontrak implementasinya dan minta approval pemilik atas dokumen lengkap. Tidak menerbitkan build tickets tanpa persetujuan breakdown terpisah.

### G3 — implementasi dan automated acceptance

Saat implementasi diizinkan nanti: jalankan tests pada seams yang disepakati, termasuk PG nyata untuk T dan browser/HTTP untuk UI/authorization; sertakan regression suites sesuai aturan repo. Minimal unit suite untuk logic dan E2E untuk UI/routing/auth; sebelum commit/PR jalankan suites yang diwajibkan project. Full unit suite memerlukan PG untuk sebagian tests, bukan dianggap infrastructure-free.

Simpan laporan command, environment, pass/fail/blocked/skipped, dan acceptance IDs. Infrastructure blocker/skips bukan bukti lulus. Gunakan external mocks terkontrol untuk automated app tests; suite yang melakukan real provider writes memerlukan izin terpisah. Legacy live E2E tidak boleh dijalankan hanya karena matrix meminta E2E.

### G4 — status evidence Jubelio dan koreksi scope

1. **Post-invoice status mirror — evidence provider terpenuhi pada scope M1/M2:** [research09 dan review main agent](research-09-post-invoice-mirror.md#hasil-kelanjutan-dan-review-main-agent) sesudah approval testing terpisah membuktikan Menunggu Verifikasi setelah invoice serta Siap Proses/Selesai setelah payment pada qty1/qty2. SO/invoice/payment IDs, diskon/uang/ongkir/linkage dan stock tetap; paid amount tepat, due0. Ini evidence seam P untuk P03 pada envelope yang diuji, bukan hasil tests implementasi H atau klaim seluruh input/config terverifikasi. Evidence sebelum invoice saja tetap tidak cukup; gap stage tersebut kini diisi M1/M2.
2. **Outstanding 2 — dicoret, bukan ditunda:** pemilik menegaskan tidak ada kewajiban pembuktian pembayaran/provider Rp0 dan website tanpa service fee. Ini bukan launch gate atau research/test follow-up. Pencegahan kasus pembayaran Rp0 dijaga prosedur admin/pemilik bisnis. [Keputusan lengkap yang menggantikan gate lama](decision-zero-payment-and-no-service-fee.md); bukan klaim dukungan provider atau hasil tests.

Pemilik adalah pengambil keputusan; agent kelak menyiapkan proposal/protokol/evidence untuk direview. Jika perlu perubahan scope/tiket baru, gunakan gates publikasi yang disetujui, bukan membuat atau menyelesaikan tiket lain sekarang. Seluruh hasil existing08 tetap bounded; unresolved outcome lama tidak disebut rollback. Stubbed-fetch green bukan pengganti P.

### G5 — staging, kompatibilitas, dan pembukaan publik

- Automated acceptance dan bukti provider yang diwajibkan tersedia; pemilik/tester melakukan UAT di staging dan mencatat hasil/sign-off sebelum rilis publik. Tidak menambah cohort internal-production atau jangka waktu pilot yang tidak disepakati.
- Schema/migration, seed/config import, current permission, writer/reader version compatibility dan rencana rollback diverifikasi. Publikasi versi baru dipagari sampai proses terkait kompatibel; rollback bukan blind down-migration atau repricing snapshot.
- Pastikan tidak ada fakta usage legacy nyata yang bertentangan dengan asumsi aplikasi belum running. Jika ditemukan, hentikan cutover terkait dan minta keputusan; tidak membuat opening balances/riwayat personal atau menghapus data.
- Pause kupon bermasalah hanya menghentikan pemakaian baru. Order yang telah mendapat hold tetap snapshot. Risiko pada transaksi lama ditangani dengan safety/provider review yang disetujui, bukan mass cancel/reprice atau release hold paksa.
- Rilis hanya setelah acceptance wajib dan evidence provider untuk scope aktif terpenuhi; staging UAT tidak menghapus kewajiban aktif. Pembuktian pembayaran/provider Rp0 tidak diwajibkan sesuai koreksi pemilik. Izin deploy/remote/provider writes tetap terpisah dari persetujuan dokumen.

## 7. Yang masih harus dirinci — jangan dianggap selesai

| Gap | Tahap dan penanggung jawab |
| --- | --- |
| Integration status mirror post-invoice | Evidence provider M1/M2 tersedia melalui research09; bukan tests aplikasi. Scope implementasi tetap harus memenuhi P03 melalui seam H dan memakai envelope/version guards yang disetujui. |
| Concrete HTTP/module seams, payload/error/confirmation/idempotency contracts | Agent menjabarkan dalam complete spec; pemilik mereview sebelum approval. Tidak ada physical endpoint baru yang disetujui hanya lewat nama seam di sini. |
| Rate limiting angka/window, code charset/length, precision rate/input limits | Agent memeriksa endpoint/beban yang relevan dan mengusulkan angka dalam complete spec. Pemilik mereview sebelum Ready; tidak mengasumsikan universal best practice. |
| Batas cart, bounded apply chunk/timeouts dan retry DB terbatas | Complete spec dan verifikasi implementasi. Retry hanya setelah rollback DB terbukti sebelum external dispatch, bukan retry provider ambiguity. Import1000/5MiB/25MiB bukan SLA yang telah diukur. |
| Physical SQL/index/lock-order integration dan version fence/rollback mechanism | Complete spec merinci terhadap write paths existing, schema owner, migration/seed/deployment. Tidak menambah generic infrastructure atau emergency-switch subsystem tersirat. |
| Bukti suites, rehearsal, dan staging UAT | Pekerjaan setelah implementasi berizin; saat ini belum tersedia untuk fitur baru. |

Tidak ada keputusan produk lain dari sesi grilling ini yang diam-diam diisi agent. Gap di atas harus tetap terlihat pada draft spec; bukan klaim semua keputusan masa depan sudah selesai atau semua fitur siap dieksekusi.

## 8. Outline complete spec yang diajukan

Outline ini bukan breakdown implementation tickets dan tidak menetapkan urutan delivery otomatis.

| Bagian spec | Isi wajib dan penelusuran |
| --- | --- |
| 1. Tujuan, scope, non-goals, approval/gaps | Sumber §2; keputusan12; G1–G5 dan gap §7. Pisahkan reviewable/Ready/implemented/launchable. |
| 2. Domain dan authoritative inputs | Base/Markdown/Offer/Revision/Redemption/Reservation dari glossary; produk02/03/11. |
| 3. Pricing dan money contract | Formula/rounding/allocation/PPN/funding/snapshots/versions; M01–M03,F01–F03,T06,§5. |
| 4. Customer selection dan HTTP contracts | Picker/manual code, confirmation total naik, invalid versus gugur, authoritative errors/quote/reprice; C01–C07,T04. |
| 5. Admin harga dan Excel | Manual/bulk/template/parser safety/limits/staging/apply/resume/error/download/audit; X01–X06 dan kontrak05. |
| 6. Admin promo dan authorization | Draft/review/publish/current policy, grants/defaults/ceiling/code privacy/order scope; A01–A04 dan wireframe06. |
| 7. Logical-to-physical schema dan transaksi | Ownership/FK/constraints/indexes, retention, timestamps/seed, lock order dan bounded execution; T01–T05,D01–D03 dan kontrak11. |
| 8. Checkout/order/payment integration | Atomic order+reservation+stock intent+idempotency; snapshot repayment/booking, canonical request/failure contracts; C06,F02,T04–T06. |
| 9. Provider mapping dan reconciliation | SO→mirror→invoice→payment, exact expected money/IDs/version/intent, mismatch/ambiguity, evidence gaps; P01–P03 dan kontrak09. |
| 10. Lifecycle dan batas operasional | Consume/release/expiry/payment retries/late paid/paid-but-blocked; S01–S04, tanpa refund subsystem. |
| 11. Verification plan dan evidence register | Setiap ID matrix dipetakan ke concrete public seam, fixture independen, test/evidence wajib dan laporan; G3/G4. |
| 12. Deployment/cutover/UAT/release | SQL/seed/config/version fence/rehearsal/rollback, tanpa legacy backfill, staging sign-off lalu publik, pause scope, docs/API/deployment updates; D02,R01,G5. |

Complete spec baru ditulis sebagai artefak planning tersendiri setelah gate yang sesuai; conceptual plan baru berada di `plan/` dan statusnya di `plan/index.md`, bukan membuat indeks status kedua di map. Dokumen ini tetap artefak keputusan lokal yang ditautkan dari tiket12.

## 9. Approval dan verifikasi sesi

- Checkpoint kesepahaman: pemilik memilih **Sesuai, buat draft (Recommended)** melalui `ask_user_question`.
- Approval dokumen lengkap: pemilik memilih **Setuju, tutup tiket 12 (Recommended)** melalui `ask_user_question` setelah menerima link reviewable dan ringkasan batas/gaps. Tiket12 resolved; persetujuan ini tidak menutup dua launch gates provider atau menyetujui complete spec/Ready/implementasi.
- Verifikasi saat drafting: membaca kontrak prerequisite, glossary, research dan standar testing/TDD; pemeriksaan link lokal, trailing whitespace, pasangan code fences dan 11 contoh aritmetika tidak menemukan error. `git diff --check` tiket juga bersih; warning LF/CRLF Git bukan kegagalan test. Ini pemeriksaan dokumen, bukan tests implementasi.
- Tidak ada edit app/schema/config/seed/SQL, migration, tests/build/lint/typecheck, provider request, subagent, commit atau deployment pada sesi drafting tiket12.
- Pembaruan evidence berikutnya: pemilik memberi izin testing terpisah untuk [research status mirror09](research-09-post-invoice-mirror.md). M1/M2 terverifikasi setelah invoice/payment; pembaruan evidence itu sendiri tidak mengubah acceptance atau menyatakan tests implementasi lulus.
- Koreksi scope berikutnya melalui arahan eksplisit pemilik: [outstanding 2 dicoret dan website tanpa service fee](decision-zero-payment-and-no-service-fee.md). Kewajiban pembuktian pembayaran/provider Rp0, contoh fee Rp2.000, dan gate lama tersebut digantikan keputusan ini; bukan approval complete spec/Ready/implementasi/launch. Pemeriksaan sesi koreksi hanya dokumen, bukan tests aplikasi.

Referensi standar: [AGENTS.md](../../AGENTS.md), [Testing](../../docs/testing/README.md), [TDD](../../.agents/skills/tdd/SKILL.md), [Development workflow](../../.agents/skills/development-workflow/SKILL.md), [Plan lifecycle](../../plan/README.md), [glossary](../../CONTEXT.md#product-pricing-and-promotions).
