# Plan & Spec: Slice 1 — P0 Security, Bug Fungsional & Lint Blocker

> Status plan secara keseluruhan dicatat di [index.md](../index.md). File ini mencatat spesifikasi lengkap, blueprint teknis/UX, acceptance criteria, dan status per fitur untuk **Slice 1** dari rangkaian perbaikan hasil [Audit Codebase & UI/UX](../research/codebase-ui-improvement-audit.md).

## Problem Statement

Pengguna storefront dan operator admin saat ini menghadapi lima masalah kritis (P0) yang ditemukan pada audit baseline `main` (`f11b41b`):

1. **Risiko Stored XSS pada deskripsi produk (Store & Admin):** `product.description` dari sinkronisasi eksternal Jubelio dirender langsung lewat `dangerouslySetInnerHTML` tanpa sanitasi HTML, sehingga markup berbahaya dapat mengeksekusi skrip di browser customer maupun sesi admin.
2. **Broken link 404 pada daftar produk Admin:** Klik nama produk di `/admin/products` mengarah ke `/products/{slug}` pada origin admin (`localhost:3001`), menghasilkan 404 alih-alih membuka halaman produk di storefront.
3. **Operator custom role tertentu terjebak di layar "Akses Terbatas":** `LANDING_MODULES` pada `/admin` tidak menyertakan modul `discounts` maupun `prices`, sehingga operator yang hanya memiliki izin `view` pada salah satu modul tersebut gagal diarahkan setelah login.
4. **Lint Store gagal (`npm run lint:store` exit code 1):** 2 pelanggaran `react-hooks/set-state-in-effect` di `CheckoutAddressDialog.tsx` memblokir gate lint storefront dan memicu cascading render saat dialog alamat dibuka atau parent wilayah berubah.
5. **Dead code peninggalan pemisahan Store–Admin:** Menu `#admin` di Header store tidak valid, `LayoutWrapper.tsx` memaksa Client Component boundary tanpa fungsi nyata, dan route placeholder `/admin/marketing` masih dapat diakses langsung via URL lama.

## Solution

Slice 1 menutup seluruh temuan P0 tersebut secara tuntas dalam satu unit deliverable yang teruji:

1. Menyediakan helper sanitasi HTML allowlist terpusat (`sanitizeProductHtml`) di `@marketplace/ui` dan menerapkannya pada render `product.description` di Store maupun Admin.
2. Memperbaiki tautan nama produk di `/admin/products` agar membuka halaman storefront publik via `toStoreUrl("/products/{slug}")` di tab baru dengan `rel="noopener noreferrer"`, sambil mempertahankan tombol detail ke `/admin/products/{id}`.
3. Mengekstrak dan melengkapi peta landing route admin agar mendukung seluruh modul yang tampil di sidebar, termasuk `prices` (`/admin/products/harga`) dan `discounts` (`/admin/discounts`).
4. Memperbaiki 2 pelanggaran `react-hooks/set-state-in-effect` di `CheckoutAddressDialog.tsx` tanpa mengubah perilaku form wilayah maupun invariant idempotency `requestKey`.
5. Menghapus route `/admin/marketing`, tautan `#admin` di `Header.tsx`, dan `LayoutWrapper.tsx` (memindahkan shell langsung ke Server Component `apps/store/src/app/layout.tsx`).

## User Stories

1. Sebagai customer storefront, saya ingin deskripsi produk dari Jubelio tetap tampil rapi (paragraf, daftar poin, bold/italic, link aman) tanpa risiko eksekusi skrip berbahaya di browser saya.
2. Sebagai operator admin, saya ingin melihat pratinjau deskripsi produk pada halaman detail produk admin dengan aman tanpa risiko sesi admin dibajak oleh payload XSS dari data eksternal.
3. Sebagai operator admin di `/admin/products`, saya ingin mengklik nama produk dan langsung membuka halaman produk yang benar di storefront pada tab baru, bukan halaman 404.
4. Sebagai operator admin di `/admin/products`, saya ingin tombol aksi detail tetap membawa saya ke `/admin/products/{id}` pada tab yang sama seperti sebelumnya.
5. Sebagai operator admin dengan custom role yang hanya memiliki izin `view` pada modul `discounts`, saya ingin langsung diarahkan ke `/admin/discounts` saat membuka `/admin` setelah login, bukan melihat layar "Akses Terbatas".
6. Sebagai operator admin dengan custom role yang hanya memiliki izin `view` pada modul `prices`, saya ingin langsung diarahkan ke `/admin/products/harga` saat membuka `/admin` setelah login, bukan melihat layar "Akses Terbatas".
7. Sebagai customer storefront yang membuka dialog tambah/ubah alamat checkout, saya ingin pilihan wilayah bertingkat (provinsi → kota → kecamatan → kelurahan) tetap bekerja stabil tanpa reset/render berlebih, dan retry simpan dari status belum pasti tetap menggunakan `requestKey` idempotency yang sama.
8. Sebagai developer di repo marketplace, saya ingin `npm run lint:store` lulus dengan 0 error agar CI dan gate kualitas lokal kembali hijau.
9. Sebagai customer storefront, saya tidak lagi melihat opsi menu `#admin` yang tidak berfungsi di dropdown akun, dan layout root storefront tidak terbebani Client Component boundary yang tidak perlu.
10. Sebagai operator admin, URL placeholder usang `/admin/marketing` tidak lagi muncul sebagai halaman "Segera Hadir" yang membingungkan.

## Approval

- **Kesepahaman bersama dikonfirmasi user:** ✅ Dikonfirmasi melalui sesi grilling 2 ronde (2026-11-24 — keputusan Q1–Q5 terkunci).
- **Complete scope dan acceptance/verify criteria disetujui user:** ✅ Disetujui user pada 2026-11-24 (termasuk allowlist `<img>` aman dan penambahan dependency `sanitize-html` + `@types/sanitize-html` di `packages/ui`).

> Approval plan tidak menyetujui subagent, commit, remote access, atau deployment.

## Non-scope

- **Slice 2 (UX Store):** perbaikan `/account` (P0-2), mobile `Header`, `InfiniteProductGrid`, `<html lang="id">`, App Router `error.tsx`/`not-found.tsx`/`loading.tsx`, dan migrasi hardcoded Tailwind colors di Store.
- **Slice 3 (UX Admin):** mobile drawer `AdminSidebar`, standardisasi bahasa & list/table Admin, `ConfirmDialog` editor diskon, `aria-label` 19 tombol ikon, nested `<Link><Button>`, dan dark-mode safe colors di Admin.
- **Slice 4 (SEO & Performance):** migrasi `/products/[id]` ke Server Component + `generateMetadata()`, dan `React.cache()` di `/pages/[slug]`.
- **P2 & P3-3:** refactor 55 route handler & 11 file monolith, pembersihan 44 ESLint warning / `console.error` non-API, serta perubahan `images.unoptimized`.
- Perubahan skema database (`packages/db/src/schema/`), kontrak API, atau aturan bisnis RBAC.

## Implementation Decisions

1. **Sanitasi HTML terpusat (P0-1):**
   - Menggunakan library `sanitize-html` di `@marketplace/ui` (bekerja identik di Server Component/Node dan Client Component/Browser tanpa ketergantungan DOM global seperti JSDOM).
   - Allowlist tag yang dipertahankan: `p`, `br`, `strong`, `b`, `em`, `i`, `u`, `s`, `ul`, `ol`, `li`, `h1`–`h6`, `blockquote`, `hr`, `span`, `div`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `a`, dan `img`.
   - Atribut aman yang diizinkan:
     - `<a>`: `href`, `target`, `rel` (skema URI hanya `http`, `https`, `mailto`; saat `target="_blank"`, transformasi otomatis memaksa `rel="noopener noreferrer"`).
     - `<img>`: `src`, `alt`, `width`, `height` (skema URI `src` hanya `http` dan `https`; `data:` dan `javascript:` diblokir).
   - Semua tag eksekusi/embed (`script`, `iframe`, `object`, `embed`, `style`, `form`, `input`) dan semua atribut `on*` (termasuk `onerror`/`onload` pada `<img>`) serta `style` dibuang.
   - Input kosong/null/undefined mengembalikan string kosong `""`.
   - Catatan Context7: sebelum menulis kode yang memanggil `sanitize-html`, wajib lakukan lookup Context7 (atau fallback ke types/source `node_modules`) untuk memverifikasi opsi `allowedTags`, `allowedAttributes`, `allowedSchemes`, dan `transformTags`.
2. **Tautan pratinjau produk Admin ke Storefront (P0-3):**
   - Menggunakan `<a href={toStoreUrl(`/products/${product.slug}`)} target="_blank" rel="noopener noreferrer">` karena mengarah ke origin terpisah (`apps/store`), bukan internal route `apps/admin`.
   - Tidak mengubah tombol aksi detail (`/admin/products/${product.id}`).
3. **Landing Route Resolver Admin (P0-4):**
   - Mengganti array string datar `LANDING_MODULES` menjadi daftar terstruktur `{ module: ModuleKey; href: string }[]` di modul pure helper `apps/admin/src/lib/rbac/landing.ts`.
   - Urutan prioritas mengikuti urutan sidebar di `AdminSidebar.tsx`, dengan menambahkan `{ module: "prices", href: "/admin/products/harga" }` tepat setelah `products` dan `{ module: "discounts", href: "/admin/discounts" }` setelah `notifications`.
   - `apps/admin/src/app/admin/page.tsx` memanggil helper tersebut dan melakukan `redirect(target)` bila non-null; jika null tetap merender layar "Akses Terbatas".
4. **Fix `react-hooks/set-state-in-effect` di `CheckoutAddressDialog.tsx` (P0-5):**
   - Pada `RegionSelect`: tidak memanggil `setOptions([])` di dalam `useEffect`. State menyimpan `{ parentKey: string; items: ShipmentRegion[] }` (atau derive `visibleOptions = index > 0 && !parentId ? [] : (state.parentKey === currentKey ? state.items : [])`) sehingga perubahan `parentId` kosong langsung menghasilkan array kosong secara deklaratif tanpa cascading `setState`.
   - Pada `CheckoutAddressDialog`: memisahkan konten dialog yang memegang state form (`draft`, `requestKey`, `phase`, `errors`, `summary`, `notice`) ke subkomponen internal atau menaikkan `sessionId` di handler/state saat transisi buka agar inisialisasi state terjadi saat mount/session baru, bukan lewat `setState` sinkron di `useEffect`. Invariant idempotency `requestKey` tetap terjaga (retry dari status `unknown` mempertahankan `requestKey` yang sama).
5. **Pembersihan Dead Code (P0-7):**
   - Menghapus `apps/admin/src/app/admin/marketing/page.tsx` (terverifikasi 0 referensi kode maupun test lewat `git grep`).
   - Menghapus cabang `user.role === "admin"` (`href="#admin"`) dari `apps/store/src/components/Header.tsx` beserta import `Settings` yang tidak lagi digunakan.
   - Menghapus `apps/store/src/components/LayoutWrapper.tsx`, memindahkan struktur `<div className="flex min-h-screen flex-col"><Header /><main className="flex-1">{children}</main><FooterWrapper /></div>` langsung ke `apps/store/src/app/layout.tsx`, dan memperbarui catatan di `docs/features/footer.md`.

## Rancangan Teknis

### Tabel File

| Path | Aksi | Tanggung jawab (1–3 baris) | Layer | Seam test |
|---|---|---|---|---|
| `packages/ui/package.json` | modify | Tambah dependency `sanitize-html` dan devDependency `@types/sanitize-html`. | shared package | `npm run build --workspace @marketplace/ui` |
| `packages/ui/src/lib/sanitize-html.ts` | create | Helper pure `sanitizeProductHtml(html)` berbasis allowlist `sanitize-html` untuk deskripsi produk Store & Admin. | shared UI lib | `apps/store/src/lib/sanitize-html.test.ts` |
| `packages/ui/src/index.ts` | modify | Re-export `sanitizeProductHtml` dari `@marketplace/ui`. | shared UI barrel | `apps/store/src/lib/sanitize-html.test.ts` |
| `apps/store/src/app/products/[id]/page.tsx` | modify | Sanitasi `product.description` lewat `sanitizeProductHtml` sebelum dirender. | UI page | `e2e/store/product-detail.spec.ts` / unit |
| `apps/admin/src/app/admin/products/[id]/page.tsx` | modify | Sanitasi `product.description` lewat `sanitizeProductHtml` sebelum dirender. | UI page | `e2e/admin/products.spec.ts` / unit |
| `apps/admin/src/app/admin/products/page.tsx` | modify | Ubah link nama produk ke `<a href={toStoreUrl(`/products/${product.slug}`)} target="_blank" rel="noopener noreferrer">`. | UI page | `e2e/admin/products.spec.ts` (mock/browser) |
| `apps/admin/src/lib/rbac/landing.ts` | create | Daftar `ADMIN_LANDING_ROUTES` (termasuk `prices` & `discounts`) dan fungsi pure `resolveAdminLandingRoute`. | domain/rbac helper | `apps/admin/src/lib/rbac/landing.test.ts` |
| `apps/admin/src/app/admin/page.tsx` | modify | Gunakan `resolveAdminLandingRoute` untuk menentukan tujuan `redirect` berdasarkan policy user. | UI server page | `apps/admin/src/lib/rbac/landing.test.ts` |
| `apps/store/src/components/checkout/CheckoutAddressDialog.tsx` | modify | Hilangkan 2 pelanggaran `react-hooks/set-state-in-effect` sambil menjaga perilaku region cascade & idempotency `requestKey`. | UI component | `npm run lint:store` + `e2e/store/addresses-mock.spec.ts` |
| `apps/store/src/components/Header.tsx` | modify | Hapus menu dead link `#admin` (`user.role === "admin"`) dan import `Settings` yang tidak terpakai. | UI component | `npm run verify:types:store` + `npm run lint:store` |
| `apps/store/src/components/LayoutWrapper.tsx` | delete | Hapus wrapper Client Component yang hanya mengecek `#admin`. | UI component | `npm run verify:types:store` + `e2e/store/products.spec.ts` |
| `apps/store/src/app/layout.tsx` | modify | Render langsung `<Header />`, `<main>`, dan `<FooterWrapper />` tanpa `LayoutWrapper`. | UI server layout | `npm run verify:types:store` |
| `apps/admin/src/app/admin/marketing/page.tsx` | delete | Hapus halaman placeholder *"Segera Hadir"* yang tidak ada di sidebar. | UI page | `npm run verify:types:admin` |
| `docs/features/footer.md` | modify | Perbarui dokumentasi bahwa `FooterWrapper` dirender langsung dari `apps/store/src/app/layout.tsx` (bukan lagi via `LayoutWrapper`). | docs | — |

### Kontrak Export (File Baru / Berubah)

- `packages/ui/src/lib/sanitize-html.ts` (di-re-export lewat `packages/ui/src/index.ts`):
  - `sanitizeProductHtml(rawHtml: string | null | undefined): string` — Mengembalikan HTML yang telah disanitasi sesuai allowlist aman; mengembalikan `""` untuk input kosong/nullish.
- `apps/admin/src/lib/rbac/landing.ts`:
  - `ADMIN_LANDING_ROUTES: ReadonlyArray<{ module: ModuleKey; href: string }>` — Peta berurutan modul admin ke route tujuannya (mencakup `prices` → `/admin/products/harga` dan `discounts` → `/admin/discounts`).
  - `resolveAdminLandingRoute(canView: (module: ModuleKey) => boolean): string | null` — Mengembalikan `href` pertama yang diizinkan, atau `null` jika tidak ada modul yang dapat diakses.

### Keputusan Struktur Non-Obvious

- **Keputusan:** Menempatkan `sanitizeProductHtml` di `packages/ui/src/lib/sanitize-html.ts` dan mengujinya dari `apps/store/src/lib/sanitize-html.test.ts`.
  - **Alasan:** Kedua app (`store` dan `admin`) membutuhkan aturan sanitasi yang identik; `vitest.config.mts` saat ini tidak mendaftarkan `packages/ui` sebagai project Vitest tersendiri, dan prior art repo menempatkan unit test helper `@marketplace/ui` di `apps/store/src/lib/status-presentation.test.ts`.
  - **Ditolak:** Menduplikasi fungsi sanitasi di masing-masing app (rawan drift) atau menambah project Vitest baru hanya untuk satu helper.
- **Keputusan:** Mengekstrak `resolveAdminLandingRoute` ke `apps/admin/src/lib/rbac/landing.ts`.
  - **Alasan:** `prices` memetakan ke `/admin/products/harga` (tidak sama dengan `/admin/${moduleName}`), dan ekstraksi ke fungsi pure membuat verifikasi seluruh cabang custom role (termasuk hanya `prices` atau hanya `discounts`) deterministik tanpa mocking berat Next.js Server Component.
  - **Ditolak:** Mempertahankan inline array di `apps/admin/src/app/admin/page.tsx` tanpa unit test seam.

### Discovery

- Tidak ada `discovery:` tersisa — seluruh file, dependensi, referensi `/admin/marketing`, referensi `LayoutWrapper`, dan konfigurasi Vitest sudah diverifikasi langsung pada repo.

## Rancangan UX

- **Tugas dan pengguna:**
  - Customer storefront membaca deskripsi produk dengan aman dan mengisi alamat checkout tanpa glitch render.
  - Operator admin membuka pratinjau produk di storefront dari tabel `/admin/products` dan otomatis mendarat di modul yang diizinkan saat membuka `/admin`.
- **Halaman/pattern referensi:**
  - Styling deskripsi produk tetap mengikuti container existing di `apps/store/src/app/products/[id]/page.tsx` dan `apps/admin/src/app/admin/products/[id]/page.tsx` (tidak ada perubahan visual/token baru).
  - Tautan eksternal ke storefront mengikuti pola `toStoreUrl()` di `apps/admin/src/lib/store-url.ts`.
  - Dialog alamat checkout mempertahankan seluruh layout, label, dan state existing di `apps/store/src/components/checkout/CheckoutAddressDialog.tsx`.
- **Hierarki dan primary action:** Tidak ada perubahan hierarki halaman atau primary action; Slice 1 murni perbaikan keamanan, fungsionalitas link/redirect, lint, dan penghapusan dead code.

### Component Reuse Map

| Elemen | Existing / Baru | Path komponen | Catatan |
|---|---|---|---|
| Helper sanitasi HTML | Baru | `packages/ui/src/lib/sanitize-html.ts` | Dipakai bersama oleh detail produk Store & Admin |
| Helper URL storefront | Existing | `apps/admin/src/lib/store-url.ts` | `toStoreUrl()` dipakai di tautan nama produk `/admin/products` |
| Dialog alamat checkout | Existing | `apps/store/src/components/checkout/CheckoutAddressDialog.tsx` | Hanya perbaikan internal hook tanpa perubahan UI/copy |

### State Matrix

| Layar / komponen | Idle | Loading | Empty | Error | Sukses | Disabled / tanpa izin | Unsaved |
|---|---|---|---|---|---|---|---|
| Deskripsi produk (Store & Admin) | Render HTML ter-sanitasi (formatting aman tampil, script/on* hilang) | Mengikuti skeleton existing halaman | Store: *"Tidak ada deskripsi."* · Admin: blok deskripsi disembunyikan | Mengikuti error existing halaman | N/A | N/A | N/A |
| Tabel `/admin/products` (kolom Nama Produk) | Link nama produk mengarah ke `toStoreUrl("/products/{slug}")` (`target="_blank"`, `rel="noopener noreferrer"`) | Mengikuti spinner existing | *"Tidak ada produk ditemukan."* (existing; perbaikan error UI masuk Slice 3) | Existing (perbaikan masuk Slice 3) | Tab baru membuka halaman produk storefront | N/A | N/A |
| Landing `/admin` | Redirect otomatis ke route pertama yang diizinkan (termasuk `/admin/discounts` & `/admin/products/harga`) | Server redirect | N/A | N/A | Mendarat di modul pertama yang diizinkan | Layar *"Akses Terbatas"* (existing) bila tidak ada modul `view` | N/A |
| `CheckoutAddressDialog` | Form alamat siap diisi; dropdown anak wilayah disabled saat parent kosong | Mengikuti state `saving`/`checking` existing | Dropdown wilayah anak kosong & disabled | Pesan *"Wilayah belum dapat dimuat."* + *"Coba lagi wilayah"* (existing) | Dialog tertutup & alamat tersimpan | Tombol simpan disabled saat `inFlight` (existing) | Status `unknown` mempertahankan `requestKey` & notice existing |

- **Viewport dan responsive:** Tidak mengubah layout responsive (desktop `1280px` & mobile `390px` tetap identik dengan baseline, dengan verifikasi tidak ada regresi pada Header/Footer setelah penghapusan `LayoutWrapper`).
- **Accessibility:** Tautan eksternal `target="_blank"` wajib memakai `rel="noopener noreferrer"`; penghapusan `LayoutWrapper` mempertahankan landmark `<header>`, `<main>`, `<footer>`.
- **Prototype:** N/A — tidak ada perubahan desain/alur visual baru.

## Testing Decisions

- **Prinsip pengujian:** Uji perilaku eksternal di public seam (input HTML berbahaya → output aman; input policy custom role → route redirect yang tepat; perilaku dialog alamat & link produk di browser), bukan detail implementasi internal.
- **Modul & seam yang diuji:**
  1. `apps/store/src/lib/sanitize-html.test.ts` — Unit test (Vitest) pada `sanitizeProductHtml`: mempertahankan tag aman (`<p>`, `<br>`, `<ul>/<li>`, `<strong>`, `<a href="https://...">`), menghapus `<script>`, `<img onerror=...>`, `<iframe ...>`, atribut `onclick`/`style`, dan `javascript:` URI, memaksa `rel="noopener noreferrer"` pada `target="_blank"`, serta menangani input kosong/nullish.
  2. `apps/admin/src/lib/rbac/landing.test.ts` — Unit test (Vitest) pada `resolveAdminLandingRoute`: role hanya `discounts` → `/admin/discounts`; role hanya `prices` → `/admin/products/harga`; role multi-modul mengikuti urutan prioritas; role tanpa izin `view` → `null`.
  3. **E2E / Lint / Typecheck:**
     - `npm run lint:store` → exit 0 (0 errors, membuktikan P0-5 selesai).
     - `npm run verify:types:store` & `npm run verify:types:admin` (L0).
     - E2E mock spec terkait: `e2e/store/addresses-mock.spec.ts` (memastikan `CheckoutAddressDialog` tidak regresi) + penambahan/pembaruan assertion E2E mock/spec untuk link storefront di `/admin/products` dan deskripsi produk aman.
- **Prior art di codebase:**
  - `apps/store/src/lib/status-presentation.test.ts` (unit test untuk helper di `@marketplace/ui`).
  - `e2e/store/addresses-mock.spec.ts` (Playwright mock test untuk `CheckoutAddressDialog`).
  - `e2e/admin/products.spec.ts` & `e2e/store/product-detail.spec.ts`.

## Fitur & Acceptance Criteria

| # | Fitur / AC | Status | verify: | Catatan |
|---|---|---|---|---|
| AC-1 | **Sanitasi HTML `product.description` (P0-1):** `sanitizeProductHtml` membuang payload XSS (`<script>`, `onerror`, `onclick`, `<iframe>`, `javascript:`, `data:` pada `img`) dan mempertahankan formatting serta `<img>` aman, lalu dipakai pada halaman detail produk Store & Admin. | Verified | `npm run verify:unit:slice -- apps/store/src/lib/sanitize-html.test.ts` (PASS 6/6) + `e2e/admin/slice1-security-links-mock.spec.ts` (PASS) + `e2e/store/slice1-security-shell-mock.spec.ts` (PASS) | Context7 checkpoint: `/apostrophecms/sanitize-html` (`allowedTags`, `allowedAttributes`, `allowedSchemes`, `allowedSchemesByTag`, `allowProtocolRelative`, `transformTags`). |
| AC-2 | **Fix link 404 `/admin/products` (P0-3):** Klik nama produk di `/admin/products` menghasilkan `<a href="http://localhost:3000/products/{slug}" target="_blank" rel="noopener noreferrer">` (mengikuti `NEXT_PUBLIC_STORE_URL`); tombol detail tetap ke `/admin/products/{id}`. | Verified | `npm run verify:batch:e2e -- e2e/admin/slice1-security-links-mock.spec.ts` (PASS 2/2) | Reuse `toStoreUrl()`. |
| AC-3 | **Fix `LANDING_MODULES` Admin (P0-4):** Operator dengan izin hanya `discounts` diarahkan ke `/admin/discounts`; operator dengan izin hanya `prices` diarahkan ke `/admin/products/harga`; tanpa izin apa pun tetap menampilkan *"Akses Terbatas"*. | Verified | `npm run verify:unit:slice -- apps/admin/src/lib/rbac/landing.test.ts` (PASS 5/5) + `verify:types:admin` (PASS) | Pure helper di `apps/admin/src/lib/rbac/landing.ts`. |
| AC-4 | **Fix 2 error `lint:store` (P0-5):** `npm run lint:store` lulus dengan 0 error; `CheckoutAddressDialog` tetap lolos perilaku pilih wilayah bertingkat & simpan alamat. | Verified | `npm run lint:store` (PASS, 0 errors) + `npm run verify:batch:e2e -- e2e/store/addresses-mock.spec.ts` (PASS 6/6) | Invariant `requestKey` idempotency terjaga. |
| AC-5 | **Hapus dead code Store–Admin (P0-7):** `/admin/marketing` dihapus, menu `#admin` hilang dari `Header.tsx`, `LayoutWrapper.tsx` dihapus dan shell dirender langsung dari `apps/store/src/app/layout.tsx`, `docs/features/footer.md` diperbarui. | Verified | `npm run verify:types:store` (PASS) + `npm run verify:types:admin` (PASS) + `npm run verify:batch:e2e -- e2e/store/slice1-security-shell-mock.spec.ts` (PASS 2/2, desktop `1280×800` & mobile `390×844`) | 0 referensi tersisa via `git grep`. |

## Implementation Notes

- Urutan implementasi disarankan:
  1. **AC-1** (`packages/ui` + konsumen Store & Admin) — jalankan lookup Context7 `sanitize-html`, tulis RED test `sanitize-html.test.ts`, implementasi, GREEN.
  2. **AC-3** (`apps/admin/src/lib/rbac/landing.ts` + `admin/page.tsx`) — tulis RED test `landing.test.ts`, implementasi, GREEN.
  3. **AC-2 & AC-5** (link `/admin/products`, hapus `/admin/marketing`, hapus `#admin` & `LayoutWrapper.tsx`, update `docs/features/footer.md`).
  4. **AC-4** (refactor hook `CheckoutAddressDialog.tsx`) — verifikasi `npm run lint:store` 0 errors.
  5. **Final Gate (L2):** `npm run verify:types:store`, `npm run verify:types:admin`, `npm run lint:store`, `npm run lint:admin`, `npm run test:unit`, `npm run verify:batch:e2e -- e2e/store/addresses-mock.spec.ts` (+ spec baru/diperbarui), dan rendered UI review.
- Slice 1 cukup ringkas untuk 1 sesi implementasi langsung tanpa perlu memecah menjadi multi-session tickets (kecuali user meminta breakdown ticket terpisah).

## Deviation Log

| Ticket / slice | Rencana (path/kontrak) | Aktual | Alasan | Dampak |
|---|---|---|---|---|
| Slice 1 | Menambah/memperbarui assertion di `e2e/admin/products.spec.ts` / `e2e/store/product-detail.spec.ts` | Membuat 2 mock E2E spec terisolasi (`e2e/admin/slice1-security-links-mock.spec.ts`, `e2e/store/slice1-security-shell-mock.spec.ts`) dan mendaftarkannya di `playwright.mock.config.ts` | Mengikuti verification ladder L2 (`npm run verify:batch:e2e` pada konfigurasi mock terisolasi tanpa menyentuh spec live) | Deterministik, tidak menyentuh data operasional, dan langsung dapat dijalankan bersama `e2e/store/addresses-mock.spec.ts` |

## Open Questions

- Tidak ada open question yang memblokir `Ready`. Seluruh keputusan produk untuk Slice 1 telah disepakati pada sesi grilling.

## Further Notes

- Setelah Slice 1 selesai dan lulus verifikasi, spec untuk **Slice 2 (UX Store)**, **Slice 3 (UX Admin)**, dan **Slice 4 (SEO & Perf)** akan disusun berturut-turut dari keputusan grilling yang sudah tercatat.

## Retirement Checklist (saat plan mencapai Done)

- [x] Semua fitur AC-1 s.d. AC-5 lulus `verify:` (unit, lint, typecheck, E2E mock, dan rendered UI review).
- [x] Dokumentasi terkait diperbarui (`docs/features/footer.md` dan catatan keamanan sanitasi deskripsi bila relevan).
- [x] File plan tetap disimpan di `.scratch/codebase-ui-audit/plan/slice-1-p0-security-bug-lint.md`.
- [x] Entri di `.scratch/codebase-ui-audit/index.md` diperbarui ke **Done** dengan tanggal dan ringkasan bukti verifikasi.
