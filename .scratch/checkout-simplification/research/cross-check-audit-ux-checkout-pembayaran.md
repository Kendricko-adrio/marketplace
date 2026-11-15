# Cross-check audit UX checkout dan pembayaran

Belum ada perubahan tampilan aplikasi. **Audit asal belum mendukung klaim seluruh AC Verified:** AC02/AC03 memerlukan evidence tambahan; AC05/AC06/AC07/AC09 perlu rekonsiliasi penilaian seperti dijelaskan di bawah.

- Tanggal: 2026-11-14; source checkout pada HEAD `7abc7f9`, termasuk working tree saat pemeriksaan.
- Objek: [laporan asal](review-ux-checkout-pembayaran.md), [indeks capture](indeks-capture-ux-checkout.md), [spec audit](../plan/spec-audit-ux-checkout-pembayaran.md), benchmark, kedua proposal improvement, manifest, report, fixture, script, dan screenshot existing.
- Ini addendum research, **bukan spec baru, perubahan approval plan, atau izin implementasi**. Rekomendasi di sini usulan agent; tidak dianggap keputusan user.

## 1. Kesimpulan

Arah penyederhanaan sebelumnya relevan: pengulangan warning, hierarki review, orientasi mobile, dan copy hasil pembayaran memang perlu diperhatikan. Namun, tidak semua observasi merupakan bug dan tidak semua solusinya tepat.

**Dari 22 temuan sebelumnya: 10 dipertahankan inti penilaiannya, 12 perlu penajaman atau koreksi.** Tidak berarti 12 itu seluruhnya tidak berguna: beberapa mencampur masalah nyata dengan solusi berlebihan, pengecualian accessibility yang belum diperiksa, atau perilaku aman yang justru harus dipertahankan.

Empat feedback UI tambahan: **T23 dropdown alamat terpotong, T24 skeleton tidak terlihat, T25 status processing dipresentasikan seperti error dan CTA tidak sesuai aksi, T26 akses syarat di titik persetujuan.** Masalah fixture promo juga mengubah kesimpulan tentang copy “Hemat total”.

## 2. Apa yang benar-benar diperiksa

1. **180/180 screenshot** ditinjau sebagai overview pada 15 contact sheet. Gambar kunci dibuka lagi secara individual: F02 mobile full, F05 mobile dropdown, F03 desktop slot, P01 mobile full, O01 mobile full, O08 mobile loading, P09b mobile inline, O06 desktop checked, P04 mobile page 1, dan P05 mobile error. Overview bukan pemeriksaan setiap detail teks/pixel pada 180 gambar.
2. T01–T22 dicocokkan dengan gambar, probe existing, handler UI, shared components/tokens, serta kontrak domain terkait. Interaksi dari audit asal **tidak dijalankan ulang**; status probe disebut sebagai evidence arsip, bukan hasil browser baru.
3. Integrity PNG diperiksa ulang: **180 ID unik, 180 file, 0 selisih byte length/lebar PNG terhadap manifest, 0 selisih tinggi untuk non-full-page**.
4. `node playwright/mcp/checkout-ux-review/check-gallery.cjs` dijalankan ulang: **180 kartu, 180 gambar termuat, 0 broken image, 0 missing href, 0 external request, 0 page error**. Ini membuka galeri lokal, bukan menjalankan checkout.
5. Nominal baseline dihitung dengan literal independen: pickup 166.500; delivery ongkir 12.000 → 179.820; promo 25.000 → 138.750. Total 8 line items fixture panjang = 150.000.
6. Sumber W3C primer diperiksa untuk membedakan requirement dan rekomendasi accessibility (§7).

Tidak ada login baru, replay script capture, akses provider, order/payment, perubahan DB, code produk, tests produk, build/lint/typecheck, commit, push, atau subagent. Contact sheet baru hanya di `playwright/mcp/checkout-ux-review/cross-check/` (disposable). Context7 tidak diperlukan: tidak ada implementasi API library; checker galeri existing dijalankan tanpa perubahan.

## 3. Verdict T01–T22

“Pertahankan” berarti inti observasi dan arah improvement didukung; dampak terhadap pengguna tetap penilaian heuristik, bukan hasil usability testing. “Koreksi” berarti batas klaim atau rekomendasinya perlu diubah.

| ID | Verdict | Hasil cross-check dan rekomendasi yang lebih tepat |
|---|---|---|
| T01 | **Pertahankan — P1** | Label step mobile memang hilang (`checkout/page.tsx:1420`, F01/P01 mobile). Heading masih membantu orientasi, jadi jangan menyebut pengguna sama sekali tidak tahu posisinya. Label pendek atau “Langkah 1 dari 2” lebih jelas daripada ikon saja. |
| T02 | **Koreksi — P2** | `Lanjut` aktif pada pickup kosong memang benar (`checkout/page.tsx:1751`), tetapi enabled submit dengan validasi setelah klik bukan otomatis UX buruk. Field tanggal/telepon/email sudah memiliki tanda `*`; klaim “tidak ada panduan wajib” terlalu mutlak. Utamakan error dekat field, nama aksesibel, dan fokus ke input invalid; **jangan otomatis men-disable tombol** sehingga alasan tidak bisa lanjut justru sulit diketahui. |
| T03 | **Pertahankan — P1** | Error slot Inggris bukan hanya karangan fixture: `lib/pickup-validation.ts:112` memang menghasilkannya dan route meneruskan error. Tempatkan pesan Indonesia pada field terkait. Screenshot F03 sendiri belum cukup membuktikan penempatan error di mobile karena area bawah tidak tertangkap (§6). |
| T04 | **Pertahankan — P1** | F02/P01 full membuktikan pengulangan caveat pickup dan checkbox panjang. Ringkas menjadi satu caveat terlihat; detail tambahan boleh disclosure. Kontak muncul ulang pada review bukan otomatis duplikasi buruk: pengguna memang perlu memeriksanya sebelum bayar. |
| T05 | **Pertahankan — P1** | P01/P02 full menunjukkan banyak surface kecil dan warning yang berebut perhatian. Benahi prioritas total/aksi dan grouping, bukan sekadar mengejar jumlah card atau tinggi halaman. **Total, barang, tujuan/slot, dan konsekuensi pembayaran jangan disembunyikan.** |
| T06 | **Pertahankan — P1** | ETA ada pada pilihan layanan, tetapi tidak dirender dalam review (`DeliveryQuotePanel.tsx:576`, `checkout/page.tsx:1848`). Tampilkan kembali estimasi yang sah di review, tanpa mengubahnya menjadi janji tiba atau menebak durasi baru. |
| T07 | **Koreksi — P2** | Benar tidak ada penanda **selisih** total turun, tetapi bukan “tanpa feedback”: `preparePromo` memanggil toast “Promo diterapkan” (`checkout/page.tsx:884`). Penurunan yang menguntungkan tidak perlu dialog konfirmasi baru; bila diperlukan, cukup feedback inline “Total turun Rp5.550”. |
| T08 | **Pertahankan — P1** | P07 alert menampilkan alasan promo gugur, tetapi dampak kenaikan total terpisah. Jelaskan “Promo berakhir; total naik Rp22.200 menjadi Rp166.500”. Pertahankan pengakuan eksplisit untuk lanjut tanpa promo dan review total terbaru. |
| T09 | **Pertahankan — P1** | P08 mobile rejected/inline menunjukkan toast menutup bagian header dan pesan sama diulang inline; banner review ulang juga muncul. Buat satu feedback utama yang terlihat dan dapat ditindaklanjuti. Jangan sekadar menghapus toast jika pesan inline tetap di luar viewport tanpa focus/scroll yang tepat. |
| T10 | **Koreksi — P1** | Kartu recovery P09 tidak menampilkan hasil stabil “masih diproses”, tetapi tombol **sudah** memiliki loading “Memeriksa pesanan…” (`checkout/page.tsx:1358`). Tidak ada link detail saat attempt belum menjadi order adalah boundary aman, bukan otomatis bug. Tambahkan hasil pemeriksaan yang jujur; link detail hanya saat `orderId` sah tersedia. |
| T11 | **Pertahankan — P1** | O01 mobile full: tracking kosong mendahului detail dan CTA bayar berada setelah barang. Optimalkan khusus status pending: status + total + lanjut bayar lebih dahulu; tracking bisa ditunda. Jangan menyamaratakan “CTA jauh” pada desktop karena kartu pembayaran berada di kolom kanan. |
| T12 | **Koreksi — P1 bersyarat** | Nilai metode `—` berasal dari `paymentMethod: null`; metode memang dapat belum dipilih sebelum halaman provider. Jangan mengarang VA/instruksi pembayaran atau memaksa metode tersedia. Deadline konkret berguna **jika backend memberikannya**; `paymentRecovery.expiresAt` ada, tetapi bukan bukti semua order mempunyai deadline pada DTO. Label “Belum dipilih”/“Pilih saat pembayaran” lebih informatif bila sesuai kontrak. |
| T13 | **Pertahankan — P0** | `checkout/result/page.tsx:19–29` langsung menyimpulkan status dari query. Copy sukses menjanjikan kode pickup untuk delivery; gagal mengklaim order batal tanpa verifikasi; ID terpotong. Ini prioritas keselamatan status. **Menetralkan paragraf saja tidak cukup** jika heading/ikon tetap menyatakan sukses/gagal tanpa bukti. |
| T14 | **Pertahankan — P2** | O05 completed tetap memberi instruksi “Tunjukkan kode…” (`orders/[id]/page.tsx:179,312`). Instruksi aksi harus mengikuti lifecycle. Kode boleh tetap tersedia sebagai arsip jika diinginkan; tidak perlu otomatis menghapus akses terhadap bukti pengambilan. |
| T15 | **Koreksi — P1** | Klik recovery order menaikkan `reloadKey`; fetch memasang `loading=true` dan merender skeleton (`orders/[id]/page.tsx:67–100,477`). Jadi klaim “tidak ada loading” salah. Masalahnya **loading praktis tidak terlihat** (T24) dan tidak ada hasil eksplisit saat status tetap. Report bahkan mencatat `paymentRecoveryAfterCheck=false` pada desktop, sedangkan mobile `true`: capture berpotensi berada pada fase reload berbeda. |
| T16 | **Koreksi — P1/P2** | Copy gagal memang tidak memiliki CTA kontekstual sendiri. Namun O07 punya tombol **Beli lagi per barang**, navigasi riwayat, dan handler ke produk (`orders/[id]/page.tsx:398–407`); “tidak ada jalan lanjut yang dapat diklik” terlalu luas. Perjelas tindakan utama per status. Jangan menyebut pembatalan, refund, atau kewajiban bayar tanpa data, dan jangan membuat order pengganti otomatis. Tidak perlu P0 untuk ketiadaan CTA katalog saja. |
| T17 | **Koreksi — P1 untuk layout; verifikasi browser Pending** | Overflow root-font 200% memang tercatat (442/498 vs clientWidth 390). Itu bukan browser zoom 200% dan rem-based padding/ikon/WA ikut membesar; tidak setara text-only resize. Perbaikan wrap layak diusulkan, tetapi jangan menyebut pelanggaran WCAG pasti atau replikasi perangkat nyata dari emulasi ini saja. |
| T18 | **Koreksi — P1** | O02 mobile memperlihatkan WA bertumpuk dengan “Beli lagi”; overlap visual nyata. Namun klaim target pasti tidak dapat diklik belum didukung hit-testing/percobaan klik pada koordinat tertutup. Cek posisi scroll relevan dan focused controls sebelum menetapkan strategi hide/reposition; jangan otomatis menonaktifkan bantuan di seluruh situs. |
| T19 | **Koreksi — P1 label/fokus; P2 target** | Label waktu tidak dihubungkan ke select; probe modal alamat mengembalikan fokus ke BODY: relevan. Rect Close 15,2 px dan sosial 20 px **tidak otomatis gagal SC 2.5.8**: checker tidak menyimpan koordinat tetangga atau menguji spacing/equivalent exception. Footer memakai `gap-3` (`Footer.tsx:61`), sehingga target 20 px dengan jarak itu dapat memenuhi spacing exception. Perbesar hit area sebagai improvement; jangan melabeli semua sebagai pelanggaran terbukti. |
| T20 | **Koreksi — P1 active placeholder; P2 lainnya** | Rasio teks aktif yang dilaporkan memang di bawah 4,5; 4,47 tidak boleh dibulatkan menjadi lulus. Tetapi checker tidak memisahkan disabled/inactive: Kota/Kecamatan/Area nonaktif pada modal kosong dikecualikan dari contrast requirement. **Provinsi aktif 3,58 tetap masalah**; placeholder teks mengikuti 4,5, bukan ambang non-text 3. Komentar token `globals.css:29–35` tidak membenarkan 3,6 untuk teks aktif. Bukan pilihan estetika “tetap” bila targetnya AA. |
| T21 | **Koreksi — keputusan produk** | Refresh menghilangkan tanggal/waktu dan memulihkan kontak sesi, sesuai probe existing. Persistensi bisa membantu, tetapi perlu aturan umur data, privasi, dan validasi ulang slot. Menekan **Batal** lalu draft alamat dibuang bukan otomatis defect; draft/applied memang dipisahkan (`DeliveryQuotePanel.tsx:252–265`). Bedakan batal eksplisit dengan tertutup tidak sengaja sebelum mengusulkan penyimpanan. |
| T22 | **Koreksi — pertahankan safety** | Reset layanan/quote saat tujuan berubah mencegah harga/kurir stale; memang harus terjadi (`DeliveryQuotePanel.tsx:274`, `checkout/page.tsx:309–318`). Feedback “Alamat berubah, pilih layanan kembali” lebih baik daripada dialog konfirmasi setiap ganti alamat. Bukti hanya menunjukkan reset layanan/money, **bukan seluruh data alamat pasti dibuang**: panel tetap mounted dan memiliki state alamat sendiri. |

### Catatan promo yang mengubah kesimpulan lama

Di C08/inventaris copy, laporan asal menganggap beberapa baris promo duplikatif. Jangan menggabungkan “Potongan” dan “Hemat total” tanpa memeriksa maknanya. Temuan fixture di §6.1 menunjukkan keduanya dapat berbeda akibat PPN; label “Paling hemat” juga menunjukkan ranking, bukan angka potongan tambahan.

Modal promo memang memuat 10 hasil per halaman, tetapi hanya sekitar tiga card terlihat sekaligus di mobile; footer aksi/paging tetap terlihat (P04 mobile page 1). **Jumlah 10 bukan bukti sendiri bahwa pagination harus diperkecil atau search perlu ditambah.** Pertahankan kontrol yang sudah bekerja, rapikan metadata hanya jika maknanya benar-benar redundant.

## 4. Feedback UI tambahan

### T23 — dropdown alamat melebar dan memotong identitas penerima — P1

- **Evidence:** [F05-mobile-dropdown-viewport](../../../playwright/mcp/checkout-ux-review/screenshots/F05-mobile-dropdown-viewport.png).
- **Observasi:** daftar terbuka melebar melewati tepi kanan 390 px; nama penerima berada di akhir baris panjang dan terpotong. Ini state dropdown yang tidak tercakup oleh reflow 320 pada review/detail.
- **Source:** `apps/store/src/components/checkout/DeliveryQuotePanel.tsx:411–417` menyusun alamat + penerima sebagai satu rangkaian; `packages/ui/src/components/ui/select.tsx:77–107` tidak membatasi max-width berdasarkan viewport pada kelas content existing.
- **Usulan:** opsi dua baris, penerima/label tujuan dahulu, alamat di bawah; lebar dibatasi ruang viewport dan wrapping yang mempertahankan identitas. Reuse shared Select, tetapi audit consumer jika shared component diubah.
- **Contoh:** Rina memilih di antara alamat rumah dan kantor yang sama-sama diawali “Jl. Kenanga”; nama/label dan alamat tetap bisa dibedakan tanpa membaca teks yang keluar layar.
- **Batas:** clipping screenshot terkonfirmasi; dimensi DOM popup dan interaksi pemilihan perlu browser verification sebelum perbaikan diterima.

### T24 — loading detail order terlihat seperti halaman kosong — P1

- **Evidence:** [O08-mobile-loading-viewport](../../../playwright/mcp/checkout-ux-review/screenshots/O08-mobile-loading-viewport.png), juga desktop.
- **Observasi:** hanya header, WA, dan background terlihat. Laporan asal menyebut “skeleton tersedia” dari markup, tetapi **skeleton tidak tampak** di gambar.
- **Source:** `orders/[id]/page.tsx:100–125` memakai `bg-muted`; `apps/store/src/app/globals.css:7,15,132` memberi `--muted` dan `--background` nilai sama serta body `bg-background`. Teks loading hanya `sr-only`.
- **Usulan:** indikator loading visual nyata, atau skeleton pada surface/kontras berbeda yang tetap mengikuti token existing. Pertahankan live region screen reader.
- **Contoh:** saat koneksi lambat, pembeli melihat “Memuat detail pesanan…” daripada mengira halaman rusak. Ini juga menjelaskan sebagian keluhan recovery T15.

### T25 — “masih diproses” berwarna error, sementara CTA menyebut bayar — P1

- **Evidence:** [P09b-mobile-attempt-processing-inline-viewport](../../../playwright/mcp/checkout-ux-review/screenshots/P09b-mobile-attempt-processing-inline-viewport.png).
- **Observasi:** status belum pasti memakai alert merah + toast error; tombol dominan tetap “Bayar Sekarang”, sementara aksi bantu “Periksa status checkout”. Label dominan bertentangan dengan proses yang sedang berlangsung.
- **Source:** `CheckoutAttemptFeedback.tsx:23–30` mengenali uncertain tetapi tetap memakai destructive styling untuk semua state. `checkout/page.tsx:1062` memanggil toast error; `handlePlaceOrder` pada `:1183–1187` justru melakukan recovery saat `pendingRequest` ada.
- **Usulan:** tone attention/info untuk processing/unknown, error untuk penolakan definitif. Pada pending request, aksi dominan menjelaskan pemeriksaan status, bukan membuat persepsi transaksi baru. Ini bukan bukti double charge: handler sudah mengarahkan ke request yang sama.
- **Contoh:** sesudah submit belum pasti, pembeli melihat “Checkout masih diproses” dan satu aksi “Periksa status checkout”, bukan sinyal “gagal” bersebelahan dengan “Bayar Sekarang”.

### T26 — syarat & ketentuan tidak dapat dibuka di titik persetujuan — P2

- **Evidence/source:** P01 mobile full; `checkout/page.tsx:2011–2017` merender syarat sebagai teks checkbox biasa, bukan link. Link kebijakan ada jauh di footer pada screenshot.
- **Usulan:** sediakan akses kebijakan yang jelas dekat persetujuan, tanpa membuat klik link ikut men-toggle checkbox dan tanpa menghilangkan draft checkout. Verifikasi destination kebijakan dahulu; audit ini belum memeriksa isi/legalitas atau keberhasilan link footer.
- **Contoh:** sebelum mencentang, pelanggan yang ingin membaca aturan pengambilan dapat membuka kebijakan lalu kembali dengan tanggal, kontak, dan review tetap ada. Ini rekomendasi usability, bukan klaim pelanggaran legal.

## 5. Prioritas yang lebih proporsional

| Urutan | Fokus | Alasan / batas |
|---|---|---|
| 1 — P0 | Kebenaran hasil pembayaran T13 | Query bukan bukti pembayaran; heading/ikon juga harus jujur. Netralisasi copy tidak setara verifikasi status. |
| 2 — P1 | Feedback status/recovery T10/T15/T25 + loading T24 | Pengguna perlu tahu pemeriksaan berjalan, hasilnya, dan aksi aman berikutnya. Jangan menjanjikan detail order sebelum order tersedia. |
| 3 — P1 | Readability dan aksi mobile T01/T04/T05/T11 + dropdown T23 | Paling langsung menjawab keluhan “menumpuk” tanpa mengganti aturan bisnis. Total + next action didahulukan; detail penting tetap dapat direview. |
| 4 — P1 | ETA T06, dampak promo gugur T08, error T03/T09, label/fokus T19, active-text contrast T20 | Informasi keputusan dan kemampuan memperbaiki input harus jelas. |
| 5 — P1 terarah | Layout resize T17 dan overlap T18 | Ada indikasi kuat; browser zoom/hit-test diperlukan sebelum verdict final. |
| 6 — P2 / keputusan | Penanda total turun T07, arsip kode T14, ukuran target, kebijakan dekat checkbox T26, persistensi T21 | Improvement berguna, tetapi tidak semuanya blocker atau P0. Jangan menambah dialog/penyimpanan otomatis tanpa keputusan produk. |

Pertahankan: rincian nominal, review tujuan/slot, pemisahan payment/fulfillment, dialog **kenaikan** total, reset quote saat tujuan berubah, input tetap tersedia saat error, dan idempotent request recovery. Jangan mengganti pola ini demi sekadar mengurangi tinggi halaman.

## 6. Koreksi kualitas evidence audit

### E01 — fixture promo tidak konsisten dengan kontrak domain

Source audit: `playwright/mcp/checkout-ux-review/fixtures.cjs:247–261`.
Source kontrak: `apps/store/src/features/discounts/promo-ranking.ts:15–30` dan test existing `promo-ranking.test.ts:25,37–41` (**dibaca, tidak dijalankan**).

- Baseline pickup **166.500**; promo 20.000 memberi total **144.300**. Hemat total seharusnya **22.200**, bukan `estimatedSavings: "20000"`.
- Promo 25.000: total **138.750**, hemat total **27.750**, bukan 25.000.
- Promo 18.000 dengan total **146.520** berada pada **halaman kedua**, sedangkan promo 5.000 dengan total **160.950** pada halaman pertama. Ini tidak memenuhi global ranking “total bayar terendah” yang diterapkan source.
- Promo “Potongan Rp12.000” berisi `estimatedTotal: "156420"`; pada baseline yang sama nilai literal seharusnya `(150000 - 12000) × 1,11 = 153180`.
- Ada promo shipping eligible dengan `estimatedTotal: null`, sedangkan kontrak ranking menghitung total untuk eligible candidates.

**Konsekuensi:** screenshot memperlihatkan UI asli, tetapi kombinasi data promo itu tidak mewakili response ranking yang konsisten. Ini masalah fixture, **bukan bukti backend salah menghitung**. Breakdown review 144.300/138.750 tetap benar; yang tidak boleh diteruskan adalah klaim seluruh nominal/ranking promo terverifikasi atau rekomendasi menghapus “Hemat total” karena tampak sama dengan potongan.

### E02 — label capture tidak menjamin state yang dinilai terlihat

`capture.cjs:244–254` menggulir ke atas untuk screenshot biasa. Karena itu:

- F03 mobile contact/slot tidak memperlihatkan error yang sedang dibahas; F03 desktop slot juga tidak memperlihatkan pesan server.
- F08 mobile loading/error/empty/recovered dan F09 mobile page1/page2/category hanya memperlihatkan bagian atas sampai alamat, bukan daftar/pesan quote.
- P03 mobile checked/unchecked tidak memperlihatkan checkbox; P08 mobile preview/submit loading tidak memperlihatkan CTA loading; O06 mobile viewport/checked tidak memperlihatkan panel recovery.

State mungkin benar-benar terjadi menurut source/probe. Namun screenshot tersebut **tidak cukup sebagai bukti visual state**. Tambahkan focused viewport/interaction capture dengan scroll dipertahankan, di samping first viewport yang tetap berguna untuk orientasi. Jumlah file tidak menggantikan keterlihatan state.

### E03 — substate yang dijanjikan belum dibuktikan

| Target spec | Yang ada | Gap |
|---|---|---|
| P06 ganti/**lepas** promo | Script mengganti promo naik/turun; tombol Lepas hanya terlihat | Tidak ada klik Lepas beserta batal/konfirmasi/dampak total yang dapat ditelusuri. |
| P10 stock/**harga/reprice** | Script hanya mensimulasikan `CHECKOUT_STOCK_ADJUSTED` | Tidak ada skenario perubahan harga/ongkir dan persetujuan total baru; keberadaan handler di source tidak membuktikan walkthrough ini. |
| O09 **snapshot delivery tidak tersedia** / alamat panjang | Fixture O09 adalah **pickup** dengan status/ID/nama barang panjang | Tidak menguji delivery tanpa snapshot atau alamat delivery panjang. Pickup tanpa snapshot bukan substitusi valid untuk fallback delivery. |
| AC03 first viewport + full-page layar utama | Full-page tersedia untuk subset (antara lain F01/F02/P01/P02/O01/O02/O09) | R01–R03 dan sejumlah detail O03–O07 hanya viewport. Jika sebagian dianggap transien/duplicate, perlu alasan eksplisit atau penyesuaian scope disetujui, bukan otomatis Verified. |

39 skenario dan 180 PNG benar sebagai hitungan runner. X02/X04/X05 adalah probe tanpa PNG; bukan masalah tersendiri selama dibedakan dari skenario visual. Namun “0 Pending” runner tidak membuktikan seluruh target spec terpenuhi.

### E04 — assertion dan waktu capture recovery belum cukup

Pada O06, script langsung membaca `isVisible()` setelah klik dan `settle()`; helper `settle` hanya menunggu font/teks compiling, **bukan selesainya GET order**. Report mencatat hasil desktop/mobile berbeda. Tunggu response + state akhir yang tepat sebelum menyimpulkan bahwa hasil pemeriksaan stabil, lalu capture state loading secara terpisah.

### E05 — probe accessibility perlu adjudikasi, bukan pass/fail mentah

- Target probe hanya mengukur rect `<24` dan tidak memeriksa jarak/pengecualian. Footer sosial 20 px dengan `gap-3` adalah contoh mengapa `tooSmall=true` bukan otomatis fail AA.
- Contrast probe mengambil direct text, tidak memisahkan seluruh disabled descendants, pseudo-element, ancestor opacity, dan non-text/focus states. Hasilnya berguna sebagai screening, bukan audit lengkap.
- Text 200% mengubah root font-size, bukan browser zoom. Reflow 320 tidak overflow pada dua surface yang diuji, tetapi dropdown, dialog, dan seluruh kombinasi state belum otomatis tercakup.

### E06 — dokumentasi asal memuat status yang saling bertentangan

Index bagian research masih menyebut AC08/AC09 Pending, sedangkan tabel status dan laporan menyebut Verified. Ini stale summary, bukan bukti user belum memberi feedback. Catatan feedback user pada §8 laporan asal tetap dipertahankan sebagai riwayat; sesi ini tidak mengarang ulang approval atau menganggap seluruh 180 gambar sudah direview user. Navigasi index diperbarui untuk menunjuk addendum ini.

## 7. Sumber accessibility yang dikonfirmasi

- [W3C SC 2.5.8 — Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): minimal 24×24 **atau** pengecualian; termasuk spacing lingkaran diameter 24 px dan equivalent control. Lebih besar tetap dapat direkomendasikan tanpa menyebut ukuran kecil otomatis gagal.
- [W3C SC 1.4.3 — Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): teks biasa 4,5; large text 3; placeholder termasuk teks; inactive components dikecualikan. Ambang non-text bukan alasan menurunkan contrast placeholder aktif.
- [W3C SC 1.4.4 — Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html): teks dapat diperbesar sampai 200% tanpa kehilangan konten/fungsi. Root-font emulation dan keberadaan horizontal scroll saja tidak cukup untuk menyimpulkan seluruh kepatuhan/gagal kriteria ini.

## 8. AC audit asal → evidence setelah cross-check

Ini penilaian ulang **kelengkapan audit asal**, bukan syarat bahwa UI harus sudah diperbaiki. Verified terbatas pada evidence yang disebut, bukan jaminan integrasi produksi.

| AC | Status | Evidence / yang masih dibutuhkan |
|---|---|---|
| AC01 safety | **Verified — evidence arsip** | Boundary script memock/fail-closed API bisnis dan memblokir luar origin; report tidak mencatat submit bisnis nyata. Sesi cross-check hanya membaca artefak dan membuka file galeri. Tidak mengklaim audit jaringan server menyeluruh. |
| AC02 seluruh state/substate | **Pending** | E03: Lepas promo, harga/reprice, delivery snapshot hilang/alamat panjang belum dibuktikan. |
| AC03 bentuk/kebenaran capture | **Pending** | Integrity file lulus; E02 state penting di luar viewport, E03 full-page layar utama belum lengkap. |
| AC04 galeri lokal | **Verified** | Checker galeri dijalankan ulang: 180/180 termuat; missing/external/pageerror = 0. |
| AC05 checklist dan copy | **Pending** | Semua ID checklist memang terisi, tetapi C07/C08 perlu koreksi fixture/savings dan C10/C12 perlu penajaman (§3, E01/E05). |
| AC06 keyboard/contrast/target/reflow | **Pending** | Probe terarah ada. Adjudikasi exception/disabled state, batas root-font, dan koreksi klaim loading diperlukan sebelum verdict lengkap. Bukan tuntutan sertifikasi WCAG baru. |
| AC07 konsistensi/status | **Pending** | Pemisahan status telah diperiksa; processing destructive T25 dan loading token T24 terlewat. Rekonsiliasi checklist C13/C14 dengan dua temuan ini. |
| AC08 review user | **Verified — catatan historis** | §8 laporan asal mencatat contoh gambar dan feedback user. Sesi ini tidak memverifikasi ulang percakapan asal atau memperluasnya menjadi approval semua gambar/rekomendasi baru. |
| AC09 rekomendasi final terlacak | **Pending** | Addendum menajamkan T01–T22 dan menambah T23–T26; rekomendasi lama/dua plan belum direkonsiliasi atau disetujui ulang bila perilakunya berubah. |
| AC10 batas/artefak/scope | **Verified** | Batas simulasi, tanpa implementasi, dan perubahan dokumen/disposable dinyatakan. File audit asal dipertahankan, addendum ditautkan; diff diperiksa. |

### Checklist penutupan spec yang belum dapat dipertahankan sebagai selesai

Berikut bunyi item dari spec asal yang masih membutuhkan rekonsiliasi evidence; bukan klaim seluruh pekerjaannya belum dilakukan:

- [ ] Semua AC01–AC10 Verified dengan evidence aktual.
- [ ] Semua target capture tercakup atau N/A sah; tidak ada Pending yang disembunyikan.
- [ ] Rekomendasi dan limitations dapat ditelusuri ke evidence.

## 9. Open items dan langkah berikutnya

**Fakta belum diketahui / evidence perlu dilengkapi:** focused capture state tersembunyi, substate E03, fixture promo yang sesuai kontrak, hasil stabil recovery, hit-test overlap, browser resize nyata, dan destination kebijakan. Ini pekerjaan verifikasi agent, bukan pertanyaan untuk user menebak fakta repo.

**Keputusan user yang memang diperlukan sebelum perubahan:** prioritas implementasi; perilaku draft saat Batal vs tertutup tidak sengaja dan refresh; apakah kode pickup completed tetap tersedia sebagai arsip; strategi penempatan bantuan WA. Tidak perlu meminta user memutuskan rumus pajak, ambang WCAG, atau apakah quote lama boleh dipakai untuk tujuan baru.

**Di luar scope:** implementasi plan 1/2, perubahan status bisnis, provider/DB, perombakan design system global, usability testing pelanggan, dan klaim peningkatan conversion.

**Rekomendasi tahap berikutnya:** rekonsiliasi daftar temuan dan evidence gap dahulu, terutama fixture promo dan focused capture; kemudian pilih scope perbaikan bersama user. Arah plan copy/density tetap layak, tetapi audit baru ini **tidak otomatis menambah scope atau mengganti plan yang sudah disetujui**. Tidak ada prinsip enduring baru untuk didistilasi ke `docs/`; addendum tetap menjadi research fitur ini.
