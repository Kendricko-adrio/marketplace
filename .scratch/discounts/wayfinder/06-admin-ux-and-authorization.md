# UX Admin Diskon dan Authorization

Label: wayfinder:prototype
Type: prototype
Status: resolved
Assignee: main-agent
Blocked by: 03, 05, 04
Parent: [Wayfinder Desain Diskon](map.md)

## Question

Bagaimana admin yang berwenang mengakses adjustment harga, kupon publik/kode promo, dan bukti penggunaan, serta apa yang wajib ditampilkan pada review/konfirmasi?

Putuskan melalui **wireframe Markdown saja**: penempatan di Produk/Diskon; tabel SKU sebelum/sesudah; progress/error/retry bulk; form/revision kupon/kode; feedback satu slot; budget/pemakaian yang ditahan dibandingkan consumed; permission/authorization ceiling untuk edit harga global, pengelolaan offer/kode, dan kenaikan budget; visibilitas kode sensitif dan informasi audit.

## Referensi dan batasan

- [Research UX admin](../research/discounts-coupons-promo-codes.md#9-suggested-admin-menu-and-customer-experience).
- [Navigation yang ada](../../../apps/admin/src/components/AdminSidebar.tsx).
- [Tabel produk yang ada](../../../apps/admin/src/app/admin/products/page.tsx).
- [Batas RBAC/catalog saat ini](../../../packages/db/src/schema/rbac.ts).
- [Schema audit](../../../packages/db/src/schema/system.ts).

Memerlukan Limit Redemption, Identitas, dan Kebijakan Reservation; Kontrak Bulk Adjustment dan Partial Import; serta Perhitungan Pajak dan Subsidi Ongkir. Scope harga global tidak otomatis memberi semua staf cabang hak mengedit harga global. Periksa grants/catalog saat ini sebelum meminta pemilik memilih kewenangan staf.

## Bukti penyelesaian

Link ke wireframe Markdown yang bounded serta matriks tindakan/permission yang disetujui pemilik. Tampilkan perubahan harga tanpa pembuatan campaign, hasil Excel partial, revision/limit offer, dan komponen finansial terpisah. Pemilik harus memberikan tanggapan atas rekomendasi prototype; agent tidak memilih desain pemenang sendiri.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `prototype`, `frontend-design`, `grilling`, `domain-modeling`, dan `development-workflow`. Tidak ada prototype executable, edit app/config/schema, pembuatan branch, commit otomatis, request provider, subagent, atau penyelesaian child lain. Instruksi commit otomatis pada skill prototype tidak berlaku tanpa izin terpisah.

## Keputusan sesi — Ronde 1

Jawaban pemilik melalui `ask_user_question`; belum approval wireframe/matriks lengkap:

- Harga coret manual/bulk/Excel dan hasil import berada di Produk. Kupon publik, kode promo, serta pemakaian/budget berada di menu Diskon.
- Hak perubahan harga global dan hak kelola promo terpisah; permission re-sync Produk existing tidak otomatis memberikan keduanya. Keduanya tetap global, bukan hak edit harga per cabang.
- Teks kode manual lengkap hanya untuk pengelola promo; viewer melihat kode tersamarkan. Pembatasan berlaku pada respons API dan audit, bukan sekadar tampilan.

### Ronde 2 — kapasitas, default grants, dan bukti pemakaian

- Penetapan/kenaikan kapasitas promo memerlukan izin tambahan terpisah yang dapat didelegasikan, termasuk budget, kuota, jatah akun, dan penghapusan limit yang memperbesar kapasitas. Tidak membangun workflow approval dua orang.
- Default Role HQ memperoleh hak ubah harga global dan kelola promo; default Admin tidak. System Owner tetap full access. Ini pilihan default untuk seed baru, bukan grant otomatis kepada role existing yang sudah dikustomisasi. Default izin kapasitas belum diputuskan.
- Viewer promo melihat ringkasan consumed/hold/budget global. Daftar pemakaian dan detail order tetap mengikuti izin Orders dan scope cabang; tidak membocorkan customer/order cabang lain.

### Ronde 3 — default kapasitas dan revisi promo

- Default HQ juga mendapat izin kapasitas promo; default Admin tidak. System Owner tetap full access dan grants custom role tetap dapat dipisahkan.
- Perubahan aturan promo aktif melalui draft → review → publish eksplisit. Draft tidak mengubah aturan live atau snapshot order lama.
- Edit promo berbasis versi stale ditolak; admin memuat versi terbaru dan mereview ulang sebelum mengajukan perubahan. Tidak ada silent overwrite atau tombol force-overwrite.

### Checkpoint kesepahaman dan draft lengkap

Pemilik memilih **Sesuai, buat draft (Recommended)** melalui `ask_user_question` setelah menerima rangkuman keputusan, non-goals dan acceptance yang dapat diamati. Ini mengizinkan penyusunan draft, bukan approval dokumen lengkap atau implementasi.

Draft reviewable: [wireframe Admin Diskon dan matriks authorization](wireframe-06-admin-discounts-and-authorization.md). Memuat penempatan menu, review SKU sebelum–sesudah, partial/progress/retry Excel, draft/revision promo, preview satu slot, komponen finansial terpisah, hold/consumed, kode sensitif, audit dan matriks kewenangan/default/ceiling. Proposal tambahan yang dinyatakan eksplisit untuk review lengkap: operasi/history harga global memerlukan view Produk seluruh cabang selain grants harga; role tidak otomatis menerima view Produk ketika diberi izin harga. Belum ada physical module keys atau implementasi catalog/schema.

Status tetap claimed sampai pemilik menyetujui wireframe dan matriks lengkap. Tidak ada penulisan/eksekusi implementation tests, app/config/schema edits, provider request, subagent atau commit.

## Answer — wireframe dan matriks authorization disetujui

Pemilik menyetujui [wireframe Admin Diskon dan matriks authorization lengkap](wireframe-06-admin-discounts-and-authorization.md) melalui `ask_user_question` dengan memilih **Setuju, tutup 06 (Recommended)** setelah menerima link reviewable dan ringkasan, termasuk prasyarat view Produk seluruh cabang untuk operasi harga global. Semua keputusan Ronde 1–3 dan detail matriks menjadi kontrak planning tiket ini; tidak ada frontier keputusan tersisa.

- Produk menampung harga coret/manual/bulk/Excel, review sebelum apply, progress/hasil partial dan retry yang akurat. Diskon menampung kupon/kode, revision, pemakaian/budget dan riwayat.
- Hak perubahan harga global, kelola promo dan penetapan/kenaikan kapasitas dipisahkan. Default HQ mendapat ketiganya; default Admin tidak. Grants existing yang telah dikustomisasi tidak diubah otomatis; Authorization Ceiling/current policy tetap berlaku.
- Operasi/history harga global memerlukan view Produk seluruh cabang selain grants harga; pemberian izin harga tidak otomatis memberikan akses Produk tersebut. Stok cabang tetap scoped.
- Kode lengkap hanya untuk pengelola. Viewer melihat ringkasan penggunaan/budget global; daftar/detail order mengikuti Orders:view dan scope cabang. API/export/riwayat/audit tidak menjadi jalan bocor kode atau order lintas akses.
- Promo aktif diubah melalui draft → review → publish; stale version ditolak untuk review ulang. Order lama, hold, consumed dan riwayat tidak direset oleh revision/pause/kode baru. Komponen finansial dan satu slot ditampilkan eksplisit.
- Wireframe/matriks/walkthrough lengkap tersedia pada artefak, bukan prototype executable. Tidak menambahkan workflow approval dua orang, reset/release hold paksa, refund atau bypass provider.

Verifikasi hanya dokumen: local link checks menggunakan Node.js, paired code fences, trailing whitespace dan `git diff --check`; tidak ditemukan error. Python lokal tidak tersedia; warning Git LF/CRLF bukan kegagalan test. Tidak ada app/config/schema/seed edits, implementation tests/build/lint/typecheck, provider request, subagent atau commit. Approval bukan complete spec approval atau izin implementasi/launch. Tiket 12 kini unblocked tetapi tetap open dan dibahas pada sesi terpisah sesuai batas satu child HITL per sesi.

## Comments

Dipublikasikan setelah pemilik menyetujui scope prototype map berupa Markdown saja. Implementasi aplikasi tidak diizinkan oleh tiket ini.
