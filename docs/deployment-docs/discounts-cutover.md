# Cutover, rollout, dan rollback diskon (Markdown/Coupon/Manual Promo Code)

Dokumen operasional untuk mengaktifkan fitur diskon (Markdown manual, Coupon
publik, Manual Promo Code, subsidi ongkir) di staging/production. Ini **bukan
izin deployment**: setiap langkah di bawah hanya boleh dijalankan operator pada
jendela maintenance yang disetujui, dengan backup verified. Baca juga
[deploy.md](deploy.md), [operations.md](operations.md),
[rbac-rollout.md](rbac-rollout.md) dan
[`docs/features/versioned-checkout-pricing.md`](../features/versioned-checkout-pricing.md).

## 1. Prasyarat yang wajib terbukti sebelum gate dibuka

- Migration additive sudah diterapkan lewat container `migrate`
  (`npx drizzle-kit migrate`) pada database yang sudah di-backup. Jangan
  memakai `db:push`/`db:seed` di staging/production nyata.
- Image store, admin, sweep/cron, mirror channel dan stock-sync berasal dari
  commit yang sama (paired) dan seluruh reader mengenal pricing version1 /
  Sales version2.
- Preflight data: tidak ada usage legacy nyata yang belum diputus. Route
  legacy `POST /api/vouchers/validate`, helper `lib/vouchers`, fixture seed
  voucher, dokumentasi dan test E2E-nya sudah **dihapus** (hasil404); flow
  checkout baru hanya memakai preview/place + `/api/discounts/available`.
  Tabel `voucher` dan kolom `orders.voucher_id` dibiarkan inert (tidak ada
  writer/reader/seed) sampai keputusan migrasi destruktif terpisah.
- Kapasitas/budget/per-client limit Offer dan canonical Manual Promo Code sudah
  diperiksa bentroknya sebelum publish; jangan memfabrikasi opening balance atau
  backfill usage pribadi.
- Gate `discounts.contractVersion` masih `0`. Nilai `0`/baris absen = nonaktif;
  nilai tak dikenal = gagal tertutup (503), bukan fallback legacy.

## 2. Perilaku konfigurasi (SQL + refresh)

| Key | Dibaca | Efek perubahan | Refresh |
|---|---|---|---|
| `discounts.contractVersion` | **Uncached** setiap request writer (store preview/place, admin publish/apply) | `0` menahan semua mutasi/pricing baru; `1` membuka kontrak baru | Langsung pada request berikutnya; tidak perlu restart |
| `checkout.paused` | Config cache proses (`getConfigString`) | `true` menahan **order baru** selama cutover; callback/reconciliation in-flight tetap jalan | Perlu restart/redeploy proses store (atau tunggu proses baru) |
| `discount.import.maxRows` / `maxFileBytes` / `maxExpandedBytes` | Config reader admin | Batas import/Excel (default 1000 / 5 MiB / 25 MiB) | Ikut cache config admin; restart proses admin setelah diubah |
| `tax.ppnRatePercent` | Config cache | Tarif PPN snapshot baru | Restart proses store/admin; order lama tetap memakai snapshot |

Contoh membuka gate setelah seluruh prasyarat terbukti (jalankan sebagai SQL
terhadap database target, bukan `db:seed`):

```sql
-- Pratinjau
SELECT key, value, type FROM system_config WHERE key = 'discounts.contractVersion';
-- Buka kontrak baru (paired deployment sudah aktif)
UPDATE system_config SET value = '1', type = 'number' WHERE key = 'discounts.contractVersion';
-- Kembalikan ke nonaktif bila perlu menahan mutasi baru
UPDATE system_config SET value = '0', type = 'number' WHERE key = 'discounts.contractVersion';
```

`checkout.contractVersion` yang hilang tidak pernah dianggap `1`. Jangan
menjalankan `db:seed` pada data nyata sebagai cara memberi grant/migrasi.

## 3. Trusted IP dan batas request (verifikasi runtime, bukan fixture)

- Store dan admin hanya di-`expose` di network Compose; port 3000/3001 **tidak**
  dipublish. Satu-satunya jalur masuk adalah Caddy yang menimpa
  `X-Real-IP` dan `X-Forwarded-For` dengan `remote_host`
  (`deployment/{staging,production}/caddy/Caddyfile`).
- Karena topologi itu, `deployment/{staging,production}/docker-compose.yml`
  meng-set `CHECKOUT_TRUST_PROXY: "true"` pada service store. Tanpa flag ini
  admission checkout gagal tertutup (`503 POLICY_UNAVAILABLE`) di production.
  Jangan menyalakan flag pada proses yang dapat diakses langsung dari internet.
- Verifikasi setelah deploy (bukan hanya unit test): dari mesin luar, panggil
  `POST /api/checkout/preview` berulang dan pastikan `429 RATE_LIMITED` +
  `Retry-After` muncul pada batas yang benar, sedangkan header
  `X-Forwarded-For`/`X-Real-IP` kiriman browser tidak mengubah bucket. Cek juga
  log container: tidak ada `trusted proxy`/`POLICY_UNAVAILABLE` yang tak
  terduga.
- Batas body checkout (256 KiB) ditegakkan aplikasi dengan pembacaan streaming
  (`apps/store/src/lib/checkout-input.ts`) → `413 INPUT_LIMIT_EXCEEDED`.
  Caddy tidak dikonfigurasi `request_body max_size`, jadi app adalah otoritas;
  jangan menambah limit proxy yang lebih kecil tanpa menguji ulang respons 413.
- Batas import Excel/price-change ditegakkan route admin (baris/ukuran file/
  ukuran hasil ekspansi) dengan nilai `system_config` di atas; ukur ulang setelah
  perubahan proxy/parser.

## 4. Urutan rollout

1. Backup database + catat manifest image/commit (store, admin, migrate).
2. Maintenance: set `checkout.paused=true` (restart store) **sebelum** menutup
   lalu lintas order baru; in-flight callback tetap diterima.
3. Jalankan migration additive lewat container `migrate`. Jangan mengedit atau
   menghapus SQL generated di `packages/db/drizzle/`.
4. Deploy paired store/admin + proses sweep/mirror/stock-sync. Gate tetap `0`.
   Pada gate `0`, admin tidak dapat mempublish target dan checkout baru menjawab
   `UNSUPPORTED_VERSION`/`DISCOUNTS_INACTIVE` (fail closed, tanpa fallback
   subtotal browser).
5. Smoke test read-only: katalog/detail/cart/preview menampilkan Markdown dari
   proyeksi yang sama; admin draft/review/publish menolak dengan gate `0`.
6. Import config eksplisit (SQL di atas, grant RBAC current, tanpa seed),
   lalu set `discounts.contractVersion=1`.
7. Smoke gate `1`: preview/place pickup dan delivery, Markdown + satu Offer
   (fixed/percentage/shipping), Manual Promo Code, tanpa service fee, PPN atas
   net barang, nominal/quote/payable provider sesuai snapshot.
8. UAT staging pemilik/tester (checklist §6), lalu buka `checkout.paused=false`
   dan pantau outcome log terstruktur (capacity conflict, provider mismatch,
   pending/review age, batch gagal, unknown version).
9. Rilis publik hanya setelah acceptance/sign-off dan izin operasi terpisah.

## 5. Rollback dan forward-fix

- Sebelum ada order versi baru: rollback ke pasangan image/schema sebelumnya
  yang kompatibel boleh dilakukan (gate tetap `0`), lewat rehearsal yang sudah
  terbukti. Jangan down-migrate buta atau menghapus generated SQL.
- Sesudah ada order/snapshot versi baru: **jangan** menjalankan aplikasi lama
  yang tidak mengenal versi tersebut untuk memproses order itu. Pause order baru
  dan admin writes, pertahankan reader/reconciliation versi kompatibel untuk
  in-flight order, lalu gunakan forward-fix atau image sebelumnya yang
  kompatibel.
- Restore backup lokal **tidak** membatalkan write provider (Jubelio/Midtrans/
  Shipment); rekonsiliasi provider diperlukan sebelum menyatakan rollback aman.
- Untuk satu Offer bermasalah: pause Offer (pemakaian baru berhenti; hold dan
  snapshot lama tetap). Jangan mass cancel/reprice/force-release. Jika dampak
  belum jelas, tahan flow yang belum aman memakai `checkout.paused`.
- Evidence (snapshot order, audit, usage projection, event Redemption) harus
  tetap utuh selama rollback; jangan menghapus baris histori.

## 6. Checklist UAT staging (pemilik/tester)

- [ ] Markdown tampil konsisten di katalog/detail/cart/checkout/admin dan order
      lama tidak berubah setelah target diubah/di-restore.
- [ ] Pickup dan delivery: breakdown subtotal setelah Markdown, diskon promo,
      PPN net barang, ongkir original/subsidi/net, total; tidak ada service fee.
- [ ] Fixed/percentage (cap dan tanpa cap)/shipping × publik/manual, qty>1 dan
      multi-line: nominal dan alokasi per baris sesuai literatur independen.
- [ ] Manual Promo Code: kode invalid/tidak aktif tidak mengganti pilihan lama;
      viewer hanya melihat label masked; limit akun/IP bekerja.
- [ ] Konfirmasi total naik, Lanjut tanpa promo, pause/invalidation, dan replay
      request yang sama menghasilkan satu order.
- [ ] Admin: draft/review/publish/pause/history/usage, pemisahan privacy
      (Orders scope), partial Excel/import dan resume yang jujur.
- [ ] Provider: payload SO memakai harga source + whole-line `disc_amount`,
      mirror channel pre/post invoice/payment sesuai, tanpa re-POST saat
      ambiguity.
- [ ] Safe pause: order baru tertahan, hold/snapshot lama tidak dibatalkan.

Hasil UAT (pass/fail/blocked + bukti aman) dicatat pada evidence register rilis;
UAT yang belum tersedia **bukan** pass. Cleanup sandbox lama bukan launch blocker.
