# Spec: Pengelolaan Diskon Admin yang jelas dan terpadu

## 1. Tujuan dan dasar keputusan

Pengguna operasional dapat membuat kupon publik atau kode promo, mengisi konfigurasi tanpa membaca manual panjang, menyimpan **seluruh konfigurasi sebagai satu draft**, memeriksa hasil, lalu publish dengan akibat yang jelas.

Sumber kebutuhan: seluruh feedback pengguna pada sesi ini, termasuk screenshot daftar/detail, mandatory marker, riwayat, simulasi, format uang/persentase, dan kebingungan save per tab. Dasar UX dan fakta repository: [riset UX](../research/admin-discounts-form-ux.md).

### Approval

- Kesepahaman scope: pengguna memilih **“Sesuai, susun spec”** setelah rangkuman seluruh feedback; hanya penyusunan spec, bukan implementasi.
- Keputusan lifecycle: pengguna memilih **“Draft menyeluruh (Recommended)”** atas pertanyaan apakah seluruh konfigurasi, termasuk kuota/budget dan batas per customer, disimpan bersama sebagai draft dan baru berlaku setelah publish.
- Complete spec, detail perilaku, dan AC01–AC20 disetujui melalui permintaan pengguna **“tolong implementasi: admin-discounts-unified-editor-spec.md”** pada sesi implementasi ini.
- Approval tersebut mencakup draft parsial, staging perubahan kode, format saat mengetik, layout, migrasi, dan penghentian writer langsung sesuai detail spec; discovery yang mengubah kontrak tetap perlu keputusan baru.
- Izin implementasi diberikan; tidak ada izin subagent, pembuatan/publikasi implementation tickets, commit, push, remote, deployment, atau E2E live.

Status keseluruhan spec dicatat hanya di [index fitur](../index.md). Dokumen ini tidak mengubah status plan sebelumnya.

Checkpoint implementasi dan Context7 aktual: [bukti backend editor terpadu](../ticket/admin-unified-editor-verification.md). Fondasi save/review/publish sudah diuji pada seam service, tetapi endpoint/UI, backfill persisted, dan acceptance end-to-end belum selesai; belum siap dipakai operasional.

## 2. Scope dan non-scope

### Termasuk

1. Satu daftar semua promo, filter jenis/status, pagination server-side.
2. Satu alur Buat diskon dengan pemilihan jenis eksplisit sebelum create draft.
3. Editor dengan satu state konfigurasi dan satu batas penyimpanan lintas bagian.
4. Draft menyeluruh: identitas yang dapat diedit, aturan potongan, jadwal, kuota, budget, batas per customer, dan perubahan konfigurasi kode pada promo manual.
5. Judul, mandatory marker, label/copy ringkas, formatting Rupiah dan persentase.
6. Review dan publish yang jelas, atomik, idempotent, serta aman terhadap konflik.
7. Tab Simulasi, Pemakaian, dan Riwayat; tidak ada tab Kode pada kupon publik.
8. Migrasi draft existing, penyesuaian endpoint terkait, audit, test, serta dokumentasi.

### Tidak termasuk

- Mengganti theme/font/palet, redesign seluruh admin, atau mengubah shared token global.
- Mengubah rumus pricing, pembulatan, pajak, combinability promo, batas presisi, atau syarat email customer terverifikasi.
- Mengubah jenis kupon publik menjadi kode promo pada Offer existing. `activationKind` tetap immutable.
- Mengembalikan kode yang diarsipkan, membebaskan kode yang pernah direservasi, refund, targeting baru, atau default kuota/budget otomatis.
- Mengubah counter usage ketika publish, menulis ulang snapshot/hold order lama, atau menambah kuota per kode.
- Autosave, draft per operator, merge otomatis konflik, import/export promo, fitur pencarian baru, atau persist input lokal lintas refresh browser.
- Aktivasi gate domain, deployment, provider live, dan pengujian E2E live tanpa izin tersendiri.

## 3. Kontrak perilaku utama

### 3.1 Istilah dan batas penyimpanan

- **Perubahan belum disimpan:** input lokal berbeda dari draft terakhir yang diterima server.
- **Draft tersimpan:** semua konfigurasi draft disimpan server; promo live tidak berubah.
- **Ada draft:** ada konfigurasi tersimpan yang belum dipublish, termasuk ketika promo lama tetap Aktif/Dijeda.
- **Publish:** menerapkan konfigurasi draft ke konfigurasi live dalam satu transaksi.
- **Simulasi:** perhitungan contoh dari satu versi draft tersimpan; bukan publish, quote, atau reservasi.

Satu sesi editor mempunyai satu `draftConfiguration` tingkat halaman. Pengaturan dan Kode berbagi state ini, bukan form/save independen. Pindah tab tidak menghapus atau mengirim input. Pemakaian/Riwayat hanya membaca; data read-only boleh refresh tanpa mengganti state konfigurasi lokal.

**Simpan draft** dan **Lanjut ke publish** mempunyai cakupan konfigurasi yang sama, bukan cakupan tab berbeda. Tidak ada tombol Simpan kapasitas, Simpan aturan, atau Simpan kode terpisah.

### 3.2 Draft parsial — usulan detail

Simpan draft menerima field wajib publish yang belum diisi. Contoh: hanya nama sudah terisi, nominal dan kuota belum ada; penyimpanan berhasil, publish belum boleh.

Nilai yang diberikan tetap harus benar secara bentuk dan batas domain. Nominal negatif, persen >100 atau presisi berlebih, tanggal tidak valid, atau field kind campuran tidak boleh disimpan sebagai data valid. Field kosong dinormalisasi menjadi null sesuai kontrak, bukan angka nol. Jenis potongan belum dipilih boleh null; parameter kosong pada kind yang dipilih juga boleh null sampai publish.

Batas global boleh keduanya null pada draft. Draft boleh memuat penurunan kapasitas yang belum memenuhi komitmen saat ini sebagai usulan, tetapi review/publish menolaknya dengan alasan spesifik; jangan mengubah live pada save. Kelengkapan, izin perluasan, dan komitmen diperiksa lagi saat publish.

### 3.3 Contoh kontrak yang mengikat setelah approval

Kondisi live: potongan 10%, kuota 100. Operator mengganti potongan menjadi 15% dan kuota menjadi 200 di bagian berbeda.

- Simpan draft: kedua perubahan tersimpan bersama; live tetap 10% dan kuota 100.
- Refresh editor: draft 15% dan kuota 200 dapat dibuka kembali.
- Review: menampilkan 10% → 15% dan 100 → 200.
- Publish berhasil: live menjadi 15% dan kuota 200 sekaligus.
- Publish gagal pada salah satu validasi: keduanya tetap lama; draft tetap tersedia.

## 4. Daftar dan pembuatan diskon

### 4.1 Daftar terpadu

Judul halaman **Diskon**. Tombol utama **Buat diskon**. Tidak ada dua tab pemisah Kupon publik/Kode promo dan tidak ada blok Tentang promo.

Filter:

- Jenis: **Semua jenis**, **Kupon publik**, **Kode promo**; default Semua jenis.
- Status: **Semua status**, **Draft**, **Aktif**, **Dijeda**, **Diarsipkan**.
- Pagination default 10 promo/page, server-side, satu baris per Offer, bukan per kode.
- Filter berubah → page 1. Total dan totalPages berdasarkan kombinasi filter; fetch list tidak dibatasi jenis bila Semua jenis.

Kolom: **Nama diskon**, **Jenis**, **Potongan**, **Status**, **Sisa kuota**, **Sisa budget**, **Aksi**. Aksi baris **Kelola**. Hilangkan kolom Jalur, Revision live, ID teknis, dan daftar literal kode dari tampilan utama. Jenis tetap terlihat sebagai kolom pembeda.

Nama: pakai nama draft untuk Offer yang belum pernah publish, nama live untuk Offer published. Bila kosong, **Diskon tanpa nama**. Offer published dengan draft menampilkan badge **Ada draft** di samping status live. Benefit/kapasitas published memakai live, bukan campuran dengan draft; Offer belum published menggunakan ringkasan draft dan label **Belum berlaku** pada kapasitas, bukan sisa kuota yang terkesan dapat dipakai. Nilai tanpa batas tampil **Tanpa batas** bila konfigurasi live memang tidak membatasi dimensi itu.

### 4.2 Pembuatan

Klik Buat diskon → dialog **Buat diskon**, pilihan radio **Jenis promo\***:

- **Kupon publik** — **Dipilih customer saat checkout**.
- **Kode promo** — **Dimasukkan customer saat checkout**.

Tidak ada pilihan awal diam-diam berdasarkan filter daftar. Aksi **Lanjut** dan **Batal**. Lanjut tanpa pilihan menampilkan **Pilih jenis promo**. Request create baru dikirim setelah pilihan valid. Batal sebelum create tidak menambah record.

Create memakai request key stabil untuk retry request yang sama. Berhasil → `/admin/discounts/{id}`; gagal tetap di dialog dan pilihan tidak hilang. Setelah kembali dari editor, daftar default Semua jenis/Semua status/page 1 agar filter lama tidak menyembunyikan promo yang baru dibuat. Tidak menambah state URL/filter persistence baru dalam scope ini.

## 5. Rancangan editor

### 5.1 Hierarki

```text
← Daftar diskon
Buat diskon / <nama diskon>                 [Draft / Aktif / Dijeda]
Kupon publik / Kode promo                  [Ada draft bila relevan]

[Pengaturan] [Kode — hanya manual] [Simulasi] [Pemakaian] [Riwayat]

Pengaturan
  Nama diskon*
  Potongan: jenis* dan parameter kondisional*
  Minimum belanja*
  Jadwal
  Batas penggunaan*: kuota atau budget
  Batas pemakaian per customer*

Perubahan belum disimpan / Draft tersimpan
[Simpan draft] [Lanjut ke publish]
```

- Offer baru tanpa nama tersimpan: heading **Buat diskon**. Setelah draft bernama disimpan: nama draft jika belum published; existing published menggunakan nama live sampai publish.
- Jangan memakai ketidaklengkapan sebagai heading. Tidak menumpuk Draft + Belum dipublish untuk makna yang sama.
- Satu global action bar milik konfigurasi, terlihat pada Pengaturan/Kode. Pada Simulasi tersedia aksi kondisional menyimpan seluruh draft sebelum simulasi, bukan save khusus tab. Pemakaian/Riwayat tidak menampilkan tombol save konfigurasi.
- Primary **Lanjut ke publish**; secondary **Simpan draft**. Urutan visual secondary lalu primary. Bukan tombol Publish final yang langsung mengeksekusi tanpa review.
- Pause/aktifkan/archive merupakan tindakan lifecycle eksplisit existing, di menu **Tindakan**, tidak bersaing sebagai primary action.

### 5.2 Field dan copy

Legenda satu kali: **\* Wajib diisi untuk publish**.

| Kelompok | Label | Perilaku dan bantuan |
|---|---|---|
| Identitas | Nama diskon* | 1–120 karakter saat publish; label bukan placeholder |
| Potongan | Jenis potongan* | Pilihan Nominal tetap / Persentase / Subsidi ongkir |
| Nominal | Nominal potongan* | Rupiah utuh >0; tampil hanya untuk nominal tetap |
| Persentase | Persentase diskon* | >0 sampai 100, maksimal 6 angka pecahan |
| Persentase | Maksimum potongan per pesanan (opsional) | Kosong tanpa batas; jika diisi >0 |
| Ongkir | Maksimum subsidi ongkir* | Rupiah utuh >0 |
| Minimum | Minimum belanja* | Rupiah utuh ≥0; hint **Setelah harga coret; 0 = tanpa minimum** |
| Jadwal | Mulai (WIB, opsional) | Hint **Kosong = berlaku setelah publish**; tanggal masa depan menunda keberlakuan |
| Jadwal | Berakhir (WIB, opsional) | Hint **Kosong = tanpa tanggal berakhir** |
| Batas penggunaan* | Kuota pemakaian (opsional) | Integer positif jika diisi |
| Batas penggunaan* | Budget diskon (opsional) | Rupiah utuh ≥0; nol bukan tanpa batas |
| Batas penggunaan* | — | Hint kelompok **Isi kuota atau budget**; jangan menandai kedua field wajib masing-masing |
| Batas akun | Batas pemakaian per customer* | Integer positif; nilai awal 1 mengikuti existing |

Pilih jenis potongan lain menghapus parameter kind sebelumnya dari payload; jangan mengirim nilai tersembunyi. Tidak mengubah jenis jalur public/manual pada editor.

Bantuan teknis tentang engine/revision, enam digit presisi, start inklusif/end eksklusif, dan raw policy tidak memenuhi layar. Aturan tersebut tetap ditegakkan dan pesan spesifik muncul ketika diperlukan. Syarat email customer tidak diletakkan di Jadwal; review menampilkan **Untuk customer dengan email terverifikasi**.

### 5.3 Satuan dan formatting input

Semua input uang di editor dan simulasi memakai prefix **Rp** yang selalu terlihat; persen memakai suffix **%**. Prefix/suffix bukan karakter wajib ketikan, bukan placeholder, dan tidak menggantikan label.

- Display uang saat blur: **Rp 100.000,00**; persen: **10%**, **12,5%**.
- Saat focus uang: prefix Rp dan grouping tetap terlihat; bagian edit dapat menunjukkan **100.000** tanpa `,00` tetap, supaya mengetik `100000` berarti seratus ribu, bukan bergeser ke pecahan. Blur menambahkan `,00`.
- Selama input desimal sementara, misalnya `100.000,`, pertahankan buffer lokal sampai selesai; jangan mengubahnya diam-diam menjadi angka lain. Nilai pecahan Rupiah nonnol invalid; jangan dibulatkan.
- Persen memakai koma untuk pecahan; titik bukan separator pecahan UI. Tidak ada grouping untuk persen.
- Paste uang menerima digit polos (`100000`) atau format Indonesia (`Rp 100.000,00`/`100.000`). Paste persen menerima `10`, `10%`, atau `12,5%`. Format ambigu/asing seperti `100,000.00` ditolak dengan error, bukan ditafsirkan diam-diam. Paste hanya mengganti selection sesuai perilaku input normal.
- Field kosong tetap kosong; optional kosong → null, bukan 0. Ctrl+A/Delete/Backspace/mengedit di tengah tidak memindahkan caret secara mengejutkan atau menyisakan karakter yang tidak dapat dihapus.
- Canonical payload uang berupa string integer (`"100000"`), persen berupa decimal string titik (`"12.5"`), tanpa Rp/grouping/%. Hindari konversi floating-point untuk uang atau pembulatan presisi persen.
- Batas uang existing 0..9999999999999; nilai benefit/cap wajib >0. Count maksimal 2147483647. Tidak menambah dukungan pecahan Rupiah.
- Error: **Masukkan nominal dalam Rupiah utuh**, **Gunakan format seperti Rp 100.000,00**, **Masukkan persentase lebih dari 0 hingga 100%**, **Maksimal 6 angka desimal** sesuai penyebab.

## 6. Kode promo dalam satu draft — usulan detail

Tab **Kode** hanya ada pada `manual_only`. Kupon publik tidak mempunyai tab/panel kosong yang menjelaskan kode tidak berlaku.

Supaya tidak menciptakan save per tab lagi, penambahan dan perubahan konfigurasi kode di editor ikut draft menyeluruh:

- **Tambah kode** menambah baris lokal ke konfigurasi, bukan request reservasi langsung.
- Baris kode baru dapat dihapus dari draft sebelum publish; kode belum direservasi global saat save/review.
- Untuk kode existing, pilih status target Aktif/Nonaktif/Diarsipkan; pilihan ini juga draft, tidak langsung mengubah eligibility. Kode archived tidak dapat diaktifkan kembali.
- Literal kode existing tidak dapat diedit/diganti owner. Kode baru mengikuti normalisasi, bentuk, dan batas existing; maksimal 50 usulan kode baru per command/draft, tanpa mengurangi kapasitas pengelolaan kode existing.
- Header kelompok **Kode baru** dan **Kode yang sudah diterbitkan** membedakan usulan vs live. Status live dan target ditampilkan bila berbeda.
- Field literal kode mengikuti permission/masking existing; view-only tidak menerima literal/proposal kode dari API.
- Publish memeriksa dan mereservasi kode baru secara atomik bersama aturan/kapasitas. Kode yang direbut promo lain setelah review menyebabkan konflik; tidak ada perubahan live parsial.
- Tidak mengubah invariant backend menjadi wajib minimal satu kode jika sebelumnya tidak diwajibkan. Review manual tanpa kode aktif menampilkan **Belum ada kode aktif; customer belum dapat memakai promo ini**, tanpa mengarang aturan publish baru.

Pause/aktifkan/archive Offer tetap aksi lifecycle eksplisit dan langsung berlaku, bukan field konfigurasi tersembunyi di draft. Sebelum lifecycle mutation saat input dirty, minta simpan atau buang input; batalkan aksi jika pengguna memilih tetap mengedit. Semua mutasi tersebut membatalkan review lama.

## 7. Simpan, review, publish, dan keselamatan

### 7.1 Simpan draft

Satu request menyimpan keseluruhan snapshot, termasuk konfigurasi pada tab yang tidak aktif. Server menyimpan secara atomik dengan expected versions dan request key. Audit/receipt berada pada transaksi yang sama. Jika salah satu bagian invalid/unauthorized, seluruh save dibatalkan dan tidak ada bagian yang ditandai berhasil.

Save tidak mengubah pointer live, live capacity, status kode live, usage, atau eligibility customer. `draftVersion` naik; `policyVersion` live tidak naik pada save. Hanya response sukses yang mengganti baseline dirty. Jangan memanggil reload umum yang menghapus input bagian lain pada gagal/refresh data monitoring.

User dengan `discounts:edit` boleh menyimpan proposal; izin kapasitas untuk penerapan perluasan ditampilkan saat review dan ditegakkan lagi saat publish. Ini menjaga draft sebagai usulan, bukan bypass permission.

### 7.2 Lanjut ke publish

1. Validasi seluruh konfigurasi untuk publish, termasuk field di tab lain.
2. Bila ada error: summary **Periksa bagian yang ditandai**, link ke field; buka tab terkait lalu fokus field error pertama. Tidak hanya disable tombol karena belum lengkap.
3. Bila dirty: simpan seluruh draft atomik; bila tidak dirty, tidak mengulang save yang tidak perlu.
4. Minta review server dari versi yang baru diterima; bukan dari state/version sebelum save.
5. Tampilkan dialog **Periksa sebelum publish**, bukan raw validations internal.

Jika save berhasil tetapi review gagal, tampilkan **Draft tersimpan, tetapi review gagal dimuat. Coba lagi.** Jangan mengklaim save gagal atau publish berhasil. Retry review memakai versi tersimpan.

### 7.3 Isi review

- Promo pertama: ringkasan konfigurasi final. Update promo: perubahan bermakna **Saat ini → Setelah publish**, termasuk kuota, budget, batas customer, dan perubahan kode.
- Tampilkan jadwal WIB, minimum, batas potongan per pesanan, syarat email terverifikasi, dan akibat terhadap state Offer.
- Copy singkat: **Perubahan berlaku setelah publish. Pesanan yang sudah dibuat tidak berubah.**
- Jika jadwal mulai masa depan: **Berlaku mulai {waktu WIB}**.
- Jika Offer paused: **Diskon tetap dijeda setelah publish**.
- Jika expired: **Jadwal diskon sudah berakhir**; tidak mengklaim customer dapat memakai promo.
- Tidak menampilkan JSON, fingerprint, engine version, policy version, atau daftar seluruh validasi sukses sebagai isi utama.
- Aksi **Kembali mengedit** (secondary), **Publish diskon** (primary). Tombol final tidak tersedia untuk eksekusi bila review gagal; alasan ditampilkan.

### 7.4 Publish atomik

Satu transaksi mengunci Offer, membaca ulang policy actor, memvalidasi versi/review fingerprint dan usage terkini, kemudian menerapkan terms/benefit, kapasitas, per-customer limit, kode, pointer revision, receipt, dan audit sekaligus. Bukan rangkaian request draft + policy + codes dari browser yang dianggap satu save.

- Pertahankan idempotency receipt dan konflik request key; retry kehilangan response tidak menghasilkan publish/audit/reservasi kode ganda.
- Fingerprint mencakup keseluruhan draft canonical, perubahan kode, versi live/policy/draft, dan state hasil. Usage dapat berubah tanpa menjamin fingerprint baru; validasi komitmen wajib diperiksa ulang pada publish.
- Perluasan kapasitas tetap membutuhkan `discount_capacity` sesuai classifier existing, diperiksa di review dan di bawah lock saat publish. Pencabutan izin setelah review menolak publish.
- Kuota/budget tidak boleh di bawah held + consumed, batas per customer tidak boleh di bawah komitmen relevan, minimal satu batas global, dan drift tetap fail closed.
- `policyVersion` live naik hanya bila kapasitas/batas customer berubah; version lainnya mengikuti mutasi domain. Jangan reset counter.
- Hold/snapshot lama tidak dihitung ulang, tidak dibebaskan, dan tidak direvisi. Pemakaian baru membaca konfigurasi live baru.
- Draft pertama menjadi enabled; published paused tetap paused; archived tidak bisa disimpan/publish. Jadwal tetap menentukan keberlakuan.

### 7.5 Konflik, keluar halaman, dan double submit

- Konflik: **Diskon telah diubah pengguna lain. Muat versi terbaru sebelum melanjutkan.** Input lokal tidak otomatis diganti; **Muat versi terbaru** meminta persetujuan membuang input lokal bila dirty. Tidak ada silent merge/overwrite atau auto-retry menggunakan versi baru.
- Meninggalkan editor saat dirty: dialog **Perubahan belum disimpan**, pilihan **Tetap mengedit**, **Buang perubahan**, **Simpan draft dan keluar**. Navigasi hanya dilanjutkan bila save sukses. Refresh/tab close memakai peringatan browser yang tersedia; tidak menjanjikan custom copy atau pemulihan input lintas refresh.
- Tombol mutasi disabled selama request berjalan untuk mencegah submit ganda; loading jelas. Kelengkapan form bukan alasan tombol Lanjut ke publish diam-diam disabled.
- Perubahan lokal setelah review membatalkan review/token yang ditampilkan.

## 8. Simulasi, Pemakaian, dan Riwayat

### Simulasi

Tab **Simulasi**, tidak di accordion bawah Pengaturan. Menggunakan versi draft tersimpan yang eksplisit dan ringkasan aturan di panel yang sama.

- Clean dan lengkap → **Jalankan simulasi**.
- Dirty → **Simpan draft dan simulasikan**, menyimpan seluruh konfigurasi lintas bagian, lalu mensimulasikan versi hasil save.
- Draft belum lengkap → error menuju field terkait, bukan memakai live/draft lama diam-diam.
- Input keranjang simulasi bukan konfigurasi promo; tidak ikut Simpan draft dan tidak memicu status konfigurasi dirty.
- Hasil menonjolkan **Potongan** dan **Total bayar**, rincian di bawah, bukan raw payload. Data stale setelah perubahan konfigurasi ditandai **Aturan berubah. Jalankan ulang simulasi**; jangan tampilkan hasil lama sebagai hasil terkini.
- Catatan **Hasil simulasi bukan jaminan kuota saat checkout**. Tidak mengurangi kuota, membuat order, menahan stock, atau memanggil provider live.

### Pemakaian

Read-only monitoring penggunaan/kapasitas **live**, dengan status/label **Pemakaian saat ini**. Konfigurasi batas dipindah ke Pengaturan. Perbedaan draft/live dijelaskan lewat badge Ada draft/review, bukan mengganti sisa live dengan batas draft.

Pertahankan scope Orders untuk detail customer/order, pagination entries, masking, dan akses agregat existing. Tidak ada tombol save.

### Riwayat

Judul **Riwayat**. Event, pelaku, waktu WIB, dan perubahan manusiawi terbuka langsung; tanpa collapse Lihat perubahan dan tanpa raw JSON.

- Contoh **Potongan diubah · HQ Manager · 3 Nov, 07.13 WIB**, diikuti **10% → 15%**.
- Event pembuatan: **Draft dibuat**, bukan objek `{}`/Sebelum tidak dicatat.
- Data historis tidak tersedia: tampilkan event/aktor/waktu yang ada; jangan merekonstruksi nilai yang tidak direkam.
- Legacy event perubahan kapasitas langsung tetap ditampilkan jujur sebagai histori lama; jangan menafsirkan seolah menunggu publish.
- Kode tetap masked pada audit; actor yang sudah dihapus tetap memakai safe attribution existing.
- Gunakan daftar terbuka untuk semua perubahan event, bukan accordion baru; histori sangat panjang menggunakan kemampuan pagination existing jika tersedia. `discovery:` periksa dukungan pagination history sebelum mengubah kontraknya; penambahan pagination history baru bukan scope wajib spec ini.

## 9. Rancangan data dan kompatibilitas

### 9.1 Fakta dan pilihan struktur

Tabel SQL sebenarnya bernama **`discount_offer`**, **`discount_offer_revision`**, dan **`discount_code`**; identifier TypeScript-nya `discountOffers`, `discountOfferRevisions`, `discountCodes`. Kupon publik/kode promo memakai Offer yang sama dan berbeda `activationKind`.

**Usulan:** tambahkan snapshot draft bertipe pada revision sebagai `draftConfiguration` JSONB dengan discriminator `draftSchemaVersion: 1`. Snapshot adalah satu sumber kebenaran draft menyeluruh, termasuk field yang boleh belum lengkap. Kolom published existing serta `discount_benefit` tetap projection live/immutable published, bukan tempat menyimpan parameter benefit setengah lengkap.

Alasan: schema benefit existing mensyaratkan parameter per-kind lengkap; memaksakan field parsial ke tabel live memperlemah invariant pricing. Snapshot draft diparse strict dan divalidasi di server; bukan JSON bebas yang langsung diteruskan ke engine. Saat publish, normalisasi snapshot lengkap lalu materialisasikan published columns/benefit, kapasitas Offer, dan perubahan kode dalam transaksi yang sama. Snapshot published dipertahankan immutable untuk provenance; pricing tetap memakai bentuk live existing.

Alternatif ditolak: snapshot draft di localStorage saja (tidak tersimpan server), banyak endpoint save tab (partial commit), dan melonggarkan constraint live untuk semua draft parsial. Typed snapshot tidak menggantikan validasi DB/live atau permission.

Snapshot minimal:

```text
DiscountDraftConfiguration
  draftSchemaVersion: 1
  name: string | null
  currency: "IDR"
  minSubtotal: integer-string | null
  startAt, endAt: offset ISO-string | null
  benefit: null | discriminated kind dengan parameter canonical nullable
  capacity: { quotaCount: integer | null,
              budgetAmount: integer-string | null,
              perClientLimit: integer | null }
  codeChanges: { proposedCodes: canonical-string[],
                 states: { codeId, expectedCodeVersion, state }[] }
```

`activationKind` milik Offer, bukan field konversi snapshot. Public harus mempunyai codeChanges kosong. Tanggal tetap `timestamptz` untuk kolom DB dan `Date` saat insert; JSON timestamp eksplisit offset. Batas ukuran payload dan jumlah code proposals mengikuti existing limit; jangan mengizinkan payload audit/JSON tak terbatas.

### 9.2 Migrasi/backfill

- Live Offer, pointer, capacity, usage, dan kode existing tidak berubah akibat migrasi.
- Revision draft existing mendapat snapshot dari terms/benefit existing + kapasitas Offer saat migrasi; perubahan kode awal kosong. Jika field lama belum lengkap, pertahankan null tanpa mengarang nama/kuota.
- Offer published tanpa draft tidak perlu dibuatkan draft otomatis. Editor boleh memakai live sebagai baseline; save pertama membuat draft snapshot baru dengan semua nilai live sebagai awal.
- Riwayat lama tidak ditulis ulang. Record archived tetap terminal.
- Seeder/reset menyediakan public/manual, draft parsial, published dengan draft berbeda, paused, dan kode masked; FK-ordered cleanup diperbarui.
- Generated SQL dibuat melalui Drizzle, bukan diedit manual. Dev memakai db:push sesuai kebijakan; uji migrasi deployment pada DB disposable termasuk rollback aplikasi yang kompatibel.

### 9.3 Menutup writer yang melanggar lifecycle baru

`PATCH /policy`, `POST /codes`, dan `PATCH /codes/{codeId}` tidak boleh tetap menjadi jalur langsung untuk menerapkan konfigurasi di belakang editor baru.

Usulan cutover: endpoint langsung tersebut dihentikan dengan `410 CONFIGURATION_MOVED_TO_DRAFT` dan pesan **Ubah konfigurasi melalui draft, lalu publish**; semua caller first-party dipindah. Tidak menjalankan adapter yang diam-diam membuat partial draft atau tetap mengubah live. Pause/enable/archive Offer tetap di endpoint state existing.

Perubahan ini breaking untuk caller lama. `discovery:` inventarisasi caller scripts/integrasi selain UI sebelum implementasi; jika ada kebutuhan kompatibilitas eksternal, eskalasi untuk keputusan baru. Jangan menganggap semua consumer hanya UI tanpa pencarian bukti.

Rollout admin/schema harus terkoordinasi: tidak boleh ada old writer yang masih menerapkan policy langsung bersamaan dengan draft model baru. Tidak menyalakan gate domain existing sebagai bagian rollout. `discovery:` pastikan topologi deployment/cutover dan kebutuhan periode kompatibilitas dari dokumentasi deployment sebelum menentukan file deployment yang perlu diubah.

## 10. Kontrak HTTP dan export yang diusulkan

Ini spesifikasi kontrak, bukan kode implementasi/API library yang sudah diverifikasi.

| Endpoint | Delta kontrak |
|---|---|
| GET `/api/admin/discounts` | Tetap page/limit/state/activationKind opsional; default UI tanpa activationKind. Tambah ringkasan draft aman untuk nama/benefit unpublished; published capacity tetap live |
| POST `/api/admin/discounts` | Jenis eksplisit dari dialog, requestKey; buat snapshot draft kosong tanpa reservasi kode dari UI |
| GET `/api/admin/discounts/{id}` | Tambah `draftConfiguration`, source/version, status live, metadata izin; proposal literal hanya untuk actor yang boleh edit |
| PUT `/api/admin/discounts/{id}/draft` | `{requestKey, expectedOfferVersion, expectedDraftVersion, configuration}`; atomic full replacement snapshot, validasi bentuk/field parsial; bukan PATCH tab |
| POST `/api/admin/discounts/{id}/review` | Expected versions existing; usulan kode dibaca dari snapshot server, bukan usulan tak tersimpan dari browser; response ringkasan/diff capacity+codes, issue field paths, fingerprint, stateAfter |
| POST `/api/admin/discounts/{id}/publish` | requestKey + expected offer/draft/policy versions + fingerprint; payload bukan konfigurasi baru yang belum direview |
| POST `/api/admin/discounts/{id}/simulate` | Expected draft version; snapshot lengkap tersimpan sebagai sumber; output breakdown existing dipertahankan |
| Writer policy/codes lama | 410 pada cutover terkoordinasi; bukan mutasi live |
| Usage/history/state | Envelope, scope, masking, dan kontrak lifecycle existing dipertahankan kecuali copy UI |

Envelope sukses/error dan requestId existing dipertahankan. Error validasi menambahkan `fieldErrors: {path, message}[]` yang dapat dipetakan ke form; jangan mengekspos error SQL/provider/body internal. Expected draft version tetap dapat membuat draft baru dari live menggunakan version aggregate; read response harus memberi versi canonical itu.

Kontrak export tanpa body:

- `packages/db/src/discount-draft.ts`: `DiscountDraftConfiguration`, `DiscountDraftIssue`, `parseDiscountDraftConfiguration(input: unknown): DraftParseResult`, `validateDiscountDraftForPublish(configuration: DiscountDraftConfiguration): DiscountDraftIssue[]`. Pure schema/domain shapes; tidak mengimpor app DB/auth.
- `apps/admin/src/features/discounts/discount-editor-contracts.ts`: `SaveDiscountConfigurationInput`, `DiscountEditorDetail`, `DiscountReview`, `DiscountEditorVersions`, `DiscountConfigurationChangeSet`; canonical DTO bukan salinan state format lokal.
- `apps/admin/src/features/discounts/save-discount-configuration-service.ts`: `saveDiscountConfiguration(input: SaveDiscountConfigurationInput, actorUserId: string): Promise<DiscountEditorDetail>`.
- `apps/admin/src/features/discounts/review-discount-configuration-service.ts`: `reviewDiscountConfiguration(input: {offerId: string; expectedOfferVersion: number; expectedDraftVersion: number}, actorUserId: string): Promise<DiscountReview>`.
- `apps/admin/src/features/discounts/publish-discount-configuration-service.ts`: `publishDiscountConfiguration(input: PublishDiscountConfigurationInput, actorUserId: string): Promise<PublishDiscountConfigurationResult>`; input sesuai HTTP, result detail + replay metadata.
- `apps/admin/src/features/discounts/discount-configuration-repository.ts`: `withLockedDiscountConfiguration<T>(input: {offerId: string; actorUserId: string; requestKey?: string}, operation: (session: DiscountConfigurationSession) => Promise<T>): Promise<T>`; session bertipe menyediakan read authorized aggregate, receipt, atomic save/apply, audit. Bukan generic repository lintas fitur; query/lock di repository, keputusan operasi di service.
- `apps/admin/src/features/discounts/discount-configuration-repository.ts`: `getDiscountEditorDetail(offerId: string, actorUserId: string): Promise<DiscountEditorDetail>`; scope enforced di data boundary.
- `apps/admin/src/features/discounts/discount-configuration-policy.ts`: `assertDiscountConfigurationAccess(session: DiscountConfigurationSession, operation: "save" | "review" | "publish"): Promise<void>`; re-read actor/role grants di transaksi, tanpa parameter logger/requestId.
- `apps/admin/src/app/admin/discounts/discount-create-dialog.tsx`: `DiscountCreateDialog(props: {open: boolean; onOpenChange(open: boolean): void; onCreated(offerId: string): void})`.
- `apps/admin/src/app/admin/discounts/[id]/discount-editor-state.ts`: `createDiscountEditorState(detail: DiscountEditorDetail): DiscountEditorState`, `discountEditorReducer(state: DiscountEditorState, event: DiscountEditorEvent): DiscountEditorState`; pisahkan konfigurasi dirty dari simulation inputs dan live monitoring.
- `apps/admin/src/app/admin/discounts/[id]/discount-number-format.ts`: `parseMoneyInput(text: string): NumericInputResult`, `formatMoneyInput(canonical: string | null, focused: boolean): string`, `parsePercentInput(text: string): NumericInputResult`, `formatPercentInput(canonical: string | null): string`; buffer sementara bukan canonical valid.
- `apps/admin/src/app/admin/discounts/[id]/discount-number-input.tsx`: `DiscountNumberInput(props: {kind: "money" | "percent"; id: string; value: string; onValueChange(value: string): void; disabled?: boolean; describedBy?: string; invalid?: boolean})`; local buffer/caret dengan Input shared.
- UI section `DiscountSettingsSection`, `DiscountCodesSection`, `DiscountSimulationPanel`, `DiscountHistoryList`: props typed dari contracts/state; section mengirim event, tidak memiliki save konfigurasi sendiri. `DiscountReviewDialog` menerima `DiscountReview`, callbacks publish/back/reload, busy/error dan trigger ref existing.

`discovery:` detail mekanisme session/transaction type, reuse authorizer serta error/receipt internal legacy harus dibakukan dari source existing sebelum implementation handoff; jangan menduplikasi security helper atau mengimpor app ke shared package. Kontrak repository di atas merupakan boundary wajib, bukan alasan membuat framework session umum.

## 11. Blueprint file-level

Semua path relatif root repo. Create path adalah usulan, bukan klaim file sudah ada. Tidak refactor seluruh modul legacy di luar operasi yang terdampak.

| Path | Aksi / layer | Tanggung jawab / seam test |
|---|---|---|
| `packages/db/src/schema/discounts.ts` | Modify / schema owner | Snapshot draft bertipe dan constraint; `packages/db/src/discount-schema.db.test.ts` |
| `packages/db/src/discount-draft.ts` | Create / pure domain | Parse strict snapshot dan completeness; `packages/db/src/discount-draft.test.ts` |
| `packages/db/src/seed.ts` | Modify / script | Seeder schema/fixtures FK-safe; reset/seed disposable dan test schema |
| `packages/db/drizzle/` | Generate / migration | SQL dan metadata generated; nama file dari generator, bukan ditentukan manual |
| `apps/admin/src/features/discounts/discount-editor-contracts.ts` | Create / contracts | DTO dan command types bersama boundary admin; service/types tests |
| `apps/admin/src/features/discounts/discount-configuration-policy.ts` | Create / domain policy | Permission transactional reuse; `apps/admin/src/features/discounts/discount-configuration-policy.test.ts` dan DB race |
| `apps/admin/src/features/discounts/discount-configuration-repository.ts` | Create / repository | DB, lock order, receipt/audit persistence; `apps/admin/src/features/discounts/discount-configuration.db.test.ts` |
| `apps/admin/src/features/discounts/save-discount-configuration-service.ts` | Create / service | Satu operasi atomic save seluruh snapshot; `apps/admin/src/features/discounts/save-discount-configuration-service.test.ts` |
| `apps/admin/src/features/discounts/review-discount-configuration-service.ts` | Create / service | Review lengkap dan issue paths; `apps/admin/src/features/discounts/review-discount-configuration-service.test.ts` |
| `apps/admin/src/features/discounts/publish-discount-configuration-service.ts` | Create / service | Apply atomik dengan izin/commitment checks; `apps/admin/src/features/discounts/publish-discount-configuration-service.test.ts` dan DB tests |
| `apps/admin/src/lib/discounts-administration.ts` | Modify / legacy compatibility + read | Hubungkan create/detail/list/simulation ke snapshot; migrasikan touched write paths ke feature service/repository tanpa menambah God Service; existing `apps/admin/src/lib/discounts-administration.test.ts` dan `.db.test.ts` |
| `apps/admin/src/lib/discounts-http.ts` | Modify / HTTP mapping | Field errors dan 410 tanpa kehilangan requestId; `apps/admin/src/lib/discounts-http.test.ts` |
| `apps/admin/src/app/api/admin/discounts/route.ts` | Modify / route | Create/list DTO baru, logging; mock API dan E2E |
| `apps/admin/src/app/api/admin/discounts/[id]/route.ts` | Modify / route | Detail snapshot aman; permission/masking tests |
| `apps/admin/src/app/api/admin/discounts/[id]/draft/route.ts` | Modify / route | Parse command baru → save service; full-save atomic tests |
| `apps/admin/src/app/api/admin/discounts/[id]/review/route.ts` | Modify / route | Review service + issue fields; mock/service tests |
| `apps/admin/src/app/api/admin/discounts/[id]/publish/route.ts` | Modify / route | Publish service, log sukses/gagal; idempotency/conflict tests |
| `apps/admin/src/app/api/admin/discounts/[id]/simulate/route.ts` | Modify / route | Versi snapshot tersimpan, delegate; simulation tests |
| `apps/admin/src/app/api/admin/discounts/[id]/policy/route.ts` | Modify / route | 410 writer lama saat cutover; HTTP test |
| `apps/admin/src/app/api/admin/discounts/[id]/codes/route.ts` | Modify / route | 410 mutasi langsung lama; HTTP test |
| `apps/admin/src/app/api/admin/discounts/[id]/codes/[codeId]/route.ts` | Modify / route | 410 mutasi status kode lama; HTTP test |
| `apps/admin/src/app/admin/discounts/discounts-list-client.tsx` | Modify / UI | Tabel terpadu/filter/page; `e2e/admin/discounts-prototype-mock.spec.ts` |
| `apps/admin/src/app/admin/discounts/discount-create-dialog.tsx` | Create / UI | Pilih jenis sebelum create; spec Playwright yang sama |
| `apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx` | Modify / UI orchestration | Global state/actions, tab, navigation guard; `e2e/admin/discounts-admin-mock.spec.ts` |
| `apps/admin/src/app/admin/discounts/[id]/discount-editor-state.ts` | Create / UI domain | Dirty/baseline/versions, response race; `apps/admin/src/app/admin/discounts/[id]/discount-editor-state.test.ts` |
| `apps/admin/src/app/admin/discounts/[id]/discount-settings-section.tsx` | Create / UI | Field pengaturan dan batas penggunaan, controlled props; admin mock E2E |
| `apps/admin/src/app/admin/discounts/[id]/discount-codes-section.tsx` | Create / UI | Local staged code changes; admin mock E2E |
| `apps/admin/src/app/admin/discounts/[id]/discount-simulation-panel.tsx` | Create / UI | Input simulasi terpisah/hasil versi; admin mock E2E |
| `apps/admin/src/app/admin/discounts/[id]/discount-history-list.tsx` | Create / UI | Timeline terbuka/human diff; `e2e/admin/discounts-usage-mock.spec.ts` |
| `apps/admin/src/app/admin/discounts/[id]/discount-number-format.ts` | Create / pure UI logic | Parsing/format canonical; `apps/admin/src/app/admin/discounts/[id]/discount-number-format.test.ts` |
| `apps/admin/src/app/admin/discounts/[id]/discount-number-input.tsx` | Create / UI | Buffer/caret/prefix/suffix; admin mock E2E keyboard/paste |
| `apps/admin/src/app/admin/discounts/[id]/discount-review-dialog.tsx` | Modify / UI | Summary/diff final/capacity/code state; admin mock E2E |
| `apps/admin/src/lib/discounts-administration.test.ts` | Modify / unit | Kontrak lama→baru yang disentuh |
| `apps/admin/src/lib/discounts-administration.db.test.ts` | Modify / DB test | Lock/revoke/publish invariants integration |
| `packages/db/src/discount-schema.db.test.ts` | Modify / DB test | Draft parsial/live constraints/migration cases |
| `e2e/admin/discounts-prototype-mock.spec.ts` | Modify / E2E | Unified list/create/filter/conditional tabs |
| `e2e/admin/discounts-admin-mock.spec.ts` | Modify / E2E | Unified save/review/publish/format/unsaved |
| `e2e/admin/discounts-usage-mock.spec.ts` | Modify / E2E | Read-only monitoring/history/access |
| `docs/features/discount-administration.md` | Modify / docs | Lifecycle draft/publish, UI, kode, capacity; hapus uraian lama yang konflik |
| `docs/api-reference.md` | Modify / docs | Kontrak request/response dan 410 endpoints lama |
| `docs/architecture/database.md` | Modify / docs | Draft snapshot, published projections, backfill |
| `docs/README.md` | Modify / docs | Scope entry fitur yang benar |

Struktur feature-first dipilih untuk menghindari menambah operasi backend baru ke file legacy besar. Section UI dipisah berdasarkan tanggung jawab; state/save tetap satu pada parent, bukan memindahkan masalah save per tab ke komponen baru. Number input app-local agar tidak mengubah consumer Input shared lain tanpa scope. Schema tetap hanya pada shared DB package.

`discovery:` regression store memakai `apps/store/src/lib/discount-reservation.db.test.ts` dan `apps/store/src/lib/discounts-integration.db.test.ts`; tentukan tambahan assertion minimal setelah audit hot path. Runtime store tidak direncanakan berubah karena live projection tetap kompatibel; jika ternyata perlu perubahan runtime, eskalasi scope/path sebelum menulisnya.

## 12. Blueprint UX dan konsistensi visual

### Referensi dan component reuse

Referensi usulan untuk review pengguna: pola form `apps/admin/src/components/admin/BranchForm.tsx` dan list/filter/action `apps/admin/src/app/admin/products/harga/price-change-client.tsx`. Ini referensi bahasa visual/pola shared, bukan menyalin semua keputusan UX existing. Referensi akhir perlu dikonfirmasi pada review spec/render; tidak mengklaim peer page sudah diperiksa di browser.

Alias `@/components/ui/*` admin terverifikasi mengarah ke `packages/ui/src/components/ui/*` melalui `apps/admin/tsconfig.json`.

| Elemen | Reuse path / varian |
|---|---|
| Heading/field/section | `packages/ui/src/components/ui/card.tsx`, `label.tsx`, `input.tsx`; token existing, tanpa paragraf header tambahan |
| CTA | `packages/ui/src/components/ui/button.tsx`; default primary, outline secondary, ghost untuk kembali |
| Jenis promo | `packages/ui/src/components/ui/dialog.tsx`, `radio-group.tsx`; fieldset/legend accessible |
| Tabs | `packages/ui/src/components/ui/tabs.tsx`; treatment selected/focus existing |
| Filter/tabel | `packages/ui/src/components/ui/select.tsx`, `table.tsx`; pagination button existing |
| Status | `packages/ui/src/components/ui/badge.tsx`; makna status konsisten antar-list/detail |
| Exit guard | `packages/ui/src/components/ui/dialog.tsx`; perlu tiga pilihan, bukan memaksa confirm dua aksi |
| Angka bersatuan | App-local `discount-number-input.tsx` di atas Input shared; token/ukuran/focus tidak menciptakan desain baru |
| Review | Dialog/Table existing atau summary berlabel sesuai panjang konten; bukan JSON |

### State matrix dan copy final

| Konteks | Idle / empty | Loading | Error / recovery | Success | Permission / disabled | Unsaved |
|---|---|---|---|---|---|---|
| List | Daftar diskon; **Belum ada diskon** / **Tidak ada diskon sesuai filter** | **Memuat diskon…** | **Gagal memuat diskon** + **Coba lagi** | Baris/pagination aktual | Buat diskon tidak tampil tanpa edit | N/A |
| Create | **Buat diskon**, **Jenis promo*** | **Membuat draft…** | **Pilih jenis promo** / **Gagal membuat draft. Coba lagi.** | Redirect editor | Cegah submit ganda saat pending | Pilihan bertahan saat gagal |
| Editor | **Buat diskon** atau nama; **Draft tersimpan** setelah save | **Memuat diskon…**; save **Menyimpan…** | Field errors + **Periksa bagian yang ditandai**; network **Gagal menyimpan draft. Coba lagi.** | **Draft tersimpan** | Read-only: **Anda hanya dapat melihat diskon**; archived: **Diskon diarsipkan dan tidak dapat diubah** | **Perubahan belum disimpan** |
| Capacity permission | Batas penggunaan di Pengaturan | Bersama save/review | **Anda tidak memiliki izin untuk menambah batas penggunaan. Hubungi admin yang berwenang.** pada review | Proposal tetap draft sampai publish | Save proposal boleh dengan edit; publish perlu izin sesuai delta | Ikut dirty global |
| Review | **Periksa sebelum publish** | **Menyiapkan review…** | **Draft tersimpan, tetapi review gagal dimuat. Coba lagi.**; konflik copy §7.5 | Ringkasan dan Publish diskon | Publish tidak bisa dieksekusi saat invalid/pending; alasan terlihat | Edit membatalkan review |
| Publish | **Publish diskon** | **Memublikasikan…** | **Diskon belum dipublish. {alasan yang dapat ditindaklanjuti}** | **Diskon dipublish** + **Berlaku mulai {waktu}** / **Diskon tetap dijeda** bila relevan | Tidak tersedia untuk archived/view-only | Draft dipertahankan bila gagal |
| Codes manual | **Belum ada kode**; **Tambah kode** | Bersama global save | **Kode sudah digunakan. Pilih kode lain.** / field shape | **Draft tersimpan**, bukan Kode aktif sebelum publish | Literal masked sesuai hak | Status target/proposal ikut dirty |
| Simulasi | **Jalankan simulasi untuk melihat potongan dan total bayar** | **Menghitung simulasi…** | **Simulasi gagal. Coba lagi.** / arahkan field belum lengkap | Potongan / Total bayar | Aksi tidak tersedia tanpa izin simulasi existing | **Simpan draft dan simulasikan** bila konfigurasi dirty |
| Pemakaian | **Pemakaian saat ini** / **Belum ada pemakaian** | **Memuat pemakaian…** | **Gagal memuat pemakaian** + **Coba lagi** | Data live terkini | Agregat saja tanpa akses order, tanpa identitas tersembunyi bocor | Tidak menyentuh input konfigurasi |
| Riwayat | **Belum ada riwayat** | **Memuat riwayat…** | **Gagal memuat riwayat** + **Coba lagi** | Event terbuka | Tidak dapat diedit | N/A |
| Keluar editor | **Perubahan belum disimpan** | **Menyimpan…** | Tetap pada editor saat save gagal | Navigasi setelah save / discard | Jangan izinkan aksi kedua saat save | Tetap mengedit / Buang perubahan / Simpan draft dan keluar |

Error domain yang belum tercakup menggunakan pesan aman dan konkret dari mapper, bukan raw code; tidak membuat state baru diam-diam. Session habis mengikuti auth admin existing, tanpa mencampur session store.

### Viewport dan accessibility

- Verifikasi desktop 1440×900 dan mobile 390×844; sanity 360 px. Jangan ada horizontal overflow halaman.
- Form satu kolom pada mobile; dua field terkait boleh berdampingan desktop. Lebar baca mengikuti reference form; jangan rentangkan field sederhana tanpa batas hanya untuk memenuhi layar.
- Tabs boleh horizontal scroll region yang jelas; form/CTA tidak terpotong. Tabel memakai scroll container; primary action tidak tertutup overlay/footer.
- Action bar tidak sticky dalam usulan awal untuk menghindari focus/field terhalang; bila sticky diperlukan pada prototype, perubahan dicatat dan diuji keyboard/viewport.
- Label nyata, hubungan hint/error, required semantics sesuai kondisi, aria invalid dan error summary berlink. Required untuk publish tidak boleh membuat native validation menghalangi Simpan draft parsial.
- Keyboard tabs/radio/dialog mengikuti shared primitive; fokus kembali ke trigger, error mengarahkan ke field pada tab yang benar, focus ring terlihat.
- Normal text 4.5:1, large text 3:1, cue non-text yang diperlukan 3:1 sesuai WCAG; jangan memakai warna sebagai satu-satunya arti status/error. Target pointer minimum 24×24 CSS px atau pengecualian sah.
- Prefix/suffix tidak boleh dibaca dua kali atau membuat nilai tidak dapat dipahami screen reader; nama field menyebut Rupiah/persen secara accessible.
- Prototype baru belum diminta/dibuat. Prototype legacy adalah konteks, bukan bukti persetujuan redesign ini. Bila diminta kemudian, prototype yang disetujui mengikat struktur/alur/state; shared tokens tetap sumber visual.

## 13. Acceptance criteria dan verifikasi

| ID | Kriteria yang dapat diamati | Bukti yang diperlukan |
|---|---|---|
| AC01 | Semua jenis tampil dalam satu daftar; filter hanya menyaring, tidak mengubah jenis saat create | Mock E2E public+manual, >10 rows, page 2/filter reset |
| AC02 | Buat diskon meminta jenis; batal tidak create; retry tidak membuat Offer ganda | E2E + DB receipt test |
| AC03 | Kupon publik tidak mempunyai tab Kode; manual mempunyai tab dengan tugas nyata | E2E kedua jenis |
| AC04 | Tidak ada heading ketidaklengkapan, blok Tentang promo, raw revision/JSON utama, atau accordion riwayat/simulasi | Render review + semantic E2E |
| AC05 | Mandatory kondisional benar; kuota atau budget, bukan keduanya wajib; missing field ditemukan lintas tab | E2E error summary/focus + unit completeness |
| AC06 | Semua input uang tampil Rp 100.000,00 saat blur; persen 10%; empty/null tidak jadi nol; input/paste/caret aman | Independent fixture unit + Playwright keyboard/paste |
| AC07 | Simpan dari Pengaturan/Kode menyimpan seluruh snapshot; pindah tab tidak kehilangan input; draft parsial valid tersimpan | E2E edit dua bagian + refresh; DB atomic save |
| AC08 | Save draft 15%/kuota200 tidak mengubah live10%/kuota100 atau eligibility customer | DB integration read live + store regression |
| AC09 | Kode draft tidak aktif/terreservasi sampai publish; status kode existing tidak berubah saat save | DB integration + manual E2E |
| AC10 | Lanjut ke publish melakukan save bila perlu dan membuka review tanpa klik save terpisah; review memuat semua perubahan | E2E event sequence dan summary |
| AC11 | Publish menerapkan aturan, kapasitas, batas akun, kode, pointer, receipt, audit sekaligus; kegagalan rollback total | DB failure/race injection, bukan mock browser saja |
| AC12 | Stale/revoke/duplicate code/commitment drift menolak publish; draft/input tidak diam-diam tertimpa | Unit + DB concurrent tests + E2E conflict |
| AC13 | Retry request yang sama tidak menggandakan save/publish/audit/kode; fingerprint berubah jika konfigurasi review berubah | DB receipt/fingerprint cases |
| AC14 | Simulasi menggunakan versi yang benar, menyimpan semua draft bila dirty, tidak menahan kuota/order, hasil lama ditandai stale | E2E + simulation DB/unit seam |
| AC15 | Pemakaian tetap live dan scoped; riwayat terbuka manusiawi tanpa mengarang data historis | Usage mock E2E + DTO tests |
| AC16 | Publish terjadwal tidak diklaim langsung berlaku; paused tetap paused; archived read-only | E2E matrix + domain tests dengan waktu terkendali |
| AC17 | Keluar dirty meminta pilihan; save gagal tidak keluar; double-submit dicegah | E2E navigation/loading |
| AC18 | Writer langsung lama tidak dapat bypass draft lifecycle; caller first-party pindah | HTTP 410 + caller audit |
| AC19 | Backfill mempertahankan live/usage/kode, incomplete drafts tetap dapat dibuka; seed/reset sesuai schema | DB disposable migration/seed rehearsal |
| AC20 | Render konsisten dengan reference shared, keyboard dan viewport lolos; seluruh changed endpoints/features terdokumentasi | Manual browser review + Playwright + docs diff |

### Strategi pengujian

- TDD pada public seam, satu vertical slice: tulis test gagal → main agent jalankan RED → implementasi → GREEN. Expected amounts berasal dari fixture/perhitungan independen, bukan memanggil formatter/engine yang sama untuk expected.
- Unit: parser uang/persen, dirty/baseline/state race, partial vs publish validation, fingerprint/diff/error mapper, permission delta.
- DB: atomic rollback seluruh konfigurasi, snapshot materialization, idempotency, Offer lock vs reservation, revoke race, duplicate code race, capacity/per-client commitments, stale versions, seed/migration invariants. Test waktu memakai clock terkendali.
- UI: tiga mock specs existing pada blueprint diperbarui. Sudah termasuk `testMatch` mock config; jika menambah spec baru, daftarkan pada kedua match terkait sebelum menganggapnya dijalankan.
- Tidak menjalankan provider live selama unit/mock/manual admin research. DB tests memakai infrastructure disposable yang dipersiapkan/diizinkan, bukan mengubah live.

Verification ladder saat implementasi:

1. L0 per slice: `npm run verify:types:admin`; store typecheck bila shared/runtime consumer terdampak.
2. L1: `npm run verify:unit:slice -- <explicit paths pada slice>`; daftar file tidak boleh implisit.
3. L2 batch: `npm run verify:batch:unit` dan `npm run verify:batch:e2e -- e2e/admin/discounts-prototype-mock.spec.ts e2e/admin/discounts-admin-mock.spec.ts e2e/admin/discounts-usage-mock.spec.ts`.
4. L3 sebelum commit/PR: `npm run test:unit`; UI memerlukan full standard E2E sesuai kebijakan, tetapi legacy `npm run test:e2e` memerlukan izin terpisah. Tanpa evidence tersebut, laporkan gate belum terpenuhi, jangan menandai Done.
5. Render review desktop/mobile + task flow + keyboard, bandingkan peer/shared patterns. Passing test tidak menggantikan pemeriksaan UX.

Output bounded dan disposable Playwright di `playwright/`; kegagalan diperiksa dari Markdown, bukan membuka screenshot failure. Tidak mengulang suite yang sudah pass tanpa perubahan relevan.

## 14. Urutan kerja, dokumentasi, dan batas eksekusi

Urutan konseptual, **bukan implementation ticket breakdown yang sudah disetujui**:

1. Bakukan contracts/backfill/permission seam; buktikan save snapshot tidak mengubah live.
2. Tambahkan review/publish atomik dan tutup writer bypass dengan compatibility/cutover yang sudah terverifikasi.
3. Sambungkan daftar/create/editor global state ke kontrak baru dalam satu vertical flow yang dapat didemokan.
4. Selesaikan formatting, kode staged, simulasi, riwayat, dan semua interaction states.
5. Integrasi, migration/seed rehearsal, regression store, UX review dan dokumentasi.

Backend memakai feature-first route → operation service → repository, logging module-scoped melalui facade app. Route tidak menulis query, service tidak menerima logger/requestId, tidak ada provider HTTP dalam transaksi DB. Setiap changed API mempunyai info success/error failure aman; jangan log literal kode, fingerprint, token, atau seluruh snapshot payload.

Context7 checkpoint: **belum ada API library yang diimplementasikan** pada pekerjaan spec. Sebelum coding React/Next/Drizzle/Zod/Playwright/Vitest terkait, resolve/query installed version dan catat signature yang dipastikan di slice notes; jika tool gagal gunakan installed types/source atau vendor docs secara eksplisit. Blueprint ini menetapkan perilaku/kontrak internal, bukan menebak API library.

Dokumentasi permanen diperbarui sebagai bagian implementasi, termasuk meluruskan uraian kapasitas langsung berlaku di docs existing. Dampak deployment: migrasi schema dan cutover writer admin perlu rehearsal; tidak ada env/domain/port/cron baru yang direncanakan. File deployment spesifik hanya ditambahkan setelah discovery topologi, bukan mengarang path sekarang.

Worktree sudah mempunyai perubahan lain, termasuk schema docs/seeder dan runtime/test diskon store. Semua perubahan existing milik sesi/pengguna lain harus dipertahankan; audit diff sebelum menulis, jangan overwrite atau memasukkannya ke commit task ini. Tidak ada perubahan runtime pada tahap penyusunan spec.

## 15. Open items dan gate review

### Detail usulan yang harus ikut approval complete spec

1. Draft parsial, dengan field yang diisi tetap valid (§3.2).
2. Seluruh perubahan konfigurasi kode ikut draft; Offer lifecycle tetap aksi operasional eksplisit (§6).
3. Display Rp penuh saat blur, editing buffer lokal saat focus, dan aturan paste (§5.3).
4. Menutup direct policy/code writers pada cutover, bukan mempertahankan bypass (§9.3).
5. Snapshot JSONB bertipe sebagai draft source of truth, projection live existing tetap (§9.1).
6. Layout/reference peer, label, dan state matrix dalam dokumen ini.

### Discovery teknis sebelum handoff implementasi

- Inventarisasi semua caller writer policy/codes dan kebutuhan kompatibilitas eksternal.
- Audit authorizer/receipt/lock code existing untuk ekstraksi feature-first tanpa melemahkan security.
- Finalisasi session repository types dan exact migration/backfill berdasarkan data disposable yang representatif.
- Pastikan seluruh hot readers checkout hanya membaca live projection; tentukan regression assertion store tanpa mengambil alih perubahan worktree lain.
- Tentukan topology/cutover deployment dan file terkait bila perubahan diperlukan.
- Konfirmasi dukungan pagination history; jangan memperluas scope diam-diam.

Item discovery bukan izin mendesain ulang perilaku. Bila hasilnya memerlukan perubahan kontrak/UX/scope, kembali kepada pengguna. Selama complete spec belum disetujui atau keputusan produk masih belum selesai, jangan menandai Ready, memulai implementasi, atau mempublikasikan tiket.

### Penutupan nanti

- [ ] Seluruh AC01–AC20 mempunyai evidence dan limitations yang jujur.
- [ ] Endpoint/feature/schema docs sesuai perilaku baru.
- [ ] Review UX render dan cross-page consistency tercatat.
- [ ] Verification ladder terpenuhi; izin live/remote tetap terpisah.
- [ ] Spec dipertahankan di folder ini; index mendapat status/outcome dan link evidence, bukan status ticket duplikat.
