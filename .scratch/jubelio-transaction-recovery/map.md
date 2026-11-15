# Recovery Transaksi Jubelio dan Tindak Lanjut Terpadu

Label: wayfinder:map

## Tujuan

Menyelesaikan keputusan produk, authorization, safety, dan UX yang diperlukan untuk mengubah [research recovery transaksi admin](../../plan/research/jubelio-transaction-recovery-admin.md) menjadi spec lengkap yang dapat direview dan diajukan untuk approval terpisah. Spec harus menjelaskan pengalaman tindak lanjut pesanan yang lebih sederhana serta recovery berbasis bukti untuk Sales Order, invoice, payment, cancel, dan kegagalan penyimpanan lokal terkait pada pickup maupun delivery.

Dokumen ini adalah peta keputusan, bukan implementation plan atau antrean build tickets. Menyelesaikan map tidak membuat conceptual plan menjadi Ready dan tidak mengizinkan perubahan aplikasi.

## Catatan

### Framing yang disepakati pengguna

Disepakati saat charting pada 2026-10-13:

- Tujuan: spec lengkap yang siap diajukan untuk approval terpisah, bukan langsung implementasi.
- Scope: recovery sales transactions dan satu area tindak lanjut untuk pickup maupun delivery, termasuk repair lokal. Prosedur packing/booking/tracking existing dipertahankan; recovery Shipment tidak didesain ulang.
- Operator recovery saat ini: HQ. Hak recovery harus dapat diberikan melalui RBAC kepada custom Role di masa depan; kelayakan tidak boleh di-hardcode berdasarkan nama/key Role `hq`.
- HQ-only berlaku untuk tindakan recovery sales, bukan seluruh workspace tindak lanjut. Staff cabang tetap memiliki tindak lanjut operasional sesuai scope tanpa otomatis mendapatkan hak recovery sales. Visibility kasus sales, akses detail diagnostik, bentuk permission, dan scope tindakan cabang tetap menjadi keputusan child tickets.
- Model System Owner dan Current Policy existing tidak boleh dilemahkan diam-diam. Grant recovery tidak otomatis memberikan hak pickup/packing/handoff/booking fisik atau melewati batas Home Branch existing.
- Lokasi: [Local Markdown tracker](../../docs/agents/issue-tracker.md) existing, di `.scratch/jubelio-transaction-recovery/`.
- Kesembilan pertanyaan decision ticket, jenis ticket, dan dependencies lengkap sudah ditampilkan bersama. Pengguna secara eksplisit memilih **Setujui & publikasikan (Recommended)** sebelum publikasi.
- Seluruh child tickets dimulai dengan status `open`; charting tidak menyelesaikan ticket apa pun. Approval mencakup struktur decision map, bukan jawabannya, spec implementasi lengkap, atau breakdown build tickets.
- Approval ini tidak mengizinkan delegation, provider requests, perubahan aplikasi, commit, publikasi remote, atau deployment.

### Sumber dan istilah

- Bukti awal: [research note](../../plan/research/jubelio-transaction-recovery-admin.md). Rekomendasi dan contoh flow di dalamnya tetap berupa proposal sampai diputuskan pengguna atau dibuktikan oleh sumber primer.
- Snapshot: HEAD repo `1017d26` beserta perubahan working tree yang diperiksa. Pekerjaan checkout/stock lain yang sudah ada tidak diubah. Periksa kembali file terkait sebelum mengandalkan temuan berbasis line number pada sesi berikutnya.
- Flow existing: [dokumentasi sales lifecycle](../../docs/features/jubelio-sales-orders.md), [delivery follow-up](../../docs/features/delivery-follow-up.md), [delivery tracking](../../docs/features/delivery-tracking.md), dan [guided delivery workflow](../../docs/features/admin-delivery-workflow.md).
- Authorization: [dokumentasi RBAC](../../docs/features/rbac.md), [permission catalog](../../packages/db/src/rbac/catalog.ts), [schema grant](../../packages/db/src/schema/rbac.ts), dan [glosarium administrasi](../../CONTEXT.md).
- Batas domain: pembayaran pelanggan di Midtrans berbeda dari pencatatan payment di Jubelio; visibility Branch Scope berbeda dari kelayakan tindakan fisik Home Branch; verifikasi GET berbeda dari melanjutkan operasi pertama kali dan attempt retry baru.
- Jaminan existing adalah batasan, bukan alasan untuk melemahkan verifikasi: pertahankan pembayaran pelanggan yang authoritative, verifikasi snapshot nilai barang, pemeriksaan identitas provider, bukti operasi yang durable, dan larangan blind replay untuk write yang mungkin sudah diterapkan.
- [Research lookup Shipment sebelumnya](../../plan/research/jubelio-booking-unknown-get-lookup.md) belum membuktikan discovery hanya berdasarkan reference, adoption otomatis, atau jaminan hasil negatif yang final. Jangan mengasumsikan API Shipment terpisah menggunakan kontrak Omnichannel yang sama.

### Disiplin setiap sesi

- Load [development-workflow](../../.agents/skills/development-workflow/SKILL.md), `wayfinder`, skill `grilling` yang sebenarnya, dan `domain-modeling` sebelum mengerjakan decision ticket. Ikuti instruksi global untuk membaca skill grilling dan gunakan `ask_user_question` dalam rounds yang mengikuti dependencies.
- Temukan child tickets dengan memeriksa `issues/`. Jangan membuat daftar duplikat open tickets di map ini. Baris `Blocked by:` pada child tickets menentukan dependencies.
- Ticket pada frontier memiliki `Status: open`, belum diklaim, dan seluruh prasyarat berstatus `Status: resolved`. Pilih ticket frontier pertama sesuai urutan tracker kecuali pengguna memilih ticket lain.
- Claim ticket (`open` -> `claimed`) sebelum bekerja. Selesaikan maksimal satu ticket non-research per sesi. Charting sendiri tidak menyelesaikan child ticket.
- Keputusan milik pengguna harus dijawab pengguna; jangan menyelesaikannya berdasarkan rekomendasi research atau self-review orchestrator. Fakta yang tersedia dalam code/docs adalah tanggung jawab agent.
- Catat jawaban lengkap pada bagian `## Answer` (Jawaban) di ticket; set status `resolved`, lalu tambahkan hanya ringkasan satu baris dengan named link ke bagian Keputusan sejauh ini. Detail keputusan memiliki satu sumber utama.
- Load `research` untuk Bukti Keamanan Retry dari Provider. Batasnya adalah dokumentasi primer publik dan catatan lokal existing, bukan authenticated tenant requests atau transaction writes. Jangan otomatis meluncurkan research subagent; delegation memerlukan izin eksplisit terpisah.
- Load `prototype` dan `frontend-design` untuk Wireframe dan Pesan pada Detail Recovery. Batas prototype yang disetujui hanya Markdown wireframes: tanpa executable prototype, perubahan aplikasi, pembuatan branch, atau commit otomatis.
- Temuan code tetap berupa bukti statis sampai direproduksi. Pekerjaan reproduksi bug/test berikutnya harus load `systematic-debugging` dan `tdd`; label research/prototype saja tidak mengizinkan testing.
- Tambahkan decision tickets baru hanya melalui approval dan publication gate yang disepakati. Jangan diam-diam mengubah scope extension menjadi implementation task atau eksperimen provider.
- Setelah tujuan map tercapai, buat spec lengkap yang dapat direview dan dapatkan approval terpisah sebelum Ready/implementasi. Publikasi breakdown implementasi lintas sesi membutuhkan approval lagi. [plan/index.md](../../plan/index.md) tetap menjadi sumber status conceptual plan; map ini bukan lifecycle plan kedua.
- Seluruh dokumen baru mengikuti bahasa Indonesia sesuai `AGENTS.md`, termasuk research asset, wireframes, spec, dan jawaban tickets. Pertahankan identifier, paths, links, dan metadata tracker yang machine-readable.

## Keputusan sejauh ini

Belum ada child ticket yang diselesaikan. Batas charting yang disepakati pengguna dicatat pada Catatan; batas tersebut bukan jawaban child tickets.

## Belum dispesifikasikan

- Investigasi tambahan yang baru diperlukan ketika batas recovery pilihan pengguna menunjukkan kekurangan bukti tertentu. Pertanyaan kontrak provider saat ini sudah berada di research ticket; jangan diduplikasi di sini.
- Kemungkinan recovery komersial atau teknis lanjutan yang muncul dari keputusan eskalasi. Jika melewati scope yang disepakati, ajukan perubahan scope; jangan dianggap sebagai izin implisit.
- Skenario exception untuk pengguna yang baru dapat dirumuskan secara konkret setelah kontrak tindakan dan koordinasi dipilih.

## Di luar scope

- Implementasi aplikasi/schema/config/deployment; build tickets; eksekusi otomatis; commit, push, publikasi remote, SSH, atau deployment.
- Kebijakan recovery Shipment baru, discovery berdasarkan reference, shipment adoption, replacement booking, atau perubahan kontrak proof-approved booking release dan tracking existing.
- Flow charge/re-charge/refund pelanggan melalui admin, kontrol verifikasi Midtrans langsung yang baru, atau tindakan force-paid/force-verified/force-ready.
- Kontrol recovery Status Channel mirror baru; kegagalan mirror-only secara default tetap di luar desain recovery sales yang mendesak.
- Menghidupkan kembali checkout rejected/expired secara otomatis, membuat ulang SO/invoice/payment setelah write ambigu, atau mengubah accounting settlement barang/PPN/ongkir.
- Perubahan kewenangan fulfillment fisik, service/destination checkout yang immutable, assignment staff, kompensasi komersial, integrasi komunikasi pelanggan, atau kebijakan SLA.
- Investigasi provider yang authenticated, authentication POST, live transaction tests, atau mutasi provider saat charting. Pekerjaan tersebut di sesi berikutnya tetap memerlukan authorization sesuai aturan repo.
