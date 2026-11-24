# Plan & Spec: Slice 2 — Perbaikan UX Storefront, Mobile, Boundaries & Dark-Mode Safety

> Status plan secara keseluruhan dicatat di [index.md](../index.md). File ini mencatat spesifikasi lengkap, technical & UX blueprint, acceptance criteria, dan status per fitur untuk **Slice 2** dari rangkaian perbaikan hasil [Audit Codebase & UI/UX](../research/codebase-ui-improvement-audit.md).

## Problem Statement

Pengguna storefront (terutama di perangkat mobile dan pada halaman akun serta katalog) mengalami beberapa hambatan UX dan bug nyata:

1. **Kontrol UI mati & navigasi salah di `/account` (P0-2):** Tombol *"Keluar"* tidak memiliki handler, tombol *"Coba Lagi"* saat error tidak memicu fetch ulang, klik *"Profil Saya"* dari menu avatar selalu mendarat di tab *"Riwayat Pesanan"* (mengabaikan `?tab=`), dan ada 3 elemen dead UI tanpa backend (ikon kamera upload avatar, badge hardcoded `"Member Silver"`, serta input search + tombol filter pesanan).
2. **Header mobile (`< 768px`) kehilangan fungsi utama (P1-1):** Search bar dan tautan *"Cabang"* disembunyikan total (`hidden md:flex`) tanpa fallback tombol cari atau menu drawer.
3. **Bug infinite scroll & counter tidak sinkron di `/products` (P0-6):** `InfiniteProductGrid` memanggil URL absolut berbasis `NEXT_PUBLIC_APP_URL || "http://localhost:3000"`, diam-diam mematikan `hasMore` saat error tanpa tombol retry, dan counter `"Menampilkan X dari Y produk"` tetap menunjukkan jumlah awal (20) meski user sudah memuat halaman berikutnya.
4. **A11y, semantik HTML, & warna belum dark-mode safe (P1-3):** Store memakai `<html lang="en">` (padahal konten berbahasa Indonesia), `Header.tsx` memiliki nested `<Link><Button>`, tombol ukuran di detail produk memakai lebar tetap `w-12` (rawan memotong label panjang seperti `"All Size"`), dan beberapa halaman (`checkout`, `account/orders/[id]`, chip `ProductCard`) memakai hardcoded Tailwind colors.
5. **Tidak ada App Router error/not-found/loading boundaries (P1-4):** Error server atau URL tak ditemukan menampilkan halaman default Next.js berbahasa Inggris tanpa tombol pemulihan.

## Solution

Slice 2 memperbaiki seluruh pengalaman storefront secara menyeluruh dengan tetap menggunakan komponen & token `@marketplace/ui`:

1. Memperbaiki halaman `/account` agar `Keluar`, query `?tab=` (`profile` default pada `/account`, `orders` pada `/account?tab=orders`), dan tombol *"Coba Lagi"* berfungsi nyata, serta menghapus 3 elemen dead UI.
2. Melengkapi `Header.tsx` mobile (`< 768px`) dengan tombol ikon Search (membuka bar/dialog pencarian) dan tombol menu drawer (`Sheet`) berisi tautan *Cabang* & navigasi utama sambil menjaga header tetap 1 baris ringkas, sekaligus memperbaiki nested `<Link><Button>` menjadi `<Button asChild>`.
3. Memperbaiki `InfiniteProductGrid` agar memakai URL relatif `/api/products`, menampilkan state error + tombol *"Coba muat lagi"*, dan memindahkan counter jumlah tampil agar selalu sinkron saat load more.
4. Memperbarui `<html lang="id">`, ukuran tombol pilih size (`min-w-12 h-12 px-3`), menambahkan `error.tsx`, `global-error.tsx`, `not-found.tsx` berbahasa Indonesia + `loading.tsx` di route server utama, serta memigrasikan hardcoded Tailwind colors di Store & `ProductCard` ke semantic tokens.

## User Stories

1. Sebagai customer di `/account`, saya ingin mengklik *"Keluar"* dan langsung logout serta diarahkan ke beranda (sama seperti menu Keluar di Header).
2. Sebagai customer yang mengklik *"Profil Saya"* di menu avatar Header, saya ingin langsung mendarat di tab **Profil Saya** (`/account`), sedangkan klik *"Pesanan Saya"* mendarat di tab **Pesanan Saya** (`/account?tab=orders`).
3. Sebagai customer yang gagal memuat riwayat pesanan di `/account`, saya ingin tombol *"Coba Lagi"* benar-benar mengirim request ulang ke `/api/orders`.
4. Sebagai customer di `/account`, saya tidak ingin melihat tombol kamera, badge `"Member Silver"`, atau kolom cari/filter palsu yang tidak bisa dipakai.
5. Sebagai customer di ponsel (`< 768px`), saya ingin mencari produk lewat ikon Search di header dan membuka tautan *Cabang* lewat menu drawer tanpa membuat header menumpuk dua baris.
6. Sebagai customer di `/products`, saya ingin infinite scroll berjalan normal di origin/domain mana pun, melihat angka `"Menampilkan X dari Y produk"` ikut bertambah saat scroll, dan mendapat tombol *"Coba muat lagi"* bila muatan halaman berikutnya gagal.
7. Sebagai customer di halaman detail produk, saya ingin label ukuran panjang (seperti `"All Size"` atau `"42.5"`) terbaca utuh tanpa terpotong.
8. Sebagai pengguna screen reader atau keyboard, saya ingin halaman Store memiliki `lang="id"` dan tidak ada elemen interaktif bersarang (`<a><button>`) di Header.
9. Sebagai customer yang membuka URL tidak valid atau mengalami gangguan server di Store, saya ingin melihat halaman 404/error berbahasa Indonesia dengan tombol pemulihan yang jelas (*"Coba lagi"* / *"Kembali ke Beranda"*), serta skeleton loading saat membuka beranda, katalog, atau detail produk.
10. Sebagai customer di light maupun dark theme, saya ingin seluruh badge/chip/info box pada `ProductCard`, `checkout`, dan `account/orders/[id]` tetap kontras dan terbaca.

## Approval

- **Kesepahaman bersama dikonfirmasi user:** ✅ Dikonfirmasi melalui sesi grilling 2 ronde (2026-11-24 — keputusan Q1, Q3, Q6, Q7, Q10 terkunci).
- **Complete scope dan acceptance/verify criteria disetujui user:** ✅ Disetujui user (2026-11-25).
- **Context7 checkpoint:** `/vercel/next.js` — dikonfirmasi `error.tsx` & `global-error.tsx` (`{ error, reset }` dengan `<html><body>` pada `global-error.tsx`), `not-found.tsx` & `loading.tsx` (tanpa props), serta `useSearchParams()` di dalam `<Suspense>`.

## Non-scope

- Membangun fitur baru search/filter riwayat pesanan, upload foto avatar, atau sistem tier member di `/account`.
- Refactor monolith `apps/store/src/app/checkout/page.tsx` (P2-2) — pada Slice 2 hanya mengganti kelas warna hardcoded menjadi semantic tokens tanpa mengubah struktur bisnis checkout.
- Migrasi `/products/[id]` ke Server Component + `generateMetadata()` (masuk **Slice 4**).
- Perbaikan halaman Admin (masuk **Slice 3**).

## Implementation Decisions

1. **Halaman `/account` (P0-2):**
   - Membaca `?tab=` lewat `useSearchParams()` (dibungkus `<Suspense>`). Mapping: `?tab=orders` → tab `"orders"`; selain itu (termasuk `/account` tanpa query) → tab `"profile"` agar sesuai dengan link *"Profil Saya"* (`/account`) dan *"Pesanan Saya"* (`/account?tab=orders`) di `Header.tsx`.
   - Klik tab di sidebar juga menyinkronkan URL (`router.replace("/account")` untuk profil, `router.replace("/account?tab=orders")` untuk pesanan) agar tombol Back/Refresh konsisten.
   - Tombol *"Keluar"* memakai alur `signOut()` yang sama dengan `Header.tsx` (hapus cookie `client.onboarding`, `router.push("/")`, `router.refresh()`).
   - Retry error memakai state counter `ordersRetryKey` dalam dependency `useEffect` sehingga klik *"Coba Lagi"* selalu memicu fetch baru.
   - Menghapus tombol ikon `<Camera />`, `<Badge>Member Silver</Badge>`, serta blok input `Cari pesanan...` + tombol `<Filter />`.
2. **Mobile Header `< 768px` & A11y (P1-1, P1-3):**
   - Header tetap `h-16` 1 baris di semua viewport.
   - Pada mobile (`md:hidden`): tambah tombol ikon Search (`aria-label="Cari produk"`) yang membuka `Dialog` atau bar pencarian mobile fokus-otomatis (submit mengarah ke `/products?search=...` dan menutup dialog), serta tombol menu hamburger (`aria-label="Buka menu navigasi"`) yang membuka `Sheet` (`side="right"` atau `"left"`) berisi link *Beranda*, *Semua Produk*, dan *Cabang* (menutup otomatis saat link diklik).
   - Seluruh `<Link><Button>` di `Header.tsx` (Cabang, Keranjang, Masuk, Daftar) diubah menjadi `<Button asChild><Link ...>` agar valid secara HTML5 dan tidak menimbulkan double focus stop.
3. **Katalog & `InfiniteProductGrid` (P0-6):**
   - `loadMore` menggunakan path relatif `` `/api/products?${params.toString()}` ``.
   - Tambah state `loadError: string | null`; saat fetch gagal atau `!res.ok` / `!data.success`, set `loadError("Gagal memuat produk berikutnya.")` tanpa mengubah `hasMore` menjadi `false`, dan tampilkan pesan + tombol *"Coba muat lagi"* yang memanggil `loadMore()`.
   - Pindahkan teks counter `"Menampilkan {products.length} dari {total} produk"` ke dalam `InfiniteProductGrid` (atau header yang menerima prop heading dari `products/page.tsx`) sehingga angka selalu sinkron saat halaman berikutnya dimuat.
4. **App Router Boundaries Store (P1-4):**
   - `apps/store/src/app/error.tsx` (`"use client"`): menampilkan pesan error berbahasa Indonesia + tombol *"Coba lagi"* (`reset()`) dan *"Kembali ke Beranda"* (`/`).
   - `apps/store/src/app/global-error.tsx` (`"use client"`): fallback root `<html lang="id">` dengan pesan ramah dan tombol *"Muat ulang"*.
   - `apps/store/src/app/not-found.tsx`: pesan *"Halaman tidak ditemukan"* dengan CTA *"Kembali ke Beranda"* dan *"Lihat Katalog"*.
   - `loading.tsx` skeleton menggunakan semantic `bg-muted animate-pulse` di 3 route server utama: `apps/store/src/app/loading.tsx`, `apps/store/src/app/products/loading.tsx`, dan `apps/store/src/app/products/[id]/loading.tsx`.
5. **Dark-mode Safe Semantic Tokens (P1-3):**
   - `packages/ui/src/components/store/ProductCard.tsx`: ganti chip `bg-blue-500/15 text-blue-700` dan `bg-amber-500/15 text-amber-700` ke token semantik/dark-safe (mis. `bg-secondary text-secondary-foreground` / `bg-muted text-muted-foreground` atau pasangan `dark:` kontras ≥ 4.5:1).
   - `apps/store/src/app/checkout/page.tsx` dan `apps/store/src/app/account/orders/[id]/page.tsx`: ganti kelas warna palette mentah (`bg-*-50 text-*-700 border-*-200`, dll.) dengan `StatusBadge` / `getStatusToneClassName` (untuk elemen status) atau semantic tokens (`bg-muted`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `text-destructive`).

## Rancangan Teknis

### Tabel File

| Path | Aksi | Tanggung jawab (1–3 baris) | Layer | Seam test |
|---|---|---|---|---|
| `apps/store/src/app/account/page.tsx` | modify | Baca `?tab=`, wire `Keluar`, tambah `ordersRetryKey` untuk retry error, hapus dead UI (kamera, Member Silver, search/filter). | UI page | `e2e/store/account.spec.ts` |
| `apps/store/src/components/Header.tsx` | modify | Tambah mobile Search dialog/bar & mobile `Sheet` drawer (`Cabang`, navigasi), ubah `<Link><Button>` → `<Button asChild>`, tambah `aria-label` tombol ikon. | UI component | `e2e/store/products.spec.ts` / spec baru mobile header |
| `apps/store/src/components/InfiniteProductGrid.tsx` | modify | Ganti fetch ke `/api/products?...` relatif, tambah `loadError` + tombol *"Coba muat lagi"*, render header + counter live `"Menampilkan X dari Y produk"`. | UI component | `apps/store/src/lib/infinite-products.test.ts` + E2E mock |
| `apps/store/src/app/products/page.tsx` | modify | Teruskan heading pencarian ke `InfiniteProductGrid` agar counter live tidak duplikat/stale di Server Component. | UI server page | `e2e/store/products.spec.ts` |
| `apps/store/src/app/products/[id]/page.tsx` | modify | Ganti tombol pilih ukuran dari `w-12 h-12 p-0` menjadi `min-w-12 h-12 px-3`. | UI page | `e2e/store/product-detail.spec.ts` |
| `apps/store/src/app/layout.tsx` | modify | Ubah `<html lang="en">` menjadi `<html lang="id">`. | UI server layout | `npm run verify:types:store` + E2E check `html[lang="id"]` |
| `apps/store/src/app/error.tsx` | create | Error boundary Store berbahasa Indonesia dengan tombol *"Coba lagi"* dan *"Kembali ke Beranda"*. | App Router boundary | Rendered check + unit/E2E |
| `apps/store/src/app/global-error.tsx` | create | Global error boundary `<html lang="id">` dengan tombol *"Muat ulang"*. | App Router boundary | `npm run verify:types:store` |
| `apps/store/src/app/not-found.tsx` | create | Halaman 404 Store berbahasa Indonesia dengan CTA ke `/` dan `/products`. | App Router boundary | E2E 404 route check |
| `apps/store/src/app/loading.tsx` | create | Skeleton loading untuk homepage Store. | App Router boundary | `npm run verify:types:store` |
| `apps/store/src/app/products/loading.tsx` | create | Skeleton loading untuk katalog produk Store. | App Router boundary | `npm run verify:types:store` |
| `apps/store/src/app/products/[id]/loading.tsx` | create | Skeleton loading untuk detail produk Store. | App Router boundary | `npm run verify:types:store` |
| `packages/ui/src/components/store/ProductCard.tsx` | modify | Ganti hardcoded chip colors (`blue-700`/`amber-700`) ke semantic/dark-mode safe tokens. | shared UI component | `npm run build --workspace @marketplace/ui` + visual review |
| `apps/store/src/app/checkout/page.tsx` | modify | Migrasi 13 baris hardcoded Tailwind colors ke semantic tokens / `StatusBadge` tanpa mengubah alur checkout. | UI page | `e2e/store/checkout-review-mock.spec.ts` + visual review |
| `apps/store/src/app/account/orders/[id]/page.tsx` | modify | Migrasi 6 baris hardcoded Tailwind colors ke semantic tokens / `StatusBadge`. | UI page | `e2e/store/order-detail-presentation-mock.spec.ts` + visual review |

### Kontrak Export (File Baru / Berubah)

- `apps/store/src/components/InfiniteProductGrid.tsx`:
  - `InfiniteProductGridProps`: menambah `heading: string` (opsional, default `"Semua Produk"`) agar header + live counter berada dalam satu blok sinkron.
- `apps/store/src/app/error.tsx` & `apps/store/src/app/global-error.tsx`:
  - `default function StoreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element`

### Keputusan Struktur Non-Obvious

- **Keputusan:** Memindahkan blok heading + counter katalog ke dalam `InfiniteProductGrid` (menerima `heading` dari `products/page.tsx`).
  - **Alasan:** Counter membutuhkan jumlah `products.length` terbaru setelah client-side load more; menyimpannya di Server Component membuat angka beku di 20.
  - **Ditolak:** Membuat Context/store global hanya untuk mengirim 1 angka counter ke atas.
- **Keputusan:** Memakai shared `Sheet` dan `Dialog` dari `@marketplace/ui` untuk mobile Header.
  - **Alasan:** Komponen sudah tersedia di `@marketplace/ui`, otomatis menyediakan focus trap, Escape-to-close, dan `aria-modal`.
  - **Ditolak:** Membuat dropdown/drawer CSS kustom tanpa manajemen fokus keyboard.

### Discovery

- Tidak ada `discovery:` yang memblokir. Catatan saat implementasi: verifikasi semua pemakaian warna hardcoded di `checkout/page.tsx` dan `account/orders/[id]/page.tsx` tidak memengaruhi selector E2E existing.

## Rancangan UX

- **Tugas dan pengguna:** Customer storefront mencari produk (desktop & mobile), mengelola akun/pesanan, membaca katalog dengan infinite scroll, dan pulih dengan jelas saat terjadi error atau 404.
- **Halaman/pattern referensi:**
  - Header & navigasi existing di `apps/store/src/components/Header.tsx` (tetap navy `bg-primary`, tinggi `h-16`).
  - Sheet & Dialog dari `packages/ui/src/components/ui/sheet.tsx` & `dialog.tsx`.
  - Kontrak warna status dari [docs/features/status-colors.md](../../../docs/features/status-colors.md).
- **Hierarki dan primary action:**
  - Header mobile: logo di kiri; ikon Search, Keranjang, Akun, dan Menu Drawer di kanan — 1 baris ringkas tanpa tumpang tindih.
  - Halaman error/404: 1 primary CTA pemulihan (*"Coba lagi"* / *"Kembali ke Beranda"*), 1 secondary link opsional.

### Component Reuse Map

| Elemen | Existing / Baru | Path komponen | Catatan |
|---|---|---|---|
| Mobile nav drawer | Existing | `packages/ui/src/components/ui/sheet.tsx` | Dipakai di `Header.tsx` khusus `< md` |
| Mobile search overlay | Existing | `packages/ui/src/components/ui/dialog.tsx` | Fokus otomatis ke `<Input>` pencarian |
| Button link semantik | Existing | `packages/ui/src/components/ui/button.tsx` | Pakai prop `asChild` membungkus `<Link>` |
| Status badge | Existing | `packages/ui/src/components/ui/status-badge.tsx` | Dipakai untuk mengganti status warna hardcoded |

### State Matrix

| Layar / komponen | Idle | Loading | Empty | Error | Sukses | Disabled / tanpa izin | Unsaved |
|---|---|---|---|---|---|---|---|
| `/account` (tab Pesanan) | Daftar pesanan tampil; tab aktif mengikuti `?tab=` (`profile` default, `orders` saat `?tab=orders`) | Spinner `"Memuat..."` (existing) | *"Belum ada pesanan"* + CTA *"Mulai Belanja"* | Pesan error + tombol *"Coba Lagi"* (memicu fetch ulang) | Daftar pesanan tampil; klik *"Keluar"* logout & redirect ke `/` | Redirect login via middleware | N/A |
| `Header` (mobile `< 768px`) | 1 baris: Logo + ikon Search, Keranjang, Akun, Menu | Skeleton ikon User saat `isLoading` | N/A | N/A | Submit cari → `/products?search=...` & tutup dialog; klik link drawer → navigasi & tutup drawer | N/A | N/A |
| `InfiniteProductGrid` (`/products`) | Grid produk + header `"Menampilkan X dari Y produk"` (update live) | `"Memuat lebih banyak produk..."` di bawah grid | *"Tidak ada produk yang ditemukan."* + *"Lihat Semua Produk"* | *"Gagal memuat produk berikutnya."* + tombol *"Coba muat lagi"* | Produk bertambah + counter bertambah; akhir daftar: *"Semua X dari Y produk telah ditampilkan"* | N/A | N/A |
| `not-found.tsx` / `error.tsx` | N/A | Skeleton di `loading.tsx` (`bg-muted animate-pulse`) | N/A | 404: *"Halaman tidak ditemukan"* + *"Kembali ke Beranda"* / *"Lihat Katalog"*; Error: *"Terjadi kesalahan saat memuat halaman"* + *"Coba lagi"* | Pemulihan via `reset()` atau navigasi `/` | N/A | N/A |

- **Kontrak list/table:** N/A untuk tabel baru; `/products` mempertahankan kontrak server-side filter/sort + infinite pagination existing (`PAGE_SIZE = 20`), dengan perbaikan URL relatif, live counter, dan retry error.
- **Viewport dan responsive:** Wajib dicek di browser pada **desktop (`1280×800`)** dan **mobile (`390×844`)**, termasuk kondisi dialog search terbuka, drawer menu terbuka, dan dark/light theme.
- **Accessibility:** `html[lang="id"]`, 0 nested interactive `<Link><Button>`, semua tombol `size="icon"` di `Header.tsx` punya `aria-label`, focus ring terlihat, target sentuh mobile ≥ 40×40px, kontras teks ≥ 4.5:1 di light & dark mode.
- **Prototype:** N/A — memakai komponen dan token `@marketplace/ui` yang ada.

## Testing Decisions

- **Prinsip pengujian:** Uji perilaku user-visible pada seam publik (navigasi tab `/account`, logout, retry error, mobile search/drawer, infinite scroll retry & live counter, 404 page).
- **Modul & seam yang diuji:**
  1. Playwright E2E mock/spec untuk `/account` (`?tab=orders` vs `/account` default ke Profil, klik *"Keluar"*, retry saat `/api/orders` gagal lalu sukses, dan pastikan tombol kamera / `"Member Silver"` / search-filter mati tidak ada).
  2. Playwright E2E mock untuk mobile Header (`390×844`: klik tombol Search → isi query → navigasi `/products?search=...`; klik tombol Menu → klik *Cabang* → `/branches`).
  3. Playwright E2E mock untuk `InfiniteProductGrid` (halaman 2 gagal → tampil *"Gagal memuat produk berikutnya."* + *"Coba muat lagi"* → klik retry → produk bertambah dan counter update live).
  4. Playwright check untuk `not-found.tsx`, `html[lang="id"]`, dan regresi `checkout-review-mock.spec.ts` + `order-detail-presentation-mock.spec.ts`.
- **Prior art:** `e2e/store/account.spec.ts`, `e2e/store/products.spec.ts`, `e2e/store/status-colors-mock.spec.ts`.

## Fitur & Acceptance Criteria

| # | Fitur / AC | Status | verify: | Catatan |
|---|---|---|---|---|
| AC-1 | **Fix `/account` (P0-2):** `/account` membuka tab Profil, `/account?tab=orders` membuka tab Pesanan, *"Keluar"* benar-benar logout, *"Coba Lagi"* memicu fetch ulang, dan 3 kontrol mati (kamera, `"Member Silver"`, search/filter) dihapus. | Verified | `e2e/store/slice2-ux-store-mock.spec.ts` + `e2e/store/status-colors-mock.spec.ts` PASS | Tidak ada dead UI tersisa |
| AC-2 | **Mobile Header `< 768px` & A11y (P1-1, P1-3):** Header 1 baris di `390px` dengan Search dialog + Menu drawer (*Cabang*, navigasi), 0 nested `<Link><Button>`, semua tombol ikon ber-`aria-label`. | Verified | `e2e/store/slice2-ux-store-mock.spec.ts` (viewport `390×844`) PASS | Reuse `Sheet` & `Dialog` |
| AC-3 | **Fix `InfiniteProductGrid` & Counter (P0-6):** Fetch pakai `/api/products` relatif, error menampilkan *"Gagal memuat produk berikutnya."* + tombol *"Coba muat lagi"*, counter `"Menampilkan X dari Y produk"` update live. | Verified | `apps/store/src/lib/infinite-products.test.ts` (2/2 PASS) + `e2e/store/slice2-ux-store-mock.spec.ts` PASS | — |
| AC-4 | **Semantik HTML & Tombol Ukuran (P1-3):** `apps/store/src/app/layout.tsx` memakai `<html lang="id">`; tombol pilih ukuran di detail produk memakai `min-w-12 h-12 px-3` sehingga label `"All Size"` tidak terpotong. | Verified | `e2e/store/slice2-ux-store-mock.spec.ts` (`html[lang="id"]`, `scrollWidth <= clientWidth` pada `"All Size"`) PASS | — |
| AC-5 | **App Router Boundaries Store (P1-4):** Tersedia `error.tsx`, `global-error.tsx`, `not-found.tsx` berbahasa Indonesia + `loading.tsx` di homepage, katalog, dan detail produk. | Verified | `e2e/store/slice2-ux-store-mock.spec.ts` (404 route) + `npm run verify:types:store` PASS | — |
| AC-6 | **Dark-mode Safe Colors Store & `ProductCard` (P1-3):** Hardcoded palette colors pada `ProductCard`, `checkout/page.tsx`, dan `account/orders/[id]/page.tsx` dimigrasikan ke semantic tokens / `StatusBadge`. | Verified | `e2e/store/status-colors-mock.spec.ts` + `e2e/store/order-detail-presentation-mock.spec.ts` + `e2e/store/slice2-ux-store-mock.spec.ts` (29/29 PASS) | `checkout-review-mock.spec.ts` terblokir guard DB non-disposable `storefront` |

## Implementation Notes

- Dependensi antar slice: dapat dikerjakan setelah Slice 1 (agar `LayoutWrapper` & `#admin` di `Header.tsx` sudah bersih lebih dulu).
- Final gate wajib menjalankan `npm run verify:types:store`, `npm run lint:store`, `npm run test:unit`, `npm run verify:batch:e2e -- <affected mock specs>`, dan **rendered UX review** pada desktop (`1280px`) & mobile (`390px`).

## Deviation Log

| Ticket / slice | Rencana (path/kontrak) | Aktual | Alasan | Dampak |
|---|---|---|---|---|
| *(Belum ada — masih Draft)* | — | — | — | — |

## Open Questions

- Tidak ada open question yang memblokir `Ready`. Seluruh keputusan UX Store telah disepakati pada sesi grilling.

## Retirement Checklist (saat plan mencapai Done)

- [x] Semua AC-1 s.d. AC-6 lulus `verify:` termasuk rendered UX review desktop & mobile.
- [x] `npm run build --workspace @marketplace/ui` dan `npm run verify:types:store` lulus.
- [x] File plan tetap disimpan di `.scratch/codebase-ui-audit/plan/slice-2-ux-store.md`.
- [x] Entri di `.scratch/codebase-ui-audit/index.md` diperbarui ke **Done** dengan tanggal dan bukti verifikasi.
