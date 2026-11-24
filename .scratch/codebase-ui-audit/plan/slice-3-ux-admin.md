# Plan & Spec: Slice 3 — Perbaikan UX Admin, Standardisasi Bahasa, Mobile Drawer & A11y

> Status plan secara keseluruhan dicatat di [index.md](../index.md). File ini mencatat spesifikasi lengkap, technical & UX blueprint, kontrak list/table, acceptance criteria, dan status per fitur untuk **Slice 3** dari rangkaian perbaikan hasil [Audit Codebase & UI/UX](../research/codebase-ui-improvement-audit.md).

## Problem Statement

Operator admin menghadapi beberapa inkonsistensi UX, masalah mobile, dan pelanggaran accessibility yang ditemukan pada audit:

1. **Sidebar Admin tidak mobile-friendly (P1-1):** Pada `< 768px`, 14 menu navigasi di `AdminSidebar.tsx` menumpuk vertikal (`flex-wrap`) di atas konten utama pada setiap halaman, serta ikon `Tag` dipakai ganda untuk *Harga SKU* dan *Diskon*.
2. **Inkonsistensi bahasa & kontrak list/table Admin (P1-2):**
   - `/admin/orders`: search memicu `router.replace()` + network fetch pada **setiap ketikan** tanpa debounce; `<select>` memakai `bg-background` bukan `--field`; error hanya `<p role="alert">` polos tanpa tombol retry; tabel tidak menampilkan indikator loading; copy campur Inggris–Indonesia (*Orders*, *Pending Payment*, *Previous*/*Next*, *Payment*, *Stock review*).
   - `/admin/products`: gagal fetch hanya `console.error` sehingga error tersamar sebagai empty state (*"Tidak ada produk ditemukan"*); `search` & `page` hanya di `useState` (hilang saat refresh/back).
   - `/admin/customers`: header dan 4 KPI card berbahasa Inggris (*Customer directory*, *Registered customers*, *Onboarding completed*, *Pending onboarding*, *Total orders*), kontras dengan tabel berbahasa Indonesia di bawahnya.
   - `/admin/discounts`: merender `<h1>Diskon</h1>` padahal `admin/layout.tsx` sudah memiliki `<h1>Admin Dashboard</h1>` (double `<h1>`).
   - `/admin/discounts/[id]`: masih memakai browser native `window.confirm(...)` saat reload versi terbaru dalam kondisi dirty, padahal shared `ConfirmDialog` sudah tersedia.
3. **Pelanggaran Accessibility & warna belum dark-mode safe (P1-3):** Nested `<Link><Button>` di `AdminSidebar.tsx`, `admin/products/page.tsx`, dan `admin/products/[id]/page.tsx`; tombol `size="icon"` tanpa `aria-label` (mis. `NotificationBell`, `admin/homepage`, `admin/notifications`, dan form homepage); serta hardcoded Tailwind colors pada `admin/orders/[id]` dan `admin/orders/reviews`.
4. **Tidak ada App Router error/not-found boundaries di Admin (P1-4):** Error runtime atau route admin tak ditemukan menampilkan layar default Next.js berbahasa Inggris.

## Solution

Slice 3 menyeragamkan pengalaman dashboard Admin agar konsisten, mobile-ready, aksesibel, dan berbahasa Indonesia:

1. Mengubah `AdminSidebar` pada mobile (`< 768px`) menjadi tombol hamburger di top bar yang membuka `Sheet` drawer samping (tutup otomatis saat navigasi), membedakan ikon *Harga SKU* vs *Diskon*, dan memperbaiki nested `<Link><Button>` menjadi `<Button asChild>`.
2. Menyeragamkan copy UI Admin ke **Bahasa Indonesia** (termasuk memperbarui selector/assertion E2E test terkait) dan melengkapi kontrak list/table:
   - `/admin/orders`: debounce search 300ms, styling select `--field`, loading state tabel, dan error banner + tombol *"Coba lagi"*.
   - `/admin/products`: URL state (`search`, `page`) + debounce 300ms, dan error UI nyata + tombol *"Coba lagi"*.
   - `/admin/customers`: terjemahkan heading & 4 KPI cards ke Bahasa Indonesia + dark-mode safe icon containers.
   - `/admin/discounts`: ubah `<h1>` → `<h2>` dan ganti `window.confirm(...)` di `discount-editor-client.tsx` dengan `ConfirmDialog`.
3. Menambahkan `aria-label` pada seluruh tombol `size="icon"` tanpa label di Admin, memperbaiki seluruh nested `<Link><Button>`, memigrasikan hardcoded colors di `admin/orders/[id]` & `admin/orders/reviews` ke semantic tokens, serta menambahkan `error.tsx`, `global-error.tsx`, dan `not-found.tsx` berbahasa Indonesia.

## User Stories

1. Sebagai operator admin di layar kecil (`< 768px`), saya ingin navigasi sidebar tersembunyi rapi di balik tombol menu hamburger di top bar dan terbuka sebagai drawer samping yang menutup otomatis setelah saya memilih menu.
2. Sebagai operator admin, saya ingin ikon menu *Harga SKU* dan *Diskon* berbeda agar cepat dibedakan saat memindai sidebar.
3. Sebagai operator admin di `/admin/orders`, saya ingin mengetik pencarian tanpa memicu request di setiap karakter (debounce 300ms), melihat status loading saat tabel memuat, mendapat tombol *"Coba lagi"* bila gagal, dan membaca seluruh label dalam Bahasa Indonesia yang konsisten.
4. Sebagai operator admin di `/admin/products`, saya ingin halaman menampilkan pesan error + tombol *"Coba lagi"* jika gagal memuat (bukan *"Tidak ada produk ditemukan"*), serta mempertahankan query pencarian dan nomor halaman di URL saat refresh atau kembali dari detail produk.
5. Sebagai operator admin di `/admin/customers`, saya ingin seluruh header dan 4 KPI card berbahasa Indonesia selaras dengan tabel *"Daftar Customer"*.
6. Sebagai operator admin di `/admin/discounts/[id]`, saya ingin konfirmasi pemuatan ulang versi terbaru saat ada perubahan belum tersimpan tampil memakai dialog aplikasi (`ConfirmDialog`), bukan popup native `window.confirm`.
7. Sebagai pengguna keyboard/screen reader di Admin, saya ingin tidak ada double `<h1>`, tidak ada nested `<a><button>`, dan seluruh tombol ikon (hapus notifikasi, aksi baris homepage/notifikasi, reorder) memiliki `aria-label` yang jelas.
8. Sebagai operator admin yang mengalami error tak terduga atau membuka URL admin yang tidak ada, saya ingin melihat layar error/404 berbahasa Indonesia dengan tombol *"Coba lagi"* atau *"Kembali ke Dashboard"*.
9. Sebagai operator admin di light maupun dark theme, saya ingin seluruh panel/badge pada `admin/orders/[id]` dan `admin/orders/reviews` tetap kontras dan konsisten dengan semantic tokens.

## Approval

- **Kesepahaman bersama dikonfirmasi user:** ✅ Dikonfirmasi melalui sesi grilling 2 ronde (2026-11-24 — keputusan Q1, Q7, Q8, Q9, Q10 terkunci).
- **Complete scope dan acceptance/verify criteria disetujui user:** ✅ Disetujui user (2026-11-25).

> Jangan menandai plan atau fitur ini `Ready` selama approval masih pending. Approval plan tidak menyetujui subagent, commit, remote access, atau deployment.

## Non-scope

- Refactor monolith `discounts-administration.ts`, `price-changes-administration.ts`, `admin/orders/[id]/page.tsx`, `price-change-client.tsx`, atau `discount-editor-client.tsx` (P2-2) — pada Slice 3 hanya menyentuh perubahan terarah (ganti `window.confirm`, migrasi semantic color, copy/a11y).
- Pembersihan 38 ESLint warning non-error di Admin (P2-4).
- Perubahan endpoint API, query SQL, atau aturan RBAC.

## Implementation Decisions

1. **Mobile `AdminSidebar` & Ikon Unik (P1-1):**
   - Memisahkan isi navigasi + footer akun menjadi komponen internal `AdminNavContent` yang dipakai oleh `<aside className="hidden md:flex ...">` (desktop) dan `<Sheet side="left">` (mobile).
   - Trigger mobile berupa `<Button variant="ghost" size="icon" className="md:hidden" aria-label="Buka menu navigasi">` yang ditempatkan di `<header>` top bar (`apps/admin/src/app/admin/layout.tsx` melalui komponen client wrapper kecil `AdminMobileMenuButton` atau menyatukan shell client bar).
   - Klik link apa pun di dalam `Sheet` memanggil `onNavigate()` yang menutup drawer.
   - Ikon sidebar: *Harga SKU* memakai `BadgeDollarSign` (atau `DollarSign`), *Diskon* memakai `Percent` (atau mempertahankan `Tag` di salah satunya — keduanya tidak lagi sama).
2. **Standardisasi Bahasa Indonesia Admin (P1-2):**
   - `/admin/orders`:
     - Heading: `Pesanan` (menggantikan `Orders`).
     - Tab jenis pesanan: `Pengiriman` (`delivery`), `Ambil di Toko` (`pickup`), `Semua` (`all`).
     - Label status order: `pending_payment` → `Menunggu Pembayaran`, `processing` → `Diproses`, `ready_for_pickup` → `Siap Diambil`, `completed` → `Selesai`, `cancelled` → `Dibatalkan`, `failed_payment` → `Pembayaran Gagal`.
     - Header kolom: `Pembayaran` (menggantikan `Payment`), `Tahap pengiriman` (menggantikan `Tahap delivery`).
     - Badge review stok: `Review stok` (menggantikan `Stock review`).
     - Pagination: `Sebelumnya` / `Berikutnya` (menggantikan `Previous` / `Next`).
     - Placeholder cari: `ID, nama customer, telepon`.
   - `/admin/customers`:
     - Eyebrow: `Direktori customer`; subtitle: `Lihat seluruh customer terdaftar di storefront dan buka riwayat pembelian mereka.`
     - 4 KPI card: `Customer terdaftar`, `Onboarding selesai`, `Menunggu onboarding`, `Total pesanan`.
   - Seluruh E2E test Admin yang mengecek teks lama (seperti `e2e/admin/orders.spec.ts`, `orders-presentation.spec.ts`, `delivery-queues.spec.ts`, `customers.spec.ts`, `customers-pagination-mock.spec.ts`, `status-colors-mock.spec.ts`) wajib diperbarui bersamaan agar tidak ada test palsu/patah.
3. **Kontrak List/Table (`/admin/orders` & `/admin/products`) (P1-2):**
   - **Referensi:** `apps/admin/src/app/admin/customers/customer-table.tsx` (URL state, feedback state, pagination, dan debounce search) + `apps/admin/src/app/admin/orders/page.tsx` (URL sync filter).
   - **`/admin/orders`:**
     - Sumber data: `GET /api/admin/orders` (server-side search, filter, dan pagination `limit=20`).
     - Search: local controlled state `searchInput` yang disinkronkan ke URL param `search` dengan **debounce 300ms** (reset `page` ke 1 saat berubah).
     - Select filter: ganti `bg-background` pada `selectClass` menjadi `bg-[var(--field)]` agar konsisten dengan kontrak kontras field form.
     - Loading state: tampilkan baris loading di `<TableBody>` saat `loading` (dengan spinner/skeleton yang terlihat).
     - Error state: tampilkan box error semantik (`rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive`) dengan tombol *"Coba lagi"* (via `retryKey` state).
   - **`/admin/products`:**
     - Sumber data: `GET /api/admin/products` (server-side pagination & search).
     - URL state: simpan `search` dan `page` pada URL `searchParams` (`useSearchParams` + `router.replace`, dibungkus `<Suspense>`), debounce search **300ms**, reset `page` ke 1 saat `search` berubah.
     - Error state: pisahkan `error` dari `products.length === 0`; tampilkan pesan *"Gagal memuat daftar produk."* + tombol *"Coba lagi"* saat fetch gagal.
4. **Heading & `ConfirmDialog` di Diskon (P1-2):**
   - `apps/admin/src/app/admin/discounts/page.tsx`: ubah `<h1>Diskon</h1>` → `<h2 className="text-2xl font-bold text-foreground">Diskon</h2>`.
   - `apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx`: ganti `window.confirm(...)` (baris 579) dengan `ConfirmDialog` dari `@marketplace/ui` memakai state `confirmReloadOpen` + judul *"Muat ulang versi terbaru?"*, deskripsi *"Perubahan yang belum disimpan akan hilang. Lanjutkan memuat versi terbaru?"*, tombol konfirmasi *"Muat ulang"*, dan tombol batal *"Batal"*.
5. **A11y, Semantic Tokens & Boundaries Admin (P1-3, P1-4):**
   - Ubah seluruh nested `<Link><Button>` menjadi `<Button asChild><Link ...>` di `AdminSidebar.tsx`, `admin/products/page.tsx`, dan `admin/products/[id]/page.tsx`.
   - Tambahkan `aria-label` deskriptif pada seluruh tombol `size="icon"` tanpa label di Admin (`NotificationBell.tsx`, `admin/homepage/page.tsx`, `admin/notifications/page.tsx`, serta `BannerSectionForm`, `CarouselProductSectionForm`, `PromoCardsSectionForm`).
   - Migrasi hardcoded Tailwind colors di `admin/customers/page.tsx`, `admin/orders/[id]/page.tsx`, dan `admin/orders/reviews/page.tsx` ke semantic tokens / `StatusBadge`.
   - Buat `apps/admin/src/app/error.tsx`, `apps/admin/src/app/global-error.tsx`, dan `apps/admin/src/app/not-found.tsx` berbahasa Indonesia dengan tombol *"Coba lagi"* dan *"Kembali ke Dashboard"* (`/admin`).

## Rancangan Teknis

### Tabel File

| Path | Aksi | Tanggung jawab (1–3 baris) | Layer | Seam test |
|---|---|---|---|---|
| `apps/admin/src/components/AdminSidebar.tsx` | modify | Pisah desktop sidebar (`hidden md:flex`) + mobile `Sheet` drawer, bedakan ikon *Harga SKU* vs *Diskon*, ubah `<Link><Button>` → `<Button asChild>`. | UI component | `e2e/admin/shell-layout.spec.ts` |
| `apps/admin/src/app/admin/layout.tsx` | modify | Pasang trigger mobile drawer di top bar `<header>` (`md:hidden`) agar terhubung ke `AdminSidebar` mobile. | UI server layout | `e2e/admin/shell-layout.spec.ts` |
| `apps/admin/src/app/admin/orders/page.tsx` | modify | Debounce search 300ms, seragamkan copy Bahasa Indonesia, `bg-[var(--field)]`, loading state tabel, error UI + tombol *"Coba lagi"*. | UI page | `e2e/admin/orders.spec.ts` + mock spec |
| `apps/admin/src/app/admin/products/page.tsx` | modify | Tambah URL state (`search`, `page`) + debounce 300ms, pisah error UI + tombol *"Coba lagi"* dari empty state, ubah `<Link><Button>` → `<Button asChild>`. | UI page | `e2e/admin/products.spec.ts` + mock spec |
| `apps/admin/src/app/admin/products/[id]/page.tsx` | modify | Ubah nested `<Link><Button>` menjadi `<Button asChild><Link ...>`. | UI page | `e2e/admin/products.spec.ts` |
| `apps/admin/src/app/admin/customers/page.tsx` | modify | Terjemahkan header & 4 KPI card ke Bahasa Indonesia; ganti warna ikon hardcoded (`sky-50`/`violet-50`) ke semantic tokens. | UI server page | `e2e/admin/customers-pagination-mock.spec.ts` |
| `apps/admin/src/app/admin/discounts/page.tsx` | modify | Ubah `<h1>Diskon</h1>` → `<h2 className="text-2xl font-bold text-foreground">Diskon</h2>`. | UI page | `e2e/admin/discounts-admin-mock.spec.ts` |
| `apps/admin/src/app/admin/discounts/[id]/discount-editor-client.tsx` | modify | Ganti `window.confirm(...)` dengan shared `ConfirmDialog` (`@marketplace/ui`). | UI client component | `e2e/admin/discounts-admin-mock.spec.ts` |
| `apps/admin/src/components/NotificationBell.tsx` | modify | Tambah `aria-label` deskriptif pada tombol `size="icon"` hapus notifikasi. | UI component | `e2e/admin/order-notifications-mock.spec.ts` |
| `apps/admin/src/app/admin/homepage/page.tsx` | modify | Tambah `aria-label` deskriptif pada tombol `size="icon"` aksi baris. | UI page | `e2e/admin/homepage-form-layout-mock.spec.ts` |
| `apps/admin/src/app/admin/notifications/page.tsx` | modify | Tambah `aria-label` deskriptif pada tombol `size="icon"` aksi notifikasi. | UI page | `e2e/admin/notifications.spec.ts` |
| `apps/admin/src/components/homepage/*SectionForm.tsx` | modify | Tambah `aria-label` pada tombol `size="icon"` reorder/hapus (`BannerSectionForm`, `CarouselProductSectionForm`, `PromoCardsSectionForm`). | UI component | `e2e/admin/homepage-form-layout-mock.spec.ts` |
| `apps/admin/src/app/admin/orders/[id]/page.tsx` | modify | Migrasi 19 baris hardcoded Tailwind colors ke semantic tokens / `StatusBadge`. | UI page | `e2e/admin/orders-presentation.spec.ts` + visual review |
| `apps/admin/src/app/admin/orders/reviews/page.tsx` | modify | Migrasi 5 baris hardcoded Tailwind colors ke semantic tokens / `StatusBadge`. | UI page | `e2e/admin/sales-review-queue.spec.ts` + visual review |
| `apps/admin/src/app/error.tsx` | create | Error boundary Admin berbahasa Indonesia + *"Coba lagi"* & *"Kembali ke Dashboard"*. | App Router boundary | `npm run verify:types:admin` |
| `apps/admin/src/app/global-error.tsx` | create | Global error boundary Admin `<html lang="id">` + *"Muat ulang"*. | App Router boundary | `npm run verify:types:admin` |
| `apps/admin/src/app/not-found.tsx` | create | Halaman 404 Admin berbahasa Indonesia + *"Kembali ke Dashboard"*. | App Router boundary | E2E 404 admin check |

### Kontrak Export (File Baru / Berubah)

- `apps/admin/src/components/AdminSidebar.tsx`:
  - `export default function AdminSidebar(): JSX.Element` (desktop sidebar)
  - `export function AdminMobileNavTrigger(): JSX.Element` (tombol hamburger `md:hidden` + `Sheet` drawer untuk ditempatkan di `admin/layout.tsx`)

### Keputusan Struktur Non-Obvious

- **Keputusan:** Mengekspor `AdminMobileNavTrigger` dari `AdminSidebar.tsx` untuk dipasang di `<header>` pada `admin/layout.tsx`, berbagi daftar `links` dan state policy `useAuth()` yang sama.
  - **Alasan:** `admin/layout.tsx` adalah Server Component; tombol hamburger harus berada di top bar `<header>` sejajar judul `"Admin Dashboard"` dan `NotificationBell`, sementara daftar link harus tetap satu sumber kebenaran agar RBAC gating tidak duplikat.
  - **Ditolak:** Mengubah seluruh `admin/layout.tsx` menjadi Client Component atau menduplikasi array `links` di dua file.

### Discovery

- `discovery:` Sebelum mengubah teks label di `/admin/orders` dan `/admin/customers`, lakukan `git grep` pada folder `e2e/admin/` untuk mendaftar seluruh selector teks bahasa Inggris yang perlu diperbarui bersamaan (`Orders`, `Pending Payment`, `Previous`, `Next`, `Registered customers`, dll.).

## Rancangan UX

- **Tugas dan pengguna:** Operator admin menavigasi modul di desktop & mobile, memfilter/mencari pesanan dan produk dengan cepat, serta menangani error jaringan tanpa kehilangan konteks URL.
- **Halaman/pattern referensi:**
  - `apps/admin/src/app/admin/customers/customer-table.tsx` sebagai patokan list/table & pagination.
  - `packages/ui/src/components/ui/confirm-dialog.tsx` dan `sheet.tsx` sebagai komponen shared.
  - [docs/features/status-colors.md](../../../docs/features/status-colors.md) sebagai patokan warna status.
- **Hierarki dan primary action:** Satu `<h1>Admin Dashboard</h1>` di shell header; setiap halaman modul memakai `<h2 className="text-2xl font-bold">` sebagai judul halaman; satu primary action dominan per layar.

### Component Reuse Map

| Elemen | Existing / Baru | Path komponen | Catatan |
|---|---|---|---|
| Mobile sidebar drawer | Existing | `packages/ui/src/components/ui/sheet.tsx` | `side="left"`, tutup otomatis saat link diklik |
| Dialog konfirmasi reload | Existing | `packages/ui/src/components/ui/confirm-dialog.tsx` | Menggantikan `window.confirm` di editor diskon |
| Tombol link semantik | Existing | `packages/ui/src/components/ui/button.tsx` | `asChild` membungkus `<Link>` |
| Status badge | Existing | `packages/ui/src/components/ui/status-badge.tsx` | Menggantikan kelas warna status mentah |

### State Matrix

| Layar / komponen | Idle | Loading | Empty | Error | Sukses | Disabled / tanpa izin | Unsaved |
|---|---|---|---|---|---|---|---|
| `AdminSidebar` / Mobile Drawer | Desktop: sidebar tetap `w-64`; Mobile: tombol hamburger di header | Link opacity-60 saat `permissionsLoading` | N/A | N/A | Drawer buka/tutup halus; link aktif `aria-current="page"` | Modul tanpa izin `view` disembunyikan | N/A |
| `/admin/orders` | Filter + tabel Bahasa Indonesia; search debounce 300ms | Baris spinner `"Memuat pesanan..."` di tabel | *"Tidak ada pesanan yang cocok. Sesuaikan pekerjaan, tahap, pencarian atau tanggal."* | Banner destruktif *"Daftar pesanan belum berhasil dimuat."* + tombol *"Coba lagi"* | Daftar tampil + pagination *"Sebelumnya"* / *"Berikutnya"* | Return `null` bila tanpa `orders:view` | N/A |
| `/admin/products` | Tabel + search/page sinkron URL (debounce 300ms) | Spinner `"Memuat produk..."` | *"Tidak ada produk ditemukan."* | Banner destruktif *"Gagal memuat daftar produk."* + tombol *"Coba lagi"* | Daftar tampil; refresh/back mempertahankan filter | Mengikuti gate layout | N/A |
| `/admin/discounts/[id]` (reload dirty) | Editor diskon aktif | Mengikuti existing | N/A | Mengikuti existing | Klik *"Muat ulang"* di `ConfirmDialog` memuat versi terbaru | N/A | `ConfirmDialog`: *"Muat ulang versi terbaru?"* (*"Batal"* / *"Muat ulang"*) |
| `not-found.tsx` / `error.tsx` Admin | N/A | N/A | N/A | 404: *"Halaman tidak ditemukan"* + *"Kembali ke Dashboard"*; Error: *"Terjadi kesalahan saat memuat halaman"* + *"Coba lagi"* | Pulih via `reset()` atau navigasi `/admin` | N/A | N/A |

- **Viewport dan responsive:** Wajib dicek di browser pada **desktop (`1280×800`)** dan **mobile (`390×844`)** untuk shell/drawer, tabel `/admin/orders`, `/admin/products`, `/admin/customers`, dan `ConfirmDialog` editor diskon.
- **Accessibility:** 1 `<h1>` per halaman, 0 nested `<Link><Button>`, 0 tombol `size="icon"` tanpa `aria-label` di Admin, focus ring terlihat pada `Sheet` dan `ConfirmDialog`, kontras teks ≥ 4.5:1 di light & dark mode.
- **Prototype:** N/A — memakai komponen dan token `@marketplace/ui` yang ada.

## Testing Decisions

- **Prinsip pengujian:** Uji perilaku lintas halaman data (search backend menemukan record di luar halaman 1, reset page ke 1, debounce tidak menembak per karakter, error terpisah dari empty, drawer mobile buka/tutup, `ConfirmDialog` menggantikan `window.confirm`).
- **Modul & seam yang diuji:**
  1. Playwright E2E mock `shell-layout.spec.ts` (mobile `390×844`: sidebar tersembunyi, klik hamburger buka drawer, klik link navigasi & drawer menutup).
  2. Playwright E2E mock `/admin/orders` & `/admin/products` (debounce search, URL sync `search`/`page`, error 500 menampilkan banner error + retry berhasil, label Bahasa Indonesia).
  3. Playwright E2E mock `discounts-admin-mock.spec.ts` (verifikasi `ConfirmDialog` saat reload dirty, tidak memanggil `window.confirm`, dan hanya 1 `<h1>` di `/admin/discounts`).
  4. Audit a11y otomatis/DOM assertion di Playwright: 0 tombol `size="icon"` tanpa accessible name di surface yang diubah, 0 nested `a button`.
  5. Update seluruh E2E Admin existing yang terdampak standardisasi Bahasa Indonesia.
- **Prior art:** `e2e/admin/customers-pagination-mock.spec.ts`, `e2e/admin/shell-layout.spec.ts`, `e2e/admin/discounts-admin-mock.spec.ts`, `e2e/admin/status-colors-mock.spec.ts`.

## Fitur & Acceptance Criteria

| # | Fitur / AC | Status | verify: | Catatan |
|---|---|---|---|---|
| AC-1 | **Mobile Drawer `AdminSidebar` & Ikon Unik (P1-1):** `< 768px` memakai tombol hamburger + `Sheet` drawer (tutup otomatis saat navigasi); ikon *Harga SKU* dan *Diskon* berbeda. | Verified | Playwright `390×844` + `1280×800` pada `slice3-ux-admin-mock.spec.ts` | Tanpa duplikasi daftar link |
| AC-2 | **Standardisasi Bahasa & Kontrak `/admin/orders` (P1-2):** Seluruh copy Bahasa Indonesia, search debounce 300ms, select `--field`, loading state tabel, dan error UI + tombol *"Coba lagi"*. | Verified | Playwright mock `slice3-ux-admin-mock.spec.ts` + `status-colors-mock.spec.ts` | — |
| AC-3 | **Kontrak List/Table `/admin/products` (P1-2):** URL state (`search`, `page`) + debounce 300ms; error fetch tampilkan banner error + *"Coba lagi"* (tidak menyamar jadi empty state). | Verified | Playwright mock `slice3-ux-admin-mock.spec.ts` | — |
| AC-4 | **Bahasa `/admin/customers`, Heading & `ConfirmDialog` Diskon (P1-2):** Header & 4 KPI card `/admin/customers` berbahasa Indonesia; `/admin/discounts` memakai `<h2>`; `discount-editor-client.tsx` memakai `ConfirmDialog` (0 `window.confirm`). | Verified | `slice3-ux-admin-mock.spec.ts` + `customers-pagination-mock.spec.ts` + `rg "window\.confirm"` = 0 | — |
| AC-5 | **A11y & Dark-mode Safe Colors Admin (P1-3):** 0 nested `<Link><Button>` di Admin, seluruh tombol `size="icon"` Admin punya `aria-label`, dan hardcoded colors di `customers`, `orders/[id]`, `orders/reviews` dimigrasikan ke semantic tokens. | Verified | `npm run verify:types:admin` + `lint:admin` + `slice3-ux-admin-mock.spec.ts` + `status-colors-mock.spec.ts` | — |
| AC-6 | **App Router Boundaries Admin (P1-4):** Tersedia `error.tsx`, `global-error.tsx`, dan `not-found.tsx` berbahasa Indonesia di `apps/admin/src/app/`. | Verified | `slice3-ux-admin-mock.spec.ts` + `verify:types:admin` | — |

## Implementation Notes

- Urutan disarankan: AC-1 (shell/sidebar) → AC-2 & AC-3 (orders & products list contract) → AC-4 (customers & discounts) → AC-5 & AC-6 (a11y, semantic colors, boundaries) → update E2E Admin terdampak.
- Final gate wajib menjalankan `npm run verify:types:admin`, `npm run lint:admin`, `npm run test:unit`, `npm run verify:batch:e2e -- <affected mock specs>`, dan **rendered UX review** pada desktop (`1280px`) & mobile (`390px`).

## Deviation Log

| Ticket / slice | Rencana (path/kontrak) | Aktual | Alasan | Dampak |
|---|---|---|---|---|
| *(Belum ada — masih Draft)* | — | — | — | — |

## Open Questions

- Tidak ada open question yang memblokir `Ready`. Seluruh keputusan UX Admin telah disepakati pada sesi grilling.

## Retirement Checklist (saat plan mencapai Done)

- [x] Semua AC-1 s.d. AC-6 lulus `verify:` termasuk rendered UX review desktop & mobile.
- [x] Seluruh E2E Admin yang terpengaruh perubahan copy Bahasa Indonesia sudah diperbarui dan lulus.
- [x] File plan tetap disimpan di `.scratch/codebase-ui-audit/plan/slice-3-ux-admin.md`.
- [x] Entri di `.scratch/codebase-ui-audit/index.md` diperbarui ke **Done** dengan tanggal dan bukti verifikasi.
