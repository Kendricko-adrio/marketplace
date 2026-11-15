Verified dengan catatan — `npm run verify:batch:unit` (full unit, `--no-file-parallelism`) 202 file / 2432 test PASS, 25 skip; `verify:types:store` + `verify:types:admin` PASS; lint tanpa error; 28 test browser warna status PASS; `docs/features/status-colors.md` ditautkan dari `docs/README.md`. Suite regresi yang terblokir fixture dicatat apa adanya, bukan diklaim PASS. |Verified dengan catatan — diff terbatas pada presentasi (token CSS, resolver/komponen shared, indikator status); tidak ada perubahan route/API/schema/search/pagination/filter/URL maupun guard. Regresi mock: `order-detail-presentation` dan `order-notifications` PASS; `customers-pagination`, `price-change-excel`, `price-change-bulk`, `discounts-prototype`, `checkout-attempt-review` PASS kecuali satu test permission/fixture masing-masing; `stock-visibility` dan `discounts-coupon` terblokir prasyarat fixture DB. |Verified dengan catatan — viewport 390×844 dan 1440×900 tanpa overflow horizontal pada daftar order admin; label status wrap (`whitespace-normal break-words`), badge pasif tanpa `tabIndex`/`onClick`, dan tidak ada kontrol/aksi yang dipindah atau dihapus sehingga urutan keyboard, aksi, permission, dan unsaved state tetap. |Verified — computed `background/color/border` sama dengan palet literal light dan dark di kedua app, kontras ≥ 4.5:1, dan hover tidak mengubah warna (`e2e/support/status-colors.ts`). |Verified — halaman CMS Dipublikasi/Draft, preview homepage “Nonaktif” neutral, dan analytics breakdown/recent orders memakai badge order yang sama; nominal, counter, dan tipe tetap teks biasa. |Verified dengan catatan — markdown empat tone (invalid_source/active/inactive_target/absent) dan import Excel: baris applied/unchanged/failed plus agregat sebagian-gagal→progress dan seluruh-gagal→error terukur di browser; prioritas `haltReason`→error dan matriks lain di unit test. Container feedback dialog bulk tidak dieksekusi (alur dialog bulk tidak dijalankan) meski memakai resolver yang sama. |Verified dengan catatan — daftar Offer: draft neutral, enabled success, paused progress, archived neutral, “Ada draft” tetap kategori. Editor/kode diskon tidak dieksekusi di browser karena halaman editor membaca data DB offer yang tidak di-seed; keduanya memakai resolver `offer`/`discount-code` yang sama. |Verified — daftar + detail customer admin: onboarding pending (waiting) dengan email Verified (success) pada customer yang sama, onboarding completed success; produk aktif/habis/arsip, cabang aktif/nonaktif, admin user aktif + reset, role arsip neutral dengan tipe role tetap kategori. |Verified dengan catatan — `BranchCard` “Buka” success terukur di `/branches` (store) dan preview homepage admin; tone stock-visibility `unavailable→progress`/`unconfirmed→info` terkunci di unit test dan invariant katalog store. Badge stok tidak dapat dipaksa muncul di katalog karena katalog menyembunyikan produk tanpa stok tersedia dan `CarouselProductSection` tidak meneruskan flag stok (batasan dokumen permanen §9). |Verified dengan catatan — tracking latest + timeline (semua normalized status + fallback), hasil checkout tiga kondisi, verifikasi email progress/success/error, dan Redemption (`Direservasi…`, `Dipakai (lunas)`, `Status promo belum tersedia`) terukur di browser. Badge “Dipakai” pada `PromoSelector` baru terverifikasi lewat mapping unit + kompilasi karena `discounts-coupon-mock` terblokir fixture DB (lihat AC14). |Verified — unit `getStatusTone`; browser: detail order menampilkan order progress + payment “Lunas” success bersamaan, daftar admin “Barang siap” ready vs “Booking belum pasti” progress, “Selesai manual”/“Order tidak aktif” neutral. |Verified — kedua spec browser memakai palet literal §7.1 yang sama; label + tone order identik di riwayat, detail, daftar admin, notifikasi, customer history, dan analytics. |Verified — `apps/store/src/lib/status-presentation.test.ts` 59 test: seluruh domain §6.1, 21 delivery stage, tracking + alias, fallback null/undefined/kosong/asing, matriks §6.4, dan domain tidak tertukar. RED terbukti saat satu expected sengaja diubah. |Verified — `e2e/store/status-colors-mock.spec.ts` “riwayat pesanan membedakan seluruh status order…”: enam nilai + unknown, ready≠completed (warna computed berbeda), detail memakai tone yang sama. |# Spesifikasi warna status semantik store dan admin

## 1. Masalah dan tujuan

Customer melihat `Ready for Pickup` dan `Completed` dengan badge navy yang sama pada riwayat pesanan. Admin juga menemukan status berwarna pada detail, tetapi outline seragam pada daftar. Perbedaan treatment lintas halaman memperlambat pemindaian dan dapat mengaburkan perbedaan menunggu, siap, selesai, serta gagal.

Tujuan: satu bahasa warna status yang sesuai tone navy–petroleum–teal website, konsisten di seluruh surface hasil audit, tanpa mengubah lifecycle, data, permission, atau alur pekerjaan.

Sumber: [audit status dan palet](../research/status-colors-audit.md), [skill UX bagian G](../../../.agents/skills/ux-design/SKILL.md), [glossary](../../../CONTEXT.md), [ADR RBAC accepted](../../../docs/adr/0001-application-owned-hybrid-rbac.md). Status plan hanya dicatat di [index fitur](../index.md).

## 2. Approval dan kesepahaman

- User meminta spec berdasarkan research, lalu memilih **“Seluruh audit (Recommended)”** pada konfirmasi cakupan: seluruh surface status, shared mapping tests, Playwright terkait, dan rendered review lintas store/admin.
- Scope percakapan: presentasi status; badge kategori dan aturan bisnis tetap.
- Konfirmasi cara pengujian: mapping bersama pada public seam + browser pada surface yang diubah; contoh eksplisit ready teal/completed hijau, paid hijau bersamaan booking belum pasti amber.
- **Approval dokumen lengkap: disetujui user pada 2026-11-14** melalui pesan “oke saya approve specnya”. Approval mencakup scope seluruh audit, mapping/palet light–dark, blueprint teknis/UX, copy/fallback, serta AC01–AC14 dan verification gates. Implementasi belum dimulai pada checkpoint pencatatan approval ini.
- Tidak ada izin subagent, commit, push, provider writes, perubahan DB developer, remote, atau deployment. Tidak menerbitkan ticket breakdown atau label `ready-for-agent`.
- Penyimpangan sengaja dari template upstream `to-spec`: full file paths dan technical/UX blueprint disertakan sesuai aturan project; publikasi berupa Markdown lokal; approval user dicatat tanpa publikasi tracker eksternal.

## 3. Solusi dari perspektif pengguna

Status menggunakan tinted background, foreground kontras, border halus, serta label yang tetap terbaca. Ready berbeda dari completed; paid berbeda dari payment failed; draft/nonaktif tidak tampil seperti error. Status semakna memakai tone yang sama di store, admin, list, detail, dan notifikasi.

Bukan satu hue unik untuk setiap enum: tahap transit berbagi biru dan beberapa status administratif berbagi netral. Label tetap membedakan detail. Warna tidak boleh menjadi satu-satunya cara memahami status.

Contoh: pada order delivery, **Lunas** hijau berarti pembayaran selesai; **Booking belum pasti** amber berarti hasil booking belum terkonfirmasi. Keduanya tetap ditampilkan, bukan digabung menjadi “berhasil”. **Selesai manual** netral berarti penanganan ditutup, bukan bukti paket diterima.

## 4. User stories

1. Sebagai customer, saya ingin membedakan pesanan menunggu pembayaran dan sedang diproses saat melihat riwayat.
2. Sebagai customer, saya ingin status siap diambil berbeda dari pesanan selesai agar tahu kapan perlu datang ke cabang.
3. Sebagai customer, saya ingin warna pada detail sama dengan riwayat untuk status yang sama.
4. Sebagai customer, saya ingin pembayaran lunas terlihat berbeda dari gagal tanpa harus menyimpulkan dari status pengiriman.
5. Sebagai customer, saya ingin dapat membaca status walaupun tidak dapat membedakan hue tertentu.
6. Sebagai customer, saya ingin membedakan pengiriman tertunda, dibatalkan, dan paket diterima.
7. Sebagai customer, saya ingin stok habis dibedakan dari stok yang baru dapat dipastikan saat pembayaran.
8. Sebagai customer, saya ingin hasil verifikasi email dan hasil checkout menyampaikan progress/sukses/gagal secara konsisten.
9. Sebagai customer, saya ingin status promo tidak membuat saya mengira pembayaran sudah lunas sebelum waktunya.
10. Sebagai Admin User, saya ingin daftar dan detail order menggunakan bahasa warna yang sama.
11. Sebagai Admin User, saya ingin melihat pembayaran terverifikasi dan kendala fulfillment secara terpisah.
12. Sebagai Admin User, saya ingin hasil booking yang belum pasti tidak tampak sebagai success atau kepastian gagal.
13. Sebagai Admin User, saya ingin penutupan manual tidak disamakan dengan barang telah diterima.
14. Sebagai Admin User, saya ingin notifikasi dan riwayat customer konsisten dengan daftar order.
15. Sebagai Admin User, saya ingin status onboarding dipisahkan dari email verification.
16. Sebagai Admin User, saya ingin produk aktif, habis, dan arsip dapat dipindai dengan cepat.
17. Sebagai Admin User, saya ingin cabang aktif dan nonaktif dibedakan tanpa menganggap nonaktif sebagai error.
18. Sebagai Admin User, saya ingin draft, aktif, dijeda, dan arsip Offer/Kode terlihat sesuai maknanya.
19. Sebagai Admin User, saya ingin hasil import penuh, parsial, gagal, dan tanpa perubahan dibedakan.
20. Sebagai Admin User, saya ingin manual review menarik perhatian tanpa langsung menyatakan transaksi gagal.
21. Sebagai Admin User, saya ingin status pada CMS, Roles, dan analytics tetap konsisten tanpa mengubah akses atau aksi.
22. Sebagai pengguna light/dark theme, saya ingin label status tetap terbaca dengan contrast cukup.
23. Sebagai pengembang, saya ingin satu mapping semantik dan styling shared agar warna tidak kembali berbeda per halaman.
24. Sebagai pengembang, saya ingin fallback aman untuk nilai baru/asing tanpa membuat klaim sukses palsu.

## 5. Scope halaman dan treatment final

Semua source paths di bawah relatif terhadap root repo. Label existing **dipertahankan persis**, termasuk campuran Indonesia/English; pekerjaan ini bukan lokalisasi. Mapping berdasarkan identifier/domain, bukan substring atau nama warna lokal.

### 5.1 Store

| Surface | File yang diubah | Treatment yang diwajibkan |
|---|---|---|
| `/account` | `apps/store/src/app/account/page.tsx` | Ganti variant lokal status order ke mapping shared; member tier tetap |
| `/account/orders/[id]` | `apps/store/src/app/account/orders/[id]/page.tsx` | Badge order konsisten dengan riwayat; fallback customer existing tetap |
| Pembayaran/promo detail | `apps/store/src/components/orders/OrderPaymentSummary.tsx` | Payment StatusBadge; status Redemption tampil pill dengan copy existing, tidak mengubah nominal/aksi |
| Tracking detail | `apps/store/src/components/orders/OrderFulfillmentPanel.tsx` | Latest status menjadi StatusBadge di area heading existing; setiap event menggunakan StatusBadge sebagai label event pada posisi judul event existing. Timestamp, detail, disclosure, proof/tracking links dan urutan tetap |
| `/checkout/result` | `apps/store/src/app/checkout/result/page.tsx` | Tiga ikon status memakai token semantik; judul, kondisi query, copy dan CTA tetap; tidak menambah klaim verifikasi |
| `/auth/verify` | `apps/store/src/app/auth/verify/page.tsx` | Tambah ikon status dalam tinted container tepat di atas heading existing: progress saat verifying, check saat success, error saat gagal. Tidak mengulang copy sebagai badge tambahan. Flow, timeout redirect dan API auth tetap |
| `/branches`, homepage branch banner, preview consumer | `packages/ui/src/components/store/BranchCard.tsx` | Badge existing “Buka” memakai success tone; label/predicate tidak diubah. Ini tidak menambahkan evaluasi jam buka real-time |
| Semua consumer ProductCard | `packages/ui/src/components/store/ProductCard.tsx` | Stok Belum Tersedia warning; Cek stok saat bayar info; badge diskon/atribut tidak berubah |
| Promo aktif di checkout | `apps/store/src/components/checkout/PromoSelector.tsx` | Badge Dipakai success; tidak mengubah perhitungan/validasi/pemilihan |
| Dialog promo | `apps/store/src/components/checkout/PromoSelectionDialog.tsx` | Review regresi saja: Dipilih dan Paling hemat tetap selection/recommendation, bukan payment success; tidak perlu edit bila tidak terdampak |

### 5.2 Admin

| Surface | File yang diubah | Treatment yang diwajibkan |
|---|---|---|
| `/admin/orders` | `apps/admin/src/app/admin/orders/page.tsx` | Payment dan stage/order memakai StatusBadge terpisah; stock review warning |
| `/admin/orders/[id]` | `apps/admin/src/app/admin/orders/[id]/page.tsx` | Order, payment, delivery stage, StockOperation konsisten; alert manual review memakai warning tanpa menghapus alasan/guidance atau mengubah aksi |
| `/admin/orders/reviews` | `apps/admin/src/app/admin/orders/reviews/page.tsx` | Checkout state, order/payment indicators berwarna. Badge TYPE_LABEL menjadi kategori netral; konteks manual-review memakai indikator “Perlu pemeriksaan” warning yang terpisah |
| `/admin/notifications` | `apps/admin/src/app/admin/notifications/page.tsx` | Enam order statuses konsisten; tipe notifikasi/kounter tetap |
| `/admin/customers` | `apps/admin/src/app/admin/customers/customer-table.tsx` | Onboarding selesai success, belum selesai waiting; bukan email verification |
| Customer summary | `apps/admin/src/app/admin/customers/page.tsx` | Ikon Onboarding completed/Pending onboarding memakai success/waiting tokens; Registered customers/Total orders tetap kategori |
| `/admin/customers/[id]` | `apps/admin/src/app/admin/customers/[id]/page.tsx` | Onboarding, email verification dan riwayat order dipetakan terpisah; email status jadi StatusBadge di posisi nilai existing |
| `/admin/products` | `apps/admin/src/app/admin/products/page.tsx` | Aktif success, habis progress/warning, arsip neutral |
| `/admin/products/[id]` | `apps/admin/src/app/admin/products/[id]/page.tsx` | Status produk dan cabang stok memakai mapping yang sama dengan daftar masing-masing |
| `/admin/branches` | `apps/admin/src/app/admin/branches/page.tsx` | Aktif success; nonaktif neutral |
| `/admin/users` | `apps/admin/src/app/admin/users/page.tsx` | Aktif success; Reset diperlukan warning; Role badge tetap kategori. Tidak membuat dukungan status baru |
| `/admin/roles` | `apps/admin/src/app/admin/roles/roles-list-client.tsx` | Arsip neutral + ikon Archive existing; Sistem/Owner/Kustom tetap kategori |
| `/admin/discounts` | `apps/admin/src/app/admin/discounts/discounts-list-client.tsx` | Seluruh lifecycle Offer, bukan hanya enabled vs lainnya; Ada draft neutral |
| `/admin/discounts/[id]` | `apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx` | Mapping sama dengan daftar; dirty-state dan publish behavior tetap |
| Kode diskon | `apps/admin/src/app/admin/discounts/[id]/discount-codes-section.tsx` | active success; inactive/archived neutral; draft-code tidak diklaim sudah berlaku |
| `/admin/products/harga` | `apps/admin/src/app/admin/products/harga/price-change-client.tsx` | Source invalid error; Aktif success; Target nonaktif warning; Tanpa markdown neutral |
| Import Excel | `apps/admin/src/app/admin/products/harga/price-change-excel-client.tsx` | Row dan aggregate outcomes berwarna sesuai §6; source/koreksi badges tetap kategori |
| Dialog bulk harga | `apps/admin/src/app/admin/products/harga/price-change-dialog.tsx` | Feedback container memakai tone aggregate; seluruh copy jumlah, halt/recovery dan error detail tetap |
| `/admin/pages` | `apps/admin/src/app/admin/pages/page.tsx` | Dipublikasi success; Draft neutral |
| `/admin/homepage/preview` | `apps/admin/src/app/admin/homepage/preview/page.tsx` | Nonaktif neutral, bukan destructive; semua section/announcement consumer |
| `/admin/analytics` | `apps/admin/src/app/admin/analytics/analytics-dashboard.tsx` | Status breakdown dan recent orders menjadi StatusBadge; count/time/total tetap. Tidak redesign chart |

**Consumer shared yang wajib direview, bukan otomatis diedit:** `apps/store/src/app/page.tsx`, `apps/store/src/app/products/page.tsx`, `apps/store/src/app/products/[id]/page.tsx`, `apps/store/src/app/branches/page.tsx`, `packages/ui/src/components/homepage/CarouselProductSection.tsx`, `packages/ui/src/components/homepage/StoreBannerSection.tsx`, serta admin homepage preview. Jika consumer aktual berbeda saat implementation, catat discovery dan bukti render pada parent yang benar; jangan membuat perubahan unrelated.

### 5.3 Kontrak non-regresi list/table

Perubahan hanya indikator status di cell/summary. Search scope, server/client-side search, pagination/limit/total, sorting, filter values/defaults, reset page, query URL, browser back/forward, branch scope, row actions, toolbar dan feedback existing **harus tetap**. Tidak menambah filter berdasarkan warna atau filter domain baru.

Referensi kontrak existing: `apps/admin/src/features/customers/customer-list-repository.ts` dan `apps/admin/src/app/admin/customers/customer-table.tsx`; `apps/admin/src/lib/delivery-work-list.ts` dan `apps/admin/src/app/admin/orders/page.tsx`. Untuk list lain, pertahankan query/backend existing tanpa mengubahnya. Warna tidak boleh memindahkan filtering ke current browser page atau menghilangkan pagination.

## 6. Mapping status final

`waiting` orange; `progress` amber (termasuk warning); `ready` teal; `info` blue; `success` emerald; `error` red; `cancelled` rose; `neutral` slate. Warning dan progress berbagi amber; label menjelaskan apakah sedang bekerja atau butuh perhatian.

### 6.1 Domain umum

| Domain | Nilai → tone |
|---|---|
| `order` | pending_payment → waiting; processing → progress; ready_for_pickup → ready; completed → success untuk **penutupan lifecycle**, bukan bukti delivered; cancelled → cancelled; failed_payment → error |
| `payment` | pending → waiting; paid → success; failed → error |
| `product` | aktif → success; habis → progress; arsip → neutral |
| `branch` | aktif → success; nonaktif → neutral |
| `stock-visibility` | unavailable → progress; unconfirmed → info; ini view keys dari dua kondisi existing ProductCard, bukan enum DB baru |
| `onboarding` | completed → success; pending → waiting; boolean existing dikonversi ke view keys ini |
| `email-verification` | verified → success; unverified → waiting |
| `email-verification-flow` | verifying → progress; success → success; error → error |
| `admin-user` | active → success; reset_required → progress; hanya menggambarkan label yang memang dirender saat ini |
| `role` | archived → neutral; tipe/Role Name bukan status |
| `offer` | draft → neutral; enabled → success; paused → progress; archived → neutral |
| `discount-code` | active → success; inactive → neutral; archived → neutral |
| `redemption` | reserved → waiting; consumed → success; released → neutral |
| `markdown` | invalid_source → error; active → success; inactive_target → progress; absent → neutral; view keys dihitung dari kondisi existing tanpa ubah eligibility |
| `price-row` | pending → waiting; applied → success; unchanged → neutral; failed → error |
| `checkout-result` | success → success; pending → waiting; cancel → error; mengikuti label existing “Pembayaran Gagal”, tidak menyatakan hasil server lebih pasti |
| `checkout-attempt` | preparing → progress; compensating → progress; processing → progress; manual_review → progress; rejected → error; promoted → neutral (promosi attempt bukan paid/fulfilled) |
| `stock-operation` | pending/in_flight/reconciling/manual_review → progress; applied/committed → success; failed → error |
| `sales-operation` | intent → progress; dispatched_unknown/manual_review → progress; confirmed → success; rejected → error; aborted → cancelled. Hanya dipakai bila status SalesOperation memang ditampilkan; jangan memakai vocabulary SalesOperation untuk StockOperation |
| `cms-page` | published → success; draft → neutral |
| `homepage-content` | inactive → neutral |
| `promo-selection` | applied → success untuk badge Dipakai; selected/recommended tidak masuk resolver ini |

Semua null, undefined, empty string, atau identifier yang tidak dikenal → **neutral**. Jangan memakai heuristic substring seperti `includes("success")`. Nilai asing tidak otomatis error/paid/delivered.

Label foreign/null: customer order tetap “Status pesanan belum tersedia”; tracking tetap “Pembaruan pengiriman”. Bila admin sebelumnya menampilkan raw status, tetap tampilkan raw status yang di-escape React dengan neutral tone; null/kosong gunakan “Status belum tersedia”. Jangan membocorkan raw provider internals ke customer melalui fallback baru.

`completed` pada badge **order lifecycle** boleh success karena order telah ditutup. Jika surface menampilkan **delivery stage**, `Selesai manual`/`Order tidak aktif` wajib neutral. Jangan mengganti teks completed menjadi “Barang diterima” tanpa authoritative delivered evidence. Ini mengikuti perbedaan Order Selesai dan Delivery Sudah Sampai dalam glossary.

### 6.2 Delivery stages

Gunakan output `projectDeliveryStage` yang sudah authoritative; jangan menghitung ulang eligibility/transisi. Mapping exact label sementara diperlukan karena kontrak existing hanya memiliki label, guidance, terminal—bukan stable stage ID.

| Label existing | Tone |
|---|---|
| Menunggu pembayaran | waiting |
| Verifikasi pembayaran | progress |
| Verifikasi tertunda | progress |
| Siapkan barang | progress |
| Barang siap | ready |
| Menunggu penjemputan | waiting |
| Diserahkan ke kurir | info |
| Dibawa kurir | info |
| Dalam pengiriman | info |
| Barang diterima | success |
| Selesai manual | neutral |
| Menunggu hasil booking | progress |
| Booking belum pasti | progress |
| Stok tidak tersedia | progress |
| Barang rusak | error |
| Batas layanan terlampaui | error |
| Pengiriman tertahan | progress |
| Barang dikembalikan | cancelled |
| Pengiriman dibatalkan | cancelled |
| Kendala pengiriman | error |
| Order tidak aktif | neutral |

**Seluruh 21 output harus dites**, bukan hanya 20 pilihan `DELIVERY_STAGE_LABELS`. Guidance, terminal flag, dan tombol tidak berubah.

### 6.3 Tracking provider normalized

| Identifier | Tone |
|---|---|
| WAITING | waiting |
| CONFIRMED_BY_COURIER | info |
| ON_THE_WAY_PICK_UP; alias presentasi ON_THE_WAY_PICKUP | info |
| PICKED_UP | info |
| ON_DELIVERY | info |
| DELIVERED | success |
| ON_HOLD | progress |
| RETURNED | cancelled |
| CANCELED | cancelled |
| SHIPMENT_ISSUE | error |

Label customer tetap berasal dari `apps/store/src/lib/order-tracking-presentation.ts`; jangan mengubah normalized schema/provider codes atau menyimpulkan delivered dari order.completed.

### 6.4 Aggregate import/bulk harga

Tone berdasarkan **jumlah hasil dan halt reason existing**, bukan sekadar `statusMessage().tone`, karena helper existing menggabungkan partial dan total failure sebagai error.

Urutan prioritas:

1. `haltReason` ada → error; pertahankan pesan halt dan tindakan recovery existing.
2. Ada pending dan ada failed → progress; tampilkan jumlah pending/failed existing, jangan success.
3. Ada pending tanpa failed → progress.
4. Tanpa pending, seluruh baris failed dan rowCount > 0 → error.
5. Tanpa pending, sebagian failed → progress, dengan jumlah gagal terlihat.
6. Tanpa pending/gagal, appliedCount > 0 → success, termasuk mixed applied+unchanged.
7. Hanya unchanged atau belum ada hasil (termasuk rowCount = 0) → neutral.

Tidak mengubah `statusMessage`, persistence batch state, validasi harga, atau akuntansi jumlah. Resolver baru hanya memetakan presentasi. Semua nilai counts berasal dari DTO existing, bukan recompute current page.

## 7. Palet dan kontrak komponen

### 7.1 Warna final draft

Setiap tone memiliki background/foreground/border **opaque**, sama antara kedua app. Token baru bernama `--status-<tone>-background`, `--status-<tone>-foreground`, `--status-<tone>-border`; kelas reusable didefinisikan dalam shared styling, bukan classes berbeda per halaman. Tidak mengubah primary/secondary/destructive generic.

| Tone | Light background | Light teks | Light border | Dark background | Dark teks | Dark border |
|---|---|---|---|---|---|---|
| waiting | #FFF7ED | #9A3412 | #FED7AA | #431407 | #FED7AA | #9A3412 |
| progress | #FEF3C7 | #92400E | #FDE68A | #451A03 | #FDE68A | #92400E |
| ready | #F0FDFA | #115E59 | #99F6E4 | #042F2E | #99F6E4 | #115E59 |
| info | #EFF6FF | #1E40AF | #BFDBFE | #172554 | #BFDBFE | #1E40AF |
| success | #ECFDF5 | #065F46 | #A7F3D0 | #022C22 | #A7F3D0 | #065F46 |
| error | #FEF2F2 | #991B1B | #FECACA | #450A0A | #FECACA | #991B1B |
| cancelled | #FFF1F2 | #9F1239 | #FECDD3 | #4C0519 | #FECDD3 | #9F1239 |
| neutral | #F1F5F9 | #334155 | #CBD5E1 | #0F172A | #CBD5E1 | #475569 |

Light ratios: 6.88, 6.37, 7.27, 8.01, 7.29, 7.60, 7.30, 9.45:1 sesuai urutan tabel. Dark ratios yang dihitung saat drafting melalui Node memakai rumus sRGB WCAG: 11.56, 12.03, 11.48, 10.34, 11.81, 11.16, 11.08, 12.02:1. Semua tetap memerlukan pengukuran computed style sesudah implementasi; angka ini bukan bukti browser PASS.

Jika kontras rendered gagal, perbaiki wiring/token/compositing dahulu. Perubahan hue/pemetaan dari tabel memerlukan keputusan user, bukan redesign diam-diam. Border tinted pasif tidak diwajibkan 3:1 jika label teks sudah menyampaikan informasi; cue non-text esensial mengikuti SC 1.4.11.

### 7.2 Komponen dan pemakaian ulang

| Elemen | Reuse / baru | Kontrak |
|---|---|---|
| Generic Badge | Reuse `packages/ui/src/components/ui/badge.tsx` | Variant dan behavior existing tidak berubah untuk non-status consumer |
| StatusBadge | Baru `packages/ui/src/components/ui/status-badge.tsx` | Render pill pasif dari Badge dengan explicit tone; ukuran/radius/typography mengikuti Badge; tidak mewarisi primary hover |
| Domain resolver | Baru `packages/ui/src/lib/status-presentation.ts` | Pure lookup domain/value + aggregate helper; tidak import DB/auth/provider/Next server APIs |
| Shared status treatment | Baru `packages/ui/src/lib/status-styles.ts` | Static classes untuk background/foreground/border token, dipakai StatusBadge dan ikon/container feedback |
| Token | Existing `globals.css` kedua app | Tambah delapan set light/dark; nilainya harus identik lintas app |
| Tracking heading/timeline | Reuse OrderFulfillmentPanel | Label memakai StatusBadge; timestamp/detail/navigation existing tetap |
| Result dan summary icons | Reuse container/icon existing | Pakai token/treatment tone tanpa membuat button baru |

StatusBadge bukan live region otomatis, tidak diberi `tabIndex`, `onClick`, atau role button. Pertahankan aria/role feedback existing. Label tidak terpotong dengan ellipsis; wrap dalam max-width container. Unknown tetap label eksplisit. Ikon existing yang dekoratif memakai `aria-hidden` agar tidak mengulang status. Tidak menambah ikon baru untuk setiap enum; Archive/clock/check/error existing tetap sesuai konteks.

## 8. Blueprint teknis

### 8.1 File shared dan public contracts

| Path | Aksi | Tanggung jawab/layer | Test seam |
|---|---|---|---|
| `packages/ui/src/lib/status-presentation.ts` | create | Pure presentasi domain; satu sumber mapping, aggregate outcome | Public getStatusTone/getPriceBatchTone |
| `packages/ui/src/lib/status-styles.ts` | create | UI styling; satu static treatment per tone | Render browser pada StatusBadge/icon/panel |
| `packages/ui/src/components/ui/status-badge.tsx` | create | UI component; render label dan tone pasif | Actual page locators + computed colors |
| `packages/ui/src/index.ts` | modify | Export shared component, functions, types | Consumer imports/typecheck |
| `apps/store/src/app/globals.css` | modify | UI tokens light/dark | Browser computed styles store |
| `apps/admin/src/app/globals.css` | modify | UI tokens light/dark identik store | Browser computed styles admin |
| `apps/store/src/lib/status-presentation.test.ts` | create | Test entry untuk pure shared resolver di Vitest workspace store existing | getStatusTone/getPriceBatchTone, expected table literal |
| `e2e/store/status-colors-mock.spec.ts` | create | Browser coverage seluruh store surfaces pada §5 | User-visible label + real computed colors |
| `e2e/admin/status-colors-mock.spec.ts` | create | Browser coverage seluruh admin surfaces pada §5 | User-visible label + real computed colors |
| `playwright.mock.config.ts` | modify | Test config; daftarkan `status-colors` pada kedua testMatch yang relevan | Listing specs dan execution evidence |
| `docs/features/status-colors.md` | create saat implementasi | Dokumentasi permanen mapping, pengecualian, cara menambah status | Review terhadap spec + evidence |
| `docs/README.md` | modify saat implementasi | Index ke dokumentasi status | Link check |
| `.agents/skills/ux-design/SKILL.md` | modify bila perlu saat closing | Sinkronkan rujukan permanen/kontrak final; pedoman sudah ditambahkan saat research | Review konsistensi skill/spec/docs |

**Daftar seluruh file UI consumer yang boleh diedit, tanggung jawab, dan seam:** tabel §5.1–5.2 adalah bagian normatif blueprint file-level, semuanya layer **UI component/page**, aksi **modify**, seam browser `e2e/store/status-colors-mock.spec.ts` atau `e2e/admin/status-colors-mock.spec.ts` sesuai app. `PromoSelectionDialog.tsx` dan daftar review-only §5 bukan izin mengubah flow. Tidak ada service/repository/schema/route baru.

Kontrak export, tanpa implementation body:

- `StatusTone`: union `waiting | progress | ready | info | success | error | cancelled | neutral`.
- `StatusDomain`: union domain pada §6.1 ditambah `delivery-stage` dan `tracking`.
- `getStatusTone(domain: StatusDomain, value: string | null | undefined): StatusTone` — exact mapping §6, fallback neutral.
- `PriceBatchOutcome`: `{ rowCount: number; pendingCount: number; appliedCount: number; unchangedCount: number; failedCount: number; haltReason: string | null }`.
- `getPriceBatchTone(outcome: PriceBatchOutcome): StatusTone` — prioritas §6.4; tidak menghasilkan copy atau mutasi data.
- `getStatusToneClassName(tone: StatusTone): string` — static opaque surface/foreground/border classes untuk token semantik; tidak menerima domain.
- `StatusBadgeProps`: subset presentasional Badge props berupa `tone: StatusTone`, `children: ReactNode`, `className?: string`, `aria-label?: string`, `aria-describedby?: string`, `data-testid?: string`; tidak mengekspos variant/onClick/role interaktif.
- `StatusBadge(props: StatusBadgeProps)` — pill pasif; semua kelas warna dari shared treatment; caller className hanya layout/wrapping, bukan override semantic hue.

Pemakaian `Badge` dari alias `@/components/ui/*` memang diarahkan ke `packages/ui` oleh tsconfig kedua app. Jangan membuat badge lokal di masing-masing app. Resolver bisa diimpor lewat shared subpath agar test tidak menarik seluruh barrel yang meng-export komponen lain.

### 8.2 Keputusan struktur

- **Satu shared resolver, bukan per-page maps:** status order yang sama harus sama tone lintas app. Domain eksplisit menghindari collision `active`, `pending`, atau `completed` yang memiliki konteks berbeda.
- **Tidak membuat universal workflow engine:** resolver hanya presentasi; urutan dan evidence tetap dari DTO/projection existing. Tidak menambah dependencies ke DB package untuk styling.
- **StatusBadge baru, bukan mengubah arti default Badge:** menjaga non-status categories, counter, dan CTA brand.
- **Styles shared, token di theme masing-masing app:** mengikuti struktur globals existing dan memungkinkan dark override; kesamaan token lintas app dijaga browser tests. Tidak menambah global CSS import pipeline atau Tailwind config yang belum perlu.
- **Test shared resolver melalui project store existing:** root Vitest saat ini tidak memasukkan `packages/ui` sebagai test project. Satu entry app test yang mengimpor shared pure subpath mencegah test baru diam-diam tidak berjalan, tanpa menambah workspace/test framework.
- **Delivery exact-label map:** mengikuti exported contract existing; perubahan ke stable stage ID adalah pekerjaan terpisah, bukan alasan mengubah backend projection pada task warna.
- **Tidak mengubah API:** auth Better Auth store/admin tetap terpisah, RBAC/branch scope tetap mengikuti ADR accepted.

### 8.3 Discovery dan checkpoint implementasi

- `discovery:` konfirmasi fixture data/session per halaman, khususnya SSR customer summary dan branch/homepage yang tidak dapat dimock hanya dengan browser route interception. Gunakan seeded **disposable DB** existing dan mock local origins; jangan menambah production bypass atau mengubah app ke client fetch demi test.
- `discovery:` pastikan consumer rendered aktual ProductCard/BranchCard pada halaman dan preview yang tersedia; periksa apakah parent grid memotong pill panjang. Perubahan wrapper yang diperlukan di luar daftar edit harus dicatat/proposed sebelum memperluas scope.
- Semua `.dark` tokens diuji dengan class theme existing pada browser test; tidak menambah theme picker, provider, atau persisted preference. Tidak ditemukan theme switcher dari pencarian source saat drafting; ini bukan alasan melewatkan verifikasi token dark.
- **Context7 checkpoint drafting:** N/A — hanya Markdown, tidak menulis external package API code. Sebelum code slice pertama yang memakai React/CVA/Playwright/Vitest atau API framework, lakukan inquiry Context7 sesuai AGENTS.md dan catat ID/signature di implementation notes. Bila tidak tersedia, gunakan installed types/source atau official docs dan nyatakan fallback.
- **Deployment/schema:** N/A; tidak ada env, endpoint, build step, port, migrations, seed schema, atau deployment config yang berubah.
- Worktree mempunyai perubahan fitur lain; jangan menimpa atau memasukkannya dalam scope ini. E2E/provider fixtures existing yang sedang berubah harus direkonsiliasi saat implementasi, bukan disalin dari state lama.

## 9. Blueprint UX dan state matrix

### 9.1 Referensi dan hierarki

- Referensi bentuk pill/typography: `packages/ui/src/components/ui/badge.tsx`.
- Referensi treatment tinted status: admin order detail dan customer onboarding badge existing; **mapping lokalnya bukan standar final**, digantikan tabel §6–7.
- Struktur customer detail tetap mengikuti `apps/store/src/app/account/orders/[id]/page.tsx` beserta OrderPaymentSummary/OrderFulfillmentPanel; list/table tidak di-redesign.
- Primary action tiap halaman tetap yang existing (mis. Lihat Detail, bayar, verifikasi pickup, simpan/publish); badge tidak menjadi primary action atau tautan baru.
- Tidak ada prototype yang diminta; spec ini mengikat mapping dan struktur penempatan indikator, existing shared components/tokens tetap sumber typography/spacing.

### 9.2 Copy dan state matrix

Copy lifecycle existing pada file §5 dipertahankan; §6 tidak mengganti label English menjadi Indonesia atau sebaliknya. Penambahan indikator memakai copy eksplisit di bawah, bukan copy yang diciptakan saat implementasi.

| Surface/state | Copy/indikator final | Tone/perilaku |
|---|---|---|
| Store riwayat idle | Pending Payment / Processing / Ready for Pickup / Completed / Cancelled / Payment Failed | Sesuai `order`; tidak mengubah urutan cards |
| Store detail idle | Menunggu pembayaran / Pesanan diproses / Siap diambil / Pesanan selesai / Pesanan dibatalkan / Pembayaran gagal | Sesuai `order` |
| Store payment | Menunggu / Lunas / Gagal | waiting/success/error |
| Store unknown order | Status pesanan belum tersedia | neutral; tidak menampilkan raw identifier baru |
| Store tracking | Label existing dari `getTrackingStatusLabel`; fallback “Pembaruan pengiriman” | Tabel tracking; event tetap terbaru dahulu |
| Store promo detail reserved | Direservasi sampai batas pembayaran | waiting; pill wrap bila panjang |
| Store promo detail consumed | Dipakai (lunas) | success; tidak mengubah payment status |
| Store promo detail released | Dibatalkan (kapasitas dilepas) | neutral |
| Store promo unknown | Status promo belum tersedia | neutral; unknown tidak lagi dinyatakan reserved tanpa evidence |
| Verifikasi email pending/success/error | Memverifikasi... / Email Terverifikasi! / Verifikasi Gagal | Heading existing tetap; ikon dekoratif dalam tinted container di atas heading memakai progress/success/error, tanpa copy duplikat |
| Stock visibility | Stok Belum Tersedia / Cek stok saat bayar | progress/info |
| Admin onboarding list/detail | Selesai / Belum selesai; Onboarding completed / Onboarding pending | success/waiting; emailVerified tidak menentukan badge ini |
| Admin email verification | Verified / Not verified | success/waiting; posisi nilai existing tetap |
| Admin review warning baru | Perlu pemeriksaan | progress; kategori operasi dipisah |
| Admin unknown/null | Raw label existing bila ada; “Status belum tersedia” bila kosong | neutral |
| Manual close delivery | Selesai manual; guidance “Order ditutup manual.” | neutral; tidak “Barang diterima” |
| Booking belum pasti | Booking belum pasti; guidance “Konfirmasi ke Jubelio. Jangan pesan ulang.” | progress; tidak menambah retry action |
| Bulk/import final | Pesan jumlah dari `statusMessage` dan `haltMessage` existing, tanpa perubahan angka/copy | Tone aggregate §6.4 |
| Semua halaman loading | Loading/skeleton/spinner existing; tidak menambah badge lifecycle palsu | Jangan success sebelum data siap; state flow tetap |
| Empty/no results | Copy existing masing-masing halaman; tidak membuat “status kosong” badge | Tidak mengubah search/filter UX |
| Fetch error | Copy/retry existing; bukan `failed` bisnis | Error UI tidak menimpa status record/DTO |
| Tanpa izin/disabled | PolicySafeState/guard/disabled reason existing | Tidak memunculkan data atau action melalui badge |
| Unsaved draft | Ada draft dan dirty-state existing | neutral indicator; tidak diklaim published |

Koreksi terbatas copy unknown promo diperlukan agar fallback netral tidak menyatakan reservasi yang belum diketahui. Tidak menambah label lifecycle bisnis baru; hanya unavailable fallback. Bentuk copy loading/empty/error existing yang tidak disentuh tidak disalin ulang atau dilokalisasi.

### 9.3 Viewport, accessibility, dan interaksi

- Review store pada 390×844 dan 1440×900; admin pada 390×844 dan 1440×900. Tabel boleh horizontal scroll dalam region existing, bukan overflow seluruh halaman.
- Long label harus wrap tanpa memotong ID, tombol, atau kolom nominal; tidak memperkecil typography untuk memaksa muat. Token padding/radius mengikuti Badge shared; gunakan cell/container layout existing.
- Uji delapan tone pada light dan `.dark` di **kedua app**: teks computed contrast minimal 4.5:1, opaque surfaces; foreground/background tone sama lintas app pada theme sama.
- Passive hover tidak mengubah background/foreground/border menjadi primary atau tone lain. Tidak cursor-pointer atau keyboard stop baru; selected/focus pada kontrol existing tetap terlihat.
- Status dapat dipahami dari label tanpa warna. Jangan menambah live region pada semua row/event; pertahankan pengumuman async existing.
- Label panjang, unknown, beberapa badge (order/payment/stage), dan shared consumer harus ditinjau rendered; passing mapping unit tests tidak mencukupi.

## 10. Strategi pengujian

### 10.1 Public seams dan prior art

Seam utama logika adalah `getStatusTone/getPriceBatchTone` shared. Seam user-facing adalah halaman nyata yang merender komponen/tokens, bukan storybook atau page test-only yang berbeda dari app.

Prior art yang sudah diperiksa:

- `apps/store/src/lib/order-tracking-presentation.test.ts`: table-driven public pure function tests.
- `apps/admin/src/lib/delivery-workflow.test.ts`: evidence-based stage projection; read-only regression reference, tidak perlu mengubah logic.
- `e2e/store/order-detail-presentation-mock.spec.ts`: fixture DTO deterministik, real server session, browser GET interception.
- `e2e/store/form-field-contrast-mock.spec.ts` dan `e2e/support/contrast.ts`: actual computed colors/contrast, bukan class string assertions.
- `e2e/admin/customers-pagination-mock.spec.ts`, `e2e/admin/order-notifications-mock.spec.ts`, `e2e/admin/price-change-excel-mock.spec.ts`, `e2e/admin/discounts-prototype-mock.spec.ts`: pola page fixtures dan list/state coverage.

Tidak mengubah expected value menjadi hasil import dari implementation map. Expected domain→tone dan warna pada tests harus literal dari tabel spec; contrast threshold dari WCAG. Jangan mengetes nama private helper, snapshot classes saja, atau `getStatusTone(...) === MAP[...]` yang tautologis.

### 10.2 Unit coverage

File baru `apps/store/src/lib/status-presentation.test.ts` wajib menguji:

- Seluruh domain/nilai §6.1, seluruh 21 delivery outputs, tracking alias dan fallback null/undefined/empty/asing untuk setiap domain.
- Completed order success berbeda dari delivery-stage manual close neutral; payment paid success tidak berubah karena stage lain.
- Aggregate matrix §6.4: pending, pending+failed, total failure, partial failure, success+unchanged, unchanged-only, zero rows, serta halt override.
- Unknown tidak crash dan tidak menjadi success/error otomatis; domain berbeda untuk string serupa tidak tertukar.

Tidak perlu Vitest project baru; jalankan test entry store yang mengimpor shared resolver. Jika implementation memilih menambah public seam di luar blueprint, stop dan proposal, bukan menambah God resolver dengan IO.

### 10.3 Browser coverage dan AC evidence

Dua spec `status-colors-mock.spec.ts` dibagi describe menurut surface pada §5. Setiap row surface wajib memiliki evidence browser saat indikatornya terlihat; jangan menganggap satu halaman membuktikan semua consumer.

- Store history/detail: seluruh enam order values, payment values, safe unknown, perbandingan ready vs completed.
- Tracking: semua normalized statuses/fallback minimal terwakili dalam fixture latest/timeline; manual close/unknown tidak diklaim delivered.
- Admin orders/list/detail/notification/customer history: semantic equality lintas page; payment dan stage terlihat bersamaan.
- Product/branch shared consumers: actual store catalog/homepage/branches serta admin product/stock branch. Pastikan badge kategori tidak berubah.
- Customer onboarding dan email verification diuji dengan fixture **onboarding true + email false**, serta kebalikannya untuk membuktikan pemisahan.
- Offer list/editor/codes, Roles, Users, CMS preview/pages, markdown/import rows/bulk feedback, analytics: state matrix terlihat, unknown neutral, tidak mengubah CTA/filter behavior.
- Verification flow: kontrol response auth di boundary test-only route interception; jangan mengubah production auth atau timer demi test. Result checkout: tiga kondisi query existing.
- Delapan tone light/dark dari halaman aktual kedua app: expected computed RGB literal dari §7, ratio ≥4.5:1, same-theme cross-app equality, pasif sebelum/sesudah hover. Pengukuran icon-only cue esensial ditinjau sesuai kebutuhan 3:1, bukan otomatis dianggap lolos dari rasio teks.
- Mobile/desktop: long copy, multi-badge layout, keyboard tab order/action focus, existing empty/loading/error/retry/permission/unsaved states tidak rusak.
- List regression: gunakan coverage existing yang relevan untuk search record di luar halaman pertama, pagination/reset/filter/URL. Jangan menggandakan mutating checkout flow hanya untuk mengukur badge.

Fixture: local isolated mock origins, seeded disposable DB bila SSR/session membutuhkannya, provider external mocked; tidak ada live Jubelio POST. Setup database bukan bagian implementasi schema; tetap minta izin eksplisit jika perlu menyentuh DB development user. Jika prasyarat test tidak ada, laporkan AC Pending—jangan memakai session palsu atau live provider.

### 10.4 Verification ladder

**Selama development:** satu vertical slice, failing focused test dahulu lalu implementasi. L0 `npm run verify:types:store` dan `npm run verify:types:admin` sesuai consumer terdampak. L1 awal:

`npm run verify:unit:slice -- apps/store/src/lib/status-presentation.test.ts`

Coverage E2E ditulis bersama slice, eksekusi di final gate, bukan broad suite per batch.

**Final integrated scope:**

1. `npm run test:unit` (dapat memakai `-- --no-file-parallelism` sesuai kebutuhan isolation documented).
2. `npm run verify:batch:e2e -- e2e/store/status-colors-mock.spec.ts e2e/admin/status-colors-mock.spec.ts`.
3. Regression mock existing yang relevan dengan explicit paths, minimal: `e2e/store/order-detail-presentation-mock.spec.ts`, `e2e/store/stock-visibility-mock.spec.ts`, `e2e/store/discounts-coupon-mock.spec.ts`, `e2e/admin/order-notifications-mock.spec.ts`, `e2e/admin/customers-pagination-mock.spec.ts`, `e2e/admin/price-change-excel-mock.spec.ts`, `e2e/admin/price-change-bulk-mock.spec.ts`, `e2e/admin/discounts-prototype-mock.spec.ts`, `e2e/admin/checkout-attempt-review-mock.spec.ts`. Jika rendered behavior di surface terkait berubah tak terduga, tambahkan focused regression pada failure tersebut sebelum mengulang final affected gate.
4. Main agent melakukan rendered UX review lintas surface/theme/viewport dan menautkan ringkasannya di evidence. Simpan disposable artifacts hanya di `playwright/`.
5. Legacy `npm run test:e2e` memerlukan izin terpisah; jangan menjalankannya otomatis. Status AC hanya Verified jika bukti mock/browser yang ditetapkan benar-benar mencakup kontraknya; jangan menyebut legacy suite PASS jika tidak dijalankan.

Semua command di atas adalah **rencana**, belum dijalankan pada tahap spec. Tidak membuat jumlah test PASS fiktif. Bila Playwright gagal, baca laporan Markdown, jangan membuka screenshot failure.

## 11. Acceptance criteria → evidence

Status per 2026-11-14 setelah implementasi terintegrasi. Gate dijalankan pada DB disposable
`marketplace_discounts_test_statuscolors` (dibuat + `db:push` + `db:seed` dengan izin user);
`.env` dan DB dev `storefront` tidak diubah. Batasan yang belum tercakup dicatat di
[`docs/features/status-colors.md`](../../../docs/features/status-colors.md) §9.

| ID | Kriteria yang dapat diamati | Bukti yang diwajibkan | Status |
|---|---|---|---|
| AC01 | Ready for Pickup/Siap diambil teal dan Completed/Pesanan selesai emerald pada riwayat/detail; tidak lagi navy identik | Store browser fixtures + rendered review | Verified — `e2e/store/status-colors-mock.spec.ts` “riwayat pesanan membedakan seluruh status order…”: enam nilai + unknown, ready≠completed (warna computed berbeda), detail memakai tone yang sama. |
| AC02 | Semua domain/nilai §6 dan 21 stage memiliki mapping benar; asing/null netral | Focused unit test literal matrix | Verified — `apps/store/src/lib/status-presentation.test.ts` 59 test: seluruh domain §6.1, 21 delivery stage, tracking + alias, fallback null/undefined/kosong/asing, matriks §6.4, dan domain tidak tertukar. RED terbukti saat satu expected sengaja diubah. |
| AC03 | Mapping semakna sama pada store/admin/list/detail/notifikasi/customer history | Cross-page browser computed colors dan labels | Verified — kedua spec browser memakai palet literal §7.1 yang sama; label + tone order identik di riwayat, detail, daftar admin, notifikasi, customer history, dan analytics. |
| AC04 | Paid tetap success saat booking belum pasti warning; manual close/Order tidak aktif netral, bukan delivered | Unit + admin/store browser evidence | Verified — unit `getStatusTone`; browser: detail order menampilkan order progress + payment “Lunas” success bersamaan, daftar admin “Barang siap” ready vs “Booking belum pasti” progress, “Selesai manual” dan “Order tidak aktif” neutral. |
| AC05 | Tracking latest/timeline, payment result, verification dan Redemption store memakai treatment/copy §5–9 | Store browser seluruh state, termasuk unknown | Verified dengan catatan — tracking latest + timeline (semua normalized status + fallback), hasil checkout tiga kondisi, verifikasi email progress/success/error, dan Redemption (`Direservasi…`, `Dipakai (lunas)`, `Status promo belum tersedia`) terukur di browser. Badge “Dipakai” pada `PromoSelector` baru terverifikasi lewat mapping unit + kompilasi karena `discounts-coupon-mock` terblokir fixture DB (lihat AC14). |
| AC06 | Stock visibility berbeda habis vs unconfirmed; shared ProductCard/BranchCard consumers tidak regress | Store/admin actual consumer browser review | Verified dengan catatan — `BranchCard` “Buka” success terukur di `/branches` (store) dan preview homepage admin; tone stock-visibility `unavailable→progress`/`unconfirmed→info` terkunci di unit test dan invariant katalog store. Badge stok tidak dapat dipaksa muncul di katalog karena katalog menyembunyikan produk tanpa stok tersedia dan `CarouselProductSection` tidak meneruskan flag stok (batasan §9 dokumen permanen). |
| AC07 | Produk/cabang/Admin User/Archived Role/onboarding/email statuses mengikuti mapping; email dan onboarding tidak tertukar | Admin browser mixed boolean fixtures + unit | Verified — daftar dan detail customer admin: onboarding pending (waiting) dengan email Verified (success) pada customer yang sama, onboarding completed success; produk aktif/habis/arsip, cabang aktif/nonaktif, admin user aktif + reset, role arsip neutral dengan tipe role tetap kategori. |
| AC08 | Offer list/editor/codes, draft/paused/archive mengikuti tone; selection/recommendation tetap bukan lifecycle | Admin+store browser, regression badge kategori | Verified dengan catatan — daftar Offer: draft neutral, enabled success, paused progress, archived neutral, “Ada draft” tetap kategori. Editor dan kode diskon tidak dieksekusi di browser karena halaman editor membaca data DB offer yang tidak di-seed; keduanya memakai resolver `offer`/`discount-code` yang sama. |
| AC09 | Markdown/import rows/aggregate full/partial/no-op/halt mengikuti §6.4 tanpa mengubah counts/copy/eligibility | Unit batch outcomes + browser harga/import/dialog | Verified dengan catatan — markdown empat tone (invalid_source/active/inactive_target/absent) dan import Excel: baris applied/unchanged/failed plus agregat sebagian-gagal→progress dan seluruh-gagal→error terukur di browser; prioritas `haltReason`→error dan matriks lain di unit test. Container feedback dialog bulk tidak dieksekusi (alur dialog bulk tidak dijalankan) meski memakai resolver yang sama. |
| AC10 | CMS published/draft/nonaktif dan analytics status memakai mapping; kategori/counter/nominal tetap | Admin browser pages/preview/analytics + regression review | Verified — halaman CMS Dipublikasi/Draft, preview homepage “Nonaktif” neutral, dan analytics breakdown/recent orders memakai badge order yang sama; nominal, counter, dan tipe tetap teks biasa. |
| AC11 | Semua delapan tone ≥4.5:1 dan identik lintas app pada theme sama; passive hover stabil | Actual computed style light/dark kedua app, independen expected palette | Verified — computed `background/color/border` sama dengan palet literal light dan dark di kedua app, kontras ≥ 4.5:1, dan hover tidak mengubah warna (`e2e/support/status-colors.ts`). |
| AC12 | Label tetap terbaca tanpa warna, long labels/multi-badge tidak overlap, keyboard/actions/permission/unsaved tetap | Browser 390×844 dan 1440×900 + main-agent UX review | Verified dengan catatan — viewport 390×844 dan 1440×900 tanpa overflow horizontal pada daftar order admin; label status wrap (`whitespace-normal break-words`), badge pasif tanpa `tabIndex`/`onClick`, dan tidak ada kontrol/aksi yang dipindah atau dihapus sehingga urutan keyboard, aksi, permission, dan unsaved state tetap. |
| AC13 | Tidak ada perubahan lifecycle/API/schema/permission/search/pagination/filter/URL; generic Badge dan kategori/counter tetap kecuali treatment TYPE_LABEL review yang eksplisit pada §5.2 | Scoped diff review + regression Playwright relevan | Verified dengan catatan — diff terbatas pada presentasi (token CSS, resolver/komponen shared, indikator status); tidak ada perubahan route/API/schema/search/pagination/filter/URL maupun guard. Regresi mock: `order-detail-presentation` dan `order-notifications` PASS; `customers-pagination`, `price-change-excel`, `price-change-bulk`, `discounts-prototype`, `checkout-attempt-review` PASS kecuali satu test permission/fixture masing-masing; `stock-visibility` dan `discounts-coupon` terblokir prasyarat fixture DB. |
| AC14 | Full unit, mock E2E terkait, typecheck kedua app dan dokumentasi permanen memenuhi final gate | Command summaries, docs link, AC evidence table | Verified dengan catatan — `npm run verify:batch:unit` (full unit, `--no-file-parallelism`) 202 file / 2432 test PASS, 25 skip; `verify:types:store` + `verify:types:admin` PASS; lint tanpa error; 28 test browser warna status PASS; `docs/features/status-colors.md` ditautkan dari `docs/README.md`. Suite regresi yang terblokir fixture dicatat apa adanya, bukan diklaim PASS. |

## 12. Non-scope

- Perubahan transisi order/payment/shipment, stock reservation, checkout result source-of-truth, retry/compensation, provider vocabulary, atau authorization.
- Penyeragaman seluruh copy ke Bahasa Indonesia; mengganti customer workflow; mengubah CRUD/search/pagination/sorting/URL state.
- Member tier, Role Name/type, section type, notification type, promo recommendation/selection, discount percentages, import source labels, dan counters menjadi lifecycle badges.
- Redesign chart, navbar/sidebar, typography, layout seluruh halaman, theme switcher, animasi baru, atau evaluasi jam buka cabang real-time.
- Migrasi/schema/seed changes, provider writes, env/deployment, live integration, commits/push/remote.
- Ticket breakdown multi-session atau delegasi. Keduanya memerlukan persetujuan terpisah bila nanti dibutuhkan.

## 13. Urutan implementasi yang diusulkan

Bukan publikasi tickets. Setelah approval lengkap, kerjakan tracer-bullet yang berakhir di user path:

1. Shared mapping/treatment minimum + store riwayat → detail order/payment; bukti ready/completed dan unknown. Jangan melaporkan fondasi shared saja sebagai delivery.
2. Admin daftar → detail → notifikasi/customer history serta tracking customer; multi-dimensi payment/stage dan review queues.
3. Store product/branch/promo/result/verification dan admin master-data/accounts/CMS/analytics.
4. Offer/kode dan markdown/import/bulk feedback; integrasikan seluruh scope sebelum final full gate.

Setiap slice menulis tests pada public seams; main agent meninjau integrasi. Final broad gates sekali di akhir scope terintegrasi; perbaikan terfokus dahulu jika gagal. Tidak membuat approval plan sebagai izin subagent.

## 14. Open items dan catatan lanjutan

| Item | Penanganan |
|---|---|
| Approval dokumen lengkap | Disetujui user pada 2026-11-14 melalui “oke saya approve specnya”; gate approval terpenuhi. AC implementasi tetap Pending sampai diverifikasi |
| Fixture SSR/session dan disposable DB tersedia | Discovery teknis §8.3 sebelum slice browser terkait; tidak mengubah produk, laporkan blocker bila tidak tersedia |
| Context7 API inquiry | Dilakukan sebelum coding sesuai slice, bukan API guessing dari spec |
| Browser computed contrast, viewport, hover, cross-page review | Bukti implementasi masa depan; perhitungan palet bukan penggantinya |
| Factual research corrections | Onboarding ≠ email verification; StockOperation ≠ SalesOperation; research sudah diperbaiki, tidak mengubah model bisnis |

Tidak ada keputusan workflow/permission baru yang perlu dipilih setelah approval ini. Jika implementation mengungkap kebutuhan perubahan perilaku lain, stop bagian tersebut dan minta keputusan; jangan memperluas scope otomatis.

## 15. Checklist penutupan implementasi

- [x] AC01–AC14 memiliki evidence Verified untuk kode terintegrasi terkini (tabel §11; baris ber-catatan menyebut batasannya, bukan klaim PASS).
- [x] Semua surface §5 memiliki bukti browser atau dicatat Pending secara eksplisit: seluruh surface §5.1–5.2 tercakup di `e2e/store/status-colors-mock.spec.ts` dan `e2e/admin/status-colors-mock.spec.ts`, kecuali editor Offer/kode diskon dan dialog bulk (server-side DB fixture), yang dicatat sebagai batasan di [`docs/features/status-colors.md`](../../../docs/features/status-colors.md) §9 dan AC08/AC09.
- [x] Review rendered UX lintas app, viewport, dan theme dilakukan main agent melalui browser nyata: computed style light/dark, kontras, hover pasif, 390×844 dan 1440×900 tanpa overflow, serta label wrap pada badge status.
- [x] Final unit, typecheck, dan required mock E2E gate dijalankan; suite yang tidak lulus penuh dinyatakan apa adanya (blocker fixture environment, bukan regresi warna). Legacy `npm run test:e2e` tidak dijalankan.
- [x] Dokumentasi permanen `docs/features/status-colors.md` dibuat dan ditautkan dari `docs/README.md`; skill UX disinkronkan dengan kontrak final (bagian G menunjuk dokumen permanen, bukan lagi “belum token aplikasi”).
- [x] File spec/research tetap disimpan; index fitur mencatat Done dengan tanggal 2026-11-14 dan tautan evidence.
- [x] Tidak ada file/DB/provider/remote/commit di luar scope yang disentuh tanpa izin: DB dev `storefront` dan `.env` tidak diubah; DB disposable `marketplace_discounts_test_statuscolors` dibuat dengan izin user; tidak ada commit/push/remote/deploy.

## 16. Evidence penyusunan dokumen

Skill `to-spec` dibaca penuh; cakupan dan test seams dikonfirmasi lewat `ask_user_question`. Blueprint didasarkan pada source, alias tsconfig, Vitest projects, mock testMatch, prior-art Playwright/contrast helper, glossary dan ADR accepted yang diperiksa. Drafting hanya mengubah Markdown; tidak ada app implementation, tests aplikasi, atau browser verification yang diklaim.

Pemeriksaan dokumen: relative Markdown links dan whitespace pada spec/index/research lulus melalui Node; `git diff --check` pada index tracked lulus. Audit paths menunjukkan hanya tujuh file yang memang direncanakan sebagai create belum ada; source paths lainnya ditemukan. Terdapat 14 baris acceptance implementasi, seluruhnya Pending. Palet dark dihitung terpisah melalui Node, bukan disalin sebagai klaim browser PASS.
