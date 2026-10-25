# Bukti Kontrak Diskon Nonzero Jubelio

Label: wayfinder:research
Type: research
Status: resolved
Assignee: main-agent
Blocked by: 07, 04
Parent: [Wayfinder Desain Diskon](map.md)

## Question

Perilaku provider yang diverifikasi secara independen apa yang membuktikan diskon barang nonzero, representasi ongkir, dan pemeliharaannya sepanjang invoice/payment?

**Scope bukti aktif telah direvisi dengan approval pemilik.** [Acceptance lengkap dan batas scope terbaru](../research/research-08-approved-proof-scope.md) menggantikan kewajiban penelitian field ongkir/funding yang tidak digunakan serta header discount nonzero dalam scope awal. Riwayat eksperimen di Comments tetap dipertahankan, bukan semua unknown historis menjadi gate kontrak baru.

Kriteria scope terpilih untuk review hasil:

- Otoritas/precision `disc` versus nominal authoritative `disc_amount` pada input yang digunakan; nominal whole-line untuk quantity > 1 dan preservation nominal di lifecycle.
- Diskon barang dialokasikan per baris, `total_disc` menjumlahkan alokasi fixed/capped, **`add_disc: 0`**. Dukungan header discount nonzero tidak diklaim atau diwajibkan untuk scope awal.
- Source INTERNAL: `original_shipment_cost` ongkir sebelum subsidi pada SO, `shipping_cost` net customer, **`shipping_cost_discount` omitted dari request**. Subsidi/funding merchant dan biaya quote/provider tetap terpisah di website; writable funding seller/platform serta unit field excluded tidak lagi required proof.
- SO GET → invoice GET → payment GET; payable setelah diskon/net shipping, linkage dan due0, serta pemeliharaan nominal/identity saat full-payload mirror dan safe cancel yang eligible.

Bukti provider/support read-only dapat mempersempit gap sebelum sandbox writes yang diizinkan terpisah. Provider yang tidak dapat diakses atau memberi hasil ambigu bukan bukti kontrak.

## Referensi dan batasan

- [Penelusuran field resmi saat ini](../research/discounts-coupons-promo-codes.md#b-fresh-first-party-jubelio-contract-and-evidence-level).
- [Kandidat mapping dan contoh kasus](../research/discounts-coupons-promo-codes.md#c-candidate-mapping-for-the-selected-benefits--not-runtime-verified).
- [Guard zero-discount saat ini](../../../apps/store/src/lib/jubelio-sales-client.ts#L418).
- [Pemeriksaan settlement saat ini](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L746).
- [Operation ledger provider yang ada](../../../packages/db/src/schema/jubelio-sales.ts).

Memerlukan Akses dan Izin Verifikasi Jubelio di Akun Test Terisolasi serta Perhitungan Pajak dan Subsidi Ongkir. Fakta tidak otomatis menyetujui pilihan accounting. Izin harus mencakup protokol aktual yang telah diperjelas dan setiap tindakan write. Tidak ada pengujian production, edit order existing, penyamaran source, atau retry write yang ambigu.

## Bukti penyelesaian

Link ke artefak bukti yang disanitasi: input/label kasus, field nominal/quantity/diskon relevan, konfirmasi independen, dan unknowns yang masih ada. Jangan memasukkan token, raw customer response, atau PII. Bukti wajib pada [scope approved](../research/research-08-approved-proof-scope.md) yang belum tersedia membuat tiket tetap open/blocked; jangan menutupnya seolah sudah verified.

Bukti original ongkir pada **SO**, nominal net ongkir/payable serta linkage pada **invoice/payment** diterima pemilik; tidak mewajibkan field original metadata pada invoice GET yang memang tidak mengeksposnya dan tidak mengklaim internal preservation verified. Outcome ambigu/cleanup fixtures lama dipisahkan sebagai follow-up terdokumentasi, **bukan gate kontrak baru**, bukan proof rollback/izin cancel. Payment/mirror/qty>1 dan safe cancel yang eligible pada konfigurasi terpilih telah dipenuhi lewat T1–T3 serta evidence existing, sebagaimana direview dalam [hasil lifecycle dan acceptance](../research/research-08-selected-lifecycle.md#review-acceptance-tiket08). Batas envelope tetap berlaku; bukan claim semua inputs/stages didukung.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `research`, `development-workflow`, dan panduan dokumentasi provider yang relevan. Research langsung oleh main agent kecuali ada izin delegasi terpisah. Tidak ada subagent/fork/commit otomatis, kode aplikasi, atau validation runs. Ikuti scope provider yang diizinkan secara spesifik; write ambigu berhenti untuk reconciliation read-only/manual review.

## Comments

Pada publikasi awal protokol sandbox/business request belum diizinkan. Pemilik kemudian mengizinkan pengujian sandbox dengan batas maksimal 5 SO dan menyerahkan rincian protokol kepada agent; prerequisite akses/izin [tiket 07](07-jubelio-verification-access-and-permissions.md) resolved.

Bukti pendahuluan terbatas, bukan pengerjaan/penyelesaian tiket blocked ini: [protokol dan hasil sandbox](../research/sandbox-verification.md), [evidence JSON](../research/sandbox-results.json). Dua request create dijalankan: baseline SO 68408 berhasil dan dibatalkan terverifikasi; create nominal-only nonzero mengembalikan HTTP 500 tanpa ID, sehingga semua business writes dihentikan tanpa retry. Rekonsiliasi list terbatas dan stock tidak membuktikan non-application. Operator investigation diperlukan sebelum write berikutnya. Marker/invoice/payment nonzero dan kasus lanjutan belum dijalankan.

Setelah pemilik memeriksa UI dan meminta investigasi error, [investigasi lanjutan](../research/sandbox-error-investigation.md) menambah dua kasus pembeda yang terotorisasi dalam budget: F dengan persentase 10% + nominal Rp25.900 berhasil (SO 68409, GET total Rp233.100, cancellation dan stock terverifikasi); G dengan money yang sama tetapi `disc=0` kembali HTTP 500 generik tanpa ID/code spesifik. Total kumulatif **4/5 request create**, tanpa retry B/G; write dihentikan lagi. Ini membuktikan kasus nonzero persentase+nominal konsisten, bukan akar exception internal atau dukungan fixed/capped arbitrary Rupiah. Marker/invoice/payment nonzero dan quantity >1 belum diuji.

Pada akhir sesi preliminary, tiket masih open dan blocked oleh kebijakan finance 04; evidence preliminary tidak membuktikan kontrak lengkap atau kesiapan launch.

### Tambahan preliminary H — persentase dari nominal

Pemilik mengarahkan agar `disc` dihitung dari nominal. Request ke-5 dalam budget awal: harga Rp259.000 ×1, nominal Rp20.000, `disc: 7.722007722007722`, net Rp239.000 berhasil SO **68410**. GET menunjukkan persentase `7.72` tetapi nominal/header/line tetap tepat Rp20.000/Rp239.000. Cancel pre-invoice dan stock restore terverifikasi. [Request/response dan batas kesimpulan H](../research/sandbox-error-investigation.md#h--persentase-dihitung-dari-nominal-request-terakhir), [evidence H](../research/sandbox-results.json).

Budget awal **5/5**, B/G tidak diretry; tanpa marker/invoice/payment nonzero atau quantity >1. Persentase boleh diturunkan sebagai kandidat representasi sesuai arahan pemilik, tetapi uang website tetap authoritative; jangan hitung ulang nominal dari persentase GET yang sudah dua desimal. H belum membuktikan seluruh kontrak provider atau implementation readiness. Catatan ini tidak mengubah otorisasi research lanjutan yang dicatat terpisah di bawah.

### Research lanjutan — otorisasi terbaru

Pemilik meminta research dijalankan dan secara eksplisit mengizinkan testing Jubelio menggunakan credentials `.env`, dengan konfirmasi bahwa credentials mengarah ke sandbox. Izin terbaru memperluas batas testing sebelumnya, bukan izin production atau perubahan aplikasi. Agent tetap membatasi eksperimen pada fixtures research, mencatat protokol sebelum write, dan menghentikan business writes pada outcome ambigu tanpa blind retry.

Prerequisite 04 dan 07 sekarang `resolved`; tiket diklaim oleh main agent. Outcome B/G masih memerlukan rekonsiliasi. Tidak ada subagent, commit, atau validation runs aplikasi yang diizinkan/dijalankan.

Hasil fase read-only sebelum eksekusi tambahan: [research evidence dan protokol lanjutan](../research/research-08-evidence.md), [evidence JSON tersanitasi](../research/research-08-results.json). GET spec resmi mengonfirmasi tujuh block schema masih cocok dengan vendor spec; GET SO 68409 membuktikan diskon Rp25.900/net Rp233.100 tetap tersimpan sesudah cancellation. Delapan endpoint list status/sales/invoice/payment dengan filter customer dummy hanya menemukan dua SO canceled yang dikenal, tanpa invoice/payment. Coverage ini tidak membuktikan rollback B/G. Pada fase tersebut tidak ada business writes baru. Finance 04 bukan blocker yang belum selesai.

### Eksekusi tambahan — 5 create SO setelah instruksi “iya tolong jalankan”

Pemilik memberi tambahan 5 create lalu meminta eksekusi. [Protokol dan hasil J–N](../research/sandbox-followup.md) menentukan kasus baru independen, bukan retry B/G atau asumsi rollback. Budget kumulatif kini **10/10 create attempts**; seluruh lima create baru mendapat ID dan money GET sesuai expected independen.

- J: SO **68411**, marker full-payload dengan persentase GET 7.72 tetap mempertahankan diskon Rp20.000/net Rp239.000; invoice **45951** mempertahankannya; payment **40** tepat Rp239.000, satu association invoice/SO, due 0.
- K: SO **68412**, qty 2, nominal satu line Rp51.800, net Rp466.200; cancel dan stock restore.
- L: SO **68413**, alokasi dua line Rp10.177 + Rp9.823 tepat Rp20.000, net Rp489.000 meskipun kedua persentase GET 3.93; cancel dan stock restore.
- M/N: SO **68414/68415**, GET membuktikan `total_disc` line terpisah dari `add_disc` pada fixture tax/fee/ongkir nol; net Rp249.000 dan Rp234.000. Cancel dan stock restore.

Request lengkap, proyeksi output, invoice/payment association dan cleanup tersimpan pada [sandbox-results.json](../research/sandbox-results.json), event J–N. SO 68411/invoice/payment dibiarkan sebagai artefak sandbox; tidak cancel post-invoice. Tidak ada perubahan aplikasi/guard/schema, validation runs aplikasi, delegasi, atau commit.

Tiket **tetap claimed**, bukan resolved: writable subsidi/funding ongkir INTERNAL belum terbukti dan B/G tetap unknown; lifecycle multi-line/qty 2/header discount belum diverifikasi sampai invoice/payment. Fakta baru ini perlu dibawa ke keputusan mapping tiket 09 setelah bukti wajib 08 lengkap atau destination direvisi dengan approval pemilik.

Pada fase recheck screenshot sebelum tranche terbaru, research membaca evidence H yang baru tersedia dan menjalankan GET independen SO 68410. H cocok dengan screenshot: ref H pada UI, qty 1, persentase GET 7,72%, nominal Rp20.000, net Rp239.000, canceled true, invoice null. Recheck canceled list sekarang memuat tiga fixtures 68408/68409/68410; endpoint list lain tetap kosong pada filter dummy. Screenshot tidak memperlihatkan ref B/G atau audit disposition keduanya. Tidak ada business writes baru. Saat fase tersebut protokol research dibatasi maksimal5 create tambahan/kumulatif10 sesuai tambahan budget pada tiket07; kemudian otorisasi terbaru di bawah memperluasnya. Outcome B/G tetap unknown, tidak diretry.

### Tranche terbaru — 10 create tambahan dan blocker invoice subsidi

Pemilik memberi izin **10 SO lagi** dan meminta research diteruskan sampai selesai. Setelah membaca evidence J–N, baseline dikoreksi menjadi10 existing; tranche terbaru memakai10/10, sehingga total **20 create attempts**, bukan20 SO berhasil. [Protokol](../research/research-08-write-protocol.md), [research final/remaining unknowns](../research/research-08-evidence.md), dan [journal tersanitasi](../research/research-08-write-results.json).

- Q SO68416: whole-line diskon qty2 nominal51800/net466200, cancel + stock restore.
- L baru SO68417: alokasi fixed/capped10177+9823=20000/net489000, persentase GET3.93; full-payload mirror dan invoice45952 mempertahankan seluruh uang. Payment42 tepat489000/due0/satu association. GET payment pertama500, lalu reconciliation GET/list dan GET ulang mengonfirmasi pembayaran; tidak retry payment.
- S SO68418: shipping_cost30000 writable, barang259000/payable289000 dipertahankan hingga invoice45953/payment44/due0.
- R SO68419: input disc7.72 tetap mempertahankan nominal20000/net239000, cancel + stock restore.
- F2 SO68420: shipping_cost_discount20000 diterima untuk INTERNAL dengan net shipping10000; F3 SO68421: original_shipment_cost30000 diterima. Keduanya canceled dan stock restore.
- F1/F4/F5: HTTP400 definite rejections; isolated seller/platform funding fields mendapat kategori not-allowed. Tidak retry.
- F6 SO68422: gabungan goods discount20000/net239000, net shipping10000, original30000/subsidy20000/payable249000 berhasil pada create dan mirror. **Invoice conversion HTTP500/code23113 journal_unbalance tanpaID**. GET terakhir invoice_idnull, stock43842/location2 on_hand1/on_order1/available0. Tidak ada invoice/payment baru terlihat pada list untukF6, tetapi itu bukan bukti rollback. Tidak retry/cancel/payment setelah stop; operator/support reconciliation diperlukan.

Tiket **tetap claimed, belum resolved**: preservation subsidi hingga invoice/payment belum terbukti; funding seller/platform tidak writable pada endpoint yang diuji; outcome B/G dan conversion F6 masih unknown. Jangan menyamakan writable SO field dengan safe settlement. Tidak ada perubahan aplikasi/schema/account mapping, unit/E2E/build/lint/typecheck, subagent, atau commit. Pada akhir tranche, next action yang diusulkan adalah audit disposition SO68422/conversion23113 dan klarifikasi kontrak INTERNAL shipping/subsidy dengan support; memilih ledger goods-only vs shipping extended tetap keputusan pemilik, bukan ditentukan research ini.

### Reconciliation68422 dilanjutkan; klarifikasi accounting support di-skip

Pemilik meminta reconciliation SO68422 dilanjutkan dan klarifikasi accounting subsidi operator/support di-skip. Agent menjalankan login yang telah diizinkan, GET detail SO sebelum/sesudah,7 endpoint filtered list dengan pemeriksaan pagination, GET detail tiga invoice serta tiga payment yang ditemukan, dan stock lookup (POST read-only). Tidak ada business write baru, kontak support, atau perubahan accounting.

Hasil: SO68422 tetap ada, invoice_idnull, is_canceled/is_paidnull, grand249000/marker Menunggu Verifikasi. Tiga invoices45951/45952/45953 dan payments40/42/44 terkonfirmasi linked keSO68411/68417/68418, tidak ke68422. Semua filtered pages complete menurut totalCount, tetapi bukan audit internal. Stock43842/location2 tetap on_hand1/on_order1/available0. [Analisis reconciliation](../research/research-08-evidence.md#reconciliation-so68422-setelah-instruksi-pemilik), event `F6-reconciliation-*` pada [journal](../research/research-08-write-results.json).

Tidak ada invoice/payment terkait68422 yang terlihat; ini bukan proof rollback conversion500. Stop writes/cleanup tetap aktif. Klarifikasi accounting support ditunda sesuai pemilik, **bukan dianggap verified**, tidak otomatis memilih ledger shipping extended/goods-only, dan tidak menutup required proof08. Tiket tetap claimed. Disposition/cleanup berikutnya memerlukan manual UI review pemilik dan keputusan terpisah; SO68422 tidak dibatalkan otomatis.

### Retest F6 diizinkan, tetapi preflight stock memblokir create

Pada sesi2026-10-18, pemilik menyetujui retest fixture baru: tambahan maksimal1 create attempt sandbox, login/preflight, mirror, serta satu conversion invoice; tanpa payment/cancel/retry atau perubahan SO68422. [Protokol dan hasil](../research/research-08-retest.md), [journal tersanitasi](../research/research-08-retest-results.json).

Login, master item43842, dan lookup stock berhasil HTTP200. Harga tetap259000/unit Buah, tetapi location2 menunjukkan on_hand1/on_order1/**available0**. Agent berhenti sebelum create sesuai protokol, tanpa mengganti item/lokasi atau mengubah stock. Tambahan budget terpakai0/1; kumulatif tetap20 create attempts. Tidak ada mirror/conversion/payment/cancel baru, sehingga **belum ada jawaban apakah error23113 masih terjadi pada retest**. SO68422 tidak dibaca atau diubah dalam preflight ini; hasil stock sendiri bukan atribusi reservation baru ke SO tersebut. Tiket tetap claimed dan unknowns sebelumnya tetap berlaku.

### Item pengganti60344 — conversion kembali23113

Pemilik kemudian meminta item lain dan menyetujui protokol konkret item60344/location2, harga650000, diskon barang20000/net630000, ongkir awal30000/subsidi20000/net10000, grand640000. [Hasil lengkap](../research/research-08-retest.md#hasil-retest-item60344--error-invoice-sama), [journal create](../research/research-08-alternative-retest-results.json), [journal continuation](../research/research-08-alternative-retest-continuation.json).

Create berhasil **SO68423**, GET semua nominal cocok. Script sempat berhenti sebelum mirror karena alias lokasi item: hanya membaca location_id, padahal GET menggunakan loc_id. Setelah merujuk parser existing dan GET independen yang mengonfirmasi loc_id2/detail74708, agent melanjutkan fixture yang sama tanpa create ulang. Mirror sekali berhasil dan seluruh uang tetap. Conversion invoice sekali mendapat **HTTP500/code23113 journal_unbalance**, tanpaID. Semua business writes dihentikan tanpa retry/payment/cancel.

Reconciliation GET menunjukkan invoice_idnull, grand640000/marker Menunggu Verifikasi, is_canceled/is_paidnull. Stock60344/location2 kini on_hand1/on_order1/available0. Filtered invoice/payment lists lengkap menurut totalCount masing-masing3 dan hanya memuat artefak lama; bukan proof rollback conversion. SO68423 tidak dibatalkan otomatis; manual UI/audit disposition diperlukan sebelum cleanup. SO68422 tidak disentuh.

Budget tambahan terpakai**1/1**; kumulatif**21 create attempts**. Error sama teramati pada varian item/harga berbeda, bukan isolasi akar error atau bukti ketiga field secara individual menyebabkan exception. Tiket tetap claimed. Tidak ada perubahan aplikasi/schema/account mapping, application validation runs, subagent, atau commit.

### Endpoint gabungan invoice/payment — kembali23113

Pemilik mengusulkan `Convert Sales Order to Invoice with Payment`, lalu secara eksplisit menyetujui tambahan satu create fixture item43825/location2, payable640000, satu mirror dan satu POST `/sales/packlists/create-invoice-payment`; tanpa invoice-only/payment terpisah/retry/cancel. [Protokol dan hasil](../research/research-08-combined-retest.md), [journal tersanitasi](../research/research-08-combined-retest-results.json).

SO baru**68424** dibuat HTTP200, detail74709. GET dan mirror mempertahankan barang650000−diskon20000=630000, ongkir awal30000−subsidi20000=net10000, grand640000, NoTax1. Conversion gabungan dengan input `{"salesorder_id":68424}` mendapat **HTTP500/code23113 journal_unbalance**, tanpa invoiceID; semua business writes dihentikan.

GET reconciliation: invoice_idnull, is_canceled/is_paidnull, marker Menunggu Verifikasi, grand640000. Stock43825/location2 on_hand1/on_order1/available0. Filtered invoice/payment lists masing-masing3/totalCount3 hanya memuat artefak lama; bukan proof rollback dan bukan bukti payment internal pasti tidak dibuat. Tidak ada payment POST terpisah/retry/cancel atau perubahan SO68422/68423. Manual UI/audit disposition SO68424 diperlukan sebelum cleanup/write berikutnya.

Budget tambahan1/1 terpakai; kumulatif**22 create attempts**. Error sama tetap teramati pada endpoint gabungan dengan item pengganti; belum mengisolasi penyebab atau membuktikan safe settlement subsidi. Tiket tetap claimed. Tidak ada perubahan aplikasi/schema/account mapping, application validation runs, subagent, atau commit.

### Diskon integer exact — conversion tetap23113

Pemilik meminta persentase dan nominal diskon bulat tanpa rounding, lalu menyetujui tambahan satu test endpoint gabungan item43823/location2: price650000×qty1×disc10/100=disc_amount65000 tepat; net barang585000; original shipping30000/subsidy20000/net10000; grand595000. [Protokol dan hasil](../research/research-08-integer-discount.md), [journal tersanitasi](../research/research-08-integer-discount-results.json).

Create **SO68425**/detail74710 dan mirror berhasil HTTP200; GET seluruh nominal/identity cocok. Input create/mirror memakai integer10/65000; GET decimal strings10.00/65000.0000 hanya format provider. Satu POST `/sales/packlists/create-invoice-payment` dengan ID68425 kembali **HTTP500/code23113 journal_unbalance**, tanpa invoiceID. Semua business writes dihentikan tanpa retry/payment terpisah/cancel.

Reconciliation: SO68425 invoice_idnull, is_canceled/is_paidnull, grand595000/marker Menunggu Verifikasi. Stock43823/location2 on_hand1/on_order1/available0. Filtered invoice/payment lists masing-masing3/totalCount3 hanya memuat artefak lama; bukan proof rollback atau absence efek payment internal. SO68422/68423/68424 tidak disentuh; SO68425 memerlukan manual UI/audit disposition sebelum cleanup.

Ini membuktikan error yang sama dapat teramati tanpa fractional percentage atau selisih disc_amount terhadap price×qty×disc/100. Bukan isolasi akar error semua fixtures atau bukti subsidi/account mapping tertentu penyebabnya. Budget tambahan1/1 terpakai; kumulatif**23 create attempts**. Tiket tetap claimed. Tidak ada perubahan aplikasi/schema/account mapping, application validation runs, subagent, atau commit.

### Matriks item157190 — shipping_cost_discount nonzero menjadi kandidat terisolasi

Pemilik meminta eksperimen pengurangan field, mengoreksi target menjadi **SKU157190 Celana Okcir Bagus** (product group55269), memilih invoice-only, dan menyetujui maksimal10 kasus dengan global stop. [Protokol approved](../research/research-08-field-matrix-protocol.md), [laporan hasil/input-output](../research/research-08-field-matrix-evidence.md), [journal](../research/research-08-field-matrix-results.json).

A–G berhasil membuat invoice terverifikasi: SO68426–68432/invoice45958–45964. Kontrol barang tanpa diskon(A), diskon barang integer10%/100000 tanpa ongkir(B/F), ongkir biasa tanpa/dengan diskon barang(C/D), shipping_cost_discount explicit0(E), shipping_cost omitted(F), serta original_shipment_cost30000 sendiri(G) semuanya berhasil. Invoice/payment_amount0 dan due penuh menunjukkan invoice belum dibayar; payment tidak diuji. Original shipment metadata G tidak tersedia pada invoice GET, walaupun SO mempertahankannya.

**H SO68433**: price1000000/disc10/disc_amount100000/net900000, shipping_cost10000/grand910000, original_shipment_cost omitted, shipping_cost_discount**20000**. Create/GET nominal cocok, tetapi conversion invoice-only **HTTP500/code23113**, tanpaID. D/E/H mempunyai konteks finansial sama; key shipping_cost_discount omitted/0 berhasil sedangkan20000 gagal. Ini mempersempit kandidat nonzero shipping discount pada envelope ini, bukan bukti akar exception internal atau semua nominal/sources/provider combinations.

Global stop aktif padaH, **I/J not-run**. Reconciliation SO68433: invoice_idnull, is_canceled/is_paidnull, marker Belum Bayar, grand910000; stock157190/location2 kini on_hand14/on_order2/available12, dari baseline21/1/20. Filtered invoice list10/totalCount10 hanya tiga invoice lama+tujuh A–G; payment list3/totalCount3 tetap40/42/44. Bukan proof rollback H. Manual UI/audit disposition H diperlukan sebelum cleanup; tidak retry/cancel/payment/mirror atau mengubah SO historis.

Terpakai**8/10 create dan8/10 invoice attempts**, kumulatif**31 create attempts** pada checkpointH. Dua slot sisa bukan izin otomatis melanjutkan setelah stop. Tidak ada perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit. Tiket tetap claimed; safe settlement subsidi dan unknown fixtures sebelumnya belum diselesaikan.

### I/J dilanjutkan dengan izin pemilik — keduanya23113

Pemilik meminta I/J dijalankan. I dibuat **SO68434**: tanpa diskon barang (disc0/disc_amount0), price1000000, original shipment30000/subsidi20000/net shipping10000, grand1010000. Create/GET cocok, tetapi invoice-only conversion **HTTP500/code23113**, tanpaID. Agent stop sebelumJ dan reconciliation read-only sesuai protokol.

Setelah menerima hasil ambigu I, pemilik memberi izin khusus **Ya, jalankan J (Recommended)**. J dibuat **SO68435**: disc10/nominal100000/net900000, metadata shipping sama, grand910000. Create/GET cocok, conversion invoice-only kembali **HTTP500/code23113**, tanpaID. Tidak retry I/H/J, mirror, payment, cancel atau perubahan fixtures historis.

[Evidence lengkap I/J](../research/research-08-field-matrix-ij-evidence.md), [journalI](../research/research-08-field-matrix-ij-results.json), [journalJ](../research/research-08-field-matrix-j-results.json). GET kedua SO invoice_idnull/is_canceled/is_paidnull, nominal tetap. Filtered invoice/payment lists tetap10/3 artefak yang sudah dikenal; bukan proof rollback. Stock157190/location2 akhir on_hand14/on_order4/available10. SO68434/68435 juga memerlukan manual UI/audit disposition sebelum cleanup.

Kesimpulan: I tanpa diskon barang tetap error, jadi diskon barang bukan kondisi yang diperlukan pada skenario subsidi ini. G versusJ memperkuat pembanding shipping_cost_discount omitted(sukses) versus20000(gagal) ketika original30000/net shipping10000/grand910000 sama. Ini belum mengungkap mekanisme journal/account mapping/gross-net contract atau membuktikan semua nilai nonzero gagal.

Seluruh A–J sudah dieksekusi:7 invoice verified,3 conversion errors23113. Budget**10/10 create dan10/10 invoice attempts** habis; kumulatif**33 create attempts** pada akhir A–J. Stop business writes aktif, tidak ada izin write/cleanup baru diasumsikan. Tidak ada perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit. Tiket tetap claimed, bukan resolved.

### Ablation I/J: hapus shipping_cost_discount, kedua invoice berhasil

Pemilik kemudian meminta I/J diuji pada dua fixtures baru dengan shipping_cost_discount **dihapus**, bukan0/null. [Protokol dan hasil](../research/research-08-without-shipping-discount.md), [journal tersanitasi](../research/research-08-without-shipping-discount-results.json). Konstanta item157190/location2/qty1/price1000000/NoTax1, original_shipment_cost30000, shipping_cost10000 dan nominal lainnya tetap; hanya key subsidi20000 yang omitted dari financial input.

**I-minus SO68436 → invoice45968** berhasil HTTP200/GET verified, tanpa diskon barang/grand1010000. **J-minus SO68437 → invoice45969** berhasil, diskon barang10%/100000/grand910000. Key omitted dikonfirmasi fieldPresence dan guard actual payload; GET shipping_cost_discount0 adalah default provider. Invoice unpaid/due penuh; original shipment metadata tersimpan di SO tetapi tidak tersedia pada invoice GET. Tidak ada retry/edit SO I/J asli atau fixtures historis.

Dua pasangan I/I-minus dan J/J-minus memperkuat bahwa penambahan shipping_cost_discount20000 membedakan request gagal23113 dari request sukses invoice pada envelope ini. Belum membuktikan field intrinsik salah untuk semua nominal/sources atau menjelaskan gross/net shipping/accounting journal. Tidak ada perubahan mapping/config atau asumsi funding merchant tercatat otomatis.

Tambahan**2/2 create dan2/2 invoice attempts**, kumulatif**35 create attempts** pada akhirablation. Stock157190/location2 saat itu on_hand12/on_order4/available8; filtered invoice list12/totalCount12 dengan dua invoice ablation, payment list3/totalCount3 tetap40/42/44. Tidak ada mirror/payment/cancel/retry, cleanup unknown fixtures lama, perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit. Tidak ada izin write berikutnya otomatis; tiket tetap claimed, bukan resolved.

### Hipotesis unit persen: field10/20 tetap23113

Pemilik mengusulkan shipping_cost_discount sebagai persen dan menyetujui opsi **Sesuai hipotesis persen (Recommended)**: original30000, field10→net shipping27000/grand927000; field20→net shipping24000/grand924000. Konstanta SKU157190/location2/price1000000/qty1/goods disc10%100000/NoTax1 tetap. [Protokol/approval/hasil](../research/research-08-shipping-percentage.md), [journalP10](../research/research-08-shipping-percentage-results.json), [journalP20](../research/research-08-shipping-percentage-p20-results.json).

P10 create **SO68438**/GET money cocok, satu invoice-only conversionHTTP500/code23113. Agent stop dan reconciliation; setelah menerima outcome ambigu, pemilik memberi izin khusus **Ya, jalankan P20**. P20 create **SO68439**/GET money cocok, conversion invoice-only kembaliHTTP500/code23113. Tidak retry, mirror, payment, cancel atau perubahan fixtures historis.

GET menyimpan10.0000/20.0000, bukan bukti independent computed benefit3000/6000. Satuan **persen atau amount tetap unknown**; nilai10/20 dengan net yang dihitung sesuai hipotesis belum menghindari error, bukan proof persen pasti salah atau amount pasti benar. Label subsidi20000 di penelitian lama adalah intended business benefit/candidate mapping, bukan proof unit provider.

Reconciliation kedua SO invoice_idnull/is_canceled/is_paidnull; filtered invoice list12/totalCount12 dan payment3/totalCount3 tanpa artefak baru terlihat untukP10/P20, bukan proof rollback internal. Stock157190/location2 akhir on_hand12/on_order6/available6; kedua fixtures memerlukan manual UI/audit disposition sebelum cleanup. Tranche**2/2 create dan2/2 invoice attempts**, kumulatif**37 create attempts**. Tidak ada perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit. Tidak ada budget/izin write lanjutan otomatis; tiket tetap claimed.

### Pemilik memilih arah caseG dan merevisi goods-only

Setelah hasil research, pemilik meminta shipping_cost_discount dikecualikan dan shipping_cost/original_shipment_cost diisi seperti caseG. Agent menjelaskan original=ongkir sebelum subsidi, shipping=net customer, pemisahan subsidi merchant dan gap payment, serta bahwa ini mengubah pilihan goods-only. Pemilik menyetujui melalui **Ya, catat revisi mapping (Recommended)**. [Keputusan parsial lengkap](../research/research-08-selected-shipping-mapping.md).

Arah planning terbaru: **barang + net ongkir**, contoh original30000/shipping10000, shipping_cost_discount **OMIT dari request** (bukan0/null), goods net900000 sehingga candidate payable910000 tanpa PPN/fee website. Subsidi/funding merchant dan quote/biaya kurir tetap dicatat terpisah di website, kebijakan finance04 tetap. Provider GET boleh menampilkan default discount0 meskipun request omitted.

Approval ini hanya arah mapping parsial pada checkpoint pemilihan caseG, **bukan** complete contract09, implementasi, testing/provider write baru atau penutupan tiket. Pada checkpoint itu revisi required proof08 belum disetujui; approval terpisah berikutnya dicatat di bawah. Payment/preservation lifecycle konfigurasi terpilih masih belum lengkap dan unknown disposition fixtures tetap terbuka. Tiket08 tetap claimed,09 tetap open/blocked; budget tetap37, tanpa perubahan aplikasi/schema/master/account mapping/env, application validation runs, subagent, atau commit.

### Approval revisi scope bukti08 — empat keputusan pemilik

Pemilik kemudian meminta questionnaire untuk remaining issues dan menyetujui: **Ya, fokus mapping terpilih (Recommended)**; **Per baris, add_disc0 (Recommended)**; **Pisahkan tindak lanjutnya (Recommended)**; **SO + nominal lifecycle (Recommended)**. [Scope/acceptance approved lengkap](../research/research-08-approved-proof-scope.md).

Dampak: field ongkir/funding yang tidak digunakan dan lifecycle add_disc nonzero tidak lagi required proof scope awal. Legacy outcome/cleanup dipisah tanpa dianggap rollback/sukses/canceled; tidak membuat tiket baru atau memberi izin cleanup. Original diverifikasi diSO, invoice/payment dinilai dari nominal dan linkage yang tersedia, tanpa mewajibkan proof metadata internal invoice. Question/Bukti penyelesaian di atas diperbarui agar memakai scope aktif ini.

Pada checkpoint approval scope, payment, full-payload mirror dan qty>1 pada mapping terpilih masih perlu evidence; safe cancel yang eligible tetap bagian kewajiban08. Tiket saat itu claimed,09 open/blocked by08. Jawaban scope tersebut bukan izin provider write/implementasi; budget saat itu37, hanya dokumentasi berubah. Protokol dan izin tambahan berikutnya dicatat di bawah.

### T1–T3 setelah approval protokol lifecycle

Pemilik memilih **Setuju, T1–T3 (Recommended)** setelah menerima budget3 create/3 mirror/2 invoice/2 payment/1 eligible cancel, inputqty1/qty2, payment account2/type0 serta global stop. [Protokol dan hasil lengkap](../research/research-08-selected-lifecycle.md), [journal](../research/research-08-selected-lifecycle-results.json).

- T1 **SO68440 → invoice45972 → payment55**, qty1, goods discount100000/net900000 + shipping10000 =910000. Mirror/GET/paid invoice/payment association/due0 terverifikasi.
- T2 **SO68441 → invoice45973 → payment57**, qty2 satu baris, gross2000000−whole-line discount200000=net1800000 + shipping10000 =1810000. Nominal/identity dipertahankan setelah mirror/invoice/payment; satu association/due0.
- T3 **SO68442**, qty1/grand910000, mirror cocok lalu satu safe cancel pre-invoice. GET is_canceledtrue/invoice_idnull dan stock kembali baseline kasus9/6/3.

Semua request create/mirror tanpa shipping_cost_discount; SO GET original30000/net shipping10000 tetap. Metadata original tidak tersedia pada invoice GET, sesuai accepted limitation. SO is_paid tetapnull pada T1/T2; paid status dibuktikan dari payment association/due0 dan invoice paid amount, bukan flag tersebut.

Dipakai3 create/3 mirror/2 invoice/2 payment/1 cancel tepat sesuai izin, tanpa retry/stop atau perubahan order historis. Stock157190/location2 dari12/6/6 menjadi9/6/3, net consumed3unit dari dua invoice; on_order6 legacy tidak dibersihkan. Final filtered invoice/payment lists14/5 artefak terkonfirmasi. Kumulatif40 create attempts, tidak ada budget atau izin write lanjutan otomatis.

## Answer — scope terpilih terverifikasi

**Resolved setelah review main agent terhadap scope dan protokol yang disetujui**, bukan otomatis dari HTTP200. [Review acceptance per kewajiban](../research/research-08-selected-lifecycle.md#review-acceptance-tiket08) menggabungkan T1–T3 dengan evidence precision/whole-line/fixed-capped allocation sebelumnya.

Kontrak yang teramati pada envelope source INTERNAL/tax0: diskon barang per baris dan total_disc konsisten, add_disc0; original_shipment_cost ongkir sebelum subsidi pada SO, shipping_cost net customer, shipping_cost_discount absent dari actual request. Full-payload marker sebelum invoice/cancel mempertahankan IDs/uang; invoice/paymentqty1/qty2 satu baris mempertahankan nominal dan linkage, payment exact/due0; eligible cancel memulihkan stock. Fixed/capped dua baris dan precision didukung evidence L/J/H/R terdahulu, bukan contract universal untuk input inconsistent.

Batas approved tetap eksplisit: tidak mewajibkan field/funding/header nonzero yang tidak dipakai atau metadata original internal invoice; unit field excluded tetap unknown. Legacy ambiguity/cleanup tetap follow-up terpisah, bukan dianggap rollback/canceled atau gate kontrak baru. Mirror yang dibuktikan adalah stage sebelum invoice/cancel; jangan menyatakan semua edits post-invoice, refund/tax/source/account lain verified. Funding merchant/PPN/fee website tetap menurut04, tidak otomatis dijurnal provider.

[Evidence ringkas terkini](../research/research-08-evidence.md), [scope approved](../research/research-08-approved-proof-scope.md), [mapping parsial terpilih](../research/research-08-selected-shipping-mapping.md). Research ini menyelesaikan08 pada scope terpilih; **complete mapping contract09 dan approval implementasi tetap terpisah**. Tidak ada perubahan aplikasi/schema/master/account mapping/env, unit/E2E/build/lint/typecheck aplikasi, subagent, atau commit. API probes yang diizinkan dan review journal dilakukan main agent.
