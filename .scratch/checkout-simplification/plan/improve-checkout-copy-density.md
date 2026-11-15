# Plan: Ringkas dan perjelas UX checkout, review, dan hasil pembayaran

Status per fitur dicatat di file ini; status plan keseluruhan hanya di
[`../index.md`](../index.md). Plan ini adalah lanjutan dari
[audit UX checkout dan pembayaran](spec-audit-ux-checkout-pembayaran.md) dan
[review hasil audit](../research/review-ux-checkout-pembayaran.md), dengan koreksi dari
[cross-check audit](../research/cross-check-audit-ux-checkout-pembayaran.md).

**Status 2026-11-15: ditutup (Done).** Fitur 1–6 diimplementasikan setelah user
memberi perintah "tolong implementasikan improve-checkout-copy-density.md";
semua AC-01–AC-14 berstatus Verified (lihat
[Evidence implementasi](#evidence-implementasi)). Tiga item di luar scope tetap
tercatat sebagai limitation, bukan blocker plan ini: legacy `test:e2e`,
mismatch literal provider2/provider3 di full-run `discounts-coupon-mock`, dan dua
DB test admin (Markdown/price workbook) yang tidak menyentuh checkout. Ringkasan
status plan ada di [`../index.md`](../index.md).

## Tujuan / Motivasi

User menilai checkout dan pembayaran terlalu banyak tulisan, warning kuning pickup
terlalu dominan, kartu cabang di mobile kurang rapi, dan helper text panjang
(mis. “Email akun dipakai untuk konfirmasi dan pembayaran”) mengganggu. User
meminta copy lebih sedikit tetapi deskriptif, penjelasan sekunder dapat
disembunyikan di balik ikon yang bisa di-hover/click, serta field wajib dan
desain text field yang jelas dan konsisten.

Perubahan ini menjawab T01–T05 dan mitigasi presentasi T13, dengan fokus pada
kepadatan copy dan kejelasan form. T02 bukan alasan otomatis men-disable
`Lanjut`; T09 (deduplikasi feedback) dan T20 (contrast shared) tetap di fase 2.
Mitigasi T13 di plan ini **tidak membuktikan status pembayaran**; verifikasi
status dari DTO tetap scope fase 2.

### Kebutuhan pengguna

1. Sebagai pelanggan mobile, saya ingin mengetahui langkah checkout yang aktif
   dan field wajib, agar dapat melanjutkan tanpa menebak.
2. Sebagai pelanggan pickup, saya ingin membaca caveat penting secara singkat
   dan membuka bantuan tambahan bila perlu, tanpa kehilangan informasi cabang.
3. Sebagai pelanggan pickup/delivery, saya ingin memeriksa barang, kontak,
   tujuan/slot, rincian biaya, dan konsekuensi pembayaran sebelum submit.
4. Sebagai pelanggan yang kembali dari pembayaran, saya ingin tampilan yang
   jujur mengenai status yang belum diperiksa dan akses langsung ke pesanan.

### Integrasi hasil cross-check

| Temuan/koreksi | Perlakuan dalam revisi |
|---|---|
| T02 | Pertahankan validasi setelah klik untuk pickup; error/fokus diperbaiki. Tidak menambah disable-until-valid atau validasi blur otomatis. |
| T04/T05 | Kontak dan fulfillment pada review tetap untuk pemeriksaan; ringkas bantuan yang berulang, bukan menghapus data keputusan. |
| T13 | Tanpa fetch, query tidak boleh menghasilkan heading/ikon/tone success atau failure. Semua state ber-ID memakai presentasi belum diverifikasi yang netral. |
| T07/T22 | Tidak menambah dialog penurunan total atau dialog saat ganti alamat. Reset quote dan request recovery existing dipertahankan. |
| E01/E02 | Fixture nominal promo harus konsisten; focused capture menunjukkan kontrol/error yang dinilai, bukan hanya header. |
| T06/T08–T12/T14–T26 | Perbaikan tambahan dan keputusan produk ditangani [fase 2](audit-findings-phase-2.md); tidak otomatis ikut plan 1. |

### Keputusan terbuka yang sudah diselesaikan (2026-11-14)

| # | Pertanyaan | Keputusan user | Dampak dokumen |
|---|---|---|---|
| D1 | Presentasi halaman hasil pembayaran | **Netral total** untuk semua nilai query bila `order_id` ada: heading “Periksa status pembayaran”, ikon/tone netral, copy belum terverifikasi, primary `Lihat Detail Pesanan`, secondary `Belanja Lagi`. `pending` tidak diberi catatan khusus. | AC-08 dipertahankan; tidak ada state hasil yang diturunkan dari query |
| D2 | Perilaku validasi step 1 pickup | **Validasi saat klik** `Lanjut` + error per field + fokus ke field invalid pertama. Tombol tetap aktif; tanpa disable-until-valid dan tanpa validasi blur otomatis. | AC-11 dipertahankan; keputusan T02 tetap ditutup |
| D3 | Cakupan koreksi fixture promo | **Seluruh spec mock yang memuat data promo** (`e2e/**/*-mock.spec.ts`: mock response + assertion), tanpa perubahan app code atau endpoint. **Fitur 6 tetap dalam scope dan tidak ditunda** ke fase 2. | AC-12 diperluas; batas “tidak mengubah semua fixture repo” dibatalkan; inventaris file di bawah |
| D4 | Kedalaman evidence visual | **Tiga tingkat**: first viewport, full-page, dan focused viewport yang di-scroll ke state yang dinilai (error pickup, InfoHint terbuka, CTA/loading, checkbox, halaman hasil). | AC-13 dipertahankan |
| D5 | Blok info “Pembayaran via Midtrans” di review | **Dihapus sepenuhnya**, tanpa baris pengganti dan tanpa nama gateway di UI. | Scope 3, copy final, AC-07, AC-14 |
| D6 | Daftar metode pembayaran (QRIS/GoPay/VA/kartu) | **Tidak disebut** di UI customer-facing; daftar metode mengikuti konfigurasi gateway, bukan copy. | AC-14 |

Angka fixture acuan (D3): baseline 166.500 → promo barang 20.000 → total 144.300 →
“Hemat total” 22.200 (20.000 promo barang + 2.300 potongan ongkir).

Klaim kelengkapan audit asal bukan prasyarat bahwa semua state UI telah lulus.
Gunakan evidence yang relevan untuk slice ini; gap audit lainnya tetap dicatat
di cross-check, tanpa memaksa perluasan implementasi.

### Asal usul setiap perubahan

| Perubahan | Sumber | Alasan |
|---|---|---|
| Warning pickup kuning → kalimat netral + InfoHint | Feedback user #1; audit T04/C04/C05 | User terganggu warna kuning; caveat tetap terlihat tanpa mengalahkan total/CTA. |
| Kartu cabang mobile dirapikan, badge dihapus | Feedback user #2; audit C03/C11 | Nama cabang terpotong oleh badge di 390 px; badge tidak menambah informasi baru. |
| Helper text panjang → hint singkat + InfoHint | Feedback user #3; audit C04/C05 | Mengurangi beban baca; penjelasan tetap tersedia saat dibutuhkan. |
| Copy lebih sedikit tetapi deskriptif | Feedback user (poin 1) | Arahan utama user. |
| Required field jelas + field konsisten | Feedback user (poin 2); audit T02/C12 | Bintang tanpa legenda/atribut/error per field menyulitkan perbaikan. |
| Label step tetap terlihat di mobile | Audit T01/C01 (agent) | Orientasi hilang di <640 px, bukan bagian feedback eksplisit user. |
| Pesan slot pickup berbahasa Inggris → Indonesia | Audit T03/C04/C10 (agent) | Pesan server tidak konsisten dengan bahasa UI dan tidak menunjuk field. |
| Copy hasil pembayaran netral + ID utuh | Audit T13/C14 (agent) | Copy saat ini dapat menyatakan status yang belum diverifikasi. |
| Review: hapus reminder pickup duplikat | Audit T04/T05/C03/C09 (agent) | Mengurangi pengulangan data keputusan. |
| Blok “Pembayaran via Midtrans” dihapus total | Feedback user (D5/D6) | Pelanggan tidak perlu tahu payment gateway; daftar metode bisa berubah tanpa mengubah copy. |

## Scope

**Termasuk**

1. **InfoHint shared** — ikon info 24×24 px dengan popover yang terbuka lewat
   hover (mouse), click/tap, dan keyboard; Escape menutup dan fokus kembali ke
   trigger. Hanya untuk penjelasan sekunder; informasi wajib, biaya, status,
   dan konsekuensi tetap terlihat tanpa hover.
2. **Checkout step 1 (pickup & delivery):**
   - Kartu cabang mobile dirapikan (nama/alamat, tanpa badge “Cabang Terpilih”
     yang memakan ruang; penjelasan aturan satu cabang masuk InfoHint).
   - Disclaimer pickup amber besar diganti satu kalimat netral yang tetap
     terlihat + InfoHint untuk detail.
   - Intro step, helper kontak, dan hint read-only dipersingkat; penjelasan
     panjang masuk InfoHint.
   - Required field konsisten: bintang yang sudah ada + legenda “* Wajib diisi”,
     atribut `required`/`aria-required`, dan error per field yang terasosiasi.
   - Label “Waktu Pickup” terhubung ke select (`htmlFor`/`id`), `aria-required`,
     `aria-describedby`, dan fokus otomatis ke field pertama yang invalid.
   - Pesan error slot pickup dari server dipetakan ke bahasa Indonesia; pesan
     jaringan tetap dekat field dengan aksi coba lagi.
   - Label step tetap terlihat di mobile (label pendek) agar orientasi tidak
     hilang.
3. **Review pembayaran:**
   - Intro dipersingkat; blok amber pickup duplikat dihapus, diganti satu baris
     netral + InfoHint.
   - Blok kartu “Pembayaran via Midtrans” **dihapus sepenuhnya** (D5): tanpa
     baris pengganti, tanpa nama gateway, dan tanpa daftar metode pembayaran
     (D6).
   - Teks checkbox pickup dipersingkat tanpa menghilangkan komitmen inti.
4. **Halaman hasil pembayaran tanpa verifikasi baru:** bila `order_id` ada,
   heading “Periksa status pembayaran”, ikon/tone netral, copy netral, primary
   `Lihat Detail Pesanan`, secondary `Belanja Lagi`, dan ID utuh (`break-all`).
   Query `settlement`/`capture`/`pending`/`deny`/`cancel`/asing/tanpa status tidak
   menjadi bukti sukses, gagal, atau batal. Tanpa `order_id`, gunakan state
   “Pesanan belum dapat ditentukan” dan primary `Lihat Pesanan Saya` ke
   `/account`; jangan membuat link detail kosong. Tidak ada fetch/polling atau
   perubahan status backend. Seluruh kontrak ini disetujui lewat D1
   (2026-11-14).
5. **Tests & docs:** spec UI-only baru, update spec yang menyentuh copy, docs
   fitur checkout.

**Acceptance criteria (dapat diamati)**

- AC-01 Step 1 menampilkan legenda “* Wajib diisi”; tanggal, waktu, telepon, dan
  email pickup memiliki penanda wajib visual dan `required`/`aria-required`.
- AC-02 Klik `Lanjut` dengan field wajib kosong memfokuskan field invalid pertama
  dan menampilkan error di dekat field tersebut (bukan hanya satu pesan jauh).
- AC-03 Select waktu memiliki nama aksesibel “Waktu Pickup”, dapat dioperasikan
  dengan keyboard, dan error/hint terhubung via `aria-describedby`.
- AC-03b Pesan penolakan slot pickup tampil dalam bahasa Indonesia; pesan
  jaringan tidak menampilkan string Inggris mentah.
- AC-04 InfoHint: hover (mouse) membuka, click/tap membuka, Enter/Space membuka,
  Escape menutup dan mengembalikan fokus; target 24×24; konten tidak menjadi
  satu-satunya tempat informasi kritis.
- AC-05 Kartu cabang mobile menampilkan nama + alamat/kota tanpa badge, tanpa
  overflow, dan tanpa teks terpotong pada 390 px dan 320 px.
- AC-06 Tidak ada blok warning amber pickup di step 1/review; kalimat
  “hanya estimasi, bukan janji temu” tetap terlihat tanpa hover.
- AC-07 Review pickup/delivery tidak lagi memuat paragraf reminder pickup
  duplikat maupun blok info payment gateway; total, promo, rincian, dan checkbox
  persetujuan tetap ada.
- AC-08 (direvisi) Halaman hasil tanpa fetch: dengan `order_id`, setiap nilai
  query status memakai heading “Periksa status pembayaran”, ikon/tone netral,
  copy belum diverifikasi, ID utuh, dan CTA detail ke ID yang sama. Tidak ada
  klaim diterima/berhasil/gagal/batal atau janji kode pickup dari query saja.
  Tanpa ID, heading “Pesanan belum dapat ditentukan”, CTA riwayat `/account`,
  tanpa link detail kosong. Tetap tidak ada request verifikasi/order baru.
- AC-09 Copy/hint field konsisten: label nyata, hint singkat, error per field,
  tidak ada placeholder-only label; tidak ada perubahan token global.
- AC-10 Spec baru + spec terdampak lulus, typecheck/lint lulus, dan rendered
  review desktop 1440/mobile 390/320 tanpa regresi layout.
- AC-11 (baru) Pickup kosong tetap dapat menjalankan validasi lewat `Lanjut`;
  error terasosiasi dan fokus ke field invalid. Delivery tetap mengikuti gating
  alamat/quote/layanan existing. Review total, rincian, data keputusan, reset
  quote tujuan baru, dan boundary request recovery tidak berubah.
- AC-12 (direvisi D3, 2026-11-14) Seluruh spec mock yang memuat data promo
  memakai angka acuan yang sama: baseline 166.500 → promo barang 20.000 → total
  144.300, savings 22.200 (20.000 promo barang + 2.300 potongan ongkir).
  “Potongan” dan “Hemat total” tetap berbeda makna dan tidak dihapus hanya karena
  sempat tampak sama. Ranking/paging fixture mengikuti total global, bukan angka
  audit yang keliru. Tidak ada perubahan app code, endpoint, atau nilai promo di
  produksi.
- AC-13 (baru) Evidence visual mencakup first viewport/full-page layar utama dan
  focused viewport untuk error pickup, hint terbuka, CTA/loading, checkbox,
  serta state hasil. Screenshot header saja bukan bukti state di bawah layar.
- AC-14 (baru, D5/D6) Tidak ada string “Midtrans” maupun daftar metode
  pembayaran (QRIS/GoPay/VA/kartu) pada UI customer-facing store — review
  checkout, halaman hasil, dan halaman lain yang diperiksa. Identitas gateway
  hanya boleh tetap di kode, API, log, dan dokumentasi teknis.

## Approval

- Kesepahaman bersama dikonfirmasi user: **disetujui 2026-11-14**. User meminta
  fokus pada plan ini (“iya oke fokus pada plan 1”) dan memisahkan temuan audit
  lainnya ke plan fase 2. Feedback user (warning pickup, kartu cabang mobile,
  helper text panjang, copy singkat, required jelas, field konsisten) menjadi
  dasar scope.
- Complete scope dan acceptance/verify criteria disetujui user: **disetujui
  2026-11-14** melalui percakapan yang sama. Opsi default pada plan ikut
  disetujui: warning pickup netral ringkas + InfoHint, required bintang +
  legenda + error per field, dan perbaikan copy + CTA halaman hasil.
- **Riwayat di atas hanya berlaku untuk versi sebelum revisi cross-check.**
  Pada 2026-11-14 user memilih “Revisi kedua plan (Recommended)”: izin menyusun
  revisi dengan koreksi/AC baru, bukan approval implementasi hasil revisi.
- **Approval versi revisi: disetujui 2026-11-14** melalui sesi keputusan D1–D6.
  User memilih “Catat + tandai disetujui, belum implementasi”: dokumen ini boleh
  berstatus siap implementasi, tetapi penulisan kode dimulai hanya setelah user
  memberi perintah mulai. Status aktif tercatat di index fitur.
- Approval ini menggantikan status Pending pada versi sebelumnya; kontrak yang
  dulu ditandai belum disetujui kini ditutup oleh D1–D6, bukan oleh approval
  historis.
- Tidak ada izin implementasi, commit, push, remote access, deployment, atau
  subagent dari approval dokumen ini.

## Non-scope

- Perubahan backend/API/schema, aturan pajak/promo/stock, atau status order.
- Verifikasi status order di halaman hasil (butuh fetch/behavior baru) — plan
  ini hanya menetralkan seluruh presentasi yang belum diverifikasi, termasuk
  heading/ikon/tone, bukan sekadar paragraf.
- Order detail: menyembunyikan panel tracking prematur, memindahkan kartu
  pembayaran, feedback “Periksa status pembayaran” — follow-up terpisah.
- Promo: penanda penurunan total, pencarian promo, perubahan picker. Koreksi
  *fixture* promo di spec (D3) bukan perubahan aturan, endpoint, atau data promo
  produksi.
- Shared token contrast (footer, badge cart, placeholder wilayah), target ikon
  sosial, dan `FloatingWhatsappButton` — perubahan lintas consumer, perlu
  keputusan terpisah.
- Dark theme, browser lain, atau redesign visual menyeluruh.

## Rancangan teknis

| Path | Aksi | Tanggung jawab | Layer | Seam test |
|---|---|---|---|---|
| `packages/ui/src/components/ui/info-hint.tsx` | create | Info button + controlled Popover; hover/click/keyboard; label aksesibel; konten sekunder | UI shared | `e2e/store/checkout-density-mock.spec.ts` |
| `packages/ui/src/index.ts` | modify | Export `InfoHint` + tipe props | UI shared | typecheck |
| `apps/store/src/app/checkout/page.tsx` | modify | Step indicator mobile, kartu cabang, required/legend, hint singkat + InfoHint, error per field, review copy | UI page | spec baru + spec terdampak |
| `apps/store/src/app/checkout/result/page.tsx` | modify | Presentasi hasil netral ber-ID/tanpa ID, CTA dan ID utuh; tanpa fetch | UI page | `e2e/store/checkout-density-mock.spec.ts`, `e2e/store/status-colors-mock.spec.ts` |
| `e2e/store/checkout-density-mock.spec.ts` | create | Bukti UI-only: route mock cart/branch/addresses/quote/preview, sign-in HTTP, desktop/mobile/320 | E2E mock | dirinya sendiri |
| `playwright.mock.config.ts` | modify | Daftarkan spec baru di `testMatch` | config test | run mock |
| `e2e/store/delivery-quote-mock.spec.ts` | modify | Update assertion copy hint/reminder yang sengaja berubah | E2E mock | spec itu |
| `e2e/store/status-colors-mock.spec.ts` | modify | Ganti assertion hasil berbasis query yang sebelumnya mengharapkan sukses/gagal; state terverifikasi lain tetap semantik | E2E mock | spec itu |
| Tiga spec mock pemuat data promo — `checkout-review`, `discounts-coupon`, `status-colors` (D3, lihat inventaris) | modify | Samakan fixture promo ke angka acuan 166.500 / 20.000 / 144.300 / 22.200 dan tambahkan assertion label “Potongan”/“Hemat total”; tanpa ubah app code | E2E mock | spec masing-masing |
| `docs/features/versioned-checkout-pricing.md` | modify | Copy review, required/InfoHint, batas hasil yang belum diverifikasi | docs | review dokumen |
| `docs/features/delivery-quotes.md` | modify | Hint kontak/fulfillment yang berubah tanpa mengubah quote | docs | review dokumen |

**Kontrak export baru**

- `InfoHint`: `({ label, children, side?, align?, className? }: InfoHintProps) => JSX.Element`
  — tombol info 24×24 dengan popover; `label` menjadi nama aksesibel trigger.
- `InfoHintProps`: `label: string; children: React.ReactNode; side?: "top"|"right"|"bottom"|"left"; align?: "start"|"center"|"end"; className?: string`.

**Keputusan struktur**

- **Shared di `packages/ui`, bukan lokal checkout:** dipakai juga oleh review dan
  berpotensi order detail; menghindari duplikasi perilaku hover/focus. Ditolak:
  komponen lokal per halaman (perilaku keyboard/hover akan berbeda).
- **Tetap memakai `Label` + teks bintang existing di checkout:** teks label
  (“Tanggal Pickup *”, “Nomor Telepon *”, “Email *”) dipertahankan agar nama
  aksesibel dan selector existing stabil; kontrak wajib dipindahkan ke atribut
  `required`/`aria-required` + legenda. Ditolak: mengganti ke `Label required`
  yang menghapus “*” dari nama aksesibel dan memaksa update selector di 9 spec.
  Modal alamat tetap memakai `Label required` seperti sekarang.
- **Tanpa perubahan token global:** hint/error memakai token yang ada
  (`text-muted-foreground`, `text-destructive`, `bg-muted/30`, `border`).

**Discovery**

- `discovery:` Apakah `PopoverContent` pada versi `@radix-ui/react-popover`
  terpasang menerima `aria-label` dan mengembalikan fokus ke trigger? Verifikasi
  dari tipe/installed source + Context7 sebelum implementasi.
- `discovery:` Apakah hover-open pada Popover perlu `onPointerEnter` atau
  `onMouseEnter` untuk mencegah konflik dengan click/touch? Verifikasi di
  browser pada spec baru.

**Context7 checkpoint (wajib sebelum coding)**

- `/radix-ui/primitives` — controlled `open`/`onOpenChange`, modal/focus
  management Popover, Escape, `onCloseAutoFocus`. Sudah dikonfirmasi untuk draf.
  Saat implementasi, cek ulang tipe `@radix-ui/react-popover` terpasang dan
  dokumentasi `Popover` untuk `aria-label`/focus return.

## Rancangan UX

- **Tugas dan pengguna:** pelanggan pickup/delivery yang sedang menyelesaikan
  checkout. Kondisi awal: cart terpilih, step 1. Hasil sukses: pelanggan paham
  field wajib, melihat total/ringkasan tanpa membaca blok panjang, dan dapat
  membuka penjelasan sekunder saat perlu.
- **Halaman/pattern referensi:** `apps/store/src/app/checkout/page.tsx` (alur
  existing), `packages/ui/src/components/ui/label.tsx` (required),
  `packages/ui/src/components/ui/popover.tsx` (overlay), dan modal alamat
  `DeliveryQuotePanel.tsx` (label + hint + footer melekat).
- **Hierarki:** judul halaman → step indicator → data fulfillment → field wajib
  → CTA `Lanjut`; review: barang → fulfillment → kontak → promo → rincian →
  persetujuan → `Bayar Sekarang`. Satu primary action per layar.

**Component reuse map**

| Elemen | Existing/Baru | Path | Catatan |
|---|---|---|---|
| Info button + popover | Baru | `packages/ui/src/components/ui/info-hint.tsx` | memakai `Popover`, `lucide-react` `Info` |
| Label | Existing | `packages/ui/src/components/ui/label.tsx` | `htmlFor`; `required` hanya di modal alamat |
| Input | Existing | `packages/ui/src/components/ui/input.tsx` | `required`, `aria-invalid`, `aria-describedby` |
| Select trigger | Existing | `packages/ui/src/components/ui/select.tsx` | tambah `id`, `aria-required`, `aria-describedby` |
| Read-only input | Existing | `packages/ui/src/components/ui/read-only-input.tsx` | hint singkat |
| Button/Card | Existing | `packages/ui/src/components/ui/button.tsx`, `packages/ui/src/components/ui/card.tsx` | tidak ada variant baru |

**Copy final**

| Lokasi | Sebelum | Sesudah |
|---|---|---|
| Intro step 1 pickup | “Pilih perkiraan tanggal dan waktu kedatangan Anda untuk mengambil pesanan.” | “Pilih tanggal dan jam pickup.” |
| Intro step 1 delivery | “Pilih alamat pengiriman, lalu periksa ongkir untuk melihat layanan yang tersedia.” | “Pilih alamat, lalu periksa ongkir.” |
| Badge cabang | “Cabang Terpilih” | dihapus; InfoHint: “Cabang mengikuti barang yang dipilih. Satu checkout hanya untuk satu cabang.” |
| Disclaimer pickup | paragraf amber 3 kalimat | terlihat: “Tanggal dan jam pickup hanya estimasi, bukan janji temu.” · InfoHint: “Toko memakai tanggal dan jam ini untuk menyiapkan pesanan. Pastikan email dan nomor telepon aktif agar toko dapat menghubungi kamu.” |
| Hint telepon pickup | “Nomor aktif yang bisa dihubungi toko.” | “Aktif dan bisa dihubungi.” |
| Hint email pickup | “Kode pickup dikirim ke email ini setelah pesanan siap diambil.” | “Untuk konfirmasi dan kode pickup.” · InfoHint: “Kode pickup dikirim ke email ini setelah pesanan siap. Email juga dipakai untuk konfirmasi pesanan dan pembayaran.” |
| Hint telepon penerima | “Mengikuti nomor telepon pada alamat penerima di atas.” | “Dari alamat penerima.” · InfoHint: “Nomor mengikuti alamat pengiriman yang dipilih. Ubah nomor di Buku Alamat atau gunakan alamat baru.” |
| Hint email akun | “Email akun dipakai untuk konfirmasi pesanan dan pembayaran.” | “Untuk konfirmasi pesanan.” · InfoHint: “Email akun dipakai untuk konfirmasi pesanan dan pembayaran.” |
| Error slot pickup (server) | “Pickup time must be between 09:00 and 21:00 (30-min intervals).” / “Failed to validate pickup slot. Please try again.” | “Waktu pickup harus antara 09.00 dan 21.00.” / “Slot pickup belum dapat diverifikasi. Coba lagi.” |
| Review intro | “Periksa pesanan Anda, lalu konfirmasi untuk melanjutkan ke pembayaran via Midtrans.” | “Periksa pesanan, lalu lanjut ke pembayaran.” |
| Review reminder pickup | blok amber 2 paragraf | “Pickup hanya estimasi. Saat mengambil, sebutkan nomor telepon dan email pesanan.” + InfoHint “Toko memakai tanggal dan jam ini untuk menyiapkan pesanan; ini bukan janji temu.” |
| Info Midtrans | card “Pembayaran via Midtrans” + baris “Pilih QRIS, GoPay, VA, atau kartu…” | **dihapus** — tanpa baris pengganti, tanpa nama gateway, tanpa daftar metode (D5/D6) |
| Checkbox pickup | 4 klausa | “Saya telah memeriksa pesanan dan menyetujui syarat & ketentuan. Saat mengambil, saya akan menyebutkan nomor telepon dan email pesanan.” |
| Hasil ber-ID, semua query status | heading/copy sukses, pending, atau gagal diturunkan dari query | heading “Periksa status pembayaran”; “Buka detail pesanan untuk melihat status pembayaran dan langkah berikutnya.” · ikon/tone netral · primary “Lihat Detail Pesanan” ke `/account/orders/<order_id>`, secondary “Belanja Lagi” ke `/products` |
| Hasil tanpa ID | query/default menyimpulkan gagal | heading “Pesanan belum dapat ditentukan”; “Buka riwayat pesanan untuk mencari pesanan yang ingin diperiksa.” · ikon/tone netral · primary “Lihat Pesanan Saya” ke `/account`, secondary “Belanja Lagi” ke `/products` |
| ID hasil | 8 karakter | ID utuh, `break-all` |

**State matrix**

| Layar/komponen | Idle | Loading | Empty | Error | Sukses | Disabled | Unsaved |
|---|---|---|---|---|---|---|---|
| InfoHint | ikon 24×24, `aria-label` | — | — | — | popover terbuka (hover/click/keyboard) | — | — |
| Step 1 pickup | field kosong + legenda + hint | `Lanjut` → “Memeriksa…” | — | field error + `aria-invalid`, fokus field pertama | lanjut ke review | waktu disabled sampai tanggal dipilih (+placeholder “Pilih tanggal dahulu”) | nilai tetap saat pindah review/kembali |
| Step 1 delivery | alamat belum dipilih | quote loading | alamat kosong | error alamat/quote + retry | layanan terpilih | CTA disabled saat quote pending | pilihan alamat/layanan tetap sesuai state existing |
| Review | total + checkbox belum dicentang | submit “Memproses…” | — | toast + inline attempt error | lanjut ke pembayaran | CTA disabled sampai checkbox | input step 1 tetap |
| Hasil ber-ID | “Periksa status pembayaran”; belum diverifikasi, netral untuk semua query | Suspense spinner | N/A | Tidak menafsirkan query sebagai error terverifikasi | N/A — tidak mengklaim sukses | N/A | ID/CTA tetap mengarah ke pesanan yang sama |
| Hasil tanpa ID | “Pesanan belum dapat ditentukan”; CTA riwayat | Suspense spinner | ID tidak tersedia, bukan bukti pembayaran gagal | Tidak membuat link detail kosong | N/A | N/A | N/A |

- **Viewport/responsive:** 1440×900, 390×844, 320×800. Label step memakai teks
  pendek di <640 px; kartu cabang tidak overflow; popover tidak keluar layar.
- **Accessibility:** trigger 24×24, `aria-label`, hover bukan satu-satunya jalan,
  Escape + focus return, `aria-describedby` untuk hint/error, `aria-invalid`,
  `aria-required`, kontras hint ≥4.5:1 (cek rendered), label nyata.
- **Prototype:** tidak diminta; tidak dibuat.

## Fitur

| # | Fitur | Status | verify: | Catatan |
|---|---|---|---|---|
| 1 | Shared `InfoHint` + export | Done | `npm run verify:types:store` PASS; `checkout-density-mock` (hover/click/Enter/Escape/fokus, 24×24) 7 passed | Diintegrasikan bersama fitur 2 |
| 2 | Step 1 pickup/delivery: cabang, warning, hint, required, error, label step | Done | `checkout-density-mock` + `delivery-quote-mock` (24 passed) | Jalur user utama |
| 3 | Review: copy, reminder, Midtrans, checkbox | Done | `checkout-density-mock`, `delivery-quote-mock`; rendered review 1440 | Total/promo tidak berubah |
| 4 | Presentasi hasil belum diverifikasi | Done | `checkout-density-mock`, `status-colors-mock` (11 passed) | Heading/ikon/tone/copy netral; tanpa fetch |
| 5 | Docs + final gate | Done | docs checkout/testing diperbarui; typecheck + lint + unit + mock E2E dijalankan (lihat limitations) | Lihat catatan unit suite DB |
| 6 | Koreksi fixture promo seluruh spec mock (D3) | Done | `status-colors-mock` 11 passed; `discounts-coupon-mock` pagination test 2 passed di DB disposable | Lihat Deviation log tentang `checkout-review-mock` |

### Inventaris fixture promo (D3, diperiksa 2026-11-14)

Fitur 6 dikonfirmasi user **tetap diubah dan tidak ditunda** ke fase 2. Cakupan
file yang benar menurut isi repo — bukan sekadar kemunculan angka 166.500:

| File | Peran | Tindakan |
|---|---|---|
| `e2e/store/checkout-review-mock.spec.ts` | mem-fake data promo (`benefitAmount`/`estimatedSavings`) dan membuka dialog promo | samakan angka promo + savings ke acuan D3 |
| `e2e/store/discounts-coupon-mock.spec.ts` | baseline tanpa promo 166.500 (150.000 + PPN 16.500); promo 10.000 → 155.400 | samakan angka promo + savings ke acuan D3 |
| `e2e/store/status-colors-mock.spec.ts` | mem-fake data promo untuk tone rincian | samakan angka promo + savings ke acuan D3 |

**Tidak termasuk** — angka 166.500 di file ini bukan fixture promo:
`delivery-quote-mock.spec.ts` (harga layanan Cargo), `markdown-mock.spec.ts`,
`markdown-settlement-mock.spec.ts`, `versioned-checkout-mock.spec.ts`, dan
`versioned-settlement-mock.spec.ts` (total order dan `gross_amount` Midtrans).
File-file itu hanya disentuh bila assertion-nya terbukti bergantung pada fixture
promo.

Temuan pendukung: belum ada spec store yang meng-assert label “Potongan” atau
“Hemat total”; satu-satunya assertion label promo ada di
`e2e/admin/discounts-admin-mock.spec.ts` (“Subsidi ongkir”). Karena itu AC-12
butuh assertion label baru di spec store yang membuka dialog promo, bukan hanya
penyesuaian angka.

## Implementation notes

Urutan vertical setelah approval: (1) InfoHint yang langsung dipakai pada
step 1 pickup + coverage trigger/Escape/required/error, (2) step 1 delivery +
hint, (3) review + coverage, (4) result netral + coverage, (5) koreksi fixture
promo seluruh spec mock (D3), (6) docs + final gate.
Fitur shared 1 tidak dilaporkan sebagai deliverable terpisah dari jalur user
fitur 2. Author E2E bersamaan, eksekusi mock suite pada final gate; rendered
review relevan tetap dilakukan untuk memastikan slice dapat dipakai.

Test seams:

- E2E UI-only baru `e2e/store/checkout-density-mock.spec.ts`, pola
  `order-detail-presentation-mock.spec.ts`: guard isolated mock, `page.request.post`
  sign-in, `page.route` untuk cart/branch/addresses/quote/promo/preview, tanpa
  mutasi DB/provider.
- Update `e2e/store/delivery-quote-mock.spec.ts` untuk hint email dan reminder
  review yang sengaja berubah, serta `e2e/store/status-colors-mock.spec.ts`
  (assertion hasil berbasis query pada baris 515–536 saat revisi) agar tidak
  memaksa klaim success/error tanpa verifikasi.
- Scope test hasil: `order_id` panjang dengan `settlement`, `capture`, `pending`,
  `deny`, `cancel`, nilai asing, status kosong; lalu URL tanpa ID. Semua query
  ber-ID tetap netral; CTA berfungsi; tidak ada fetch verifikasi atau transaksi
  baru. Expected copy berasal dari tabel final, bukan query-derived helper.
- Koreksi fixture promo berlaku untuk seluruh spec mock yang memuat data promo
  (D3), bukan hanya spec yang tersentuh plan: assert savings literal 22.200 dan
  urutan ranking lintas halaman bila memakai daftar promo. Endpoint ranking dan
  app code tetap tidak diubah.
- Focused capture mempertahankan scroll pada state target; first viewport
  tetap diambil terpisah. Gunakan intercept + wait response/state akhir untuk
  loading/error, bukan hanya menunggu font atau jumlah PNG.
- Context7 sebelum implementasi mengikuti AGENTS; revisi dokumen ini tidak
  memanggil API library dan tidak mengklaim checkpoint baru.
- Tidak menjalankan legacy `test:e2e`; final gate memakai
  `npm run verify:batch:e2e -- <spec paths>` dan full unit.

Rendered review: desktop 1440, mobile 390, 320; hover/click/keyboard InfoHint;
required/error states; review total 166.500/179.820; hasil ber-ID/tanpa ID netral.
Pada implementasi, focused unit per slice bila ada logika, typecheck L0;
full unit untuk logic change dan mock E2E path eksplisit pada final integration.
Daftarkan spec baru di kedua `testMatch` config mock; legacy E2E perlu izin
terpisah. Tidak ada test aplikasi yang dijalankan untuk revisi Markdown ini.

## Deviation log

| Ticket/slice | Rencana | Aktual | Alasan | Dampak |
|---|---|---|---|---|
| Fitur 6 | Inventaris menyebut `checkout-review-mock.spec.ts` sebagai fixture promo picker | File itu tidak meng-mock daftar promo; angka promonya fixture DB nyata untuk subsidi ongkir delivery (176.500/160.000), jadi dibiarkan | Angka acuan D3 adalah konteks pickup tanpa ongkir; memaksanya membuat ekspektasi uang tidak konsisten. User menyetujui "Biarkan sesuai skenario subsidi ongkir" (2026-11-14) | AC-12 dipenuhi oleh fixture picker nyata (`discounts-coupon-mock`) + DTO promo detail (`status-colors-mock`); tidak ada spek promo fiktif |
| Fitur 6 | “Seluruh spec mock yang memuat data promo” | `e2e/store/checkout-stock-adjustment-mock.spec.ts` juga memuat `/api/discounts/available`, tetapi daftar promo-nya kosong (`items: []`) | Tidak ada angka promo untuk disamakan | Tidak ada perubahan |
| Fitur 2/3 | Hanya update assertion copy di `delivery-quote-mock.spec.ts` | Ditambah seeding `/__control/stocks/ensure` (location 900001/item 900001) di `beforeAll` | Sebelum seeding, `POST /api/cart/validate-checkout` selalu 503 `observation_missing_or_invalid` sehingga spec tidak pernah mencapai checkout; murni perbaikan fixture test | Spec berjalan penuh (24 passed); tanpa perubahan app code |
| Fitur 2 | Validasi pickup menampilkan error pada setiap field | Error jam hanya tampil jika tanggal sudah dipilih | Field jam disabled tanpa tanggal; menampilkan error pada kontrol disabled membingungkan | Test AC-02 menyesuaikan (tanggal dulu, lalu jam); AC-02 tetap terpenuhi |

## Evidence implementasi

Verifikasi dijalankan 2026-11-14 dari root repo (DB `storefront` untuk mock E2E;
satu DB disposable `marketplace_discounts_test_copydensity_20261114` untuk spec
coupon).

| AC | Status | Evidence |
|---|---|---|
| AC-01 legenda + wajib | Verified | `checkout-density-mock` test 1 (legenda, `required`, `aria-required`); capture `playwright/mcp/checkout-density/checkout-1440-full.png` |
| AC-02 error per field + fokus | Verified | `checkout-density-mock` test 1 (`pickupDate`→`pickupTime`→telepon→email, `aria-invalid`) |
| AC-03 waktu aksesibel | Verified | `checkout-density-mock` test 1 (nama `Waktu Pickup`, listbox via keyboard, `aria-describedby` `pickupTime-hint`) |
| AC-03b pesan Indonesia | Verified | `checkout-density-mock` test 2 (server reject + network abort) |
| AC-04 InfoHint | Verified | `checkout-density-mock` test 3 (hover, click, Enter, Escape + fokus, 24×24) |
| AC-05 kartu cabang 390/320 | Verified | `checkout-density-mock` test 4–5 + capture `checkout-390-full.png`, `checkout-320-viewport.png` |
| AC-06 disclaimer non-amber | Verified | `checkout-density-mock` test 4–5 (`bg-amber-50` = 0) + capture |
| AC-07 review ringkas | Verified | `checkout-density-mock` test 6 + `review-1440-full.png` |
| AC-08 hasil netral | Verified | `checkout-density-mock` test 7, `status-colors-mock` test 38 (11 passed), capture `result-390.png`, `result-no-id-1440.png` |
| AC-09 konsistensi label/hint | Verified | typecheck + lint store PASS; capture step 1/review |
| AC-10 tests + typecheck/lint + rendered review | Verified | `verify:types:store` PASS, `lint:store` PASS, mock E2E 31 passed (density + delivery-quote), 11 passed (status-colors) |
| AC-11 validasi pickup saat klik | Verified | `checkout-density-mock` test 1 + `delivery-quote-mock` pertama (gating delivery tidak berubah) |
| AC-12 fixture promo | Verified | `status-colors-mock` (benefit 20000) 11 passed; `discounts-coupon-mock` pagination + picker 2 passed (Potongan/Hemat total 20.000/22.200) |
| AC-13 evidence tiga tingkat | Verified | `playwright/mcp/checkout-density/`: first viewport, full page, focused (error, InfoHint, checkbox, hasil) |
| AC-14 tanpa gateway/metode | Verified | Capture + assertion (`Midtrans`/`QRIS` = 0); `rg` store tsx hanya menyisakan komentar kode |

### Limitations (jujur, belum terverifikasi)

- `npm run test:unit` terhadap DB `storefront`: 2234 passed, 104 skipped, 9 file
  DB-gated menolak DB non-disposable (guard by design; perubahan ini tidak
  menambah test DB).
- Full unit suite pada DB disposable `marketplace_discounts_test_copydensity_20261114`
  dijalankan **serial** dengan `npm run verify:batch:unit`: **2432 passed, 25 skipped,
  0 failed**. Run paralel (`test:unit`) sempat merah pada DB test admin karena file
  DB berbagi gate global `discounts.contractVersion`; ini bukan defect dan sudah
  dicatat sebagai catatan testing di [`docs/testing/README.md`](../../docs/testing/README.md).
- Sisa item di luar scope dipisah ke
  [Outstanding follow-up setelah plan ditutup](../research/outstanding-follow-ups.md).
- Full run `e2e/store/discounts-coupon-mock.spec.ts` di DB disposable baru masih
  gagal pada satu assertion pre-existing di luar scope: provider line amount
  `125000` (harapan spec, kontrak provider2) vs `138750` (aktual, kontrak
  provider3 aktif karena preflight pajak seed baru). Test yang diubah plan
  (pagination + picker) lulus. Tidak diubah agar tidak memperluas scope.
- Legacy `npm run test:e2e` tidak dijalankan (butuh izin terpisah).
- Tidak ada commit/push/remote/deployment.

## Open questions

- **Implementasi: selesai 2026-11-14** atas perintah user. Keputusan D1–D6 dan
  historis tidak dibuka ulang.
- Sisa terbuka (bukan scope plan ini): legacy `npm run test:e2e`, assertion
  provider amount provider2/provider3 di `discounts-coupon-mock`, dan keputusan
  produk fase 2 (T23–T26).
- Tidak ada deployment/env/schema change. Kebijakan draft, arsip kode pickup,
  dan WA bukan keputusan yang dibutuhkan untuk menyelesaikan plan 1.

## Evidence untuk revisi dokumen

| Kriteria revisi | Status | Evidence |
|---|---|---|
| Koreksi cross-check masuk tanpa menghapus asal/approval historis | Verified | Tabel integrasi, section Approval, link cross-check |
| Hasil tanpa fetch tidak mengklaim status terverifikasi | Verified (kontrak dokumen) | Scope 4, AC-08, copy final, state matrix, test matrix query |
| Temuan baru tidak diam-diam memperluas plan 1 | Verified | Non-scope dan pemetaan fase 2 |
| Keputusan D1–D6 tercatat | Verified (kontrak dokumen) | Section “Keputusan terbuka”, AC-12 revisi D3, AC-14 D5/D6, Implementation notes |
| Implementasi AC-01–AC-14 | Verified | Lihat [Evidence implementasi](#evidence-implementasi) (mock E2E, typecheck/lint, rendered capture) |
| Approval versi revisi | Verified (dokumen) | User memilih “Catat + tandai disetujui, belum implementasi” pada 2026-11-14 |


## Retirement checklist

- [x] Semua fitur lulus `verify:` (lihat Evidence implementasi + limitations).
- [x] Docs fitur checkout diperbarui (`versioned-checkout-pricing`, `delivery-quotes`,
      `discount-redemption`, `order-flow`, `testing/README`).
- [x] Plan tetap disimpan; index fitur diperbarui dengan hasil + evidence.
- [x] Tidak ada commit/push tanpa izin terpisah.
