# Plan: Modal pemilihan promo checkout

## Tujuan dan dasar pemeriksaan

Mencegah daftar promo memperpanjang checkout tanpa batas. Checkout menampilkan ringkasan tetap; customer membuka modal untuk memilih satu promo publik atau memasukkan kode, lalu mengonfirmasi pilihan.

Fakta repo yang diperiksa:
- `apps/store/src/components/checkout/PromoSelector.tsx`: input kode dan seluruh `offers.map` masih inline; pilihan kartu langsung memanggil handler penerapan.
- `apps/store/src/lib/discount-availability.ts`: discovery publik, eligibility aktual, urutan nama + ID, pagination cursor default 25; halaman dibatasi sebelum eligibility diproyeksikan.
- `apps/store/src/app/checkout/page.tsx`: `loadPromos` hanya membaca halaman pertama; ketidakhadiran pilihan aktif pada halaman tersebut dapat menandainya gugur.
- `packages/db/src/discount-pricing.ts`: diskon barang mengurangi dasar PPN; subsidi ongkir tidak. Nominal diskon terbesar belum tentu memberikan total terendah.
- `apps/store/src/lib/promo-replacement.ts`: penggantian membandingkan total final dan mempertahankan acknowledgement kenaikan total.
- Referensi UI: pemilihan kurir/pagination dan modal alamat di `apps/store/src/components/checkout/DeliveryQuotePanel.tsx`; shared Dialog di `packages/ui/src/components/ui/dialog.tsx`.

## Approval

- Kesepahaman: user memilih **10 promo per halaman**, **pilih lalu konfirmasi**, dan sorting **total bayar terendah dengan informasi benefit diskon/cap** melalui pertanyaan di percakapan ini.
- Interpretasi sorting: total terendah adalah kunci utama; cap adalah batas benefit, bukan nominal penghematan aktual. Interpretasi ini sudah disampaikan; approval dokumen lengkap tetap diperlukan.
- Complete scope, rincian interaksi, tie-break, kontrak API, dan acceptance disetujui user melalui pesan: **“oke sudah oke plannya. tolong eksekusi”** (2026-02-18).
- Tidak ada izin implementasi, subagent, commit, provider live, remote, atau deployment dari penyusunan dokumen ini.

## Scope dan non-scope

Termasuk checkout pickup/delivery pada kontrak pricing versi 1, ringkasan promo, modal responsif, draft pilihan, pemeriksaan kode tanpa penerapan, 10 item/halaman, scroll internal, ranking global server-side, dan regression lifecycle promo.

Tidak termasuk stacking/auto-apply, mengubah rumus harga/PPN/kuota, discovery kode privat, dashboard admin, schema/migration/seeder, perubahan gate rilis, provider writes, atau redesign checkout lainnya. Tidak membatasi jumlah halaman menjadi 10. Tidak menambahkan search/filter baru.

## Perilaku yang diusulkan

### 1. Ringkasan checkout

- Tanpa promo: judul **Promo**, deskripsi **Pilih promo atau masukkan kode**, tombol outline **Pilih promo**.
- Promo aktif: tampilkan nama/kode milik customer dan potongan aktual, badge **Dipakai**, tombol **Ubah promo** serta tindakan sekunder **Lepas promo**. Daftar publik dan input kode tidak berada di checkout utama.
- Pelepasan memakai jalur validasi/persetujuan kenaikan total existing, bukan langsung menghapus diskon dari state lokal.
- Promo gugur tetap terlihat sebagai warning beserta alasan aman server, **Pilih promo lain**, dan **Lanjut tanpa promo**. Tidak diam-diam melanjutkan tanpa diskon.
- Tinggi ringkasan tidak bergantung jumlah promo; nama panjang boleh wrap tanpa overflow horizontal.

### 2. Modal dan draft

Urutan informasi:

```text
Pilih promo                                      [Tutup]
Gunakan satu promo untuk pesanan ini.
Kode promo
[Masukkan kode promo                  ] [Periksa]
[Feedback kode / kandidat kode tervalidasi]
Promo tersedia — Diurutkan dari total bayar terendah
┌ Area daftar dengan scroll internal ─────────────┐
│ ( ) Nama promo              [Paling hemat]      │
│     Diskon/rate/cap • Hemat total Rp …          │
│     Minimum belanja • Berlaku sampai …         │
│ ( ) Promo berikutnya …                         │
└────────────────────────────────────────────────┘
1–10 dari 27 promo                   [<] 1 / 3 [>]
Pilihan: Nama promo / Belum ada promo dipilih
[Batal]                              [Gunakan promo]
```

- Modal dibuka dengan draft mengikuti promo aktif. Tidak ada promo otomatis dipilih bila checkout belum memakai promo.
- Klik kartu/radio hanya mengubah draft; tidak mengubah total, review token, atau promo aktif checkout.
- Input **Kode promo**, tombol **Periksa**: preview read-only memvalidasi dan menyimpan kandidat sementara. Kode valid menjadi satu pilihan draft, bukan promo kedua. Pilihan publik sebelumnya diganti hanya di draft.
- Kode gagal tidak menghapus promo aktif atau draft valid sebelumnya; input dan pesan error tetap ada. Mengedit kode setelah pemeriksaan membatalkan validitas kandidat kode tersebut sampai diperiksa ulang; tidak diam-diam menggunakan kode lama.
- Memilih promo publik setelah kode valid mengganti draft kode. Sebaliknya, kode valid mengganti draft publik. Kode manual tidak muncul dalam daftar publik atau jumlah pagination.
- Kandidat kode valid menampilkan nama/kode sendiri, benefit aktual, dan syarat penting dalam region ringkas di luar daftar. Area kode/feedback ikut dibatasi agar daftar dan footer tetap dapat diakses pada mobile/keyboard virtual.
- **Gunakan promo** disabled bila belum ada draft valid, pilihan sama dengan promo aktif, atau sedang request; teks penjelas **Pilih promo terlebih dahulu** untuk kondisi tanpa draft.
- Konfirmasi selalu meminta preview server terbaru untuk konteks checkout terkini, termasuk kode yang sudah diperiksa. Preview lama bukan otoritas penerapan.
- Sukses total sama/turun: apply review server, tutup modal, fokus kembali ke trigger, tampilkan **Promo diterapkan**.
- Bila total naik: tampilkan konfirmasi existing **Total pesanan naik** sebagai tahap berikutnya pada modal yang sama (bukan dua dialog bertumpuk). Pertahankan copy/tombol existing **Ya, ganti promo** dan tombol batal existing. Batal kembali ke pemilihan dengan draft utuh; setuju menerapkan kandidat terikat fingerprint lalu menutup modal.
- Batal/X/Escape/klik overlay membuang draft, kandidat kode, dan error lokal, tanpa mengubah promo aktif. Saat request berjalan, modal tetap boleh ditutup; respons terlambat dari sesi modal tertutup tidak boleh menerapkan promo. Gunakan pembatalan/identitas sesi request, bukan sekadar state `loading`.
- Jika konteks cart/fulfillment/kurir/harga berubah, abaikan response konteks lama, reset pagination, batalkan kandidat preview/draft yang belum divalidasi ulang, dan tampilkan **Pesanan berubah. Pilih promo kembali.** Perilaku review-required existing tetap berlaku.

### 3. Pagination dan scroll

- Maksimal **10 promo publik per halaman**; jumlah halaman mengikuti total kandidat publik, termasuk yang belum eligible.
- Header, input kode, pagination, ringkasan draft, dan action footer tidak ikut scroll daftar. Daftar memakai `min-height: 0`, tinggi fleksibel, `overflow-y: auto`; tidak memperpanjang body checkout.
- Navigasi mengikuti pola kurir: sebelumnya, `halaman / jumlah halaman`, berikutnya, serta rentang dan total item. Satu halaman tidak menampilkan navigasi yang tidak diperlukan.
- Pindah halaman reset scroll daftar ke atas, mempertahankan draft lintas halaman. Ringkasan draft tetap terlihat walau kartunya berada di halaman lain.
- Pagination bukan infinite scroll/load-all di browser. Fetch hanya halaman yang diminta; response lama tidak menimpa halaman terbaru.
- Membuka sesi modal baru mulai halaman 1; promo aktif tetap ditampilkan pada ringkasan draft terpisah.
- Jika data berkurang sehingga halaman tidak ada, server clamp ke halaman terakhir valid; UI mengikuti metadata response.

### 4. Ranking global

Urutan **sebelum** pemotongan halaman, bukan sort 10/25 item yang sudah diambil:
1. Promo eligible lebih dahulu.
2. Penghematan total terbesar / total bayar estimasi terendah untuk konteks yang sama, termasuk floor, clip, cap, dan pembulatan PPN existing.
3. Jika penghematan total sama: benefit aktual lebih besar, lalu expiry terdekat (tanpa expiry di belakang), nama, ID sebagai tie-break deterministik.
4. Promo belum eligible di belakang, dengan alasan aman existing; urutan deterministik nama lalu ID. Tidak memberi badge rekomendasi pada item disabled.

Tampilkan **Hemat total Rp …** agar rekomendasi dapat dipahami. Label rate/cap dipertahankan, misalnya **Diskon 20% (maks Rp 50.000)**; jangan menyamakan cap Rp50.000 dengan penghematan aktual. Badge **Paling hemat** hanya pada kandidat eligible peringkat pertama global, bukan pertama setiap halaman. Tidak auto-apply.

Contoh literal: subtotal Rp100.000, PPN 11%, ongkir Rp16.000. Baseline Rp127.000. Diskon barang Rp10.000 → total Rp115.900, hemat Rp11.100. Subsidi ongkir Rp11.000 → total Rp116.000, hemat Rp11.000. Diskon barang didahulukan. Diskon 20% cap Rp50.000 pada subtotal itu memberi benefit barang Rp20.000, bukan Rp50.000.

Ranking bersifat estimasi/advisory; sumber harga barang dan tarif PPN berasal dari server. Ongkir yang dikirim browser hanya konteks tampilan seperti existing, bukan otoritas order. Preview/place-order tetap menghitung ulang. Tidak memanggil provider per kandidat promo.

## Blueprint teknis

| Path | Aksi | Tanggung jawab / layer | Test seam |
|---|---|---|---|
| `apps/store/src/components/checkout/PromoSelector.tsx` | modify | UI ringkasan/trigger/warning, tidak render daftar inline | E2E checkout promo |
| `apps/store/src/components/checkout/PromoSelectionDialog.tsx` | create | UI modal, draft publik/manual, scroll, pagination, tahap konfirmasi kenaikan | E2E role dialog/radio/button |
| `apps/store/src/features/discounts/promo-picker-contract.ts` | create | Tipe DTO/draft/hasil interaksi client-server tanpa dependency server runtime | typecheck + consumer tests |
| `apps/store/src/features/discounts/available-promos-service.ts` | create | Satu operasi numbered discovery: context, eligibility, ranking global, slice, selected projection | service unit + DB seam |
| `apps/store/src/features/discounts/promo-ranking.ts` | create | Pure ranking dan exact savings memakai evaluator pricing existing | unit literal |
| `apps/store/src/lib/discount-availability.ts` | modify | DAL existing: tambah pembacaan seluruh kandidat + baseline dari selection milik client; pertahankan facade cursor legacy | DB integration |
| `apps/store/src/app/api/discounts/available/route.ts` | modify | Auth/gate/admission existing, validasi numbered request, service, mapping/log; tanpa query | HTTP mock E2E |
| `apps/store/src/app/checkout/page.tsx` | modify | Integrasi sesi modal, request page/stale guards, prepare-vs-commit preview; promo aktif terpisah dari list page | E2E + existing replacement unit |
| `apps/store/src/features/discounts/promo-ranking.test.ts` | create | Ranking exact, eligibility, cap, tie-break global | unit |
| `apps/store/src/features/discounts/available-promos-service.test.ts` | create | Pagination, selected di halaman lain, stale context metadata, no side effect | unit |
| `apps/store/src/lib/discount-availability.db.test.ts` | modify | Ownership, seluruh kandidat, eligibility dan selected projection | DB disposable |
| `e2e/store/discounts-coupon-mock.spec.ts` | modify | Modal, draft, 10 item, ranking lintas halaman, manual dan invalidation regression | Playwright mock |
| `e2e/store/checkout-review-mock.spec.ts` | modify | Review pickup/delivery, konfirmasi total naik, ulang approval, keyboard/mobile | Playwright mock |
| `docs/features/discount-redemption.md` | modify | Dokumentasi flow dan estimasi ranking | review docs |
| `docs/api-reference.md` | modify | Numbered request/response, selected projection, kompatibilitas cursor | review kontrak |

Kontrak export yang direncanakan (deklarasi tanpa body):

- `promo-picker-contract.ts`:
  - `PromoDraft = { kind: "none" } | { kind: "public"; offerId: string } | { kind: "manual"; code: string }`.
  - `RankedPromoDto`: field existing `AvailableOfferDto`, ditambah `estimatedSavings: string | null`, `estimatedTotal: string | null`, `recommended: boolean`. `benefitKind` menyertakan `shipping`, memperbaiki ketidaksinkronan tipe UI sekarang.
  - `PromoPageRequest`: selection IDs, fulfillment/ongkir existing, `page: number`, `selectedOfferId?: string`.
  - `PromoPageResult`: `items`, `page`, `pageSize: 10`, `totalItems`, `totalPages`, `selectedOffer: AvailableOfferDto | null`, `selectedOfferUnavailable: boolean`.
  - `PromoCandidateResult`: union `ready` (ringkasan kandidat), `increase_confirmation` (previous/candidate total + delta), `error` (pesan aman), `context_changed` (pesan aman). Data/token authoritative tetap dimiliki checkout, tidak disalin menjadi otoritas UI.
- `promo-ranking.ts`: `rankAvailablePromos(input: { baseline: PricingSnapshot; candidates: readonly AvailablePromoCandidate[] }): RankedPromoDto[]`.
- `available-promos-service.ts`: `readAvailablePromoPage(input: PromoPageRequest & { clientId: string; now?: Date }, database?: StoreDatabase): Promise<PromoPageResult>`.
- `discount-availability.ts`: tambahan `readAvailablePromoCandidates(input: { clientId: string; selectedItemIds: readonly string[]; fulfillment: AvailableOfferFulfillmentContext; now?: Date }, database?: StoreDatabase): Promise<{ baseline: PricingSnapshot; candidates: AvailablePromoCandidate[] }>`; `AvailablePromoCandidate` membawa DTO eligibility dan payload benefit original untuk evaluator.
- `PromoSelectionDialog.tsx`: `PromoSelectionDialog(props: PromoSelectionDialogProps)`; props memuat controlled `open/onOpenChange`, page data/loading/error, active selection, callback `onPageChange(page)`, `onCheckCode(code): Promise<PromoCandidateResult>`, `onUsePromo(draft): Promise<PromoCandidateResult>`, `onConfirmIncrease(): void`, `onCancelIncrease(): void`, dan `onRetry(): void`.
- `PromoSelector.tsx`: `PromoSelector(props: PromoSelectorProps)`; props ringkasan aktif dari review server (bukan `.find` halaman), invalidation, disabled/pending, `onOpen`, `onClear`, `onContinueWithout`. Detail draft bukan tanggung jawab ringkasan.

### Data dan kontrak HTTP

- Tambahkan numbered mode pada endpoint existing melalui `page` (integer positif) dan `selectedOfferId` opsional; page size dikunci server 10. `cursor` dan `page` bersamaan → 400. Pertahankan mode cursor legacy dan response-nya untuk kompatibilitas pemanggil existing; checkout baru selalu mengirim `page`.
- Numbered mode menggunakan service baru. Kandidat publik dibaca dalam batch DB, eligibility dan penghematan dihitung global, baru diurut/slice. Jangan menjalankan HTTP preview/DB query per kandidat atau meminta semua halaman lewat browser.
- Reuse konteks selection dan payload benefit existing; baseline memakai effective price setelah Markdown, PPN dari `getPpnRatePercent`, dan builder/evaluator existing. Tidak menduplikasi rumus pajak di frontend atau menggunakan `Number` untuk perbandingan uang.
- `selectedOffer` diperiksa di luar slice halaman. Promo tidak berada di halaman saat ini ≠ promo gugur. Projection hanya untuk promo publik; manual hanya divalidasi lewat preview existing. ID yang tidak tersedia tidak membocorkan promo privat/draft/arsip.
- Selected projection advisory; authoritative invalidation tetap mengikuti preview. Error daftar tidak menghapus promo/review valid yang sudah ada.
- Empty mengembalikan `items: []`, `totalItems: 0`, `totalPages: 0`, `page: 1`; UI tidak menampilkan `1 / 0`.
- Logger module-scope facade store; minimum success `info`, unexpected failure `error` dengan konteks aman; tanpa kode manual, body, token, atau PII.

### Keputusan struktur

- Tambah feature-local service + pure ranking karena numbered discovery memerlukan orkestrasi dan aturan global baru; jangan menambah logika query/ranking ke route atau memperbesar page checkout untuk kalkulasi.
- Pertahankan DAL legacy dan helper eligibility/pricing yang sudah ada, bukan migrasi massal folder atau membuat engine diskon kedua. Query core boleh dipakai ulang tanpa menduplikasi ownership/eligibility.
- Modal terpisah karena memiliki draft lifecycle berbeda dari applied review. Tidak mengubah shared Dialog/token sehingga consumer lain tidak terkena redesign.
- Ranking tidak hanya di client: sorting page pertama akan melewatkan promo lebih hemat pada page berikutnya.
- Evaluasi seluruh kandidat memang membutuhkan kerja sebanding jumlah promo aktif. Ukur query count dan fixture besar; jangan menyisipkan batas kandidat tersembunyi yang menghilangkan promo terbaik. Bila skala memerlukan strategi SQL/materialization lain, eskalasi sebelum mengubah kontrak/scope.

## Blueprint UX dan state matrix

Reuse `packages/ui/src/components/ui/{dialog,button,input,label,badge}.tsx` melalui alias app existing. Kartu promo memakai semantik radio group/radio accessible, tidak sekadar clickable div. Referensi layout: modal alamat dan pagination kurir di `DeliveryQuotePanel.tsx`; warna/typography/spacing mengikuti checkout dan token existing, bukan stylesheet/palet baru.

| State | Copy / kontrol / outcome |
|---|---|
| Idle checkout | **Pilih promo** atau **Ubah promo**; tidak ada daftar inline |
| Modal tanpa draft | **Belum ada promo dipilih**, **Gunakan promo** disabled |
| Draft publik/manual valid | Ringkasan **Pilihan: {nama}**; satu radio/draft; checkout belum berubah |
| Daftar loading | **Memuat promo…**, pagination disabled; ringkasan aktif tidak hilang |
| Daftar empty | **Belum ada promo yang tersedia untuk pesanan ini.** Input kode tetap tersedia |
| Error daftar | **Promo belum dapat dimuat.**, **Coba lagi**; jangan menyamakan dengan empty |
| Belum eligible | Kartu disabled, reason aman server tetap terbaca; tidak direkomendasikan |
| Periksa kode | **Memeriksa…**, hindari request ganda; field berlabel tetap terlihat |
| Kode valid | **Kode promo valid. Pilih Gunakan promo untuk menerapkan.** |
| Kode error | Reason aman server dekat field; fallback **Kode promo belum dapat diperiksa. Coba lagi.** |
| Konfirmasi pending | **Menerapkan…**, cegah submit ganda; response stale tidak commit |
| Total naik | Tahap **Total pesanan naik**, total lama/baru/delta, **Ya, ganti promo**; batal kembali ke draft |
| Sukses | Tutup modal, **Promo diterapkan**, ringkasan dan breakdown dari review server |
| Promo gugur | **Promo sebelumnya tidak lagi berlaku**, alasan, **Pilih promo lain**, **Lanjut tanpa promo** |
| Konteks berubah | **Pesanan berubah. Pilih promo kembali.** Invalidasi kandidat lama/reset page |
| Rate limit | **Terlalu banyak percobaan. Coba lagi beberapa saat lagi.** Hormati retry existing; jangan auto-loop |
| Unsaved/close | Batal/X/Escape/overlay membuang draft, applied state tidak berubah |
| Submit order | Trigger/pelepasan disabled mengikuti submitting; tidak membuka picker saat pesanan dikirim |

Viewport acceptance: desktop 1280/1440 dan mobile 390/360, termasuk tinggi viewport pendek/keyboard virtual. Modal maksimal sekitar 90dvh mengikuti pattern existing; daftar menjadi region scroll, seluruh footer/input/action tetap terjangkau tanpa horizontal overflow. Pada keyboard virtual boleh memakai region scroll tambahan untuk bagian kode bila diperlukan; tidak menyembunyikan action utama.

Accessibility: dialog title/description, focus trap, fokus awal input/heading yang tidak menyebabkan scroll tak terduga, restore focus trigger, Tab/Shift+Tab, Escape, radio arrow keys, loading/error/status announcements, focus-visible, label tombol page sebelumnya/berikutnya, target pointer dan contrast token. Badge bukan satu-satunya indikator pilihan. Belum ada prototype yang diminta; sketsa di atas adalah usulan untuk approval, bukan bukti render.

## Urutan slice dan acceptance

| # | Slice | Status | Acceptance utama |
|---|---|---|---|
| 1 | Numbered discovery + ranking | Done | Ranking global sebelum slice; fixture terbaik di luar 25 nama pertama tetap menjadi urutan pertama; 10 item/page; selected di luar page tetap valid; ownership dan zero writes |
| 2 | Ringkasan + modal publik | Done | Checkout ringkas; draft tidak apply saat diklik; scroll dan pagination; batal aman; apply server-success saja; stale response tidak commit |
| 3 | Kode manual + replacement lifecycle | Done | Periksa tidak apply; satu slot; input edit invalidates checked draft; error menjaga promo lama; kenaikan total perlu persetujuan; gugur/continue-without existing aman |
| 4 | Responsive/keyboard/regression/docs | Done | Viewport/state review, E2E pickup/delivery, unit/DB checks, docs endpoint/fitur diperbarui |

Ini urutan verifikasi, **bukan publikasi implementation tickets** atau otorisasi delegasi.

## Rencana verifikasi

Skill `nextjs`, `frontend-design`, `tdd`, `ux-design`, `development-workflow`, `maintainable-code`, dan `systematic-debugging` telah dimuat; panduan Next.js terpasang `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` diperiksa. Context7 checkpoint: `/drizzle-team/drizzle-orm-docs` — query select/limit/offset; `/reactjs/react.dev` — cleanup/ignore stale async response; `/radix-ui/primitives` — controlled Dialog, dismissal, focus trap dan onCloseAutoFocus. Resolver juga mengidentifikasi `/colinhacks/zod`, `/vitest-dev/vitest`, `/microsoft/playwright`, `/vercel/next.js`. API yang sudah dipakai repo dipertahankan; signature `strictObject`/positive, `limit`, locator role, dan `useLayoutEffect` dikonfirmasi melalui installed types di `node_modules/{zod/v4/classic/schemas.d.ts,drizzle-orm/pg-core/query-builders/select.d.ts,playwright-core/types/types.d.ts,@types/react/index.d.ts}`. Tidak ada penggunaan API uncertain dari ingatan saja.

- RED → GREEN per slice, test pada public seam, nilai literal independen: contoh total Rp115.900 vs Rp116.000, percentage cap/clip, pembulatan rupiah, expiry/null dan tie-break deterministik.
- Unit service: 0/1/10/11/27 promo, page out-of-range, eligible/ineligible, promo terbaik di luar first legacy page, selected di halaman lain, tidak ada private code leak.
- DB disposable: ownership selection, published/window/filter existing, batched usage, no order/hold/redemption/provider writes. Tests DB guard-skip bukan bukti PASS integrasi; catat blokir bila DB tidak tersedia.
- E2E mock existing diperbarui, sehingga tidak perlu spec/testMatch baru: daftar panjang hanya ada dalam modal, scrollHeight melebihi clientHeight, 10 item maksimum, page navigation/scroll reset, selected lintas page, draft/cancel/reopen, kode valid/invalid/edit, pending close/stale response, replacement naik/batal/setuju, review-required, expiry, dan remove/continue-without.
- L0: `npm run verify:types:store`.
- L1 per slice, explicit paths yang relevan: `npm run verify:unit:slice -- apps/store/src/features/discounts/promo-ranking.test.ts apps/store/src/features/discounts/available-promos-service.test.ts apps/store/src/lib/discount-availability.db.test.ts apps/store/src/lib/promo-replacement.test.ts`.
- L2: `npm run verify:batch:unit`; `npm run verify:batch:e2e -- e2e/store/discounts-coupon-mock.spec.ts e2e/store/checkout-review-mock.spec.ts`.
- Main agent memeriksa render/interaksi viewport dan pattern referensi, bukan hanya JSX/test click. Jika browser terblokir, frontend belum dinyatakan selesai.
- L3 sebelum commit/PR/integrasi sesuai repo; legacy `npm run test:e2e` membutuhkan izin terpisah. Tidak menjalankan provider live untuk verifikasi plan ini.
- Simpan output disposable di `playwright/`; baca laporan Markdown saat gagal, bukan screenshot attachment. Hasil suite yang sudah PASS dicatat tanpa rerun sia-sia.

## Dampak deployment dan working tree

Tidak ada env/domain/port/cron/volume/build/schema baru yang direncanakan, sehingga deployment files dan seeder N/A. Existing gate tidak diaktifkan.

Working tree saat pemeriksaan sudah memuat perubahan user/pekerjaan lain, termasuk `DeliveryQuotePanel.tsx`, token UI, dan `playwright.mock.config.ts`. Jangan overwrite/revert/commit perubahan tersebut. Compare referensi berdasarkan working tree aktual dan koordinasikan bila implementasi memerlukan edit area yang sama.

## Open items dan penutupan

- Approval lengkap sudah diperoleh melalui pesan eksekusi user; tidak ada delegasi/commit/deploy.
- Discovery skala: source review memastikan batched candidate/usage read tanpa query/provider per kandidat. Fixture 27 tambahan lolos ranking global dan selected projection di luar page. Production load benchmark/SLA tidak diklaim.
- Discovery viewport: render 360/1440 dan delivery 390/1280 diperiksa; keyboard/focus/footer juga lolos pada 360×500. Keyboard virtual perangkat fisik belum diuji dan bukan klaim dari resize browser.
- Kandidat manual mengikuti exported contract ready (kode/nama tampilan dan benefit aktual). Minimum/expiry/nama Offer manual tidak ditambahkan ke preview API existing; tidak ada metadata syarat yang dikarang.
- Bukti akhir: [verifikasi implementasi](../ticket/checkout-promo-modal-verification.md). Full unit enam workspace 163 file/1.766 pass/12 skip; setelah empat kasus validasi baru focused service 8/8 PASS. Mock E2E 38 kasus unik PASS melalui batch + recheck; types/lint/diff-check PASS. Legacy live E2E tidak dijalankan tanpa izin terpisah.
- Dokumentasi permanen sudah diperbarui di `docs/features/discount-redemption.md` dan `docs/api-reference.md`. File plan tetap disimpan; status keseluruhan hanya pada index fitur.
