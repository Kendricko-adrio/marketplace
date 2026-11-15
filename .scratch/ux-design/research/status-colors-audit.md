# Riset warna dan audit label status store/admin

## Scope dan batas verifikasi

Permintaan: audit label status di store dan admin, rekomendasikan warna yang sesuai tone website, dan tambahkan pedoman operasional ke skill `ux-design`. Ini **research dan perubahan dokumentasi**, bukan implementasi UI, spec yang disetujui, atau perubahan lifecycle bisnis.

Metode: meninjau screenshot pengguna; mencari `Badge`, status maps, semantic classes, status text, dan shared components di `apps/store/src`, `apps/admin/src`, serta `packages/ui/src`; membaca sumber status pesanan, tracking, dan delivery workflow; memeriksa sumber primer accessibility/design system; menghitung contrast pasangan warna usulan. Tidak mengakses API Jubelio, database, atau data pelanggan. Tidak menyimpan ulang screenshot yang memuat data pribadi.

Cakupan inventaris adalah label/state yang ditemukan pada source saat audit, bukan seluruh kemungkinan nilai string yang dapat masuk dari provider. Tidak ada browser walkthrough seluruh aplikasi; warna computed, hover, dark mode, dan kejelasan rendered setiap halaman belum diverifikasi. UI aplikasi tidak berubah.

## Ringkasan temuan terverifikasi

1. Screenshot menunjukkan halaman `/account` milik storefront, bukan dashboard Jubelio. Penyebab presentasi berada pada kode marketplace; tidak ada bukti bahwa warna ditentukan API Jubelio.
2. `ready_for_pickup` dan `completed` memang sama-sama `variant: "default"` pada `apps/store/src/app/account/page.tsx:57–64`. Detail customer mengulang pola itu pada `apps/store/src/app/account/orders/[id]/page.tsx:33–45`.
3. `packages/ui/src/components/ui/badge.tsx:11–18` mendefinisikan `default` sebagai `bg-primary`, bukan semantic success. Pada light theme, primary adalah navy sangat gelap sehingga terlihat hitam. Badge hanya memiliki default/secondary/destructive/outline; belum tersedia variant status semantik.
4. Tidak semua status existing hitam: detail pesanan admin (`apps/admin/src/app/admin/orders/[id]/page.tsx:192–209`) dan notifikasi (`apps/admin/src/app/admin/notifications/page.tsx:44–60`) sudah membedakan amber/blue/violet/green/red/orange. Namun, daftar pesanan (`apps/admin/src/app/admin/orders/page.tsx:106–107`) memakai outline untuk pembayaran dan seluruh stage. Detail delivery menggunakan teal yang sama untuk semua stage (`apps/admin/src/app/admin/orders/[id]/page.tsx:539`).
5. Makna warna tersebar dan tidak konsisten: produk aktif navy, user aktif hijau, diskon aktif navy, status onboarding customer selesai emerald. Riwayat customer dan detail admin juga memakai green versus emerald untuk completed.
6. Beberapa pasangan existing berisiko contrast rendah: badge user aktif dan halaman published memakai `bg-green-500` dengan foreground default yang mendekati putih. Putih murni pada `#22C55E` hanya **2.28:1**; ini screening palet, bukan pengukuran computed style halaman. Putih pada `#EF4444` sekitar **3.76:1** juga di bawah target badge kecil. Jangan menganggap `destructive` otomatis lulus contrast.

## Tone website dan alasan rekomendasi

Sumber: `apps/store/src/app/globals.css:6–25,45–68` dan `apps/admin/src/app/globals.css:6–25,45–65`. Kedua app memakai token yang sama: navy gelap untuk primary/foreground, biru petroleum untuk secondary, muted teal untuk accent, surface abu-abu sangat terang, card putih. Komentar CSS menyebut `#061E29`, `#1D546D`, `#5F9598`, dan `#F3F4F4`; nilai runtime sebenarnya mengikuti deklarasi HSL, jadi komentar hex bukan pengganti pengukuran computed style.

**Rekomendasi desain:** gunakan tinted background lembut + teks gelap berwarna + border halus yang konsisten; jangan mengubah primary brand menjadi hijau atau memberi solid neon pada semua badge. Teal/biru sejalan dengan brand; amber/orange, emerald, dan red/rose menjadi aksen fungsional berukuran kecil untuk membedakan status. Ini rekomendasi project, bukan aturan warna universal dari WCAG.

### Palet light-theme usulan

Hex berikut adalah referensi penelitian, **belum menjadi CSS token/variant aplikasi**. Saat implementasi, pusatkan dalam semantic tokens/shared variants, bukan menyalin hex atau classes per halaman.

| Makna/tone | Contoh status | Background | Teks | Contrast teks/background |
|---|---|---|---|---|
| Waiting — orange lembut | Menunggu pembayaran | `#FFF7ED` | `#9A3412` | 6.88:1 |
| Progress/warning — amber | Diproses, perlu pemeriksaan | `#FEF3C7` | `#92400E` | 6.37:1 |
| Ready — teal | Siap diambil, barang siap | `#F0FDFA` | `#115E59` | 7.27:1 |
| Info/transit — blue | Dalam pengiriman | `#EFF6FF` | `#1E40AF` | 8.01:1 |
| Success — emerald | Selesai, lunas, aktif | `#ECFDF5` | `#065F46` | 7.29:1 |
| Error — red | Pembayaran gagal, barang rusak | `#FEF2F2` | `#991B1B` | 7.60:1 |
| Cancel/return — rose | Dibatalkan, dikembalikan | `#FFF1F2` | `#9F1239` | 7.30:1 |
| Neutral — slate | Draft, arsip, nonaktif, unknown | `#F1F5F9` | `#334155` | 9.45:1 |

Rasio dihitung memakai rumus relative luminance sRGB WCAG dan `(Lterang + 0.05) / (Lgelap + 0.05)`, melalui Node tanpa dependency. Nilai tabel dibulatkan untuk laporan; setiap nilai mentah melewati 4.5:1. Pemeriksaan ini hanya untuk teks pada background opaque yang disebutkan—bukan bukti perbedaan antarwarna, accessibility seluruh komponen, atau dark mode.

Orange waiting versus amber processing memberi pembeda pada dua tahap yang sering berdampingan. Keduanya tetap keluarga warm dan wajib memiliki label berbeda; jangan mengklaim semua pengguna pasti dapat membedakannya berdasarkan hue. Bila dua tahap serupa perlu dibedakan lebih kuat, gunakan ikon/judul tahap dan posisi yang konsisten, bukan mengandalkan pergantian shade saja.

**Dark theme:** definisi `.dark` ada di kedua app. Jika tema tersebut digunakan, sediakan pasangan surface gelap/foreground terang per semantic tone dan ukur ulang minimal 4.5:1; jangan sekadar memakai light palette dengan opacity atau melakukan inversion tanpa pengukuran. Warna dark final belum ditetapkan/diuji pada research ini.

## Inventaris status dan rekomendasi

Semua path di bawah relatif terhadap root repo. Bagian ini memisahkan status bisnis dari badge kategori, counter, dan pilihan interaksi.

### Store

| Surface dan sumber | Label/status existing | Treatment existing | Rekomendasi |
|---|---|---|---|
| Riwayat `/account` — `apps/store/src/app/account/page.tsx:57–64,340` | Pending Payment; Processing; Ready for Pickup; Completed; Cancelled; Payment Failed | Outline; petroleum secondary; navy; navy; destructive; destructive | Waiting orange; progress amber; ready teal; success emerald; cancel rose; error red |
| Detail — `apps/store/src/app/account/orders/[id]/page.tsx:33–50,232–238` | Menunggu pembayaran; Pesanan diproses; Siap diambil; Pesanan selesai; Pesanan dibatalkan; Pembayaran gagal; unknown | Sama seperti riwayat; unknown outline | Mapping sama lintas riwayat/detail; unknown slate, bukan success |
| Pembayaran — `apps/store/src/components/orders/OrderPaymentSummary.tsx:12–19,66` | Menunggu; Lunas; Gagal | Outline; navy; destructive | Orange; emerald; red |
| Tracking — `apps/store/src/components/orders/OrderFulfillmentPanel.tsx:118–125,144–168` dan `apps/store/src/lib/order-tracking-presentation.ts:27–43` | Menunggu kurir; Kurir dikonfirmasi; Kurir menuju lokasi pengambilan; Paket diambil kurir; Dalam pengantaran; Paket telah diterima; Pengiriman tertunda; Paket dikembalikan; Pengiriman dibatalkan; Pengiriman mengalami kendala; fallback Pembaruan pengiriman | Heading/timeline text; ikon latest sama `bg-primary/10 text-primary` | Waiting orange; confirmed/kurir menuju lokasi blue; diambil/dalam pengantaran blue; diterima emerald; tertunda amber; return/cancel rose; kendala red; unknown slate. Tidak wajib mengubah setiap timeline event menjadi pill |
| Result checkout — `apps/store/src/app/checkout/result/page.tsx:32–98` | Pembayaran Berhasil; Menunggu Pembayaran; Pembayaran Gagal | Ikon green/amber/destructive + judul | Sudah punya pembeda non-color dan warna; selaraskan semantic tones/contrast, jangan mengubah kebenaran status pembayaran dalam pekerjaan warna |
| Verifikasi email — `apps/store/src/app/auth/verify/page.tsx:72–100` | Memverifikasi; Email Terverifikasi; Verifikasi Gagal | Judul dan text netral | Info/progress; success; error bila menambah indikator. Tidak harus membungkus semua judul dengan badge |
| Cabang — `packages/ui/src/components/store/BranchCard.tsx:51–53` | Buka | Default navy + icon | Success emerald **jika** klaim Buka memang sah dari sumber data; perubahan warna tidak boleh dipakai untuk menyimpulkan jam buka |
| Produk — `packages/ui/src/components/store/ProductCard.tsx:61–69` | Stok Belum Tersedia; Cek stok saat bayar | Kedua badge muted sama | Stok habis warning amber; belum terkonfirmasi info blue. Bedakan habis terkonfirmasi versus belum diketahui; tidak boleh memberi error untuk semua unknown |
| Promo checkout — `apps/store/src/components/checkout/PromoSelector.tsx:27`; `PromoSelectionDialog.tsx:138` | Dipakai; Dipilih; Paling hemat | Secondary; outline; default | Dipakai dapat success; Dipilih adalah selection, Paling hemat rekomendasi—bukan lifecycle status, pertahankan bahasa visual selected/recommendation |
| Rincian promo order — `apps/store/src/components/orders/OrderPaymentSummary.tsx:89–93` | Redemption consumed/released/fallback | Copy kondisional | Jika diberi indikator: consumed success, released neutral; jangan merancukan redeem promo dengan status pembayaran |

### Admin

| Surface dan sumber | Label/status existing | Treatment existing | Rekomendasi |
|---|---|---|---|
| Daftar order — `apps/admin/src/app/admin/orders/page.tsx:106–108` | Payment status; order status atau delivery stage; Stock review | Semua outline; review text amber | Pakai mapping domain yang sama dengan detail/store; review amber |
| Detail order — `apps/admin/src/app/admin/orders/[id]/page.tsx:183–209,539–545` | Enam order statuses; pending/paid/failed; delivery stages | Order amber/blue/violet/green/red/orange; payment amber/emerald/red; semua stage teal | Seragamkan ke palet semantik usulan; stage jangan semuanya teal |
| Notifikasi — `apps/admin/src/app/admin/notifications/page.tsx:44–60,309–311` | Enam order statuses | Mapping lokal seperti detail; hover default shared masih perlu diperiksa rendered | Reuse mapping yang sama; hindari warna berubah menjadi primary saat hover pada badge pasif |
| Detail customer — `apps/admin/src/app/admin/customers/[id]/page.tsx:32–47,118–129,185–189,259–264` | Enam order statuses; Onboarding completed/pending; Email verified: Verified/Not verified | Order berwarna; onboarding emerald/amber; email text dengan ikon emerald bila verified | Pisahkan onboarding dari email verification; onboarding selesai emerald/pending orange; email verified emerald/not verified orange |
| Daftar customer — `apps/admin/src/app/admin/customers/customer-table.tsx:175–184`; summary `customers/page.tsx:20–26` | Onboarding Selesai/Belum selesai; summary Onboarding completed/Pending onboarding | Emerald/amber | Success emerald; waiting orange; ini onboarding, bukan verifikasi email |
| Produk list/detail — `apps/admin/src/app/admin/products/page.tsx:85–92`; `products/[id]/page.tsx:129–133,215` | aktif; habis; arsip | Navy; destructive; petroleum secondary | Aktif emerald; habis amber; arsip slate. Habis bukan selalu kegagalan sistem |
| Cabang list dan stock branch — `apps/admin/src/app/admin/branches/page.tsx:105–111`; `products/[id]/page.tsx:319–326` | aktif; nonaktif | Navy; secondary | Emerald; slate |
| User — `apps/admin/src/app/admin/users/page.tsx:293–295,332–338` | Reset diperlukan; Aktif | Amber outline; green-500 solid | Warning amber dengan contrast cukup; aktif emerald tint. Jangan menambah status user nonaktif yang belum tersedia |
| Role — `apps/admin/src/app/admin/roles/roles-list-client.tsx:145–164` | Arsip; Sistem · Owner; Sistem; Kustom | Arsip outline + ikon; kategori memakai variant berbeda | Arsip neutral; lainnya kategori/permission, bukan indikator sukses/gagal |
| Diskon list/editor — `apps/admin/src/app/admin/discounts/discounts-list-client.tsx:22–26,229–234`; `[id]/discount-editor-client.tsx:528–542` | Draft; Aktif; Dijeda; Diarsipkan; Ada draft | List hanya aktif default vs lainnya outline; editor draft secondary/aktif default/paused outline/archived destructive | Draft slate; aktif emerald; dijeda amber; arsip slate + ikon arsip/label, tidak red error; Ada draft neutral secondary indicator |
| Kode diskon — `apps/admin/src/app/admin/discounts/[id]/discount-codes-section.tsx:21–24,158–160` | Aktif; Nonaktif; Diarsipkan | Aktif default; lainnya secondary | Emerald; neutral; neutral + archive cue |
| Harga/markdown — `apps/admin/src/app/admin/products/harga/price-change-client.tsx:759–778` | Source tidak valid; Aktif; Target nonaktif; Tanpa markdown | Destructive; secondary; destructive; outline | Red; emerald; amber karena target tersimpan tidak berlaku; slate |
| Import harga row — `apps/admin/src/app/admin/products/harga/price-change-excel-client.tsx:415–425`; `price-change-shared.ts:57` | pending; applied; unchanged; failed | Outline; default; outline; destructive | Orange; emerald; slate; red |
| Import/bulk result — `apps/admin/src/app/admin/products/harga/price-change-excel-client.tsx:315–317`; `price-change-dialog.tsx:369–373`; `price-change-shared.ts:162–186` | Belum final; semua gagal; tanpa perubahan; sebagian gagal; diterapkan | Badge hanya error destructive vs selainnya secondary; dialog error vs muted | Progress amber/orange; error red; neutral slate; partial warning amber dengan jumlah kegagalan; success emerald. Jangan mengubah helper business tone tanpa review kontraknya |
| Halaman CMS — `apps/admin/src/app/admin/pages/page.tsx:191–196` | Dipublikasi; Draft | Green-500 solid; secondary | Emerald tint; slate; periksa contrast teks kecil |
| Homepage preview — `apps/admin/src/app/admin/homepage/preview/page.tsx:182–185` | Nonaktif | Destructive | Slate; tidak aktif bukan error |
| Review transaksi — `apps/admin/src/app/admin/orders/reviews/page.tsx:173–175,224,293–296` | Checkout belum selesai; preparing/compensating/processing/manual_review; tipe operasi; paid; order status | Secondary; text; destructive untuk tipe operasi; outline paid/order | Progress amber; manual review amber (bukan pasti failed); paid emerald; order sesuai mapping. Tipe operasi tetap kategori, pisahkan indikator risiko review |
| Jubelio stock operation detail — `apps/admin/src/app/admin/orders/[id]/page.tsx:1086–1093` | Status operasi stok; manual review | Manual review red, lainnya slate tint | Manual review amber kecuali ada failure terkonfirmasi; running amber; confirmed emerald; unknown slate/amber menurut tindakan |
| Analytics — `apps/admin/src/app/admin/analytics/analytics-dashboard.tsx:242–248,281`; `analytics/format.ts:55–65` | Breakdown dan recent orders memakai statusLabel | Teks biasa | Jika ditambah badge, reuse mapping order; untuk chart jangan menggantungkan arti pada warna saja. Tidak wajib mewarnai semua teks numerik |

### Seluruh delivery stages yang ditemukan

Sumber: `apps/admin/src/lib/delivery-workflow.ts:18–20,28–73`. Daftar opsi mencantumkan 20 label; fungsi juga dapat mengembalikan **Order tidak aktif**, jadi jangan membangun mapping hanya dari opsi filter.

| Label | Tone usulan |
|---|---|
| Menunggu pembayaran | Waiting orange |
| Verifikasi pembayaran | Progress amber |
| Verifikasi tertunda | Warning amber; lunas tidak berarti fulfillment siap |
| Siapkan barang | Progress amber |
| Barang siap | Ready teal |
| Menunggu penjemputan | Waiting orange |
| Diserahkan ke kurir | Info/transit blue |
| Dibawa kurir | Info/transit blue |
| Dalam pengiriman | Info/transit blue |
| Barang diterima | Success emerald |
| Selesai manual | Neutral slate + label/ikon penutupan manual; bukan bukti barang diterima |
| Menunggu hasil booking | Progress amber |
| Booking belum pasti | Warning amber; jangan tampilkan success atau ajakan booking ulang |
| Stok tidak tersedia | Warning amber |
| Barang rusak | Error red |
| Batas layanan terlampaui | Error red |
| Pengiriman tertahan | Warning amber |
| Barang dikembalikan | Return rose |
| Pengiriman dibatalkan | Cancel rose |
| Kendala pengiriman | Error red |
| Order tidak aktif | Neutral slate; label agregat ini tidak membuktikan sukses maupun pembatalan tertentu |

Untuk tracking provider: `WAITING` → orange; `CONFIRMED_BY_COURIER`, `ON_THE_WAY_PICK_UP` (alias presentasi `ON_THE_WAY_PICKUP`), `PICKED_UP`, `ON_DELIVERY` → blue; `DELIVERED` → emerald; `ON_HOLD` → amber; `RETURNED`, `CANCELED` → rose; `SHIPMENT_ISSUE` → red; unknown/null → slate + label fallback. Ini hanya pemetaan presentasi; jangan mengubah normalized provider vocabulary.

### Badge yang bukan lifecycle status

Jangan mengubah seluruh `Badge default` menjadi hijau secara global. Berikut termasuk kategori/atribut, bukan status bisnis:

- Member tier — `apps/store/src/app/account/page.tsx:230–232`.
- Hemat/persentase diskon dan atribut produk — `apps/store/src/app/products/[id]/page.tsx:254,352–354`; `packages/ui/src/components/store/ProductCard.tsx:57–59,122–129`.
- Cabang/fulfillment checkout — `apps/store/src/app/checkout/page.tsx:1560–1562`.
- Role user — `apps/admin/src/app/admin/users/page.tsx:310–315`; role Sistem/Kustom seperti di atas.
- Jenis homepage section — `apps/admin/src/app/admin/homepage/page.tsx:334`.
- Jenis notifikasi — `apps/admin/src/app/admin/notifications/page.tsx:290–294`.
- Counter — `apps/admin/src/components/NotificationBell.tsx:52–57`; selection count pada `products/harga/price-change-client.tsx:548–550`.
- Harga global, sumber import, koreksi tertaut — `products/harga/price-change-client.tsx:491`; `price-change-excel-client.tsx:324–326`.
- Paling hemat/Dipilih pada promo selection adalah rekomendasi/interaction state, bukan payment/order success.

Form select/switch status tetap mengikuti interaction pattern yang accessible; warna status tidak menggantikan selected state, checked state, label field, atau permission.

## Prinsip penerapan yang direkomendasikan

- Bedakan **makna** status, bukan memberi warna acak untuk setiap enum. Waiting, processing, ready, success, failure, cancel, dan neutral tidak boleh semuanya memakai background navy/outline yang identik.
- Status bermakna sama harus sama warna lintas store/admin/list/detail. Beberapa status bermakna sekelompok boleh berbagi tone dengan label eksplisit dan ikon bila perlu. Draft dan arsip boleh sama-sama neutral; tidak perlu 20 hue untuk 20 tahap pengiriman.
- Pending/unknown tidak otomatis error. `Selesai manual` dan `Order tidak aktif` tidak boleh diberi success bila tidak ada bukti barang diterima.
- Paid, lifecycle order, dan delivery stage adalah dimensi berbeda. Order bisa **Lunas (emerald)** sekaligus **Booking belum pasti (amber)**. Jangan mengganti keduanya dengan satu badge hijau.
- Label tetap terlihat. Ikon dapat membantu, terutama membedakan waiting/progress atau canceled/error; ikon dekoratif jangan mengulang pengumuman screen reader. Badge pasif jangan terlihat sebagai button atau berganti hue saat hover.
- Saat implementasi disetujui, gunakan shared semantic variants di `packages/ui`, mapping domain reusable, dan fallback netral. Audit consumer non-status sebelum mengubah shared Badge; jangan mengganti arti `default` untuk seluruh aplikasi.
- Browser review, test mapping (termasuk unknown dan terminal tanpa evidence), dan Playwright lintas list/detail/store/admin tetap diperlukan untuk implementasi. Kontras palet saja tidak membuktikan UI sudah diterima.

## Sumber primer yang diperiksa

1. [W3C — Use of Color, SC 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html): warna bukan satu-satunya cara menyampaikan informasi; label teks dapat menjadi pembeda non-color. Tidak mewajibkan warna unik per status.
2. [W3C — Contrast Minimum, SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): teks normal minimal 4.5:1, large text 3:1; badge `text-xs` tidak masuk pengecualian large text. Rumus rasio merujuk definisi contrast ratio yang ditautkan halaman tersebut.
3. [IBM Carbon — Tag usage](https://carbondesignsystem.com/components/tag/usage/): tag membantu kategorisasi/scanning, warna berbeda membantu membedakan label, dan tidak dianjurkan semua tag identik bila tujuannya membedakan kategori. Carbon bukan otoritas untuk mengganti brand palette project; yang dipakai adalah prinsip consistency/scanning.
4. Source code repo yang disebutkan pada setiap baris inventaris adalah sumber utama untuk perilaku existing. Palet dan klasifikasi rekomendasi adalah usulan audit, bukan hasil usability testing atau ketentuan vendor Jubelio.

## Koreksi fakta saat penyusunan spec

Pemeriksaan ulang menunjukkan badge customer pada list/detail memakai `onboardingCompleted`, bukan `emailVerified`; summary juga menghitung onboarding. Verifikasi email hanya informasi terpisah pada detail customer. Inventaris di atas telah dikoreksi. Selain itu badge operasi pada detail order bersumber dari `order.stockOperations` (`StockOperation`), bukan daftar Sales Operation; spec membedakan vocabulary keduanya agar mapping tidak tertukar.

## Open items dan tindak lanjut

| Kategori | Isi |
|---|---|
| Fakta belum diketahui | Computed contrast, state hover, dan tampilan seluruh surface pada viewport/theme aktual belum ditinjau di browser; pasangan dark final belum diukur. Ini pekerjaan agent saat validasi implementasi, bukan pertanyaan fakta kepada user. |
| Keputusan user diperlukan | Approval pemetaan/penerapan UI lintas app, khususnya penyelarasan warna existing blue/violet ke amber/teal. Research tidak mengasumsikan approval implementasi. |
| Di luar scope | Mengubah lifecycle bisnis, status provider, bahasa seluruh label, checkout-result correctness, jam buka cabang, redesign chart, API/schema/DB, remote/deployment. |

Rekomendasi langkah berikutnya: alignment singkat atas palet dan scope penerapan, lalu blueprint/spec lintas surface untuk approval. Jangan otomatis memulai implementasi atau membuat tickets dari research ini.

## AC → evidence tahap research/dokumentasi

| AC | Status | Evidence |
|---|---|---|
| Mengidentifikasi penyebab badge hitam pada screenshot | Verified | Screenshot dan statusMap storefront + shared Badge; ringkasan temuan 1–3 |
| Merekomendasikan warna selaras tone website | Verified | Token kedua globals.css; palet delapan tone dan perhitungan contrast Node |
| Mengaudit label status store/admin dan shared consumer, termasuk yang bukan Badge | Verified | Inventaris surface, daftar 21 delivery outputs, tracking statuses, serta pemisahan non-status; batas audit source-only dinyatakan |
| Memperbarui skill UX dengan aturan semantic status colors | Verified | `.agents/skills/ux-design/SKILL.md`, bagian G dan tambahan gate penerimaan |

Pemeriksaan dokumentasi: `git diff --check` pada dua file tracked yang diubah lulus; pemeriksaan relative Markdown links melalui Node untuk ketiga file deliverable lulus. Palet diperiksa lewat perhitungan contrast Node. Tidak ada test aplikasi yang dijalankan karena perubahan hanya Markdown/skill, tanpa external package API (Context7 tidak diperlukan). Research dikerjakan langsung tanpa subagent karena tidak ada izin delegasi.

Tidak ada AC implementasi UI pada scope ini. UI, rendered verification, serta test aplikasi tidak diklaim selesai atau telah dijalankan.
