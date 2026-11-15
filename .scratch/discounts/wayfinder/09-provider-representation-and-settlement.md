# Kontrak Mapping Provider dan Settlement

Label: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: main-agent
Blocked by: 08
Parent: [Wayfinder Desain Diskon](map.md)

## Question

Berdasarkan bukti provider dan kebijakan finance yang dipilih, field/nominal diskon apa tepatnya yang harus dibawa SO, invoice, pembayaran Jubelio, mirrors, dan snapshot lokal?

Putuskan alokasi nominal per baris dibandingkan header discount yang terverifikasi; base unit price dan komponen markdown/kupon/ongkir website yang terpisah; payable provider yang terverifikasi; ledger goods-only dibandingkan ledger ongkir yang diperluas dan terverifikasi; verifikasi ketat per baris/agregat, versi payload, serta penanganan hasil ambigu/mismatch.

## Referensi dan batasan

- Jawaban/artefak wajib dari [Bukti Kontrak Diskon Nonzero Jubelio](08-jubelio-nonzero-discount-evidence.md).
- Konteks finance wajib dari [Perhitungan Pajak dan Subsidi Ongkir](04-tax-and-shipping-subsidy-accounting.md).
- [Keputusan arah ongkir parsial terbaru dari pemilik](../research/research-08-selected-shipping-mapping.md): barang + net ongkir, original sebelum subsidi, tanpa shipping_cost_discount request; bukan complete contract tiket ini.
- [Scope bukti08 yang sudah direvisi dan disetujui](../research/research-08-approved-proof-scope.md): per-line discount/add_disc0, unused fields dan legacy follow-up dipisahkan, acceptance SO + nominal lifecycle.
- [Rekomendasi mapping provider](../research/discounts-coupons-promo-codes.md#d-so--invoice--payment-and-existing-safety-gates).
- [Proposal komponen order immutable](../research/discount-database-design.md#8-order-money-compatibility-and-jubelio-mapping).

Potongan barang website harus direpresentasikan sebagai diskon SO. Jangan memilih workaround penurunan unit price dengan diskon nol atau pembayaran provider sebesar gross yang bertentangan dengan keputusan awal. Jangan diam-diam menghapus safety guards atau mengubah semantik pajak/source provider existing.

## Bukti penyelesaian

Mapping field/nominal dan kontrak verifikasi independen yang disetujui pemilik, mencakup contoh scope awal serta state order/provider. Bedakan fakta provider terverifikasi dari pilihan accounting pemilik; dokumentasikan launch gates yang belum selesai secara eksplisit.

## Batas pekerjaan

Claim setelah blocker selesai. Muat `grilling`, `domain-modeling`, `development-workflow`, dan bukti existing. Hanya planning/pemeriksaan kode read-only; tidak ada perubahan kode, provider write, subagent, atau penyelesaian tiket HITL lain.

## Comments

Pada publikasi awal, bukti provider baru berupa schema dan observasi zero-discount existing. Research08 kemudian menghasilkan [runtime evidence terkini](../research/research-08-evidence.md), termasuk T1–T3 mirror/invoice/paymentqty1/qty2 dan safe cancel. **Prerequisite08 kini resolved pada scope approved**, sehingga tiket09 unblocked; status tetap open/assignee none, belum diklaim.

### Arah parsial dari pemilik, belum jawaban lengkap tiket09

Pemilik menyetujui **Ya, catat revisi mapping (Recommended)** setelah klarifikasi eksplisit: mengganti pilihan goods-only sebelumnya menjadi **barang + net ongkir**. Gunakan original_shipment_cost untuk ongkir sebelum subsidi dan shipping_cost untuk net ongkir customer; **shipping_cost_discount omitted dari request**, bukan0/null. Contoh original30000/net10000, barang net900000 → candidate payable910000 tanpa PPN/fee website. Subsidi/funding merchant serta quote/biaya kurir tetap terpisah di website sesuai04.

[Keputusan lengkap beserta bukti dan batas approval](../research/research-08-selected-shipping-mapping.md). CaseG/I-minus/J-minus mendukung sampai invoice; [T1–T3](../research/research-08-selected-lifecycle.md) kemudian memverifikasi mirror sebelum invoice/cancel, paymentqty1/qty2 exact/due0, dan safe cancel/stock restore. Original metadata tidak tersedia pada invoice GET sesuai accepted limitation; SO original terverifikasi. Default discount0 di response bukan berarti field dikirim atau harus dianggap mismatch.

Ini hanya catatan arah dan handoff evidence08, **bukan claim atau penyelesaian kontrak lengkap09**. Dependency Blocked by08 tetap tercatat sebagai riwayat prerequisite, tetapi08 telah resolved sehingga09 unblocked; status open/assignee none tetap. Pemilik menyetujui [revisi scope bukti08](../research/research-08-approved-proof-scope.md): fokus mapping terpilih/per-line discount/add_disc0; unused shipping/funding fields dan header nonzero keluar scope awal; legacy investigasi terpisah; original pada SO dan nominal/linkage lifecycle diterima tanpa mewajibkan metadata original invoice internal. Bukti aktif kemudian dipenuhi T1–T3 dan direview pada08. Batas stage mirror yang dibuktikan adalah sebelum invoice/cancel, bukan semua edits post-invoice; SO is_paid masihnull pada fixtures paid, sehingga jangan memakai flag itu sendirian sebagai sumber settlement. Guard aplikasi/accounting tidak berubah dan tidak ada izin provider writes/implementasi/commit baru.

### Sesi grilling kontrak09 — draft menunggu approval akhir

Tiket diklaim main agent setelah pemilik meminta grilling ringkas melalui `ask_user_question`, memakai evidence dan kode read-only tanpa request Jubelio baru. Pemilik menyetujui penggabungan potongan harga coret + kupon menjadi diskon per baris dengan komponen website tetap terpisah; verifikasi uang ketat tanpa selisih Rp1; payment sesuai net barang + net ongkir dengan linkage/due0; dan penahanan hasil mismatch/ambigu tanpa kirim ulang transaksi otomatis.

Order/payload baru diberi versi; order lama tetap snapshot lama tanpa proyek penanganan khusus data dev/staging yang belum live. Pemilik tidak memilih menunda sinkronisasi status setelah invoice: bukti aman tahap tersebut wajib sebelum launch. Solusi tagihan provider Rp0 pada kasus customer tetap membayar fee juga disetujui sebagai launch gate, tanpa merevisi eligibility02.

Pada checkpoint draft, pemilik memilih **Sesuai, tulis draft (Recommended)** atas ringkasan kesepahaman; status saat itu claimed dan belum disetujui final. Approval akhir kemudian diberikan sebagaimana dicatat pada Answer di bawah. Tidak ada provider request, perubahan aplikasi/schema/config, tests/build/lint/typecheck, subagent, atau commit.

## Answer — kontrak lengkap disetujui

Pemilik menyetujui [kontrak diskon dan pembayaran Jubelio lengkap](contract-09-provider-representation-and-settlement.md) melalui `ask_user_question` dengan memilih **Setuju, finalkan (Recommended)**, setelah menerima link dokumen dan ringkasan dua launch gates. Tiket resolved sebagai keputusan planning, bukan kesiapan launch atau izin implementasi/provider testing.

- Harga awal snapshot menjadi unit price provider; potongan harga coret + kupon dialokasikan sebagai nominal diskon whole-line, total_disc menjumlahkannya, add_disc0. Komponen website tetap terpisah; persen provider merupakan representasi turunan, bukan sumber hitung ulang nominal.
- Payable provider = net barang + net ongkir. Original ongkir sebelum subsidi; shipping_cost net customer; shipping_cost_discount omitted. PPN/fee website, funding merchant dan quote/biaya kurir tetap terpisah.
- Verifikasi independen identity/state/linkage serta uang per baris dan agregat wajib cocok tanpa selisih Rp1. Payment sesuai expected payable dan invoice terverifikasi, satu association yang benar, invoice paid amount sesuai dan due0; flag SO paid saja tidak cukup.
- Mirror mempertahankan identity/detail IDs dan seluruh uang; hanya tulisan status berubah. Kegagalannya tidak mengubah bukti paid atau mengotorisasi fulfillment. Cancel tetap hanya pre-invoice yang eligible, bukan post-invoice/refund atau cleanup ambigu.
- Mismatch/hasil ambigu ditahan untuk reconciliation read-only/manual review, tanpa kirim ulang transaksi otomatis. Customer paid tetap dicatat, tetapi fulfillment normal tertahan bila settlement belum terverifikasi.
- Order/payload baru memakai versi eksplisit dan snapshot immutable. Tidak ada proyek migrasi/backfill khusus data lama dev/staging; ini bukan izin reset/delete data.
- **Launch gate 1:** sinkronisasi status setelah invoice wajib diuji dan terbukti aman sebelum launch; pemilik menolak opsi menundanya sebagai fitur launch.
- **Launch gate 2 pada approval awal — kemudian dicoret pemilik:** pembuktian pembayaran/provider Rp0 tidak lagi diwajibkan. Website tanpa service fee; lihat koreksi scope berikutnya di bawah.

Fakta provider pada approval kontrak dibatasi envelope evidence08; keputusan kontrak bukan bukti semua inputs/stages sudah didukung. Legacy unknowns/cleanup dan field excluded08 tidak dibuka kembali sebagai gates baru. Tidak ada request Jubelio, perubahan aplikasi/schema/config, tests/build/lint/typecheck, subagent, atau commit pada sesi approval kontrak09. Kontrak mencakup contoh independen dan acceptance untuk pekerjaan implementasi berikutnya.

## Tindak lanjut evidence — status mirror post-invoice/payment

Pemilik kemudian mengizinkan testing sandbox dan memilih protokol **Dua kasus (Recommended)**; setelah preflight stop tanpa business write, pemilik memilih **Diagnosis dan lanjut (Recommended)**. [Protokol lengkap, journal dan review main agent](../research/research-09-post-invoice-mirror.md#hasil-kelanjutan-dan-review-main-agent).

M1 SO68443/invoice45974/payment59 qty1/payable910000 dan M2 SO68444/invoice45975/payment61 qty2/payable1810000 berhasil: Menunggu Verifikasi setelah invoice, Siap Proses dan Selesai setelah payment mempertahankan IDs/detail/linkage/uang/diskon/ongkir dan stock; due0. Tepat2 create/2 invoice/2 payment/6 mirror, kumulatif research42 create attempts; tanpa retry, cleanup atau edit fixtures historis.

**Launch gate mirror terpenuhi pada envelope M1/M2 yang diuji.** Research ini sendiri tidak mengubah acceptance atau kebijakan finansial, tidak menganggap tests aplikasi lulus dan tidak memberi izin implementasi/launch. Status resolved tiket tetap keputusan planning; evidence baru bukan approval delivery.

## Koreksi scope berikutnya — outstanding 2 dicoret

Pemilik menegaskan tidak ada kewajiban membuktikan pembayaran Rp0 karena kasus itu tidak terjadi dalam scope operasional dan dijaga melalui prosedur admin/pemilik bisnis. Website tidak mengenakan service fee; contoh fee Rp2.000 ditarik. **Outstanding 2 dicoret, bukan ditunda; bukan research/test requirement atau launch gate.** [Jejak keputusan lengkap](decision-zero-payment-and-no-service-fee.md) menggantikan ketentuan provider Rp0 dan fee berbayar pada histori approval di atas, bukan klaim dukungan provider Rp0 atau izin implementasi/launch.
