// Default aktif hanya untuk database lokal/demo yang dibuat melalui seeder.
// Aktivasi staging/production tetap mengikuti runbook cutover terpisah.
export const discountContractSystemConfigSeedRows = [
  {
    key: "discounts.contractVersion",
    value: "1",
    type: "number",
    description: "Kontrak domain diskon aktif untuk database seed lokal/demo. Dibaca ulang setiap request; aktivasi staging/production mengikuti runbook cutover.",
  },
];

// Delivery seed defaults. These rows are inserted by seed.ts into system_config.
export const shipmentSystemConfigSeedRows = [
  {
    key: "shipment.parcelFallback",
    value: '{"weight":250,"length":30,"width":20,"height":10}',
    type: "json",
    description: "Default per-unit fallback parcel: 250 grams, 30 x 20 x 10 cm. Verify against actual SKU measurements before delivery activation.",
  },
  {
    key: "shipment.packagingWeightGrams",
    value: "15",
    type: "json",
    description: "Default packaging weight of 15 grams for seeded delivery quotes; verify against operational packaging before activation.",
  },
];

// Discount import/bulk price limits (ticket 04, spec §6.2). These are operational
// configuration bounds, not a measured SLA. The admin reader
// (`apps/admin/src/lib/discount-import-limits.ts`) loads them per request (never a
// boot-time cache), so an operator can change a value via SQL and the next
// stage/apply request uses it. An invalid value fails closed (503
// IMPORT_LIMITS_INVALID) instead of silently removing the bound. These rows are
// only for disposable/demo databases.
export const discountImportSystemConfigSeedRows = [
  {
    key: "discount.import.maxRows",
    value: "1000",
    type: "number",
    description:
      "Batas jumlah baris import/bulk harga Markdown per batch. Dibaca ulang setiap request; ubah via SQL dan batch committed tidak pernah dihapus.",
  },
  {
    key: "discount.import.maxFileBytes",
    value: "5242880",
    type: "number",
    description:
      "Batas ukuran file workbook harga (byte terkompresi) untuk import Markdown. Dibaca ulang setiap request; nilai invalid menolak operasi baru.",
  },
  {
    key: "discount.import.maxExpandedBytes",
    value: "26214400",
    type: "number",
    description:
      "Batas ukuran workbook harga setelah diekspansi (byte) untuk import Markdown. Dibaca ulang setiap request; nilai invalid menolak operasi baru.",
  },
];

// Identitas pajak provider untuk writer Sales kontrak3 (spec PPN §5.1).
// Nilai -2 adalah record PPN 11% pada tenant yang sudah diteliti (`GET /taxes/`
// mengembalikan tax_id -2 / rate 11.00 / tax_out 2-2103). Ini HANYA default
// database lokal/demo: aktivasi staging/production wajib memverifikasi tenant
// sendiri lewat GET master, bukan menyalin ID ini. Dibaca ulang setiap request
// dan fail closed bila hilang/invalid.
export const jubelioSalesTaxSystemConfigSeedRows = [
  {
    key: "jubelio.salesTaxId",
    value: "-2",
    type: "number",
    description:
      "Tax ID master Jubelio untuk PPN barang pada SO/invoice/payment (tenant seed: -2 = PPN 11%). Tanpa menu admin; diverifikasi GET /taxes/ setiap checkout baru dan blokir bila rate tidak sama dengan tax.ppnRatePercent.",
  },
];
