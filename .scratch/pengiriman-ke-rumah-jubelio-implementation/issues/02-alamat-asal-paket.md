# 02 — Alamat delivery dan data asal/paket

Type: task
Status: Done — main reviewed address book, local branch origin, per-SKU master sync, IT fallback/packaging and fail-closed parcel integration. Migrations 0026–0028 generated/reviewed/applied via db:push; db:check passed. Full unit serial: 99 files, 902 passed, 2 skipped; isolated DB-backed tests pass. Mock-only E2E 8/8 (addresses 4, branch origin 2, pickup regression 2), including account navigation. Store/admin typechecks pass; focused store/admin lint has no errors (2 preexisting admin warnings). Parallel unit run exposed unrelated shared RBAC actor fixture race; isolated failing suite and complete serial suite pass. No live provider writes or operational activation.
Blocked by: none
Parent: [map implementasi](../map.md)
Spec: [Approved Ready spec](../approved-spec.md)

## Hasil yang harus bekerja

Client dapat membuat, melihat, memilih satu default, mengedit, dan menghapus alamat miliknya dengan nama/telepon penerima, jalan dan hierarki wilayah **Jubelio Shipment** (ID string, relasi area–kode pos diverifikasi server). Klien lain tidak dapat mengaksesnya. Sediakan sumber data asal kirim cabang yang tidak ditimpa sync Jubelio serta berat/dimensi per SKU dari master dengan fallback toko yang dikelola IT; nilai tidak valid tidak dikirim ke Shipment. Pemilik menjamin data sebelum aktivasi: jangan menambah produk/UX khusus untuk mengisi kekurangan data master. Sediakan representasi parcel `weight` total per kuantitas + kemasan dan `items[]` tanpa menciptakan kardus virtual; belum ada booking.

## Acceptance / verify

- Browser/HTTP address book: create, edit, delete, default dan penolakan akses client lain; set-default paralel DB menghasilkan maksimum satu default per client.
- Adapter/fixture multi-SKU × kuantitas menghasilkan berat dan `items[]` yang tepat; asal dan nilai tidak valid fail-closed. Tidak memakai ID wilayah Omnichannel.
- Jalankan unit, DB-backed concurrency, dan E2E UI relevan setelah red; perbarui schema hanya di `packages/db/src/schema/`, seed, dokumentasi API/fitur, serta deployment/env bila berubah.

## Batas

Snapshot alamat order dipakai dan diuji end-to-end di tiket 04. Tanpa quote, payment, atau booking pada tiket ini. Ikuti [approved spec](../approved-spec.md).
