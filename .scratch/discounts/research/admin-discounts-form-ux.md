# Riset UX form Diskon Admin

## Ringkasan

Halaman saat ini lebih mencerminkan mekanisme internal sistem daripada pekerjaan pengguna: membuat promo, menentukan batas biaya, memeriksa hasil, lalu publish. Masalah utama bukan sekadar tampilan ramai, melainkan hierarki informasi, penamaan aksi, dan prasyarat publish yang tersebar.

Rekomendasi utama: judul berbasis tugas/identitas, form dengan bantuan minimal dan mandatory marker, konfigurasi wajib dalam satu alur, primary action **Lanjut ke publish**, review dengan ringkasan manusiawi, riwayat terbuka, serta tab **Simulasi** terpisah.

**Status:** hasil riset dan usulan, bukan spec/plan yang disetujui. Tidak ada perubahan kode, aturan bisnis, atau permission.

## Metode dan batas bukti

- Meninjau empat screenshot yang diberikan pengguna: form, riwayat, daftar promo, dan posisi simulasi.
- Menelusuri implementasi list, editor, dialog review, serta validasi publish di repository.
- Menggunakan **Ollama web search**, kemudian **Ollama web fetch** untuk membaca sumber primer GOV.UK Design System dan W3C; hasil search juga memuat artikel asli Nielsen Norman Group.
- Research dikerjakan langsung, tanpa subagent. Tidak ada izin delegasi pada permintaan ini.
- Tidak melakukan pengujian browser localhost, submit, usability testing, atau automated test. Temuan visual berasal dari screenshot; fakta alur berasal dari source code. Tidak mengklaim angka peningkatan usability ataupun kepatuhan WCAG penuh.
- Context7 tidak diperlukan untuk riset prinsip UX ini: tidak ada implementasi API library. Sumber yang dipakai adalah panduan asli pemilik design system dan accessibility.

## Fakta implementasi yang menjelaskan masalah

| Fakta terverifikasi | Referensi repository |
|---|---|
| Judul fallback adalah `Draft diskon belum lengkap`; judul memakai nama tersimpan, bukan input yang belum disimpan | `apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx:877–880` |
| Review ditolak ketika form masih dirty; pengguna harus menyimpan draft secara terpisah | editor `:579–595`, `:1175–1182` |
| Tombol publish baru terlihat di dalam dialog review | `apps/admin/src/app/admin/discounts/[id]/discount-review-dialog.tsx`, bagian `DialogFooter` |
| Minimal salah satu kuota atau budget diperlukan untuk publish, tetapi form kapasitas ada pada tab Pemakaian & budget | editor `:1190–1269`; `apps/admin/src/lib/discounts-administration.ts:941–950` |
| Simulasi dibungkus `details` di bawah aturan | editor `:709` |
| Detail riwayat dibungkus `details`, lalu data ditampilkan dengan `JSON.stringify` | editor `:340–342` |
| Kapasitas disimpan lewat operasi terpisah dan langsung berlaku pada promo live | editor `:535–552`, `:1253–1255` |
| Publish memakai review fingerprint dan expected versions untuk menolak review kedaluwarsa | editor `:598–619`; `apps/admin/src/lib/discounts-administration.ts:2730–2759` |
| Publish pertama mengubah draft menjadi enabled; publish promo paused mempertahankan paused | `apps/admin/src/lib/discounts-administration.ts:2497`, `:2730` |
| Daftar promo memiliki blok Tentang promo dan istilah teknis seperti Revision live | `apps/admin/src/app/admin/discounts/discounts-list-client.tsx` |

Nomor baris mengacu pada kondisi repository saat riset; dapat bergeser setelah perubahan.

## Dasar dari sumber primer

1. **Nielsen Norman Group — Aesthetic and Minimalist Design**: informasi tidak relevan/yang jarang diperlukan bersaing dengan informasi penting. Minimalis bukan menghapus semua informasi, melainkan mempertahankan yang mendukung tugas. [S1]
2. **GOV.UK — Text input**: hint untuk bantuan yang relevan bagi mayoritas pengguna; singkat, bukan penjelasan panjang. Panduan mereka menyarankan satu kalimat pendek. Ini pedoman content design, bukan batas universal jumlah kata. [S2]
3. **Nielsen Norman Group — Required fields**: tandai field wajib secara eksplisit; asterisk merupakan penanda yang familiar. **W3C** menekankan petunjuk wajib/opsional serta relasi label/instruksi yang dapat diakses. Asterisk tidak boleh menjadi satu-satunya informasi untuk assistive technology. [S3, S4]
4. **GOV.UK — Button**: label menggambarkan aksi, satu primary action dominan; terlalu banyak aksi utama membingungkan. Disabled button dapat membuat pengguna bingung, sehingga bukan solusi default untuk menjelaskan prasyarat. [S5]
5. **GOV.UK — Check answers**: ringkasan sebelum submit membantu pengguna memeriksa dan memperbaiki data. Mendukung review sebelum publish, tetapi tidak mengharuskan UI memakai istilah revision/fingerprint. [S6]
6. **GOV.UK — Accordion**: konten tersembunyi dapat tidak ditemukan; jangan menyembunyikan informasi yang dibutuhkan semua pengguna. Periksa apakah struktur sederhana sudah cukup sebelum memakai accordion. [S7]
7. **GOV.UK — Tabs**: cocok untuk bagian terkait yang sering ditukar dan tidak harus dibaca bersamaan; tidak cocok sebagai pengganti urutan langkah wajib. Tabs juga menyembunyikan konten, sehingga bukan solusi otomatis untuk semua kepadatan. [S8]

## Evaluasi tujuh feedback dan rekomendasi

### 1. Judul berupa status ketidaklengkapan

**Diagnosis:** pengguna membutuhkan orientasi “sedang membuat/mengedit apa”, bukan diagnosis form sebagai judul. Dalam screenshot, nama sudah diketik tetapi judul fallback belum berubah karena belum disimpan.

**Usulan:**

- Promo baru: **Buat diskon**.
- Promo existing: nama promo, misalnya **Diskon Sepatu**.
- Status tampil terpisah sebagai badge **Draft**, **Aktif**, atau **Dijeda**.
- Jangan menambahkan “Belum dipublish” berulang jika badge Draft sudah cukup.
- Ketidaklengkapan dijelaskan sebagai error spesifik ketika pengguna melanjutkan, bukan heading global.

Dasar: hierarki dan informasi bernilai tinggi [S1]; wording konkret merupakan rekomendasi untuk konteks produk ini.

### 2. Tulisan kecil terlalu banyak

**Diagnosis:** beberapa hint mencampurkan aturan uang, waktu, akun, dan mekanisme perhitungan. Pengguna harus membaca manual sebelum bisa mengisi.

**Usulan content inventory:**

| Konten sekarang | Perlakuan yang diusulkan |
|---|---|
| Nominal dalam Rupiah utuh | Gunakan label/satuan Rp dan kontrol angka; tampilkan error jika input tidak valid, bukan paragraf lintas field |
| Hanya customer dengan email terverifikasi | Jangan letakkan di bagian Jadwal; tampilkan ringkas pada ringkasan syarat saat review jika penting untuk ekspektasi operator |
| Berlaku mulai… berhenti tepat… | Pakai label **Mulai (WIB)** dan **Berakhir (WIB, opsional)**; perilaku tanggal kosong harus tetap eksplisit melalui pilihan atau hint pendek |
| Penjelasan presisi persentase dan pembulatan | Pindahkan detail teknis ke panduan; hasil perhitungan terlihat di simulasi |
| Batas potongan per order, bukan per barang | Pertahankan makna di label **Maksimum potongan per pesanan (Rp, opsional)** |
| Minimum setelah harga coret | Label **Minimum belanja (Rp)** dengan hint singkat **Setelah harga coret; 0 = tanpa minimum** bila kontrol belum membuatnya jelas |

Jangan memindahkan bantuan esensial seluruhnya ke tooltip. Error bukan tempat pertama menjelaskan syarat yang tidak dapat diprediksi. Prinsipnya: hilangkan duplikasi, pendekkan label/hint, pertahankan konsekuensi penting [S1, S2, S4].

### 3. Tidak ada tanda mandatory

**Usulan:** tampilkan `*` pada label wajib dan satu legenda **\* Wajib diisi untuk publish**. Field opsional diberi `(opsional)` bila membantu. Status required harus dapat dikenali screen reader, bukan hanya warna merah.

Mandatory bersifat kondisional:

- Nama, jenis potongan, dan parameter sesuai jenisnya harus valid.
- Persentase wajib hanya untuk diskon persentase.
- Nominal wajib hanya untuk diskon nominal.
- Batas subsidi wajib untuk subsidi ongkir.
- Kuota **atau** budget: tandai kelompok **Batas penggunaan\*** dengan instruksi **Isi kuota atau budget**. Jangan memberi asterisk pada keduanya seolah keduanya wajib.
- Jadwal tidak otomatis wajib; backend mengizinkan batas waktu kosong.

Pisahkan syarat publish dari kemampuan menyimpan draft. Istilah “draft” tidak otomatis menjamin draft parsial bisa disimpan; kontrak endpoint draft harus diperiksa sebelum perubahan alur [S3, S4].

### 4. Riwayat tersembunyi dan kontrol tidak jelas

**Diagnosis:** setelah memilih tab Riwayat, pengguna masih harus membuka disclosure; setelah dibuka yang terlihat malah JSON/objek kosong, bukan perubahan yang mudah dipahami.

**Usulan:** timeline/list terbuka berisi aksi, pelaku, waktu, dan perubahan bermakna:

> **Nama promo diubah**  
> HQ Manager · 3 Nov, 07.13 WIB  
> Nama promo: Sepatu → Diskon Sepatu

- Event pembuatan cukup **Draft dibuat**; jangan tampilkan `Sebelum: tidak dicatat` dan `Sesudah: {}` sebagai isi utama.
- Hanya render perubahan bila payload memang mencatatnya; jangan mengarang nilai historis.
- Version, policy, dan raw payload bukan konten utama untuk operator awam.
- Jika perubahan sangat panjang, ringkasan tetap terlihat; detail tambahan boleh memakai tombol konvensional **Lihat 8 perubahan** dengan cue dan state yang jelas. Disclosure tidak dilarang, tetapi bukan default untuk seluruh riwayat [S1, S7].

### 5. Blok Tentang promo pada daftar

**Usulan:** hapus blok manual panjang dari halaman daftar. Daftar dipakai untuk mencari, memeriksa status, dan membuka promo.

Pindahkan hanya informasi yang diperlukan ke konteksnya:

- Perbedaan kupon publik/kode promo: pada pemilihan jenis saat membuat promo.
- Aturan kombinasi promo: panduan atau ringkasan terkait, bukan footer daftar.
- Efek publish: pada review.
- Penjelasan kapasitas ditahan: pada tampilan pemakaian bila diperlukan.

Ini tidak menghapus aturan bisnis, hanya mengubah lokasi penyampaiannya. Pertimbangkan juga mengurangi istilah Revision live dan ID teknis pada tampilan utama; bukan prioritas dibanding kejelasan publish [S1, S2].

### 6. Sulit menemukan cara publish

**Rekomendasi prioritas tertinggi:**

```text
Isi konfigurasi promo
        ↓
[Lanjut ke publish] — primary
[Simpan draft]      — secondary
        ↓
Periksa sebelum publish
Ringkasan: potongan, minimum, jadwal, kuota/budget, syarat
[Publish diskon]    [Kembali mengedit]
        ↓
Feedback sesuai hasil aktual
```

- **Lanjut ke publish** menyebut tujuan yang selama ini tersembunyi. Aksi ini belum memublikasikan promo.
- Usulan perilaku: validasi, simpan konfigurasi yang diperlukan, lalu minta review server tanpa pengguna harus menekan Simpan draft terlebih dahulu.
- Jika belum lengkap, tampilkan error ringkas dan arahkan ke field bermasalah; jangan hanya disable tombol tanpa jalan pemulihan.
- Jika simpan gagal, hentikan alur sebelum review/publish, pertahankan input, dan jelaskan operasi yang berhasil/gagal bila ada partial save.
- Review pertama cukup ringkasan konfigurasi; sebelum/sesudah lebih relevan untuk perubahan promo existing.
- Review fingerprint, version checks, permission, dan validasi server tetap dipertahankan.
- Feedback tidak selalu **Diskon aktif**: promo dengan waktu mulai di masa depan belum dapat digunakan; promo paused tetap paused setelah publish. Copy harus mengikuti keadaan aktual, bukan menyamakan publish dengan langsung berlaku.

**Masalah struktural tambahan:** kuota/budget adalah konfigurasi wajib publish tetapi saat ini digabung dengan monitoring pemakaian. Untuk promo baru, letakkan **Batas penggunaan** dalam alur konfigurasi. Tab **Pemakaian** fokus pada hasil penggunaan, bukan menyembunyikan prasyarat publish.

**Batas penting:** kapasitas promo existing langsung berlaku lewat endpoint policy, tidak menunggu publish. Jangan menyatukan semua field di bawah satu tombol simpan lalu mengklaim semuanya draft tanpa perubahan kontrak yang disetujui. Opsi paling konservatif: tetap sediakan aksi khusus **Simpan batas penggunaan** dengan pemberitahuan pendek **Langsung berlaku**, sementara aturan diskon tetap draft. Penyatuan menjadi satu transaksi/draft menyeluruh adalah keputusan produk/backend baru, bukan sekadar polish UI [S5, S6].

### 7. Simulasi di collapse paling bawah

**Usulan:** tab **Simulasi**, sejajar dengan bagian terkait. Ini cocok bila simulasi merupakan tugas tambahan, bukan langkah wajib publish [S7, S8].

- Tampilkan ringkasan aturan yang disimulasikan di panel agar pengguna tidak perlu menghafal konfigurasi tab lain.
- Label sumber harus jujur: simulasi saat ini membaca draft tersimpan, bukan input lokal. Bila ada perubahan belum tersimpan, jangan diam-diam menjalankan simulasi draft lama seolah mencerminkan input terbaru.
- Berikan aksi eksplisit **Simpan draft dan simulasikan** bila kontrak memungkinkan; alternatif konservatif: jelaskan **Simpan perubahan untuk memperbarui simulasi**.
- Hasil utama: potongan dan total bayar; rincian perhitungan sekunder.
- Satu catatan ringkas: **Hasil simulasi bukan jaminan kuota saat checkout**.
- Bila hasil perlu dibandingkan terus-menerus saat mengisi, panel berdampingan dapat lebih cocok daripada tabs. Itu perlu diuji, bukan diasumsikan.

## Susunan konseptual yang direkomendasikan

```text
← Daftar diskon
Buat diskon                         [Draft]

[Pengaturan] [Simulasi] [Pemakaian] [Riwayat]
             + [Kode promo] bila jenisnya kode manual

Pengaturan
  Nama promo*
  Potongan: jenis* + parameter sesuai pilihan*
  Minimum belanja
  Jadwal (WIB)
  Batas penggunaan*: kuota atau budget
  Batas per customer

[Simpan draft]  [Lanjut ke publish]
```

Sketsa ini rekomendasi information architecture, bukan blueprint implementasi final. Token, typography, button, tabs, field, dan focus treatment harus memakai shared design system admin; bukan membuat gaya visual baru khusus Diskon. Penempatan aksi mengikuti reference form admin yang nanti disepakati.

## Contoh skenario untuk menguji usulan

Operator membuat **Diskon Sepatu 10%**, minimum Rp200.000, maksimum potongan Rp30.000, kuota 100, tanpa tanggal berakhir.

1. Pengguna melihat field wajib dan mengisi konfigurasi dalam satu alur.
2. Klik **Lanjut ke publish**; sistem menyimpan lalu menampilkan ringkasan server.
3. Ringkasan menampilkan **10%, maks Rp30.000/pesanan · min Rp200.000 · kuota 100**.
4. Klik **Publish diskon**; status/feedback menjelaskan apakah sudah berlaku atau menunggu jadwal.
5. Pada Simulasi, subtotal Rp250.000 menghasilkan potongan Rp25.000, dengan asumsi syarat terpenuhi dan tanpa komponen lain yang mengubah dasar potongan.

Kasus pemulihan: kuota dan budget sama-sama kosong → pesan **Isi kuota atau budget** pada kelompok Batas penggunaan, input lain tidak hilang. Kasus update: promo paused dipublish → tetap Dijeda, bukan diklaim Aktif.

## Prioritas dan keputusan lanjutan

1. **P0:** jalur publish terlihat, syarat kuota/budget tidak tersembunyi, keselamatan penyimpanan terpisah tetap jelas.
2. **P1:** heading, mandatory marker, pemangkasan copy, riwayat manusiawi, tab Simulasi.
3. **P2:** penyederhanaan istilah dan kolom teknis pada daftar.

Sebelum implementasi, perlu menyepakati prototype/complete plan: alur simpan-review, penanganan kapasitas langsung berlaku, kemampuan menyimpan draft parsial, serta perilaku simulasi terhadap unsaved input. Riset ini tidak mengubah approval/status plan existing.

Validasi berikutnya: task-based usability test dengan operator representatif—membuat promo, menyimpan tanpa publish, publish terjadwal, memperbaiki error batas penggunaan, dan memperbarui promo paused. Periksa apakah mereka bisa menjelaskan akibat setiap tombol tanpa bantuan peneliti. Setelah implementasi, lakukan render/keyboard review dan coverage Playwright; heuristic review saja belum membuktikan pengguna awam berhasil.

## Feedback tambahan: pembuatan dan daftar terpadu

### Fakta repository

- Kupon publik dan kode promo memakai tabel induk yang sama: identifier TypeScript `discountOffers` / tabel SQL `discount_offer`, dibedakan oleh `activationKind` (`public` atau `manual_only`), di `packages/db/src/schema/discounts.ts:155–161,206`.
- Literal kode berada pada tabel anak `discountCodes` / SQL `discount_code`; constraint membatasi kode untuk `manual_only` (`packages/db/src/schema/discounts.ts:377–420`). Satu daftar promo tidak berarti satu baris per kode: promo tetap entitas induknya.
- Tombol Buat draft mengirim `activationKind: kind`, yaitu tab list yang sedang aktif, bukan pilihan eksplisit pada alur pembuatan (`apps/admin/src/app/admin/discounts/discounts-list-client.tsx:73–79`). Filter daftar sekaligus mengubah hasil aksi pembuatan.
- Tab Kode selalu dirender, meskipun kupon publik hanya menampilkan pesan bahwa kode tidak berlaku (`apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx:973,1579`).
- Pagination server-side **sudah ada**, default 10 baris/page. Service juga mendukung daftar gabungan ketika filter `activationKind` tidak diberikan (`apps/admin/src/lib/discounts-administration.ts:1874–1913`). UI saat ini selalu mengirim filter jenis (`discounts-list-client.tsx:58`). Jadi masalahnya bukan ketiadaan pagination, tetapi pemisahan daftar dan makna tombol yang tergantung tab.

### Rekomendasi yang menggantikan pemisahan tab jenis

1. Satu tombol **Buat diskon**, terlepas dari filter daftar.
2. Setelah klik, tampilkan pilihan eksplisit **Jenis promo**:
   - **Kupon publik** — Customer memilih kupon saat checkout.
   - **Kode promo** — Customer memasukkan kode saat checkout.
3. Jenis dipilih sebelum request pembuatan draft; backend saat ini memerlukan jenis saat create. Ini memberi pengalaman memilih di dalam alur pembuatan tanpa membuat record publik sementara lalu mengubah jenis diam-diam. Pembatalan sebelum create tidak menambah draft kosong.
4. Pada kupon publik, **jangan render tab Kode**. Pada kode promo, tampilkan pengelolaan kode. Jangan membuat pengguna membuka bagian yang tidak mempunyai tugas untuknya.
5. Default daftar menjadi **satu tabel semua promo**, dengan kolom **Jenis** dan filter **Semua jenis / Kupon publik / Kode promo**, serta filter status. Filter hanya menyaring daftar, tidak mengubah jenis promo yang dibuat.
6. Pertahankan pagination server-side existing, misalnya 10 promo/page; total/pagination mengikuti filter gabungan. Reset ke page 1 ketika filter berubah. Bukan mengambil seluruh data lalu memotongnya di browser.

Contoh: pengguna sedang memfilter Kode promo, menekan Buat diskon, lalu memilih Kupon publik. Draft baru harus tetap bertipe Kupon publik—filter daftar bukan instruksi pembuatan. Setelah kembali ke daftar, arahkan ke tampilan yang membuat hasilnya dapat ditemukan; kebijakan reset filter/feedback perlu diputuskan dalam prototype agar promo baru tidak tampak hilang.

Satu tabel database tidak otomatis mewajibkan satu tabel UI. Alasan daftar terpadu di sini adalah kedua jenis mempunyai tugas pengelolaan, status, aturan, dan batas penggunaan yang serupa; perbedaannya bisa diwakili kolom/filter. Tidak ditemukan kebutuhan tugas terpisah yang mengharuskan dua tab. Rekomendasi mengikuti informasi relevan dan kontrol yang menjelaskan akibat tindakan [S1, S5, S8], bukan menganggap bentuk database sebagai aturan desain.

Masih berupa usulan; belum mengubah jenis promo existing, memperbolehkan konversi jenis, atau menyetujui implementasi.

## Feedback tambahan: penyimpanan terfragmentasi antar-tab

Pengguna menyoroti bahwa tombol save berbeda pada setiap tab membuat batas penyimpanan tidak jelas. Setelah menyimpan Aturan, pengguna dapat secara wajar mengira seluruh perubahan diskon sudah tersimpan, padahal perubahan di tab lain belum tentu ikut disimpan.

### Diagnosis

- Satu halaman detail memberi persepsi satu objek kerja, tetapi UI mengekspos beberapa operasi backend sebagai beberapa batas save.
- Menambah tulisan “hanya menyimpan tab ini” tidak menyelesaikan akar masalah; pengguna tetap harus mengingat bagian mana yang sudah disimpan.
- Risiko konkret pada implementasi: `saveDraft()` dan `saveCapacity()` sama-sama memanggil `load()` setelah operasi. Penyatuan state lokal dan perilaku rehidrasi harus diaudit sebelum redesign agar input bagian lain tidak hilang atau tertimpa. Catatan ini menunjukkan risiko yang perlu diverifikasi, bukan klaim reproduksi browser.

### Arah rekomendasi

**Untuk field konfigurasi yang dapat diedit sebagai draft, gunakan satu batas penyimpanan tingkat halaman:** perubahan dari semua bagian konfigurasi dikumpulkan sebagai satu editing session, dengan **Simpan draft** sebagai secondary action dan **Lanjut ke publish** sebagai primary action. Kedua tombol merupakan dua tujuan, bukan dua cakupan data berbeda: Simpan draft menyimpan seluruh konfigurasi draft; Lanjut ke publish menyimpan konfigurasi yang sama lalu meminta review server. Pergantian tab tidak membuang perubahan dan tidak menyiratkan data sudah tersimpan.

- Status unsaved berlaku lintas bagian, bukan hanya Aturan; tampilkan satu status yang ringkas.
- Validasi publish mencakup seluruh konfigurasi; error pada bagian lain harus dapat ditemukan dan difokuskan tanpa pengguna menebak tab yang salah.
- Tab Pemakaian dan Riwayat bersifat observasi; tidak membutuhkan save konfigurasi. Simulasi mempunyai aksi menjalankan simulasi, bukan tombol save yang bersaing.
- Aksi operasional seperti pause, archive, atau perubahan status kode tidak otomatis menjadi bagian draft hanya karena berada pada halaman yang sama. Konsekuensinya harus tetap jelas dan proporsional.

**Batas arsitektur yang harus diputuskan:** backend saat ini menyimpan kapasitas langsung berlaku dan terpisah dari draft aturan. Pengelolaan kode juga mempunyai operasi sendiri. Maka satu tombol yang hanya menjalankan beberapa request existing secara berurutan belum menjamin satu save utuh: request pertama dapat berhasil dan request berikutnya gagal.

Arah jangka panjang yang direkomendasikan untuk pengguna awam adalah satu draft konfigurasi menyeluruh dan penerapan perubahan yang konsisten pada publish, termasuk batas penggunaan bila disetujui. Ini membutuhkan kajian kontrak draft/publish, versioning, permissions, audit, dan keamanan kapasitas untuk order yang sedang berjalan. Jangan mengubah lifecycle tersebut sebagai perbaikan kosmetik.

Alternatif konservatif bila lifecycle backend harus tetap: satukan seluruh field draft dalam satu area konfigurasi dengan satu save, lalu pisahkan kontrol operasional yang langsung berlaku ke konteks yang benar-benar berbeda dan eksplisit—bukan tab setara dengan tombol save yang tampak sama. Alternatif ini mengurangi ambiguitas, tetapi tidak memberikan satu draft menyeluruh.

Contoh acceptance untuk arah draft menyeluruh: pengguna mengubah potongan 10% → 15% dan kuota 100 → 200, lalu menekan Simpan draft. Kedua perubahan tersimpan sebagai draft; promo live tetap 10% dan kuota 100 sampai publish. Perilaku contoh ini **belum didukung kontrak kapasitas existing** dan memerlukan persetujuan perubahan produk/backend sebelum implementasi.

Prioritas masalah ini **P0**, bersama kejelasan jalur publish. Rekomendasi ini memperbarui arah sebelumnya: tombol Simpan batas penggunaan terpisah bukan target UX utama, melainkan hanya alternatif jika lifecycle langsung berlaku sengaja dipertahankan. Belum merupakan keputusan produk atau plan yang disetujui.

## Feedback tambahan: format input uang dan persentase

Arahan pengguna: amount pada text field ditampilkan dengan format Indonesia, misalnya **Rp 100.000,00**, dan persentase dengan satuan yang terlihat, misalnya **10%**, untuk mengurangi kesalahan input.

- Semua input uang pada scope Diskon Admin menggunakan prefix **Rp**, pemisah ribuan titik, dan desimal koma. Nilai `100000` ditampilkan sebagai **Rp 100.000,00**. Prefix/suffix satuan merupakan bagian visual kontrol, bukan karakter yang harus diketik pengguna.
- Persentase mempunyai suffix **%** yang selalu terlihat; nilai `10` terbaca **10%**, bukan angka tanpa satuan.
- Label field tetap ada; format visual/satuan tidak menggantikan label, mandatory marker, atau pesan validasi.
- Nilai kosong tetap kosong; jangan mengubah field opsional kosong menjadi nol karena kosong dan nol dapat mempunyai makna bisnis berbeda.
- Formatting harus mendukung mengetik, paste, menghapus, selection, dan posisi caret tanpa membuat input sulit diedit. Detail perilaku saat focus/blur serta format paste yang didukung perlu dicantumkan pada prototype/spec.
- Nilai payload tetap memakai kontrak numerik existing, bukan string berformat tampilan. Contoh uang dikirim sebagai `"100000"`, bukan `"Rp 100.000,00"`; persentase `"10"`, bukan `"10%"`.
- Format dua angka desimal pada uang **tidak otomatis mengizinkan pecahan Rupiah**. Aturan existing adalah Rupiah utuh; `,00` merupakan tampilan. Pecahan nonnol harus diberi error yang jelas, bukan dibulatkan atau dihapus diam-diam. Perubahan untuk mendukung pecahan uang membutuhkan keputusan produk terpisah.
- Jangan mengubah presisi persentase existing hanya untuk menambahkan suffix; nilai pecahan persen tetap mengikuti aturan bisnis yang berlaku, dengan koma sebagai separator tampilan lokal.

Contoh acceptance: input nominal `100000` → tampilan **Rp 100.000,00**, nilai tersimpan `100000`; input persentase `10` → tampilan **10%**, nilai tersimpan `10`. Field maksimum potongan yang dikosongkan tetap berarti tanpa batas sesuai kontrak existing, bukan otomatis Rp0.

Arahan format ini berasal dari feedback pengguna, bukan klaim bahwa satu format visual saja menghilangkan seluruh kesalahan input. Belum ada implementasi atau pengujian interaksi kontrol.

## Referensi

- **[S1]** Nielsen Norman Group, [Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/).
- **[S2]** GOV.UK Design System, [Text input — Hint text](https://design-system.service.gov.uk/components/text-input/#hint-text).
- **[S3]** Nielsen Norman Group, [Marking Required Fields in Forms](https://www.nngroup.com/articles/required-fields/).
- **[S4]** W3C WAI, [Form Instructions](https://www.w3.org/WAI/tutorials/forms/instructions/).
- **[S5]** GOV.UK Design System, [Button](https://design-system.service.gov.uk/components/button/).
- **[S6]** GOV.UK Design System, [Check answers](https://design-system.service.gov.uk/patterns/check-answers/).
- **[S7]** GOV.UK Design System, [Accordion](https://design-system.service.gov.uk/components/accordion/).
- **[S8]** GOV.UK Design System, [Tabs](https://design-system.service.gov.uk/components/tabs/).
