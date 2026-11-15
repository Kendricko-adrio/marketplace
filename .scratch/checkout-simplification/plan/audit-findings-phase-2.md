# Plan fase 2: Perbaikan checkout, pembayaran, dan detail pesanan

Status plan keseluruhan hanya di [index fitur](../index.md). Versi ini menyintesis keputusan sesi grilling P0/P1 dan sesi lanjutan P2, yang keduanya dikonfirmasi user dengan **“Sesuai (Recommended)”**. Setelah revisi lengkap ditampilkan, user menyetujui perubahan status melalui **“oke bisa ganti status menjadi ready”**, lalu meminta implementasi penuh atas dokumen ini. Approval versi lengkap tercatat di §9; status lifecycle hanya dicatat di index. **Implementasi selesai 2026-11-15**: W01–W10 dan W12 dikerjakan, W11 tetap Deferred sesuai keputusan user, dan evidence gate ada di §7 serta §10.

Sumber:
- [Keputusan sesi grilling dan addendum P2](../wayfinder/keputusan-grilling-fase-2.md) — sumber keputusan produk terkini.
- [Cross-check audit](../research/cross-check-audit-ux-checkout-pembayaran.md) — koreksi T01–T22, T23–T26, gap E01–E06.
- [Laporan audit asal](../research/review-ux-checkout-pembayaran.md), [indeks capture](../research/indeks-capture-ux-checkout.md), [spec audit](spec-audit-ux-checkout-pembayaran.md).
- [Plan 1 copy/density](improve-checkout-copy-density.md) — sudah diimplementasikan menurut index; fase 2 melanjutkan baseline tersebut, bukan menjalankan ulang plan 1.

## 1. Masalah, solusi, dan kebutuhan pengguna

Pelanggan membutuhkan status pembayaran yang jujur, hasil pemeriksaan yang terlihat, dan informasi/aksi utama yang mudah ditemukan di mobile. Halaman hasil setelah Midtrans saat ini netral; status sebenarnya baru dibaca pada detail pesanan. Penyederhanaan tidak boleh menghilangkan biaya, alamat, barang, slot, atau persetujuan total baru.

Solusi: verifikasi status pesanan di halaman hasil melalui API toko; jelaskan recovery tanpa membuat transaksi; dahulukan total/aksi pada detail pending mobile; perjelas alamat, ETA dan dampak promo; perbaiki akses serta polish P2 yang dipilih. Persistensi draft setelah refresh tetap ditunda.

### Kebutuhan pengguna

1. Sebagai pelanggan yang kembali dari Midtrans, saya ingin langsung mengetahui status pesanan yang sesuai nomor pada redirect, bukan dianggap lunas/gagal berdasarkan query status.
2. Sebagai pelanggan yang belum login, saya ingin login lalu kembali ke pesanan yang sama tanpa kehilangan nomor pesanan.
3. Sebagai pelanggan ketika pemeriksaan gagal, saya ingin retry atau mencari pesanan tanpa dianggap gagal membayar.
4. Sebagai pelanggan dengan checkout belum pasti, saya ingin memeriksa request yang sama tanpa transaksi pengganti.
5. Sebagai pelanggan pending payment di mobile, saya ingin menemukan status, total dan aksi sebelum daftar barang panjang.
6. Sebagai pelanggan delivery, saya ingin membedakan alamat panjang, membaca ETA layanan terpilih, dan mengetahui kapan harus memilih layanan lagi.
7. Sebagai pengguna promo, saya ingin mengetahui alasan promo gugur dan perubahan total sebelum menyetujui lanjut tanpa promo.
8. Sebagai pengguna promo yang menurunkan total, saya ingin melihat selisih penghematan dekat total tanpa dialog tambahan.
9. Sebagai pelanggan yang membuka pesanan pickup selesai, saya ingin melihat status selesai dan mengakses kode lama hanya sebagai arsip.
10. Sebagai pelanggan dengan pesanan gagal/batal, saya ingin memiliki jalan lanjut aman tanpa reorder otomatis atau janji refund yang belum diketahui.
11. Sebagai pengguna mobile/keyboard, saya ingin loading dan feedback terbaca, fokus kembali dari modal, serta CTA tidak tertutup bantuan mengambang.
12. Sebagai pengguna toko, saya ingin tombol kecil mudah ditekan dan teks petunjuk, footer, badge cart serta inisial avatar mudah dibaca.
13. Sebagai pelanggan yang meninjau persetujuan, saya ingin membuka kebijakan di tab baru tanpa mengubah checkbox atau kehilangan isian checkout.

## 2. Koreksi audit yang tetap berlaku

| Kesimpulan draft lama | Batas revisi |
|---|---|
| Recovery tidak mempunyai loading | Loading sudah ada; masalahnya keterlihatan skeleton dan hasil pemeriksaan yang belum dijelaskan (T15/T24). P1, bukan otomatis P0. |
| Failed/cancelled tidak mempunyai jalan lanjut | Beli lagi per barang dan riwayat sudah ada; perjelas next action kontekstual (T16). |
| Promo turun tanpa feedback | Toast sudah ada; P2 menambah delta inline, bukan dialog penurunan total (T07). |
| Placeholder 3,6:1 boleh dipilih demi estetika | Teks aktif biasa perlu 4,5:1 untuk target AA; inactive exception dicatat terpisah (T20). |
| Semua target <24 px pasti gagal AA | Ukur spacing/equivalent exceptions; pembesaran area klik tetap improvement terpilih (T19). |
| Refresh/Batal wajib menyimpan draft | Persistensi memerlukan aturan data/privasi/TTL dan ditunda. Batal eksplisit bukan otomatis defect (T21). |
| Ganti alamat perlu konfirmasi untuk mempertahankan kurir | Reset quote/selection/ack adalah safety; jelaskan pemilihan ulang, tanpa dialog rutin (T22). |
| Root-font 200% membuktikan browser zoom gagal | Hanya screening. Verifikasi browser zoom/text resize dengan metode tercatat (T17). |
| Semua rekomendasi audit sudah terverifikasi | Gap capture/state dan fixture tetap harus dipulihkan; jumlah screenshot bukan coverage seluruh substate. |

Nomor AC2-01–AC2-16 dipertahankan. W01–W12 adalah pengelompokan scope, **bukan implementation ticket breakdown**.

## 3. Scope terkini dan keputusan

P0 = risiko menyesatkan status/tindakan finansial; P1 = friksi utama/akses; P2 = improvement sekunder. Sesi awal memilih P0/P1, lalu sesi lanjutan memasukkan P2 berikut. **Scope terkini: W01–W10 dan W12; W11 deferred.** Item WA bersyarat pada bukti gangguan; kebijakan bersyarat pada halaman existing yang layak.

| ID / prioritas | Temuan | Perilaku dalam versi untuk approval |
|---|---|---|
| W01 — P0 | T13 | Dengan `order_id`, GET detail owner-scoped. Status dari database; query status diabaikan. Loading/fallback/login-return mengikuti §6. Tanpa ID, arahkan riwayat; tidak memilih pesanan terakhir. |
| W02 — P1 | T10/T15/T24/T25 | Loading awal terlihat, background check mempertahankan detail/input; hasil checking/unchanged/updated/error eksplisit. Processing/manual review bukan failure definitif. Pemeriksaan memakai request yang sama dan tidak POST transaksi. |
| W03 — P1 | T11/T12 | Verified —  (9 passed): query settlement/capture/pending/deny vs DTO, paid+blocked, paid+cancelled, 404/401/403/5xx/envelope/identitas tidak sah, order_id kosong tanpa GET, ID bebas satu segmen, proxy callback (tanpa sesi), email return, argumen Google. Unit  3 passed. mobile: status → pembayaran/total/aksi → alamat/pickup → barang → bantuan. Tracking kosong ditunda, alamat tetap ada. Metode kosong dan deadline dijelaskan hanya sesuai data. |
| W04 — P1 | T06/T22/T23 | ETA existing di review, dropdown alamat bounded/wrapping dan penerima jelas. Setelah tujuan berubah, quote/selection/ack lama invalid dan pelanggan diminta memilih layanan lagi. |
| W05 — P1 + P2 | T08/T07 | Promo gugur: alasan + total before/after + pengakuan lanjut tanpa promo. Total turun: delta inline dekat total, tanpa dialog baru/toast duplikat. |
| W06 — P1 | T09 | Feedback inline utama yang terlihat/dapat difokuskan; toast hanya jika tidak ada tempat inline. Tidak menghapus satu-satunya pesan error yang terlihat. |
| W07 — P1 | T17/T18 | Layout dapat dipakai pada 320 dan pembesaran teks. Jika hit-test membuktikan WA mengganggu checkout/detail mobile, ganti tombol mengambang di surface tersebut dengan link bantuan biasa; halaman lain tetap. |
| W08 — P1 | T19/T20 | Fokus modal alamat kembali ke trigger; placeholder aktif diperjelas consumer-local, tanpa mengganti tema global/admin. |
| W09 — P2 | T19/T20 | Perluas area klik Close dialog checkout dan anchor sosial footer; perjelas teks footer, badge cart dan inisial avatar toko. Pertahankan gaya existing, periksa dampak shared component. |
| W10 — P1 + P2 | T14/T16/O09 | Gagal/batal: riwayat utama, Beli lagi per item tetap. Unknown: pemeriksaan utama. Pickup completed: tanpa instruksi pickup aktif, kode arsip tertutup. |
| W11 — deferred | T21 | Tidak menambah penyimpanan draft, TTL, restore refresh atau perubahan perilaku Batal. Recovery request key existing tetap dipertahankan. |
| W12 — P2 | T26 | Link kebijakan dekat checkbox membuka tab baru, tidak toggle checkbox/kehilangan isian. Gunakan halaman published existing yang diverifikasi; tidak membuat legal content. |

### Pemetaan temuan

| Temuan | Pemilik/perlakuan |
|---|---|
| T01–T05 | Plan 1; T02 validasi/fokus, bukan disable-until-valid otomatis |
| T06 | W04 |
| T07/T08 | W05; penurunan P2 dipilih, gugur P1 |
| T09 | W06 |
| T10/T15/T24/T25 | W02 |
| T11/T12 | W03 |
| T13 | Plan 1 mitigasi netral adalah baseline; W01 menggantikannya dengan verifikasi, bukan implementasi paralel |
| T14/T16 | W10 |
| T17/T18 | W07 |
| T19 | Label waktu plan 1; fokus W08; target W09 |
| T20 | Placeholder aktif W08; footer/cart/avatar W09 |
| T21 | W11 deferred berdasarkan keputusan user |
| T22/T23 | W04 |
| T26 | W12 |

## 4. Non-scope dan invariants

- Tidak mengubah schema, API pricing/ranking/pajak/eligibility/stock, status transition, permission, cookie store/admin, atau integrasi provider/webhook.
- Tidak menginisialisasi payment session, retry transaksi provider atau membuat order baru dari tombol pemeriksaan. GET detail membaca database, bukan memaksa sinkronisasi provider.
- Tidak menganggap `paid` berarti fulfillment selesai, atau query `settlement` membuktikan lunas. Unknown bukan failed.
- Tidak memilih pesanan terakhir sebagai pengganti `order_id` yang hilang. Tidak menampilkan detail milik akun lain.
- Tidak memakai quote lama untuk tujuan/metode baru. Dialog kenaikan dan acknowledgement server tetap; tidak menghilangkan rincian biaya/detail keputusan demi mengurangi scroll.
- Tidak menambah search alamat/promo, mengubah pagination/ranking menjadi filter client, atau membuat reorder per-order otomatis.
- Tidak menambah persistensi alamat/kontak/slot ke browser. Recovery request key existing bukan izin penyimpanan draft baru.
- Tidak mengubah token global placeholder/muted/skeleton di kedua app. Perbaikan lokal toko dan shared opt-in diprioritaskan; perubahan tampilan admin tidak otomatis diizinkan.
- Tidak mengganti font, tema, brand, config/nomor WhatsApp, isi legal atau link register di luar scope.
- Tidak ada perubahan deployment/env, endpoint baru, DB sync, pengaturan dashboard Midtrans, commit/push/deploy atau delegasi. Perbaikan callback login yang dibutuhkan di §5 hanya mempertahankan tujuan internal, bukan mengganti aturan auth/onboarding.

## 5. Blueprint teknis dan fakta repo

Blueprint berikut adalah **kontrak versi lengkap yang disetujui user**, bukan perintah memulai coding pada permintaan perubahan status ini. Modul baru hanya yang tertulis; jangan membuat service/backend baru untuk GET existing.

### File dan test seam

| Full path | Aksi/tanggung jawab | Layer | Public seam |
|---|---|---|---|
| `apps/store/src/app/checkout/result/page.tsx` | Modify: fetch DTO owner-scoped, status/fallback sesuai §6, retry dan login callback internal; abaikan query status | UI page | spec result baru, status-colors |
| `apps/store/src/proxy.ts` | Modify: pertahankan pathname **dan query** pada callback login agar `order_id` tidak hilang; cookie/matcher/access rule tetap | routing/proxy | `apps/store/src/proxy.test.ts` (baru), spec result |
| `apps/store/src/app/login/page.tsx` | Modify terbatas: alur Google membawa safe callback melalui onboarding sync seperti email agar kembali ke hasil pesanan yang sama; jangan mengubah auth instance/provider/onboarding gate | UI page | spec result; login existing sebagai regression reference |
| `apps/store/src/lib/safe-redirect.ts` | Reuse read-only `safeStoreRedirect`; tidak mengganti guard open redirect | lib existing | `apps/store/src/lib/safe-redirect.test.ts` existing |
| `apps/store/src/app/account/orders/[id]/page.tsx` | Modify: initial/background loading terpisah, status check, layout mobile, next action, disclosure kode completed | UI page | `e2e/store/order-detail-presentation-mock.spec.ts` |
| `apps/store/src/components/orders/order-detail-types.ts` | Modify tipe presentasi payment check; DTO existing tidak diperluas dengan field backend baru | UI type | spec detail/result |
| `apps/store/src/components/orders/OrderPaymentSummary.tsx` | Modify: status check, metode null jelas, deadline sah; eligibility mengikuti proyeksi existing, bukan transaksi baru | UI component | spec detail |
| `apps/store/src/components/orders/OrderFulfillmentPanel.tsx` | Modify: tracking dapat ditunda tanpa menghilangkan alamat/fallback snapshot | UI component | spec detail |
| `apps/store/src/app/checkout/page.tsx` | Modify: feedback, ETA, delta promo, kebijakan, CTA lookup; hapus fallback submit pada **aksi pemeriksaan** yang 404, bukan jalur submit eksplisit | UI page | checkout-review/coupon + spec cross-check baru |
| `apps/store/src/components/checkout/CheckoutAttemptFeedback.tsx` | Modify: tone certainty, state check inline, busy dan CTA lookup | UI component | `apps/store/src/components/checkout/CheckoutAttemptFeedback.test.tsx`, spec cross-check |
| `apps/store/src/components/checkout/DeliveryQuotePanel.tsx` | Modify: alamat wrapping/bounded, feedback reset, consumer focus return, contrast lokal dan opt-in Close nyaman | UI component | `e2e/store/delivery-quote-mock.spec.ts` |
| `apps/store/src/components/checkout/PromoSelectionDialog.tsx` | Modify terbatas: opt-in Close nyaman; picker/ranking/pagination tetap | UI component | `e2e/store/discounts-coupon-mock.spec.ts` |
| `apps/store/src/lib/delivery-options.ts` | Reuse read-only `formatDeliveryEta` | lib existing | delivery/review specs |
| `packages/ui/src/components/ui/select.tsx` | Reuse `className` consumer untuk popup/trigger; tidak merombak semua Select. Jika consumer override tidak cukup, laporkan sebelum memperluas kontrak | UI shared read-only | delivery + contrast specs |
| `packages/ui/src/components/ui/dialog.tsx` | Modify: opt-in ukuran Close nyaman, default existing tidak berubah termasuk admin | UI shared | spec cross-check/delivery/coupon + regression default |
| `packages/ui/src/components/footer/Footer.tsx` | Modify: padding anchor sosial dan perbaikan teks lokal, bukan SVG saja | UI shared | spec cross-check + consumer footer |
| `apps/store/src/components/Header.tsx` | Modify terbatas: contrast badge cart dan avatar fallback/inisial pada background header aktual termasuk saat scroll | UI store | spec cross-check |
| `apps/store/src/components/StoreWhatsappHelp.tsx` | Create client wrapper route-aware untuk bantuan inline vs floating; tidak mengambil config/data bisnis sendiri | UI component baru | spec cross-check |
| `apps/store/src/components/FooterWrapper.tsx` | Modify composition bantuan dengan config URL existing; tetap Server Component | UI server | spec cross-check |
| `packages/ui/src/components/footer/FloatingWhatsappButton.tsx` | Reuse read-only untuk route/viewport lain; tidak mengganti href/style global | UI shared read-only | spec cross-check |
| `e2e/store/checkout-result-status-mock.spec.ts` | Create: query-vs-DTO, missing/access/error, callback query dan navigasi aman | E2E mock | browser UI/request interception |
| `e2e/store/checkout-cross-check-mock.spec.ts` | Create: recovery lookup-only, submit feedback, bantuan, kebijakan, target/contrast terarah | E2E mock | browser UI/request interception |
| `e2e/store/order-detail-presentation-mock.spec.ts`, `e2e/store/checkout-review-mock.spec.ts`, `e2e/store/delivery-quote-mock.spec.ts`, `e2e/store/discounts-coupon-mock.spec.ts`, `e2e/store/form-field-contrast-mock.spec.ts`, `e2e/store/status-colors-mock.spec.ts` | Update fixture dan assertions di seam existing; hindari duplikasi seluruh flow | E2E mock | browser UI |
| `playwright.mock.config.ts` | Modify: daftarkan kedua spec baru pada **kedua** `testMatch` | test config | discovery spec + final mock gate |
| `docs/features/order-flow.md`, `docs/features/versioned-checkout-pricing.md`, `docs/features/delivery-quotes.md`, `docs/features/footer.md`, `docs/features/status-colors.md`, `docs/architecture/middleware.md`, `docs/README.md` | Update hanya kontrak/pattern/navigasi yang benar-benar berubah | docs | review kontrak |

### Kontrak exported dan batas struktur

- Default export halaman tetap. Fetch hasil: `GET /api/orders/${encodeURIComponent(orderId)}` dengan data fresh; sukses hanya jika HTTP sukses, envelope `success` dan identitas `data.id` sesuai ID yang diperiksa. Response tidak valid tidak mengklaim pembayaran sukses/gagal. ID adalah text di schema; jangan mengharuskan UUID. ID kosong tidak fetch; nilai bebas di-encode sebagai satu path segment, bukan interpolasi URL navigasi bebas.
- `OrderFulfillmentPanel` mempertahankan `shipment: OrderDetail["shipment"]`, `deliverySnapshot: OrderDetail["deliverySnapshot"]`; tambahan `showTracking?: boolean = true`. Caller pending dengan `shipment === null` memberi false; shipment nyata tetap tersedia setelah pembayaran, tidak dibuang hanya karena status pending. Alamat/fallback tetap dirender.
- Tambahkan tipe presentasi `PaymentCheckState = "idle" | "checking" | "unchanged" | "updated" | "error"` pada `order-detail-types.ts`. `OrderPaymentSummary({ order, onPay, onCheckPayment, paymentCheck? })` mempertahankan callback `() => void`, tambahan `paymentCheck?: { state: PaymentCheckState }`, default idle.
- `CheckoutAttemptFeedback({ result, busy, onCheckStatus, onReviewAgain, checkState? })` mempertahankan empat props existing; tambahan opsional `checkState?: "idle" | "checking" | "unchanged" | "updated" | "error"`, default idle. Ini state presentasi lokal, bukan field API/attempt baru.
- `DeliveryQuotePanelProps` dan `DeliveryQuoteService` tidak berubah. Reuse `formatDeliveryEta(deliveryService.validEta)`; jangan membuat ETA dari durasi tebakan. Tidak menambah callback hanya untuk testing.
- `DialogContent`: tambahan prop opsional `closeButtonSize?: "default" | "comfortable"`, default `default`; comfortable memberi hit area minimal 32×32 CSS px dengan ikon existing. Hanya dua dialog checkout pada tabel file opt-in; focus-return alamat diperbaiki di consumer, bukan default semua dialog.
- `StoreWhatsappHelp({ href }: { href: string })` menerima URL existing dari server, memakai pathname untuk membedakan `/checkout` dan `/account/orders/[id]` dari route lain. Jika evidence hit-test mengonfirmasi gangguan, pada surface tersebut di bawah breakpoint desktop existing `lg` tampil link normal “Butuh bantuan? Hubungi WhatsApp” sebelum footer dan floating disembunyikan; desktop/route lain tetap floating. Tidak hook client di `FooterWrapper`, tidak fetch config ulang, tidak render dua link bantuan aktif sekaligus pada viewport yang sama. Jika evidence tidak mengonfirmasi, W07 bagian WA dicatat N/A dengan bukti dan tidak mengubah bantuan hanya demi memenuhi daftar file.
- Footer/shared dialog dipakai dengan batas yang eksplisit; tidak mengubah global skeleton/placeholder tokens. Header adalah consumer store. Sebelum edit shared Footer/Dialog, inventaris consumer; jika ternyata mengubah tampilan admin di luar scope, isolasi perbaikan atau kembalikan untuk approval perluasan, bukan otomatis menerima dampaknya.
- Hindari modul mapper/service/universal feedback baru yang tidak diperlukan. Page mengatur UI state dan GET; business operation/query tetap di backend existing yang tidak diedit.

### Discovery source yang sudah diselesaikan

1. **Identitas redirect:** `apps/store/src/lib/midtrans.ts` mengirim `transaction_details.order_id`. Halaman hasil membaca query `order_id`. Context7 `/websites/midtrans` mengonfirmasi Snap menambah `order_id`, `status_code`, `transaction_status` pada redirect; dashboard Snap Preferences mengatur Finish Redirect URL, request `callbacks.finish` bisa override. [Sumber Snap](https://docs.midtrans.com/docs/snap-advanced-feature), [payment settings](https://docs.midtrans.com/docs/payment-settings). Ini verifikasi dokumentasi, **bukan** uji konfigurasi dashboard/redirect aktual.
2. **Owner/access:** `apps/store/src/app/api/orders/[id]/route.ts` memfilter ID + userId, 404 bila tidak ada. `route-access.ts`/`client-access.ts`: 401 `UNAUTHORIZED`, 403 `ONBOARDING_REQUIRED`. Result tetap mempunyai fallback 403 generik tanpa mengubah guard. Query dari URL bukan permission.
3. **Login-return:** `apps/store/src/proxy.ts` sekarang menyimpan pathname saja, sehingga query `order_id` hilang saat login. Login email memakai `safeStoreRedirect(callbackUrl)` melalui `/api/onboarding/sync`; login Google belum meneruskan callback tersebut. Kedua delta teknis dimasukkan ke blueprint agar AC login-return tidak dijanjikan tanpa jalur yang bekerja. Onboarding mandatory tetap berlaku; tidak bypass gate demi kembali ke result.
4. **Lookup bukan submit:** `recoverVerified — : lookup 404 tidak memanggil place-order (0 POST) dan request key tetap; unchanged/updated; detail  mengulang GET yang sama. Unit  5 passed.Request()` pada checkout sekarang melakukan `submitVersioned(pendingRequest)` bila GET 404. Sesuai keputusan pemeriksaan read-only, fallback ini dihilangkan dari aksi pemeriksaan; 404 mempertahankan request key/isian dan menampilkan hasil tidak ditemukan. Submit eksplisit di luar aksi pemeriksaan tidak diubah menjadi retry otomatis.
5. **Deadline/eligibility:** `readOwnedOrderPaymentRecovery` pada `apps/store/src/features/payments/order-payment-repository.ts` memproyeksikan `expiresAt` dari session/order, serta `paymentAvailable` berdasarkan order pending + payment pending + belum expired + state ready + redirect. Deadline tidak universal. Tampilkan deadline hanya bila tersedia dan valid dalam konteks pembayaran tersebut; expiry lewat tidak memberi deadline baru. Ketika DTO recovery tersedia, `paymentAvailable` adalah guard link bayar; jangan mengalahkannya dengan sekadar keberadaan URL. Jika fixture/historical data tidak mempunyai recovery, pertahankan fallback eligibility existing dan jangan mengarang expiry.
6. **Kebijakan:** `packages/db/src/schema/footer.ts` menunjuk `/pages/terms`; seeder mempunyai slug `terms`; `apps/store/src/app/pages/[slug]/page.tsx` hanya membaca published page. Route langsung `/terms` bukan dasar link ini. Data published/isi pada environment aktual belum diperiksa.
7. **Contrast/consumer:** audit mencatat Provinsi aktif 3,58:1, footer 4,47:1, badge cart 3,76:1, avatar 4,26:1. Header consumer nyata ada di `apps/store/src/components/Header.tsx` (bukan komponen header shared). Kedua app mempunyai `globals.css` tersendiri; tidak perlu mengubah admin untuk perbaikan lokal store.

### Preflight yang masih harus dibuktikan

Ini pekerjaan agent, bukan pertanyaan produk baru; tidak boleh diklaim Verified dari pembacaan kode:
- `discovery:` akses read-only ke `/pages/terms` pada environment yang dipakai; pastikan published dan isinya relevan dengan checkout. Jika tidak layak, W12 blocked dan minta tindak lanjut legal/content terpisah; jangan diam-diam menerbitkan kebijakan.
- `discovery:` hit-test/scroll/focus tombol WA pada checkout/detail mobile sebelum mengaktifkan pergantian bantuan; catat posisi dan viewport. Screenshot overlap saja tidak cukup.
- `discovery:` inventory consumer Footer/Dialog dan computed contrast/header scrolled/light/dark yang terdampak. Shared default Close tidak berubah; tidak memperluas tampilan admin tanpa approval.
- `discovery:` uji redirect sandbox aktual bila akses dan transaksi uji diizinkan terpisah. Mock dapat membuktikan penanganan query, bukan konfigurasi dashboard atau pembayaran nyata. Tidak membuat transaksi provider/masuk dashboard hanya untuk revisi plan.

### Checkpoint dokumentasi library

Revisi ini hanya dokumen, tanpa kode API library baru. Checkpoint Midtrans di atas sudah tersedia dari sesi. Sebelum coding, muat skills terkait dan lakukan Context7 resolve/query versi terpasang untuk API Next/React/Better Auth cookies/Radix/Playwright/Vitest yang disentuh; catat signature relevan atau fallback types/source resmi bila tool tidak tersedia. Checkpoint Midtrans **tidak** menggantikan inquiry library implementasi.

## 6. Blueprint UX dan state matrix

### Referensi, reuse, dan susunan

- Checkout: `apps/store/src/app/checkout/page.tsx` setelah plan 1; reuse button/card/label/input dan disclosure existing, bukan gaya baru.
- Detail: `OrderPaymentSummary`, `OrderFulfillmentPanel`; status memakai `packages/ui/src/components/ui/status-badge.tsx`, `packages/ui/src/lib/status-presentation.ts`, `packages/ui/src/lib/status-styles.ts`. Dimensi pembayaran/pesanan/pengiriman tetap terpisah.
- Overlay: shared Select/Dialog existing dengan override consumer dan opt-in Close. Arsip kode memakai disclosure semantik yang sejalan dengan disclosure tracking existing.
- **Verified —  (18 passed): urutan mobile bayar→alamat→barang, tracking pending ditunda sementara alamat tetap, metode kosong , deadline hanya dari  DTO yang sah; capture 390/1440/320. mobile (<lg): status → pembayaran (rincian biaya + total + aksi) → fulfillment/alamat/pickup → barang → bantuan.** DOM/focus order mengikuti susunan, bukan CSS visual saja. Desktop mempertahankan susunan multi-kolom existing (barang utama dan pembayaran/pickup sidebar); jangan menganggap desktop dan mobile identik.
- Satu primary action dominan per konteks: result terverifikasi menuju detail; detail pending membayar hanya bila eligible, selain itu pemeriksaan; gagal/batal menuju riwayat. Beli lagi existing tetap per-item dan membuka produk, bukan otomatis menambah cart/order.

### Halaman hasil `/checkout/result`

Copy berikut adalah copy versi lengkap yang disetujui bersama plan. Nomor pesanan valid tetap utuh/wrapping; raw query/error provider tidak dijadikan pesan pelanggan.

| Kondisi | Judul/pesan | Aksi / semantik |
|---|---|---|
| GET sedang berjalan | “Memeriksa status pembayaran…” | Indikator terlihat + live status; netral, cegah request ganda |
| DTO `paymentStatus=paid`, tanpa blocked | “Pembayaran diterima” / “Buka detail pesanan untuk melihat langkah berikutnya.” | “Lihat Detail Pesanan”, success; tidak menjanjikan fulfillment tertentu |
| DTO paid + `fulfillmentBlockedReason` | “Pembayaran diterima, pesanan menunggu verifikasi” / “Pembayaran sudah tercatat. Tidak perlu membayar ulang.” | CTA detail; pembayaran success, perhatian fulfillment terpisah |
| DTO payment pending dan order bukan cancelled/failed terminal | “Menunggu pembayaran” / “Buka detail pesanan untuk melihat status dan pilihan pembayaran.” | CTA detail, waiting; bukan mengarang link/deadline |
| DTO `paymentStatus=failed` | “Pembayaran gagal” / “Buka detail pesanan untuk melihat status pesanan dan langkah berikutnya.” | CTA detail, failure; tidak menyatakan refund atau mewajibkan transaksi baru |
| DTO order cancelled dengan payment bukan paid/failed | “Pesanan dibatalkan” / “Buka detail pesanan untuk melihat informasi pembayaran.” | CTA detail, cancelled; bukan menyimpulkan payment gagal |
| Nilai asing/kontradiktif yang tidak tercakup, termasuk failed order + payment pending | “Status pembayaran belum dapat dipastikan” / “Buka detail pesanan untuk memeriksa informasi terbaru.” | CTA detail, netral; tidak menebak settlement/failure |
| Tidak ada/kosong `order_id` | “Pesanan belum dapat ditentukan” / “Buka riwayat pesanan untuk mencari pesanan yang ingin diperiksa.” | “Lihat Pesanan Saya” → `/account`; tidak GET/ambil pesanan terakhir |
| GET 404 | “Pesanan tidak ditemukan” / “Periksa pesanan melalui riwayat akun Anda.” | “Lihat Pesanan Saya”; jangan ungkap apakah milik akun lain |
| GET 401 | “Masuk untuk memeriksa pesanan” | “Masuk” → `/login?callbackUrl=<encoded internal result path + order_id>`; pertahankan identitas, jangan membawa raw external callback |
| GET 403 | “Akses pesanan belum tersedia” / “Akun Anda belum dapat mengakses detail pesanan.” | “Lihat Pesanan Saya”; guard/onboarding existing tetap, tidak bocorkan detail |
| GET network/5xx/JSON/envelope/identitas tidak sah | “Status pembayaran belum dapat diperiksa” / “Coba lagi untuk memeriksa pesanan yang sama.” | “Coba lagi” GET ID yang sama; riwayat secondary; bukan payment failed |

Precedence: paid terverifikasi tetap diterima meski order dibatalkan/blocked; jelaskan lifecycle terpisah, bukan menghapus fakta pembayaran. Query `transaction_status`/`status_code` tidak mengalahkan DTO. Link “Belanja Lagi” existing dapat tetap secondary; tidak bersaing dengan primary status/recovery.

### Checkout, detail, dan polish

| Surface/state | Copy/action versi untuk approval | Batas |
|---|---|---|
| Detail initial loading | “Memuat detail pesanan…” + indikator/skeleton terlihat | Bukan `sr-only` saja; jangan mengganti seluruh palette skeleton |
| Background checking | “Memeriksa status…”; button busy/disabled | Pertahankan detail/isian dan fokus trigger; tidak full-page skeleton |
| Unchanged | “Status belum berubah. Silakan periksa lagi nanti.” | Inline live status, bukan error |
| Updated | “Status pesanan diperbarui.” (detail) / “Status checkout diperbarui.” (checkout) | Render DTO/state baru; tidak mengklaim lunas bila belum pasti |
| Read error | “Status belum dapat diperiksa. Coba lagi.” | “Periksa status pembayaran” / “Periksa status checkout”; pertahankan data dan request key |
| Lookup request 404 | “Hasil checkout belum ditemukan. Periksa lagi atau hubungi bantuan.” | Pertahankan request/isian; pemeriksaan tidak memanggil place-order |
| Attempt preparing/processing | “Checkout masih diproses” + pesan aman existing | Tone info/progress; primary “Periksa status checkout”, bukan “Bayar Sekarang” yang melakukan lookup |
| Attempt compensating/manual_review | Pesan aman existing tentang penyelesaian/pemeriksaan checkout | Attention/progress, bukan failure definitif; lookup request yang sama |
| Attempt rejected | Pesan penolakan aman existing | “Periksa ulang pesanan” hanya jika `retryAllowed`; tidak membuang key hanya karena read error |
| Attempt promoted | Ikuti redirect/order existing hanya jika respons sah memberi order milik customer | Tidak POST transaksi baru; tanpa orderId sah jangan buat link detail |
| Submit error | Satu feedback inline utama dekat aksi, fokus ke pesan jika diperlukan untuk ditemukan | Toast hanya jika tidak ada inline; pertahankan jalur recovery |
| Metode pembayaran null | “Belum dipilih” | Consumer-local pada ringkasan; jangan mengubah formatter semua consumer tanpa kebutuhan |
| Deadline tersedia | “Batas pembayaran: <tanggal dan jam dari DTO>” | Hanya tanggal sah untuk konteks tersebut; tidak membuat expiry baru, tanpa deadline jangan mengarang |
| Tujuan berubah | “Tujuan berubah. Pilih layanan pengiriman kembali.” | Quote/selection/review/ack lama invalid; tanpa dialog rutin |
| Review ETA | `formatDeliveryEta(service.validEta)`; fallback existing “Estimasi tiba belum tersedia” | Data provider existing, bukan janji baru |
| Dropdown alamat | Nama penerima + alamat wrapping + alasan disabled | Selected/focus beda, bounded viewport, keyboard tetap |
| Promo gugur | “Promo tidak berlaku. Total naik Rp22.200 menjadi Rp166.500.” pada fixture Rp144.300 → Rp166.500; alasan aman server berdekatan | Tampilkan total sebelumnya/terbaru dan “Lanjut tanpa promo”; acknowledgement/reset existing tetap |
| Total turun | “Total turun Rp5.550 menjadi Rp138.750.” pada fixture Rp144.300 → Rp138.750 | Inline dekat total, tanpa dialog/toast duplikat; hanya snapshot comparable |
| Pickup ready | Instruksi pengambilan dan kode existing | Jangan menghilangkan instruksi yang masih berlaku |
| Pickup completed, kode ada | “Pesanan selesai”; disclosure tertutup “Lihat kode pengambilan”; isi berlabel “Arsip kode pengambilan” | Tanpa instruksi mengambil lagi; “Salin kode” tetap di dalam arsip. Keyboard/expanded state jelas |
| Pickup completed, kode kosong | Status selesai tanpa disclosure kosong | Jangan membuat kode baru |
| Failed/cancelled | Label status/reason aman sesuai data; “Lihat Pesanan Saya” primary | Beli lagi per-item tetap secondary; tidak menjanjikan refund/kewajiban atau reorder |
| Unknown detail | “Status pesanan belum tersedia”; “Periksa status” primary | GET pesanan yang sama; bukan warna failed |
| Bantuan inline mobile bersyarat | “Butuh bantuan? Hubungi WhatsApp” | URL existing, link biasa sebelum footer; bukan fixed overlay pengganti |
| Kebijakan | “Syarat & ketentuan” + penanda “terbuka di tab baru” | `/pages/terms` setelah verifikasi; anchor terpisah dari label checkbox, `target=_blank`, rel aman |
| Draft/Batal/refresh | Existing | Tidak menambah restore/persistence |

Untuk unchanged/updated bandingkan field yang relevan bagi pelanggan: status order/payment, blocked reason, availability/URL/deadline, shipment dan data ringkasan yang ditampilkan; attempt state/orderId/paymentAvailable/retryAllowed/message. Metadata teknis/requestId tidak membuat pesan “diperbarui” palsu.

### Kontrak list dan state yang dipertahankan

- Promo: **backend ranking/pagination 10 per halaman**, dataset eligible/ineligible dan urutan deterministic existing. Tidak ada search/sort/URL state baru. Pilihan lintas halaman, loading/error/retry tetap; expected ordering dari fixture independen.
- Kurir: kategori/pagination existing; pemilihan mengikuti kontrak existing, quote baru mereset selection. Tidak menambah search/URL state atau client-filter pengganti API.
- Buku alamat: dataset existing tanpa search/pagination baru. Empty, load error/retry, modal draft, region error, selected dan disabled reason tetap dibedakan. Long/partial address wajib diverifikasi.
- Empty barang/detail 404/error tetap berbeda; tidak mengubah guard akun. Tidak ada prototype yang diminta/dibuat.

### Viewport, akses, dan consumer

1440×900, 390×844, dan reflow 320 CSS px; popup/error/CTA diperiksa saat terbuka. Uji browser zoom atau text resize 200% dengan metode dicatat; root-font hanya screening tambahan. Tidak ada clipping/overlap yang menghilangkan fungsi; horizontal overflow diperiksa konteksnya.

Teks aktif biasa ≥4,5:1, large text ≥3:1. Placeholder aktif ikut teks; inactive exception dicatat. Target Close comfortable dan anchor sosial minimal 32×32, ikon tetap proporsional; 24×24 atau exception yang dibuktikan adalah batas AA, bukan klaim semua target kecil sebelumnya pasti gagal. Tidak menutupi kontrol tetangga.

Fokus kembali ke trigger alamat setelah Escape/Batal/Close; selected/focus terlihat; disclosure, kebijakan, recovery dapat dioperasikan keyboard. Perubahan layout mobile tidak membuat urutan tab menyimpang dari urutan baca. WA diuji scroll/focus/hit-test/klik, bukan screenshot saja. Header contrast diukur pada background aktual sebelum/sesudah scroll. Perubahan shared dinilai pada consumer/theme terdampak; ini bukan audit WCAG keseluruhan atau redesign dark theme.

## 7. Acceptance criteria dan status evidence

Status diambil dari gate implementasi 2026-11-15 pada database disposable `marketplace_discounts_test_phase2_20261115` (mock E2E) dan `marketplace_discounts_test_unit_20261115` (unit serial). AC2-09 dipertahankan sebagai **Deferred** (keputusan user), bukan dihilangkan atau dinyatakan Verified.

| AC | Kontrak yang dapat diamati | Evidence final/public seam | Status sekarang |
|---|---|---|---|
| AC2-01 | Status result mengikuti DTO owner-scoped meski query berlawanan; loading, missing/404/401/403/invalid response sesuai §6. Login-return mempertahankan order_id; tidak mengklaim lunas dari URL | `checkout-result-status-mock.spec.ts` (9 passed): query settlement/capture/pending/deny vs DTO, paid+blocked, paid+cancelled, 404/401/403/5xx/envelope/identitas tidak sah, order_id kosong tanpa GET, ID bebas satu segmen, proxy callback tanpa sesi, email return, argumen Google. Unit `apps/store/src/proxy.test.ts` 3 passed | Verified |
| AC2-02 | Recovery checkout/detail menjelaskan checking/unchanged/updated/error; data/isian/request key tetap, termasuk lookup 404 tanpa submit | `checkout-cross-check-mock.spec.ts`: lookup 404 tidak memanggil place-order (nol POST) dan request key tetap; checking/unchanged/updated; detail `Periksa status pembayaran` mengulang GET yang sama. Unit `CheckoutAttemptFeedback.test.tsx` 5 passed | Verified |
| AC2-03 | Pending mobile menempatkan total+aksi sebelum barang panjang; tracking kosong tidak mendahului bayar, alamat tetap ada; null method/deadline sesuai data/eligibility | `order-detail-presentation-mock.spec.ts` (18 passed): urutan mobile bayar → alamat → barang, tracking pending ditunda sementara alamat tetap, metode kosong `Belum dipilih`, deadline hanya dari `expiresAt` DTO yang sah; capture 390/1440/320 | Verified |
| AC2-04 | Promo gugur/naik menjelaskan before/after/alasan/ack; penurunan memberi delta inline tanpa dialog/toast duplikat; savings tidak palsu | `checkout-cross-check-mock.spec.ts`: `Promo tidak berlaku. Total naik Rp22.200 menjadi Rp166.500.` + `Lanjut tanpa promo`; `Total turun Rp22.200 menjadi Rp144.300.` tanpa dialog/toast tambahan; catatan penghematan lama dihapus saat promo gugur | Verified |
| AC2-05 | Satu feedback utama submit terlihat/dapat difokuskan dan mendukung recovery; error tanpa inline tetap memiliki feedback | cross-check: alert inline submit dapat difokuskan (`toBeFocused`) dengan tombol recovery, halaman tetap pada langkah pembayaran | Verified |
| AC2-06 | Pada 320 dan browser/text resize 200% terukur, biaya/tombol/daftar terbaca dan dapat dioperasikan tanpa clipping/overlap yang menghilangkan fungsi | cross-check: 320 px tanpa overflow horizontal (0 px) dan total/tombol/kebijakan/checkbox dapat dioperasikan; screening root-font 200% tanpa konten ter-clip. Batas metode: root-font ikut menggandakan padding/ikon rem dan browser page-zoom tidak diemulasi harness | Verified (dengan batas metode) |
| AC2-07 | Jika terbukti mengganggu, WA floating diganti link inline hanya pada checkout/detail mobile; bantuan ada, CTA/fokus dapat diklik, route lain/desktop tetap | Pre-change hit-test 320 px: tombol mengambang menutup 34% tombol `Lanjut` dan 92% hint `Tentang cabang pickup` (artefak `playwright/mcp/checkout-phase2/`). `StoreWhatsappHelp` memberi link inline pada `/checkout` dan `/account/orders/[id]` di bawah `lg`; cross-check membuktikan tepat satu bantuan per viewport, CTA tidak tertutup, desktop tetap floating | Verified |
| AC2-08 | Escape/Batal/Close modal alamat mengembalikan fokus; Close checkout dan anchor sosial memiliki hit area ≥32×32 tanpa overlap tetangga | cross-check: Close dialog 36×36 px, Escape mengembalikan fokus ke trigger alamat, anchor sosial ≥32×32 tanpa jarak negatif, `closeButtonSize` default shared `DialogContent` tidak berubah (admin aman) | Verified |
| AC2-09 | Persistensi draft setelah refresh/tertutup, TTL/restore/clear/privasi di luar scope; perilaku Batal existing tidak diubah | keputusan D05 sesi awal/lanjutan; tidak ada helper draft/penyimpanan PII baru | Deferred — keputusan user |
| AC2-10 | Pickup completed tidak memberi instruksi aktif; kode arsip tertutup dapat dibuka/disalin bila ada. Gagal/batal menuju riwayat; unknown lookup; Beli lagi per-item tetap tanpa reorder otomatis | detail spec: completed menutup instruksi + disclosure `Arsip kode pengambilan` + salin kode, tanpa disclosure saat kode kosong, failed/cancelled → `Lihat Pesanan Saya` + `Beli lagi` per item, status asing → `Periksa status` | Verified |
| AC2-11 | Dropdown alamat pada 390/320 bounded; penerima/alamat panjang/disabled reason terbaca, keyboard dapat memilih; reset layanan dijelaskan | cross-check pada 390/320: listbox bounded, item panjang >40 px dengan alamat membungkus, alasan disabled tertulis, pemilihan via keyboard, notice `Tujuan berubah. Pilih layanan pengiriman kembali.` dengan `Lanjut` nonaktif sampai layanan dipilih ulang | Verified |
| AC2-12 | Initial loading/background check punya indikator visual nyata + live status, bukan warna sama dengan background atau sr-only saja | detail spec: loading awal menampilkan teks + skeleton `bg-border` (computed color berbeda dari background), pemeriksaan latar tidak melepas detail/fokus | Verified |
| AC2-13 | Attempt uncertain memakai info/attention, primary lookup request sama berlabel pemeriksaan; rejection tetap definitif; promoted hanya menavigasi order/URL sah | unit tone (attention, bukan destructive) + cross-check `Status belum berubah…`/`Status checkout diperbarui.` dan nol POST selama pemeriksaan | Verified |
| AC2-14 | Link kebijakan dekat checkbox menuju published page terverifikasi di tab baru, keyboard-operable, tidak toggle checkbox/menghilangkan isian | cross-check: `href=/pages/terms`, `target=_blank`, `rel` aman, popup terbuka, checkbox/isian tidak berubah. Preflight: baris `static_page` slug `terms` `is_published=true` (1607 karakter) pada environment runtime; tidak ada konten legal baru dibuat | Verified |
| AC2-15 | Placeholder aktif checkout, teks footer, badge cart dan avatar memenuhi contrast; disabled exception dan dampak consumer/theme dicatat; tidak ada perubahan global/admin tak disetujui | cross-check computed colors: teks footer ≥4,5:1 (latar dikomposit), badge cart dan inisial avatar ≥4,5:1, prompt aktif checkout ≥4,5:1 via override lokal `--checkout-prompt`. `form-field-contrast-mock.spec.ts` tetap hijau sehingga band faint global/admin tidak berubah | Verified |
| AC2-16 | Fixture/capture/evidence sesuai state; nominal/ordering independen; setiap Pending/Deferred/N/A transparan | matriks AC → evidence ini, nominal fixture ditulis literal dari §8, capture 1440/390/320 di `playwright/mcp/checkout-phase2/`; AC2-09 Deferred dan batas metode AC2-06 dinyatakan terbuka | Verified |

## 8. Testing, pemulihan evidence, dan urutan delivery

### Seam dan fixture

Public seam utama tetap **browser UI dengan API fixture terkontrol** pada specs existing di §5; dua spec baru hanya untuk result dan cross-check yang belum mempunyai coverage memadai. Unit pada feedback existing dan proxy routing, tidak menguji internal React state/class sebagai bukti UX. Keputusan seam ini bagian versi lengkap untuk review, bukan permintaan menjalankan suite sekarang.

Fixture independen: baseline **Rp166.500**; promo Rp20.000 → **Rp144.300**, savings **Rp22.200**; promo Rp25.000 → **Rp138.750**, savings **Rp27.750**; potongan Rp12.000 → **Rp153.180**. Potongan barang dan savings termasuk dampak pajak tetap dibedakan. Ranking halaman kedua tidak boleh lebih murah dari eligible yang seharusnya mendahuluinya. Jangan memperbaiki backend agar cocok dengan fixture audit yang salah.

Recovery: tunggu GET dan state akhir, capture checking terpisah dari unchanged/updated/error; bandingkan key/input sebelum-sesudah dan request yang dikirim. Perubahan requestId saja bukan perubahan status. Assert read-only pada lookup 404 agar fallback POST lama tidak lolos.

Login-return: unit proxy menguji callback internal pathname+query, regression safe redirect existing; browser mock menguji email return dan argumen callback Google menuju sync dengan tujuan result yang sama. Tidak login provider eksternal nyata. Onboarding gate tetap dihormati; akun belum onboarding tidak dibypass. Mock tidak membuktikan konfigurasi provider/dashboard.

### Urutan slice usulan, bukan ticket breakdown

1. **Hasil pembayaran end-to-end:** redirect query → fetch owner-scoped → status/fallback → detail/login-return; termasuk regression status netral plan 1.
2. **Pemeriksaan dan detail mobile:** checkout request lookup-only → feedback akhir → detail prioritas bayar/alamat; termasuk initial loading dan next action failed/cancelled/unknown.
3. **Review delivery/promo:** pilih alamat → invalidasi layanan → pilih ulang/ETA → review total/promo gugur atau turun → persetujuan existing.
4. **Akses dan P2 terintegrasi:** fokus/target/contrast, responsive/help sesuai bukti, completed archive, kebijakan tab baru setelah preflight.

Setiap slice berakhir pada jalur customer yang dapat diverifikasi; jangan melaporkan backend foundation sebagai delivery UI. Tidak menerbitkan tickets dari urutan ini tanpa approval breakdown terpisah.

### Verification ladder setelah approval

- Muat skills terkait sebelum coding. RED → GREEN pada unit seam yang relevan: `npm run verify:unit:slice -- apps/store/src/components/checkout/CheckoutAttemptFeedback.test.tsx apps/store/src/proxy.test.ts` (pilih path sesuai slice; `safe-redirect.test.ts` bila guard/callback relevan). L0 `npm run verify:types:store`; admin hanya jika dampak disetujui dan benar-benar ada.
- Author E2E bersama fitur; eksekusi pada final gate deliverable terintegrasi, bukan tiap batch. Daftarkan dua spec baru pada kedua `testMatch` agar tidak silently skip.
- Final: full unit untuk logic change (`npm run test:unit`), affected types/lint (`npm run verify:types:store`, `npm run lint:store`), mock E2E dengan explicit affected paths melalui `npm run verify:batch:e2e -- <spec paths §5>`, serta rendered cross-page UX review 1440/390/320 + states/theme terdampak.
- Legacy `npm run test:e2e` tetap memerlukan izin terpisah. Jangan menjalankan setup mutatif pada DB user untuk screenshot atau mengeksekusi pembayaran provider tanpa izin. Konfigurasi mock/disposable DB dan prerequisites harus diperiksa sebelum run.
- Capture first viewport + full-page utama, focused loading/error/quote/checkbox/recovery dan dropdown terbuka. Simpan di `playwright/mcp/checkout-ux-review/` atau output Playwright terpusat; tidak force-add PNG. Jika run gagal, diagnosis Markdown, bukan membuka screenshot kegagalan.
- Gap E03 audit asal: lepas promo batal/konfirmasi/dampak total, harga/ongkir + reapproval, delivery tanpa snapshot/alamat panjang, dan full-page utama yang belum lengkap. Lengkapi evidence yang bersinggungan dengan scope; gap audit lain tetap Pending, tidak otomatis menutup audit asal.
- Hindari run ulang tanpa perubahan relevan. Jika suite akhir gagal, diagnosis focused dahulu lalu ulangi gate terdampak. Mock/E2E/unit/typecheck dan rendered review saling melengkapi, bukan menggantikan AC.

## 9. Keputusan, blocker, dan approval

| ID | Keputusan terkini | Authority |
|---|---|---|
| D01 | Verifikasi hasil melalui GET berdasarkan order_id; fallback per penyebab, login-return pesanan sama; pending mobile total/aksi dahulu | Sesi P0/P1 dan penjelasan redirect Midtrans; rangkuman dikonfirmasi |
| D02 | Inline utama; checking/unchanged/updated/error; pemeriksaan request sama tanpa transaksi baru | Sesi P0/P1 |
| D03 | Jika gangguan terbukti, bantuan inline menggantikan WA floating pada checkout/detail mobile; route lain tetap | Sesi P0/P1 |
| D04 | Gagal/batal riwayat utama, Beli lagi existing tetap; unknown lookup; completed kode arsip tertutup tanpa instruksi aktif | Sesi P0/P1 + addendum P2 |
| D05 | Persistensi draft tetap ditunda; tidak ada keputusan menyimpan PII/TTL/restore | Kedua sesi |
| D06 | Perbaikan teknis diserahkan kepada agent dalam batas desain existing: placeholder lokal checkout, Close/sosial, footer/cart/avatar; tidak mengganti tema/admin | Klarifikasi P0/P1 + addendum P2 |
| D07 | Kebijakan existing yang layak di tab baru, link tidak mengubah checkbox/isian; content/publish agent verifikasi, bukan user menebak | Addendum P2 |

**Tidak ada keputusan produk baru yang sengaja dibiarkan untuk coding.** Copy/props/teknis di versi lengkap ini tercakup dalam approval user melalui permintaan perubahan status menjadi ready. Pemeriksaan faktual pada §5 masih perlu evidence; blocker legal/akses/dampak di luar scope harus dilaporkan dan tidak dijawab sendiri.

Gate:
1. Shared understanding sesi awal dan P2: **dikonfirmasi**.
2. Revisi plan: diminta user melalui “oke update dokumen plannua”.
3. Approval atas **versi lengkap ini**: **diberikan**, melalui pesan user **“oke bisa ganti status menjadi ready”** setelah revisi plan. Preflight yang belum terbukti tidak boleh disamarkan sebagai lulus; W12 atau perubahan WA dapat blocked/N/A sesuai evidence dan batas di atas.
4. Permintaan implementasi penuh diberikan user setelah approval; ticket breakdown/delegasi/commit/push/deploy tetap memerlukan izin terpisah (tidak ada commit/push pada sesi ini).

## 10. Evidence revisi dokumen dan penutupan

| Kriteria revisi dokumen | Status | Evidence |
|---|---|---|
| Keputusan P0/P1 dan P2 masuk plan tanpa menghidupkan persistensi | Verified | §3/§9 dan [catatan sesi](../wayfinder/keputusan-grilling-fase-2.md) |
| Scope, state/copy, file-level contract dan test seam dicocokkan dengan source | Verified (review dokumen/source + runtime) | §5–§8; delta proxy query, Google callback dan lookup 404 dikerjakan sesuai kontrak |
| Koreksi audit, fixture dan gap evidence tetap transparan | Verified | §2/§7/§8; AC2-09 Deferred dan batas metode AC2-06 dinyatakan terbuka |
| AC2-01–AC2-08, AC2-10–AC2-16 implementasi | Verified | §7 + gate di bawah |
| AC2-09 persistensi | Deferred | Keputusan user tetap menunda |
| Approval versi lengkap | Verified | User: “oke bisa ganti status menjadi ready”, setelah revisi lengkap |

### Gate verifikasi 2026-11-15

| Gate | Perintah / bukti | Hasil |
|---|---|---|
| Types store | `npm run verify:types:store` | PASS |
| Types admin (shared Dialog/Footer) | `npm run verify:types:admin` | PASS |
| Lint store | `npm run lint:store` | PASS (0 error, 6 warning pre-existing) |
| Unit focused | `npm run verify:unit:slice -- apps/store/src/components/checkout/CheckoutAttemptFeedback.test.tsx apps/store/src/proxy.test.ts` | 9 passed |
| Unit penuh (serial, DB disposable baru) | `DATABASE_URL=…marketplace_discounts_test_unit_20261115 npm run verify:batch:unit` | 2438 passed, 25 skipped, 0 failed |
| Mock E2E affected paths | `npm run verify:batch:e2e -- checkout-result-status, checkout-cross-check, order-detail-presentation, checkout-review, delivery-quote, discounts-coupon, form-field-contrast, status-colors, checkout-density` (DB disposable) | 124 passed, 0 failed |
| Rendered UX review | capture 1440/390/320 di `playwright/mcp/checkout-phase2/` (result paid/pending/failed, detail pending/ready/completed/failed/blocked, checkout step 1–2) | 0 overflow horizontal; urutan mobile & desktop sesuai rancangan |
| Preflight hit-test WA | `playwright/mcp/checkout-phase2/` (320 px) | Tombol mengambang menutup 34% `Lanjut` → link inline diaktifkan pada surface tsb |
| Preflight halaman kebijakan | Query `static_page` slug `terms` | `is_published=true`, konten 1607 karakter |

**Batasan yang tetap terbuka:**

- `AC2-06`: screening root-font 200% bukan bukti browser page-zoom; pada 200% ukuran rem (padding/ikon) ikut membesar sehingga sisa overflow vertikal/horizontal kecil mungkin muncul, tetapi tidak ada kontrol ter-clip atau tidak dapat dioperasikan.
- `AC2-09` (persistensi draft) tetap Deferred atas keputusan user.
- Legacy `npm run test:e2e` (config live) tidak dijalankan — butuh izin terpisah (FU-2 di [research outstanding](../research/outstanding-follow-ups.md)).
- Full mock suite (seluruh 45 file) tidak dipakai sebagai gate: percobaan penuh pada DB klon memicu kehabisan resource dev server dan fixture admin yang memerlukan DB hasil seed murni; gate resmi tetap explicit affected paths sesuai §8. Selama percobaan itu terlihat dua hal: dev server mock berhenti di tengah run (bukan kegagalan assertion) dan port 3110–3112 perlu dibersihkan sebelum run berikutnya.
- `discounts-coupon-mock.spec.ts` pada run ini hijau (41 passed gabungan dengan `checkout-review-mock.spec.ts`); item FU-1 (literal provider line `amount` 125000 vs 138750) tetap tercatat sebagai isu test-only milik `discounts/research/` yang dapat muncul kembali tergantung state pajak DB.
- Satu assertion di `checkout-review-mock.spec.ts` diperbaiki test-only: `not.toContain("-2")` juga mencocokkan UUID `requestId` acak, sehingga pemeriksaan kebocoran kini mengecualikan field `requestId`.

Checklist sebelum menutup implementasi kelak:
- [x] Keputusan/copy/kontrak yang dipilih difinalisasi dan versi lengkap disetujui.
- [x] Seluruh AC dalam scope Verified; deferred/N/A memiliki keputusan/alasan sah.
- [x] Final gate dan rendered cross-page UX review tercatat.
- [x] Dokumentasi fitur yang berubah dan index diperbarui; plan dipertahankan.
- [x] Batas provider/DB tetap aman; tidak ada commit/push/deploy tanpa izin.
