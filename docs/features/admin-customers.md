# Admin Customer Directory

## Purpose

The Customer module gives authorized admin users a read-only directory of all
storefront accounts. It separates storefront customers (`client`) from admin
staff (`user`) and must never use the admin Better Auth user table as its data
source.

## Routes

| Route | Purpose |
|---|---|
| `/admin/customers` | Direktori customer dengan pagination server-side 10 baris dan search nama/email/telepon. |
| `/admin/customers/[id]` | Shows a customer profile, summary metrics, and complete order history. |

Halaman list mengambil summary global langsung melalui database admin; tabel client
memuat satu halaman melalui `GET /api/admin/customers`. Halaman detail tetap Server
Component yang membaca database admin secara langsung. Semua entry point memakai
permission `customers:view`; direktori tetap global.

## List Data

The list includes `name`, `email`, `phone`, `birth_date`, `gender`,
`onboarding_completed`, `created_at`, and `updated_at`. It also shows an order
count for operational context. Nullable onboarding fields render as an em dash.

## Pagination, pencarian, dan konsistensi tabel

- Pola card, search, header tabel, dan footer mengikuti `/admin/branches` melalui
  shared components `packages/ui/src/components/ui/`. Header halaman dan summary
  Customer dipertahankan; aksi tunggal `Lihat detail` tetap berupa link langsung.
- API menerima `page`, `limit` (default 10, maksimum 100), dan `search`. UI meminta
  10 baris per halaman. Urutan `createdAt DESC, id DESC` membuat paging stabil
  untuk dataset tetap, termasuk timestamp yang sama.
- Search case-insensitive, substring literal, dan di-trim. `%`, `_`, dan backslash
  di-escape, bukan wildcard SQL. Predicate row dan count sama; count menghitung
  customer, bukan jumlah row hasil join order.
- Search menggunakan debounce 400 ms dan kembali ke halaman 1. Response lama
  diabaikan, termasuk selama debounce. Pagination/loading mencegah klik berulang.
- Hasil kosong tampil sebagai `Page 1 of 1`; halaman di luar rentang dikoreksi ke
  halaman valid terakhir. Tombol `Previous`/`Next` nonaktif pada batasnya.
- Summary registered/onboarded/pending/total orders memakai agregasi global,
  tidak mengikuti search atau halaman aktif. Contoh: 23 customer terdaftar tetap
  dihitung 23 ketika hanya satu hasil search yang muncul.
- State kosong `Belum ada customer.` dibedakan dari search tanpa hasil. Error
  menampilkan `Gagal memuat customer.` dan `Coba lagi` tanpa membuang input search.
  API 401/403 memicu reload navigasi agar page guard menangani sesi/izin terkini.
- Tabel lebar memakai scroll horizontal di dalam region tabel pada mobile,
  bukan memperlebar seluruh halaman. Tidak ada edit/delete customer.
- Backend: `apps/admin/src/features/customers/customer-list-repository.ts`;
  kontrak HTTP: [API reference](../api-reference.md#admin--direktori-customer).
- Coverage: repository/route unit tests dan
  `e2e/admin/customers-pagination-mock.spec.ts` (terdaftar di mock config).

## Customer Detail and Order History

The detail page shows the registration/onboarding profile, email verification
state, total order count, completed order count, and total value of paid orders.
Its order history contains the order ID, creation date, branch, item count,
total, and status. Each history row links to the existing admin order detail
route, where the normal Order-module permission and branch-scope rules still
apply.

## Access Control

`customers` is an RBAC module. HQ has implicit full access. The default seeded
Admin role has no Customer access, so the sidebar item is hidden and direct
route access redirects to the first permitted admin module. HQ can explicitly
grant access from the Hak Akses page. Migration
`0014_add_customers_permission.sql` adds the same disabled default to existing
databases without overwriting an existing Customer permission row.

The directory is global: an authorized user sees all registered storefront
customers and their full order history. The module does not provide edit or
delete operations.
