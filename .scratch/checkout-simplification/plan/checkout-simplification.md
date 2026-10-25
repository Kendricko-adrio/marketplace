# Plan: Penyederhanaan Checkout — gabung kontak ke step pengiriman, hapus step Kontak & panel Ringkasan

> Status plan secara keseluruhan hanya di [`../index.md`](../index.md). File ini
> mencatat status **per fitur**.

## Goal / Motivation

Halaman checkout saat ini menumpuk terlalu banyak informasi dalam satu alur
tiga langkah. Masukan user (2026-xx, screenshot checkout):

1. Pengisian **alamat baru** sebaiknya berada di **modal**, bukan form inline
   yang memanjangkan halaman.
2. Panel **Ringkasan** di kolom kanan step 1 sudah tidak diperlukan — semua
   perhitungan ada di step terakhir.
3. Step **Kontak** tidak #diperlukan lagi: delivery sudah membawa nama +
   nomor telepon penerima; untuk pickup cukup tambahkan field **Telepon** dan
   **Email** di step awal.
4. **Promo code** dipindahkan seluruhnya ke step terakhir checkout.

Referensi kode saat ini:

- `apps/store/src/app/checkout/page.tsx` — step 2 = Kontak (`~1490-1560`),
  panel Ringkasan (`~1790-1880`), `PromoSelector` di step terakhir (`~1690`).
- `apps/store/src/components/checkout/DeliveryQuotePanel.tsx` — form "Alamat
  baru" inline (`~380-400`) dengan auto-quote saat field lengkap.
- `apps/store/src/app/api/checkout/preview/route.ts:174-175` dan
  `place-order/route.ts:185-189,188` — API **mewajibkan** `email`/
  `contactEmail` (tidak ada perubahan kontrak API dalam plan ini).

## Scope

Keputusan user yang sudah dikonfirmasi (lewat `ask_user_question`):

| Pertanyaan | Keputusan |
|---|---|
| Sumber email pemesan | Pickup: field Email di step awal. Delivery: **email akun read-only** (ditampilkan, tidak bisa diedit) |
| Telepon pemesan delivery | Diambil dari **telepon penerima pada alamat** yang dipilih |
| Field "Nama" pickup | **Dibatalkan** — tidak ada field nama baru, tidak ada kolom `orders.contact_name` |
| Panel Ringkasan | **Dihapus total**, tanpa pengganti |
| Modal alamat baru | **Draft + tombol "Gunakan alamat ini"**, checkbox "Simpan alamat"/"Jadikan alamat utama" tetap di dalam modal |

Perilaku yang harus terlihat setelah perubahan:

1. Indikator langkah menjadi **2 langkah**: "Cara Pengiriman" → "Bayar &
   Pesan". Tidak ada lagi langkah "Kontak".
2. Step 1 berisi: daftar barang yang di-checkout, pilihan metode, alamat/jadwal,
   dan **kontak pemesan**:
   - **Pickup**: field `Telepon *` dan `Email *` (prefill dari profil, bisa
     diubah, validasi sama seperti sekarang: 8–15 angka; format email valid).
   - **Delivery**: email akun ditampilkan read-only (contoh: "Email pesanan:
     `kendrick@…` (akunmu)"); telepon pemesan = telepon penerima alamat
     terpilih, tanpa field baru.
3. Tombol "Lanjut" di step 1 memvalidasi kontak + kelayakan (pickup: slot
   valid via `/api/checkout/validate-step-2`; delivery: layanan sudah dipilih,
   quote tidak pending, telepon penerima lolos aturan 8–15 angka) lalu membuat
   review `/api/checkout/preview` dan masuk step terakhir.
4. Step terakhir tetap menampilkan barang, Detail Pengiriman/Pengambilan,
   Kontak Pemesan, `PromoSelector`, rincian pembayaran, dan Total Bayar.
   **Promo hanya ada di step terakhir** (untuk pickup maupun delivery) —
   termasuk semua state gugur, penggantian, dan "lanjut tanpa promo".
5. Kolom kanan "Ringkasan" hilang; step 1 menjadi satu kolom lebar penuh.
6. "Gunakan alamat baru" membuka **modal**; ongkir baru dihitung setelah modal
   ditutup lewat "Gunakan alamat ini" (bukan setiap ketikan). Checkbox "Simpan
   alamat" dan "Jadikan alamat utama" tetap berperilaku seperti sekarang.
7. Semua jalur kembali/error (`CHECKOUT_REVIEW_REQUIRED`, `PROMO_*`,
   `DELIVERY_REPRICE_REQUIRED`) tetap menuju langkah yang benar pada alur 2
   langkah (input = 1, pembayaran = 2) tanpa membuat order/pembayaran ganda.

## Non-scope

- Tidak ada perubahan endpoint, schema, seeder, atau kontrak payload API
  (`phone`/`email`/`contactPhone`/`contactEmail` tetap dikirim seperti
  sekarang).
- Tidak menambah kolom `orders.contact_name` dan tidak ada field Nama pickup.
- Tidak mengubah logika harga, promo, subsidi ongkir, pickup validation, atau
  recovery request checkout.
- Tidak menyentuh admin app, Jubelio integration, atau deployment.
- Tidak mengubah halaman `/account/addresses` (buku alamat) — hanya modal di
  checkout.

## Features

| # | Feature | Status | verify: | Notes |
|---|---|---|---|---|
| 1 | Modal "Alamat baru" di `DeliveryQuotePanel` (draft + "Gunakan alamat ini", checkbox simpan di dalam modal, quote dihitung setelah diterapkan) | Done | `npm run verify:types:store`; `npm run verify:unit:slice -- <file unit terkait>`; `npm run verify:batch:e2e -- e2e/store/delivery-quote-mock.spec.ts e2e/store/delivery-order-mock.spec.ts` | Isolasi draft vs applied; abort/generation quote tetap jalan |
| 2 | Kontak pemesan pindah ke step 1 (pickup: Telepon+Email; delivery: email akun read-only + telepon penerima) + hapus step Kontak | Done | `npm run verify:types:store`; `npm run verify:batch:e2e -- e2e/store/pickup-mock.spec.ts e2e/store/versioned-checkout-mock.spec.ts e2e/store/discounts-coupon-mock.spec.ts` | Validasi `validateContact` dipakai ulang; `currentIntent` mengambil telepon delivery dari `deliveryAddressPreview` |
| 3 | Indikator 2 langkah, promo hanya di step terakhir, dan remap semua `setStep` untuk alur 2 langkah | Done | `npm run verify:types:store`; `npm run verify:batch:e2e -- e2e/store/checkout-review-mock.spec.ts` | Review token tetap dibuat saat "Lanjut" dari step 1 |
| 4 | Hapus panel "Ringkasan" + layout step 1 satu kolom | Done | `npm run verify:batch:e2e -- e2e/store/delivery-quote-mock.spec.ts` | Heading "Ringkasan" tidak boleh muncul di step 1; rincian tetap di step terakhir |
| 5 | Dokumen fitur diperbarui (alur 2 langkah, sumber kontak, modal alamat) | Done | Review manual `docs/features/delivery-quotes.md`, `docs/features/versioned-checkout-pricing.md`, `.scratch/ux-design/research/ux-design-research.md` (bila menyebut alur 3 langkah) | Tanpa perubahan `docs/api-reference.md` (tidak ada endpoint baru) |

## Implementation notes

Urutan slice (satu slice = satu commit-able unit, diverifikasi sendiri):

1. **Fitur 1** — `DeliveryQuotePanel`: pisahkan `draft` vs `applied` alamat,
   render form di `Dialog` (komponen `@/components/ui/dialog` sudah dipakai di
   `checkout/page.tsx` untuk dialog penggantian promo). `destinationKey`,
   `runQuote`, dan `onNewAddressChange` hanya membaca alamat **applied**.
2. **Fitur 4** — hapus blok panel Ringkasan, sesuaikan grid (`lg:grid-cols-3`
   → satu kolom `max-w-3xl`). Tidak ada test baru; cukup update spec yang
   membaca heading "Ringkasan".
3. **Fitur 2 + 3** — gabungkan kontak ke step 1, hapus `step === 2`, ubah tipe
   `1 | 2 | 3` → `1 | 2`, remap `setStep`, pindahkan `PromoSelector` (hanya ke
   step terakhir), sesuaikan copy peringatan pickup ("sebutkan nomor telepon
   dan email yang kamu isi").
4. **Fitur 5** — dokumentasi + bersihkan referensi alur 3 langkah.

Catatan verifikasi:

- Skill yang wajib dibaca sebelum menulis kode: `ux-design` (wajib, frontend),
  `nextjs`, `tdd`, `maintainable-code` (tidak ada perubahan backend selain
  pemanggilan payload yang sudah ada).
- Context7 checkpoint: slice 1 memakai `Dialog` milik repo yang sudah dipakai
  di file yang sama (pola `open`/`onOpenChange` sudah terkonfirmasi di repo),
  jadi tidak ada API paket eksternal baru. Bila saat implementasi muncul
  kebutuhan API Radix/Dialog yang belum dipakai (mis. focus trap manual),
  jalankan `mcp__context7__*` dulu dan catat hasilnya di sini.
- Semua spec E2E terdampak perlu disesuaikan: `delivery-quote-mock.spec.ts`
  (39 referensi heading/label), `delivery-order-mock.spec.ts` (16),
  `discounts-coupon-mock.spec.ts` (15), `versioned-checkout-mock.spec.ts` (6),
  `checkout-review-mock.spec.ts` (5), `pickup-mock.spec.ts`, `checkout.spec.ts`.
- Test baru yang harus ada: (a) modal alamat — draft tidak memicu quote, klik
  "Gunakan alamat ini" memicu quote; (b) pickup tanpa step Kontak — Telepon +
  Email tervalidasi di step 1 dan email/telepon muncul di step terakhir;
  (c) delivery — email akun read-only tampil, telepon pemesan = telepon
  penerima; (d) promo hanya ada di step terakhir; (e) heading "Ringkasan"
  tidak ada di step 1.
- Verifikasi browser (gate `ux-design`) di 1440px dan 390px: modal tidak
  overflow, step 1 tidak scroll horizontal, dan konsistensi visual dengan
  dialog promo yang sudah ada.

## Open questions

- Tidak ada. Semua keputusan perilaku yang memengaruhi scope sudah dijawab
  user (lihat tabel Scope). Bila muncul keputusan produk baru saat
  implementasi (mis. permintaan menampilkan total di step 1), pekerjaan yang
  terdampak berhenti dan ditanyakan dulu.

## Approval

- Shared understanding confirmed by the user: konfirmasi empat keputusan lewat
  `ask_user_question` pada sesi ini (email pemesan, telepon delivery, nama
  pickup dibatalkan, panel Ringkasan dihapus, modal draft + checkbox simpan).
- Complete scope and acceptance/verify criteria approved by the user:
  **disetujui** — user: “iya sudah saya setujui, tolong kerjakan”.
- Catatan tambahan yang disetujui saat eksekusi: field "Nama" pickup
dibatalkan (tidak ada kolom `orders.contact_name`); panel Ringkasan dihapus
tanpa pengganti; modal alamat = draft + checkbox simpan; promo hanya di step
terakhir; banner gugur promo yang terduplikasi di kartu pesanan dihapus.

Do not mark this plan or a feature Ready while approval is pending.

## Retirement checklist (when the plan reaches Done)

- [ ] Setiap `verify:` fitur lulus (test sesuai `AGENTS.md` §5).
- [ ] Konten enduring diekstrak ke `docs/` (fitur & alur checkout 2 langkah).
- [ ] File plan tetap disimpan bersama artefak fitur saat Done.
- [ ] Entri [`../index.md`](../index.md) diperbarui ke **Done** dengan tanggal +
  ringkasan hasil.

## Evidence (2026-10-22)

Slice 1 — modal alamat:

- `npm run verify:types:store` PASS (hanya gagal pada
  `apps/store/src/lib/discount-lifecycle-flow.db.test.ts`, error pra-ada dari
  migrasi logging yang belum selesai di worktree ini).
- Scoped `npx eslint` pada `checkout/page.tsx` + `DeliveryQuotePanel.tsx`: 0
  error.
- `npx playwright test --config=playwright.mock.config.ts e2e/store/delivery-quote-mock.spec.ts`:
  **22 passed** (termasuk test baru "a new address is entered in a modal and
  only applied after confirmation" dan "a modal address keeps its draft and save
  intent across steps").
- Gate `ux-design`: browser 1440 px dan 390 px — modal tidak overflow, footer
  aksi melekat dan terjangkau di mobile, fokus awal di field pertama, tanpa
  overflow horizontal halaman.

Slice 2–4 — kontak di step 1, 2 langkah, promo di step terakhir, Ringkasan
dihapus:

- `npx playwright test --config=playwright.mock.config.ts` batch A
  (`pickup-mock`, `delivery-quote-mock`, `delivery-order-mock`,
  `addresses-mock`): **36 passed**.
- Batch B dengan disposable DB `marketplace_discounts_test_20261026`
  (`versioned-checkout-mock`, `checkout-review-mock`,
  `discounts-coupon-mock`): **38 passed**.
- `npm run verify:batch:unit`: 1662 passed / 14 skipped, dengan 7 suite DB yang
  menolak berjalan di DB non-disposable (pra-ada) dan 1 kegagalan pra-ada di
  `apps/store/src/lib/checkout-request.test.ts` (file untracked dari migrasi
  logging WIP). Ketujuh suite DB tersebut PASS (**97 passed / 1 skipped**) saat
  dijalankan dengan `DATABASE_URL` disposable.
- Gate `ux-design`: step 1 pickup (1440), modal (1440/390), step pembayaran
  (1440/390) diperiksa pada render nyata; hierarki, spacing, dan treatment
  status konsisten dengan kartu/promo/dialog yang sudah ada. Tidak ada panel
  "Ringkasan" tersisa di langkah input.

Outstanding:

- `e2e/store/checkout.spec.ts` dan `e2e/store/provisional-stock.spec.ts`
  (spec legacy `npm run test:e2e`) sudah disesuaikan ke alur satu-klik, tetapi
  **belum dijalankan** karena `test:e2e` legacy memerlukan izin terpisah.
- Pin `discounts.contractVersion` ditambahkan di `delivery-quote-mock` dan
  `delivery-order-mock` agar kasus uang legacy kedua spec tidak lagi bergantung
  pada state DB dari spec lain.
