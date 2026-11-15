# Sesi keputusan: simpan alamat checkout

## Dasar dan batas sesi

- Sumber: [research alur existing](../research/penyimpanan-alamat-sebelum-place-order.md), terutama bagian 3, 5, 6, dan 8.
- Tujuan user: alamat baru terbentuk sebelum place-order; proses place-order tidak lagi menyimpan buku alamat user.
- Sesi menggunakan `grilling` dan `domain-modeling`; keputusan user dicatat per round.
- Dokumen ini bukan spec yang disetujui atau izin implementasi. Tidak ada perubahan kode aplikasi.

## Pohon keputusan

```text
Penyimpanan alamat sebelum place-order
├── D1: pemicu simpan — diputuskan: tombol Simpan dan gunakan
├── D2: semua alamat disimpan atau tetap opsional — diputuskan: selalu simpan
│   ├── D3: koreksi alamat setelah tersimpan — diputuskan: edit row yang sama di checkout
│   └── D4: pilihan alamat utama — diputuskan: checkbox opsional, default tidak dicentang
├── D5: detail tujuan terpilih — requirement tambahan user: card alamat lengkap untuk alamat tersimpan maupun baru
└── Konfirmasi rangkuman — D1–D4 dikonfirmasi user; D5 disampaikan langsung setelah sesi
```

Pertanyaan lanjutan hanya diajukan jika jawaban membuka keputusan yang belum selesai. Perilaku teknis yang dapat diverifikasi dari kode tidak diminta sebagai tebakan user.

## Round 1 — keputusan dasar

| ID | Konteks | Keputusan |
|---|---|---|
| D1 | Saat ini **Gunakan alamat ini** hanya menerapkan draft. Perlu membedakan simpan setelah konfirmasi dari autosave saat form valid. | User memilih **Konfirmasi tombol**: aksi **Simpan dan gunakan**, persistence setelah validasi server sukses; Batal sebelum konfirmasi tidak membuat alamat. |
| D2 | Saat ini **Simpan alamat** opsional. Simpan-selalu berarti alamat tetap ada walaupun checkout ditinggalkan atau pembayaran tidak dilanjutkan. | User memilih **Selalu simpan**: hapus checkbox **Simpan alamat**; setiap penambahan sukses masuk buku alamat meskipun checkout tidak dilanjutkan. |

## Round 2 — konsekuensi alamat langsung tersimpan

| ID | Konteks | Keputusan |
|---|---|---|
| D3 | Koreksi alamat baru setelah create sukses tidak lagi sekadar mengubah draft; perlu menentukan lokasi edit dan apakah row yang sama diperbarui. | User memilih **Edit di checkout**: koreksi alamat baru memperbarui row yang sama, bukan membuat duplikat; ongkir diperiksa ulang. |
| D4 | Opsi **Jadikan alamat utama** sebelumnya bergantung pada checkbox simpan. Perlu menentukan pilihan default pada flow simpan-selalu. | User memilih **Checkbox opsional**: **Jadikan alamat utama** tetap tersedia, default tidak dicentang saat tambah; alamat utama hanya berubah jika dipilih customer. Tidak ada otomatisasi untuk alamat pertama. |

## Tambahan user — card alamat terpilih konsisten

User meminta agar checkout **Kirim ke alamat** selalu menampilkan card detail tujuan yang dipilih, baik alamat dari buku alamat maupun alamat yang baru ditambahkan. Tujuannya mengurangi kesalahan memilih alamat, terutama ketika beberapa alamat memakai nama penerima yang sama.

Fakta kode yang diverifikasi:

- [Pemilih alamat tersimpan](../../../apps/store/src/components/checkout/DeliveryQuotePanel.tsx#L410-L453) memiliki opsi berisi nama penerima dan alamat jalan. Detail pilihan tidak mempunyai card tersendiri seperti cabang alamat baru. Tampilan terpotong yang dilaporkan user belum diperiksa melalui browser.
- [Card alamat baru](../../../apps/store/src/components/checkout/DeliveryQuotePanel.tsx#L470-L488) hanya dirender ketika `readyNewAddress && appliedNewAddress`; menampilkan nama penerima, telepon, alamat, dan kode pos.
- Nama pada blok tersebut adalah **nama penerima**, bukan pengirim. Pengirim adalah origin cabang, tidak berubah karena requirement ini.

**D5 — requirement yang dinyatakan user:**

- Setelah alamat dipilih, tampilkan card detail dengan pola yang sama tanpa membedakan asal alamat tersimpan atau baru.
- Detail tujuan harus terbaca, bukan hanya nama pada dropdown. Usulan isi card untuk blueprint berikutnya: nama penerima, telepon, alamat jalan/lengkap, wilayah tujuan (Kelurahan/Area, Kecamatan, Kota/Kabupaten, Provinsi), dan kode pos; informasi penting tidak dipotong menjadi ellipsis di card. Rincian susunan ini merupakan rekomendasi agent, bukan pilihan field yang sudah ditanyakan satu per satu kepada user.
- Card muncul juga ketika alamat utama terpilih otomatis. Ketika customer memilih alamat berbeda atau berhasil menambah alamat, card mengikuti tujuan aktif, bukan data pilihan sebelumnya.
- Dropdown tetap menjadi pemilih alamat; card menjadi sarana memeriksa pilihan. Tidak ada perubahan desain warna/token atau perluasan aksi edit/hapus yang otomatis disetujui oleh permintaan card ini. Keputusan edit alamat baru D3 tetap berlaku.
- Jika belum ada alamat terpilih atau alamat masih dimuat, jangan menampilkan card yang seolah sudah mempunyai tujuan valid.

Contoh: dua alamat sama-sama atas nama **Kendricko**, tetapi satu di rumah dan satu di kantor. Setelah customer memilih alamat kantor, card memperlihatkan telepon dan alamat kantor lengkap sehingga pilihan bisa diperiksa sebelum **Lanjut**.

Bukti yang dibutuhkan saat implementasi: pemilihan alamat existing, pilihan default otomatis, dan hasil tambah alamat menampilkan detail pada pola card yang sama; mengganti pilihan tidak meninggalkan detail alamat sebelumnya; alamat panjang tetap terbaca pada desktop/mobile. Saat ini belum ada implementasi atau verifikasi browser untuk D5.

## Hal yang tetap dijaga

- Validasi server dan ownership alamat tidak dihilangkan.
- Snapshot pengiriman order tetap diperlukan dan bukan penyimpanan row buku alamat.
- UI mengikuti komponen dan pola existing; keputusan copy/action mengikuti hasil sesi.
- Retry create dan transisi request/attempt lama perlu dibahas dalam rancangan teknis; tidak diasumsikan aman hanya karena tombol submit dinonaktifkan.

## Rangkuman untuk konfirmasi

1. Customer mengisi modal, lalu menekan **Simpan dan gunakan**. Batal sebelum konfirmasi tidak membuat alamat; bukan autosave.
2. Server memvalidasi dan menyimpan alamat saat itu juga, sebelum place-order. Setiap penambahan sukses masuk buku alamat; checkbox **Simpan alamat** dihapus.
3. Checkout memilih alamat hasil simpan dan menggunakannya untuk perhitungan ongkir, review, dan place-order. Alamat tetap ada meskipun customer keluar atau checkout tidak dilanjutkan.
4. Koreksi alamat baru yang sudah disimpan dapat dilakukan di checkout; memperbarui alamat yang sama, bukan insert duplikat, lalu memeriksa ulang ongkir.
5. **Jadikan alamat utama** opsional, default tidak dicentang saat tambah. Menambahkan alamat tidak otomatis mengganti alamat utama.
6. Place-order tidak lagi membuat alamat buku alamat; validasi tujuan dan snapshot pengiriman order tetap dipertahankan.

Tambahan setelah konfirmasi sesi: D5 meminta card alamat lengkap yang konsisten untuk alamat tersimpan dan alamat baru; keputusan ini berasal langsung dari pesan user, bukan jawaban interview yang direka.

### Batas dan evidence yang dibutuhkan

- Tidak mengubah perhitungan uang, pembayaran, stok, provider order, atau snapshot order historis.
- Bukti utama nantinya: alamat sudah dapat dibaca sebelum place-order; Batal tidak membuat row; koreksi tidak menambah row; pilihan default dipatuhi; kegagalan checkout tidak membatalkan alamat yang sudah dibuat; place-order tidak memutasi buku alamat.
- Retry create/update dan transisi request/attempt lama masih memerlukan rancangan teknis dan pemeriksaan fakta environment. Ini bukan pilihan perilaku user yang sudah diputuskan secara diam-diam.
- Validasi telepon alamat versus kelayakan kontak checkout yang berbeda pada research tetap merupakan catatan rancangan; belum ada perubahan aturan global buku alamat yang disetujui.
- Unit/DB/E2E dan review UI diperlukan saat implementasi; belum dijalankan dalam sesi keputusan ini.

## Hasil akhir sesi

User mengonfirmasi rangkuman pada 2026-11-15 melalui `ask_user_question`, memilih **Ya, sudah tepat** sebagai dasar penyusunan spec. Frontier keputusan perilaku tuntas. Konfirmasi ini bukan approval spec atau izin implementasi.

Istilah **Draft Alamat** dan **Alamat Tersimpan** dicatat di [glossary project](../../../CONTEXT.md#alamat-pengiriman-customer); **Alamat Utama** berarti alamat tersimpan yang menjadi pilihan awal pengiriman pada checkout berikutnya. Tidak dibuat ADR baru karena keputusan ini tidak memerlukan dokumen arsitektur terpisah.

## Cakupan sesi → evidence

| Cakupan | Status | Evidence |
|---|---|---|
| Keputusan ditanyakan melalui tool, bukan diasumsikan | Verified | Jawaban `ask_user_question` round 1 (D1/D2), round 2 (D3/D4), dan konfirmasi akhir. |
| Hasil tercatat dalam dokumen dan glossary | Verified | Dokumen sesi ini, index fitur, dan bagian **Alamat Pengiriman Customer** pada `CONTEXT.md`. |
| Kesepahaman akhir dikonfirmasi user | Verified | User memilih **Ya, sudah tepat** atas rangkuman lengkap; bukan approval spec/implementasi. |

Verifikasi di atas hanya mencakup sesi keputusan, bukan implementasi atau pengujian runtime.
