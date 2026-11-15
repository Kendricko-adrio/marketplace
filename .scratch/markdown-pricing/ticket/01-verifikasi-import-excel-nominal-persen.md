# Verifikasi: Import Excel nominal dan persen

Bukti implementasi untuk
[spec](../plan/import-excel-nominal-persen.md). Tidak ada commit, push, remote
akses, atau deployment; worktree berbagi perubahan sesi lain dan tidak diacak.

## Scope yang berubah

- `apps/admin/src/lib/price-workbook.ts` — marker `markdown_v2`, header `input_type`,
  Text style kolom SKU (`xl/styles.xml` + `<col style="1">`), dua contoh dummy,
  validasi mode/persen, writer mempertahankan tipe dan raw input.
- `apps/admin/src/lib/price-changes-administration.ts` — staging persen workbook
  memakai `computePercentTarget` (freeze di stage), error per baris
  (`VARIANT_NOT_FOUND`, code `MarkdownPriceError`), metadata preview
  `inputType/inputTypeRaw/inputValueRaw`, fingerprint memasukkan mode, laporan
  mempertahankan `input_type` + raw, audit stage mencatat input workbook,
  import `createModuleLogger` (`price-workbook-staging`) untuk info/error
  (record tanpa payload workbook; error allowlisted name/message/code).
- `apps/admin/src/app/admin/products/harga/price-change-shared.ts` — tipe preview
  frontend menambah metadata optional.
- `apps/admin/src/app/admin/products/harga/price-change-excel-client.tsx` — note
  contoh, `inputLabel`, kolom Input di review, bantuan per resultCode, copy
  Format file markdown_v2 + action + basis source.
- Test: `price-workbook.test.ts`, `price-workbook-administration.db.test.ts`,
  `price-changes-administration.db.test.ts`, `e2e/admin/price-change-excel-mock.spec.ts`,
  `e2e/admin/price-change-prototype-mock.spec.ts` (marker v2; spec filter sudah
  dimodifikasi sesi lain, hanya dua assertion marker v1→v2 yang disentuh).
- Docs: `docs/features/markdown-pricing.md` (§4.1 + subbab contoh nominal/persen),
  `docs/api-reference.md` (upload/template/report).

## Verification ladder (perintah aktual, log di `/tmp`)

| Level | Perintah | Hasil |
|---|---|---|
| RED codec | `verify:unit:slice -- apps/admin/src/lib/price-workbook.test.ts` | 2 failed → dipacu implementasi |
| GREEN codec | idem | **32 passed** |
| RED codec persen (it.each 8 kasus + restore/round-trip) | idem | 9 failed → implementasi |
| GREEN codec final | idem | **32 passed** |
| RED DB staged persen | `DATABASE_URL=<disposable> verify:unit:slice -- price-workbook-administration.db.test.ts` | CHECK violation (target null) → red |
| GREEN workbook DB + administration DB | serial, disposable DB | **45 passed** lalu **81 passed** (3 file) |
| Manual helper percent freeze | administration DB slice | **36 passed** |
| Round-trip & retry persen | workbook codec + DB | **45 passed** |
| L2 batch unit | `DATABASE_URL=<disposable> npm run verify:batch:unit` | 1940 passed / 12 skipped / **3 failed — `apps/store/src/lib/versioned-pricing.test.ts` provider3 `providerTax`** |
| Mock E2E harga | `verify:batch:e2e -- price-change-excel-mock price-change-prototype-mock` | run 1: 7 passed + 2 failed (tabel review kosong; combobox filter belum berubah) lalu 5 not-run; **run ulang penuh: 14/14 passed** |
| L0 types final | `npm run verify:types:admin` | **PASS** tanpa error setelah semua perubahan |
| Sibling unit saat final | `verify:unit:slice -- apps/store/src/lib/versioned-pricing.test.ts` | **100 passed** (keadaan terakhir sesi checkout stabil) |
| Log structured | output slice | `info` stage sukses dan `error` DENIED dengan record allowlisted terlihat |

Catatan dua blocker yang **bukan** file plan ini: `packages/db/src/discount-pricing.ts`
(`PricingSnapshotPayloadProviderV3` butuh `providerTax`) dan unit
`apps/store/src/lib/versioned-pricing.test.ts` kontrak provider3. Keduanya milik
worktree sesi lain (checkout/pajak Jubelio) yang aktif selama implementasi ini;
saya tidak mengubah atau mererun berulang area itu. Pada akhir implementasi,
tipe admin **PASS** dan file test sibling tersebut **100/100 pass**, sehingga
kegagalan batch unit sebelumnya bersifat sementara; jalankan kembali
`verify:batch:unit` penuh saat sesi checkout itu benar-benar idle sebelum commit.

## Verifikasi spreadsheet dan browser

- Template v2 diekstrak ke `playwright/mcp/excel-percent/template.xlsx`, dibuka
  via LibreOffice headless + Python UNO: format kolom A terbaca `@` (Text) pada
  A3/A4/A100, C (nilai) tetap `General`; mengetik `00123` pada A100 via UNO
  EnterString menghasilkan sel type TEXT bernilai `00123`; disimpan kembali
  `roundtrip.xlsx` dan parser membaca SKU `00123` — bukti leading zero aman.
  Pembacaan format menggunakan `NumberFormats.getByKey(...).FormatString` via API
  UNO resmi, bukan klaim Excel desktop; Excel/LibreOffice GUI tidak diverifikasi.
- Render manual Playwright headless pada admin manual (`localhost:3111`,
  database disposable): reference halaman Harga, Import desktop dan mobile 390px,
  review berisi `10% dari source` + `Rp 270.000`, contoh tertinggal gagal
  dengan bantuan pemulihan; `scrollWidth` ≤ viewport di desktop 1440 dan mobile
  390; disclosure Format file dibuka via keyboard (focus + Enter). Screenshot:
  `playwright/mcp/excel-percent/{import,review}-{desktop,mobile}.png`,
  `reference-desktop.png`, teks status `review-states.json`.
- E2E mock (server nyata + DB disposable) mengunci perilaku user-visible: template
  v2 + contoh, review `10% dari source`/`Rp 270.000`, apply parsial, laporan/subset
  gagal, koreksi tertaut, replay 409, workbook fatal, tanpa grant ditolak.

## Keputusan di luar percakapan yang tetap mengikuti spec

Nilai persen disimpan apa adanya pada metadata (`inputValueRaw`/`inputTypeRaw`);
`PERCENT_INVALID` dipakai untuk persen tidak sah (0, ≥100, format, bukan tipe);
persis dua identifier contoh dilindungi; laporan memakai `new_price` berisi raw
input, bukan target Rupiah; audit stage menambah `workbookInputType`,
`workbookInputTypeRaw`, `workbookInputValueRaw`. Error staging workbook dilog
module-scope, bukan parameter.

## Sisa

- Verifikasi GUI Excel desktop (Excel/LibreOffice klik manual) tidak dijalankan;
  bukti memakai UNO/validator dan round-trip parser.
- `verify:types:admin` dan `verify:batch:unit` penuh menunggu area sesi lain
  stabil; jalankan ulang saat pekerjaan provider3 selesai.
- Legacy `npm run test:e2e` tidak berjalan (butuh izin terpisah).