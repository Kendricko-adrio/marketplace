# Kasus dan Navigasi Tindak Lanjut Terpadu

Label: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 01
Parent: [Recovery Transaksi Jubelio dan Tindak Lanjut Terpadu](../map.md)

## Pertanyaan

Kasus unresolved apa yang perlu ditampilkan pada satu pengalaman tindak lanjut order, dan bagaimana pengguna menavigasinya tanpa menduplikasi order, kehilangan pekerjaan cleanup, atau menyembunyikan operasional cabang existing?

Putuskan kontrak penemuan kasus dan navigasi:

- Kasus sales pickup dan delivery: create, invoice, payment, cancel, dan accounting lokal yang belum selesai, dengan membership eksplisit berbasis bukti, bukan seluruh `processing + paid`.
- Hubungan dengan follow-up settlement/packing/booking/shipment existing serta visibility operasional cabang berdasarkan kontrak permission yang sudah diputuskan.
- Satu baris per order dengan beberapa kendala unresolved: kendala utama, visibility kendala lain, counts, dan perilaku ketika satu kendala pulih tetapi kendala lain masih ada.
- Kasus cleanup pada order lokal yang failed/expired/terminal tanpa membuka kembali fulfillment.
- Entry point, heading, filters/search, counts/pagination sesuai scope, default urutan/tanggal, dan navigasi detail/back yang mempertahankan konteks. Gunakan kembali keputusan UX existing yang sesuai; jangan meresetnya diam-diam.
- Nasib sidebar/page/URL lama Review Jubelio dan kriteria menghapus atau melakukan redirect tanpa kehilangan kasus existing.
- Kondisi menunggu/proses aktif yang normal serta error mirror-only/infrastruktur yang tidak masuk follow-up mendesak.
- Perbedaan antara menyelesaikan kasus recovery dan menyelesaikan order secara komersial/fulfillment.

## Bukti dan batasan

- [Research: overlap dan pengalaman yang disederhanakan](../../../plan/research/jubelio-transaction-recovery-admin.md#3-current-admin-surfaces-and-their-overlap).
- [Review API](../../../apps/admin/src/app/api/admin/reviews/sales-operations/route.ts), [review page](../../../apps/admin/src/app/admin/orders/reviews/page.tsx), dan [sidebar](../../../apps/admin/src/components/AdminSidebar.tsx).
- [Service follow-up](../../../apps/admin/src/lib/delivery-follow-up.ts), [route follow-up](../../../apps/admin/src/app/api/admin/orders/follow-up/route.ts), dan [halaman Orders](../../../apps/admin/src/app/admin/orders/page.tsx).
- [Aturan guided delivery UX](../../../docs/features/admin-delivery-workflow.md).
- [Permission Recovery dan Kewenangan Cabang](01-recovery-permissions-and-branch-authority.md).

Query review existing dapat memasukkan delivery normal yang sudah verified karena delivery tetap processing/paid. Limit diterapkan secara global sebelum filtering own-branch. Temuan statis ini adalah input, bukan fix yang sudah diuji saat runtime. Pertahankan prosedur operasional Shipment existing.

## Bukti penyelesaian

Catat aturan membership/exclusion dan walkthrough untuk:

- Delivery paid dan verified yang menunggu packing: bukan kasus kegagalan sales.
- Pickup paid dengan invoice/payment unresolved: ditemukan melalui workspace bersama.
- Order failed-payment dengan cancel remote unresolved: tetap menjadi kasus cleanup.
- Satu order dengan masalah invoice dan payment: satu baris, tidak hilang sebelum seluruh kendala relevan selesai.
- Staff cabang kembali dari kasus packing dan HQ kembali dari kasus sales: konteks scope/filter/page sebelumnya dipertahankan.
- Bookmark URL Review Jubelio lama: tujuan penggantinya jelas dan tidak kehilangan kasus.

Putuskan navigasi/membership, bukan keamanan mengulang POST yang hasilnya belum pasti.

## Batas pekerjaan

Baca sumber lokal dan interview pengguna; hanya dokumen planning. Load skills yang diwajibkan map, claim sebelum bekerja, dan ikuti prasyarat yang sudah resolved. Tidak ada perubahan aplikasi, implementasi query, provider requests, atau tests. Jangan menyelesaikan child ticket lain.

## Komentar

Dipublikasikan pada 2026-10-13 setelah approval eksplisit pengguna. Dependency dipasang setelah semua file child tickets dibuat; belum ada keputusan child ticket yang dijawab.
