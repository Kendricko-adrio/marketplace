# Implementasi dan verifikasi — penyelarasan status, notifikasi, dan email

Tanggal: 2026-11-10. Sumber perilaku:
[spec](../plan/penyelarasan-status-notifikasi-email-spec.md).

## Lingkungan verifikasi

- PostgreSQL disposable `marketplace_discounts_test_ordercomms_1` (schema via
  `drizzle-kit push`, lalu `db:seed`). Database development pengguna **belum**
  disentuh.
- Provider (Midtrans, Jubelio, SMTP) hanya mock/loopback; tidak ada write ke
  provider nyata, tidak ada deployment/remote action, tidak ada commit.
- Context7 checkpoint: `/websites/orm_drizzle_team` (`update…returning`,
  `for('update', {skipLocked})`, `onConflictDoNothing` pada unique index,
  `drizzle-kit generate`) dan `/websites/nodemailer` (`info.accepted/rejected`,
  kode `EAUTH`/`ECONNECTION`/`ETIMEDOUT`, `connectionTimeout`/
  `greetingTimeout`/`socketTimeout`).

## Ringkasan perintah dan hasil

| Tahap | Perintah | Hasil |
|---|---|---|
| Tipe store | `npm run verify:types:store` | exit 0 |
| Tipe admin | `npm run verify:types:admin` | exit 0 |
| Tipe db | `npx tsc --noEmit -p packages/db` | exit 0 |
| L3 unit batch | `DATABASE_URL=<disposable> npm run verify:batch:unit` | 184 file, 2152 passed, 12 skipped, 0 failed |
| Mock E2E | `DATABASE_URL=<disposable> npm run verify:batch:e2e -- e2e/admin/order-notifications-mock.spec.ts e2e/store/order-communications-mock.spec.ts e2e/store/shipment-tracking-mock.spec.ts e2e/admin/delivery-follow-up-mock.spec.ts` | 12 passed |
| Wrapper cron | `bash deployment/common/cron/process-order-communications.test.sh` | PASS |
| Migration audit | `npm run db:check` | "Everything's fine" |

## AC → bukti

| AC | Status | Bukti |
|---|---|---|
| AC01 | Verified | `apps/store/src/lib/jubelio-channel-mirror.test.ts` (delivery Siap Proses derivation, 6 test), `apps/store/src/lib/jubelio-channel-mirror.delivery-sweep.db.test.ts` (target `Siap Proses` dari processing/paid + ledger terverifikasi) |
| AC02 | Verified | `jubelio-sales-settlement.test.ts` ("keeps a verified-paid DELIVERY order in processing with no pickup code"), `delivery-email-templates.test.ts` (tanpa kode/jadwal pickup) |
| AC03 | Verified | `jubelio-channel-mirror.test.ts` (blocked → `Menunggu Verifikasi`), `send-order-emails-service.db.test.ts` (gate finansial belum terverifikasi → 0 job, 0 kirim) |
| AC04 | Verified | `jubelio-channel-mirror.delivery-sweep.db.test.ts` (sweep menemukan delivery tanpa intent, target sama; blocked tidak masuk window) |
| AC05 | Verified | `jubelio-channel-mirror.db.test.ts` (Selesai dari completed; stage lama tidak menimpa Selesai), `order-communications-mock.spec.ts` (manual finish → Selesai tanpa email; DELIVERED terlambat → satu job) |
| AC06 | Verified | Regression mirror/gateway pada batch unit penuh (tidak ada re-POST buta; GET-only recovery) |
| AC07 | Verified | `order-communication-repository.db.test.ts` (satu fakta, satu job, satu notifikasi; replay; hapus notifikasi tidak membuat ulang) |
| AC08 | Verified | `e2e/admin/order-notifications-mock.spec.ts` (badge per baris, own-branch scope, live update membawa jenis) + DTO `fulfillmentMethod` dipakai list dan item real-time |
| AC09 | Verified | Mock E2E: header "Jenis Order", badge Pickup/Delivery, nilai tidak tersedia → `—`, tanpa filter jenis baru |
| AC10 | Verified | Mock E2E: `Buka order` → `/admin/orders/{id}`, pickup → `?verify=1`, hapus tetap bekerja. Baca/senyapkan/pagination tidak diubah kodenya (spec live `notifications.spec.ts` tidak dijalankan — di luar izin) |
| AC11 | Verified | `send-order-emails-service.db.test.ts` + `delivery-email-templates.test.ts` (copy tidak mengklaim barang sudah dibawa kurir) |
| AC12 | Verified | `packages/db/src/shipment-tracking.test.ts` (handoff → satu fakta `delivery_in_transit`; webhook PICKED_UP), `send-order-emails-service.db.test.ts` (job in_transit + supersede; booking saja tidak menulis fakta) |
| AC13 | Verified | Template + store DB test: tautan `BRAND_APP_URL/account/orders/{id}`, tidak pernah origin admin. Halaman order existing tidak diubah |
| AC14 | Verified | `shipment-tracking.test.ts` (DELIVERED → fakta `delivery_delivered`, replay dedupe, identitas salah/status tak dikenal tidak diterapkan) |
| AC15 | Verified | `delivery-follow-up.db.test.ts` (manual finish tetap lulus), mock E2E: penutupan manual tanpa email, DELIVERED setelahnya satu job, order tidak reopen, alasan manual utuh |
| AC16 | Verified | `send-order-emails-service.db.test.ts` (delivery ready/pickup ready/payment failed semua lewat job), jalur legacy hanya untuk order versi 0 |
| AC17 | Verified | `order-communication-policy.test.ts` + `order-communication-repository.db.test.ts` (4 attempt, jeda tepat 5 menit, sukses/permanent/exhausted berhenti) |
| AC18 | Verified | Repository DB test (claim kedua = 0, lease kedaluwarsa reclaim tetap attempt 2, token guard). Klaim paralel multi-koneksi nyata tidak dijalankan; jaminannya `FOR UPDATE SKIP LOCKED` + guard token |
| AC19 | Verified | Policy unit + `send-order-emails-service.db.test.ts` (`superseded`, zero dispatch) |
| AC20 | Verified | Store DB test (status order tetap processing/paid setelah kegagalan email), checkpoint efek, `sendEmail` auth tidak berubah |
| AC21 | Verified | `order-communication-repository.db.test.ts` (versi 0 tanpa efek), `checkout-attempt-repository.db.test.ts` (promotion → marker 1, replay tidak mengubah marker), mock E2E (order versi 0 tidak tersentuh). Marker pada insert `place-order` diverifikasi dari kode, bukan test khusus |
| AC22 | Verified | Mock E2E (`401` tanpa/salah secret, `200` + counters, tanpa PII di respons), `process-order-communications.test.sh` (URL endpoint + secret dari file env), docs deployment staging/production |
| AC23 | Verified | Render browser 1440×900 / 768×1024 / 390×844 (`playwright/mcp/order-notifications/*.png`), peer page `/admin/orders` sebagai pembanding; HTML/plain-text email diuji di unit test. Render email di browser tidak di-screenshot (batas dicatat) |
| AC24 | Verified | `npm run db:check`, migration `0057` hasil generator (tanpa edit tangan), seeder memuat baris komunikasi inert (seed disposable sukses), seluruh test memakai mock/sink |

## Catatan deviasi / temuan

1. **Migrasi `0057` juga membawa drift lama**: kolom
   `discount_offer_revision.draft_configuration` sudah ada di schema tetapi
   belum pernah masuk migrasi. Generator menuliskannya bersama perubahan fitur
   ini; SQL tidak diedit tangan. Tidak ada perubahan perilaku diskon.
2. **`renderDeliveryOrderEmail` ditaruh di `delivery-email-templates.ts`**
   bersama renderer pickup/payment-failed, bukan file terpisah — menghindari
   file tambahan di luar blueprint.
3. **Recovery proyeksi kini juga berjalan saat `orderId` diberikan**
   (settlement memanggil `projectOrderCommunications({ orderId })`): tanpa itu
   fast path tidak bisa memulihkan fakta yang gagal dicatat.
4. **Notifikasi `delivery_ready` hanya diproduksi bila fakta siap-diproses
   masih berlaku** (bukan sekadar ada event), supaya order yang sudah selesai
   tidak memunculkan notifikasi "siap diproses".
5. **Halaman notifikasi**: dua baris aksi dibuat `flex-wrap` dan header kartu
   menjadi satu kolom di bawah `lg`, karena pada 390 px halaman overflow 126 px
   dan kontrol terpotong. Perubahan hanya pada halaman ini, token/komponen
   existing tetap.
6. **Database development pengguna kini sudah memiliki schema baru**, dengan
   izin pengguna. `db:push` dihentikan karena ingin menambahkan constraint
   diskon lama (drift, bukan bagian fitur ini). Sebagai gantinya, 14 statement
   verbatim dari migration generator `0057` (tanpa dua statement drift
   `discount_offer_revision`) dijalankan dalam satu transaksi ke database
   `storefront`; database dev tidak punya order sama sekali (0 baris), jadi
   tidak ada data lama yang terpengaruh. Dua statement drift tidak diterapkan
   karena kolomnya sudah ada.
7. **Suite unit default (DATABASE_URL = database dev)** setelah schema
   diterapkan: 169 file lulus, 9 file gagal — kesembilannya adalah test lama
   yang memang menolak database non-disposable (`throw` by design:
   discount-configuration, checkout-attempt-review, discount-operations-read,
   discounts-administration, price-changes-administration,
   price-workbook-administration, discount-schema, discount-grants,
   checkout-admission). Kegagalan itu sudah ada sebelum perubahan ini; suite
   hijau penuh dijalankan dengan database disposable di atas.
