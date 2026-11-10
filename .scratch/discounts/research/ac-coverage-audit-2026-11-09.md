# Audit kepatuhan AC — Spec Editor Diskon Admin Terpadu

Tanggal audit: 2026-11-09. Objek: [spec](../plan/admin-discounts-unified-editor-spec.md)
AC01–AC20 (baris 461–480) terhadap kode yang ada di worktree.

Alasan audit: laporan implementasi sebelumnya memakai bahasa penyelesaian
padahal UI belum diubah. Audit ini mengganti klaim itu dengan tabel per AC.
Aturan pencegahannya sudah dicatat di `AGENTS.md` §4 ("No completion claim
without AC coverage") dan `.agents/skills/development-workflow/SKILL.md` §4.

Cara membaca status:

- **Pending** — belum ada perubahan yang terlihat user; halaman masih memakai
  implementasi lama.
- **Sebagian** — ada evidence di satu layer (repository/service/DB test), tetapi
  kontrak user (HTTP route/UI) belum memakainya, sehingga AC belum terpenuhi.
- **Verified** — ada evidence yang menjalankan perilaku AC pada jalur yang
  dipakai user.

## Ringkasan

| Status | Jumlah | AC |
|---|---|---|
| Verified | 0 | — |
| Sebagian | 6 | AC07, AC08, AC09, AC11, AC12, AC13 |
| Pending | 14 | AC01–AC06, AC10, AC14–AC20 |

Kesimpulan: **0 dari 20 AC terpenuhi pada jalur user.** Yang ada adalah fondasi
backend yang tidak terlihat di UI, ditambah kolom `draft_configuration` di DB.

## Tabel AC → evidence

| AC | Klaim spec (ringkas) | Status | Evidence / celah yang terverifikasi |
|---|---|---|---|
| AC01 | Satu daftar semua jenis; filter hanya menyaring; create tidak ikut jenis | Pending | `discounts-list-client.tsx:101–105` masih dua `TabsTrigger` (`public`/`manual_only`), `kind` default `"public"` (baris 46) dan dipakai sebagai jenis create. Tidak ada filter "Semua jenis" (spec baris 84). |
| AC02 | Create meminta jenis; batal tidak membuat; retry tidak menggandakan | Pending | Tombol **Buat draft** langsung POST memakai `kind` tab (baris 74–84). Tidak ada dialog radio, tidak ada validasi "Pilih jenis promo". `requestKey` memang dikirim dan diterima route (`route.ts:45`), jadi idempotensi server ada, tetapi kontrak create di UI belum ada. |
| AC03 | Kupon publik tanpa tab Kode; manual punya tab bertugas | Pending | `discount-editor-client.tsx:973` selalu merender `TabsTrigger value="kode"`; untuk publik dirender kartu "Kupon publik tidak memiliki kode…" (~baris 1580) yang dilarang spec baris 173. |
| AC04 | Tanpa heading ketidaklengkapan, blok Tentang promo, raw revision/JSON, accordion riwayat/simulasi | Pending | `discounts-list-client.tsx` masih memuat `<details>Tentang promo</details>` dan kolom **Jalur**, **Revision live**, **ID teknis**, daftar literal kode; spec baris 80 & 89 melarangnya. |
| AC05 | Mandatory kondisional; kuota **atau** budget; field hilang ditemukan lintas tab | Pending | Aturan "minimal satu batas" ada di editor baris 1196, tetapi belum ada error summary lintas tab dan penyimpanan masih per bagian, sehingga "lintas tab" belum bisa diuji. |
| AC06 | Uang `Rp 100.000,00` saat blur; persen `10%`; empty≠0; caret/paste aman | Pending | Formatter ada dan teruji (`[id]/discount-number-format.ts`, 36 test), tetapi **tidak dipakai satu pun file `.tsx`** (grep kosong). UI masih memakai input lama. |
| AC07 | Simpan dari Pengaturan/Kode menyimpan seluruh snapshot; pindah tab tidak kehilangan input; draft parsial valid | Sebagian | `save-discount-configuration-service.ts` + 13 SQL test (`discount-configuration.db.test.ts`, termasuk "draft parsial manual tersimpan…"). Route `/draft` masih memakai writer lama (`policy`/`codes` terpisah dipanggil editor baris 538 & 628). |
| AC08 | Save 15%/kuota200 tidak mengubah live 10%/100 atau eligibility | Sebagian | DB test "menyimpan potongan 15% dan kuota 200 bersama tanpa mengubah live 10%/100" PASS di disposable DB. Belum ada route/UI yang memakainya. |
| AC09 | Kode draft tidak aktif/terreservasi sampai publish; status existing tidak berubah saat save | Sebagian | DB test "kode direbut setelah review…", "perubahan status kode ikut draft…", "draft parsial manual tersimpan tanpa reservasi". Editor masih memanggil `POST /codes` langsung (baris 628). |
| AC10 | Lanjut ke publish menyimpan bila perlu lalu membuka review tanpa save terpisah | Pending | Alur UI sekarang: simpan aturan → simpan kapasitas (`Simpan kapasitas`, baris 1267) → review. Larangan spec §7.1 atas tombol simpan per bagian masih dilanggar. |
| AC11 | Publish menerapkan aturan, kapasitas, batas akun, kode, pointer, receipt, audit sekaligus; gagal rollback total | Sebagian | DB test "review dan publish menerapkan terms, kapasitas, dan kode dalam satu commit" + "kegagalan audit membatalkan snapshot…" PASS. Route `/publish` belum dialihkan ke `publish-discount-configuration-service.ts`. |
| AC12 | Stale/revoke/duplicate code/commitment drift menolak publish | Sebagian | DB test "izin kapasitas yang dicabut…", "kode direbut…", "menolak stale version…" PASS. Belum ada E2E konflik; UI belum memakai fingerprint dari service baru. |
| AC13 | Retry sama tidak menggandakan; fingerprint berubah bila konfigurasi review berubah | Sebagian | DB test "retry dan dua submit bersamaan hanya menaikkan versi serta audit sekali" PASS. Route/receipt lama masih legacy. |
| AC14 | Simulasi memakai versi benar, menyimpan draft bila dirty, tidak menahan kuota, hasil lama ditandai stale | Pending | `/simulate` masih endpoint lama; belum menggunakan expected draft version dari snapshot. |
| AC15 | Pemakaian tetap live & scoped; riwayat manusiawi tanpa mengarang data | Pending | Tab masih "Pemakaian & budget" (baris 974) dengan konfigurasi batas di dalamnya; spec §10 meminta label **Pemakaian saat ini** dan batas pindah ke Pengaturan. |
| AC16 | Publish terjadwal tidak diklaim berlaku; paused tetap paused; archived read-only | Pending | Belum ada E2E/domain test matriks waktu terkendali untuk snapshot baru. |
| AC17 | Keluar dirty meminta pilihan; save gagal tidak keluar; double-submit dicegah | Pending | Grep `beforeunload`/`Perubahan belum disimpan` di editor kosong. |
| AC18 | Writer langsung lama tidak bisa bypass; caller first-party pindah | Pending | Grep `410`/`CONFIGURATION_MOVED_TO_DRAFT` kosong; `/policy`, `/codes`, `/codes/{id}`, `/draft` masih hidup dan dipanggil editor. |
| AC19 | Backfill mempertahankan live/usage/kode; incomplete draft tetap terbuka; seed/reset sesuai schema | Pending | Belum ada backfill. Seed hanya menambah `draftConfiguration: null` pada satu draft demo; fixture "draft parsial, published dengan draft berbeda, paused, kode masked" (spec baris 305) belum ada. |
| AC20 | Render konsisten shared reference, keyboard & viewport lolos, docs endpoint/feature diperbarui | Pending | Belum ada render review untuk UI yang dimaksud spec. Docs hanya mencatat fondasi + status "belum cutover". |

## Dampak ke status plan

Plan tetap **In Progress**. Frasa pada index yang menyebut "fondasi … tersedia"
benar, tetapi tidak boleh dibaca sebagai kemajuan AC. Slice berikutnya harus
berakhir di jalur user, sesuai urutan yang disetujui:

1. Daftar terpadu + dialog **Buat diskon** (AC01, AC02, AC04 sebagian).
2. Editor: satu snapshot menyeluruh, tab Kode kondisional, number input
   (AC03, AC05, AC06, AC07, AC10).
3. Review/publish lewat service baru + 410 untuk writer lama (AC11–AC13, AC18).
4. Simulasi, pemakaian, riwayat, dirty guard, matriks state (AC14–AC17).
5. Backfill, seed fixture, render/keyboard/viewport review, docs (AC19, AC20).

## Batas audit ini

Audit hanya membaca kode dan nama test yang ada; tidak menjalankan suite baru.
Status `Sebagian` mengacu pada laporan test disposable sebelumnya
(`ticket/admin-unified-editor-verification.md`), bukan hasil run ulang hari ini.
Render browser tetap belum diperiksa karena executable Chrome untuk Playwright
MCP tidak tersedia di mesin ini.
