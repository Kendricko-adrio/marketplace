# Spesifikasi audit UI/UX checkout dan pembayaran store

## 1. Masalah dan tujuan

User merasa tampilan store, terutama checkout dan detail pembayaran, terlalu banyak tulisan dan informasinya menumpuk. Audit perlu membedakan masalah kepadatan, hierarki, copy, interaksi, dan status transaksi sebelum memutuskan perbaikan.

Tujuannya menghasilkan kumpulan screenshot UI existing yang dapat direview bersama, pemeriksaan perilaku pada browser, serta rekomendasi berbasis evidence. **Ini spec audit, bukan spec implementasi redesign.** Menemukan masalah UI tidak berarti audit gagal; audit gagal jika cakupan/bukti tidak cukup atau kesimpulannya tidak dapat ditelusuri.

Sumber utama: [benchmark dan protokol riset](../research/benchmark-ux-store-dan-protokol-review.md), termasuk referensi S1–S7. Statistik sumber bukan pengukuran conversion store ini.

## 2. Kesepakatan dan approval

- Kesepahaman: user memilih data demo terkontrol, mengizinkan percobaan login akun demo seeded lokal, serta memilih seluruh flow store pada desktop/mobile melalui `ask_user_question`.
- User meminta spec yang menjelaskan seluruh pemeriksaan dan review; permintaan ini menjadi dasar penyusunan draft ini.
- **Approval complete spec:** disetujui user pada 2026-11-14 melalui percakapan: “oke saya approve draft specnya”. Approval mencakup seluruh scope, seam browser dengan data simulasi, runbook tooling, matriks capture, checklist dan AC01–AC10 pada dokumen ini. Hasil akhir adalah report audit; review gambar bersama user tetap mendahului rekomendasi final.
- Approval audit tidak memberi izin perubahan aplikasi, transaksi provider, subagent, commit, push, remote access, atau deployment.
- Seam verifikasi yang diusulkan: perjalanan pelanggan pada **UI asli di browser**, dengan respons API bisnis disimulasikan. Persetujuan spec termasuk konfirmasi bahwa seam ini sesuai; ini bukan pengujian integrasi pembayaran/backend.

## 3. Solusi dan keluaran

1. Inventaris flow dan state yang eksplisit, dengan daftar cakupan dan keterbatasan.
2. Screenshot desktop/mobile yang dikelompokkan menurut perjalanan pelanggan; first viewport dan full-page untuk layar utama.
3. Galeri lokal berlabel **data simulasi**, indeks gambar, serta catatan interaksi/accessibility.
4. Review bersama user, tanpa menetapkan solusi final sebelum user meninjau gambar.
5. Laporan temuan dan rekomendasi terurut, setiap temuan tertaut ke screenshot atau catatan interaksi, prinsip benchmark, serta dampak tugas.
6. Tabel AC → evidence yang tidak menyamakan screenshot, mock interaction, dan bukti integrasi nyata.

## 4. Cerita pengguna

1. Sebagai pemilik store, saya ingin melihat perjalanan pelanggan utuh agar masalah tidak dinilai dari potongan halaman.
2. Sebagai reviewer, saya ingin membandingkan desktop/mobile pada data sama agar perbedaan layout terlihat adil.
3. Sebagai pelanggan delivery, saya ingin alamat, penerima, kurir, estimasi dan biaya mudah diverifikasi.
4. Sebagai pelanggan pickup, saya ingin cabang, jadwal dan persyaratan pickup jelas tanpa membaca informasi delivery.
5. Sebagai pelanggan, saya ingin memahami total final, pajak, ongkir dan diskon sebelum melanjutkan pembayaran.
6. Sebagai pelanggan, saya ingin mengetahui akibat tombol utama dan perpindahan ke provider.
7. Sebagai pelanggan, saya ingin bantuan tambahan tersedia tanpa mengalahkan informasi utama.
8. Sebagai pelanggan pemakai promo, saya ingin memahami promo terpasang, penolakan dan perubahan total.
9. Sebagai pelanggan yang menemui error, saya ingin tahu cara melanjutkan tanpa mengisi ulang semuanya.
10. Sebagai pelanggan dengan pembayaran pending, saya ingin mengetahui apakah masih perlu membayar atau menunggu verifikasi.
11. Sebagai pelanggan yang sudah lunas, saya ingin membedakan status pembayaran dari kesiapan/pengiriman barang.
12. Sebagai pelanggan mobile/keyboard, saya ingin dapat menjangkau dan mengoperasikan kontrol penting.
13. Sebagai pemilik store, saya ingin rekomendasi membedakan risiko transaksi, friksi tugas dan polish visual.
14. Sebagai pemilik store, saya ingin mereview gambar terlebih dahulu sebelum menyepakati arah redesign.

## 5. Scope dan non-scope

### Termasuk

- Checkout `/checkout`: pengiriman/pickup, alamat, kurir, kontak, review pembayaran, promo, konfirmasi, feedback dan recovery yang ada.
- `/checkout/result`: pending, berhasil, gagal/batal sebagaimana UI existing; audit apakah copy sesuai kepastian status.
- `/account/orders/[id]`: pembayaran pending/paid, pemenuhan delivery/pickup, informasi barang, nominal, action dan feedback.
- Header/footer yang muncul pada flow ini, hanya untuk menilai distraksi, orientasi dan konsistensi.
- Pemeriksaan copy, hierarki, grouping, spacing, clickability, responsive, accessibility terarah, serta perilaku edit/back/error.

### Tidak termasuk

- UI Midtrans, pembuatan token/session pembayaran baru, pembayaran nyata, webhook atau perubahan Jubelio.
- Audit katalog, product list/detail, cart, login/onboarding, seluruh account, admin atau email sebagai surface tersendiri. Checklist toko umum tetap menjadi konteks benchmark, bukan perluasan scope.
- Perubahan fitur, copy produksi, komponen/token, aturan pajak/promo/stock, schema, env/config, deployment atau data bisnis.
- Prototype/redesign, spec implementasi perbaikan, ticket breakdown, usability testing dengan peserta representatif, analytics/conversion experiment, audit legal/PCI atau sertifikasi WCAG.
- Dark theme dan semua kombinasi perangkat/browser; baseline audit adalah Chromium, light theme.

## 6. Keselamatan akses dan data

1. Gunakan local store yang aktif; verifikasi kembali origin/port. Jangan menganggap hasil akses riset sebelumnya masih berlaku.
2. Boleh mencoba login akun demo seeded sesuai izin. Jangan membuat akun, mengubah onboarding/password, seed/reset DB atau memakai akun customer nyata. Jika gagal/belum onboarding, berhenti dan laporkan kebutuhan akses.
3. Session auth server boleh nyata; data bisnis yang terlihat harus demo. Jangan mencetak credential/cookie/token atau menaruhnya di screenshot/artefak research.
4. Intercept API bisnis sebelum membuka halaman. Gunakan allowlist fixture; request mutasi bisnis yang tidak dikenali harus diblokir, bukan diteruskan. Mock read API juga untuk mencegah tampilnya data pribadi nyata.
5. Batasi navigasi/request keluar origin. Semua aksi bayar/lanjut bayar harus berhenti di boundary lokal yang jelas atau diblokir; jangan mengikuti URL provider nyata. `Beli lagi`/simpan alamat juga tidak boleh menulis cart/alamat nyata.
6. Verifikasi kode halaman/layout yang akan dibuka tidak memicu provider write server-side. Browser interception saja tidak menjamin tidak ada side effect server; hentikan surface yang belum aman.
7. Label simulasi berada pada galeri/indeks, **bukan overlay atau CSS yang mengubah UI yang dinilai**. Jangan mengganti teks asli, spacing atau styling untuk mempercantik screenshot.
8. Layar hasil dan detail order dapat dikunjungi dengan fixture secara terpisah. Jangan mengklaim kesinambungan transaksi nyata hanya karena galeri disusun berurutan.
9. Jalur utama adalah **Playwright lokal + Chromium headless yang sudah terpasang**, karena telah lulus preflight (bagian 7.1–7.3). Browser MCP bukan prasyarat audit. Tidak menginstal browser atau mengubah konfigurasi project diam-diam jika jalur utama gagal.

## 7. Rancangan teknis audit

Tidak ada perubahan module aplikasi, API contract atau schema. File aplikasi berikut **dibaca dan dirender, bukan diedit**.

| Path lengkap dari root | Tanggung jawab dalam audit | Layer / seam |
|---|---|---|
| `apps/store/src/app/checkout/page.tsx` | Step fulfillment dan review, submit/feedback, copy dan hierarchy. | UI; browser journey |
| `apps/store/src/components/checkout/DeliveryQuotePanel.tsx` | Alamat/modal, layanan, filter/pagination, loading/error quote. | UI; browser journey |
| `apps/store/src/components/checkout/PromoSelector.tsx` | Ringkasan promo terpasang dan aksi. | UI; browser journey |
| `apps/store/src/components/checkout/PromoSelectionDialog.tsx` | Picker/kode/pagination dan konfirmasi kenaikan total. | UI; browser journey |
| `apps/store/src/components/checkout/CheckoutTaxFeedback.tsx` | Feedback ketika pajak belum tersedia. | UI; browser journey |
| `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx` | Feedback attempt/recovery. | UI; browser journey |
| `apps/store/src/app/checkout/result/page.tsx` | Hasil pending/success/cancel berbasis query. | UI; browser + sumber status |
| `apps/store/src/app/account/orders/[id]/page.tsx` | Status, action, barang, empty/error, pickup code. | UI; browser journey |
| `apps/store/src/components/orders/OrderPaymentSummary.tsx` | Grup nominal, metode, lanjut bayar/recovery. | UI; browser journey |
| `apps/store/src/components/orders/OrderFulfillmentPanel.tsx` | Alamat/pickup/tracking/timeline dan link. | UI; browser journey |
| `apps/store/src/components/Header.tsx`, `apps/store/src/components/FooterWrapper.tsx` | Konteks navigasi dan distraksi pada flow. | UI; rendered comparison |
| `apps/store/src/app/checkout/layout.tsx`, `apps/store/src/lib/server-access.ts`, `apps/store/src/proxy.ts` | Batas akses store, tidak diganti atau dibypass. | Auth guard; akses browser |
| `e2e/store/order-detail-presentation-mock.spec.ts`, `e2e/store/checkout-review-mock.spec.ts` | Referensi shape fixture dan pola interaksi; jangan menjalankan setup mutatif. | Prior art, read-only |

### Artefak yang dibuat saat audit

| Path lengkap dari root | Isi / kontrak |
|---|---|
| `playwright/mcp/checkout-ux-review/capture.cjs` | Script disposable bila diperlukan, hanya akses aman dan capture; bukan E2E suite baru. |
| `playwright/mcp/checkout-ux-review/manifest.json` | Daftar evidence machine-readable. |
| `playwright/mcp/checkout-ux-review/gallery.html` | Galeri lokal, urutan flow, caption simulasi, link full-size. Tidak menampilkan secret atau memuat resource eksternal. |
| `playwright/mcp/checkout-ux-review/screenshots/` | PNG first viewport/full-page/modal; gitignored. |
| `.scratch/checkout-simplification/research/indeks-capture-ux-checkout.md` | Indeks tahan lama: ID, state, viewport, fixture, path, cakupan dan keterbatasan. |
| `.scratch/checkout-simplification/research/review-ux-checkout-pembayaran.md` | Catatan walkthrough, checklist, masukan user, temuan dan rekomendasi setelah review. |
| `.scratch/checkout-simplification/index.md` | Navigasi artefak, approval/status audit dan evidence; tidak mengubah status plan lama. |

Kontrak export aplikasi: **N/A**, tidak ada perubahan. Script standalone tidak menambah public module API.

Kontrak manifest per evidence: `id`, `scenarioId`, `viewport` (width/height), `captureType` (`viewport`/`full-page`/`modal`/`interaction`), `path` (jika ada), `route`, `fixtureId`, `dataMode` (`simulated`), `capturedAt`, `observation`, `limitations`. Status skenario disimpan pada indeks sebagai `Captured`, `Pending`, atau `N/A` dengan alasan. Jangan memasukkan URL bertoken/credential atau raw request sensitif.

Keputusan struktur: gunakan artefak research pada fitur existing, tidak membuat app preview atau route bypass auth. Ditolak: menyalin JSX menjadi mockup, karena tidak merepresentasikan UI yang sedang digunakan.

Context7 checkpoint riset: `/microsoft/playwright` telah mengonfirmasi route interception/abort, `serviceWorkers: 'block'`, dan `page.screenshot({ fullPage: true })`. Sebelum menulis script dengan API lain yang belum dikonfirmasi, cek dokumentasi/types installed sesuai aturan repo. Penyusunan Markdown ini tidak menyentuh external API.

### 7.1. Toolchain yang telah dibuktikan

Sumber evidence: [laporan preflight Playwright dan akses store](../research/preflight-playwright-dan-akses-store.md). Hasil ini berlaku pada lingkungan saat preflight, bukan jaminan semua state audit bebas error. **Cukup aman digunakan untuk audit demo dalam boundary bagian 6**, bukan izin transaksi nyata atau bukti integrasi provider.

| Kemampuan | Hasil preflight | Evidence / implikasi untuk agent |
|---|---|---|
| Runtime dan browser | Node `v24.14.0`, Playwright `1.62.1`, Chromium `151.0.7922.34` dapat launch/close. | Gunakan package lokal dan Chromium terpasang melalui script Node; jangan memulai dengan MCP yang belum berfungsi. Versi ini catatan hasil, bukan instruksi upgrade/pinning dependency. |
| Server/env dasar | `http://localhost:3000` HTTP 200; file root/app env tersedia; database/auth secret terisi, auth/public URL sesuai origin lokal. | Baca presence/origin tanpa mencetak nilai secret; runtime auth diverifikasi lewat request nyata, bukan sekadar file env. |
| Login via UI | Akun demo seeded berhasil HTTP 200; payload cocok; session store nyata, email verified dan onboarding lengkap. | Credential mengikuti `e2e/config.ts` dan `packages/db/src/seed.ts`, tanpa menyalin password ke spec/log. Jangan mengandalkan storage state lama atau mock session browser untuk melewati server guard. |
| Browser route interception | Cart, cabang dan detail order dapat diisi fixture sebelum navigasi. | `serviceWorkers: 'block'`; request bisnis yang tidak dikenali diblokir. Hanya auth yang diizinkan nyata. |
| Protected checkout | Heading `Cara Pengiriman` tampil dengan cart/cabang demo. | Auth server dan fixture browser dapat dipakai bersama, tanpa mengubah cart nyata. |
| Detail dan hasil pembayaran | `Detail Pesanan` mock dan result `Menunggu Pembayaran` berhasil tampil. | Dapat membuka surface ini tanpa membuat order atau session pembayaran provider. |
| Screenshot | 8 PNG valid; login/checkout desktop-mobile, viewport/full-page checkout, detail mobile dan result pending mobile. | Ukuran viewport 1440×900/390×844; PNG signature/dimensi diperiksa. Contoh checkout mobile/detail diperiksa secara visual. Ini bukan bukti desktop/mobile semua surface sudah tercakup. |
| Error runtime | Tidak ada `pageerror` pada jalur preflight terakhir. | Tetap catat console warning/error serta issue development; tidak ada `pageerror` bukan berarti aplikasi bebas warning. |

Command yang berhasil, dijalankan dari root repo:

```bash
node playwright/mcp/preflight-checkout-ux/probe.cjs
```

Hasil terakhir: **exit 0, PF01–PF09 Verified, 8 PNG**. Script dan log berada di folder gitignored `playwright/mcp/preflight-checkout-ux/`; bukan dependency permanen yang dijamin ada di checkout lain. Jika tersedia, baca script dan `report.json`/`report.md` sebagai prior art. Jika hilang, gunakan prosedur di bawah untuk membangun script disposable di path capture yang ditetapkan; jangan menganggap file hilang sebagai alasan memasang tool baru.

### 7.2. Runbook agent untuk menggunakan jalur proven

1. **Mulai dari evidence existing.** Baca laporan preflight dan bagian ini sebelum memilih tool. Cek server/package/browser masih tersedia; tidak perlu mengulang seluruh preflight hanya untuk reassurance. Ulangi focused probe jika kondisi berubah, log hilang, atau ada kegagalan konkret.
2. **Launch melalui Node + package Playwright lokal**, `chromium.launch` headless dan browser context light theme dengan `serviceWorkers: 'block'`. Gunakan viewport sesuai matriks; resize melalui `page.setViewportSize` sudah terbukti berjalan. Jangan mengubah env/config aplikasi untuk menjalankan script.
3. **Pasang network boundary sebelum navigasi.** Allowlist nyata preflight: POST `/api/auth/sign-in/email`, GET `/api/auth/get-session`, GET `/api/onboarding/sync`. Cart/cabang/order memakai fixture; request API bisnis lain fail-closed sampai fixture eksplisit ditambahkan sesuai skenario. Blokir request keluar origin dan mutasi non-API yang tidak diizinkan. Route interception browser tidak mencakup `context.request`; jika APIRequestContext dipakai, batasi eksplisit hanya GET session lokal seperti preflight, bukan menganggapnya dilindungi route browser.
4. **Login melalui form UI.** Gunakan label `Email`/`Password`; scope tombol `Masuk` ke dalam `form`, bukan locator global karena header juga memiliki tombol senama. Verifikasi nilai input dan kecocokan payload sebagai boolean tanpa mencetak credential. Tangani wait response dan click bersama supaya kegagalan click tidak meninggalkan promise tak tertangani.
5. **Verifikasi akses nyata.** Login HTTP 200 saja belum cukup: pastikan redirect ke `/checkout`, bukan `/onboarding` atau `/login`; GET session memiliki user/session valid, `emailVerified` dan `onboardingCompleted` true. Jika gagal, berhenti dan rekam status serta code/message teredaksi, tanpa seed/reset/ubah akun.
6. **Siapkan selection dan fixture secara eksplisit.** Preflight memakai `checkoutSelectedItemIds` di sessionStorage yang cocok dengan ID fixture cart. Gunakan shape dari source/DTO existing, bukan manipulasi internal React atau bypass layout. Tautkan setiap fixture audit ke skenario; jangan memakai seluruh data contoh preflight sebagai pengganti dataset audit di bagian 10.
7. **Tunggu UI yang benar, bukan delay tetap.** Heading/state target harus visible; tunggu font siap melalui `document.fonts.ready` serta indikator `Compiling`/`Rendering` tidak tampil. Screenshot memakai `animations: 'disabled'`; viewport dan `fullPage` sesuai kebutuhan. Jangan memakai CSS untuk menutupi error/indikator atau mengubah layout.
8. **Periksa hasil.** Verifikasi PNG signature/dimensi dan screenshot mewakili state target, bukan login/spinner. Simpan metadata/manifest dan log teredaksi. Screenshot audit yang berhasil boleh dibuka untuk review; kegagalan runner tetap didiagnosis dari teks/Markdown, bukan attachment gambar kegagalan.
9. **Tutup browser/context setelah batch.** Preflight tidak menyimpan storage state/token baru ke disk. Session auth server dapat tetap ada; jangan menghapusnya lewat query DB. Gunakan izin login yang ada untuk akses yang diperlukan, bukan membuat akun/sesi berulang tanpa alasan.

Context7 checkpoint preflight: `/microsoft/playwright/v1.62.1` — locator, viewport, route interception JSON, Service Worker blocking dan screenshot animations. API tambahan yang belum dikonfirmasi tetap mengikuti lookup dokumentasi/types installed; keberhasilan preflight tidak membenarkan menebak kontrak baru.

### 7.3. Batas bukti dan penanganan masalah yang diketahui

| Kondisi | Yang diketahui | Instruksi agent |
|---|---|---|
| MCP Chrome gagal ditemukan | `browser_tabs` gagal; Chromium lokal berhasil. | Pakai jalur utama lokal, tidak perlu terus mencoba MCP/install Chrome. Perbaikan MCP tidak termasuk audit. |
| Locator `Masuk` ambigu | Dua tombol cocok setelah header tampil. | Gunakan scope form sebagaimana runbook; jangan memilih `.first()` sembarang untuk melewati ambiguitas. |
| HTTP 400 login awal | Satu percobaan awal gagal; dua submit berikutnya berhasil. Body awal tidak terekam, penyebab belum diketahui. | Jangan menyebut penyebab atau mengklaim bug sudah diperbaiki. Jika berulang, tangkap status/code/message dan kecocokan payload teredaksi, diagnosis dahulu; hindari retry buta. |
| Badge development `2 Issues` | Terlihat pada checkout meski tidak ada pageerror; detail keduanya belum diketahui. | Bedakan dari UI produk. Baca detail issue lewat teks bila bisa; catat keterbatasan. Jika menutupi evidence penting/menghalangi interaksi, state itu Pending sampai dapat diperiksa, bukan disembunyikan diam-diam. |
| Warning logo Next Image | Diagnostik login menemukan width/height CSS yang perlu pasangan `auto`; belum terbukti sama dengan dua issue checkout. | Catat terpisah; tidak memperbaiki logo di scope audit. |
| State audit lanjutan | Preview/review payment, delivery quote, modal/promo, recovery, reflow, keyboard/contrast belum dibuktikan preflight. | Verifikasi per skenario dengan fixture aman; jangan menandainya lulus dari bukti login/screenshot dasar. |
| Provider/env eksternal | Midtrans/Jubelio/SMTP/OAuth tidak diuji; satu nama env provider tidak membuktikan konfigurasi lengkap. | Tidak dibutuhkan untuk capture demo; jangan menguji provider untuk melengkapi preflight. |

Keberhasilan preflight tidak mengubah AC01–AC10 audit menjadi Verified, tidak mengubah approval spec, dan tidak menjamin jalur tooling akan selalu bebas error setelah lingkungan berubah.

## 8. Rancangan UX audit dan referensi

**Tugas utama:** pelanggan mereview fulfillment dan jumlah tagihan, memahami tindakan pembayaran, lalu memahami hasil dan status pesanan. Audit tidak menetapkan layout pengganti.

**Referensi pembanding:** checkout payment dibandingkan dengan `OrderPaymentSummary` pada detail order untuk nominal/action; delivery dibandingkan dengan `OrderFulfillmentPanel` untuk alamat/kurir/status. Keduanya objek audit, bukan standar yang otomatis benar. Button, modal, select, read-only input dan status dibandingkan dengan shared components/token existing berikut:

| Pattern existing | Path |
|---|---|
| Button | `packages/ui/src/components/ui/button.tsx` |
| Dialog | `packages/ui/src/components/ui/dialog.tsx` |
| Select | `packages/ui/src/components/ui/select.tsx` |
| Read-only input | `packages/ui/src/components/ui/read-only-input.tsx` |
| Status | `packages/ui/src/components/ui/status-badge.tsx`, `packages/ui/src/lib/status-presentation.ts`, `packages/ui/src/lib/status-styles.ts` |
| Token store | `apps/store/src/app/globals.css` |

Component reuse baru: N/A, tidak membangun UI produk baru. Prototype: tidak diminta dan tidak dibuat. Final copy baru: N/A; catat copy existing secara verbatim pada evidence, lalu usulkan revisi hanya sebagai rekomendasi setelah review.

### Viewport dan bentuk capture

- Desktop **1440×900**, mobile **390×844**, Chromium, light theme, zoom browser normal.
- Setiap baris matriks di bawah dicapture pada kedua viewport. Layar utama: first viewport dari posisi scroll paling atas **dan** full-page; modal/dropdown/state transien: viewport. Bukti interaksi tambahan boleh berupa catatan terstruktur tanpa PNG duplikat.
- Periksa reflow tambahan pada **320 CSS px** untuk checkout review dan detail order, serta pembesaran teks 200% pada dua surface tersebut. Ini pemeriksaan terarah, bukan semua kombinasi screenshot atau audit WCAG penuh.
- Gunakan fixture sama antarviewport. Catat browser/version, waktu capture, tanggal/jam/timezone yang dipakai untuk slot/ETA, theme dan state agar perbandingan tidak bias.
- Jangan menetapkan kegagalan hanya karena halaman panjang. Catat urutan informasi, tinggi halaman/jumlah scroll indikatif, lokasi CTA dan pengulangan; jangan mengarang batas maksimum kata atau jumlah card universal.

## 9. Matriks state dan capture

Semua baris adalah target pemeriksaan, bukan klaim state sudah berhasil direproduksi. Substate yang dipisahkan dengan titik koma mendapat evidence terpisah bila tampilannya berbeda. Tidak mengalikan seluruh state dengan semua metode/status: matriks ini menetapkan kombinasi representatif secara eksplisit.

| ID | Surface / state | Hal yang dicapture dan diperiksa |
|---|---|---|
| F01 | Checkout awal | Indikator step, metode default, petunjuk dan primary action sebelum pilihan lengkap. |
| F02 | Pickup siap | Cabang, alamat/jam operasional, tanggal, slot, telepon/email, akses `Lanjut`. |
| F03 | Pickup tidak valid/tidak tersedia | Slot tidak tersedia; validasi kontak; alasan tidak bisa lanjut dan cara memperbaiki. |
| F04 | Delivery awal | Pilihan `Kirim ke alamat`, alamat belum dipilih, kontak dan CTA. |
| F05 | Alamat existing | Dropdown terbuka; alamat terpilih lengkap dengan nama/telepon/alamat. |
| F06 | Alamat baru | Modal kosong; draft lengkap; field/region validation atau kegagalan memuat region. Periksa draft saat batal/buka ulang tanpa menyimpan alamat nyata. |
| F07 | Buku alamat kosong/gagal | Empty; error memuat alamat dan retry. |
| F08 | Quote ongkir | Loading; error; tidak ada layanan. Uji recovery tanpa harga stale. |
| F09 | Layanan siap | Layanan terpilih, ongkir/ETA, kategori dan pagination termasuk halaman kedua. |
| F10 | Ganti tujuan/metode | Ganti alamat; delivery ↔ pickup. Catat reset pilihan/quote dan data yang bertahan. |
| P01 | Review pickup | Barang, kontak, cabang/slot, metode, breakdown, total dan konfirmasi. |
| P02 | Review delivery | Barang, penerima/alamat, origin/kurir, kontak, breakdown dan total. |
| P03 | Konfirmasi | Belum dicentang; dicentang. Periksa copy persetujuan dan enable/disabled CTA. |
| P04 | Picker promo | Modal terbuka dengan daftar, kode, promo tidak eligible dan pagination halaman kedua. |
| P05 | State promo | Promo terpasang; kode invalid; daftar kosong; daftar gagal/retry. |
| P06 | Ganti/lepas promo | Total naik → dialog, batal dan konfirmasi; total turun → review terbaru. Periksa acknowledgement reset tanpa transaksi. |
| P07 | Promo gugur | Alasan gugur dan tindakan lanjut tanpa promo, tanpa mengklaim nilai diskon yang tidak berlaku. |
| P08 | Preview/submit | Loading preview; preview gagal/pajak tidak tersedia; loading submit; submit error dengan input tetap ada. Submit seluruhnya diintercept. |
| P09 | Recovery checkout | Request tersimpan/status belum pasti, refresh/retry, next action tanpa order pengganti. |
| P10 | Perubahan stock/harga | Feedback stock adjustment; review total baru/reprice dan kebutuhan persetujuan ulang. |
| R01 | Hasil pending | Status, pesan, CTA detail pesanan; jangan menyamakan pending dengan gagal. |
| R02 | Hasil success | Pesan, order ID, CTA detail; periksa apakah copy pickup/delivery dan tingkat kepastian status tepat. |
| R03 | Hasil gagal/batal | Pesan dan jalan pemulihan; bedakan apa yang diketahui dari query dengan status order yang benar-benar terverifikasi. |
| O01 | Detail pending delivery | Status, lanjut bayar, nominal, tujuan/layanan, barang dan next action. |
| O02 | Detail pending pickup | Status/lanjut bayar, cabang/slot, gating kode pickup dan nominal. |
| O03 | Detail paid delivery | Pembayaran lunas dengan fulfillment masih processing; paid tetapi fulfillment blocked sebagai evidence terpisah. |
| O04 | Delivery tracking | Dalam perjalanan; terkirim; timeline ringkas dan terbuka; resi/tautan tracking/bukti. |
| O05 | Detail paid pickup | Belum siap; ready dengan kode; completed. Periksa makna status dan instruksi berikutnya. |
| O06 | Recovery pembayaran | Payment session belum tersedia/verifikasi; action retry dan feedback, tanpa membuat session nyata. |
| O07 | Detail gagal/batal | Payment failure; order cancelled, termasuk apakah copy menyampaikan kewajiban/next action dengan tepat. |
| O08 | Detail loading/error | Loading; gagal GET/retry; order tidak ditemukan. |
| O09 | Data parsial/panjang | Snapshot tidak tersedia; tanpa resi; label status asing; nama barang/alamat/ID panjang, serta banyak item. |
| O10 | Feedback action | Salin ID/resi/kode sukses dan clipboard ditolak; link tracking dapat dikenali dan boundary navigasi diblokir. |

State fallback checkout tanpa item/selection: uji perpindahan ke cart hanya sebagai boundary akses; jangan menjadikan cart surface audit baru. Jika diperlukan screenshot, mock API cart dan hentikan setelah boundary tercatat.

State yang terhalang akses/kontrak tetap **Pending**, bukan N/A. N/A hanya jika source/render menunjukkan state memang tidak berlaku pada surface tertentu dan alasan dicatat. Tambahan state di luar matriks dicatat sebagai discovery; perubahan scope besar kembali ke user.

## 10. Fixture dan kontrak list

- Dataset sintetik: pelanggan/penerima demo, alamat dan kontak fiktif, satu cabang, produk/varian berlabel realistis tanpa PII.
- Baseline nominal tertulis independen: barang Rp150.000, PPN 11%. Pickup tanpa promo: PPN Rp16.500, total Rp166.500. Delivery ongkir Rp30.000: taxable base Rp180.000, PPN Rp19.800, total Rp199.800. Nilai ini fixture, bukan klaim konfigurasi/harga store nyata.
- Dataset promo/reprice/stock menuliskan input dan expected breakdown tersendiri sesuai kontrak yang diverifikasi; jangan menghasilkan expected value memakai fungsi pricing yang sedang diaudit.
- Barang baseline 2 line items yang subtotalnya berjumlah Rp150.000; dataset panjang minimal 8 line items untuk menguji skala konten, dengan nominal konsisten.
- Fixture mengikat pickup/delivery, payment dan fulfillment status secara eksplisit. `paid` tidak otomatis `completed`; unknown tidak dibuat seolah failed/success.
- Promo: periksa scope dataset, paging, eligible/disabled, pilihan lintas halaman, loading/empty/error dan kode manual; jangan menyatakan pencarian backend ada bila UI tidak menyediakannya.
- Kurir: periksa kategori, pagination, jumlah hasil/indikator halaman, selected state saat berganti kategori/halaman, serta reset saat quote berubah. Dataset lebih dari satu halaman.
- Periksa URL/back/refresh sebagaimana existing; tidak menambah URL state, search atau sorting baru. Aspek yang tidak tersedia dicatat N/A dengan alasan, bukan diimplementasikan.

## 11. Checklist pemeriksaan lengkap

Setiap C01–C15 dari riset dipakai pada surface yang relevan. Hasil per kombinasi checklist/surface: **Terpenuhi / Masalah / Belum diverifikasi / N/A**, dengan evidence dan alasan. Tabel berikut memperinci pemeriksaannya.

| ID | Yang diperiksa | Cara memperoleh evidence |
|---|---|---|
| C01 | Orientasi: judul, step aktif, apa yang perlu diselesaikan dan next step. | First viewport + walkthrough F01–P02. |
| C02 | Primary/secondary action: dominansi, label akibat, posisi, clickable sebelum hover, disabled yang beralasan. | Screenshot CTA, tab/click dan state P03/P08. |
| C03 | Hierarki/grouping: heading, ukuran/weight teks, whitespace, divider/card, kedekatan label-field, distribusi emphasis dan distraksi header/footer. | Full-page + perbandingan desktop/mobile dan checkout/detail. |
| C04 | Copy dan beban baca: paragraf, pengulangan kontak/fulfillment/payment, istilah internal, helper text, instruksi yang bersaing dengan angka/action. | Inventaris setiap blok: verbatim, tujuan, kategori, keep/shorten/move/remove dan alasannya. Tidak memakai jumlah kata sebagai standar tunggal. |
| C05 | Disclosure: bantuan sekunder vs data wajib, label pembuka, mudah ditemukan/dikembalikan, tidak menyembunyikan biaya atau konsekuensi. | State tertutup/terbuka dan keyboard. |
| C06 | Akurasi review barang/fulfillment: varian, jumlah, harga, penerima, telepon, alamat, cabang, slot, kurir, ETA/origin. | Bandingkan fixture dengan UI; review pickup/delivery. |
| C07 | Nominal: hierarki total, format rupiah, subtotal/PPN/diskon/ongkir/subsidi/fee yang relevan, tidak dobel atau ambigu; stabil antarstep/detail. | Expected fixture literal + breakdown screenshot. |
| C08 | Promo: discoverability tanpa dominasi, status terpasang/gugur, eligibility, kode error, paging, ganti/lepas dan perubahan total. | P04–P07 + interaksi. |
| C09 | Keselamatan action: pengguna tahu order dibuat/redirect atau hanya review, submit ganda, loading, persetujuan dan total baru. | UI + request mock/log teredaksi + penelusuran handler; tidak menguji provider. |
| C10 | Feedback/recovery: loading, empty vs error, pesan dekat konteks, retry, input terjaga dan focus/scroll ke masalah. | F03/F07/F08/P08–P10/O06/O08. |
| C11 | Responsive: urutan baca, wrapping, overflow, dialog/footer/CTA terjangkau, sticky tidak menutup konten, konten panjang, dropdown. | 1440/390; pengukuran overflow; reflow 320 dan teks 200% terarah. |
| C12 | Accessibility: label nyata bukan placeholder, nama kontrol, heading/region, tab order, focus terlihat, Escape/focus return modal, keyboard select/radio/checkbox dan target pointer. | Interaksi keyboard, DOM semantics, pengukuran target. |
| C13 | Contrast/konsistensi: teks/hint/link/badge/focus, state tidak color-only, treatment status dan nominal lintas layar. | Computed colors terhadap background aktual + rasio, bandingkan shared pattern. |
| C14 | Status dan next action: pending/paid/failed/cancelled/unknown, payment vs fulfillment, hasil query vs bukti backend, kebenaran pesan pickup/delivery, tracking/timeline. | R01–O09 + source kontrak. |
| C15 | Kontinuitas: back/edit/refresh, reset quote/promo/ack, data draft dan pilihan yang bertahan, informasi yang berubah jelas. | Walkthrough terkontrol dengan catatan sebelum/sesudah. |

Detail accessibility: teks biasa 4.5:1, large text 3:1 dengan pengecualian WCAG; cue non-text yang diperlukan 3:1 sesuai SC 1.4.11. Target minimum SC 2.5.8 24×24 CSS px atau pengecualian yang sah; sekitar 44×44 dapat menjadi rekomendasi touch, bukan minimum AA. Badge pasif tidak otomatis membutuhkan border 3:1 jika teks sudah mengomunikasikan makna. Audit ini tidak membuktikan kepatuhan WCAG menyeluruh.

## 12. Prosedur review dan rekomendasi

1. Setelah approval spec, gunakan jalur proven dan runbook bagian 7.1–7.3; verifikasi akses, safety boundary dan dataset sebelum capture. Pertahankan evidence preflight yang masih relevan, bukan mengulang broad probe tanpa perubahan kondisi.
2. Capture per perjalanan: delivery → review → hasil/detail, lalu pickup dan state tambahan. Log kegagalan secara teks; kegagalan Playwright didiagnosis dari Markdown, bukan membuka screenshot attachment kegagalan. Screenshot audit yang berhasil boleh direview.
3. Periksa sendiri hasil capture: bukan login page/spinner tak disengaja, tidak terpotong, state benar, tidak ada PII, dan filename sesuai manifest.
4. Sajikan galeri + indeks lengkap kepada user, termasuk Pending. Tunjukkan observasi faktual dan checklist; **berhenti untuk review gambar bersama user sebelum menyusun rekomendasi final**.
5. Catat masukan user per ID gambar: masalah yang dirasakan, informasi yang sulit ditemukan, atau hal yang perlu dipertahankan. Jangan menjawab keputusan desain atas nama user.
6. Setelah review, susun temuan final: `ID → surface/evidence → observasi → dampak tugas → sumber Cxx/Sx → rekomendasi → prioritas → keputusan user → keterbatasan`.
7. Prioritas: **P0** berisiko menyesatkan tindakan/uang/status atau memblokir tugas; **P1** friksi besar/kepadatan/hierarki/pemulihan; **P2** polish/konsistensi minor. Sertakan alasan; bukan skor resmi Baymard.
8. Berikan contoh perubahan singkat input/action → hasil yang diharapkan untuk rekomendasi nontrivial. Bedakan perubahan copy/layout dari usulan mengubah flow/aturan bisnis. Tidak menjadikan rekomendasi sebagai izin implementasi.

## 13. Keputusan verifikasi

- Public seam utama adalah browser UI existing dengan fixture terkontrol; hindari assertion class/internal React state.
- Screenshot membuktikan tampilan, walkthrough membuktikan interaksi mock, source membantu menjelaskan kontrak; tidak ada yang otomatis membuktikan integrasi provider.
- Capture script melakukan safety/sanity checks: request bisnis tidak diteruskan, heading/state expected tampil, manifest cocok dengan file dan ukuran viewport. Catat command dan hasil aktual saat eksekusi; jangan menulis PASS sebelumnya.
- Tidak perlu full unit/typecheck/build/E2E suite untuk penyusunan dokumen atau audit tanpa perubahan aplikasi. Jangan menjalankan spec existing yang setup-nya mutatif untuk sekadar mendapat screenshot. Jika ditemukan bug, catat temuan; perbaikannya scope terpisah dan mengikuti debugging/TDD/verification gates.
- Jika state tidak dapat direproduksi aman, simpan error text, path kontrak yang diperiksa dan blocker; baris evidence tetap Pending.

## 14. Acceptance criteria dan evidence

Tabel ini menilai **pelaksanaan audit**, bukan mensyaratkan UI existing sempurna. Seluruh baris awal Pending sampai buktinya tersedia.

| AC | Kriteria yang dapat diverifikasi | Bukti kelulusan | Status awal |
|---|---|---|---|
| AC01 | Login sesuai izin, data bisnis demo, tidak ada mutasi bisnis/provider atau kebocoran secret. | Catatan akses, allowlist/boundary, log request teredaksi dan audit script/source. | Pending |
| AC02 | Semua skenario F01–O10 mempunyai cakupan desktop/mobile serta substate yang dapat dilacak. | Matriks evidence dengan ID screenshot/interaksi; N/A hanya bila sah. Akses terblokir tetap Pending. | Pending |
| AC03 | Layar utama memiliki first viewport/full-page; modal/transien memiliki viewport; gambar mewakili UI asli tanpa polish tersembunyi. | Manifest, file gambar, metadata dan pemeriksaan visual. | Pending |
| AC04 | Galeri dapat dibuka lokal, terurut, berlabel simulasi dan tertaut dari indeks research. | Buka galeri, verifikasi link/ID/fixture/viewport dan akses full-size. | Pending |
| AC05 | Seluruh C01–C15 ditinjau pada surface relevan, bukan hanya komentar estetika. | Checklist berstatus dengan evidence; copy inventory serta catatan biaya/action/recovery. | Pending |
| AC06 | Keyboard, contrast, target, mobile, reflow 320 dan teks 200% diperiksa pada scope yang ditetapkan. | Catatan interaksi/rasio/ukuran/surface, bukan klaim dari screenshot saja. | Pending |
| AC07 | Konsistensi checkout/detail dan shared pattern diperiksa; status payment/fulfillment tidak disimpulkan dari warna semata. | Perbandingan berdampingan + fixture/kontrak dan temuan. | Pending |
| AC08 | User telah meninjau kumpulan gambar sebelum rekomendasi final. | Catatan feedback/konfirmasi review user tertaut ke ID gambar; diam bukan persetujuan. | Pending |
| AC09 | Rekomendasi final dapat ditelusuri, diprioritaskan dan membedakan fakta, pendapat user, hipotesis serta keputusan baru. | Tabel temuan/rekomendasi dan contoh dampak; tanpa klaim conversion/usability testing palsu. | Pending |
| AC10 | Batas dan evidence audit transparan; tidak ada implementasi aplikasi atau perluasan scope otomatis. | AC → evidence aktual, limitations, index dan diff artefak. | Pending |

Penyelesaian penuh memerlukan semua AC Verified. Temuan UI buruk tidak memblokir kelulusan audit jika telah dibuktikan dan dilaporkan; **bukti yang belum tersedia tetap memblokir klaim audit lengkap**. Laporan parsial harus menyebut belum ada perubahan UI dan AC Pending di awal.

## 15. Discovery, deviasi dan batas keputusan

- Akses dasar **sudah dibuktikan preflight**: origin lokal aktif, login demo berhasil dan akun sudah onboarding (bagian 7.1). Verifikasi ulang akses jika session/lingkungan berubah; jika gagal, berhenti tanpa mengubah akun. Ini bukan open question yang perlu ditanyakan ulang ke user.
- `discovery:` setiap response shape fixture, termasuk promo/recovery/versioned pricing, cocok dengan kode existing? Verifikasi source/installed types sebelum script; jangan memalsukan state dengan manipulasi React internal.
- `discovery:` state langka dapat direproduksi melalui browser seam tanpa memicu side effect server? Jika tidak, catat Pending dan alasan.
- `discovery:` alias consumer shared component dan computed token aktual saat render? Catat hasil saat audit, bukan meminta user menentukan spacing/warna.
- Approval spec lengkap telah diberikan user pada 2026-11-14 (bagian 2). Checkpoint keputusan berikutnya adalah review gambar bersama user sebelum rekomendasi final; keputusan baru di luar scope tetap harus dikonfirmasi. Tidak ada izin subagent atau transaksi eksternal.
- Perbedaan terhadap template upstream `to-spec`: menyertakan path dan menyimpan spec lokal sesuai kebijakan repo; tidak auto-publish/Ready. Blueprint diadaptasi menjadi inventaris audit karena tidak ada implementasi UI.
- Deviasi eksekusi dicatat di laporan: rencana, aktual, alasan, dampak evidence. Menghilangkan state/viewport, mengganti fixture dengan data nyata, atau memperluas scope membutuhkan keputusan user, bukan deviasi diam-diam.

## 16. Checklist penutupan

- [ ] Semua AC01–AC10 Verified dengan evidence aktual.
- [ ] Semua target capture tercakup atau N/A sah; tidak ada Pending yang disembunyikan.
- [ ] Review gambar bersama user tercatat sebelum rekomendasi final.
- [ ] Rekomendasi dan limitations dapat ditelusuri ke evidence.
- [ ] Screenshot/script disposable tetap di `playwright/`; tidak ada credential/PII atau generated artifact yang force-added.
- [ ] Spec tetap disimpan dan index fitur diperbarui dengan approval, hasil serta evidence; status plan existing tidak diubah.
- [ ] Prinsip enduring baru, bila ada, didistilasi ke dokumentasi yang relevan; bila tidak ada, catat N/A dan pertahankan temuan spesifik di research.

Tidak ada perubahan tampilan yang diserahkan oleh spec/audit ini. Implementasi improvement hanya dapat direncanakan setelah hasil review disepakati dan memperoleh approval tersendiri.
