# 05 — Packing dan booking Jubelio Shipment

Type: task
Status: Done — main integrated/reviewed shipment ledger, eligibility/Home Branch/current reassignment, matching invoice/payment linkage, atomic claim across service instances, original-snapshot request, independent fee audit, and ambiguous-dispatch hold. Full serial unit 104 files, 937 passed/2 skipped; mock E2E 16/16 (including actual packing/booking UI and concurrent HTTP); both app typechecks, focused lint, db:check and diff check pass. Migration 0030 generated/applied via db:push. Main repaired worker fixtures/await signals, hardened token lifetime and transactional booking audits, removed delivery pickup step, and updated seeder/deployment/docs. No live provider writes, handoff/completion or deployment.
Blocked by: 04
Parent: [map implementasi](../map.md)
Spec: [Approved Ready spec](../approved-spec.md)

## Hasil yang harus bekerja

Admin dengan `orders:view` + Branch Scope melihat antrean; tindakan packing/booking membutuhkan `orders:edit` **dan** Home Branch = cabang order, termasuk owner. Booking hanya sesudah Midtrans paid, invoice/payment SO terverifikasi dan staf mengonfirmasi barang siap. Persist intent + snapshot `rates` sebelum POST, klaim dispatch atomik satu kali, `ref_no` = ID order, satu shipment aktif per order MVP. Jika sukses simpan shipment_id, AWB, kurir/layanan, tracking URL aman, `price` dan `price_bill` bila tersedia; bila perlu GET AWB dikenal, retry network/timeout/5xx maksimum 3 request total tanpa retry 4xx. AWB sukses tetap sukses meski detail GET gagal. Admin melihat tiga nilai biaya (`rates`/`price`/`price_bill`) dan selisih ditanggung toko tanpa menagih ulang. Timeout create tanpa AWB → status ambigu, tahan dan jangan retry POST tanpa kepastian tidak ada booking pertama.

## Acceptance / verify

- Browser/HTTP admin izin dan booking (termasuk penolakan cross-branch, unpaid dan paid-but-blocked), audit tindakan sah, tampilan AWB/harga.
- DB-backed **dua klaim paralel** → maksimal satu dispatch; mock timeout setelah POST → tidak create ulang; GET detail gagal namun AWB diketahui tetap sukses, `price_bill` kosong sampai direkonsiliasi.
- Unit adapter/payload, unit + E2E relevan, docs/API/schema/seed/deployment sesuai perubahan; main agent menjalankan red → green dan mereview semua diff.

## Batas

Belum menyamakan penerbitan AWB dengan serah-terima fisik atau delivery `completed`. Tidak ada cancel Shipment API, label otomatis, COD/asuransi opsional, atau split paket. Ikuti [approved spec](../approved-spec.md).
