# UX Admin Diskon dan Authorization

Label: wayfinder:prototype
Type: prototype
Status: open
Assignee: none
Blocked by: 03, 05, 04
Parent: [Wayfinder Desain Diskon](../map.md)

## Question

Bagaimana admin yang berwenang mengakses adjustment harga, kupon publik/kode promo, dan bukti penggunaan, serta apa yang wajib ditampilkan pada review/konfirmasi?

Putuskan melalui **wireframe Markdown saja**: penempatan di Produk/Diskon; tabel SKU sebelum/sesudah; progress/error/retry bulk; form/revision kupon/kode; feedback satu slot; budget/pemakaian yang ditahan dibandingkan consumed; permission/authorization ceiling untuk edit harga global, pengelolaan offer/kode, dan kenaikan budget; visibilitas kode sensitif dan informasi audit.

## Referensi dan batasan

- [Research UX admin](../../../plan/research/discounts-coupons-promo-codes.md#9-suggested-admin-menu-and-customer-experience).
- [Navigation yang ada](../../../apps/admin/src/components/AdminSidebar.tsx).
- [Tabel produk yang ada](../../../apps/admin/src/app/admin/products/page.tsx).
- [Batas RBAC/catalog saat ini](../../../packages/db/src/schema/rbac.ts).
- [Schema audit](../../../packages/db/src/schema/system.ts).

Memerlukan Limit Redemption, Identitas, dan Kebijakan Reservation; Kontrak Bulk Adjustment dan Partial Import; serta Perhitungan Pajak dan Subsidi Ongkir. Scope harga global tidak otomatis memberi semua staf cabang hak mengedit harga global. Periksa grants/catalog saat ini sebelum meminta pemilik memilih kewenangan staf.

## Bukti penyelesaian

Link ke wireframe Markdown yang bounded serta matriks tindakan/permission yang disetujui pemilik. Tampilkan perubahan harga tanpa pembuatan campaign, hasil Excel partial, revision/limit offer, dan komponen finansial terpisah. Pemilik harus memberikan tanggapan atas rekomendasi prototype; agent tidak memilih desain pemenang sendiri.

## Batas pekerjaan

Claim setelah blockers selesai. Muat `prototype`, `frontend-design`, `grilling`, `domain-modeling`, dan `development-workflow`. Tidak ada prototype executable, edit app/config/schema, pembuatan branch, commit otomatis, request provider, subagent, atau penyelesaian child lain. Instruksi commit otomatis pada skill prototype tidak berlaku tanpa izin terpisah.

## Comments

Dipublikasikan setelah pemilik menyetujui scope prototype map berupa Markdown saja. Implementasi aplikasi tidak diizinkan oleh tiket ini.
