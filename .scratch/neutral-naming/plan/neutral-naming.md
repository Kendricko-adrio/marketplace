# Pembersihan nama samaran

## Approval dan koreksi scope
Pengguna menyetujui perubahan langsung, lalu menegaskan bahwa task hanya
pembersihan tulisan, **bukan perubahan database**. Koreksi terakhir ini
menggantikan bagian schema dan metadata import pada draft awal.

## Scope final
- Nama aplikasi pada AGENTS.md, README.md, dan sidebar prototype menjadi Marketplace.
- Reference operasi baru memakai SO_CREATE, SO_CANCEL, SO_INVOICE, SO_PAYMENT.
- Penanda sandbox baru memakai SANDBOX, SANDBOX_PAY, dan PPN_EVIDENCE.
- Tests/fixture operasi baru diselaraskan; fixture kompatibilitas lama tetap ada.
- Reference existing dipakai apa adanya, tanpa rewrite atau provider write.
- Tidak ada perubahan schema, migration aktif, metadata import, seeder, atau domain
  signing/hash checkout. Perubahan pihak lain di worktree tetap dipertahankan.

## Blueprint teknis
| File | Perubahan dan seam |
|---|---|
| apps/store/src/app/api/checkout/place-order/route.ts | Literal reference create baru; HTTP/provider boundary pada e2e/store/versioned-settlement-mock.spec.ts |
| apps/store/src/lib/jubelio-sales-lifecycle.ts | Default reference cancel/invoice/payment baru; public lifecycle dan ledger reads pada jubelio-sales-recovery.db.test.ts serta jubelio-sales-versioned.db.test.ts di direktori yang sama |
| apps/store/src/scripts/jubelio-sales-sandbox.ts | Penanda sandbox netral; script tidak dijalankan |
| apps/store/src/scripts/jubelio-provider3-tax-evidence.ts | Penanda evidence baru netral; script tidak dijalankan |
| apps/store/src/lib/jubelio-sales-operations.test.ts | Replay reference lama tetap verbatim melalui public recordJubelioSalesIntent |
| apps/store/src/lib/jubelio-sales-client.test.ts dan jubelio-channel-mirror.test.ts | Fixture reference baru netral, kontrak HTTP tidak berubah |
| apps/jubelio-mock/src/server.test.ts | Fixture baru netral; canary historis tetap |
| AGENTS.md dan README.md | Nama generik Marketplace |
| .scratch/admin-delivery-workflow/prototype/app/page.jsx | Copy brand saja |
| .scratch/discounts/research/discounts-coupons-promo-codes.md | Penyebutan nama aplikasi di prose menjadi marketplace |
| docs/features/jubelio-sales-orders.md dan docs/api-reference.md | Format reference baru dan batas kompatibilitas |

Tidak ada export, function signature, layer, endpoint, environment, atau dependency
baru. Existing success/error logging tetap dipertahankan. Perubahan ini hanya
literal internal; tidak mengubah API library/framework.

## Blueprint UX
Referensi: prototype existing. Sidebar brand memakai Marketplace, tanpa perubahan
layout, tokens, komponen, interaksi, atau states. Font brand disesuaikan ke 24px
(ukuran existing prototype) hanya agar copy baru tidak terpotong. Label diperiksa
pada desktop dan viewport sempit yang didukung. UI store/admin production tidak berubah.

## Kompatibilitas dan pengecualian
Nama lama tetap ada pada metadata workbook yang terikat CHECK existing, domain
kriptografi checkout, tests kompatibilitas/anti-branding, historical migrations,
Git/session history, serta evidence historis termasuk nama produk provider.
Nol hasil pencarian tidak menjadi target karena akan mengubah kontrak/data lama.

## Context7 checkpoint
- /drizzle-team/drizzle-orm-docs: check/getTableConfig/PgDialect dan generate
  dikonfirmasi saat investigasi awal. Perubahan schema kemudian dibatalkan.
- /vitest-dev/vitest: it.each, toBe, dan CLI file filter dikonfirmasi.
- /microsoft/playwright: string matching dan CLI path/grep dikonfirmasi.
- Perubahan produksi final hanya literal string; tidak memakai API eksternal baru.

## Pembatalan scope database
Eksperimen menghasilkan migration yang ikut mengambil draft_configuration dari
pekerjaan lain. Tidak pernah diterapkan. Output generator utuh dipindahkan keluar
jalur migration ke /tmp/marketplace-unapplied-migration.nLZpl5 agar audit tidak
hilang, tetapi tidak ikut rilis. Schema prices, journal, metadata import, dan
seluruh perubahan seeder dari task ini dikembalikan; perubahan user tetap utuh.

## Verifikasi
Bukti dan keterbatasan dicatat di [laporan](../research/verification.md).
