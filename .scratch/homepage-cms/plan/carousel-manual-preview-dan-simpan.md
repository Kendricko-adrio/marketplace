# Spec: Preview manual dan perbaikan Simpan carousel produk

## Masalah

Admin yang membuat `carousel_product` melihat **Pilih Produk Manual** sebagai mode default. Saat langsung memilih produk dan menyimpan, form tidak mengirim `content.mode`, sehingga API mengembalikan HTTP 400 sebelum menulis data. [Investigasi](../research/carousel-manual-save.md) mereproduksi kegagalan tersebut pada validator lokal. Mode manual juga belum punya preview di dalam form. Modal **Preview Section** sudah ada, tetapi lookup manualnya hanya memeriksa daftar 100 produk pertama, sehingga produk dari halaman lain bisa hilang dari modal.

## Solusi

Tambahkan **Preview Produk Pilihan** di bawah **Urutan Tampil** pada form buat dan edit. Gunakan kartu yang sama dengan **Filter Otomatis**. Preview mengikuti pilihan dan urutan draft, tidak bergantung pada halaman pencarian, dan tidak memerlukan Simpan. Saat submit manual, kirim `content.mode: "manual"` dan ID dalam urutan pilihan. API tetap menjadi sumber validasi dan penyimpanan.

## Cerita pengguna

1. Sebagai admin, saya ingin langsung melihat kartu produk yang saya pilih agar tahu seperti apa carousel sebelum menyimpannya.
2. Sebagai admin, saya ingin Celana dari halaman 1 dan Kaos dari halaman 3 tetap muncul meski saya mencari produk lain, agar bisa membandingkan semua pilihan.
3. Sebagai admin, saya ingin kartu berpindah saat Kaos digeser ke atas dan hilang saat pilihan Kaos dibatalkan, agar preview mengikuti urutan yang akan disimpan.
4. Sebagai admin, saya ingin bisa menyimpan dari mode manual default tanpa harus mengganti mode terlebih dahulu.
5. Sebagai admin yang membuka kembali section, saya ingin melihat pilihan tersimpan dengan urutan semula tanpa harus mencari ulang produknya. Saat membuka modal **Preview Section**, produk dan urutannya harus sama dengan preview di form.
6. Sebagai admin, saya ingin tahu jika kartu gagal dimuat tanpa kehilangan pilihan atau urutannya.

## Keputusan implementasi

- ID terpilih adalah sumber kebenaran untuk keanggotaan dan urutan. Gunakan data yang sudah diterima dari picker; simpan data produk terpilih selama sesi form agar pagination dan pencarian tidak menghapus kartunya. Untuk pilihan tersimpan yang belum punya data kartu, gunakan lookup per ID pada API detail produk yang sudah ada, tetap tunduk pada izin **products:view** dan cakupan cabang. Batasi konkurensi lookup dan abaikan respons yang tidak lagi relevan. Urutkan hasil berdasarkan ID pilihan, bukan urutan respons. Reorder tidak memicu lookup ulang.
- Inline dan modal manual memakai hasil resolusi yang sama; ganti lookup list `limit=100` khusus modal manual. Jangan membuat endpoint baru atau memindai katalog untuk mengisi preview. Jangan memakai metadata section untuk menampilkan kartu produk yang gagal dicek cakupan aksesnya.
- Normalisasi mode yang tidak ada menjadi `manual` pada payload form create/edit, termasuk konten manual lama, tanpa menghapus field manual lain yang sah. Nilai mode tidak valid tidak diam-diam diterima oleh API. Mode filter tetap mengirim filter dan limit serta mengosongkan ID manual saat simpan. Tidak ada perubahan validator, schema, atau format junction table.
- Preview menggambarkan **pilihan editor**, bukan jaminan setiap produk tayang. Aturan kelayakan storefront tetap berlaku. Produk yang gagal dimuat tidak dihapus dari draft, tidak menjadi kartu kosong, dan tidak menambahkan validasi Simpan baru.

## Kriteria penerimaan

| ID | Perilaku yang dapat diamati |
| --- | --- |
| AC-01 | Form create dan edit menampilkan blok **Preview Produk Pilihan** di bawah **Urutan Tampil** saat mode manual. Saat belum ada pilihan tampil petunjuk singkat; memilih atau membatalkan pilihan langsung menambah atau menghapus kartu. |
| AC-02 | Pilih produk dari dua halaman, cari produk yang tidak ada di halaman awal, lalu kosongkan atau ubah pencarian. Pilihan tetap ada, pencarian kembali ke halaman 1, dan preview tetap memuat kedua kartu. Setelah reorder, urutan inline dan modal sama, termasuk produk di luar 100 hasil awal. |
| AC-03 | Di section baru, pilih dua produk dan klik **Simpan** tanpa menyentuh mode. POST menerima `mode: "manual"` dan ID dalam urutan draft; API sukses. Buka kembali edit: pilihan dan urutan tetap sama, dan kartu muncul tanpa mencari produknya ulang. Edit manual lama tanpa `mode` juga bisa disimpan melalui PATCH. |
| AC-04 | Lookup lama yang masih berjalan tidak menghidupkan kembali produk yang sudah dilepas. Jika satu produk gagal dimuat, kartu lain tetap terlihat, UI menjelaskan kegagalan, dan pilihan serta urutan tidak berubah. Ulangi lookup yang gagal lewat **Coba lagi** untuk kegagalan sementara. Produk di luar izin tidak ditampilkan. |
| AC-05 | Mode **Filter Otomatis** tetap menampilkan preview filter, menghormati limit, dan menyimpan tanpa pilihan manual. Mode manual tetap memakai aturan izin, status section, feedback submit, dan navigasi sukses existing. |
| AC-06 | Di viewport desktop dan sempit, kartu dapat digulir di area carousel tanpa overflow halaman. Checkbox, kontrol urutan, dan tombol retry dapat dipakai dengan keyboard, fokus terlihat, dan perubahan status preview tidak memindahkan fokus. |

## Blueprint teknis

| Path dari root repo | Aksi / layer | Tanggung jawab | Seam uji |
| --- | --- | --- | --- |
| `apps/admin/src/components/admin/homepage/HomepageSectionForm.tsx` | Ubah / UI | Normalisasi payload; gunakan hasil resolusi manual yang sama untuk inline dan modal. | Form create/edit, POST/PATCH dan pembukaan ulang |
| `apps/admin/src/components/admin/homepage/CarouselProductSectionForm.tsx` | Ubah / UI | Integrasikan data picker yang sudah dimuat dan tampilkan kartu, status, serta retry dalam mode manual. | Pilih, cari, pindah halaman, reorder, batalkan pilihan |
| `apps/admin/src/app/api/admin/products/[id]/route.ts` | Reuse / HTTP | GET detail produk untuk pilihan yang belum dimuat; tidak mengubah kontrak atau izin existing. | Produk tersimpan di luar hasil awal; hasil tidak tersedia |
| `packages/ui/src/components/homepage/CarouselProductSection.tsx` | Reuse / UI shared | Pakai renderer existing dengan `preview`; tidak ubah komponen storefront. | Urutan dan tampilan kartu di browser |
| `e2e/admin/homepage-form-layout-mock.spec.ts` | Perluas / Playwright | Tambah skenario carousel dalam seam form Homepage CMS yang sudah terdaftar di mock suite. | AC-01 sampai AC-05; keyboard/viewport AC-06 |
| `docs/features/homepage-cms.md` | Ubah setelah verifikasi / dokumentasi | Dokumentasikan alur preview manual dan bedanya dengan kelayakan tayang di storefront. | Review perubahan dokumentasi |

Kontrak internal form: daftar `selectedProductIds: string[]` tetap berurutan. Editor dan modal menerima kartu `HomepageProduct[]` yang sudah diurutkan, status lookup, dan aksi retry untuk kegagalan sementara. `HomepageSectionForm` tetap menyerahkan payload ke `onSubmit`; kontrak HTTP `POST /api/admin/homepage` dan `PATCH /api/admin/homepage/{id}` tidak berubah. Tidak perlu kontrak export publik baru.

## Blueprint UX

**Referensi:** blok preview **Filter Otomatis** pada `apps/admin/src/components/admin/homepage/CarouselProductSectionForm.tsx`, termasuk kartu preview yang tidak menavigasi keluar dari form. Urutan konten: **Cari Produk → hasil dan pagination → Urutan Tampil → Preview Produk Pilihan**. **Simpan** tetap aksi utama; **Preview Section** dan **Coba lagi** tetap sekunder. Gunakan kartu, indikator, tombol, dan token existing.

| State | Tampilan dan tindakan |
| --- | --- |
| Kosong | **Preview Produk Pilihan** — “Pilih produk untuk melihat preview carousel.” |
| Loading | Indikator visual dan “Memuat preview produk…” hanya saat ada pilihan yang perlu lookup; kartu yang sudah siap tetap terlihat. |
| Siap / belum disimpan | Kartu sesuai urutan draft; “Preview mengikuti pilihan dan urutan saat ini.” Tidak ada toast untuk setiap perubahan. |
| Error sementara | “Sebagian atau seluruh preview produk gagal dimuat.” dan **Coba lagi**; jangan hapus pilihan. |
| Tidak tersedia / tidak bisa diakses | “Preview tidak tersedia untuk sebagian atau seluruh produk yang dipilih.” Jangan mengungkap alasan khusus untuk ID di luar cakupan. Akses form dan Simpan tetap mengikuti izin existing. |
| Submit | Pola pending, sukses, dan gagal existing; cegah submit ganda seperti sekarang. Kegagalan Simpan tidak menghapus draft. |

Picker tetap menggunakan pencarian backend berdasarkan nama/slug atas katalog yang boleh diakses, 10 hasil per halaman, urutan katalog existing (terbaru dulu), total dan pagination existing. Mengubah pencarian mengembalikan ke halaman 1. Pencarian dan halaman tetap state lokal; tidak menambah parameter URL atau mengubah cakupan data. Preview bukan sumber data picker. Verifikasi desktop dan viewport sempit sekitar 390 px; horizontal scroll hanya di dalam carousel. Status loading/error dapat diumumkan tanpa merebut fokus; tombol urutan mempunyai nama yang bisa dibaca pembaca layar. Tidak ada prototype terpisah.

## Strategi pengujian

- Seam utama: alur browser form create/edit. Mulai dari regresi Simpan default tanpa mengganti mode; buktikan payload serta persistensi menggunakan route create/update/read asli pada lingkungan mock terisolasi. Untuk pencarian lintas halaman dan respons lookup terlambat/gagal, gunakan fixture deterministik; jangan bergantung pada posisi produk di katalog dev. Buat minimal satu pilihan tersimpan di luar 100 hasil awal.
- Gunakan pengujian perilaku, bukan snapshot JSX atau state internal. Suite `apps/admin/src/lib/homepage-content.test.ts` tetap menjadi regresi kontrak validator; lulusnya validator saja tidak membuktikan form mengirim payload yang benar.
- Verifikasi saat implementasi: `npm run verify:types:admin`; jalankan unit terfokus untuk logic yang berubah, lalu final `npm run test:unit` dan `npm run verify:batch:e2e -- e2e/admin/homepage-form-layout-mock.spec.ts`. Review browser dengan pembanding mode filter, termasuk desktop, viewport sempit, dan keyboard. Catat bukti per AC setelah dijalankan. Legacy E2E memerlukan izin terpisah.

## Di luar scope

Redesign picker atau modal, perubahan aturan produk boleh tayang, perubahan permissions atau aturan filter/limit, perubahan schema/API publik, migrasi data, perubahan konfigurasi deployment, dan deploy. Perubahan cukup melalui rilis admin normal; tidak perlu DB sync atau konfigurasi baru.

## Approval

- Scope draft dikonfirmasi di percakapan: preview manual lintas halaman yang mengikuti urutan, sekaligus perbaikan Simpan. Penyelarasan modal memastikan dua preview manual tidak saling bertentangan.
- Approval atas blueprint, seam uji, dan AC-01–AC-06: user menyetujui draft lengkap di percakapan (“oke approve specnya”).
- Implementasi selesai 2026-11-18. Approval ini tidak mencakup delegasi, commit, atau deploy.

## Bukti verifikasi (2026-11-18)

| AC | Bukti | Status |
| --- | --- | --- |
| AC-01 | E2E `e2e/admin/homepage-carousel-manual-mock.spec.ts` "picks across picker pages…": blok preview kosong di awal, kartu muncul saat dipilih, dan hilang saat pilihan dibatalkan. Review render: `playwright/mcp/carousel-review/manual-preview.png`. | Verified |
| AC-02 | Spec yang sama: dua produk dari halaman 2 picker (di luar halaman awal), dengan pencarian lain di antaranya; preview tetap memuat keduanya, dan tombol "Naikkan urutan" mengubah urutan preview maupun baris "Urutan Tampil". | Verified |
| AC-03 | Spec yang sama: "Buat Section" dari mode default → `GET /api/admin/homepage/{id}` menunjukkan `content.mode === "manual"` dan `products` sesuai urutan draft; halaman edit menampilkan kartu tanpa mencari. Unit: `apps/admin/src/lib/homepage-content.test.ts` (5 kasus normalisasi). | Verified |
| AC-04 | Spec "a temporary lookup failure keeps the pick and recovers on retry": respons 500 pada satu lookup → pesan "Sebagian atau seluruh preview produk gagal dimuat." + **Coba lagi**, pilihan dan urutan tetap; setelah retry kartu kembali. Pilihan yang dibatalkan tidak dihidupkan lagi oleh lookup lama karena kartu dirender dari urutan ID. Pemetaan 403/404 ke pesan "tidak tersedia" diuji unit di `carousel-manual-preview.test.ts`. | Verified |
| AC-05 | Spec "filter mode keeps its own preview and saves without manual picks": blok preview filter tetap tampil, section tersimpan dengan `mode === "filter"` dan junction kosong. | Verified |
| AC-06 | Spec "fits a narrow viewport…": viewport 390×844, `documentElement.scrollWidth ≤ clientWidth`, tombol urutan memakai `aria-label` dan dapat difokus. Review visual: `playwright/mcp/carousel-review/manual-preview-narrow.png`. | Verified |

Gate yang dijalankan: `npm run verify:types:admin` (lulus), `npm run lint:admin` (0 error; warning pre-existing), `npm run test:unit` (2282 test lulus; 9 file `*.db.test.ts` gagal karena guard `DATABASE_URL` mewajibkan DB disposable `marketplace_discounts_test_*` — prasyarat environment, bukan perubahan ini), dan `npm run verify:batch:e2e -- e2e/admin/homepage-carousel-manual-mock.spec.ts` (4/4 lulus).

Keterbatasan: kartu yang dihidrasi dari `GET /api/admin/products/{id}` tidak membawa label gender/collection karena endpoint detail hanya mengembalikan `genderId`; baris picker tetap menampilkan label tersebut. Preview filter dengan produk pada server dev manual tidak dapat diperiksa karena store dev server tidak berjalan saat review (proxy 500, perilaku pre-existing); E2E mock dengan store + admin berjalan membuktikan blok filter tampil dan penyimpanan filter.
