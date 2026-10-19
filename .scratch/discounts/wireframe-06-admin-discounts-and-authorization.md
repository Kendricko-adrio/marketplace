# Wireframe Admin Diskon dan Matriks Authorization

Status: Disetujui pemilik — keputusan planning tiket 06
Sumber: [tiket UX Admin Diskon dan Authorization](issues/06-admin-ux-and-authorization.md)

## 1. Tujuan dan batas

Membuat pengelolaan harga coret, kupon/kode, serta kapasitas promo mudah ditelusuri dan tidak memberikan kewenangan global secara implisit kepada staf cabang. Artefak ini hanya wireframe Markdown dan kontrak authorization; bukan prototype executable, complete implementation spec, atau izin implementasi.

Keputusan Ronde 1–3 dan checkpoint kesepahaman telah dikonfirmasi pemilik melalui `ask_user_question`. Pemilik kemudian menyetujui dokumen lengkap beserta prasyarat view Produk seluruh cabang untuk operasi harga global; bukti approval dicatat di §9.

Tidak membuka kembali kebijakan perhitungan, partial import, reservation, snapshot, retention, atau provider yang sudah disetujui. Tidak membangun approval dua orang, background import job, refund, manual release hold baru, atau targeting produk/kategori/brand.

## 2. Penempatan dan variasi yang direview

Pemilik membandingkan tiga susunan melalui preview Markdown: Produk + Diskon, satu pusat Diskon, dan seluruhnya di Produk. Pilihan final: **Produk + Diskon**. Tujuannya memisahkan adjustment SKU persisten dari offer per order.

```text
Produk
├─ Daftar/detail produk → variant/SKU
├─ Harga coret: ubah / hapus
└─ Bulk / Import Excel / Hasil import

Diskon
├─ Kupon publik
├─ Kode promo
└─ Detail promo → aturan / kode / pemakaian & budget / riwayat
```

Navigasi mengikuti current server policy, bukan nama role. Lokasi menu bukan pemberian permission; izin harga dan promo tidak diwarisi dari permission re-sync Produk.

## 3. Harga coret di Produk

```text
PRODUK > HARGA CORET                 Berlaku untuk semua cabang
Cari SKU / nama                     2 SKU dipilih lintas halaman
[Ubah terpilih] [Import Excel] [Export terpilih] [Hasil import]

Pilih | SKU            | Base Jubelio | Harga website | Target tersimpan
  x   | SHOE-BLACK-42  | Rp300.000    | Rp150.000     | Rp150.000
  x   | SHOE-WHITE-40  | Rp200.000    | Rp200.000     | —

Detail SKU: [Ubah harga coret] [Hapus harga coret] [Riwayat]
```

- Harga coret bukan campaign dan tidak memerlukan tanggal akhir. Tidak ada harga per cabang.
- View Produk biasa tetap mengikuti scope existing; hak melihat stok cabang lain tidak diperluas oleh hak harga global.
- Editor harga global memerlukan cakupan view Produk seluruh cabang untuk memilih/review SKU global, selain izin harga pada matriks §7. Tidak memberikan view Produk seluruh cabang secara otomatis saat memberikan izin harga.
- Harga website dan target tersimpan dibedakan ketika base terbaru membuat Markdown tidak efektif sementara. Menghapus Markdown kembali mengikuti base terbaru.
- Pilihan bulk dipertahankan lintas halaman; tidak otomatis memilih seluruh hasil filter. Batas awal 1.000 SKU mengikuti tiket import.

### Review sebelum apply

```text
REVIEW PERUBAHAN HARGA — 2 SKU — seluruh cabang
Shortcut bulk: 20% dari BASE → menghasilkan harga akhir tetap

SKU           | Base       | Website kini | Target    | Dampak
BLACK-42      | Rp300.000  | Rp150.000    | Rp240.000 | NAIK Rp90.000
WHITE-40      | Rp200.000  | Rp200.000    | Rp160.000 | TURUN Rp40.000

Alasan bisnis (opsional): ___________________
! Apply menggunakan base/Markdown terbaru; target tidak dihitung ulang.
! Harga sukses langsung live per baris; batch bukan transaksi atomik penuh.
[Kembali] [Terapkan 2 SKU]
```

Manual, bulk dan Excel selalu melalui review. Review menunjukkan SKU/variant, base, harga website, target/restore, selisih/persentase hasil, status validasi dan jumlah baris yang diterima. Kenaikan harga tidak disamarkan sebagai diskon tambahan. Restore menyebutkan bahwa Markdown terbaru akan dihapus dan harga mengikuti base terbaru.

Kontrak stale harga tetap mengikuti tiket 01/05: target valid diterapkan dengan data terbaru tanpa wajib review ulang; target invalid gagal per baris. Audit menyimpan sebelum–sesudah aktual saat apply. Ini berbeda dari konflik edit promo di §5.

## 4. Import, progress, error dan retry

```text
IMPORT EXCEL
[Template kosong] [Export SKU terpilih] [Pilih .xlsx]
Template berversi: sku (teks), action, new_price (angka bulat Rupiah)
Action: set_price / restore_base; harga kosong bukan perintah restore.
Batas awal: 1.000 baris data; file 5 MiB; dekompresi 25 MiB.

PREVIEW: 100 baris — 97 valid, 3 invalid
Baris | SKU           | Action       | Target     | Status / alasan
2     | SHOE-BLACK-42 | set_price    | Rp150.000  | Valid
8     | UNKNOWN       | set_price    | Rp120.000  | SKU tidak ditemukan
9     | SHOE-WHITE-40 | set_price    | Rp250.000  | Target ≥ base terbaru
10    | SHOE-RED-39   | set_price    | Rp150.000  | Formula tidak diterima
[Kembali] [Terapkan baris valid]

PROGRESS: 60 diterapkan | 0 tidak berubah | 3 gagal | 37 belum selesai
Jangan tutup hasil sebagai sukses final selama masih ada baris pending.

HASIL FINAL: PARTIALLY APPLIED
97 diterapkan | 0 tidak berubah | 3 gagal | 0 belum selesai
[Laporan hasil] [Download subset gagal untuk diperbaiki]
Batch asal: B-001   Actor: admin terkait   Waktu: ...
```

- Fatal file seperti rusak/header salah/macro/sheet tambahan/melebihi batas menolak seluruh file sebelum perubahan live. Error SKU/harga/formula menggagalkan baris terkait saja; semua baris SKU duplikat gagal.
- Laporan memuat nomor baris, SKU, action, target, status dan alasan error. Tidak berubah bukan perubahan sukses fiktif.
- Setelah koneksi terputus, tampilkan status batch authoritative dan lanjutkan request yang sama untuk baris pending; tidak mengulang sukses atau final gagal.
- Perbaikan subset gagal melalui upload sebagai batch baru, terhubung ke batch asal, lalu preview/apply lagi. File Excel asli tidak diarsipkan; laporan dibentuk dari catatan baris.
- Izin diperiksa lagi saat apply/resume. Izin dicabut menghentikan penulisan berikutnya; baris yang sudah committed tetap dilaporkan, tidak di-rollback seolah seluruh batch batal.

## 5. Form dan revision kupon/kode

```text
DISKON > DETAIL PROMO
Nama: HEMAT AGUSTUS           Jalur: Kode manual (tetap)
Live: Revision 3              Draft perubahan: belum dipublish

[Aturan] [Kode] [Pemakaian & budget] [Riwayat]
Benefit: (persentase barang + cap opsional / nominal barang / subsidi ongkir)
Minimum subtotal barang setelah Markdown: Rp...
Mulai / akhir opsional: ... WIB
Syarat customer: akun store dengan verified email
Kuota: ...    Budget: Rp...    Jatah per akun: 1

[Simpan draft] [Review perubahan]
```

- Satu promo memiliki satu benefit dan satu jalur: kupon publik ATAU kode manual. Kupon publik tidak memiliki kode. Promo manual dapat mempunyai beberapa kode yang berbagi kapasitas dan jatah akun.
- Benefit barang general, bukan targeting SKU/kategori/brand. Subsidi ongkir hanya untuk delivery. Form tidak menawarkan stacking atau benefit kedua.
- Draft tidak mengubah promo live. Review memperlihatkan diff sebelum–sesudah, benefit/syarat, waktu WIB, limit, consumed/hold dan pengaruh pada order baru, lalu **Publish** eksplisit.
- Published revision tidak ditimpa. Order yang telah mendapat hold mempertahankan snapshot meskipun revision dipublish, promo di-pause atau berakhir. Rename/penambahan kode tidak mereset usage.
- Versi stale ditolak: tampilkan bahwa promo berubah, minta muat versi terbaru dan review ulang; tidak ada force-overwrite. Guard ini juga berlaku pada perubahan kapasitas terhadap versi policy terkini.
- Pause menghentikan reservation baru, bukan membatalkan diskon order lama. Offer/kode yang pernah diterbitkan dinonaktifkan/diarsipkan, bukan hard-delete atau dipindah owner agar literal kode dapat digunakan ulang.
- Viewer melihat kode tersamarkan; editor promo melihat literal lengkap. Viewer tidak menerima literal melalui API, export, riwayat atau Audit Log. Identifikasi untuk penelusuran menggunakan ID promo/kode serta label tersamarkan, bukan menyalin literal ke log umum.

### Preview benefit dan satu slot

```text
SIMULASI — tidak menahan kuota/budget
Barang setelah Markdown          Rp450.000
Kupon barang 10%, cap Rp20.000    -Rp20.000
Net barang                       Rp430.000
PPN barang / ongkir / fee         ditampilkan terpisah

Slot aktif: Kupon barang
! Kode manual atau subsidi ongkir memakai slot yang sama, bukan slot tambahan.
```

Tampilkan Markdown, potongan barang, ongkir sebelum subsidi, subsidi merchant, net ongkir, PPN barang dan fee sebagai komponen berbeda. PPN tidak dikenakan pada ongkir/fee menurut keputusan 04. Contoh persentase di atas adalah contoh net barang, bukan total pembayaran final. Preview tidak memberi kesan kuota sudah dipesan. Interaksi checkout customer lengkap tetap menjadi materi acceptance/spec, bukan prototype executable pada tiket ini.

## 6. Pemakaian, budget dan audit

```text
PROMO > PEMAKAIAN & BUDGET — angka ringkasan GLOBAL
Kuota 100      Consumed 90       Hold 10         Tersedia 0
Budget Rp2 jt  Consumed Rp1,8 jt  Hold Rp200 rb   Tersedia Rp0

Hold ambigu: perlu rekonsiliasi; tidak otomatis release karena timeout.
Daftar di bawah dibatasi izin Orders/cabang Anda; tidak sama dengan total global.
Order | Cabang diizinkan | Benefit | Reserved / Consumed / Released
...
[Buka detail order sesuai izin]

RIWAYAT PERUBAHAN
Waktu | Actor | Tindakan | Sebelum → sesudah | Revision/batch terkait
```

- Ringkasan global tidak menampilkan identitas customer/order cabang lain. Daftar dan detail pemakaian memerlukan Orders:view dan scope order yang sesuai; tanpa akses tersebut tidak ada daftar, bukan kebocoran melalui link atau export.
- Held dan consumed dipisahkan. Benefit aktual penuh menentukan budget; tidak ada diskon parsial mengikuti sisa budget. Contoh budget tersisa Rp15.000 tidak dapat membiayai benefit Rp20.000.
- Penurunan limit ditolak jika lebih kecil daripada komitmen consumed + hold yang terkait. Menghapus limit yang memperbesar kapasitas memakai izin kapasitas; minimal salah satu limit global tetap wajib.
- Tidak ada tombol reset pemakaian, release hold paksa, refund, atau retry provider write dari halaman ini. Penelusuran order menggunakan workflow existing beserta guards-nya, bukan bypass kewenangan baru.
- Audit mencatat actor, waktu, target, policy/revision yang digunakan, diff aktual, serta batch asal/retry jika relevan. Alasan bisnis harga opsional sesuai tiket 05. Histori tidak memiliki operasi hapus administratif.
- Histori bisnis pada detail harga/promo mengikuti view modul tersebut. Layar Audit Log umum tetap memerlukan audit_log:view yang mencakup event global; hak view audit saja tidak membuka literal kode yang disamarkan untuk viewer promo.

## 7. Matriks tindakan/permission

Nama berikut adalah **kewenangan logis target spec**, belum module keys atau migration yang sudah dibuat. Bentuk yang diusulkan mengikuti pola view/edit existing, dengan domain harga global, promo global, dan kapasitas promo global; bukan menambahkan string action bebas dari UI. Harga/promo tidak menawarkan own-branch edit. Permission re-sync Produk tetap terpisah.

| Tindakan | Kewenangan wajib | Batas tambahan |
|---|---|---|
| Melihat katalog/harga efektif existing | Products:view sesuai scope existing | Stok/detail Produk tidak melebar lintas cabang |
| Melihat histori harga/hasil batch | Harga:view global + Products:view seluruh cabang | Batch merupakan tindakan global; tidak diekspos ke viewer cabang saja |
| Manual/bulk/import/apply/resume/restore | Harga:edit global + Harga:view + Products:view seluruh cabang | Current policy diperiksa kembali saat mutasi; review sebelum apply |
| Melihat promo, aggregate usage/budget | Promo:view global | Literal kode tersamarkan untuk non-editor |
| Draft/publish benefit/syarat; pause/archive; tambah/nonaktifkan kode | Promo:edit + Promo:view | Tidak otomatis menetapkan/menaikkan kapasitas; stale version ditolak |
| Melihat bidang kapasitas untuk pengelolaan | Kapasitas:view + Promo:view | Ringkasan budget tetap tersedia bagi Promo:view tanpa grant ini |
| Menetapkan kapasitas awal, menaikkan budget/kuota/jatah akun, menghapus limit yang memperbesar kapasitas | Kapasitas:edit + Kapasitas:view + Promo:edit + Promo:view | Izin tambahan, bukan approval dua orang; tanpa ini draft boleh disiapkan, tetapi promo baru belum dapat diluncurkan dengan kapasitas yang belum ditetapkan |
| Menurunkan limit | Promo:edit + Promo:view | Tidak lebih rendah dari consumed + hold terkait; tidak boleh menghapus limit untuk melewati izin kenaikan |
| Melihat literal kode lengkap | Promo:edit + Promo:view | Berlaku juga pada API/export/riwayat; akses Audit Log tetap perlu grant audit jika lewat layar audit |
| Daftar redemption/detail order | Promo:view + Orders:view pada scope order | Tanpa Orders:view hanya ringkasan global, tanpa customer/order lintas akses |
| Melihat Audit Log umum | Audit Log:view dengan cakupan event terkait | Event harga/promo global membutuhkan all-branch audit; kode tetap dibatasi |
| Mengatur grants harga/promo/kapasitas pada role | Roles:edit + Roles:view | Authorization Ceiling, coverage dan self-role protection existing tetap berlaku |

Prasyarat view Produk seluruh cabang untuk operasi harga global diajukan secara eksplisit pada draft dan ringkasan review, kemudian disetujui bersama dokumen lengkap. Prasyarat ini bukan jawaban yang diasumsikan dari Ronde 1–3.

### Default dan ceiling

- System Owner: full access existing, tidak dapat dilemahkan. Default HQ pada seed baru mendapat view/edit harga, promo dan kapasitas, bersama view Produk seluruh cabang yang sudah ada pada default HQ. Default Admin tidak mendapat grants baru ini.
- Ini bukan izin mengubah grants role existing yang telah dikustomisasi atau menjalankan seed/reset. Custom role dapat menerima harga saja, promo tanpa kapasitas, atau kombinasi yang berada dalam Authorization Ceiling pemberi hak.
- Edit memerlukan covering view. Perubahan grants tidak boleh menyelundupkan hak kapasitas melalui edit promo atau hak harga melalui re-sync Produk. Tidak boleh self-escalation.
- Contoh: staf mempunyai Promo:view/edit tetapi tidak Kapasitas:edit. Ia boleh menyusun revisi benefit dan publish dengan limit yang tidak diperbesar; menaikkan budget Rp1 juta → Rp10 juta ditolak server. Membuat promo baru tidak boleh menghindari pemeriksaan penetapan kapasitas awal.
- Menu/tombol hanya affordance; URL langsung, API, export dan resume harus menggunakan current server policy yang sama. Kegagalan pemuatan policy tidak memakai fallback hak lama.

## 8. Walkthrough dan bukti acceptance untuk spec berikutnya

| Kasus | Hasil yang dapat diamati |
|---|---|
| Base Rp300.000, website Rp150.000, shortcut bulk 20% | Review target Rp240.000 dan label kenaikan Rp90.000 sebelum apply |
| Import 100 baris, 97 sukses/3 gagal | Hasil partial akurat, alasan tiap error, download subset gagal; retry tidak mengulang 97 sukses |
| Koneksi apply putus | Status belum final; resume memakai batch sama dan tidak menduplikasi baris committed |
| Izin harga dicabut ketika batch berjalan | Penulisan berikutnya ditolak; hasil committed tetap bisa ditelusuri oleh pihak berwenang |
| Viewer promo membuka kode/API/export/audit | Tidak memperoleh literal kode; pengelola yang berwenang dapat melihat lengkap |
| Viewer promo hanya punya Orders:view cabang Jakarta | Ringkasan promo global terlihat; daftar/detail tidak membuka customer/order Bandung |
| Consumed 90 + hold 10 dari kuota 100 | Tersedia 0; kuota menjadi 95 ditolak |
| Pengelola tanpa izin kapasitas menaikkan budget | UI menunjukkan keterbatasan; direct API juga menolak dan tidak mengubah kapasitas |
| Draft benefit diedit, belum publish | Promo live tetap revision lama; review diff tersedia sebelum publish |
| Dua admin mengedit promo yang sama | Submit stale ditolak; tidak menimpa hasil admin pertama |
| Publish/pause setelah order mendapat hold | Order lama dan usage tetap; tidak ada reset atau repricing snapshot |
| Simulasi kupon lalu benefit ongkir | Penjelasan satu slot jelas; bukan janji dua benefit aktif atau reservation dari preview |

Seams yang diusulkan untuk complete spec: Playwright browser/HTTP untuk alur dan authorization; transaksi PostgreSQL nyata untuk edit-versus-reserve, capacity guards dan retry batch; contoh nominal literal independen untuk preview/perhitungan. Ini desain acceptance, bukan penulisan atau eksekusi tests sekarang. Bukti Jubelio tetap terpisah. Status terkini mengikuti kontrak09 dan [koreksi scope pemilik](decision-zero-payment-and-no-service-fee.md): website tanpa service fee; pembuktian pembayaran/provider Rp0 dicoret, bukan launch gate. Penyebutan komponen fee pada wireframe bukan izin mengenakan service fee.

## 9. Approval dan referensi

Pemilik menyetujui dokumen lengkap melalui `ask_user_question` dengan memilih **Setuju, tutup 06 (Recommended)** setelah menerima link reviewable, ringkasan cakupan, dan penjelasan eksplisit prasyarat view Produk seluruh cabang untuk operasi harga global. Tidak ada frontier keputusan tersisa pada tiket 06. Approval hanya menyelesaikan keputusan UX/authorization tiket 06; tidak menyetujui complete implementation spec, tidak menutup tiket 12, dan tidak mengizinkan implementasi/provider request/commit/deployment.

Verifikasi dokumen: pemeriksaan link lokal tidak menemukan target hilang; code fences berpasangan dan tidak ditemukan trailing whitespace. `git diff --check` tiket tidak menemukan error whitespace; warning LF/CRLF bukan kegagalan test. Pemeriksaan link menggunakan Node.js setelah Python lokal ternyata tidak tersedia. Tidak ada implementation tests, build/lint/typecheck, provider request atau perubahan aplikasi/schema.

Referensi yang diperiksa:

- [Sidebar existing](../../apps/admin/src/components/AdminSidebar.tsx).
- [Daftar Produk existing](../../apps/admin/src/app/admin/products/page.tsx).
- [Permission catalog existing](../../packages/db/src/rbac/catalog.ts), [schema RBAC](../../packages/db/src/schema/rbac.ts), [default roles](../../packages/db/src/rbac/seed-defaults.ts).
- [Schema Audit Log](../../packages/db/src/schema/system.ts).
- [Kontrak bulk/Excel](issues/05-bulk-adjustment-and-partial-import.md), [limits/reservation](issues/03-redemption-limits-identity-and-reservations.md), [PPN/subsidi](issues/04-tax-and-shipping-subsidy-accounting.md).
- [Logical schema/retention](contract-11-schema-retention-and-extensibility.md), [provider/settlement](contract-09-provider-representation-and-settlement.md).
