# Plan: Penyeragaman tabel Customer dengan Branches

## Tujuan dan fakta awal

Menyamakan pola tabel `/admin/customers` dengan `/admin/branches`, sekaligus menambahkan pagination server-side agar browser tidak menerima seluruh direktori customer.

Fakta yang diperiksa dari kode:
- `apps/admin/src/lib/customers.ts`, fungsi `getCustomers()`, mengambil seluruh customer tanpa `limit/offset`, disertai jumlah order per customer.
- `apps/admin/src/app/admin/customers/customer-table.tsx` melakukan search lokal lalu merender semua hasil tanpa pagination.
- `apps/admin/src/app/admin/branches/page.tsx` memakai card, search server-side dengan debounce 400 ms, 10 baris per halaman, dan footer `Previous / Page X of Y / Next`.
- Summary cards Customer saat ini dihitung dari seluruh list yang diambil server.
- Guard halaman Customer berada di `apps/admin/src/app/admin/customers/layout.tsx`: `customers:view`. Direktori bersifat global, bukan branch-scoped.
- Referensi fitur existing: [Admin Customer Directory](../../../../docs/features/admin-customers.md).

Batas evidence: browser tool gagal dibuka karena distribusi Chrome tidak tersedia. Perbandingan awal berdasarkan kode, belum hasil render.

## Approval

- Kesepahaman scope dikonfirmasi user melalui pilihan **Tabel + pagination (Recommended)**: samakan card/search/tabel/footer, 10 baris per halaman, search seluruh data, summary cards/kolom/detail dipertahankan.
- Approval complete plan dan acceptance criteria: **disetujui user** melalui “oke implementasikan spec tersebut”.
- Scope dan acceptance berikut disetujui untuk implementasi; tidak ada perluasan keputusan produk.
- Tidak ada izin subagent, commit, push, deployment, atau legacy full E2E.

## Scope

1. Pertahankan header halaman dan empat summary cards Customer.
2. Samakan card daftar, spacing search, border/radius tabel, header row, kepadatan row, dan posisi footer dengan Branches menggunakan shared components.
3. Tambahkan pagination server-side dengan default 10 baris per halaman.
4. Pindahkan search nama/email/telepon ke server, case-insensitive dan substring literal; trim input dan debounce 400 ms. Karakter `%` dan `_` diperlakukan sebagai karakter biasa agar tidak memperluas pencarian tanpa disengaja.
5. Search baru mengembalikan halaman ke 1 secara atomik. Response lama tidak boleh menimpa response pencarian terbaru.
6. Pertahankan semua kolom, avatar/identitas customer, makna onboarding, format tanggal, dan jumlah order. Akses detail tetap berupa tombol/link langsung, bukan menu tiga titik untuk satu aksi.
7. Summary memakai agregasi global tersendiri; tidak berubah ketika search atau halaman berubah. Tidak lagi mengambil seluruh list hanya untuk menghitung summary.
8. Tambahkan state loading/error/retry serta bedakan direktori kosong dengan pencarian tanpa hasil.

## Non-scope

- Mengubah halaman Branches atau shared visual tokens.
- Menghapus/memindah kolom customer, merombak header atau summary cards.
- Menambah sorting interaktif, filter onboarding, page-size selector, bulk action, export, edit, atau delete customer.
- Mengubah detail customer/order history atau aturan RBAC.
- Schema/migration/seeder, integrasi Jubelio, env, dan deployment.
- Persistensi search/page pada URL; perilaku navigasi kembali mengikuti perilaku existing, bukan flow baru.

## Rancangan teknis

| Path | Aksi | Tanggung jawab / layer | Seam test |
|---|---|---|---|
| `apps/admin/src/app/admin/customers/page.tsx` | modify | Server Component: ambil agregasi summary tanpa seluruh list; pertahankan header/cards, render tabel | E2E summary tetap global |
| `apps/admin/src/app/admin/customers/customer-table.tsx` | modify | UI: fetch list, debounce, state pagination, race protection, render pola Branches | E2E list/search/navigation/error |
| `apps/admin/src/features/customers/customer-list-repository.ts` | create | DAL: paged query dan count memakai predicate sama; agregasi summary terpisah | repository unit tests |
| `apps/admin/src/features/customers/customer-list-repository.test.ts` | create | Uji query predicate, paging, urutan, agregasi melalui public export | Vitest |
| `apps/admin/src/app/api/admin/customers/route.ts` | create | HTTP adapter GET: guard, parsing pagination, panggil DAL, log dan mapping response | route tests |
| `apps/admin/src/app/api/admin/customers/route.test.ts` | create | Kontrak response, unauthorized/forbidden, sanitasi input, failure dan logging | Vitest |
| `apps/admin/src/lib/customers.ts` | modify | Hapus jalur unbounded list setelah consumer diganti; pertahankan tipe kompatibel dan fungsi detail | regression detail existing |
| `e2e/admin/customers.spec.ts` | modify | Sesuaikan assertion copy tanpa menghilangkan coverage detail | existing E2E |
| `e2e/admin/customers-pagination-mock.spec.ts` | create | Fixture deterministik >20 customer, uji perilaku list dan summary | Playwright mock |
| `playwright.mock.config.ts` | modify | Daftarkan spec baru pada kedua `testMatch` existing | discovery spec oleh runner |
| `docs/features/admin-customers.md` | modify | Dokumentasikan pagination, search server-side, summary global, endpoint baru | review docs |
| `docs/api-reference.md` | modify | Catat kontrak endpoint baru dan permission | review docs |

### Kontrak export yang diusulkan

- `customer-list-repository.ts`:
  - `CustomerListQuery = { page: number; limit: number; search: string }`.
  - `CustomerListResult = { rows: CustomerListItem[]; total: number; page: number; totalPages: number }`.
  - `CustomerSummary = { registered: number; onboarded: number; pending: number; totalOrders: number }`.
  - `listCustomers(input: CustomerListQuery): Promise<CustomerListResult>`.
  - `getCustomerSummary(): Promise<CustomerSummary>`.
- `customer-table.tsx`: `CustomerTable(): React.JSX.Element`; tidak lagi menerima seluruh `customers` dari server.
- `route.ts`: `GET(request: NextRequest): Promise<Response>` melalui wrapper request context existing.
- `getCustomerDetail(id)` dan `CustomerListItem` existing tidak berubah kontrak.

### Kontrak HTTP usulan

`GET /api/admin/customers?page=1&limit=10&search=andi`

- Wajib sesi admin dan permission `customers:view`, sama dengan guard halaman. Tidak memakai sesi store dan tidak menambah branch restriction.
- Parsing memakai `apps/admin/src/lib/pagination.ts`; UI selalu meminta limit 10. Nilai invalid mengikuti normalisasi helper existing, bukan parser baru.
- Success: `{ success: true, data: CustomerListItem[], pagination: { page, limit, total, totalPages } }`.
- `total` menghitung customer yang cocok, bukan row order hasil join. `orderCount` tetap per customer.
- Urutan deterministik `createdAt DESC, id DESC` agar timestamp sama tidak menghasilkan row yang bergeser acak.
- Hasil kosong memakai halaman 1 dari 1. Halaman di luar rentang dikembalikan ke halaman valid terakhir; UI memakai metadata response.
- Kegagalan query: HTTP 500 dengan `{ success: false, error: "Gagal memuat customer." }`. Auth failures mengikuti guard existing.
- Structured logger module-scope dan request-context wrapper: `info` untuk success, `error` untuk failure dengan konteks aman. Jangan log search string, nama, email, telepon, raw SQL, atau isi response customer.

### Keputusan struktur

- Read-only endpoint memanggil DAL bernama langsung; tidak menambah pass-through service tanpa workflow bisnis.
- DAL baru dimiliki fitur `customers`; tidak memindahkan seluruh legacy detail query karena tidak terkait scope.
- Summary dihitung lewat agregasi terpisah, bukan menjumlahkan hasil pagination atau mengunduh semua customer.
- Tidak mengekstrak generic DataTable atau mengubah Branches: shared primitives sudah cukup untuk penyeragaman lokal ini.
- Context7 checkpoint: `/vercel/next.js/v16.2.9` — GET handler, `nextUrl.searchParams`, JSON response dan default tanpa cache; `/reactjs/react.dev` — cleanup ignore flag untuk stale fetch; `/drizzle-team/drizzle-orm-docs` — count, sql/mapWith, groupBy, limit/offset; `/vitest-dev/vitest` — hoisted async module mocks; `/microsoft/playwright` — route/fulfill. Panduan route installed Next.js juga diperiksa.

## Rancangan UX

**Pengguna/tugas:** admin berizin mencari customer, memindai profil singkat, lalu membuka detail dan riwayat pembelian.

**Referensi:** `apps/admin/src/app/admin/branches/page.tsx`, hanya pola card/search/table/footer. Header dan summary Customer tetap. Tidak menyalin kekurangan error handling Branches.

**Hierarki:** header → summary global → card `Daftar Customer` → search → tabel → pagination. Tidak ada tombol tambah customer. Aksi row utama `Lihat detail`, tanpa edit/hapus.

### Component reuse map

Alias `@/components/ui/*` di admin mengarah ke `packages/ui/src/components/ui/*`, bukan folder UI lokal app.

| Elemen | Existing path | Pemakaian |
|---|---|---|
| Card | `packages/ui/src/components/ui/card.tsx` | CardHeader `pb-3`, CardTitle, CardDescription, CardContent seperti Branches |
| Search | `packages/ui/src/components/ui/input.tsx` | Search icon, `pl-8`, lebar `max-w-sm` seperti Branches |
| Tabel | `packages/ui/src/components/ui/table.tsx` | Wrapper `rounded-md border`, header dan row memakai default pattern Branches |
| Pagination/detail/retry | `packages/ui/src/components/ui/button.tsx` | Pagination outline/sm; detail ghost/sm existing |
| Onboarding | `packages/ui/src/components/ui/badge.tsx` | Pertahankan perbedaan completed/pending serta label yang terbaca |
| Identitas | `packages/ui/src/components/ui/avatar.tsx` | Pertahankan avatar existing; tidak memaksa icon cabang untuk customer |

### Copy dan state matrix usulan

Copy baru di area tabel memakai bahasa Indonesia; header halaman dan summary di luar area tabel tidak diterjemahkan dalam scope ini.

| State | Tampilan / copy / perilaku |
|---|---|
| Idle/success | Judul `Daftar Customer`; deskripsi `Lihat profil customer dan riwayat pembelian.`; search `Cari nama/email/telepon...`, accessible name `Cari customer berdasarkan nama, email, atau telepon` |
| Kolom | `Nama`, `Email`, `Telepon`, `Tanggal lahir`, `Gender`, `Onboarding`, `Dibuat`, `Diperbarui`, `Order`, `Aksi`; status `Selesai` / `Belum selesai`; nilai gender mengikuti existing |
| Loading awal / pagination / search | Spinner seperti Branches, accessible status `Memuat customer...`; navigasi tidak bisa diklik berulang saat request berlangsung; query input tetap tersedia |
| Direktori kosong | `Belum ada customer.`; footer `Page 1 of 1`, kedua tombol disabled |
| Search tanpa hasil | `Tidak ada customer yang cocok dengan pencarian ini.`; footer `Page 1 of 1`; input dipertahankan |
| Error jaringan/server | `Gagal memuat customer.` dan tombol `Coba lagi`; pertahankan input/page untuk retry, jangan tampilkan data lama seolah hasil query baru |
| Pagination | `Previous`, `Page X of Y`, `Next` identik dengan Branches; Previous disabled pada halaman 1, Next pada halaman terakhir |
| Detail | `Lihat detail` menuju `/admin/customers/[id]`; accessible name mencakup nama customer agar link row dapat dibedakan |
| Tanpa izin / sesi berakhir | Guard halaman existing tetap; API 401/403 tidak dianggap empty/error jaringan dan tidak menampilkan row lama; UI mengarahkan reload navigasi agar page guard menentukan tujuan yang diizinkan |
| Unsaved | N/A: halaman read-only; search bukan perubahan tersimpan |

- Desktop 1440×900: bandingkan card, ukuran input/button, row/header/footer dengan Branches pada viewport sama.
- Mobile 390×844: search tidak terpotong, tabel lebar memakai horizontal scroll dalam region tabel, bukan overflow seluruh halaman; pagination tetap terjangkau.
- Accessibility: label search nyata/accessible, focus terlihat, navigasi keyboard ke detail/pagination/retry, `aria-busy`/status saat loading, tidak mengandalkan warna untuk onboarding.
- Prototype tidak diminta. Browser render comparison wajib sebelum frontend dinyatakan selesai.

## Acceptance criteria

1. Fixture 23 customer menghasilkan 10 row, 10 row, lalu 3 row; tidak ada duplikasi customer antarhalaman untuk dataset tetap.
2. Search customer yang semula berada di halaman 3 tetap ditemukan ketika search dimulai dari halaman 1; pencarian mencakup nama/email/telepon, case-insensitive, dan substring literal.
3. Search baru dari halaman 3 memuat halaman 1 hasil search; response pencarian lama yang terlambat tidak mengganti hasil terbaru.
4. Total halaman sesuai jumlah customer hasil filter, termasuk customer dengan banyak order tanpa overcount.
5. Summary global identik saat berpindah halaman atau mencari satu customer. Contoh fixture 23 customer tetap menunjukkan registered 23 ketika hanya 1 hasil search tampil.
6. Semua kolom, fallback null, jumlah order, status onboarding, dan detail link tetap tersedia.
7. Card/search/table/footer konsisten dengan Branches; tidak ada perubahan pada halaman Branches, header Customer, atau summary cards.
8. Empty, no-match, loading, failure/retry, batas pagination, serta 401/403 terverifikasi; akses API tanpa izin ditolak.
9. List request hanya mengembalikan satu page, dan render awal tidak mengambil seluruh customer untuk summary.

## Urutan implementasi dan verifikasi

1. **Slice pagination:** RED route/DAL tests pada public exports, implementasi paged query/count dan agregasi summary, sambungkan UI. Verifikasi fixture 23 row dan summary global.
2. **Slice search:** RED untuk match lintas halaman, reset halaman, wildcard literal, dan stale response; implementasi debounce/race protection.
3. **Slice konsistensi/state:** RED Playwright untuk card/search/footer, empty/error/retry/detail; selaraskan shared pattern, inspeksi render berdampingan, perbarui docs.

Command rencana (belum dijalankan):
- L0 per slice: `npm run verify:types:admin`.
- L1: `npm run verify:unit:slice -- apps/admin/src/features/customers/customer-list-repository.test.ts apps/admin/src/app/api/admin/customers/route.test.ts` (batasi daftar sesuai slice aktual).
- L2: `npm run verify:batch:unit` dan `npm run verify:batch:e2e -- e2e/admin/customers-pagination-mock.spec.ts`.
- L3 sebelum commit/PR: `npm run test:unit`; full legacy `npm run test:e2e` hanya setelah izin terpisah. Regression `e2e/admin/customers.spec.ts` termasuk suite tersebut.
- Output sementara di luar repo; artefak browser di `playwright/mcp/customers-table/`, reports/results mengikuti config repo.
- Jika test gagal, diagnosis dari Markdown, bukan attachment screenshot kegagalan.

## Open items dan blocker

- Approval complete spec sudah diberikan, termasuk copy tabel, direct detail action, dan out-of-range/auth error.
- Discovery selesai: helper pagination default existing 20, sehingga endpoint Customer menetapkan default 10 eksplisit; batas maksimum tetap 100. Unit memakai real Drizzle SQL builder dengan executor stub; E2E API memakai fixture run-unique lokal dan cleanup exact IDs.
- Render Customer/Branches sudah diinspeksi melalui Chromium runner pada desktop/mobile; browser MCP Chrome tidak dipakai.
- Context7 inquiry selesai sebagaimana checkpoint di atas, ditambah `/websites/node-postgres` untuk parameterized query dan cleanup pool fixture.
- Gate batch unit masih terblokir 9 suite DB non-disposable serta 1 mismatch seed HQ, di luar perubahan Customer. Lihat [evidence](../research/customer-table-verification.md).
- Tidak ada perubahan env/deployment yang direncanakan; evaluasi ulang hanya jika scope berubah dan mendapat approval.

## Penutupan

Implementasi, dokumentasi fitur/API/index, serta verification Customer tersedia; lihat [evidence 2026-11-03](../research/customer-table-verification.md). Status tetap In Progress di `../index.md` karena gate batch unit belum lulus. Tidak ada commit/PR atau legacy full E2E.

## Deviation log

- `docs/README.md` diperbarui untuk menautkan fitur Customer sesuai kewajiban documentation index; tidak mengubah runtime.
- Config runner sementara di `playwright/customers-run.config.ts` memakai port 3311 karena canonical mock port sibuk; bukan perubahan tracked config/deployment dan tidak reuse server lain.
- Tidak ada service pass-through atau generic DataTable baru; kontrak list/summary dan file runtime mengikuti blueprint.
