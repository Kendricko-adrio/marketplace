# Menuju spec pengiriman ke rumah via Jubelio Shipment yang siap ditinjau

Label: wayfinder:map

## Destination

Semua pertanyaan yang memengaruhi draf [`pengiriman-ke-rumah-jubelio-spec.md`](../../plan/research/pengiriman-ke-rumah-jubelio-spec.md) telah dijawab dengan bukti atau keputusan pemilik, atau pemilik secara eksplisit memilih menerima ketidakpastian yang dicatat; hasilnya adalah spec lengkap yang siap **ditinjau untuk persetujuan terpisah**, bukan implementasi atau status Ready otomatis.

## Notes

- Sumber: [draf spec](../../plan/research/pengiriman-ke-rumah-jubelio-spec.md), [riset awal](../../plan/research/pengiriman-ke-rumah-jubelio.md), [transkripsi kontrak Shipment v1.8](../../docs/jubelio-api/shipment-v1.8.md), [alur Sales Order](../../docs/features/jubelio-sales-orders.md). Ikuti [development-workflow](../../.agents/skills/development-workflow/SKILL.md), `grilling` dan `domain-modeling` untuk diskusi keputusan; gunakan `research` untuk bukti luar repo hanya setelah izin delegasi bila memakai subagen.
- Pertahankan jalur Shipment yang telah dijelaskan draf, pickup tetap ada, satu cabang asal, alamat tertulis tanpa pin peta; jangan menyebut integrasi tidak layak hanya karena bukti belum ada. Pilot manual merupakan keputusan/usaha terpisah. Kebijakan nominal dan penanganan kendala MVP masuk cakupan peta.
- **Setiap request API** (termasuk GET dan auth POST) harus lebih dulu mendapat izin pemilik untuk request tersebut. Sajikan metode, endpoint, contoh body yang disanitasi, langkah, tujuan, dan risiko sebelum meminta izin. Peta/tiket bukan izin request; tidak ada izin API berkelanjutan. Tulisan dokumentasi dan inspeksi repo lokal boleh dilakukan tanpa request API.
- Jangan meluncurkan subagen riset otomatis: delegasi butuh izin eksplisit tersendiri untuk tugas/sesi ini. Jangan melakukan POST vendor, perubahan aplikasi, commit, push, akses remote, atau deployment atas dasar peta ini.
- Peta ini ada di tracker lokal `.scratch/` sesuai [konvensi tracker](../../docs/agents/issue-tracker.md), terpisah dari status plan di `plan/index.md`. Pertanyaan yang tidak dapat dibuktikan boleh ditutup hanya lewat keputusan pemilik yang eksplisit untuk menerima ketidakpastian pada spec; catat keterbatasan buktinya di tiket. Revisi lengkap spec dan persetujuan Ready tetap mengikuti gerbang proyek.

## Decisions so far

_Belum ada tiket yang diselesaikan._

## Not yet specified

- Rincian tindak lanjut yang baru dapat dirumuskan jika kontrak atau kemampuan tenant/sandbox berbeda dari transkripsi v1.8; jangan menebak bentuk keputusan sebelum bukti tersedia.

## Out of scope

- Implementasi, aktivasi produksi, dan tiket build; pilot ongkir flat/booking manual tanpa keputusan terpisah.
- Split shipment lintas cabang, COD, asuransi opsional, refund/RTO otomatis, label/manifest otomatis yang belum terbukti, pin peta, dan fitur lanjutan lain yang dikecualikan [draf spec](../../plan/research/pengiriman-ke-rumah-jubelio-spec.md).
