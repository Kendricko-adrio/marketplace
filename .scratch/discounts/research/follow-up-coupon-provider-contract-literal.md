# Follow-up: literal provider line di spec coupon masih kontrak provider2

Keputusan scope: **dikonfirmasi melalui sesi grilling** dengan pilihan “Perbaiki test saja (Recommended)” lalu “Sesuai (Recommended)”. Implementasi diminta dan dieksekusi pada sesi terpisah 2026-11-15 (lihat [Hasil implementasi](#hasil-implementasi-2026-11-15)); item ini tetap bukan ticket. Temuan historis di bawah tidak berarti test sudah dijalankan ulang.
Temuan diverifikasi 2026-11-15 saat menutup plan
[Ringkas dan perjelas UX checkout](../../checkout-simplification/plan/improve-checkout-copy-density.md);
item ini di luar scope plan tersebut dan sengaja tidak diperbaiki agar tidak
memperluas pekerjaan.

## Temuan (verified)

Pada DB disposable yang baru (`marketplace_discounts_test_copydensity_20261114`,
`discounts.contractVersion=1`, konfigurasi pajak ter-seed), full-run
`e2e/store/discounts-coupon-mock.spec.ts` gagal pada satu assertion:

| Hal | Nilai |
|---|---|
| Test | `Coupon publik pickup (ticket 07)` → “place order membuat satu Redemption reserved + allocation + provider line discount” |
| Assertion | `e2e/store/discounts-coupon-mock.spec.ts:651` — `amount: NET_GOODS` (125000) |
| Expected | `amount = 125000` (kontrak provider2: PPN tidak di line item) |
| Received | `amount = 138750` (= (150.000 − 25.000) × 1,11, kontrak provider3: PPN ada di line item) |
| Header spec | Baris 7 masih mendokumentasikan “PPN13750, total138750; provider line disc_amount25000/amount125000” |

Artinya perilaku **server sudah provider3** (preflight pajak memverifikasi
`jubelio.salesTaxId` + `tax.ppnRatePercent` ke master provider lalu membekukan
`providerContractVersion: 3` + `providerTax`), sedangkan literal spec masih
provider2.

## Kenapa bukan regresi plan checkout-copy-density

- Diff plan tersebut pada file ini hanya 8 baris: fixture **mock**
  `/api/discounts/available` di test pagination + dua assertion label
  (“Potongan Rp 20.000”, “Hemat total Rp 22.200”). Tidak menyentuh test/assertion
  yang gagal, dan tidak menyentuh kode pricing/provider.
- **Koreksi setelah pemeriksaan source pada sesi grilling:** assertion membaca body request Sales Order yang ditangkap server simulasi lokal melalui `/__control/requests`, bukan respons Jubelio nyata. Header spec menyatakan provider boundaries diarahkan ke loopback mock. HTTP aplikasi dan PostgreSQL testing tetap nyata; integrasi provider disimulasikan.
- Test yang diubah plan (picker + pagination) lulus: 2 passed di DB disposable
  yang sama.

## Reproduksi

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/marketplace_discounts_test_copydensity_20261114"
# gate diskon harus aktif untuk skenario ini
docker exec storefront-postgres psql -U postgres -d marketplace_discounts_test_copydensity_20261114 \
  -c "UPDATE system_config SET value='1' WHERE key='discounts.contractVersion'"
npx playwright test --config=playwright.mock.config.ts --reporter=line \
  e2e/store/discounts-coupon-mock.spec.ts
```

Catatan environment: spec ini menolak `DATABASE_URL` non-disposable. Full unit
suite juga harus dijalankan serial (`npm run verify:batch:unit`) karena DB suite
berbagi gate global `discounts.contractVersion`; pada 2026-11-15 run serial di DB
Disposable menghasilkan 2432 passed / 0 failed.

## Keputusan sesi grilling

User memilih **perbaiki test saja**, lalu mengonfirmasi rangkuman scope. Tidak perlu memilih ulang aturan pajak dan tidak perlu mengulang grilling untuk scope ini.

- Batasi perubahan pada `e2e/store/discounts-coupon-mock.spec.ts` dan catatan pendukungnya; jangan mengubah pricing, pajak, integrasi Jubelio, atau harga customer.
- Promo tetap Rp25.000: barang Rp150.000 → net sebelum pajak Rp125.000 + PPN Rp13.750 = total Rp138.750.
- Promo 10%: barang Rp150.000 → diskon Rp15.000 → net sebelum pajak Rp135.000 + PPN Rp14.850 = total Rp149.850.
- Periksa skenario terkait dalam file yang sama, termasuk promo persen publik/manual, patokan total pesanan yang dikirim ke simulasi Jubelio, data pajak tersimpan, dan komentar header. Bukan hanya mengganti assertion pertama yang gagal.
- Nilai net sebelum pajak pada data pricing tetap benar; jangan mengganti seluruh penggunaan `NET_GOODS`/`PERCENT_NET` menjadi total termasuk pajak. Bedakan field sesuai kontrak yang diperiksa.
- Expected nominal harus independen dari helper aplikasi yang diuji. Jangan menyalin aktual aplikasi agar test hijau atau menonaktifkan pemeriksaan pajak.
- Gunakan database khusus testing dan provider simulasi lokal. Tidak ada izin transaksi Jubelio/Midtrans nyata, mutasi DB kerja user, atau perubahan pengaturan pajak produksi.
- Jika ditemukan defect aplikasi atau perilaku di luar scope, hentikan perbaikan terkait dan laporkan untuk keputusan terpisah.

## Pemeriksaan source tambahan selama sesi

- Header file test menyebut provider boundaries pointed at loopback mock.
- Assertion fixed coupon di sekitar baris 651 masih memeriksa `amount: NET_GOODS`; assertion berikutnya memeriksa `grand_total` terhadap `NET_GOODS` juga.
- Assertion promo persen sekitar baris 930 dan 1033 memakai `PERCENT_NET` untuk nominal baris provider. Ini kandidat mismatch serupa yang harus diperiksa, **bukan klaim bahwa kedua test tersebut sudah direproduksi gagal**.
- Dokumentasi `docs/features/ppn.md` memuat bagian legacy yang harus dibaca bersama `docs/features/versioned-checkout-pricing.md`; jangan memakai penjelasan lama sebagai kontrak order baru tanpa mencocokkan versi.

## Evidence dan tindak lanjut

| Hal | Status | Evidence |
|---|---|---|
| Scope test-only dan batas lingkungan | Verified | Pilihan user “Perbaiki test saja (Recommended)” dan konfirmasi “Sesuai (Recommended)” |
| Koreksi klaim provider nyata | Verified (source) | Header dan pembacaan `/__control/requests` pada file test |
| Perbaikan assertion/comment | Verified | 3 assertion provider line + header spec + catatan `docs/testing/README.md`; lihat [Hasil implementasi](#hasil-implementasi-2026-11-15) |
| Verifikasi seluruh skenario terkait dalam file | Verified | RED 3 kasus (aktual 138750/149850) → GREEN 3 kasus → full file 16 passed pada DB disposable |

Langkah berikut: tidak ada. Sesuai batas scope, tidak ada perubahan pricing/pajak/integrasi Jubelio/harga customer, tidak ada transaksi provider nyata, dan tidak ada commit/push.

## Hasil implementasi (2026-11-15)

Kontrak yang dipakai sebagai sumber expected (independen dari kode test):
[`jubelio-sales-order-tax-spec.md`](../../jubelio-sales-api-switching/plan/jubelio-sales-order-tax-spec.md)
baris 132–133 (`items[].tax_amount` = pajak line; `items[].amount` = gross
whole-line − disc + line tax) dan
[`versioned-checkout-pricing.md`](../../../docs/features/versioned-checkout-pricing.md)
§12 (fixture Coupon 20000 pada 150000 → pajak 14300, line 144300, yaitu amount
inklusif PPN).

Perubahan (test-only + catatan pendukung):

- `e2e/store/discounts-coupon-mock.spec.ts` — header spec menjelaskan kontrak
  provider3; tiga assertion provider line sekarang memeriksa
  `disc_amount` (tetap 25000/15000), `tax_amount` (13750/14850), `amount`
  inklusif PPN (138750/149850), dan `grand_total` untuk ketiga kasus; kasus
  Coupon publik menambah pemeriksaan data tersimpan (`orders.discount`,
  `orders.ppn_amount`, `orders.total`, `order_item.goods_discount_amount`,
  `order_item.net_line_amount` 125000).
- `docs/testing/README.md` — ringkasan provider line diperbarui ke kontrak
  provider3.

`net_line_amount`/`PERCENT_NET` tetap net **sebelum** pajak; yang berubah hanya
field provider line yang memang inklusif PPN. Konstanta `NET_GOODS` dan
`PERCENT_NET` dihapus karena setelah koreksi nilainya diassert sebagai literal
string kolom (`"125000.00"`/`"135000.00"`), bukan sebagai amount SO.

### AC → evidence

| AC | Status | Evidence |
|---|---|---|
| AC01 Hanya spec coupon + catatan pendukung yang berubah | Verified | `git status --short` memuat `e2e/store/discounts-coupon-mock.spec.ts`, `docs/testing/README.md`, dan dokumen ini; tidak ada file pricing/pajak/provider |
| AC02 Assertion provider line memakai kontrak provider3 | Verified | RED `npx playwright test --config=playwright.mock.config.ts e2e/store/discounts-coupon-mock.spec.ts -g "…"` → `amount` expected 125000/135000 vs received 138750/149850; GREEN 3 passed setelah koreksi |
| AC03 Expected nominal independen, bukan salinan aktual | Verified | Literal berasal dari spec §4.4 (138750/149850) dan tax spec baris 132–133; `disc_amount`/`tax_amount`/`amount`/`grand_total` dihitung manual |
| AC04 Skenario terkait lain dalam file diperiksa (promo persen publik/manual, header, data pajak tersimpan) | Verified | Tiga kasus `-g "provider line discount\|percentage goods 10%\|manual × percentage"` → 3 passed; pemeriksaan `orders`/`order_item` lulus |
| AC05 Full file lulus pada DB testing terpisah | Verified | `DATABASE_URL=…marketplace_discounts_test_copydensity_20261114` → `16 passed (1.1m)`; run sebelumnya sempat gagal sekali pada test ticket 08 “Manual Promo Code: Terapkan” (di luar area yang diubah) lalu lulus saat diulang terisolasi dan pada full run berikutnya — tidak tereproduksi, tidak dianalisis lebih jauh |

Lingkungan: PostgreSQL disposable `marketplace_discounts_test_copydensity_20261114`
(gate `discounts.contractVersion` dibuka/dipulihkan fixture, `tax.ppnRatePercent`
11, `jubelio.salesTaxId` -2), Jubelio simulasi loopback `127.0.0.1:3112`. DB kerja
pengguna, provider nyata, dan konfigurasi pajak tidak disentuh. Tiga proses dev
server mock sisa sesi sebelumnya pada port 3110/3111/3112 dihentikan agar
`reuseExistingServer:false` dapat berjalan.

