# Review UI/UX checkout dan pembayaran

Status: **capture, review user, dan rekomendasi final selesai.** Implementasi
perbaikan dipisahkan ke [plan copy/density](../plan/improve-checkout-copy-density.md)
(disetujui) dan [plan temuan fase 2](../plan/audit-findings-phase-2.md) (Draft).
Dokumen ini adalah hasil audit, bukan izin implementasi.

> **Addendum cross-check 2026-11-14:** [penilaian ulang](cross-check-audit-ux-checkout-pembayaran.md)
> mengoreksi sebagian T01–T22, menambah T23–T26, serta menemukan gap capture/substate
> dan fixture promo. Klaim seluruh AC Verified di dokumen asal ini belum dapat
> dipertahankan tanpa rekonsiliasi evidence. Riwayat feedback/approval user tetap disimpan.

- Spec: [spec-audit-ux-checkout-pembayaran.md](../plan/spec-audit-ux-checkout-pembayaran.md)
- Indeks gambar: [indeks-capture-ux-checkout.md](indeks-capture-ux-checkout.md)
- Galeri: [gallery.html](../../../playwright/mcp/checkout-ux-review/gallery.html)
- Manifest & probe: [manifest.json](../../../playwright/mcp/checkout-ux-review/manifest.json),
  [report.json](../../../playwright/mcp/checkout-ux-review/report.json)
- Benchmark & checklist sumber: [benchmark-ux-store-dan-protokol-review.md](benchmark-ux-store-dan-protokol-review.md)

> **Semua data bisnis di screenshot adalah simulasi.** Session auth memakai akun demo seeded;
> tidak ada order, pembayaran Midtrans, penulisan alamat/cart, atau perubahan data bisnis.

## 1. Ringkasan hasil

Yang **terbukti** dari UI asli (bukan opini):

1. Checkout dan review memuat banyak blok teks yang bersaing: ringkasan barang, metode,
   alamat/cabang, tanggal/waktu, dua disclaimer amber, kontak, promo, info Midtrans,
   rincian biaya, dan teks persetujuan panjang. Review pickup memiliki tinggi halaman
   2.093 px (desktop) dan 2.895 px (mobile); review delivery 2.042/2.739 px.
2. Di mobile (390 px), label step ("Cara Pengiriman", "Bayar & Pesan") **hilang** dan hanya
   tersisa dua ikon. Di 320 px, orientasi hanya dari heading halaman.
3. Tombol `Lanjut` pada step 1 **sudah aktif sebelum input apa pun**; validasi baru muncul
   setelah diklik, dan pesan validasi slot dari server berbahasa Inggris.
4. Promo bekerja secara fungsional (picker, pagination, eligibility, kode manual, dialog
   kenaikan total, state gugur), tetapi daftar 10 item + kode manual menambah beban pada
   layar yang sudah padat. Perubahan total turun tidak diberi penanda, dan saat promo gugur
   total berubah tanpa perbandingan sebelum/sesudah.
5. Detail order memisahkan status order, pembayaran, dan pemenuhan (baik), tetapi untuk
   order `pending_payment` panel "Lacak paket / Resi belum tersedia" tampil lebih dulu
   daripada alamat/barang; CTA "Bayar sekarang" berada jauh di bawah.
6. Halaman hasil pembayaran memakai copy yang tidak selalu sesuai kepastian status:
   pending disebut "sedang diproses", gagal menyatakan "pesanan telah dibatalkan" dari query,
   dan sukses menyebut kode pickup untuk semua metode fulfillment.
7. Accessibility terarah: fokus keyboard berfungsi pada kontrol utama (termasuk select dan
   checkbox), Escape menutup dialog, dan picker promo mengembalikan fokus ke trigger.
   Namun label select waktu pickup tidak terasosiasi, modal alamat mengembalikan fokus ke
   `body`, tombol tutup dialog 15,2×15,2 px, dan ikon sosial 20×20 px.
8. Contrast: teks utama checkout/review/promo/detail lolos ambang yang diukur, tetapi footer
   berada di 4,47:1, badge cart 10 px di 3,76:1, inisial avatar 4,26:1, dan placeholder
   select wilayah 3,58:1.
9. Reflow 320 px tidak menimbulkan horizontal scroll pada review checkout dan detail order.
   Namun pembesaran teks 200% pada mobile menyebabkan scroll horizontal (442 px vs 390 px
   pada review; 498 px vs 390 px pada detail), terutama baris "Gratis (Pickup)" dan tombol
   "Lacak di situs kurir"/"Lihat semua riwayat".
10. Kontinuitas: tombol Kembali mempertahankan tanggal/waktu/kontak; refresh menghapus
    tanggal/waktu dan mengembalikan kontak dari sesi; draft alamat baru dibuang saat modal
    ditutup tanpa "Gunakan alamat ini"; ganti alamat membuang layanan terpilih dan quote lama.

Temuan di atas adalah **observasi**, bukan keputusan redesign. Prioritas dan rekomendasi
menunggu review gambar (bagian 8–9).

## 2. Metode dan cakupan

- UI asli di Chromium headless, data bisnis dimock per skenario. Lihat indeks untuk fixture,
  viewport, dan boundary request.
- Setiap layar utama: viewport pertama dari scroll paling atas + full-page; modal/transien:
  viewport. Probe keyboard, target, contrast, reflow 320, teks 200%, dan kontinuitas dijalankan
  pada halaman yang sama setelah capture.
- Perbandingan desktop/mobile memakai fixture yang sama dan tanggal/jam yang sama.
- Penilaian memakai checklist C01–C15 dari riset, prinsip S1–S7 (Baymard, NN/g, W3C), dan
  shared component/token existing. Tidak ada skor persentase atau klaim conversion.

## 3. Akses, data, dan bukti keselamatan (AC01)

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| Login via form UI akun demo | HTTP 200; redirect `/checkout`; session store nyata | `report.json` → `auth` |
| Akun sudah onboarding & email verified | `onboardingCompleted=true`, `emailVerified=true` | idem |
| Cookie store ada | `client.*` hadir; nilai tidak dicetak | idem |
| Mutasi bisnis/provider | Tidak ada. API bisnis dimock/fail-closed; submit tidak nyata | `report.json` → `network` |
| Request keluar origin | Diblokir (termasuk link tracking) | `blocked-external`, O10 |
| Credential/PII di artefak | Tidak ada; email demo/seed hanya terlihat sebagai isi halaman | manifest, galeri |
| Perubahan aplikasi/DB | Tidak ada; hanya file disposable di `playwright/` dan dokumen research | `git status` |

Catatan: bootstrap login mengirim satu `POST /api/auth/sign-in/email` nyata ke origin lokal.
Itu satu-satunya mutasi yang disengaja (session auth), sesuai izin user. Session tidak
disimpan ke disk dan context ditutup setelah batch.

## 4. Walkthrough per perjalanan

Ringkasan observasi yang bisa ditelusuri ke ID gambar di indeks/galeri.

### 4.1 Checkout step 1 — fulfillment

- **F01**: urutan awal: link kembali, `Checkout`, indikator 2 step, lalu card. CTA `Lanjut`
  sudah aktif; tanggal/waktu kosong. Di mobile label step tidak tampil.
- **F02**: pickup siap menampilkan cabang, tanggal/jam, ringkasan "Pengambilan", disclaimer
  amber panjang, kontak, lalu CTA. Disclaimer yang sama diulang di step 2 (P01).
- **F03**: "Cabang tutup pada tanggal ini" jelas dan dekat field. Error kontak muncul di bawah
  grid kontak. Penolakan slot server memakai bahasa Inggris dan ditempel di dekat CTA.
- **F04/F05**: delivery memakai select alamat + tombol alamat baru. Alamat tidak siap wilayah
  tampil disabled dengan alasan. Setelah alamat terpilih, ringkasan penerima/telepon/alamat
  tampil, tetapi **ongkir terpilih tidak muncul di ringkasan step 1**—hanya di baris layanan.
- **F06**: modal alamat baru punya hierarki baik dan footer melekat. Kode pos terisi otomatis.
  Saat wilayah gagal, setiap select menampilkan "Coba lagi wilayah"; draft tetap ada selama
  modal terbuka, tetapi hilang jika modal ditutup (X05).
- **F07/F08**: empty/error alamat dan quote punya pesan + retry. Quote gagal tidak
  mempertahankan harga lama; CTA tetap tertutup.
- **F09**: 8 layanan/2 halaman/6 kategori; badge "Termurah" dan filter bekerja. Pilihan
  lintas halaman bertahan. ETA muncul di baris layanan (format tanggal), bukan durasi.
- **F10**: ganti alamat menghapus pilihan layanan (terukur `beforeSelected=true`,
  `afterSelected=false`) dan mengulang quote; switch ke pickup membuang state delivery.
  Tidak ada konfirmasi bahwa pilihan lama dibuang.

### 4.2 Review pembayaran

- **P01**: review pickup 166.500: ringkasan barang, detail pengambilan, kontak, promo,
  "Pembayaran via Midtrans", dua reminder amber, rincian, checkbox, CTA. Delapan blok
  bertumpuk sebelum CTA.
- **P02**: review delivery 150.000 + ongkir 12.000 + PPN 17.820 = **179.820** (sesuai hitungan
  independen). Penerima/alamat/kode pos terverifikasi. **ETA layanan tidak tampil** di review,
  hanya nama layanan.
- **P03**: CTA disabled sampai checkbox; setelah dicentang aktif. Teks persetujuan pickup
  sangat panjang (satu paragraf).
- **P07** (promo gugur): alert + alasan + "Lanjut tanpa promo"; total kembali 166.500 tanpa
  penanda bahwa nilainya berubah dari 144.300; CTA tertutup.

### 4.3 Promo

- **P04**: picker memuat kode manual, daftar 10 item halaman 1 (2 halaman, 12 total),
  badge "Paling hemat", item ineligible dengan alasan, pagination. Tidak ada search/sort.
- **P05**: state terpasang (Dipakai, Potongan Rp 20.000, Lepas/Ubah), kode invalid, daftar
  kosong, daftar gagal + "Coba lagi". Rincian terpasang: Subtotal 150.000, Diskon -20.000,
  PPN 14.300, Ongkir Gratis (Pickup), Total 144.300.
- **P06**: dialog kenaikan total (144.300 → 160.950, selisih +16.650); Batal mempertahankan
  total lama dan kandidat; "Ya, ganti promo" menerapkan total baru dan mereset checkbox.
  Penggantian ke promo lebih besar (138.750) langsung diterapkan tanpa dialog/penanda.
- **P07**: promo gugur karena kuota; alasan aman ditampilkan; tidak ada nilai diskon palsu.

### 4.4 Preview, submit, recovery, stock

- **P08**: preview loading hanya mengubah CTA menjadi "Memeriksa…" + spinner. Pajak tidak
  tersedia menampilkan alert di step 1, fokus pindah ke alert, CTA "Periksa ulang pesanan".
  Submit loading "Memproses..." + Kembali disabled. Submit ditolak menampilkan toast di atas
  dan feedback inline di dekat CTA; review lama dibuang sehingga muncul banner review ulang.
- **P09**: recovery saat mount menampilkan kartu "Periksa status pesanan" dengan satu CTA;
  setelah "Periksa pesanan" (status processing) layar tidak berubah dan tidak ada jalan ke
  detail order. Ini bukan klaim kegagalan transaksi nyata.
- **P09b**: attempt processing setelah submit menampilkan toast + feedback inline
  "Checkout masih diproses…" dan "Periksa status checkout"; review tetap ada.
- **P10**: stock adjustment mengubah qty 2→1, total fallback 111.000, menampilkan banner stok
  + banner "Rincian pesanan perlu diperiksa ulang"; checkbox direset. Dua banner amber
  bertumpuk di area atas.

### 4.5 Hasil pembayaran

- **R01**: pending → "Menunggu Pembayaran", CTA detail; tidak ada tombol bayar ulang atau
  waktu kedaluwarsa.
- **R02**: sukses → "Pembayaran Berhasil!", copy menyebut "kode pickup akan dikirim" untuk
  semua metode; ID hanya 8 karakter.
- **R03**: gagal → "Pembayaran Gagal", copy menyatakan pesanan telah dibatalkan berdasarkan
  query, bukan status order terverifikasi; CTA "Belanja Lagi"/"Lihat Pesanan Saya".

### 4.6 Detail pesanan

- **O01/O02**: status badge + kartu status + ID + salin; untuk pending delivery, panel
  "Lacak paket / Resi belum tersedia" tampil sebelum alamat dan barang. CTA bayar berada di
  kartu pembayaran setelah barang. **Tidak ada instruksi/metode pembayaran atau kedaluwarsa**
  di kartu pembayaran; copy hanya "Selesaikan pembayaran sebelum link kedaluwarsa".
- **O03**: paid+processing dan paid+blocked terpisah; banner blocked jelas
  ("Tidak perlu membayar ulang").
- **O04**: timeline 4 event + "Lihat semua riwayat" (6 event), status tracking, resi, link
  kurir, POD; tidak ada ETA di panel.
- **O05**: belum siap tanpa kode; ready menampilkan kode besar + salin (sukses);
  completed masih menampilkan kode pickup dengan instruksi yang sama.
- **O06**: recovery menampilkan pesan + "Periksa status pembayaran"; setelah diklik tidak ada
  perubahan/feedback (fixture sama).
- **O07**: failed menampilkan alasan provider + "buat pesanan baru"; cancelled menampilkan
  badge + status pembayaran gagal tanpa penjelasan siapa/apa kewajiban lanjutan.
- **O08**: loading skeleton, error + retry, 404 dengan CTA kembali; retry berhasil.
- **O09**: 8 barang/ID panjang/status asing; status asing netral tanpa kode internal;
  tinggi halaman 1.778 px desktop dan 3.486 px mobile.
- **O10**: clipboard ditolak → "Gagal menyalin. Silakan salin secara manual."; clipboard
  diizinkan → "Resi disalin"; link tracking eksternal dikenali dan diblokir boundary.

## 5. Checklist C01–C15

Status: **Terpenuhi / Masalah / Belum diverifikasi / N/A**, dengan evidence. Penilaian pada
surface yang relevan, bukan seluruh situs.

| ID | Status | Evidence | Catatan |
|---|---|---|---|
| C01 Orientasi | **Masalah** | F01/F02/P01/P02 mobile, X01-320; header h1/h2 | Label step disembunyikan di <640 px (`hidden sm:inline`), sehingga orientasi mobile hanya dari heading; step 2 menandai step 1 dengan centang, bukan "posisi sekarang". |
| C02 Primary/secondary action | **Masalah** | F01 (CTA aktif tanpa input), P01/P03, P08, O01–O02 | Satu primary action per layar, tetapi `Lanjut` aktif sebelum input dan alasan disabled tidak dijelaskan; CTA review berada setelah ±8 blok; CTA bayar detail order jauh di bawah barang. |
| C03 Hierarki/grouping | **Masalah** | P01/P02 full, O01/O02 full, header/footer | Banyak card/border dengan emphasis serupa; dua blok amber + info Midtrans + promo bersaing; kontak/fulfillment diulang antara step 1 dan review. |
| C04 Copy & beban baca | **Masalah** | Inventaris copy (bagian 6), F02/P01 | Disclaimer pickup muncul di step 1 dan step 2, ditambah teks persetujuan; beberapa pesan sistem berbahasa Inggris; istilah status mirip ("Menunggu" vs "Menunggu pembayaran"). |
| C05 Disclosure | **Masalah** | F02, P01/P02, O02 | Bantuan sekunder tidak dapat dilipat; semua helper/disclaimer tampil inline dan mengalahkan angka/action. Biaya tidak disembunyikan (baik). |
| C06 Akurasi review fulfillment | **Masalah** | P01, P02; fixture vs UI | Varian, qty, harga, penerima, telepon, alamat, kode pos, cabang, slot, kurir, dan origin cabang terverifikasi. **ETA kurir tidak diulang** di review, jadi tidak dapat diverifikasi sebelum bayar. |
| C07 Nominal | **Terpenuhi** | P01, P02, P05, P06, P10; literal independen | 166.500 pickup; 179.820 delivery (12.000 ongkir, PPN 17.820); 144.300 promo 20.000; 160.950 kenaikan; 138.750 penurunan; 111.000 stock. Tidak ada dobel hitung; label rupiah konsisten. |
| C08 Promo | **Masalah** | P04, P05, P06, P07 | Fungsional dan tidak mendominasi, tetapi daftar 10 item + kode manual; "Paling hemat" dan "Hemat total" duplikatif; kenaikan diberi dialog, penurunan tidak; saat gugur, total berubah tanpa perbandingan. |
| C09 Keselamatan action | **Terpenuhi** | P03, P08, sumber `checkout/page.tsx` | Submit hanya setelah checkbox; `requestInFlight` + disabled mencegah submit ganda; copy menyebut Midtrans dan metode setelah klik; recovery request key. Submit nyata/provider **tidak diuji**. |
| C10 Feedback/recovery | **Masalah** | F03/F07/F08, P08/P09/P10, O06/O08 | Retry/empty/loading tersedia dan input umumnya terjaga. Namun pesan slot berbahasa Inggris, error kontak tidak terhubung ke field, error submit berupa toast + inline (toast menutupi header mobile), dan "Periksa status pembayaran" tidak memberi feedback. |
| C11 Responsive | **Masalah** | 390/320/200%, O02, P10, X01/X03 | Reflow 320 tanpa overflow; tetapi teks 200% menyebabkan scroll horizontal (442/498 px), label step hilang, dan tombol WhatsApp mengambang menutupi konten/CTA. |
| C12 Accessibility | **Masalah** | probe keyboard, dialog, target; source | Label kontak/alamat nyata, radio dalam label, Escape menutup dialog, picker promo mengembalikan fokus, select/checkbox keyboard berfungsi. Namun select waktu pickup tidak punya label terasosiasi; fokus modal alamat kembali ke `body`; target tutup 15,2 px dan ikon sosial 20 px; input search hanya placeholder. |
| C13 Contrast/konsistensi | **Masalah** | probe contrast; P01/P02 vs O01/O02 | Teks konten checkout/review/promo/detail lolos; footer 4,47:1, badge cart 3,76:1, avatar 4,26:1, placeholder wilayah 3,58:1. Status memakai teks + tone, bukan warna saja. Perbedaan kecil: diskon `text-green-600` (checkout) vs `text-green-700` (detail); "Ongkir Gratis (Pickup)" vs "Rp 0". |
| C14 Status & next action | **Masalah** | R01/R02/R03, O01/O05/O06/O07/O09 | Pemisahan order/payment/fulfillment baik (O03). Namun copy hasil pending/gagal/sukses tidak selalu sesuai kepastian status; order pending menampilkan tracking kosong sebelum pembayaran; completed masih menampilkan kode pickup; status asing tanpa next action; recovery tanpa feedback. |
| C15 Kontinuitas | **Masalah** | X05, F10, P06, P07 | Kembali mempertahankan input; refresh menghapus tanggal/waktu dan mengembalikan kontak sesi; draft alamat dibuang saat modal ditutup; ganti alamat menggugurkan layanan (perlu pilih ulang); metode berganti membuang state delivery; Batal pada dialog kenaikan mempertahankan total lama. |

## 6. Inventaris copy (verbatim) dan penilaian C04

Kategori: **wajib** (diperlukan untuk menyelesaikan tugas), **cegah-salah**, **bantuan**,
**duplikasi**, **istilah/internal**. Rekomendasi di sini adalah **kandidat** yang belum
disetujui; keputusan menunggu review user.

### 6.1 Checkout step 1

| Blok / copy (verbatim) | Tujuan | Kategori | Penilaian awal |
|---|---|---|---|
| “Kembali ke Keranjang” | Navigasi keluar | wajib | Keep; posisi jelas. |
| “Checkout” / “Cara Pengiriman” | Orientasi halaman/step | wajib | Keep; label step perlu tetap terlihat di mobile (C01). |
| “Pilih perkiraan tanggal dan waktu kedatangan Anda untuk mengambil pesanan.” | Instruksi pickup | bantuan | Shorten; mengulang isi field. |
| “Barang yang akan di-checkout” + “2 barang · Ubah” | Ringkasan kepemilikan item | wajib | Keep; link Ubah kecil (target). |
| “Ambil pesanan di cabang — Gratis (Pickup)” | Konsekuensi metode | wajib | Keep; “Gratis (Pickup)” juga muncul di rincian (konsisten). |
| “Cek layanan dan ongkir ke alamat Anda dahulu” | Konsekuensi metode delivery | wajib | Keep. |
| “Cabang Terpilih” | Status cabang | wajib | Keep. |
| “Alamat belum dapat dimuat. Coba lagi” | Error + retry | cegah-salah | Keep; pertimbangkan penempatan fokus. |
| “Memeriksa ongkir ke layanan pengiriman...” | Loading quote | wajib | Keep; satu-satunya indikator. |
| “Anda tetap dapat beralih ke pengambilan di cabang.” | Jalan keluar error | bantuan | Keep; berguna. |
| “Pilih pengiriman” / “Diurutkan dari ongkir termurah” | Orientasi daftar | wajib | Keep. |
| “Termurah” / “x–y dari n layanan” | Status daftar | wajib | Keep. |
| “Tanggal Pickup *” / “Waktu Pickup *” | Label field | wajib | Keep; select waktu perlu label terasosiasi (C12). |
| “Cabang tutup pada tanggal ini. Pilih tanggal lain.” | Validasi | cegah-salah | Keep; jelas dan dekat field. |
| “Jam operasional: 09:00 - 21:00” | Bantuan slot | bantuan | Keep pendek. |
| “Pengambilan: …” | Konfirmasi pilihan | wajib | Keep. |
| “Tanggal dan waktu pickup hanya estimasi — bukan janji temu yang mengikat. Tujuannya agar tim toko mengetahui perkiraan kedatangan Anda dan dapat menyiapkan pesanan lebih awal. Pastikan email dan nomor telepon Anda aktif agar toko dapat menghubungi Anda bila diperlukan.” | Ekspektasi pickup | cegah-salah | Shorten; 3 kalimat + diulang di step 2. Pertahankan inti “estimasi, bukan janji temu”. |
| “Kontak Pemesan” + helper pickup/delivery | Konteks field | bantuan | Shorten; helper email/telepon mengulang placeholder. |
| “Nomor aktif yang bisa dihubungi toko.” | Bantuan | bantuan | Keep pendek. |
| “Kode pickup dikirim ke email ini setelah pesanan siap diambil.” | Ekspektasi | bantuan | Keep; relevan. |
| “Isi dari Profil” | Aksi bantu | wajib | Keep. |
| “Masukkan nomor telepon yang valid (8–15 angka).” / “Masukkan alamat email yang valid.” | Validasi | cegah-salah | Keep; hubungkan ke field. |
| “Pickup time must be between 09:00 and 21:00 (30-min intervals).” / “Failed to validate pickup slot. Please try again.” | Error server | cegah-salah | Ganti ke bahasa Indonesia; samakan dengan pesan klien. |
| “Lanjut” / “Memeriksa…” | Primary CTA | wajib | Keep; disabled sampai validasi (C02). |
| “Checkout belum dapat diproses karena konfigurasi pajak belum sesuai. Silakan coba lagi nanti.” | Error pajak | cegah-salah | Keep; jangan tampilkan detail internal. |
| “Stok berubah. Jumlah pesanan telah disesuaikan. Periksa kembali pesanan sebelum melanjutkan.” | Feedback stock | cegah-salah | Keep; bisa ditambah baris yang berubah. |

### 6.2 Review pembayaran

| Blok / copy (verbatim) | Tujuan | Kategori | Penilaian awal |
|---|---|---|---|
| “Pembayaran” + “Periksa pesanan Anda, lalu konfirmasi untuk melanjutkan ke pembayaran via Midtrans.” | Orientasi step | wajib | Keep; “via Midtrans” penting (C09). |
| “Ringkasan Pesanan” + “Promo dipakai: X · potongan Rp …” | Konfirmasi isi | wajib | Keep; promo dipakai juga muncul di blok Promo (duplikasi). |
| “Detail Pengiriman” / “Penerima Pengiriman” / “Kode pos …” | Verifikasi alamat | wajib | Keep. |
| “Dikirim dari” + “Layanan kurir” | Verifikasi fulfillment | wajib | Keep; tambah ETA (C06). |
| “Estimasi Pickup” + tanggal/jam | Verifikasi slot | wajib | Keep. |
| “Kontak Pemesan” + Telepon/Email | Verifikasi kontak | wajib | Keep; duplikasi dengan step 1 (wajar untuk review). |
| “Promo” / “Pilih promo atau masukkan kode” | Discovery promo | wajib | Keep; tidak mendominasi. |
| “Dipakai” / “Potongan Rp …” / “Lepas promo” / “Ubah promo” | Status + aksi | wajib | Keep; dua aksi + picker bisa disederhanakan. |
| “Promo sebelumnya tidak lagi berlaku” + alasan + “Lanjut tanpa promo” | Promo gugur | cegah-salah | Keep; tambahkan dampak total. |
| “Pembayaran via Midtrans” + “Pilih QRIS, GoPay, VA, atau kartu setelah klik Bayar Sekarang.” | Ekspektasi redirect | wajib | Keep; sangat relevan. |
| “Sebutkan nomor telepon dan email … saat Anda datang mengambil pesanan.” | Instruksi pickup | bantuan | Move/shorten; duplikasi dengan disclaimer step 1. |
| “Tanggal dan waktu pickup bersifat estimasi — hanya untuk memberi tahu toko kapan Anda berencana datang.” | Ekspektasi | cegah-salah | Keep (ringkas), tetapi jangan mengulang seluruh disclaimer. |
| “Subtotal (2 barang)” / “Diskon promo” / “PPN (11%)” / “Ongkos Kirim” / “Total Bayar” | Rincian biaya | wajib | Keep; hierarki total jelas. |
| Checkbox pickup: “Saya telah memeriksa pesanan dan menyetujui syarat & ketentuan. Saya akan mengambil pesanan di cabang terpilih sesuai estimasi waktu yang saya tentukan, dan saya bersedia menyebutkan email serta nomor telepon saya saat pengambilan pesanan di toko.” | Persetujuan | cegah-salah | Shorten; 2 kalimat + referensi ke detail di atas. |
| Checkbox delivery: “Saya telah memeriksa alamat penerima, layanan pengiriman dan total pesanan, serta menyetujui syarat & ketentuan.” | Persetujuan | cegah-salah | Keep. |
| “Kembali” / “Bayar Sekarang” / “Memproses...” | Navigasi + CTA | wajib | Keep; posisi dan disabled state sudah benar. |
| “Pembayaran belum dapat disiapkan. Pesanan belum dibuat. Periksa ulang pesanan lalu coba lagi.” | Error submit | cegah-salah | Keep; jangan duplikasi sebagai toast + inline. |
| “Rincian pesanan perlu diperiksa ulang …” | Perubahan konteks | cegah-salah | Keep; satukan dengan pesan perubahan total/promo. |

### 6.3 Halaman hasil

| Copy | Tujuan | Kategori | Penilaian awal |
|---|---|---|---|
| “Menunggu Pembayaran” + “Pembayaran Anda sedang diproses. Selesaikan pembayaran … di halaman Midtrans …” | Status pending | wajib | Ganti “sedang diproses” menjadi “belum dibayar/menunggu pembayaran”; tambahkan kedaluwarsa bila tersedia. |
| “Pembayaran Berhasil!” + “Pesanan Anda sedang disiapkan dan kode pickup akan dikirim …” | Status sukses | wajib | Sesuaikan copy pickup/delivery; sediakan ID lengkap atau tautan salin. |
| “Pembayaran Gagal” + “Pesanan Anda telah dibatalkan. Silakan coba lagi.” | Status gagal | cegah-salah | Jangan menyatakan pembatalan tanpa verifikasi order; bedakan batal vs gagal. |
| “Lihat Detail Pesanan” / “Belanja Lagi” / “Lihat Pesanan Saya” | Next action | wajib | Keep. |

### 6.4 Detail pesanan

| Copy | Tujuan | Kategori | Penilaian awal |
|---|---|---|---|
| “Detail Pesanan” + “Dibuat …” | Orientasi | wajib | Keep. |
| “ID Pesanan” + “Salin ID” + feedback | Identitas | wajib | Keep; feedback sukses/gagal jujur. |
| Status order/payment/tracking | Status | wajib | Keep pemisahan; perjelas next action per status. |
| “Pembayaran diterima, pesanan menunggu verifikasi” + “Tidak perlu membayar ulang.” | Blocked | cegah-salah | Keep; sangat baik. |
| “Kode Pickup Anda” + “Tunjukkan kode ini kepada staf cabang saat pengambilan.” | Pickup ready | wajib | Keep; sembunyikan/arsipkan saat completed. |
| “Lacak paket” / “Resi belum tersedia” / “Informasi pelacakan akan tampil setelah resi tersedia.” | Tracking | bantuan | Sembunyikan untuk pending payment; tampilkan setelah diproses. |
| “Nomor resi” / “Salin resi” / “Lacak di situs kurir (terbuka di tab baru)” | Tracking action | wajib | Keep; feedback salin jelas. |
| “Riwayat pengiriman” / “Lihat semua riwayat” | Timeline | bantuan | Keep. |
| “Alamat pengiriman” + provinsi/kota/kecamatan/kelurahan/kode pos + “Dikirim dari” | Verifikasi | wajib | Keep. |
| “Barang pesanan (n)” + “Beli lagi” | Isi order | wajib | Keep; tombol berulang per item dapat dipertimbangkan. |
| “Pengambilan” + cabang/alamat/tanggal/jam | Pickup info | wajib | Keep. |
| “Pembayaran” + Metode/Status/Subtotal/Diskon/PPN/Ongkos Kirim/Total + “Bayar sekarang” | Ringkasan uang | wajib | Keep; tambahkan metode/kedaluwarsa yang nyata bila tersedia. |
| “Selesaikan pembayaran Anda sebelum link kedaluwarsa.” | Instruksi | cegah-salah | Tambahkan waktu kedaluwarsa atau hapus jika tidak diketahui. |
| “Periksa status pembayaran” | Recovery | wajib | Beri feedback loading/hasil. |
| “Pesanan tidak ditemukan” / “Coba lagi” / “Kembali ke riwayat pesanan” | Empty/error | wajib | Keep. |

## 7. Temuan faktual (belum diprioritaskan final)

Kolom “C/S” menunjuk checklist/benchmark; “Dampak” adalah dampak tugas yang bisa diamati,
bukan klaim conversion. Prioritas sengaja dikosongkan sampai review user.

| # | ID gambar | Observasi | Dampak tugas | C/S |
|---|---|---|---|---|
| T01 | F01, F02-mobile, X01-320 | Label step hilang di viewport <640 px; hanya ikon yang tersisa. | Pelanggan mobile sulit tahu sedang di step mana dan apa langkah berikutnya. | C01, S2 |
| T02 | F01 | `Lanjut` aktif tanpa tanggal/waktu/kontak; validasi hanya setelah klik. | Klik pertama berujung error; tidak ada panduan field wajib sebelum submit. | C02, C10, S2 |
| T03 | F03-slot | Pesan penolakan slot server berbahasa Inggris; tidak menempel pada field. | Pelanggan harus menerjemahkan dan menebak field yang salah. | C10, C04, S4 |
| T04 | F02, P01/P02 | Disclaimer pickup muncul di step 1 dan step 2; teks persetujuan panjang. | Beban baca berulang, terutama di mobile; informasi penting lain tenggelam. | C04/C05, S3 |
| T05 | P01/P02 | Delapan blok review dengan border/emphasis serupa; promo + info Midtrans + dua amber bersaing. | Sulit memindai total dan aksi utama; CTA jauh dari ringkasan. | C03/C07, S2 |
| T06 | P02 | ETA kurir tidak diulang di review; hanya nama layanan. | Pelanggan tidak dapat memverifikasi estimasi tiba sebelum membayar. | C06, S2 |
| T07 | P06-decrease | Penurunan total diterapkan tanpa dialog atau penanda perubahan. | Pelanggan mungkin tidak sadar total berubah (ke arah menguntungkan). | C08/C15, S2 |
| T08 | P07-alert | Saat promo gugur, total kembali 166.500 tanpa perbandingan sebelum/sesudah. | Pelanggan harus menghitung sendiri dampak kehilangan promo. | C08/C14, S2 |
| T09 | P08-submit | Error submit muncul sebagai toast di atas + feedback inline jauh di bawah; toast menutupi header mobile. | Pesan ganda, salah satu menutupi navigasi; pengguna mungkin melewatkan aksi pemulihan. | C10, S2/S4 |
| T10 | P09 | Setelah "Periksa pesanan" dengan status processing, layar tidak berubah dan tidak ada jalan ke detail. | Pengguna tidak tahu apakah pemeriksaan berhasil; risiko mencoba checkout baru. | C10/C14, S2 |
| T11 | O01 | Untuk pending payment, panel "Lacak paket / Resi belum tersedia" tampil sebelum alamat/barang. | Informasi belum relevan mendominasi layar; CTA bayar terdorong jauh ke bawah. | C03/C14, S2 |
| T12 | O02/O03 | CTA/metode pembayaran dan kedaluwarsa tidak jelas di kartu pembayaran; copy hanya "sebelum link kedaluwarsa". | Pelanggan tidak tahu batas waktu atau metode; risiko keterlambatan bayar. | C09/C14, S2 |
| T13 | R01/R02/R03 | Copy hasil tidak konsisten dengan kepastian status: pending "sedang diproses", gagal "telah dibatalkan", sukses menyebut kode pickup. | Pelanggan dapat salah memahami status dan langkah berikutnya. | C14, S2/S7 |
| T14 | O05-completed | Kode pickup dan instruksi pengambilan tetap tampil pada status completed. | Informasi aksi yang sudah selesai bersaing dengan status akhir. | C14, S2 |
| T15 | O06 | "Periksa status pembayaran" tidak memberikan feedback saat hasilnya sama. | Pengguna mengulang klik tanpa tahu status. | C10, S2 |
| T16 | O07 | Status cancelled tidak menjelaskan siapa/apa kewajiban lanjutan; failed mengarahkan "buat pesanan baru" tanpa tautan. | Jalan pemulihan tidak dapat langsung dijalankan. | C10/C14, S2 |
| T17 | X01/X03 | Teks 200% pada mobile menyebabkan scroll horizontal (checkout 442/390; detail 498/390). | Pengguna low-vision harus scroll horizontal; konten terpotong. | C11, S4 |
| T18 | O02/P10/X01 | Tombol WhatsApp mengambang menutupi tombol/konten (mis. "Beli lagi", CTA). | Target tidak dapat diklik pada area yang tertutup. | C11/C12, S4 |
| T19 | probe dialog/target | Select waktu pickup tanpa label terasosiasi; fokus modal alamat kembali ke `body`; target tutup 15,2 px dan ikon sosial 20 px. | Pengguna screen reader/keyboard/touch mengalami kesulitan. | C12, S4 |
| T20 | probe contrast | Footer 4,47:1; badge cart 3,76:1 (10 px); avatar 4,26:1; placeholder wilayah 3,58:1. | Teks kecil sulit dibaca; di bawah 4,5:1. | C13, S4 |
| T21 | X05 | Refresh menghapus tanggal/waktu pickup dan mengembalikan kontak sesi; draft alamat dibuang saat modal ditutup. | Input ulang dan kehilangan pekerjaan; terutama pada koneksi tidak stabil. | C15, S2 |
| T22 | F10 | Ganti alamat membuang layanan terpilih dan quote; switch metode membuang state delivery tanpa konfirmasi. | Pengguna harus memilih ulang dan mungkin tidak sadar pilihan hilang. | C15, S2 |

## 8. Review gambar bersama user (gate AC08)

Status: **selesai — masukan user tercatat 2026-11-14**. User meninjau contoh gambar
spesifik dan memberikan arahan umum; ini bukan review menyeluruh atas 180 gambar.

### Masukan user (ringkas)

1. Terganggu dengan warning kuning “Tanggal dan Waktu pickup hanya estimasi”.
2. `F02-mobile-full`: bagian cabang kurang oke tampilannya.
3. `F05-mobile-dropdown-viewport`: terganggu pesan penjelasan panjang di kontak pemesan,
   khususnya “Email akun dipakai untuk konfirmasi dan pembayaran”; minta pesan panjang
   disembunyikan di balik ikon yang bisa di-hover/click.
4. Arahan umum: tampilan lebih simple dan UX lebih baik; tulisan sedikit tetapi deskriptif;
   penjelasan panjang boleh di-hide dengan ikon hover/click; text field harus jelas,
   desain konsisten, dan required field harus jelas.
5. Keputusan lanjutan: fokus ke plan copy/density (plan 1); temuan audit lainnya dibuatkan
   plan fase 2 terpisah.

### Cakupan review

- Gambar yang eksplisit disebut/ditinjau: `F02-mobile-full`, `F05-mobile-dropdown-viewport`,
  warning pickup (F02/P01), dan arahan umum untuk “sisanya”.
- Tidak semua 180 gambar dibahas satu per satu; temuan lain tetap memakai evidence audit
  dan direkomendasikan tanpa klaim bahwa user sudah melihat setiap gambar.

### Hal yang perlu dipertahankan

- Total, rincian biaya, dan konsekuensi pembayaran tetap terlihat.
- Dialog kenaikan total promo, feedback salin jujur, dan pemisahan status order/payment/
  fulfillment tidak diusulkan untuk dihapus.

## 9. Rekomendasi dan prioritas (final)

Rekomendasi final dibagi menjadi dua plan agar perubahan copy/density tidak bercampur
dengan perubahan perilaku/status/shared component. Prioritas mengikuti definisi spec:
**P0** berisiko menyesatkan tindakan/uang/status atau memblokir tugas; **P1**
friksi/kepadatan/hierarki/pemulihan; **P2** polish/konsistensi minor. Bukan skor resmi.

| Prioritas | Rekomendasi | Evidence | Sumber keputusan | Artefak |
|---|---|---|---|---|
| P1 | Warning pickup jadi satu kalimat netral + InfoHint; kartu cabang mobile dirapikan; hint kontak panjang dipindah ke InfoHint; required field + error per field; review dipangkas; copy hasil dinetralkan | F02, F05, P01/P02, R01–R03; C01–C05, C10, C12, C14 | Masukan user + temuan audit T01–T05, T13 | [plan 1](../plan/improve-checkout-copy-density.md) — disetujui 2026-11-14 |
| P0 | Verifikasi status order di halaman hasil; feedback recovery pembayaran; next action untuk failed/cancelled | R01–R03, O06, O07; C14/C10 | Temuan audit T13, T15, T16 | [plan fase 2](../plan/audit-findings-phase-2.md) — Draft |
| P1 | Detail order: tracking prematur, posisi CTA bayar, kode pickup completed; promo naik/turun/gugur; toast submit duplikat; teks 200%; WhatsApp float; fokus modal alamat; persistensi draft | O01–O05, P06–P08, X01/X03, X05; C03/C08/C10/C11/C12/C15 | Temuan audit T07–T09, T11, T14, T15, T17, T18, T19, T21 | [plan fase 2](../plan/audit-findings-phase-2.md) — Draft |
| P2 | Target tutup dialog/ikon sosial; contrast footer/badge/avatar/placeholder; CTA step 1; status asing; tombol Beli lagi berulang | probe targets/contrast, O09; C02/C12/C13 | Temuan audit T19, T20, T02, O09 | [plan fase 2](../plan/audit-findings-phase-2.md) — Draft |

Catatan keputusan:

- **Fakta** adalah observasi dengan ID gambar/probe di bagian 4–7. **Opini user** adalah
  tiga masukan di bagian 8 (warning, kartu cabang, helper text) dan arahan umum.
- **Hipotesis** yang belum diukur: pengurangan copy akan mempercepat review. Tidak ada
  klaim conversion/usability testing.
- **Keputusan baru** yang sudah diambil user: fokus plan 1 dan memisahkan sisanya ke plan 2.
  Keputusan copy/pattern final (warning netral, bintang + legenda, CTA hasil) mengikuti
  default plan 1 yang disetujui.
- Rekomendasi **bukan** izin implementasi plan 2; plan 2 masih Draft.


## 10. Batas bukti dan keterbatasan

- Semua respons bisnis adalah fixture. Tidak ada bukti integrasi Midtrans/Jubelio, tidak ada
  order/pembayaran nyata, dan tidak ada verifikasi status backend.
- Screenshot membuktikan tampilan; probe membuktikan interaksi pada fixture; keduanya tidak
  membuktikan perilaku produksi di semua kondisi jaringan/perangkat.
- Baseline hanya Chromium light theme. Dark theme, browser lain, zoom selain 200%, dan
  kombinasi perangkat tidak diuji.
- 200% teks diemulasikan dengan root font-size, bukan browser text zoom; hasil overflow
  adalah indikasi kuat tetapi bukan replika persis.
- Contrast diukur dari computed color/background efektif (light). Gambar/logo, non-text
  boundary, dan state hover/focus tidak diukur menyeluruh.
- Target pointer diukur dari rect; link teks inline (mis. footer) memiliki pengecualian
  SC 2.5.8 dan tidak otomatis dianggap pelanggaran.
- Full-page screenshot dengan header sticky dapat menampilkan header di tengah gambar
  (artefak Chromium), dan indikator development Next.js dapat muncul di screenshot/urutan tab.
  Keduanya bukan UI produk.
- Email/telepon pada beberapa layar berasal dari akun demo seeded (bukan PII nyata) atau
  prefill sesi setelah refresh; field fixture menggunakan nilai sintetik.
- Uji clipboard memakai izin/override browser; uji link eksternal memakai boundary audit.
- Tidak ada seed/reset DB, perubahan akun, schema, env, deployment, commit, atau push.
- Angka tinggi halaman/ID screenshot berasal dari run terakhir dan dapat berubah bila UI
  atau fixture berubah; artefak disposable dapat hilang.

## 11. AC01–AC10 → evidence

| AC | Status | Evidence |
|---|---|---|
| AC01 — login sesuai izin, data demo, tanpa mutasi/provider/secret | **Verified** | `report.json` → `auth` (HTTP 200, onboarding/verified, cookie store), `network` (hanya auth nyata; bisnis dimock; eksternal diblokir), audit script; tidak ada submit nyata/seed/reset. |
| AC02 — semua F01–O10 punya cakupan desktop/mobile + substate | **Verified** | Indeks matriks 30 ID F/P/R/O; 39 skenario runner; 180 PNG; 0 Pending; substate terpisah (F03 closed/contact/slot, F08 loading/error/empty/retry, P04 page1/page2/code, P05 applied/invalid/empty/error, P06 increase/cancel/confirm/decrease, P08 5 state, O03 paid/blocked, O04 3 state, O05 4 state, O07 2 state, O08 4 state, O10 3 state). |
| AC03 — viewport/full-page/modal & UI asli tanpa polish | **Verified** | Manifest `captureType`; PNG viewport untuk layar utama; `full-page` untuk F01/F02/F04/F05/P01/P02/P07/P10/O01/O02/O09; modal/transien viewport. Tidak ada CSS/teks UI yang diubah; label simulasi hanya di galeri. |
| AC04 — galeri lokal, terurut, berlabel simulasi, tertaut | **Verified** | `gallery.html`: 180 kartu, 7 bagian, label “DATA SIMULASI”, 180/180 gambar termuat, 0 resource eksternal, 0 href hilang, 0 page error (check-gallery.cjs). |
| AC05 — C01–C15 ditinjau pada surface relevan | **Verified** | Tabel checklist bagian 5 (semua ID berstatus dengan evidence); inventaris copy bagian 6; observasi biaya/action/recovery bagian 4 & 7. |
| AC06 — keyboard, contrast, target, mobile, reflow 320, teks 200% | **Verified** | `report.json` → `keyboard-*`, `dialog-*`, `targets-*`, `contrast-*`, `reflow-*`, `text200-*`, `continuity-*`; screenshot X01/X03 320 px; catatan batas emulasi di bagian 10. |
| AC07 — konsistensi checkout/detail & status bukan warna semata | **Verified** | P01/P02 vs O01/O02: grup nominal/action sama dengan label berbeda; token/badge shared; status selalu berteks (Menunggu/Lunas/Gagal/Siap diambil/Dalam pengantaran) + tone, bukan warna saja; temuan perbedaan kecil (C13). |
| AC08 — user meninjau gambar sebelum rekomendasi final | **Verified** | Bagian 8 mencatat masukan user 2026-11-14 pada `F02-mobile-full`, `F05-mobile-dropdown-viewport`, warning pickup, dan arahan umum. Cakupan review terbatas pada contoh tersebut, bukan seluruh 180 gambar; keterbatasan dicatat. |
| AC09 — rekomendasi final tertelusur & berprioritas | **Verified** | Bagian 9 memetakan prioritas P0/P1/P2 ke evidence T01–T22 dan keputusan user; rekomendasi dipecah ke plan 1 (disetujui) dan plan 2 (Draft) dengan link artefak. |
| AC10 — batas/evidence transparan; tanpa implementasi/perluasan scope | **Verified** | Indeks + bagian 10 + tabel ini; `git status` hanya `.scratch/` dan file disposable `playwright/` (gitignored); tidak ada perubahan app/schema/env; tidak ada commit/push. |

## 12. Langkah berikutnya

1. Implementasi [plan 1](../plan/improve-checkout-copy-density.md) (sudah disetujui)
   mengikuti gate development/TDD dan final verification.
2. Review dan approval [plan fase 2](../plan/audit-findings-phase-2.md) per workstream
   P0/P1/P2 sebelum implementasi.
3. Implementasi perbaikan **bukan** bagian audit ini; setiap plan tetap memerlukan
   approval/verification sendiri.


## 13. Checklist penutupan spec

- [x] Semua target capture F01–O10 tercakup pada desktop/mobile atau N/A sah; 0 Pending.
- [x] 180 PNG, manifest cocok dengan file, galeri 180/180 gambar termuat.
- [x] AC01–AC10 Verified dengan evidence aktual.
- [x] AC08 Verified — masukan user tercatat 2026-11-14 (review terarah pada contoh yang disebut).
- [x] AC09 Verified — rekomendasi/prioritas final di bagian 9, dipecah ke plan 1 dan plan 2.
- [x] Screenshot/script disposable tetap di `playwright/`; tidak ada credential/PII atau generated artifact yang di-force-add.
- [x] Spec tetap disimpan; index fitur diperbarui; status plan lama tidak diubah.
- [x] Prinsip enduring baru: **N/A** — tidak ada prinsip baru yang perlu didistilasi ke `docs/`; temuan spesifik tetap di research ini. Jika nanti ada perbaikan, dokumentasi fitur harus diperbarui saat implementasi.

Tidak ada perubahan tampilan yang diserahkan. Implementasi perbaikan hanya dapat direncanakan setelah
review gambar disepakati dan memperoleh approval terpisah.
