# Skenario Testing Manual — Marketplace (Store + Admin)

> Dokumen ini berisi langkah testing **manual** untuk 8 fitur.
> Konvensi tiap skenario: **Prasyarat → Langkah → Ekspektasi → (Edge case)**.
> Skenario difokuskan pada **happy-path + edge cases kunci** (bukan exhaustive matrix).

---

## 0. Prasyarat & Setup Umum

### 0.1 Menjalankan aplikasi
1. `docker compose up -d` — PostgreSQL 16 (port 5432, db `storefront`).
2. `npm run dev:all` — Store di **http://localhost:3000**, Admin di **http://localhost:3001**.
   - Bila perlu terpisah: `npm run dev:store` & `npm run dev:admin` di terminal berbeda.
3. Pastikan `.env` terisi: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (Gmail app-password, sudah terisi: `okcirnoreply@gmail.com`), `NEXT_PUBLIC_*`.
   - ⚠️ **BLOCKER #1 — Midtrans key mismatch** (detail & cara perbaiki di §3): `MIDTRANS_SERVER_KEY`/`MIDTRANS_CLIENT_KEY` di `.env` ber-prefix **PRODUKSI** (`Mid-server-...`/`Mid-client-...`) tapi `MIDTRANS_IS_PRODUCTION="false"`. `getSnapClient()` akan **throw** saat checkout pertama. Sebelum test payment, ganti ke key **sandbox** (`SB-Mid-...`) + tetap `false` (rekomendasi, tanpa uang nyata), ATAU set `MIDTRANS_IS_PRODUCTION="true"` (pakai uang nyata). Restart `npm run dev:all` setelah ubah `.env`.
   - Catatan keamanan: `BETTER_AUTH_SECRET` masih default placeholder `"your-secret-key-change-this-in-production"` (sama di store & admin → HMAC internal jalan, tapi insecure; ganti untuk produksi).

### 0.2 Webhook Midtrans (karena pakai VS Code Port Forwarder)
Alur QRIS end-to-end butuh Midtrans bisa memanggil endpoint webhook.
1. Jalankan store, lalu di VS Code buka panel **Ports** (`Ctrl+Shift+P` → "Ports: Focus on Ports View") atau klik kanan terminal → "Port Forwarding".
2. Forward port **3000** → dapat URL publik (format `https://<random>-<region>.app.github.dev` atau sejenis). **Salin URL publik itu.**
3. Login ke **Midtrans Sandbox Dashboard** → Settings → Configuration → **Notification URL** = `<URL-publik-forward>/api/webhooks/midtrans` → Save.
   - Pastikan juga "Payment Notification" & "Recurring/VA" tidak harus diaktifkan; yang penting Notification URL terisi.
4. Verifikasi: dari terminal luar, `curl -X POST <URL-publik>/api/webhooks/midtrans -H "Content-Type: application/json" -d '{}'` → harusnya return **200** (webhook selalu return 200 agar Midtrans tidak retry, walau body kosong ditolak internal).

### 0.3 Akun & data test (dari `npm run db:seed` — kemungkinan masih ada di DB live)
> ⚠️ **State DB = live**, bukan fresh seed. Data di bawah adalah baseline dari seeder; **periksa/isi sendiri** bila sudah berubah. Tiap skenario punya langkah "Siapkan data" bila perlu.

| Peran | Username | Email | Password | Catatan |
|---|---|---|---|---|
| Admin (branch-scoped) | `admintoko` | `admin@store.com` | `admin123` | role `admin`, scoped ke 1 cabang |
| Admin (HQ, semua cabang) | `hqmanager` | `hq@store.com` | `hq123` | role `hq`, akses semua cabang + CMS/footer |
| Customer | — | `john@example.com` | `password123` | sudah punya cart multi-branch & order per-status dari seed |

Cabang (seeder):
- **JKT-01** Jakarta Pusat — `aktif`, jam **Sen–Sab 09:00–21:00**, **Minggu tutup**.
- **SRB-01** Surabaya — `aktif`, jam sama.
- **BDG-01** Bandung (Dago) — `nonaktif`.

URL login:
- Store: `http://localhost:3000/login`
- Admin: `http://localhost:3001/login`

### 0.4 Konvensi pengujian
- Sebelum mulai pastikan browser **DevTools** terbuka (Network + Console) untuk amati request & toast.
- Untuk cek efek samping di DB, gunakan `npm run db:studio` (Drizzle Studio).
- "Ekspektasi" = kondisi yang **harus** terpenuhi. Bila tidak sesuai → catat sebagai bug.
- Untuk email: siapkan akses ke inbox SMTP_USER (Gmail) + folder Spam; cek juga bahwa App Password masih valid.

---

## 1. Cart per Branch

> Cart **DB-backed** (bukan cookie/localStorage): 1 cart per client (`carts.userId` unique). Tiap `cart_item` membawa `branchId` sendiri. Cart **boleh berisi item dari banyak cabang**, tapi checkout **hanya 1 cabang per order** — penegakan di UI selection & di `place-order`.

### 1.A Happy path — tambah & kelola cart per cabang

**Prasyarat:** Login customer (`john@example.com / password123`), onboarding selesai.

1. Buka product detail (`/products/[id]`) yang punya stok di **JKT-01**.
2. Pilih cabang **JKT-01** di branch picker, pilih varian, atur qty, klik **Masukkan Keranjang**.
   - Ekspektasi: toast sukses; badge navbar bertambah = total qty (bukan jumlah line).
3. Buka `/cart`.
   - Ekspektasi: item tampil **dikelompokkan per cabang** (header group "Jakarta Pusat"). Ada checkbox per group + per item.
4. Ulangi untuk produk lain dari cabang **SRB-01**.
   - Ekspektasi: `/cart` menampilkan **2 group** (Jakarta & Surabaya). Qty navbar = jumlah semua qty.
5. Centang 1 item dari JKT-01 → tombol **Checkout** enable. Lalu centang 1 item dari SRB-01.
   - Ekspektasi: toast `"Tidak bisa checkout barang di branch yang berbeda."`; item dari SRB-01 tidak ikut tercentang; tombol Checkout tetap **disabled** sampai hanya 1 cabang yang tercentang.
6. Centang hanya item JKT-01 → klik **Checkout**.
   - Ekspektasi: pindah ke `/checkout` dengan item JKT-01 saja (selectedItemIds lewat `sessionStorage.checkoutSelectedItemIds`).

### 1.B Edge cases

| # | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| 1.1 | Tambah dari cabang **nonaktif** (BDG-01) | Di product detail, pilih cabang BDG-01 lalu add. | API reject: `400 "Branch not available"`. Item tidak masuk cart. (Catatan: BDG-01 tidak muncul di `/api/branches` karena filter `aktif`; bila tetap muncul di picker, itu bug.) |
| 1.2 | Stok tidak cukup | Pilih varian dengan stok cabang = 0 (atau qty > stok). | `400 "Insufficient stock at this branch"`. Tombol `+` di product detail terkunci di stok cabang. |
| 1.3 | Update qty melebihi stok | Di `/cart`, naikkan qty item melebihi stok cabang. | API reject; qty tidak berubah / revert. |
| 1.4 | Varian sama dari 2 cabang | Tambah varian A dari JKT-01, lalu varian A dari SRB-01. | Muncul **2 line terpisah** (dedup key = variantId + branchId). |
| 1.5 | Varian+cabang sama (dedup) | Tambah varian A dari JKT-01 lagi dengan qty berbeda. | Line digabung, qty dijumlah. |
| 1.6 | Item di cart lalu cabang di-set **nonaktif** oleh admin | Admin nonaktifkan cabang yang item-nya sudah ada di cart customer; customer buka `/cart`. | **Item masih tampil** (GET /api/cart tidak filter nonaktif). Baru ditolak saat `place-order`: `"Branch is no longer available"`. |
| 1.7 | Hapus 1 item | Klik ikon sampah pada item. | Item hilang, badge update. |
| 1.8 | Clear cart | `DELETE /api/cart` (tombol "Kosongkan Keranjang" bila ada). | Semua item terhapus; baris `carts` tetap ada. |
| 1.9 | Akses `/cart` tanpa login | Logout, buka `/cart`. | Redirect ke `/login?callbackUrl=/cart`. |
| 1.10 | Badge navbar | Tambah item qty=3. | Badge = **3** (sum qty), bukan 1. |
| 1.11 | Halaman `/branches` | Buka `/branches`. | ✅ **Berfungsi.** `BranchCard` di-resolve via alias tsconfig `@/components/BranchCard → packages/ui/src/components/store/BranchCard.tsx` (bukan di `apps/store/src/components/`). Sudah diverifikasi `tsc --noEmit` store = 0 error. Tampil grid cabang aktif + jam operasional + filter kota. |

---

## 2. Checkout Pickup-Focused (Simplified)

> Wizard 3 langkah: **Contact → Pickup → Review & Pay**. Tidak ada pengiriman/shipping, tidak ada field nama (diambil dari `session.user.name`), tidak ada field catatan. Field terkumpul: `phone` (8–20 char), `email`, `pickupDate`, `pickupTime`. `total === subtotal` (ongkir gratis, voucher **tidak** dipakai di checkout walau endpoint voucher ada).

### 2.A Happy path — checkout sampai Midtrans Snap

**Prasyarat:** Cart berisi ≥1 item dari **1 cabang aktif**, jam cabang buka di tanggal dipilih.

1. Dari `/cart`, centang item 1 cabang → **Checkout** → `/checkout`.
   - Ekspektasi: Step 1 (Contact). Bila profil customer sudah punya phone+email, muncul tombol **Isi dari Profil**.
2. Isi phone & email valid → **Lanjut**. (Step 1 validasi client: phone ≥8, email format.)
3. Step 2 (Pickup): pilih **tanggal** (input date, `min` = hari ini). Pilih **jam** di dropdown slot 30-menit.
   - Ekspektasi: dropdown slot disable sampai tanggal dipilih; bila cabang tutup hari itu, dropdown disable + pesan `"Cabang tutup pada tanggal ini."`.
4. Klik **Lanjut** → memicu **client + server** validasi (`/api/checkout/validate-step-2`).
   - Ekspektasi: lanjut ke Step 3 bila valid.
5. Step 3 (Review & Pay): centang **konfirmasi** → **Bayar Sekarang**.
   - Ekspektasi: order dibuat + Midtrans Snap charge; redirect ke `redirectUrl` Midtrans (halaman Snap). Order `status=pending_payment`, `paymentStatus=pending`, `paymentMethod=qris`. Cart item **dihapus** setelah sukses.
6. Di Midtrans Snap (sandbox), selesaikan pembayaran QRIS sesuai instruksi sandbox.
   - Ekspektasi: Midtrans redirect ke `/checkout/result?order_id=...&transaction_status=settlement/capture`. Webhook `/api/webhooks/midtrans` terpanggil → `paymentStatus=paid`, `status=processing` (atau `ready_for_pickup`), `pickupCode` 6-char ter-set, stok cabang berkurang, **email "pickup ready"** terkirim.

### 2.B Edge cases

| # | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| 2.1 | Pickup **Minggu** (cabang tutup) | Step 2 pilih tanggal hari Minggu. | Dropdown slot disable, pesan cabang tutup, **Lanjut** disable. |
| 2.2 | Pickup jam di luar jam buka | Pilih tanggal Sen–Sab, tapi input/edit jam ke `08:00` (sebelum buka). | Server `/api/checkout/validate-step-2` reject (jam tidak ada di slot 30-menit). |
| 2.3 | Tanggal lewat hari ini | Edit date input ke kemarin. | `min=todayStr` mencegah di HTML; bila di-bypass via DevTools, server reject ("date in past"). |
| 2.4 | Cart kosong saat buka `/checkout` | Buka `/checkout` tanpa item tercentang / cart kosong. | Redirect balik ke `/cart`. |
| 2.5 | `selectedItemIds` basi | Centang item → checkout → kembali ke `/cart` → hapus item → buka `/checkout` lagi. | ID basi di-drop (intersect dengan cart ID saat ini); bila kosong → redirect `/cart`. |
| 2.6 | Item dari >1 cabang lolos ke place-order | (Bypass UI) kirim `selectedItemIds` dari 2 cabang ke `/api/checkout/place-order`. | `400 "Tidak bisa checkout barang di branch yang berbeda..."`. |
| 2.7 | Cabang jadi nonaktif sebelum bayar | Admin nonaktifkan cabang saat customer di Step 3; klik Bayar. | `place-order` reject: branch tidak aktif. |
| 2.8 | Stok berubah/habis sebelum bayar | Order lain menguras stek; klik Bayar. | `place-order` reject: stok tidak cukup. |
| 2.9 | Konfirmasi tidak dicentang | Step 3, jangan centang konfirmasi. | Tombol **Bayar Sekarang** disable. |
| 2.10 | Midtrans **gagal** (Snap error / charge gagal) | Trigger kegagalan charge (mis. matikan koneksi saat charge / key salah). | `db.transaction` rollback → response **502**; order & item **tidak** dibuat; **cart item tetap ada** (bisa retry). |
| 2.11 | Phone < 8 / email invalid | Step 1 isi phone 5 digit / email "abc". | Validasi client block, **Lanjut** disable. |
| 2.12 | Total vs subtotal | Cek di Step 3 & DB. | `shippingCost=0`, `discount=0`, `serviceFee=0`, `total === subtotal`; label "Ongkos Kirim: Gratis (Pickup)". |
| 2.13 | `paymentMethod` di luar qris | Cek payload charge. | `payment_methods: ["qris"]` saja; `paymentMethod` di DB = `"qris"`. (VA **tidak** ditawarkan — QRIS only.) |
| 2.14 | Halaman `/checkout/result` | Buka langsung `/checkout/result?transaction_status=settlement` tanpa webhook. | Halaman tampilkan status dari **query param**, **bukan DB** (hanya UX). Webhook tetap sumber kebenaran status order. |
| 2.15 | Resume pembayaran | Setelah redirect ke Snap, tutup tab, buka lagi. | `snapRedirectUrl` tersimpan di order, tapi **tidak ada UI "lanjutkan pembayaran"** → gap fitur (catat). |

---

## 3. Midtrans Integration — QRIS Only

> Snap **redirect flow** (bukan inline QR di app): customer diarahkan ke halaman Midtrans Snap, QRIS dirender di sana. `payment_methods: ["qris"]` saja. Webhook `/api/webhooks/midtrans` = sumber kebenaran status order; `/checkout/result` hanya UX (baca query param).

### ⚠️ BLOCKER #1 — mismatch key vs flag (WAJIB perbaiki sebelum test payment)
`.env` saat ini:
- `MIDTRANS_SERVER_KEY="Mid-server-..."` → prefix **PRODUKSI**
- `MIDTRANS_CLIENT_KEY="Mid-client-..."` → prefix **PRODUKSI**
- `MIDTRANS_IS_PRODUCTION="false"` → mengklaim **sandbox**

`getSnapClient()` punya sanity check: jika `IS_PRODUCTION=false`, key harus prefix `SB-Mid-server`; jika `true`, harus `Mid-server`. Kondisi sekarang akan **throw** saat pertama kali checkout ("...is not a sandbox key..."). Pilih salah satu:
- **(Direkomendasikan untuk testing)** Ambil key **sandbox** (`SB-Mid-server-...` / `SB-Mid-client-...`) dari https://dashboard.sandbox.midtrans.com/settings/config-info → ganti di `.env`, tetap `IS_PRODUCTION="false"`. Uji tanpa uang nyata.
- Atau set `MIDTRANS_IS_PRODUCTION="true"` & pakai key produksi — **QRIS akan memakai uang NYATA**. Hanya jika Anda sengaja test di environment produksi.

Setelah perbaiki, **restart `npm run dev:all`**.

### 3.A Happy path — charge → webhook → status update
(Lanjutan §2.A langkah 5–6.)
1. Selesaikan checkout sampai redirect ke Midtrans Snap.
2. Di Snap, pilih **QRIS** → ikuti instruksi sandbox → bayar.
   - Ekspektasi: Midtrans kirim notifikasi ke `/api/webhooks/midtrans` (lewat URL publik VS Code port forwarder). Webhook verifikasi signature + re-verify `GET /v2/{order_id}/status`.
3. Cek DB (Drizzle Studio) / admin order detail.
   - Ekspektasi: `paymentStatus=paid`, `status=ready_for_pickup`, `pickupCode` 6-char ter-set, `branchStocks` berkurang sesuai qty, **Email #1 (pickup ready)** terkirim ke `contactEmail`.
4. Midtrans redirect → `/checkout/result?order_id=...&transaction_status=settlement` → tampil sukses.
   - Catatan: halaman ini baca query param saja, BUKAN DB. Bila tab Snap ditutup sebelum redirect, webhook tetap jalan & order tetap update.

### 3.B Edge cases

| # | Skenario | Cara uji | Ekspektasi |
|---|---|---|---|
| 3.1 | Signature key **absen** | Kirim webhook manual tanpa `signature_key`. | Verifikasi signature **di-skip** (kode hanya cek bila truthy); tapi re-verify `getMidtransTransactionStatus` tetap jalan → aman selama server key valid. |
| 3.2 | Webhook **duplikat** (Midtrans retry) | Picu webhook sama 2× untuk 1 order. | Idempotent: #2 return 200 "already processed" / "already marked as failed", DB tak berubah. |
| 3.3 | Webhook **selalu 200** | Picu webhook body rusak / error. | Tetap 200 (agar Midtrans tidak retry) walau error ditangani internal. |
| 3.4 | `expire` (QRIS tak dibayar) | Buat order, jangan bayar, tunggu Expired di sandbox. | `failed_payment` + `paymentStatus=failed` + `paymentFailureReason="Payment expired — user did not complete payment in time"` + `midtransFailureStatus="expire"`. Stok **tidak** dikembalikan (pending→failed, belum pernah deduct). |
| 3.5 | `deny` (ditolak issuer) | Simulasi deny di sandbox. | `failed_payment` + "Payment denied by issuer/acquirer (...)". |
| 3.6 | `cancel` (dibatalkan user di Snap) | Klik cancel di halaman Snap. | `failed_payment` + "Payment cancelled". |
| 3.7 | `pending` (QRIS dibuat, belum dibayar) | Webhook `transaction_status=pending`. | **No-op** — order tetap `pending_payment`. |
| 3.8 | `capture` + `fraud_status=accept` | Settlement via capture. | Sukses → `paid` + `ready_for_pickup`. |
| 3.9 | Bayar ulang order `failed_payment` | Buka `/account/orders/[id]` order failed, coba `POST /api/payments/midtrans/create`. | 400 "Order is not pending payment" — `failed_payment` **terminal**, harus buat order baru. |
| 3.10 | Bayar ulang order `pending_payment` | Order pending (punya `snapRedirectUrl`). | Diizinkan → redirect ke Snap resume. |
| 3.11 | Midtrans **error** saat `place-order` | Putuskan koneksi / key salah saat klik Bayar. | 502; `db.transaction` rollback (order & item tak dibuat); **cart item tetap** (bisa retry). |
| 3.12 | Oversell stok (concurrent) | 2 order bersamaan untuk item stok terakhir. | Deduct `Math.max(0, stock-qty)` → stok **di-clamp ke 0** (bukan reject); stok **tidak di-reserve** saat place-order → 2 order bisa keduanya sukses untuk stok 1. Catat sebagai potensi bug. |
| 3.13 | `midtransTransactionId` tidak terisi | Cek DB setelah sukses. | Kolom tetap `null` (Snap flow tidak menulisnya). |
| 3.14 | `MIDTRANS_PAYMENT_MODE` | Cek effect di kode. | **Dead config** — `createPayment` selalu Snap; `core`/`snap` diabaikan. |

### 3.C Cara simulasikan status di Midtrans Sandbox
- **Sukses (settlement)**: Snap sandbox → QRIS → simulator pay → settlement.
- **Expire**: biarkan transaksi tak dibayar sampai habis waktu (atau ubah expiry di Snap).
- **Deny / Cancel**: kontrol cancel di Snap atau simulator deny.
- Verifikasi via **Midtrans Sandbox Dashboard → Transaction**; bila webhook belum ke-trigger, pakai tombol "Send Notification" untuk kirim ulang manual.

---

## 4. Order Management — Admin + Order Inquiry

> Admin (port 3001). 2 peran: `hqmanager/hq123` (HQ, semua cabang, **read-only** untuk verifikasi pickup) & `admintoko/admin123` (admin cabang JKT-01, **bisa verifikasi pickup**). **Tidak ada kontrol status manual** (cancel/refund/mark paid/mark ready/mark completed) — semua transisi di-drive webhook. `cancelled` hanya dari seed.

### 4.A Admin — list & filter
**Prasyarat:** Login admin di :3001.
1. Buka `/admin/orders`.
   - Ekspektasi: list order. Tab: **all / pending_payment / ready_for_pickup / failed_payment**. Polling tiap 30s (saat tab aktif).
2. Login `hqmanager` → ada **dropdown filter cabang**. Login `admintoko` → badge "Your Branch Only", list otomatis di-scope ke JKT-01.
3. Filter: `status`, `branchId` (HQ saja), `from`/`to` (tanggal, `to` inklusif +1 hari), `search`, `page`, `limit=20`.
4. Search: ketik **nama customer** (mis. "John") atau **UUID order penuh**.
   - ⚠️ Search pakai ilike `%query%` terhadap UUID penuh + `clients.name`. Mengetik 8-char pertama (yg tampil di UI) **tidak match** — gunakan UUID penuh atau nama.

### 4.B Admin — detail & verifikasi pickup
1. Buka `/admin/orders/[id]`.
   - Ekspektasi: stepper 4 langkah (Order Placed → Paid → Ready for Pickup → Completed) bila `processing`/`ready_for_pickup`/`completed`; alert card terpisah untuk `cancelled`/`failed_payment`. Info customer, cabang, item, pembayaran (QRIS, paymentStatus badge).
2. Untuk order `ready_for_pickup`, login sebagai **`admintoko`** (bukan HQ) → tombol **Customer Pick Up** muncul.
3. Klik tombol → modal input kode (max 6, auto-uppercase). Ketik kode pickup dari email customer / `/account/orders/[id]`.
4. Submit kode **benar** → status `completed`, **Email #2 (order completed)** terkirim, audit log `VERIFY_PICKUP_CODE` tertulis.
5. Admin **tidak bisa melihat** kode pickup di detail (by design — kode hanya ditampilkan ke customer).

### 4.C Edge cases

| # | Skenario | Ekspektasi |
|---|---|---|
| 4.1 | Branch admin buka order cabang lain | Detail: 403 "Forbidden — order belongs to a different branch". List: di-filter keluar. |
| 4.2 | HQ coba verifikasi pickup | 403 "Only branch admins can verify pickup codes". |
| 4.3 | Verifikasi pada order non-`ready_for_pickup` | 400 "Order must be ready_for_pickup (current: ...)". |
| 4.4 | Kode pickup **salah** | 409 "Invalid pickup code. Please verify with the customer." |
| 4.5 | Order tidak ditemukan | 404. |
| 4.6 | `?verify=1` di URL | **No-op** — detail page tidak baca query; modal tidak auto-open, harus klik tombol manual. |
| 4.7 | Akses tanpa permission `orders:view` | Redirect `/admin?error=forbidden`. |
| 4.8 | Cari kontrol cancel/refund | **Intentionally tidak ada** (konfirmasi user) — tidak ada tombol cancel/refund/mark status di UI admin. Semua transisi non-completed via webhook. Status `cancelled` hanya dari seed. Out of scope. |

### 4.D Order Inquiry — resolusi
"Order Inquiry" = **pencarian order oleh admin** di `/admin/orders` (sudah ada, lihat §4.A search nama/UUID). **Tidak ada** inquiry publik by kode+email tanpa login — dan ini **tidak diperlukan** (konfirmasi user). Catatan: `/checkout/result` bukan inquiry (baca query param Midtrans, tidak query DB); `/account` + `/account/orders/[id]` = customer authenticated order history (§5.B, §8.B).

---

## 5. Customer Profile & Dashboard

> Store (port 3000). `/account` = **1 halaman 2 tab** ("Pesanan Saya" default & "Profil Saya"). Bukan dashboard multi-page. **Onboarding wajib** sebelum `/account` reachable — termasuk user seeded (`john`/`jane` punya `onboardingCompleted=false`).

### 5.A Onboarding (wajib saat first login)
**Prasyarat:** Login `john@example.com / password123` (akan redirect ke `/onboarding`).
1. Isi **phone** (input dengan prefix `+62` otomatis; ketik bagian lokal mis. `81234567890`, kode normalisasi leading `0`/`62`).
2. Isi **birthDate** (date picker; usia ≥ 13 thn).
3. Pilih **gender** (Laki-laki / Perempuan — "Other" tidak ada di form walau schema comment sebut).
4. Submit.
   - Ekspektasi: `onboardingCompleted=true`, cookie `client.onboarding=1` (7 hari, non-httpOnly) ter-set, redirect `/`.
5. Bila cookie hilang (manual/expired) tapi DB `onboardingCompleted=true`, buka `/` → bounce sekali lewat `/api/onboarding/sync` untuk re-set cookie.

### 5.B Dashboard / account — orders tab
1. Buka `/account` → tab **Pesanan Saya** default.
   - Ekspektasi: list order (badge status, tanggal, ID pendek, thumbnail item pertama, "+N barang lainnya", total, "Lihat Detail"). Empty state "Belum ada pesanan" + "Mulai Belanja".
2. Klik **Lihat Detail** → `/account/orders/[id]` (lihat §8.B untuk kode pickup & bayar ulang).
3. ⚠️ Input **search & filter** di tab orders **non-functional** (tidak ada wiring fetch).

### 5.C Profile edit
1. Tab **Profil Saya**.
2. Edit **name** (1–100 char) → **Simpan Perubahan**.
3. Klik **Ubah** pada phone → ketik format **`+62...` penuh** (mis. `+628123456789`) → Simpan.
   - ⚠️ Berbeda dari onboarding: tab profile **tidak normalisasi** — harus ketik `+62` penuh, ketik `0812...` akan gagal validasi server.
4. Ekspektasi: `PATCH /api/account/profile` 200; session di-refresh.
5. **Tidak bisa diedit**: email (disabled), birthDate & gender (no UI), password (no UI), avatar (tombol kamera **no onClick**).

### 5.D Edge cases

| # | Skenario | Ekspektasi |
|---|---|---|
| 5.1 | Usia < 13 thn saat onboarding | Reject "Anda harus berusia minimal 13 tahun". |
| 5.2 | Phone tidak format `+62\d{8,13}` | Onboarding: field error `errors.phone`. Profile PATCH: 400 regex message. |
| 5.3 | Ketik `0812...` di profile (tanpa +62) | 400 (profile tidak normalisasi). |
| 5.4 | Name kosong | 400 "Nama wajib diisi". |
| 5.5 | Tidak ada perubahan | 400 "Tidak ada perubahan untuk disimpan." (efektif tak tercapai dari UI karena phone selalu dikirim). |
| 5.6 | Akses `/account` tanpa login | Redirect `/login?callbackUrl=/account`. |
| 5.7 | Lihat order milik user lain | `/api/orders/[id]` 404 "Order not found" (scoped by userId). |
| 5.8 | Admin login di store | Ditolak `FORBIDDEN / INVALID_USER_TYPE` (session hook). |
| 5.9 | Register password lemah | min 8, max 128, harus ada huruf besar+kecil+angka. |
| 5.10 | Forgot password | ⚠️ Route `/forgot-password` **tidak ada**; handler `sendResetPassword` = TODO stub. **Deferred (nanti saja)** — out of scope pengujian saat ini. |
| 5.11 | Tombol "Keluar" di sidebar `/account` | ⚠️ **No onClick** — non-functional. Pakai dropdown "Keluar" di Header. |
| 5.12 | Badge "Member Silver" | Hardcoded, bukan logic membership. |
| 5.13 | `?tab=orders` di URL | Diabaikan (page tidak baca searchParams); tab default orders. |

---

## 6. Home CMS — 5 Section

> Admin (3001) `/admin/homepage`. **Default role `admin` TIDAK bisa lihat** (seeded `homepage.canView=false`) → pakai `hqmanager/hq123`, atau grant permission `homepage` via `/admin/roles` (HQ). Store render di `/` (home) fetch `/api/homepage` `cache: no-store` → perubahan langsung muncul setelah reload store (tidak perlu rebuild). `announcement_bar` selalu dirender **pertama** di atas section lain (meski `displayOrder`-nya bukan 1).

### 6.1 Lima tipe section (field per tipe)
| Tipe | Field | Catatan |
|---|---|---|
| `banner` (Banner Hero) | `slides[]` 1–5 {imageUrl, altText?}, `ctaText?`, `ctaLink?` (URL Manual / Filter Produk), `autoRotateIntervalSec?` 2–30 default 5 | Auto-rotate hanya jika >1 slide; pause on hover. Image upload, old file dihapus saat replace/remove. Legacy single imageUrl → 1 slide. |
| `carousel_product` (Carousel Produk) | `mode` manual\|filter; `filter?` {search, category, brand, minPrice, maxPrice, hasDiscount, sortOrder}; `limit?` 1–20 default 10 | Manual = pilih produk (junction table, drag order). Filter = dinamis saat render (auto-update kalau produk berubah). Brand = slug (dimensi sync-managed, opsi dari `/api/admin/brands`). |
| `promo_cards` (Promo Cards) | `cards[]` max 6 {id, imageUrl, title, filter?} | Tanpa `filter` → card non-clickable. Image upload. |
| `announcement_bar` (Announcement Bar) | `message` (wajib), `variant` info\|warning\|success | Title/subtitle disembunyikan. **Dismissible via localStorage per-section — persist antar sesi!** |
| `store_banner` (Store Banner) | (tidak ada field) | Render grid cabang `aktif` dari DB. Tidak ada cabang → null. |

### 6.A Happy path — CRUD section + render di store
**Prasyarat:** Login `hqmanager`. Siapkan gambar (JPEG/PNG/WebP/GIF ≤5MB) untuk banner/promo.
1. Buka `/admin/homepage` → list 5 section (seeder). Toggle **Aktif/Nonaktif** inline. Drag untuk reorder.
2. Klik **Tambah Section** → pilih tipe (mis. `banner`) → `/admin/homepage/new?type=banner`.
3. Isi form: upload gambar slide (`POST /api/admin/upload?folder=homepage`), isi title/subtitle/CTA, atur interval. Save.
   - Ekspektasi: section dibuat, `displayOrder` = max+1, muncul di list.
4. Klik section → **Edit** (`/admin/homepage/[id]/edit`). Ubah konten. Save.
5. Buka **Preview** (`/admin/homepage/preview`) → toggle "Aktif Saja"/"Semua". Atau tombol "Preview Section" di form (dialog per-section).
6. Buka store `/` (hard refresh).
   - Ekspektasi: section tampil sesuai `displayOrder`; `announcement_bar` (jika aktif) tampil **paling atas**.
7. Carousel manual: tambah section `carousel_product` mode manual → pilih produk (paginate, search) → Save. Cek store `/` → carousel tampil produk terpilih.
8. Carousel filter: mode filter → set {category, brand, sortOrder, hasDiscount, limit} → Save. Store render produk dinamis sesuai filter (preview via `/api/admin/homepage/preview-products`).

### 6.B Edge cases

| # | Skenario | Ekspektasi |
|---|---|---|
| 6.1 | Login `admin` (bukan HQ) buka `/admin/homepage` | Redirect `/admin?error=forbidden` (seeded canView=false). Grant via `/admin/roles` bila ingin akses. |
| 6.2 | Upload gambar >5MB / format bukan jpeg/png/webp/gif | Reject (max 5MB, format terbatas). |
| 6.3 | Banner slide imageUrl **kosong** (`""`) | Zod terima (string kosong) → save sukses; renderer fallback **gradient** (bukan error). |
| 6.4 | Carousel filter dgn **category slug tidak ada** | Filter return 0 produk → renderer null (carousel kosong). |
| 6.5 | `store_banner` tanpa cabang aktif | Renderer null (tidak tampil). |
| 6.6 | Announcement bar di-dismiss | Klik close → localStorage `homepage:announcement:dismissed:<id>=1`. Bar **tidak muncul lagi** sampai localStorage dibersihkan. ⚠️ Persist antar sesi — sering bikin bingung tester. |
| 6.7 | Reorder gagal di tengah | `PATCH /reorder` loop per-item **non-transactional** → sebagian item reorder, sebagian tidak. Refresh list untuk lihat state akhir. |
| 6.8 | Hapus section dgn gambar | File gambar di-disk dihapus (untuk banner/promo yg URL-nya `/uploads/...`). |
| 6.9 | Ganti URL gambar banner jadi **URL eksternal** (`https://...`) | Old `/uploads/...` dihapus, eksternal tidak dikelola cleanup (gap). |
| 6.10 | Perubahan tidak muncul di store | Hard refresh `/`; fetch `cache: no-store` → harus muncul. Bila gambar lama muncul → cache browser 1 thn (`Cache-Control immutable`); URL baru (UUID) otomatis. |
| 6.11 | Store down saat admin preview gambar | Admin rewrite URL ke `${NEXT_PUBLIC_STORE_URL}/uploads/...` → gambar preview pecah bila store mati. |
| 6.12 | `autoRotateIntervalSec` di luar 2–30 | Clamp 2–30 (client + server + renderer). |
| 6.13 | Filter (carousel atau `/products`) dgn **brand slug tidak ada** | 0 produk → carousel renderer null; `/products` tampil kosong (total 0, bukan error). |
| 6.14 | `/products` filter category + brand sekaligus | `pagination.total` benar (count ikut semua filter — fix bug count lama yg hanya ikut sebagian). |
| 6.15 | `/products` sidebar: sort dropdown + toggle diskon | Sort (Terbaru/Harga Termurah/Harga Termahal) ubah `sortBy`+`sortOrder`; toggle "Hanya produk diskon" set `hasDiscount=true` → hanya produk dgn `basePrice > min(variant.price)`. |

---

## 7. Footer Configurable

> Admin (3001) `/admin/footer` — **HQ-only hardcoded** (layout/API cek `role==="hq"`; `admin` ditolak walau diberi permission). Store render footer di **setiap halaman** via `FooterWrapper` (root layout, `force-dynamic`) → perubahan langsung muncul tanpa rebuild. Singleton (1 baris) by app code, BUKAN DB constraint.

### 7.1 Field
| Field | Validasi | Catatan |
|---|---|---|
| `brandName` | 1–100, wajib | Judul brand |
| `tagline` | max 300 | Counter live 0/300 |
| `columns[]` | max 3 kolom; tiap kolom: `title` 1–100 + `links[]` max 5 (`label` 1–100, `href` 1–500) | Link via picker: Halaman (staticPages published → `/pages/slug`) / Rute Statis (8 route) / URL Eksternal (free text) |
| `copyrightText` | 1–200, wajib | Bar border-top |
| `socialMedia[]` | 7 platform (instagram, facebook, twitter, tiktok, youtube, linkedin, whatsapp); tiap {url max 500, enabled bool} | Hanya `enabled && url` yg render. Tidak bisa dihapus, hanya di-disable. |

### 7.A Happy path — edit & render
**Prasyarat:** Login `hqmanager`. (Bila ingin tab "Halaman" di link picker, publish ≥1 static page via `/admin/pages` dulu.)
1. Buka `/admin/footer` → form terisi dari seed (brandName "StoreFront", 2 kolom, 3 social enabled).
2. Edit brandName, tagline. Tambah/ubah kolom & link (pakai FooterLinkPicker tab Halaman/Rute Statis/URL Eksternal). Toggle social media.
3. Klik **Preview** → dialog render form-state saat ini (link tidak navigasi).
4. **Simpan** (PUT `/api/admin/footer` upsert).
5. Buka store halaman mana saja (refresh).
   - Ekspektasi: footer baru tampil. Link eksternal buka tab baru; internal pakai next/link. `updatedBy` tercatat.
6. Cek link "Halaman" → `/pages/<slug>` render konten static page.

### 7.B Edge cases

| # | Skenario | Ekspektasi |
|---|---|---|
| 7.1 | Login `admin` (bukan HQ) buka `/admin/footer` | Redirect `/admin?error=forbidden` (hardcoded HQ). Tidak bisa di-grant via roles. |
| 7.2 | `brandName`/`copyrightText` kosong | Zod reject (wajib). |
| 7.3 | Kolom >3 / link >5 | Tombol Add disable di 3/5; server Zod `.max` reject. |
| 7.4 | Link picker tab "Halaman" tanpa static page published | "Belum ada halaman yang dipublikasikan." |
| 7.5 | URL eksternal non-http (mis. "hello") | Disimpan (free text); renderer anggap internal → navigasi 404. Tidak ada validasi. |
| 7.6 | Hapus baris footer via SQL (bukan admin) | ⚠️ Footer render **KOSONG** — `DEFAULT_FOOTER_CONFIG` di schema **TIDAK pernah dipakai** renderer. Komentar code menyesatkan. |
| 7.7 | Tidak bisa hapus footer via admin | Tidak ada endpoint DELETE; hanya PUT upsert. Reset manual via SQL/edit field. |
| 7.8 | Social media disable | Tetap disimpan (URL+enabled=false); toggle on kembali restore. |
| 7.9 | Link picker auto-fill label | Pilih destination → label isi hanya bila label kosong (tidak menimpa label manual). |
| 7.10 | Audit log | Footer PUT **tidak** tulis `audit_log` (hanya `updatedBy` di baris). |

---

## 8. Pickup in Store — Kode Teks + Customer Order View + Notifikasi Email + Validasi Jam

> Cross-cutting dengan §2 (checkout) & §3 (Midtrans). Fokus di sini: generasi & tampil kode pickup, customer order view, 3 email, validasi jam operasional.

### 8.A Kode Teks (pickup code)
- **Generasi**: di webhook saat **payment sukses** (bukan saat order dibuat). 6 char uppercase dari `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (tanpa `O,I,0,1` agar tak ambigu). Collision-check vs order `ready_for_pickup`/`completed`, retry 10×. Disimpan `orders.pickupCode` (null sampai sukses).
- **Tampil ke customer**: `/account/orders/[id]` — card monospace + tombol **Copy**, **hanya** saat `ready_for_pickup`/`completed`. API `/api/orders/[id]` strip kode di status lain.
- **Admin TIDAK bisa lihat** kode (`GET /api/admin/orders/[id]` tidak select `pickupCode`) — by design. Admin **verifikasi** via modal "Customer Pick Up": input kode (max 6, auto-uppercase), compare constant-time (`crypto.timingSafeEqual`).
- **Uji**:
  1. Selesaikan 1 order sampai `ready_for_pickup` (§3.A).
  2. Customer buka `/account/orders/[id]` → kode tampil + bisa copy.
  3. Login `admintoko` → `/admin/orders/[id]` → "Customer Pick Up" → ketik kode → `completed` + Email #2 + audit log.
  4. Login `hqmanager` → verifikasi → 403.

### 8.B Customer Order View (`/account/orders/[id]`)
1. Order `pending_payment` → tombol **Bayar Sekarang** (redirect ke `snapRedirectUrl`). Stepper tampil. Kode pickup **tidak** tampil.
2. Order `processing` → "Order is being prepared. Pickup code will be generated automatically."
3. Order `ready_for_pickup` → kode pickup tampil + card lokasi cabang + jam pickup + info pembayaran QRIS.
4. Order `failed_payment` → alert + `paymentFailureReason` + "Silakan buat pesanan baru...".
5. Order `cancelled` → "Pesanan ini telah dibatalkan".
6. Tombol **Beli Lagi** → `/products/[productId]`.

### 8.C Notifikasi Email (3 template, semua dari STORE via Gmail)
Cek inbox `contactEmail` (+ folder Spam). Sender `SMTP_FROM`.

| # | Trigger | Event | Subject (contoh) | Konten kunci |
|---|---|---|---|---|
| 1 | Webhook sukses | `ready_for_pickup` | "Your Order is Ready for Pickup — #<shortId>" | **Kode pickup** (box besar monospace), tabel item, subtotal/fee/total, lokasi cabang + jam operasional, tanggal/jam pickup, instruksi "Tunjukkan kode...". |
| 2 | Admin verifikasi pickup | `completed` | "Your Order has been Completed — #<shortId>" | Timestamp selesai, item, total, terima kasih. |
| 3 | Webhook gagal | `failed_payment` | "Pembayaran Gagal — #<shortId>" | Alasan human-readable, item, total, "Silakan buat pesanan baru...". |

**Uji**:
- Email #1: selesaikan pembayaran → cek inbox `contactEmail`.
- Email #2: admin verifikasi kode → cek inbox.
- Email #3: biarkan QRIS expire / cancel di Snap → cek inbox.
- ⚠️ **Tidak ada** email "order placed"/"pending payment" saat order dibuat. **Tidak ada** email saat `cancelled`.
- Bila email tak sampai: cek `SMTP_USER`/`SMTP_PASS` valid (App Password Gmail), cek log server (Nodemailer lempar error bila creds hilang).

### 8.D Validasi Jam (operating hours)
Schema: `branches.operatingHours` jsonb per-hari (`monday..sunday`), tiap hari `{open, close}` atau `null` (tutup). Seed: Sen–Sab 09:00–21:00, **Minggu null**.

**Aturan** (`apps/store/src/lib/pickup-validation.ts`):
- Tanggal tidak boleh lewat hari ini.
- Hari itu harus non-null (cabang buka).
- Jam harus ada di slot 30-menit dari `open` sampai (tidak termasuk) `close`. Contoh `21:00` close → slot terakhir `20:30`.
- Dipakai di 3 tempat: client Step 2, server `/api/checkout/validate-step-2`, server `/api/checkout/place-order` (defense in depth).

**Uji edge cases**:
| # | Skenario | Ekspektasi |
|---|---|---|
| 8.1 | Pickup hari **Minggu** | "Cabang tutup pada tanggal ini." (slot disable). |
| 8.2 | Pickup jam `08:00` (sebelum buka) | Reject (tidak ada di slot). |
| 8.3 | Pickup jam `21:00` (jam tutup) | Reject — `21:00` bukan slot valid (terakhir `20:30`). |
| 8.4 | Pickup jam `09:15` (bukan kelipatan 30) | Reject (slot 30-menit). |
| 8.5 | Tanggal lewat hari ini | HTML `min` cegah; bypass DevTools → server reject "Pickup date cannot be in the past." |
| 8.6 | Cabang `nonaktif` saat checkout | validate-step-2: "Branch is not available"; place-order: "Branch is no longer available". |
| 8.7 | Atur cabang tutup hari Senin (`monday: null`) | Edit via **admin `/admin/branches/[id]/edit`** (BranchForm, field jam operasional per-hari) → simpan. Lalu pickup Senin di store → ditolak. |

---

## 9. Catatan & Known Issues dari Eksplorasi

### Bug / blocker
1. **BLOCKER #1 — Midtrans key mismatch** (.env): key produksi (`Mid-server-...`) + `IS_PRODUCTION="false"` → `getSnapClient()` throw saat checkout. Fix: sandbox key atau set `true`. (§3)
2. ~~**Halaman `/branches` gagal compile**~~ — **FALSE ALARM**. Sebenarnya berfungsi: `BranchCard` di-resolve via alias tsconfig `@/components/BranchCard → packages/ui/src/components/store/BranchCard.tsx`. Diverifikasi `tsc --noEmit` store = 0 error. (Agent eksplorasi keliru hanya cek `apps/store/src/components/`.) (§1.B 1.11)
3. **Oversell stok tidak ditolak**: webhook deduct `Math.max(0, stock-qty)` → di-clamp ke 0, bukan reject. Stok **tidak di-reserve** saat place-order → 2 order concurrent untuk stok 1 bisa keduanya sukses. (§3.B 3.12)
4. **Cart deletion di luar transaction**: setelah Midtrans sukses, hapus cart item di luar `db.transaction` → bila crash antara commit order & delete cart, item bisa di-checkout ulang (order ganda). (§2)
5. **`/checkout/result` bukan sumber kebenaran**: status dibaca dari query param Midtrans, BUKAN DB. Webhook = sumber kebenaran. (§2.B 2.14)
6. **Voucher tidak terhubung checkout**: endpoint `/api/vouchers/validate` ada tapi checkout tidak memanggilnya; `total=subtotal` selalu. **Out of scope (skip, konfirmasi user).** (§2)

### Gap fitur / tidak terimplementasi
7. **Order Inquiry publik TIDAK ada** (tidak diperlukan, konfirmasi user): "inquiry" = admin search di `/admin/orders` (§4.D). Out of scope.
8. **Cancel manual order TIDAK ada** (intentional, konfirmasi user): status `cancelled` hanya dari seed; tidak ada endpoint/tombol cancel. Out of scope. (§4.C 4.8)
9. **Forgot password TIDAK ada** (deferred "nanti saja", konfirmasi user): route `/forgot-password` tidak exist; `sendResetPassword` = TODO stub. Out of scope. (§5.D 5.10)
10. **Avatar upload TIDAK ada**: tombol kamera di `/account` no onClick. (§5.C)
11. **Email ubah TIDAK ada**: field email disabled di profile. (§5.C)
12. **birthDate & gender tidak bisa diedit** setelah onboarding. (§5.C)
13. **Tombol "Keluar" di sidebar `/account` non-functional** (no onClick); pakai header dropdown. (§5.D 5.11)
14. **Search & filter di tab orders `/account` non-functional**. (§5.B)
15. **`?verify=1` di admin order detail no-op** (modal tidak auto-open). (§4.C 4.6)
16. **`midtransTransactionId` tidak pernah ditulis** (Snap flow). (§3.B 3.13)
17. **`MIDTRANS_PAYMENT_MODE` dead config** (tidak dibaca kode). (§3.B 3.14)

### Inkonsistensi / keamanan
18. **`DEFAULT_FOOTER_CONFIG` diekspor tapi TIDAK dipakai** renderer → footer row hilang = footer kosong, BUKAN default. Komentar code menyesatkan. (§7.B 7.6)
19. **Footer HQ-only hardcoded** → tidak bisa di-grant ke `admin` via roles (beda dari homepage yg pakai RBAC module). (§7)
20. **Homepage `admin` role default canView=false** → harus grant via `/admin/roles`. (§6.B 6.1)
21. **Signature webhook di-skip bila `signature_key` absent** → andalkan re-verify `getMidtransTransactionStatus`. (§3.B 3.1)
22. **`BETTER_AUTH_SECRET` masih placeholder default** → insecure (ganti untuk produksi). (§0.1)
23. **Phone format onboarding vs profile beda** (onboarding normalisasi `+62`, profile harus ketik penuh). (§5.C)
24. **Gender enum mismatch**: schema comment sebut "other" tapi onboarding reject. (§5.A)
25. **Announcement bar dismissal persist localStorage** → tester kira "hilang permanen". (§6.B 6.6)
26. **Reorder homepage non-transactional** → partial failure. (§6.B 6.7)
27. **Reversal stok hanya untuk paid→failed**; pending→failed tidak kembalikan stok (karena belum pernah deduct). (§3.B 3.4)

---

## 10. Resolusi grill (sudah dikonfirmasi user)
| # | Topik | Resolusi |
|---|---|---|
| 1 | Order Inquiry | = pencarian order oleh admin di `/admin/orders` (sudah ada, §4.A). Inquiry publik by kode+email **tidak diperlukan**. |
| 2 | Cancel manual order | **Tidak diperlukan.** Tidak ada endpoint/tombol cancel (intentional). Out of scope. |
| 3 | Forgot password | **Deferred (nanti saja).** Route & email reset belum ada — out of scope. |
| 4 | Halaman `/branches` (store) | ✅ **Berfungsi** (alias tsconfig ke `packages/ui`). Diverifikasi `tsc --noEmit` = 0 error. **Bukan bug.** |
| 5 | Operating hours admin UI | Ada: `/admin/branches/[id]/edit` (BranchForm, jam per-hari). Skenario §8.D 8.7 pakai ini. |
| 6 | VA | Sengaja **QRIS-only**. Cukup verifikasi VA tidak muncul; tidak diuji. |
| 7 | Midtrans key mismatch | ⚠️ **Perlu keputusan Anda** (lihat §3 BLOCKER #1): pakai sandbox key (`SB-Mid-...`) + `IS_PRODUCTION=false` (rekomendasi) ATAU set `IS_PRODUCTION=true` (uang nyata). |
| 8 | Onboarding wajib | Sesuai harapan. `john@example.com` first login → onboarding dulu. |
| 9 | Voucher | **Skip** — out of scope (endpoint ada, tidak terpakai di checkout). |
| 10 | Onboarding gate `/` (home) | Sesuai harapan. |

→ **Tinggal 1 aksi Anda: #7 Midtrans key** (blocker payment). Sisanya resolved.