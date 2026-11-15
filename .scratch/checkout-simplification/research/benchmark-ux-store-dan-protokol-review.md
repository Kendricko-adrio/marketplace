# Benchmark UX online store dan protokol review checkout

> Pembaruan setelah riset: [preflight Playwright dan akses store](preflight-playwright-dan-akses-store.md) memverifikasi login seed dan capture dasar melalui Chromium lokal. Catatan akses serta status capture di bawah merekam kondisi pada tahap riset awal; audit lengkap belum dijalankan. Laporan preflight menjadi sumber kondisi tooling terbaru.

## Tujuan dan batas

Permintaan user: cari benchmark terlebih dahulu, capture tampilan flow checkout → detail pembayaran, review gambar bersama user, lalu tentukan improvement UI. Keluhan awal user: terlalu banyak tulisan dan informasi menumpuk. Keluhan ini adalah input penelitian, **bukan kesimpulan audit yang sudah terbukti**.

User memilih **demo terkontrol**: UI asli, data simulasi, tanpa membuat order/pembayaran atau melakukan provider write. Melalui sesi `ask_user_question` lanjutan, user mengizinkan percobaan login akun demo seeded lokal dan memilih **seluruh flow store**: checkout, review pembayaran, hasil pending/sukses/gagal, serta detail pesanan pada desktop dan mobile. UI Midtrans tidak termasuk. Jika login gagal atau akun belum onboarding, berhenti tanpa mengubah akun atau data bisnis.

Dokumen ini adalah hasil riset dan checklist review, bukan spec implementasi, persetujuan redesign, atau klaim bahwa UI existing gagal. Tidak ada perubahan aplikasi, schema, atau konfigurasi.

## Metode dan sumber

Pencarian menggunakan tool Ollama `web_search`; artikel utama Baymard tentang form/payment dan NN/g tentang disclosure juga dikonfirmasi melalui `web_fetch`. Sumber lain dibaca dari hasil pencarian yang memuat teks halaman primer. Hanya materi publik yang ditinjau; tidak mengklaim membaca pedoman premium/paywall.

| ID | Sumber primer | Hal yang digunakan |
|---|---|---|
| S1 | [Baymard — Checkout Optimization: Minimize Form Fields](https://baymard.com/research-articles/checkout-flow-average-form-fields) | Beban field yang harus dipertimbangkan lebih penting daripada sekadar jumlah step; optional fields dan promo dapat ditunda pengungkapannya. |
| S2 | [Baymard — Payment UX](https://baymard.com/blog/payment-ux) | Ringkasan order mudah diakses, total final sebelum pembayaran, minim distraksi, label tindakan/redirect jelas, pemulihan error. |
| S3 | [NN/g — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Pisahkan informasi primer dan sekunder; kontrol pembuka detail harus jelas. Bedakan disclosure opsional dari urutan langkah wajib. |
| S4 | [W3C — WCAG Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/) | Reflow, contrast, label, keyboard/focus, target size, error identification, dan pencegahan kesalahan transaksi finansial. |
| S5 | [Baymard — Product Lists & Filtering UX](https://baymard.com/research/ecommerce-product-lists) | Keterkaitan kualitas product list, filter, dan sorting untuk menemukan produk. |
| S6 | [Baymard — Product Page UX](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux) | Informasi varian/ketersediaan serta gambar yang membantu evaluasi produk; penerapan tergantung jenis produk. |
| S7 | [NN/g — Transactional Email and Confirmations](https://www.nngroup.com/reports/ecommerce-transactional-email-confirmation-message/) | Halaman publik merangkum pentingnya order confirmation, shipment/pickup notification, billing, dan failure notice. Isi report berbayar tidak dibaca. |

Batas generalisasi: mayoritas riset Baymard berasal dari situs US/Eropa. Jangan otomatis memilih metode pembayaran, guest checkout, atau aturan fulfillment dari pasar tersebut untuk store Indonesia. Statistik abandonment pada sumber **bukan** ukuran performa store ini, dan bukan prediksi peningkatan conversion.

## Ekspektasi inti pengguna

Sintesis agent dari S1–S4, bukan kutipan aturan universal:

1. Saya tahu apa yang dibeli, varian, jumlah, dan ketersediaannya.
2. Saya tahu bagaimana barang diterima: dikirim atau pickup, lokasi, biaya, serta waktu yang tersedia.
3. Saya tahu jumlah final dan komponennya sebelum mengambil tindakan finansial.
4. Saya tahu apa yang terjadi ketika tombol utama ditekan, termasuk perpindahan ke provider.
5. Saya tidak perlu membaca bantuan yang tidak relevan untuk melanjutkan.
6. Saya dapat memperbaiki kesalahan tanpa mengulang seluruh pekerjaan.
7. Sesudah submit, saya tahu status yang benar dan tindakan berikutnya.
8. Saya dapat melakukan tugas yang sama di mobile dan dengan keyboard.

**Contoh:** pada review pengiriman, pelanggan perlu segera mengenali total bayar, penerima/alamat, layanan kurir, barang, dan tombol lanjut pembayaran. Penjelasan panjang cara kerja provider dapat menjadi bantuan tambahan. Biaya, perubahan total, dan konsekuensi submit tidak boleh disembunyikan demi membuat layar terlihat bersih.

## Checklist online store secara umum

Checklist ini adalah cakupan evaluasi, bukan mandat menambah semua fitur. Item kondisional dapat ditandai N/A dengan alasan. Audit render sesi ini tetap dibatasi flow yang disepakati, bukan seluruh katalog/account.

| Area | Item yang diperiksa | Dasar |
|---|---|---|
| Penemuan produk | Navigasi/kategori dapat dipahami; search, filter relevan, sort, hasil kosong, dan reset tersedia sesuai kebutuhan katalog. | S5; rincian navigasi/empty adalah sintesis evaluasi agent. |
| Product list | Nama, gambar, harga, dan atribut pembeda cukup untuk membandingkan; filter aktif dan hasilnya tidak membingungkan. | S5 |
| Detail produk | Gambar/informasi cukup untuk memahami barang; varian, harga, ketersediaan, dan aksi beli terbaca jelas. Gambar skala/model hanya bila relevan. | S6 |
| Cart | Barang/varian/jumlah/harga dapat direview; edit jumlah/hapus tidak ambigu; subtotal dan jalan ke checkout jelas. | Sintesis S1–S2, bukan daftar guideline premium. |
| Akun dan identitas | Login/onboarding tidak membingungkan; input yang sudah tersedia tidak diminta ulang tanpa alasan. Guest checkout adalah keputusan produk terpisah, bukan otomatis scope. | S1 dan konteks repo. |
| Fulfillment | Pilihan pickup/delivery jelas; alamat, nomor penerima, slot, layanan, harga dan estimasi tampil sesuai konteks. | S1–S2 dan kebutuhan fulfillment repo. |
| Promo | Tidak mengalahkan tugas utama; cara membuka/menerapkan/melepas jelas; perubahan total dan alasan tidak eligible terlihat. | S1–S3; rincian eligibility adalah sintesis repo. |
| Review pembayaran | Barang dan fulfillment mudah diverifikasi; total final, pajak/ongkir/diskon, primary action, dan konsekuensi redirect jelas. | S2, S4 |
| Payment provider | Metode tersedia dan instruksi jelas; status pending tidak disamakan dengan gagal; jalan kembali/pemulihan dapat dipahami. | S2; pemisahan status adalah sintesis keselamatan transaksi. |
| Hasil/detail pesanan | Status, nomor order, total dan tindakan berikutnya dapat ditemukan; status bayar dan pemenuhan tidak dicampur. | S2, S7 dan sintesis repo. |
| Kepercayaan/bantuan | Informasi penjual, bantuan, kebijakan pengiriman/retur relevan mudah ditemukan tanpa menjadi paragraf wajib di tiap step. | Sintesis S2–S3; bukan audit legal. |
| Mobile/accessibility | Reflow, label, focus, keyboard, contrast, error dan target interaksi diperiksa. | S4 |
| Feedback | Loading, disabled, validasi, error, retry dan sukses dapat dibedakan; input tetap tersedia setelah error bila aman. | S2, S4 |

## Checklist khusus screenshot checkout

Gunakan status **Terpenuhi / Masalah / Belum diverifikasi / N/A**; jangan menghasilkan skor persentase keseluruhan dengan bobot buatan.

| ID | Pertanyaan review | Bukti yang diperlukan |
|---|---|---|
| C01 | Apakah tujuan step dan primary action langsung terbaca? | First viewport + task walkthrough. |
| C02 | Apakah satu primary action dominan, sedangkan edit/back tetap mudah ditemukan? | Screenshot + interaksi. |
| C03 | Apakah informasi dikelompokkan menurut tugas, bukan semua dibungkus card dengan emphasis sama? | Full-page dan first viewport. |
| C04 | Apakah teks perlu sekarang, mencegah kesalahan penting, bantuan tambahan, atau duplikasi? | Inventaris copy per section; tandai alasan keep/shorten/move/remove. |
| C05 | Apakah detail sekunder bisa dibuka tanpa menyembunyikan biaya/risiko penting? | Screenshot awal dan disclosure terbuka. |
| C06 | Apakah penerima, tujuan/slot, layanan dan barang dapat diverifikasi sebelum submit? | Review delivery dan pickup. |
| C07 | Apakah total final paling mudah dikenali serta breakdown benar dan tidak ambigu? | Review angka fixture dan screenshot. |
| C08 | Apakah promo membantu tanpa mengalihkan fokus dan perubahan total dapat dimengerti? | Promo tertutup/terbuka/diterapkan/error. |
| C09 | Apakah tombol menyampaikan akibat sebenarnya, terutama order dibuat dan redirect provider? | Copy, interaksi terkontrol, penelusuran code; tidak submit nyata. |
| C10 | Apakah error/disabled memberi alasan serta jalan pemulihan tanpa menghilangkan input? | State error terkontrol dan retry. |
| C11 | Apakah mobile menjaga urutan baca, akses tindakan dan tidak overflow? | Viewport mobile + full-page; jangan menyamakan scroll panjang dengan kegagalan otomatis. |
| C12 | Apakah label, keyboard/focus dan target interaksi memadai? | Interaksi, bukan screenshot saja. |
| C13 | Apakah contrast dan makna status konsisten? | Computed style/measurement + screenshot; warna bukan satu-satunya pembeda. |
| C14 | Apakah setelah submit status dan next action jujur dan jelas? | Pending/sukses/gagal dan detail pesanan jika masuk scope. |
| C15 | Apakah kembali/edit tidak menimbulkan kehilangan data atau kebingungan total? | Walkthrough dengan data demo; tidak klaim integrasi backend. |

Accessibility: WCAG 2.2 AA menetapkan contrast teks biasa 4.5:1 dan large text 3:1 dengan pengecualian; target minimum 24×24 CSS px atau pengecualian SC 2.5.8, bukan klaim minimum AA 44×44. Target penting dapat diupayakan lebih besar sesuai konteks. Screenshot tidak membuktikan kepatuhan WCAG penuh. Reflow diuji terpisah dari sekadar screenshot mobile 390 px.

## Inventaris capture yang diusulkan

Viewport awal: desktop 1440×900 dan mobile 390×844, light theme existing. Ini pilihan protokol capture, bukan keputusan redesign. Setiap layar utama membutuhkan **first viewport** dan **full-page** agar kepadatan serta jarak menuju action dapat dibandingkan. Modal dapat memakai viewport screenshot.

### Dalam scope checkout yang jelas

- Pengiriman/pickup: kondisi awal dan kondisi siap melanjutkan.
- Pemilihan alamat existing dan dialog alamat baru.
- Pemilihan layanan kurir; loading/gagal quote yang dapat direproduksi.
- Review pembayaran delivery dan pickup tanpa promo.
- Picker promo, promo terpasang dan validasi promo gagal jika fixture kontraknya tersedia.
- Kondisi konfirmasi belum/tercentang dan submit error terkontrol, tanpa provider call.

### Cakupan lanjutan yang disetujui user

- Hasil pembayaran pending/sukses/gagal dengan data demo.
- Detail pesanan pending payment dan paid, delivery/pickup yang relevan.
- Desktop dan mobile.
- UI Midtrans di luar scope; tidak membuat session pembayaran nyata untuk memperoleh screenshot.

Tidak mungkin menjanjikan seluruh kombinasi tanpa inventaris. Catat setiap state sebagai captured/pending/N/A beserta alasan. State jarang yang tidak ditangkap tidak boleh dianggap lulus.

## Penyimpanan dan cara review

- Screenshot dan script capture sementara: `playwright/mcp/checkout-ux-review/` (gitignored).
- Temuan dan indeks gambar yang tahan lama: folder research fitur ini; tautkan screenshot disposable, jangan force-add gambar.
- Data demo diberi label pada indeks/galeri, tanpa memodifikasi copy/layout UI yang dinilai. Tidak memasukkan token, data customer nyata, atau secret.
- Galeri diurutkan berdasarkan perjalanan pengguna; setiap gambar memiliki ID, viewport, state, sumber data, dan keterbatasan.
- Review bersama user mendahului rekomendasi final. Lalu temuan mencatat: ID gambar → observasi → dampak tugas → prinsip/sumber → usulan → prioritas → keputusan yang diperlukan.
- Prioritas: penghambat/kesalahan transaksi, friksi tugas, lalu polish. Ini rubric review agent, bukan scoring Baymard.

## Fakta repo dan blocker akses

Terbukti lewat code:

- `apps/store/src/app/checkout/page.tsx`: checkout mempunyai dua step, pengiriman/pickup lalu pembayaran. Preview dan promo mempunyai server contract; submit dapat mengarahkan ke URL pembayaran.
- `apps/store/src/app/checkout/result/page.tsx`: mempunyai tampilan success/pending/cancel berdasarkan parameter URL.
- `apps/store/src/app/account/orders/[id]/page.tsx`: surface detail pesanan.
- `apps/store/src/app/checkout/layout.tsx` dan `apps/store/src/lib/server-access.ts`: halaman checkout membutuhkan session server dari client yang sudah onboarding. Mock browser `get-session` saja tidak cukup.
- `apps/store/src/proxy.ts`: route checkout/account/cart membutuhkan cookie store, terpisah dari admin.
- Existing fixture/pattern: `e2e/store/order-detail-presentation-mock.spec.ts`, `e2e/store/checkout-review-mock.spec.ts`. Tidak menjalankan spec karena beberapa setup melakukan mutasi DB/provider mock.

Hasil akses sesi ini:

- GET `http://localhost:3000` mengembalikan 200.
- Browser MCP gagal karena mencari Chrome yang tidak terpasang. Chromium Playwright lokal tersedia; alternatif capture belum dijalankan.
- GET `/checkout` dengan storage state existing `e2e/.auth/store.json` mengembalikan 307 ke `/login`; session itu tidak dapat digunakan saat ini. Nilai cookie tidak dicetak atau disalin ke artefak.
- Belum login, membuat akun, mengubah onboarding, cart, alamat, order, schema, atau data provider.
- Context7 checkpoint: `/microsoft/playwright` — dikonfirmasi `context.route`, pembatasan Service Worker (`serviceWorkers: 'block'`), route abort/fulfill, dan `page.screenshot({ fullPage: true })` untuk persiapan capture. Ini riset alat, bukan implementasi aplikasi.

## Status evidence

| Keluaran | Status | Evidence |
|---|---|---|
| Benchmark sebelum penilaian UI | Verified | Pencarian primer S1–S7; artikel utama dikonfirmasi fetch. |
| Checklist online store dan checkout | Verified | Tabel checklist di dokumen ini; dibedakan sumber dan sintesis. |
| Data capture aman disepakati | Verified | User memilih demo terkontrol melalui pertanyaan terstruktur. |
| Akses dan batas flow disepakati | Verified | User memilih login demo dan seluruh flow store melalui `ask_user_question`; Midtrans tidak termasuk. |
| Capture flow yang disepakati | Pending | Percobaan login dan capture belum dijalankan; izin login tidak membuktikan akses berhasil. |
| Review gambar bersama user | Pending | Belum ada capture; tidak ada penilaian rendered UI. |
| Rekomendasi improvement berbasis gambar | Pending | Menunggu capture dan review bersama. |

## Open items dan langkah berikutnya

- **Fakta belum diketahui:** ketersediaan session store valid untuk akses render; perlu akses login, bukan menebak dari source UI. Chrome MCP tidak tersedia, tetapi alternatif Chromium dapat dicoba tanpa install/config change.
- **Keputusan user diperlukan:** tidak ada untuk memulai percobaan akses dan capture dalam scope yang sudah disepakati. User mengizinkan login demo lokal saja dan memilih seluruh flow store pada desktop/mobile, tanpa Midtrans. Jika akses gagal atau akun belum onboarding, hentikan dan laporkan kebutuhan akses berikutnya.
- **Di luar scope:** implementasi redesign, perubahan aturan login/guest checkout, metode pembayaran baru, transaksi Midtrans/Jubelio, reset/seed/schema sync, commit/push/deploy.
- **Rekomendasi:** coba akses dengan akun demo sesuai izin, lalu capture demo pada UI asli dan review galeri bersama user. Jangan masuk spec/implementasi sebelum user meninjau temuan dan menyetujui arah perubahan.
