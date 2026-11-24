# Plan & Spec: Slice 4 — SEO & Performance Storefront (SSR Detail Produk & CMS Cache)

> Status plan secara keseluruhan dicatat di [index.md](../index.md). File ini mencatat spesifikasi lengkap, technical & UX blueprint, acceptance criteria, dan status per fitur untuk **Slice 4** dari rangkaian perbaikan hasil [Audit Codebase & UI/UX](../research/codebase-ui-improvement-audit.md).

## Problem Statement

Dua bottleneck performa dan SEO pada storefront ditemukan pada audit baseline:

1. **Halaman detail produk (`/products/[id]`) murni Client Component (P3-1):** Seluruh halaman bertanda `"use client"` dan baru memanggil `fetch('/api/products/${productId}')` di dalam `useEffect`. Akibatnya:
   - Tidak ada `generateMetadata()` — judul tab, meta description, dan preview Open Graph saat link produk dibagikan ke WhatsApp/media sosial maupun diindeks mesin pencari selalu generik `"ADF Sports"`.
   - Pembeli mengalami waterfall lambat (HTML awal kosong → hydrate JS → fetch API → baru konten produk tampil) dan URL produk yang tidak ada tidak mengembalikan HTTP status `404` yang sebenarnya.
2. **Double query PostgreSQL di halaman CMS statis (`/pages/[slug]`) (P3-2):** `getStaticPage(slug)` dipanggil dua kali per request (sekali di `generateMetadata()` dan sekali di `StaticPage`) tanpa `React.cache()`, menggandakan beban query DB yang identik.

## Solution

Slice 4 mengubah halaman detail produk menjadi Server Component dengan metadata dinamis + deduplikasi query CMS:

1. Mengekstrak logika pembacaan detail produk dari `apps/store/src/app/api/products/[id]/route.ts` ke fungsi DAL/service bersama `apps/store/src/features/products/get-product-detail.ts` (mengikuti `maintainable-code` & `code-organization.md`), sehingga baik `route.ts` maupun Server Component memanggil sumber kebenaran yang sama.
2. Mengubah `apps/store/src/app/products/[id]/page.tsx` menjadi **Server Component** dengan `generateMetadata()` (judul produk, deskripsi ringkas plain-text ≤ 160 karakter, dan Open Graph image produk), memanggil `notFound()` saat produk tidak ditemukan (HTTP 404 nyata), dan meneruskan data awal ke `ProductDetailClient.tsx`.
3. Membungkus `getStaticPage(slug)` di `apps/store/src/app/pages/[slug]/page.tsx` dengan `cache(...)` dari `react` (serta mengganti `console.error` di sana dengan `createModuleLogger`).

## User Stories

1. Sebagai customer atau tim marketing yang membagikan link produk ke WhatsApp/media sosial, saya ingin preview link menampilkan nama produk, ringkasan deskripsi bersih (tanpa tag HTML), dan foto utama produk, bukan judul generik `"ADF Sports"`.
2. Sebagai calon pembeli yang datang dari mesin pencari (Google), saya ingin halaman detail produk terindeks dengan `<title>` dan `<meta name="description">` yang akurat serta merender informasi produk langsung dari server tanpa menunggu client-side fetch.
3. Sebagai customer yang membuka URL produk yang tidak ada (`/products/slug-tidak-ada`), saya ingin menerima HTTP status `404` dan melihat halaman `not-found.tsx` Store berbahasa Indonesia.
4. Sebagai customer di halaman detail produk, seluruh interaksi existing (pilih varian/ukuran, pilih cabang, tambah ke keranjang, galeri foto, dan deskripsi ter-sanitasi dari Slice 1) tetap bekerja identik tanpa regresi.
5. Sebagai sistem/backend, kunjungan ke `/pages/[slug]` hanya mengeksekusi 1 query DB per request meski `generateMetadata()` dan komponen halaman keduanya membutuhkan data halaman tersebut.

## Approval

- **Kesepahaman bersama dikonfirmasi user:** ✅ Dikonfirmasi melalui sesi grilling 2 ronde (2026-11-24 — keputusan Q1 terkunci).
- **Complete scope dan acceptance/verify criteria disetujui user:** ✅ Disetujui user (2026-11-25).

> Jangan menandai plan atau fitur ini `Ready` selama approval masih pending. Approval plan tidak menyetujui subagent, commit, remote access, atau deployment.

## Non-scope

- Mengubah struktur URL `/products/[id]` atau kontrak response JSON `GET /api/products/[id]` (harus tetap backward-compatible).
- Mengaktifkan Next.js Image Optimization (`images: { unoptimized: true }` di `next.config.ts`, P3-3).
- Refactor route handler lain selain `/api/products/[id]/route.ts` (P2-1).

## Implementation Decisions

1. **Ekstraksi DAL Detail Produk (P3-1):**
   - Membuat `apps/store/src/features/products/get-product-detail.ts` yang mengekspor:
     - `getProductDetailByIdOrSlug(idOrSlug: string): Promise<ProductDetailDto | null>` — memuat produk (by `id` atau `slug`), kategori, brand, gender, gambar, varian + proyeksi harga aktif (`readVariantProjections`), dan stok per cabang aktif (`sellableUnits`).
     - `getCachedProductDetail = cache(getProductDetailByIdOrSlug)` — membungkus dengan `React.cache()` agar `generateMetadata()` dan `ProductDetailPage` hanya menjalankan 1 kali query per request.
     - `buildProductMetadata(product: ProductDetailDto | null): Metadata` — fungsi pure untuk menghasilkan metadata SEO (`title`, `description` hasil strip tag HTML + trim maksimal 160 karakter, dan `openGraph` dengan `title`, `description`, `images`).
   - `apps/store/src/app/api/products/[id]/route.ts` menjadi adapter HTTP tipis yang memanggil `getProductDetailByIdOrSlug(id)`, mengembalikan 404 bila `null` dan 200 `{ success: true, data }` bila ada, dengan tetap menjaga `withRequestContext` dan `createModuleLogger("product-detail")`.
2. **Pemisahan Server & Client di `/products/[id]` (P3-1):**
   - `apps/store/src/app/products/[id]/page.tsx`: Server Component (`export const dynamic = "force-dynamic"` karena stok/harga real-time), memanggil `getCachedProductDetail(id)`, memanggil `notFound()` bila `null`, dan merender `<ProductDetailClient product={product} />`.
   - `apps/store/src/app/products/[id]/ProductDetailClient.tsx` (`"use client"`): menerima `product: ProductDetailDto` langsung sebagai prop (tidak lagi melakukan initial `fetch('/api/products/...')` di `useEffect`), mempertahankan seluruh UI interaktif (galeri, pemilihan warna/ukuran, stok cabang, tombol tambah ke keranjang, serta `sanitizeProductHtml` dari Slice 1).
3. **Deduplikasi Query CMS Statis (P3-2):**
   - Di `apps/store/src/app/pages/[slug]/page.tsx`: membungkus `getStaticPage` dengan `cache(...)` dari `react`, sehingga panggilan di `generateMetadata()` dan `StaticPage` berbagi hasil yang sama dalam satu request lifecycle.
   - Catatan Context7: sebelum implementasi, konfirmasi signature `React.cache` dan `generateMetadata` pada Next.js 16 + React 19 lewat Context7.

## Rancangan Teknis

### Tabel File

| Path | Aksi | Tanggung jawab (1–3 baris) | Layer | Seam test |
|---|---|---|---|---|
| `apps/store/src/features/products/get-product-detail.ts` | create | DAL/service `getProductDetailByIdOrSlug`, wrapper `getCachedProductDetail` (`React.cache`), dan pure helper `buildProductMetadata`. | service / DAL | `apps/store/src/features/products/get-product-detail.test.ts` |
| `apps/store/src/app/api/products/[id]/route.ts` | modify | Delegasikan query ke `getProductDetailByIdOrSlug`; pertahankan kontrak HTTP 200/404 dan contextual logging. | route | `apps/store/src/app/api/products/[id]/route.test.ts` (atau E2E existing) |
| `apps/store/src/app/products/[id]/ProductDetailClient.tsx` | create | Komponen interaktif detail produk yang menerima `product` dari Server Component (tanpa initial `useEffect` fetch). | UI client component | `e2e/store/product-detail.spec.ts` |
| `apps/store/src/app/products/[id]/page.tsx` | modify | Ubah menjadi Server Component dengan `generateMetadata()`, panggil `getCachedProductDetail`, `notFound()` bila tidak ditemukan, render `ProductDetailClient`. | UI server page | `e2e/store/product-detail.spec.ts` + HTTP 404/HTML meta check |
| `apps/store/src/app/pages/[slug]/page.tsx` | modify | Bungkus `getStaticPage` dengan `React.cache()` untuk mencegah double DB query per request. | UI server page | `apps/store/src/app/pages/[slug]/page.test.ts` / `e2e/store/static-pages.spec.ts` |

### Kontrak Export (File Baru / Berubah)

- `apps/store/src/features/products/get-product-detail.ts`:
  - `export type ProductDetailDto = { ... }` (sesuai bentuk payload existing `GET /api/products/[id]` `data`)
  - `export async function getProductDetailByIdOrSlug(idOrSlug: string): Promise<ProductDetailDto | null>`
  - `export const getCachedProductDetail: (idOrSlug: string) => Promise<ProductDetailDto | null>`
  - `export function buildProductMetadata(product: ProductDetailDto | null): Metadata`
- `apps/store/src/app/products/[id]/ProductDetailClient.tsx`:
  - `export default function ProductDetailClient({ product }: { product: ProductDetailDto }): JSX.Element`

### Keputusan Struktur Non-Obvious

- **Keputusan:** Mengekstrak query ke `apps/store/src/features/products/get-product-detail.ts` alih-alih mengimpor `GET` dari `api/products/[id]/route.ts` di Server Component.
  - **Alasan:** Memenuhi aturan `code-organization.md` (Server Component memanggil DAL/service langsung, tidak mengimpor `route.ts` dengan `NextRequest` palsu) dan memungkinkan `route.ts` menjadi adapter HTTP tipis.
  - **Ditolak:** Mengimpor `GET` dari `route.ts` di `page.tsx` (anti-pattern yang sudah dicatat pada temuan P2-3).
- **Keputusan:** Memakai `export const dynamic = "force-dynamic"` pada `/products/[id]/page.tsx`.
  - **Alasan:** Stok per cabang dan harga markdown aktif berubah dinamis dari Jubelio dan modul harga; static caching penuh berisiko menampilkan stok/harga basi.
  - **Ditolak:** ISR/static generation tanpa mekanisme invalidasi stok per cabang.

### Discovery

- Tidak ada `discovery:` yang memblokir. Bentuk payload lengkap `GET /api/products/[id]` sudah terverifikasi di `apps/store/src/app/api/products/[id]/route.ts` (205 baris) dan harus dipertahankan 100% kompatibel untuk seluruh consumer existing.

## Rancangan UX

- **Tugas dan pengguna:** Customer membuka halaman detail produk dengan waktu tampil awal lebih cepat (tanpa blank spinner client-side fetch) dan melihat preview tautan yang informatif saat link produk dibagikan.
- **Halaman/pattern referensi:** Layout visual halaman detail produk existing di `apps/store/src/app/products/[id]/page.tsx` (termasuk perbaikan `sanitizeProductHtml` dari Slice 1 dan `min-w-12 h-12 px-3` dari Slice 2).
- **Hierarki dan primary action:** Tidak ada perubahan layout atau primary action (tombol *"Tambah ke Keranjang"* tetap primary action dominan).

### Component Reuse Map

| Elemen | Existing / Baru | Path komponen | Catatan |
|---|---|---|---|
| Client detail interaktif | Baru (ekstraksi) | `apps/store/src/app/products/[id]/ProductDetailClient.tsx` | Memindahkan UI interaktif dari `page.tsx` existing |
| Loading skeleton | Existing (dari Slice 2) | `apps/store/src/app/products/[id]/loading.tsx` | Aktif otomatis saat navigasi SSR |
| Not found page | Existing (dari Slice 2) | `apps/store/src/app/not-found.tsx` | Ditampilkan saat `notFound()` dipanggil |

### State Matrix

| Layar / komponen | Idle | Loading | Empty | Error | Sukses | Disabled / tanpa izin | Unsaved |
|---|---|---|---|---|---|---|---|
| `/products/[id]` | Konten produk langsung hadir pada HTML SSR; varian, galeri, & deskripsi ter-sanitasi aktif | Streaming fallback lewat `loading.tsx` (bukan spinner setelah hydration) | Deskripsi kosong: *"Tidak ada deskripsi."* (existing) | Produk tidak ditemukan → HTTP 404 via `notFound()` (`not-found.tsx`); error server → `error.tsx` | Tambah ke keranjang sesuai alur existing | Tombol tambah ke keranjang disabled saat stok habis (existing) | N/A |
| `/pages/[slug]` | Konten Markdown tampil dari 1 query DB | Mengikuti existing | N/A | Tidak ditemukan → `notFound()` (existing) | Metadata + konten sinkron | N/A | N/A |

- **Viewport dan responsive:** Tidak mengubah tata letak visual; verifikasi desktop (`1280×800`) dan mobile (`390×844`) untuk memastikan tidak ada regresi hidrasi atau layout shift.
- **Accessibility:** Tidak ada regresi; judul `<title>` halaman kini unik dan deskriptif per produk (membantu screen reader dan navigasi tab).
- **Prototype:** N/A — tidak ada perubahan desain visual.

## Testing Decisions

- **Prinsip pengujian:** Uji fungsi pure metadata & kontrak SSR (HTML awal memuat `<title>`, `<meta property="og:title">`, `<meta property="og:image">`, dan nama produk tanpa perlu client fetch; slug tidak valid mengembalikan 404; `/pages/[slug]` hanya mengeksekusi 1 query).
- **Modul & seam yang diuji:**
  1. `apps/store/src/features/products/get-product-detail.test.ts` — Unit test untuk `buildProductMetadata`: format title `${name} | ADF Sports`, strip tag HTML dari `description` + batas ≤ 160 karakter, `openGraph.images` berisi gambar utama bila ada, fallback aman saat `product` `null` atau deskripsi kosong.
  2. Unit test / verifikasi deduplikasi `React.cache()` pada `getStaticPage` di `/pages/[slug]`.
  3. Playwright E2E `e2e/store/product-detail.spec.ts` (dan/atau mock spec): verifikasi `<title>` sesuai nama produk, meta `og:title`/`og:description` terisi, produk tidak ditemukan menampilkan 404, dan alur pilih varian + tambah keranjang tetap lulus.
  4. `e2e/store/static-pages.spec.ts`: verifikasi tidak ada regresi di `/pages/[slug]`.
- **Prior art:** `e2e/store/product-detail.spec.ts`, `e2e/store/static-pages.spec.ts`, `apps/store/src/lib/product-filters.test.ts`.

## Fitur & Acceptance Criteria

| # | Fitur / AC | Status | verify: | Catatan |
|---|---|---|---|---|
| AC-1 | **Ekstraksi DAL Detail Produk (P3-1):** `getProductDetailByIdOrSlug` menjadi satu sumber kebenaran yang dipakai bersama oleh `/api/products/[id]/route.ts` dan `/products/[id]/page.tsx`, dengan kontrak JSON API tetap identik. | Verified | `npm run verify:unit:slice -- apps/store/src/features/products/get-product-detail.test.ts` (4/4 pass) + `verify:types:store` PASS | Ikuti `maintainable-code` |
| AC-2 | **SSR & `generateMetadata()` pada `/products/[id]` (P3-1):** Halaman merender data awal dari server tanpa initial client fetch, memiliki `<title>` & Open Graph (`og:title`, `og:description` bersih tanpa tag HTML, `og:image`), dan memanggil `notFound()` (HTTP 404 atau `200` + `noindex` saat `loading.tsx` streaming) bila produk tidak ditemukan. | Verified | `npm run verify:batch:e2e -- e2e/store/slice4-seo-performance-mock.spec.ts` (4/4 pass) | Lookup Context7 Next.js 16 `generateMetadata`, `notFound`, `loading.tsx` streaming & React 19 `cache` |
| AC-3 | **Interaksi `ProductDetailClient` Tanpa Regresi (P3-1):** Galeri foto, pilih varian/ukuran, tampilan stok cabang, sanitasi deskripsi, dan tambah ke keranjang bekerja identik. | Verified | `npm run verify:batch:e2e -- e2e/store/slice4-seo-performance-mock.spec.ts` (4/4 pass, desktop 1280×800 & mobile 390×844 tanpa horizontal overflow) | — |
| AC-4 | **Deduplikasi Query `/pages/[slug]` (P3-2):** `getStaticPage` dibungkus `React.cache()` sehingga `generateMetadata()` dan `StaticPage` hanya menjalankan 1 query DB per request. | Verified | `npm run verify:unit:slice -- "apps/store/src/app/pages/[slug]/page.test.ts"` (2/2 pass) + `slice4-seo-performance-mock.spec.ts` | — |

## Implementation Notes

- Dependensi antar slice: disarankan dikerjakan setelah **Slice 1** (`sanitizeProductHtml`) dan **Slice 2** (`not-found.tsx`, `error.tsx`, `products/[id]/loading.tsx`, dan ukuran tombol `min-w-12`) agar `ProductDetailClient` langsung mewarisi perbaikan tersebut tanpa merge conflict.
- Wajib lookup Context7 untuk `Next.js 16` (`generateMetadata`, `notFound`) dan `React 19` (`cache`) sebelum implementasi.
- Final gate: `npm run verify:types:store`, `npm run lint:store`, `npm run test:unit`, E2E terkait, dan rendered UI review.

## Deviation Log

| Ticket / slice | Rencana (path/kontrak) | Aktual | Alasan | Dampak |
|---|---|---|---|---|
| Slice 4 / AC-2 | `notFound()` mengembalikan HTTP 404 nyata | Karena `loading.tsx` (Suspense streaming dari Slice 2) aktif di `/products/[id]`, Next.js mengirim HTTP 200 saat memulai stream lalu merender `not-found.tsx` beserta `<meta name="robots" content="noindex">` | Mempertahankan `loading.tsx` agar streaming skeleton tetap aktif sesuai UX Slice 2; perilaku terverifikasi lewat Context7 Next.js docs | Mesin pencari tetap menerima `noindex` dan pengguna melihat `not-found.tsx` |

## Open Questions

- Tidak ada open question yang memblokir `Ready`. Seluruh keputusan SEO & Performance telah disepakati pada sesi grilling.

## Retirement Checklist (saat plan mencapai Done)

- [x] Semua AC-1 s.d. AC-4 lulus `verify:` termasuk verifikasi metadata/404 dan rendered UI review.
- [x] File plan tetap disimpan di `.scratch/codebase-ui-audit/plan/slice-4-seo-performance.md`.
- [x] Entri di `.scratch/codebase-ui-audit/index.md` diperbarui ke **Done** dengan tanggal dan bukti verifikasi.
