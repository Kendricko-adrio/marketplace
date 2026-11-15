# Prototype Admin Diskon & Harga Coret

Prototype executable **lokal dan terpisah** untuk menilai satu desain admin yang
mengikuti keputusan [wireframe tiket 06](../wayfinder/wireframe-06-admin-discounts-and-authorization.md).
Bukan halaman dokumentasi statis: semua alur penting bisa diklik dan memberi
feedback.

Scope ini disetujui pemilik sebagai **prototype executable standalone** pada sesi
tindak lanjut — bukan implementasi fitur, bukan complete implementation spec, dan
bukan penutupan/implementasi tiket 12. Tidak ada kode app/config/schema/seed yang
berubah; seluruh perilaku di bawah hanya simulasi front-end.

Bukan bagian aplikasi Next.js. Tidak ada route, auth, config, schema, seeder,
API, database, atau provider yang disentuh. **Semua data adalah mock dan seluruh
state hanya ada di memori** — reload atau tombol **Reset demo** mengembalikan
data awal.

## Feedback pemilik — arah fungsi sesuai, style belum final

Pemilik menyukai functionality/alur prototype sejauh ini, tetapi menilai beberapa tone warna dan style belum sama dengan web existing. Pada iterasi berikutnya atau implementasi yang disetujui terpisah, pertahankan arah alur dan samakan visual dengan admin existing, bukan menjadikan CSS pendekatan prototype sebagai acuan final.

Acuan visual: token/theme pada `apps/admin/src/app/globals.css`, komponen shared pada `packages/ui/src/components/ui/`, serta typography, spacing, card/box, border, shadow, button, tabel dan state pada halaman admin existing. Pada implementasi aplikasi, gunakan komponen/theme existing secara langsung, bukan menyalin perkiraan tampilannya.

Feedback ini bukan approval visual final, complete implementation spec atau izin implementasi fitur. Tidak ada perubahan runtime prototype pada pencatatan feedback ini.

## Menjalankan

```bash
node .scratch/discounts/prototype/server.mts
```

Buka <http://127.0.0.1:3016>.

- Port lain (opsional): `node .scratch/discounts/prototype/server.mts 3017`.
- Hentikan dengan `Ctrl+C`; start sendiri dengan perintah di atas.
- Launcher membaca `app.ts` sekali saat startup lalu menyimpannya sebagai
  `/app.js`. Setelah `app.ts` diubah, hentikan server (`Ctrl+C`) dan start ulang;
  reload browser saja tidak cukup.
- Node lokal harus mendukung type stripping dan `module.stripTypeScriptTypes`
  (mesin ini: Node v24.14.0). Parent sudah menjalankan launcher ini di mesin
  lokal; writer tidak menjalankan server.
- Tidak ada dependency, build, atau tooling framework. Hanya server HTTP bawaan
  Node yang menyajikan `index.html`, `styles.css`, dan `app.ts` (di-strip menjadi
  `/app.js`).

## Peta layar

| Layar | Isi |
|---|---|
| **Produk** (layar awal) | 100 SKU mock: base Jubelio, harga website dengan harga coret, target tersimpan, status Markdown, checkbox SKU, search, aksi manual/bulk/restore/import, dan bagian terpisah untuk target nonaktif. |
| **Import & batch** | Import **simulasi**: tombol contoh 100 baris (bukan parsing `.xlsx`), preview 97 valid/3 invalid, progress + simulasi koneksi terputus, resume, hasil partial, CSV laporan gagal, retry subset sebagai batch B002. |
| **Diskon** | Daftar promo dengan tab **Kupon publik** dan **Kode promo** terpisah; satu benefit per promo; kode dimask untuk persona tanpa `Promo:edit`. |
| **Detail promo** | Tab Aturan (draft → review diff → publish), Kode (tambah/nonaktifkan), Pemakaian & budget (hold vs consumed, kapasitas), Riwayat (audit). |
| **Simulasi biaya** | Komponen finansial terpisah untuk kupon barang bercap dan subsidi ongkir; input bisa diubah dan total dihitung ulang. |
| **Riwayat & audit** | Audit actor, waktu, tindakan, sebelum → sesudah, revision/batch. |

Sidebar dan header meniru admin existing (sidebar 256px, header 64px, background
`#F3F4F4`, card putih, border tipis, radius 8px, shadow-sm, font Inter + system
fallback tanpa fetch font eksternal). Menu admin lain yang tidak disimulasikan
ditampilkan **disabled** beserta alasannya.

## Skenario yang disimulasikan (angka kontrak)

1. **Bulk 20% dari base.** Centang `SHOE-BLACK-42` (base Rp 300.000, website
   Rp 150.000) → *Ubah massal* → 20% → review menampilkan target **Rp 240.000**
   dan dampak **NAIK Rp 90.000**. Apply mengubah memori dan menulis audit
   sebelum → sesudah.
2. **Manual & restore.** Target manual valid hanya jika `0 < target < base`;
   restore selalu lewat review dan menyebutkan Markdown terbaru dihapus.
3. **Target nonaktif.** `JACKET-OLIVE-M` punya base Rp 150.000 dan target
   tersimpan Rp 200.000: harga website mengikuti base, target ditampilkan
   terpisah dengan status nonaktif.
4. **Import partial.** Contoh 100 baris: baris 8 `UNKNOWN-SKU-404` (SKU tidak
   ditemukan), baris 9 `SHOE-WHITE-40` target Rp 250.000 ≥ base Rp 200.000,
   baris 10 formula `=B2*0.8`. Apply berhenti pada baris ke-60 (koneksi
   disimulasikan terputus), resume melanjutkan tanpa mengulang 60 baris sukses,
   hasil final **PARTIALLY APPLIED: 97 diterapkan / 0 tidak berubah / 3 gagal /
   0 belum selesai**. Retry 3 baris gagal → **B002** terhubung ke **B001**.
   Apply juga memeriksa ulang `Harga:edit` sebelum setiap baris: bila persona
   berganti saat batch berjalan, penulisan berhenti dengan alasan izin (bukan
   pesan koneksi), jumlah baris committed ditampilkan apa adanya, dan audit
   penyelesaian memakai actor yang memulai/meresume apply — bukan persona
   penonton. Resume hanya melanjutkan baris tersisa, tanpa menduplikasi.
5. **Draft → review → publish.** Edit aturan promo, simpan draft (live tetap
   revision 3), review menampilkan diff, publish menaikkan revision menjadi 4.
6. **Stale conflict.** Tombol *Simulasikan admin lain mengubah promo* menaikkan
   revision di "server" simulasi. Review berikutnya **ditolak** dan hanya
   menawarkan *Muat versi terbaru*; tidak ada tombol force-overwrite.
7. **Pause.** Pause menghentikan reservation baru; consumed/hold dan snapshot
   order lama tidak berubah.
8. **Kapasitas.** Kuota 100 / consumed 90 / hold 10 → tersedia 0; budget
   Rp 2.000.000 / consumed Rp 1.800.000 / hold Rp 200.000 → tersedia Rp 0.
   HQ menurunkan kuota ke 95 → **ditolak** (di bawah komitmen 100). Menaikkan
   budget → diterima.
9. **Kode & scope order.** Persona **Viewer Orders Jakarta** melihat kode
   tersamarkan dan daftar pemakaian hanya cabang Jakarta; ringkasan kuota/budget
   tetap global. **Pengelola tanpa kapasitas** bisa menyusun draft tetapi field
   kapasitas read-only.
10. **Satu slot & komponen biaya.** Kupon barang 10% cap Rp 20.000: barang
    Rp 450.000 → net Rp 430.000, PPN 11% Rp 47.300, ongkir Rp 30.000, fee Rp 0 →
    total **Rp 507.300**. Subsidi ongkir: barang Rp 150.000, ongkir Rp 30.000,
    subsidi Rp 20.000, PPN Rp 16.500 → total **Rp 176.500**. Preview diberi
    label "tidak menahan kuota/budget".

## Persona simulasi

| Persona | Role | Cabang | Kewenangan (simulasi UI) |
|---|---|---|---|
| Rani Putri | HQ | Semua cabang | Harga edit, promo edit, kapasitas edit, semua order |
| Dedi Saputra | Admin | Bandung | Promo edit; tanpa harga edit dan tanpa kapasitas |
| Sari Wulandari | Admin | Jakarta | Read-only promo; Orders hanya Jakarta; kode dimask |

Persona hanya menggerakkan affordance UI. Ini **bukan bukti RBAC atau otorisasi
server** — pada implementasi sebenarnya menu/tombol bukan penentu izin; current
server policy yang menentukan, dan direct API/export/resume harus memakai
pemeriksaan yang sama.

## Batasan, keamanan, dan hal yang sengaja palsu

- **Mocked codes tetap ada di source.** Literal kode (`HEMATFIX25`,
  `ONGKIRHEMAT`, `HEMATFIX25LAMA`) tertulis di `app.ts`. Penyamaran untuk
  persona viewer hanyalah kosmetik di browser; siapa pun yang membuka source
  atau DevTools bisa melihatnya. **Bukan mekanisme keamanan** dan tidak
  membuktikan bahwa API tidak membocorkan kode.
- **Tidak ada upload/parser `.xlsx`.** Tombol "Pilih file .xlsx" dan "Template
  kosong" sengaja disabled. "Muat contoh 100 baris" hanya membangun 100 baris
  mock di memori.
- **Laporan CSV itu CSV.** File yang diunduh bernama `laporan-gagal-B001.csv`,
  dibuat di browser dari state mock. Bukan `.xlsx`, bukan arsip file asli, bukan
  bukti laporan server.
- **Tidak ada penulisan nyata.** Tidak ada DB, API, queue, provider, auth,
  cookie, localStorage, atau service worker. Reload = reset.
- **Server hanya menyajikan halaman ini.** Allowlist path (`/`, `/index.html`,
  `/styles.css`, `/app.js`), bind `127.0.0.1`, hanya GET/HEAD, tanpa akses folder
  parent, env, atau proxy. CSP memblokir resource eksternal (`connect-src 'none'`,
  `worker-src 'none'`).
- **Tidak ada klaim keamanan atau performa.** Batas 1.000 baris/5 MiB bukan hasil
  benchmark; prototype hanya memperagakan alurnya.
- **Navigasi internal saja.** Tidak ada link ke store/admin/provider nyata, tidak
  ada request keluar.
- **Elemen non-fungsional disabled.** Menu admin lain, export `.xlsx`, upload,
  notifikasi, dan detail order memakai `disabled` + tooltip alasan.

## Yang tidak disimulasikan

Checkout customer, perhitungan pajak/provider sungguhan, release hold/refund,
approval dua orang, background import job, targeting produk/kategori/brand,
rate limiting/anti-abuse, dan penegakan izin di server.

## File

| File | Isi |
|---|---|
| `index.html` | Shell halaman (root, modal root, toast root) + favicon SVG inline tanpa file aset. |
| `styles.css` | Token & komponen visual yang meniru admin existing. |
| `app.ts` | Seluruh state mock, fixture, render, dan interaksi. |
| `server.mts` | Launcher HTTP lokal dengan allowlist dan CSP. |
| `README.md` | Dokumen ini. |

Satu seam saja: satu pengalaman browser, satu store state di memori, satu
launcher. Tidak ada variasi desain ganda dan tidak ada framework.

## Perbaikan setelah review parent

Dua P1 dan empat P2 yang diterima sudah diperbaiki di `app.ts` dan `styles.css`.
Writer tidak menjalankan validasi; parent sudah browser smoke di Chromium lokal
dan recheck reviewer menyatakan tidak ada P1/P2 tersisa. Rincian observasi ada di
§Validasi di bawah.

1. **Chip Orders benar.** Ketiga persona punya `Orders:view`, jadi chip selalu
   tersedia (`✓`) dengan label scope: `Orders semua cabang` untuk HQ dan
   `Orders <cabang>` untuk persona cabang.
2. **Apply mengikuti current policy.** Interval apply memeriksa `Harga:edit`
   sebelum setiap baris dan berhenti bila berubah; `haltReason` membedakan
   `permission-revoked` dari `simulated-disconnect`, sehingga UI tidak
   mengklaim "koneksi terputus" ketika penyebabnya izin. Angka yang ditampilkan
   adalah jumlah aktual (diterapkan/belum selesai), baris committed tidak
   di-rollback, dan audit batch memakai `applyActor` (aktor yang memulai atau
   meresume apply), bukan persona yang sedang menonton.
3. **Reload versi terbaru tidak lagi merah.** `Muat versi terbaru` membersihkan
   `staleNotice`; hasilnya disampaikan lewat toast sukses yang sudah ada.
4. **Shell tanpa asumsi tinggi banner.** `#root` mengisi tinggi viewport, banner
   memakai tinggi naturalnya (boleh wrap), lalu sisa ruang dipakai sidebar dan
   area konten. Sidebar + kartu user terlihat penuh di desktop, sementara nav
   dan area konten punya scrollbar internal sendiri; di mobile layout kembali ke
   alur halaman biasa.
5. **Token visual existing.** Brand `Panel` memakai `primary`; `--destructive`
   `0 84.2% 60.2%` dengan foreground `60 9.1% 97.8%`; `alert-error` memakai
   token tersebut dan `foreground`, bukan merah baru.
6. **Density card existing.** Desktop memakai padding kartu 24px dan judul
   24px/600 mengikuti `packages/ui` card; di layar kecil judul dan padding
   dikecilkan agar tetap rapi.

## Validasi — smoke parent (bukan automated suite)

Writer **tidak menjalankan** command validasi apa pun: tidak ada server, browser,
curl, test, build, lint, atau typecheck. Semua observasi di bawah dilakukan parent
memakai Chromium yang sudah terpasang di mesin (cache Playwright) karena browser
MCP Chrome tidak tersedia; tidak ada instalasi browser/dependency baru, dan
observasi ini bukan automated test suite.

- [x] Server `node .scratch/discounts/prototype/server.mts` start; `GET /` dan aset utama 200, `HEAD` 200, `POST` 405, `/.env` `/app.ts` `/server.mts` dan encoded traversal 404.
- [x] Desktop 1440x1000: `sidebarBottom` 1000 (kartu user + chip terlihat penuh); card putih radius 8px, padding 24px, judul 24px.
- [x] Chip sidebar HQ benar (`✓ Orders semua cabang`).
- [x] Produk/bulk: 20% → target Rp 240.000 / NAIK Rp 90.000 → apply berhasil; restore berhasil.
- [x] Import: 60/0/3/37 → resume → ganti persona viewer menghentikan apply tanpa audit "selesai" → kembali HQ → resume → 97/0/3/0; audit selesai atas nama Rani.
- [x] Unduhan `laporan-gagal-B001.csv` berhasil; B001 PARTIALLY APPLIED 97/0/3/0 dan B002 (linked B001) APPLIED 3/0/0/0.
- [x] Draft live revision 3 → publish → header "Live: Revision 4".
- [x] Stale conflict: review ditolak lalu `Muat versi terbaru` → 0 `alert-error`.
- [x] Kapasitas: kuota 95 ditolak, budget Rp 3.000.000 diterima.
- [x] Persona manager: field kapasitas disabled, draft tetap enabled.
- [x] Persona viewer: kode dimask, daftar order hanya Jakarta.
- [x] Simulasi biaya: Rp 507.300 dan Rp 176.500.
- [x] Mobile 390x844: `docWidth` 390, dialog x 8..382 / bottom 643.7, tutup dialog berhasil.
- [x] Banner wrap 1024x768: tinggi banner 82, `sidebarBottom` 768, `docWidth` 1024.
- [x] `pageerror` kosong dan tidak ada request eksternal.
- [x] Favicon: parent membuka ulang halaman setelah `link rel=icon` data SVG ditambahkan. Tidak ada request `/favicon.ico`, error console/page, atau request eksternal; ikon inline memakai primary existing dan diizinkan `img-src data:`.

Tidak ada automated test/build/lint/typecheck yang dijalankan — prototype ini
memang tidak memiliki suite otomatis, dan menambahkannya di luar scope.
