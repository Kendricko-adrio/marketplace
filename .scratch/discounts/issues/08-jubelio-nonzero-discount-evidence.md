# Bukti Kontrak Diskon Nonzero Jubelio

Label: wayfinder:research
Type: research
Status: claimed
Assignee: main-agent
Blocked by: 07, 04
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Perilaku provider yang diverifikasi secara independen apa yang membuktikan diskon barang nonzero, representasi ongkir, dan pemeliharaannya sepanjang invoice/payment?

Gunakan research yang ada dan teliti hanya gap berikut:

- Otoritas/perhitungan ulang `disc` dibandingkan `disc_amount`, serta nominal seluruh baris dibandingkan per unit untuk quantity > 1.
- `total_disc` dibandingkan `add_disc`, alokasi diskon capped/fixed, dan agregat yang konsisten.
- Field ongkir/funding yang benar-benar writable untuk source INTERNAL, bukan kesimpulan dari field response-only.
- SO GET → invoice GET → payment GET; payable setelah diskon dan pemeliharaan nominal saat safe cancel/full-payload mirror.

Bukti provider/support read-only dapat mempersempit gap sebelum sandbox writes yang diizinkan terpisah. Provider yang tidak dapat diakses atau memberi hasil ambigu bukan bukti kontrak.

## Referensi dan batasan

- [Penelusuran field resmi saat ini](../../../plan/research/discounts-coupons-promo-codes.md#b-fresh-first-party-jubelio-contract-and-evidence-level).
- [Kandidat mapping dan contoh kasus](../../../plan/research/discounts-coupons-promo-codes.md#c-candidate-mapping-for-the-selected-benefits--not-runtime-verified).
- [Guard zero-discount saat ini](../../../apps/store/src/lib/jubelio-sales-client.ts#L418).
- [Pemeriksaan settlement saat ini](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts#L746).
- [Operation ledger provider yang ada](../../../packages/db/src/schema/jubelio-sales.ts).

Memerlukan Akses dan Izin Verifikasi Jubelio di Akun Test Terisolasi serta Perhitungan Pajak dan Subsidi Ongkir. Fakta tidak otomatis menyetujui pilihan accounting. Izin harus mencakup protokol aktual yang telah diperjelas dan setiap tindakan write. Tidak ada pengujian production, edit order existing, penyamaran source, atau retry write yang ambigu.

## Bukti penyelesaian

Link ke artefak bukti yang disanitasi: input/label kasus, field nominal/quantity/diskon relevan, konfirmasi independen, dan unknowns yang masih ada. Jangan memasukkan token, raw customer response, atau PII. Bukti wajib yang belum tersedia membuat tiket tetap open/blocked atau memerlukan perubahan destination yang disetujui pemilik; jangan menutupnya seolah sudah verified.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `research`, `development-workflow`, dan panduan dokumentasi provider yang relevan. Research langsung oleh main agent kecuali ada izin delegasi terpisah. Tidak ada subagent/fork/commit otomatis, kode aplikasi, atau validation runs. Ikuti scope provider yang diizinkan secara spesifik; write ambigu berhenti untuk reconciliation read-only/manual review.

## Comments

Pada publikasi awal protokol sandbox/business request belum diizinkan. Pemilik kemudian mengizinkan pengujian sandbox dengan batas maksimal 5 SO dan menyerahkan rincian protokol kepada agent; prerequisite akses/izin [tiket 07](07-jubelio-verification-access-and-permissions.md) resolved.

Bukti pendahuluan terbatas, bukan pengerjaan/penyelesaian tiket blocked ini: [protokol dan hasil sandbox](../sandbox-verification.md), [evidence JSON](../sandbox-results.json). Dua request create dijalankan: baseline SO 68408 berhasil dan dibatalkan terverifikasi; create nominal-only nonzero mengembalikan HTTP 500 tanpa ID, sehingga semua business writes dihentikan tanpa retry. Rekonsiliasi list terbatas dan stock tidak membuktikan non-application. Operator investigation diperlukan sebelum write berikutnya. Marker/invoice/payment nonzero dan kasus lanjutan belum dijalankan.

Setelah pemilik memeriksa UI dan meminta investigasi error, [investigasi lanjutan](../sandbox-error-investigation.md) menambah dua kasus pembeda yang terotorisasi dalam budget: F dengan persentase 10% + nominal Rp25.900 berhasil (SO 68409, GET total Rp233.100, cancellation dan stock terverifikasi); G dengan money yang sama tetapi `disc=0` kembali HTTP 500 generik tanpa ID/code spesifik. Total kumulatif **4/5 request create**, tanpa retry B/G; write dihentikan lagi. Ini membuktikan kasus nonzero persentase+nominal konsisten, bukan akar exception internal atau dukungan fixed/capped arbitrary Rupiah. Marker/invoice/payment nonzero dan quantity >1 belum diuji.

Pada akhir sesi preliminary, tiket masih open dan blocked oleh kebijakan finance 04; evidence preliminary tidak membuktikan kontrak lengkap atau kesiapan launch.

### Tambahan preliminary H — persentase dari nominal

Pemilik mengarahkan agar `disc` dihitung dari nominal. Request ke-5 dalam budget awal: harga Rp259.000 ×1, nominal Rp20.000, `disc: 7.722007722007722`, net Rp239.000 berhasil SO **68410**. GET menunjukkan persentase `7.72` tetapi nominal/header/line tetap tepat Rp20.000/Rp239.000. Cancel pre-invoice dan stock restore terverifikasi. [Request/response dan batas kesimpulan H](../sandbox-error-investigation.md#h--persentase-dihitung-dari-nominal-request-terakhir), [evidence H](../sandbox-results.json).

Budget awal **5/5**, B/G tidak diretry; tanpa marker/invoice/payment nonzero atau quantity >1. Persentase boleh diturunkan sebagai kandidat representasi sesuai arahan pemilik, tetapi uang website tetap authoritative; jangan hitung ulang nominal dari persentase GET yang sudah dua desimal. H belum membuktikan seluruh kontrak provider atau implementation readiness. Catatan ini tidak mengubah otorisasi research lanjutan yang dicatat terpisah di bawah.

### Research lanjutan — otorisasi terbaru

Pemilik meminta research dijalankan dan secara eksplisit mengizinkan testing Jubelio menggunakan credentials `.env`, dengan konfirmasi bahwa credentials mengarah ke sandbox. Izin terbaru memperluas batas testing sebelumnya, bukan izin production atau perubahan aplikasi. Agent tetap membatasi eksperimen pada fixtures research, mencatat protokol sebelum write, dan menghentikan business writes pada outcome ambigu tanpa blind retry.

Prerequisite 04 dan 07 sekarang `resolved`; tiket diklaim oleh main agent. Outcome B/G masih memerlukan rekonsiliasi. Tidak ada subagent, commit, atau validation runs aplikasi yang diizinkan/dijalankan.

Hasil fase read-only sebelum eksekusi tambahan: [research evidence dan protokol lanjutan](../research-08-evidence.md), [evidence JSON tersanitasi](../research-08-results.json). GET spec resmi mengonfirmasi tujuh block schema masih cocok dengan vendor spec; GET SO 68409 membuktikan diskon Rp25.900/net Rp233.100 tetap tersimpan sesudah cancellation. Delapan endpoint list status/sales/invoice/payment dengan filter customer dummy hanya menemukan dua SO canceled yang dikenal, tanpa invoice/payment. Coverage ini tidak membuktikan rollback B/G. Pada fase tersebut tidak ada business writes baru. Finance 04 bukan blocker yang belum selesai.

### Eksekusi tambahan — 5 create SO setelah instruksi “iya tolong jalankan”

Pemilik memberi tambahan 5 create lalu meminta eksekusi. [Protokol dan hasil J–N](../sandbox-followup.md) menentukan kasus baru independen, bukan retry B/G atau asumsi rollback. Budget kumulatif kini **10/10 create attempts**; seluruh lima create baru mendapat ID dan money GET sesuai expected independen.

- J: SO **68411**, marker full-payload dengan persentase GET 7.72 tetap mempertahankan diskon Rp20.000/net Rp239.000; invoice **45951** mempertahankannya; payment **40** tepat Rp239.000, satu association invoice/SO, due 0.
- K: SO **68412**, qty 2, nominal satu line Rp51.800, net Rp466.200; cancel dan stock restore.
- L: SO **68413**, alokasi dua line Rp10.177 + Rp9.823 tepat Rp20.000, net Rp489.000 meskipun kedua persentase GET 3.93; cancel dan stock restore.
- M/N: SO **68414/68415**, GET membuktikan `total_disc` line terpisah dari `add_disc` pada fixture tax/fee/ongkir nol; net Rp249.000 dan Rp234.000. Cancel dan stock restore.

Request lengkap, proyeksi output, invoice/payment association dan cleanup tersimpan pada [sandbox-results.json](../sandbox-results.json), event J–N. SO 68411/invoice/payment dibiarkan sebagai artefak sandbox; tidak cancel post-invoice. Tidak ada perubahan aplikasi/guard/schema, validation runs aplikasi, delegasi, atau commit.

Tiket **tetap claimed**, bukan resolved: writable subsidi/funding ongkir INTERNAL belum terbukti dan B/G tetap unknown; lifecycle multi-line/qty 2/header discount belum diverifikasi sampai invoice/payment. Fakta baru ini perlu dibawa ke keputusan mapping tiket 09 setelah bukti wajib 08 lengkap atau destination direvisi dengan approval pemilik.

Pada fase recheck screenshot sebelum tranche terbaru, research membaca evidence H yang baru tersedia dan menjalankan GET independen SO 68410. H cocok dengan screenshot: ref H pada UI, qty 1, persentase GET 7,72%, nominal Rp20.000, net Rp239.000, canceled true, invoice null. Recheck canceled list sekarang memuat tiga fixtures 68408/68409/68410; endpoint list lain tetap kosong pada filter dummy. Screenshot tidak memperlihatkan ref B/G atau audit disposition keduanya. Tidak ada business writes baru. Saat fase tersebut protokol research dibatasi maksimal5 create tambahan/kumulatif10 sesuai tambahan budget pada tiket07; kemudian otorisasi terbaru di bawah memperluasnya. Outcome B/G tetap unknown, tidak diretry.

### Tranche terbaru — 10 create tambahan dan blocker invoice subsidi

Pemilik memberi izin **10 SO lagi** dan meminta research diteruskan sampai selesai. Setelah membaca evidence J–N, baseline dikoreksi menjadi10 existing; tranche terbaru memakai10/10, sehingga total **20 create attempts**, bukan20 SO berhasil. [Protokol](../research-08-write-protocol.md), [research final/remaining unknowns](../research-08-evidence.md), dan [journal tersanitasi](../research-08-write-results.json).

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

Hasil: SO68422 tetap ada, invoice_idnull, is_canceled/is_paidnull, grand249000/marker Menunggu Verifikasi. Tiga invoices45951/45952/45953 dan payments40/42/44 terkonfirmasi linked keSO68411/68417/68418, tidak ke68422. Semua filtered pages complete menurut totalCount, tetapi bukan audit internal. Stock43842/location2 tetap on_hand1/on_order1/available0. [Analisis reconciliation](../research-08-evidence.md#reconciliation-so68422-setelah-instruksi-pemilik), event `F6-reconciliation-*` pada [journal](../research-08-write-results.json).

Tidak ada invoice/payment terkait68422 yang terlihat; ini bukan proof rollback conversion500. Stop writes/cleanup tetap aktif. Klarifikasi accounting support ditunda sesuai pemilik, **bukan dianggap verified**, tidak otomatis memilih ledger shipping extended/goods-only, dan tidak menutup required proof08. Tiket tetap claimed. Disposition/cleanup berikutnya memerlukan manual UI review pemilik dan keputusan terpisah; SO68422 tidak dibatalkan otomatis.
