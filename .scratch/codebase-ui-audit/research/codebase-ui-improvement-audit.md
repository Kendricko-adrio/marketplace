# Audit Codebase & UI/UX — Peluang Perbaikan Store & Admin

- **Tanggal audit:** 2026-11-22
- **Baseline kode:** branch `main`, commit `f11b41b` (working tree bersih saat audit)
- **Navigasi fitur:** [index.md](../index.md)
- **Pedoman acuan repo:**
  - [AGENTS.md](../../../AGENTS.md)
  - [code-organization.md](../../../docs/architecture/code-organization.md)
  - [status-colors.md](../../../docs/features/status-colors.md)
  - [maintainable-code SKILL](../../../.agents/skills/maintainable-code/SKILL.md)
  - [ux-design SKILL](../../../.agents/skills/ux-design/SKILL.md)

---

## 1. Metode & Batasan Bukti

### Yang dijalankan dan diverifikasi langsung (fakta primer)

1. **Pemindaian statis seluruh source non-test** pada `apps/store/src`, `apps/admin/src`, `packages/db/src`, `packages/ui/src`, dan `packages/logging/src` (768 total file; 558 file `.ts`/`.tsx` non-test).
2. **Eksekusi linter resmi repo:**
   - `npm run lint:store` → **FAIL** (2 errors, 6 warnings).
   - `npm run lint:admin` → **PASS** dengan 0 errors, 38 warnings.
3. **Inspeksi kode langsung** pada layout, navigasi, halaman katalog, detail produk, keranjang, akun, checkout, serta halaman-halaman utama admin (orders, products, customers, discounts, users, marketing, analytics, sidebar, notification bell).

### Yang **belum** dijalankan (batasan verifikasi)

- **Tidak ada rendered browser review** (desktop/mobile viewport, light/dark mode, keyboard navigation aktual, dan computed contrast). Sesuai `ux-design` §5, audit statis JSX bukan pengganti inspeksi hasil render di browser.
- **Tidak menjalankan** `npm run verify:types:store`, `npm run verify:types:admin`, `npm run test:unit`, maupun `npm run test:e2e`.
- **Tidak memeriksa** konfigurasi reverse proxy/Caddy di `deployment/` untuk security headers tingkat server.

---

## 2. Ringkasan Metrik Baseline

| Dimensi | Metrik Terverifikasi | Catatan |
|---|---|---|
| Total file source non-test (`.ts`/`.tsx`) | 558 file | >300 baris: **97 file** · >500 baris: **47 file** · >1.000 baris: **11 file** |
| API Route Handlers (`app/api/**/route.ts`) | 108 route | Mengimpor `@/db` atau `drizzle-orm` langsung: **55 route** · >120 baris: **49 route** · >300 baris: **8 route** |
| Cakupan `withRequestContext` | 106 / 108 route | 2 pengecualian sah: `apps/{store,admin}/src/app/api/auth/[...all]/route.ts` |
| `console.*` di `app/api/**/route.ts` | 0 | Bersih sesuai policy `@marketplace/logging` |
| `console.*` di luar DB scripts & logger | 73 kemunculan | Sebagian besar di Client Components, plus 3 lokasi server-side (Server Action/RSC) |
| Halaman App Router (`page.tsx`) | 54 halaman | Client: **31** · Server: **23** |
| Special App Router files (`loading`/`error`/`not-found`/`global-error`) | **0 file** | Tidak ada satu pun di `apps/store/src/app` maupun `apps/admin/src/app` |
| TypeScript hygiene (`: any` / `as any`, `@ts-ignore`) | 3 `any`, 0 `@ts-ignore` | Sangat bersih (`eslint-disable`: 6) |
| ESLint (`lint:store` / `lint:admin`) | Store: **2 error, 6 warning** · Admin: **0 error, 38 warning** | Kedua error berada di `CheckoutAddressDialog.tsx` |
| `dangerouslySetInnerHTML` | 3 lokasi | 2 lokasi pada `product.description` **tanpa sanitasi**; 1 lokasi internal `chart.tsx` |
| Tombol `size="icon"` tanpa `aria-label`/`title` | 19 tombol | Tersebar di store & admin |
| `window.confirm` tersisa | 1 lokasi runtime | `discount-editor-client.tsx:579` (meski `ConfirmDialog` sudah tersedia di `@marketplace/ui`) |
| Server Component mengimpor `route.ts` langsung | 2 halaman | `apps/store/src/app/page.tsx` dan `apps/store/src/app/products/page.tsx` |

### Kekuatan Fondasi yang Sudah Baik (dipertahankan)

- **Disiplin TypeScript tinggi:** hanya 3 pemakaian `any` di seluruh codebase dan 0 `@ts-ignore`/`@ts-expect-error`.
- **Shared UI & warna status terpusat:** 26 komponen primitif berada di `packages/ui/src/components/ui` (tidak diduplikasi di `apps/*/src/components/ui`), dan seluruh badge status sudah memakai `StatusBadge` + `getStatusTone` (0 `<Badge>` dengan raw status color classes).
- **Contextual logging di `/api/**` sudah matang:** 106/108 route handler dibungkus `withRequestContext`, 0 `console.*` di route handler.
- **Tidak ditemukan elemen klik non-semantik** (`<div/span/li/p/tr onClick>` tanpa `role`/`tabIndex` = 0).

---

## 3. Temuan P0 — Keamanan, Bug Fungsional, Dead UI & Build/Lint Blocker

### P0-1. Stored XSS pada `product.description` (Store & Admin)

- **Sumber:**
  - [apps/store/src/app/products/[id]/page.tsx](../../../apps/store/src/app/products/%5Bid%5D/page.tsx#L489)
  - [apps/admin/src/app/admin/products/[id]/page.tsx](../../../apps/admin/src/app/admin/products/%5Bid%5D/page.tsx#L243)
- **Fakta:** Kedua halaman merender `product.description` menggunakan `dangerouslySetInnerHTML={{ __html: product.description }}` tanpa sanitasi HTML. Padahal data deskripsi berasal dari sinkronisasi eksternal Jubelio, sedangkan halaman CMS sudah menerapkan `rehype-sanitize` di [MarkdownRenderer.tsx](../../../packages/ui/src/components/markdown/MarkdownRenderer.tsx#L5-L20).
- **Dampak:** Jika deskripsi item di Jubelio mengandung tag berbahaya (`<script>`, `<img onerror=...>`, atau event handler inline), skrip akan dieksekusi di browser customer maupun sesi admin yang sedang login.
- **Rekomendasi:** Sanitasi HTML dengan allowlist aman (mis. `sanitize-html` atau pipeline rehype/DOMPurify yang konsisten di server & client) sebelum ditampilkan, atau render lewat helper sanitasi terpusat di `@marketplace/ui`.

### P0-2. Kontrol UI Mati (Unwired) & Bug Navigasi di Halaman Akun Store

- **Sumber:** [apps/store/src/app/account/page.tsx](../../../apps/store/src/app/account/page.tsx#L94-L310) & [apps/store/src/components/Header.tsx](../../../apps/store/src/components/Header.tsx#L179-L189)
- **Fakta terverifikasi:**
  1. **Tombol "Keluar"** ([account/page.tsx:261-266](../../../apps/store/src/app/account/page.tsx#L261-L266)) tidak memiliki `onClick` handler — mengklik tombol tersebut tidak melakukan logout.
  2. **Input "Cari pesanan..." dan tombol Filter** ([account/page.tsx:278-288](../../../apps/store/src/app/account/page.tsx#L278-L288)) tidak terhubung ke state maupun query API (`Search` & `Filter` murni visual tanpa efek).
  3. **Tombol "Coba Lagi" saat error** ([account/page.tsx:303-308](../../../apps/store/src/app/account/page.tsx#L303-L308)) menjalankan `onClick={() => setActiveTab("orders")}`. Karena tab sudah `"orders"`, state tidak berubah sehingga `useEffect` tidak pernah berjalan ulang untuk retry fetch.
  4. **Navigasi "Profil Saya" salah tujuan:** `Header.tsx` mengarahkan "Profil Saya" ke `/account` ([baris 179](../../../apps/store/src/components/Header.tsx#L179)) dan "Pesanan Saya" ke `/account?tab=orders` ([baris 185](../../../apps/store/src/components/Header.tsx#L185)), tetapi `AccountPage` mengabaikan `searchParams` dan selalu memulai dengan `useState("orders")` ([baris 97](../../../apps/store/src/app/account/page.tsx#L97)). Contoh: customer mengklik "Profil Saya" di menu avatar, namun tetap mendarat di "Riwayat Pesanan".
  5. **Tombol kamera di avatar** ([account/page.tsx:222-228](../../../apps/store/src/app/account/page.tsx#L222-L228)) tidak punya handler maupun `aria-label`, dan badge `"Member Silver"` ([baris 236](../../../apps/store/src/app/account/page.tsx#L236)) bersifat hardcoded.
- **Rekomendasi:** Hubungkan `Keluar` ke alur `signOut` yang sama dengan `Header.tsx`; baca `?tab=` dari URL; ganti retry error memakai counter/callback fetch; dan putuskan bersama pemilik produk apakah fitur search/filter pesanan, upload avatar, dan tier member akan diimplementasikan atau disembunyikan sementara agar tidak ada kontrol mati.

### P0-3. Broken Link 404 pada Daftar Produk Admin

- **Sumber:** [apps/admin/src/app/admin/products/page.tsx](../../../apps/admin/src/app/admin/products/page.tsx#L148-L154)
- **Fakta:** Nama produk dibungkus `<Link href={`/products/${product.slug}`} target="_blank">` di dalam `apps/admin` (origin `http://localhost:3001`), padahal route `/products/[slug]` hanya ada di `apps/store` (`http://localhost:3000`). Helper [toStoreUrl()](../../../apps/admin/src/lib/store-url.ts#L23-L29) sebenarnya sudah tersedia dan dipakai di halaman admin lain.
- **Dampak:** Setiap klik nama produk di tabel `/admin/products` membuka tab baru ke halaman 404.
- **Rekomendasi:** Ganti target tautan ke `toStoreUrl(`/products/${product.slug}`)` (dengan `rel="noopener noreferrer"`) atau arahkan ke halaman detail admin `/admin/products/${product.id}` sesuai kebutuhan operator.

### P0-4. Landing Redirect Admin Mengabaikan Modul `discounts` dan `prices`

- **Sumber:** [apps/admin/src/app/admin/page.tsx](../../../apps/admin/src/app/admin/page.tsx#L20-L32) vs [apps/admin/src/components/AdminSidebar.tsx](../../../apps/admin/src/components/AdminSidebar.tsx#L67-L82)
- **Fakta:** `LANDING_MODULES` hanya mencantumkan `products`, `orders`, `notifications`, `branches`, `analytics`, `customers`, `homepage`, `pages`, `users`, `roles`, `footer` — tidak menyertakan `discounts` maupun `prices`.
- **Dampak:** Operator dengan custom role yang hanya punya izin `view` pada `discounts` atau `prices` akan melihat pesan **"Akses Terbatas"** saat membuka `/admin` setelah login, meskipun sidebar menampilkan menu tersebut.
- **Rekomendasi:** Tambahkan mapping landing route untuk `discounts` (`/admin/discounts`) dan `prices` (`/admin/products/harga`) ke `LANDING_MODULES`.

### P0-5. Kegagalan `npm run lint:store` (2 ESLint Errors)

- **Sumber:** [apps/store/src/components/checkout/CheckoutAddressDialog.tsx](../../../apps/store/src/components/checkout/CheckoutAddressDialog.tsx#L158) dan [baris 256](../../../apps/store/src/components/checkout/CheckoutAddressDialog.tsx#L256)
- **Fakta:** `npm run lint:store` keluar dengan exit code 1 karena 2 pelanggaran `react-hooks/set-state-in-effect`:
  - Baris 158: `setOptions([])` dipanggil sinkron di body `useEffect` saat `index > 0 && !parentId`.
  - Baris 256: `setDraft(...)` dan `setRequestKey(...)` dipanggil sinkron di body `useEffect` saat transisi `open`.
- **Dampak:** Gate lint store merah dan memicu cascading render yang tidak perlu saat dialog alamat dibuka atau parent wilayah berubah.
- **Rekomendasi:** Pindahkan reset `draft`/`requestKey` ke event handler pembuka dialog (atau key remount pada konten dialog) dan derive/reset `options` saat perubahan pilihan parent.

### P0-6. Bug Infinite Scroll & Counter Produk Tidak Sinkron di Katalog Store

- **Sumber:**
  - [apps/store/src/components/InfiniteProductGrid.tsx](../../../apps/store/src/components/InfiniteProductGrid.tsx#L85-L105)
  - [apps/store/src/app/products/page.tsx](../../../apps/store/src/app/products/page.tsx#L60-L62)
- **Fakta:**
  1. `loadMore` memanggil `fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/products?...`)` alih-alih path relatif `/api/products?...`. Bila origin akses berbeda (mis. `127.0.0.1`, staging, atau reverse proxy tanpa env client tepat), fetch bisa gagal karena CORS/origin mismatch.
  2. Blok `catch` hanya melakukan `console.error` lalu `setHasMore(false)` secara diam-diam — pengguna tidak mendapat feedback error maupun tombol "Coba muat lagi".
  3. Counter `"Menampilkan {products.length} dari {pagination.total} produk"` di `products/page.tsx` di-render sekali di Server Component, sehingga tetap menampilkan angka awal (mis. `20`) walau grid sudah memuat 40/60 produk.
- **Rekomendasi:** Gunakan URL relatif `/api/products`, tambahkan state `loadError` + tombol retry di bawah grid, dan pindahkan counter jumlah tampil ke dalam komponen grid atau tampilkan total keseluruhan secara jelas.

### P0-7. Dead Code Peninggalan Pemisahan Store–Admin

- **Sumber:**
  - [apps/store/src/components/Header.tsx](../../../apps/store/src/components/Header.tsx#L190-L197) (`user.role === "admin"` → `<Link href="#admin">`)
  - [apps/store/src/components/LayoutWrapper.tsx](../../../apps/store/src/components/LayoutWrapper.tsx#L15-L16) (`pathname?.startsWith("#admin")`)
  - [apps/admin/src/app/admin/marketing/page.tsx](../../../apps/admin/src/app/admin/marketing/page.tsx#L1-L36) (halaman placeholder *"Segera Hadir — Voucher, diskon..."* yang tidak ada di sidebar)
- **Dampak:** `LayoutWrapper` memaksa Client Component boundary tanpa alasan karena `usePathname()` tidak pernah diawali `#admin`; menu `#admin` di Header tidak valid untuk arsitektur dua aplikasi terpisah; `/admin/marketing` berpotensi membingungkan bila diakses langsung via URL lama.

---

## 4. Temuan P1 — UX, Mobile Responsiveness, Konsistensi & Accessibility

### P1-1. Pengalaman Mobile (`< 768px`) Belum Memadai di Store & Admin

- **Store Header ([Header.tsx](../../../apps/store/src/components/Header.tsx#L104-L128)):** Search bar (`hidden md:flex`) dan tautan Cabang (`hidden md:inline-flex`) hilang sepenuhnya di mobile tanpa fallback tombol search/drawer. Pembeli di ponsel pada homepage tidak bisa mencari produk atau melihat daftar cabang dari header.
- **Admin Sidebar ([AdminSidebar.tsx](../../../apps/admin/src/components/AdminSidebar.tsx#L148-L179)):** Pada layar mobile, 14 link navigasi tampil sebagai blok `flex-wrap` permanen di atas konten utama (tidak dapat dilipat menjadi drawer/sheet), sehingga memakan ruang vertikal besar di setiap halaman. Selain itu ikon `Tag` dipakai ganda untuk *Harga SKU* dan *Diskon* ([baris 69 & 74](../../../apps/admin/src/components/AdminSidebar.tsx#L69-L74)).

### P1-2. Inkonsistensi Pola Halaman & Kontrak List/Table di Admin

Mengacu pada `ux-design` §4A dan `development-workflow` §2 (*Kontrak list/table*), halaman-halaman admin belum mengikuti standar yang seragam:

| Halaman | Temuan Inkonsistensi / Masalah UX | Sumber |
|---|---|---|
| `/admin/orders` | Search memicu `router.replace()` + network fetch pada **setiap ketikan** tanpa debounce; memakai raw `<select>` dengan `bg-background` (bukan `--field`); error hanya `<p role="alert">` tanpa styling/retry; tidak ada loading state di tabel; bahasa campur Inggris–Indonesia (`Orders`, `Pending Payment`, `Previous`/`Next` vs `Cari pesanan`, `Halaman`). | [admin/orders/page.tsx](../../../apps/admin/src/app/admin/orders/page.tsx#L16-L117) |
| `/admin/products` | Tidak ada error UI saat fetch gagal (hanya `console.error`, tampil *"Tidak ada produk ditemukan"* sehingga error tersamar sebagai empty state); `search`/`page` hanya di `useState` (hilang saat refresh/back). | [admin/products/page.tsx](../../../apps/admin/src/app/admin/products/page.tsx#L61-L144) |
| `/admin/customers` | Header halaman & 4 KPI card berbahasa Inggris (*Customer directory*, *Registered customers*, *Onboarding completed*, *Pending onboarding*), sedangkan Card tabel di bawahnya berbahasa Indonesia (*Daftar Customer*). | [admin/customers/page.tsx](../../../apps/admin/src/app/admin/customers/page.tsx#L11-L78) |
| `/admin/discounts` | Merender `<h1>Diskon</h1>` padahal [admin/layout.tsx:63](../../../apps/admin/src/app/admin/layout.tsx#L63) sudah memiliki `<h1>Admin Dashboard</h1>` (dua `<h1>` dalam satu halaman), sementara halaman lain memakai `<h2>` dengan skala berbeda (`text-2xl` vs `text-3xl`). | [admin/discounts/page.tsx](../../../apps/admin/src/app/admin/discounts/page.tsx#L14) |
| `/admin/discounts/[id]` | Masih menggunakan browser native `window.confirm(...)` saat reload versi terbaru dalam kondisi dirty, padahal shared [ConfirmDialog](../../../packages/ui/src/components/ui/confirm-dialog.tsx#L27) sudah tersedia. | [discount-editor-client.tsx](../../../apps/admin/src/app/admin/discounts/%5Bid%5D/discount-editor-client.tsx#L579) |

### P1-3. Pelanggaran Accessibility & Semantik HTML

1. **Nested interactive elements (`<a>` membungkus `<button>`):** Melanggar spesifikasi HTML5 dan menimbulkan double focus stop untuk keyboard/screen reader. Ditemukan di:
   - [apps/store/src/components/Header.tsx](../../../apps/store/src/components/Header.tsx#L119-L142) dan [baris 210-226](../../../apps/store/src/components/Header.tsx#L210-L226)
   - [apps/admin/src/components/AdminSidebar.tsx](../../../apps/admin/src/components/AdminSidebar.tsx#L162-L176)
   - [apps/admin/src/app/admin/products/[id]/page.tsx](../../../apps/admin/src/app/admin/products/%5Bid%5D/page.tsx#L141-L145) dan [baris 162-166](../../../apps/admin/src/app/admin/products/%5Bid%5D/page.tsx#L162-L166)
   - **Solusi:** Gunakan `<Button asChild><Link href="...">...</Link></Button>`.
2. **19 tombol `size="icon"` tanpa `aria-label` maupun `title`:** Screen reader hanya membacakan "button" tanpa nama aksesibel. Contoh: tombol hapus di [NotificationBell.tsx:127-139](../../../apps/admin/src/components/NotificationBell.tsx#L127-L139), aksi baris di [admin/homepage/page.tsx:354-365](../../../apps/admin/src/app/admin/homepage/page.tsx#L354-L365), [admin/notifications/page.tsx:312,355](../../../apps/admin/src/app/admin/notifications/page.tsx#L312), dan tombol reorder di form homepage (`BannerSectionForm`, `CarouselProductSectionForm`, `PromoCardsSectionForm`).
3. **Atribut bahasa HTML tidak sesuai di Store:** [apps/store/src/app/layout.tsx:23](../../../apps/store/src/app/layout.tsx#L23) memakai `<html lang="en">` padahal seluruh konten storefront berbahasa Indonesia (`apps/admin/src/app/layout.tsx:21` sudah benar `<html lang="id">`).
4. **Potensi teks ukuran terpotong:** Tombol pilih ukuran di [products/[id]/page.tsx:303](../../../apps/store/src/app/products/%5Bid%5D/page.tsx#L303) memakai `w-12 h-12 p-0` (lebar tetap 48px), rawan memotong label panjang seperti `"All Size"` atau `"42.5"`. Sebaiknya `min-w-12 h-12 px-3`.
5. **Hardcoded Tailwind palette colors (tidak dark-mode safe):** Tersebar di luar komponen `StatusBadge`, terutama [admin/orders/[id]/page.tsx](../../../apps/admin/src/app/admin/orders/%5Bid%5D/page.tsx) (19 baris), [checkout/page.tsx](../../../apps/store/src/app/checkout/page.tsx) (13 baris), [account/orders/[id]/page.tsx](../../../apps/store/src/app/account/orders/%5Bid%5D/page.tsx) (6 baris), [admin/orders/reviews/page.tsx](../../../apps/admin/src/app/admin/orders/reviews/page.tsx) (5 baris), dan chip atribut di [ProductCard.tsx:130-137](../../../packages/ui/src/components/store/ProductCard.tsx#L130-L137).

### P1-4. Tidak Ada App Router Error / Not-Found / Loading Boundaries

- Kedua app (`apps/store/src/app` dan `apps/admin/src/app`) memiliki **0 file** `error.tsx`, `global-error.tsx`, `not-found.tsx`, dan `loading.tsx`.
- Contoh dampak: saat `getHomepageSections()` di [apps/store/src/app/page.tsx:8](../../../apps/store/src/app/page.tsx#L8) atau `getProducts()` di [apps/store/src/app/products/page.tsx:28](../../../apps/store/src/app/products/page.tsx#L28) melempar error, atau saat customer membuka URL produk/halaman yang tidak ada, pengguna melihat layar error/404 default Next.js berbahasa Inggris tanpa konteks brand atau tombol pemulihan.

---

## 5. Temuan P2 — Arsitektur Codebase & Maintainability

### P2-1. 55 dari 108 Route Handler Masih Berisi Query Drizzle Langsung

Sesuai [code-organization.md](../../../docs/architecture/code-organization.md#L23-L25) dan `maintainable-code` §2, `route.ts` seharusnya hanya menjadi HTTP adapter tipis. Route handler terbesar yang masih memegang query/orkestrasi langsung:

| Baris | Path |
|---:|---|
| 893 | [apps/store/src/app/api/checkout/preview/route.ts](../../../apps/store/src/app/api/checkout/preview/route.ts) |
| 557 | [apps/store/src/app/api/homepage/route.ts](../../../apps/store/src/app/api/homepage/route.ts) |
| 425 | [apps/admin/src/app/api/admin/homepage/preview-all/route.ts](../../../apps/admin/src/app/api/admin/homepage/preview-all/route.ts) |
| 421 | [apps/admin/src/app/api/admin/orders/[id]/route.ts](../../../apps/admin/src/app/api/admin/orders/%5Bid%5D/route.ts) |
| 418 | [apps/store/src/app/api/products/route.ts](../../../apps/store/src/app/api/products/route.ts) |
| 393 | [apps/admin/src/app/api/admin/homepage/[id]/route.ts](../../../apps/admin/src/app/api/admin/homepage/%5Bid%5D/route.ts) |
| 367 | [apps/admin/src/app/api/admin/branches/[id]/route.ts](../../../apps/admin/src/app/api/admin/branches/%5Bid%5D/route.ts) |

*(Catatan: `maintainable-code` §8 menegaskan migrasi dilakukan bertahap saat fitur disentuh, bukan refactor massal sekaligus.)*

### P2-2. Konsentrasi File Monolitik (> 1.000 Baris)

Terdapat 11 file non-test melebihi 1.000 baris (review signal repo: ~300 baris untuk evaluasi cohesion):

- **Backend domain/orchestration:**
  - [apps/admin/src/lib/discounts-administration.ts](../../../apps/admin/src/lib/discounts-administration.ts) (**3.579 baris**)
  - [packages/db/src/seed.ts](../../../packages/db/src/seed.ts) (**3.177 baris**)
  - [apps/store/src/lib/jubelio-channel-mirror.ts](../../../apps/store/src/lib/jubelio-channel-mirror.ts) (**3.128 baris**)
  - [apps/store/src/lib/jubelio-sales-client.ts](../../../apps/store/src/lib/jubelio-sales-client.ts) (**2.959 baris**)
  - [apps/admin/src/lib/price-changes-administration.ts](../../../apps/admin/src/lib/price-changes-administration.ts) (**2.756 baris**)
  - [apps/store/src/lib/jubelio-sales-lifecycle.ts](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts) (**1.633 baris**)
  - [apps/admin/src/lib/price-workbook.ts](../../../apps/admin/src/lib/price-workbook.ts) (**1.131 baris**)
  - [packages/db/src/jubelio-sync.ts](../../../packages/db/src/jubelio-sync.ts) (**1.104 baris**)
- **Frontend UI monoliths:**
  - [apps/store/src/app/checkout/page.tsx](../../../apps/store/src/app/checkout/page.tsx) (**2.499 baris** — juga memicu lint warning `react-hooks/exhaustive-deps` di baris 568 akibat kompleksitas state)
  - [apps/admin/src/app/admin/orders/[id]/page.tsx](../../../apps/admin/src/app/admin/orders/%5Bid%5D/page.tsx) (**1.440 baris**)
  - [apps/admin/src/app/admin/products/harga/price-change-client.tsx](../../../apps/admin/src/app/admin/products/harga/price-change-client.tsx) (**1.004 baris**)
  - *(Hampir 1.000 baris: [discount-editor-client.tsx](../../../apps/admin/src/app/admin/discounts/%5Bid%5D/discount-editor-client.tsx) — 998 baris)*

Pola referensi yang sudah berhasil memecah monolith di repo ini ada di `apps/store/src/features/checkout/place-*` (didokumentasikan di [code-organization.md](../../../docs/architecture/code-organization.md#L85-L112)).

### P2-3. Server Component Memanggil Route Handler Secara Langsung

- [apps/store/src/app/page.tsx](../../../apps/store/src/app/page.tsx#L2-L5) mengimpor `GET` dari `@/app/api/homepage/route` lalu menjalankan `await res.json()`.
- [apps/store/src/app/products/page.tsx](../../../apps/store/src/app/products/page.tsx#L8-L25) mengimpor `GET` dari `@/app/api/products/route` lalu membangun `new NextRequest("http://internal.local/api/products?...")`.
- Sesuai [code-organization.md](../../../docs/architecture/code-organization.md#L229-L231), Server Component sebaiknya memanggil fungsi query/DAL server-side bersama secara langsung, dan `route.ts` memanggil fungsi DAL yang sama.

### P2-4. `console.error` di Kode Server Non-API & Warning ESLint Menumpuk

- Di luar `/api/**`, beberapa kode server masih memakai `console.error` langsung alih-alih `createModuleLogger`: [onboarding/actions.ts:91](../../../apps/store/src/app/onboarding/actions.ts#L91), [FooterWrapper.tsx:26](../../../apps/store/src/components/FooterWrapper.tsx#L26), dan [pages/[slug]/page.tsx:35](../../../apps/store/src/app/pages/%5Bslug%5D/page.tsx#L35).
- Terdapat 44 warning ESLint (6 di store, 38 di admin) yang sebagian besar berupa unused imports/variables + 1 penggunaan `window.location.assign()` untuk navigasi internal di [price-change-excel-client.tsx:246](../../../apps/admin/src/app/admin/products/harga/price-change-excel-client.tsx#L246).

---

## 6. Temuan P3 — Performance & SEO

### P3-1. Halaman Detail Produk (`/products/[id]`) Pure Client Component

- **Sumber:** [apps/store/src/app/products/[id]/page.tsx](../../../apps/store/src/app/products/%5Bid%5D/page.tsx#L1-L101)
- **Fakta:** Seluruh halaman bertanda `"use client"` dan baru memuat detail produk via `fetch('/api/products/${productId}')` di dalam `useEffect`.
- **Dampak:**
  - Tidak ada `generateMetadata()` — title, description, dan Open Graph image saat link produk dibagikan (WhatsApp/media sosial) maupun diindeks mesin pencari selalu generik `"ADF Sports"`.
  - Waktu tunggu lebih lama (HTML awal → hydrate JS → fetch API → render konten).
- **Rekomendasi:** Jadikan `page.tsx` sebagai Server Component dengan `generateMetadata()`, baca produk dari fungsi query/DAL, kembalikan `notFound()` jika tidak ditemukan, lalu kirim data awal ke `ProductDetailClient`.

### P3-2. Duplikasi Query DB di Halaman CMS Statis

- **Sumber:** [apps/store/src/app/pages/[slug]/page.tsx](../../../apps/store/src/app/pages/%5Bslug%5D/page.tsx#L19-L60)
- **Fakta:** `getStaticPage(slug)` dipanggil dua kali per request (`generateMetadata` dan `StaticPage`) tanpa `React.cache()`. Membungkusnya dengan `cache(...)` dari `react` mencegah double query ke PostgreSQL per kunjungan halaman.

### P3-3. Optimasi Gambar Next.js Dimatikan (`images: { unoptimized: true }`)

- **Sumber:** [apps/store/next.config.ts:24](../../../apps/store/next.config.ts#L24) dan [apps/admin/next.config.ts:27](../../../apps/admin/next.config.ts#L27)
- **Fakta:** Semua `<Image />` dirender tanpa resize maupun konversi WebP/AVIF otomatis. Catatan: di [admin/products/[id]/page.tsx:191](../../../apps/admin/src/app/admin/products/%5Bid%5D/page.tsx#L191) juga masih ada 1 tag `<img>` mentah dengan komentar hotlink Jubelio.
- **Trade-off:** Mengaktifkan optimasi Next.js untuk gambar hotlink Jubelio membutuhkan daftar `remotePatterns` host gambar Jubelio yang pasti dan stabil serta pertimbangan beban CPU container Next.js.

---

## 7. Transisi dari Research ke Alignment (Open Items)

Sesuai [development-workflow SKILL](../../../.agents/skills/development-workflow/SKILL.md#L24-L49), seluruh hal yang belum tuntas dikelompokkan sebagai berikut:

### A. Fakta belum diketahui (dapat diverifikasi agent tanpa meminta user menebak)

1. **Verifikasi visual & responsif di browser nyata:** belum ada bukti rendered UI (desktop/mobile, light/dark, focus ring, computed contrast) untuk memastikan apakah ada regresi layout tersembunyi di luar audit statis.
2. **Security headers di layer deployment:** belum dicek apakah `deployment/*/Caddyfile` sudah menyetel CSP, `X-Frame-Options`, `X-Content-Type-Options`, dan `Referrer-Policy`.
3. **Host gambar Jubelio aktual:** bila optimasi Next.js Image dipertimbangkan, perlu dicek daftar hostname gambar di DB/Jubelio agar `remotePatterns` tidak memutus gambar produksi.
4. **Status referensi `/admin/marketing`:** perlu dicek apakah masih ada link internal, dokumentasi, atau E2E test yang mengarah ke `/admin/marketing`.

### B. Keputusan user diperlukan (produk & prioritas)

1. **Cakupan perbaikan halaman `/account` di Store ([account/page.tsx](../../../apps/store/src/app/account/page.tsx#L222-L289)):**
   - Saat ini ada tombol upload foto avatar (ikon kamera), badge `"Member Silver"`, serta input search + tombol filter pesanan yang semuanya belum berfungsi.
   - **Opsi:**
     - *(Direkomendasikan untuk quick win)* Perbaiki fitur yang sudah ada backend-nya (`Keluar`, query `?tab=`, tombol retry error), lalu **hapus/sembunyikan** kontrol mati (ikon kamera, badge placeholder, search/filter yang belum ada backend) sampai fiturnya direncanakan resmi.
     - Atau buat spesifikasi terpisah untuk membangun fitur search/filter riwayat pesanan dan upload foto profil.
2. **Target klik nama produk di `/admin/products` ([admin/products/page.tsx:149](../../../apps/admin/src/app/admin/products/page.tsx#L149)):**
   - Saat ini `<Link href="/products/{slug}" target="_blank">` membuka 404 di port admin.
   - **Opsi:**
     - *(Direkomendasikan)* Arahkan ke URL storefront lewat `toStoreUrl("/products/{slug}")` bila tujuannya memang pratinjau halaman publik di tab baru (dan tetap pertahankan tombol aksi "Lihat detail" ke `/admin/products/{id}`).
     - Atau arahkan langsung ke `/admin/products/{id}` di tab yang sama agar operator tetap di dashboard admin.
3. **Standardisasi bahasa UI Admin (`/admin/orders`, `/admin/customers`, dll.):**
   - Beberapa label status/heading masih campuran Inggris–Indonesia (perhatian khusus: perubahan label teks bisa memengaruhi selector/assertion pada E2E test yang ada).
   - **Opsi:** Seragamkan seluruh copy UI admin ke bahasa Indonesia secara bertahap (dengan update test terkait), atau pertahankan label status bahasa Inggris tertentu bila memang disengaja untuk konsistensi operasional.
4. **Urutan prioritas eksekusi & apakah ingin menyertakan refactor struktural:**
   - **Opsi A (Direkomendasikan — bertahap per vertical slice):**
     1. *Slice 1 (Quick Wins Keamanan, Bug & Lint):* sanitasi `product.description`, fix 404 link `/admin/products`, fix `LANDING_MODULES` `/admin`, hapus dead code `#admin`/`LayoutWrapper`, dan fix 2 error `lint:store` di `CheckoutAddressDialog.tsx`.
     2. *Slice 2 (UX Store):* perbaikan `/account`, mobile search + cabang di `Header`, fix `InfiniteProductGrid` + counter, `<html lang="id">`, dan tambah `error.tsx`/`not-found.tsx`.
     3. *Slice 3 (UX Admin):* debounce + error/loading state `/admin/orders`, error state `/admin/products`, mobile drawer `AdminSidebar`, ganti `window.confirm` di editor diskon, serta `aria-label` tombol ikon.
     4. *Slice 4 (SEO & Performance):* migrasi `/products/[id]` ke Server Component + `generateMetadata()`, dan `React.cache()` di `/pages/[slug]`.
   - **Opsi B:** Fokus hanya pada keamanan & bug fungsional (Slice 1) terlebih dahulu, menunda perbaikan UX lintas halaman dan refactor monolith.

### C. Di luar scope (Non-goals)

- Refactor massal seluruh 55 route handler atau pemecahan sekaligus 11 file > 1.000 baris di luar fitur yang sedang disentuh (mengikuti `maintainable-code` §8).
- Perubahan aturan bisnis, skema database (`packages/db/src/schema/`), kontrak API publik, atau palet warna status semantik yang sudah disepakati di [status-colors.md](../../../docs/features/status-colors.md).
- Pembuatan desain visual/tema baru; seluruh perbaikan UX harus memakai token dan komponen `@marketplace/ui` yang ada.

---

## 8. Rekomendasi Jalur Berikutnya

- **Rekomendasi jalur:** **Klarifikasi langsung → Alignment menuju plan/spec** untuk slice yang Anda pilih (bukan `wayfinder`, karena mayoritas temuan P0–P1 berupa bug/pelanggaran standar jelas yang hanya memerlukan 3–4 keputusan ringan di bagian 7B).
- Untuk **Slice 1** (bug fix & lint yang scope-nya sudah tegas), pekerjaan dapat masuk ke alignment percakapan singkat atau satu spec ringkas. Untuk **Slice 2–3** yang menyentuh banyak halaman UI, disarankan menyusun spec + UX blueprint lewat `/plan` terlebih dahulu agar kontrak list/table, state matrix, dan copy final disetujui sebelum coding.
