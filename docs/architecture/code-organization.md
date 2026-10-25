# Code organization — Route Handlers, services, and repositories

**Status:** Konvensi yang disetujui untuk kode baru maupun refactor. Dokumen ini
mencatat konvensinya, **bukan** klaim bahwa kode existing sudah dimigrasikan:
sebagian besar handler masih memuat query dan provider call sendiri. Ringkasan
wajib untuk agent ada di
[`.agents/skills/maintainable-code/SKILL.md`](../../.agents/skills/maintainable-code/SKILL.md).
Research [organisasi API Next.js](../../.scratch/maintainable-code/research/nextjs-api-organization-research.md) bersifat
latar historis dan **superseded** di bagian mana pun yang berbeda dari dokumen
ini. Bagian yang belum disentuh slice dokumentasi ini masih berbahasa Inggris dan
diselaraskan saat fiturnya disentuh.

## Keputusan

Organisasikan kode aplikasi **berdasarkan fitur/domain**, dengan HTTP adapter
tipis di setiap entry point Next.js. Pakai module service/use-case bernama untuk
alur bisnis yang tidak sepele. Tambahkan module repository/data-access ketika
persistence-nya kompleks, dipakai ulang, atau punya aturan otorisasi/scope yang
perlu dipusatkan; **jangan mewajibkan repository (atau service) untuk setiap
endpoint sederhana**. Semua ini module dan fungsi TypeScript biasa, bukan class
milik framework atau hierarki direktori wajib ala Spring Boot.

Dua aturan tidak bisa ditawar: `route.ts` tidak pernah memuat query Drizzle
(endpoint sederhana memanggil fungsi query/DAL bernama secara langsung, bukan
mengarang service pass-through), dan tidak ada
`logger`/`requestId`/request-object yang diteruskan lewat parameter fungsi
**untuk keperluan logging atau korelasi**. Yang tetap sah: input bisnis bertipe,
dependency eksplisit yang memang dipakai untuk bekerja (`db`/`tx`, provider
client), serta objek HTTP `Request`/`NextRequest` di `route.ts` atau wrapper
entry point. Tidak wajib pula: class, pasangan interface–implementation, DI
container, `BaseRepository`, entity class duplikat, atau layer baru yang hanya
meneruskan parameter.

```text
HTTP request → app/api/**/route.ts → features/<domain>/*-service.ts
                                         ├── *-repository.ts → app-local @/db
                                         ├── domain helpers / policies
                                         └── external integration clients
```

Ini konvensi proyek kita, bukan keharusan Next.js: Next.js menetapkan `route.ts`
dan named export method HTTP, tetapi organisasi kode bebas. Panduan
keamanannya menyarankan fungsi data-access server-only, otorisasi dekat data, dan
DTO minimal. Lihat [Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [project structure](https://nextjs.org/docs/app/getting-started/project-structure), dan [data security](https://nextjs.org/docs/app/guides/data-security).

## Proposed folder layout

New folders are added **when needed**, not as an empty skeleton across all features. Keep the existing API URLs unchanged during a structural refactor.

```text
apps/store/src/
├── app/
│   └── api/
│       ├── checkout/place-order/route.ts   # public HTTP contract
│       ├── products/route.ts
│       └── webhooks/midtrans/route.ts
├── features/
│   ├── checkout/
│   │   ├── place-order-service.ts          # use case and orchestration
│   │   ├── checkout-repository.ts          # scoped queries and persistence, if useful
│   │   ├── place-order.schema.ts           # input schema, if shared/large
│   │   └── place-order-service.test.ts
│   ├── catalog/
│   │   ├── list-products.ts                 # query/DAL; called directly from route.ts
│   │   └── list-products.test.ts
│   └── payments/
│       ├── midtrans-client.ts              # provider adapter, NOT a repository
│       └── handle-notification-service.ts
├── db/index.ts                              # this app's runtime DB instance
└── lib/                                     # cross-feature utilities (logger, auth, etc.)

apps/admin/src/
├── app/api/admin/...
├── features/
│   ├── roles/                               # migrate existing lib/rbac modules only if useful
│   └── orders/
├── db/index.ts
└── lib/

packages/db/src/schema/                     # sole owner of shared table definitions
```

The filenames above are **illustrative future locations**, not an inventory of existing files. Prefer specific names (`place-order-service.ts`, `checkout-repository.ts`) to a feature folder full of ambiguous `service.ts` files. Keep tests next to the code they exercise, following the repo's current test conventions.

## Tanggung jawab per layer

| Layer | Pemilik | Tidak boleh menjadi |
| --- | --- | --- |
| `app/api/**/route.ts` (HTTP adapter / controller) | Parse request dan params; tetapkan actor store atau admin; validasi input tak tepercaya; panggil service/query; petakan outcome/error expected ke status/body existing; logging success/failure terstruktur | Tempat untuk Drizzle query, aturan harga/stok, atau orkestrasi provider |
| `features/<domain>/*-service.ts` (use case) | Invariant bisnis, urutan operasi, batas transaksi, compensation, input/outcome bertipe; koordinasi repository dan provider client | Wrapper yang hanya meneruskan parameter; module yang bergantung pada `NextRequest`/`NextResponse` |
| `features/<domain>/*-repository.ts` (DAL/persistence) | Drizzle query terfokus, write, dan projection aman yang eksplisit; menegakkan ownership/branch scope di dekat akses ke resource sensitif | Wrapper CRUD generik untuk setiap tabel; rumah bagi panggilan HTTP Midtrans/Jubelio |
| `features/<domain>/*-client.ts` (integration adapter) | Panggilan provider eksternal dan translasi protokol | Pengganti repository DB atau alasan memanggil provider di dalam transaksi DB |
| Pure helper / schema | Kontrak input, kalkulasi, aturan domain deterministik | Tempat sampah lintas fitur |

Route mengecek akses di entry point, **dan** fungsi service/repository yang bisa
dipakai ulang pemanggil lain tidak boleh bergantung pada pengecekan itu saja.
Bawa actor/scope bertipe saat dibutuhkan dan tegakkan permission per-resource di
jalur data/use-case. Jangan bocorkan baris DB utuh ke client: bentuk DTO respons
minimal. `import 'server-only'` pada module server-specific tepat dipakai bila
module itu berpotensi terimpor ke Client Component. Lihat [data security](https://nextjs.org/docs/app/guides/data-security) dan contoh
[admin order detail scope check](../../apps/admin/src/app/api/admin/orders/%5Bid%5D/route.ts).

**Contoh:** admin dari branch sendiri meminta ID order milik branch lain. Query
order harus mempertahankan perilaku **404** lintas branch yang sudah ada, bahkan
jika nanti dipakai ulang di luar route HTTP; mengecek hanya di halaman admin atau
route guard tidak cukup. Lihat [admin order detail](../../apps/admin/src/app/api/admin/orders/%5Bid%5D/route.ts) dan [auth architecture](auth.md).

## Batas service dan review signal

- Satu module service melayani **satu operasi bisnis**, dinamai sesuai operasinya
  (`place-order-service.ts`, `recover-payment-service.ts`), bukan sesuai seluruh
  domain. Pisahkan preview/place/recover/cancel ketika tanggung jawabnya memang
  berbeda.
- Service menjelaskan **urutan dan keputusan**; kalkulasi, payload provider, dan
  persistence berada di module masing-masing.
- God service ala `CheckoutService`, `helpers.ts`, `manager.ts`, dan repository
  generik yang dijadikan tempat sampah bukan hasil yang bisa diterima.
- **Memindahkan 1.400 baris dari route ke satu file service tidak memenuhi
  konvensi ini.** Acceptance dinilai dari cohesion dan interface, bukan lokasi
  file.
- Review signal, **bukan hard limit**: handler sekitar **80 baris** atau file
  handwritten sekitar **300 baris** memicu review cohesion dan detail yang
  seharusnya berada di tempat lain. Jangan memadatkan formatting, memecah file
  tanpa alasan cohesion, atau menambah wrapper pass-through untuk mencapai angka.
  Generated file, fixture besar, dan test dinilai sesuai tujuannya, bukan dipotong
  mekanis.
- Terapkan deletion test sebelum menambah layer atau seam: kalau menghapus module
  membuat kompleksitasnya hilang, itu tadi hanya pass-through. Lihat
  [`codebase-design`](../../.agents/skills/codebase-design/SKILL.md).

## Dependency logging

Structured logging adalah dependency dari layer di atas, bukan parameter yang
dijalin menembusnya. Kontrak yang mengikat ada di
[skill maintainable-code](../../.agents/skills/maintainable-code/SKILL.md) §7;
dokumen ini mencatat konsekuensinya untuk organisasi kode.

**Status saat ini:** core `@marketplace/logging` (Pino 10.4.0) dan facade di
`apps/store|admin/src/lib/logger.ts` adalah satu-satunya jalur logging backend
store/admin — engine legacy (`createLogger`, `requestLogger`, `withRequestId`,
`serializeError`, tipe `Logger`/`LogLevel`) sudah **dihapus** dan dijaga
`packages/logging/src/policy.test.ts`. Module/service/provider/helper memakai
`createModuleLogger` di module scope dan membaca korelasi dari scope yang dibuka
wrapper entry. Cakupan `withRequestContext` beserta pengecualian yang masih
tersisa dicatat di
[`docs/features/logging.md`](../features/logging.md#pengecualian-yang-harus-dibaca-bersama-tabel); jangan
menyimpulkan "semua route terbungkus" tanpa membaca tabel cakupan itu.

- Satu wrapper server-only per app (`apps/store|admin/src/lib/logger.ts`) di atas
  satu core logging internal; pemanggil tidak pernah mengimpor library logging
  secara langsung.
- Deklarasikan module logger **sekali di module scope**
  (`const log = createModuleLogger("checkout-place-order")`). Jangan pernah
  meneruskan `logger`, `log`, `requestId`, atau request object sebagai parameter
  fungsi bisnis, repository, provider adapter, script, maupun test **untuk
  keperluan logging/korelasi**.
- Yang tetap sah: input bisnis bertipe (mis. `actor`, `orderId` yang memang bagian
  dari operasi), dependency eksplisit seperti `db`/`tx` dan provider client, serta
  `Request`/`NextRequest` di `route.ts`/wrapper entry point.
- Entry point HTTP dan entry job membuka execution scope sekali; pemanggil
  bersarang mewarisinya. Data bisnis masuk ke teks `message`, sedangkan field
  terstruktur dibatasi whitelist teknis yang disepakati.
- [docs/features/logging.md](../features/logging.md) mencatat API facade, format
  record, pemetaan cakupan per area, pengecualian, serta batas evidence-nya. Baca
  bagian "Cakupan pemakaian" dan "Pengecualian" sebelum menyimpulkan bahwa
  sebuah endpoint sudah mengikuti kebijakan canonical.

## Kapan membuat layer baru

- **Endpoint sederhana:** bila tidak ada alur bisnis, jaga `route.ts` tetap tipis
  dengan memanggil fungsi query/DAL bernama (mis.
  `features/catalog/list-products.ts`) secara langsung. HTTP adapter tidak boleh
  memuat query Drizzle itu sendiri, dan service pass-through juga tidak
  diperlukan.
- **Operasi bisnis multi-langkah:** buat `*-service.ts` untuk **satu** use-case
  dengan nama operasi yang jelas, meski pemanggilnya cuma satu. Checkout misalnya
  terdiri dari beberapa operasi (preview, place, recover, cancel): koordinasikan
  stock hold, persistence order, Jubelio, dan pembayaran di dalam operasi spesifik
  yang memilikinya.
- **Persistence kompleks atau sensitif:** buat `*-repository.ts` terfokus (atau
  module DAL dengan nama jelas lain) untuk query terkait, scoped read, dan atomic
  update. Jangan membuat file repository terpisah untuk setiap tabel atau endpoint
  secara default.
- **Provider eksternal:** pakai client/adapter khusus untuk Jubelio, Midtrans,
  SMTP, dan sejenisnya, dimiliki fitur terkait atau dibagi lintas fitur secara
  sengaja. Transaksi DB tidak bisa meng-commit operasi HTTP eksternal secara
  atomik; pertahankan intent, idempotency, urutan, dan compensation yang sudah ada.
- **Dipakai bersama store dan admin:** jangan mengimpor `@/db` atau auth satu app
  ke app lain. Simpan adapter spesifik app di app masing-masing. Hanya logika yang
  benar-benar shared dan app-independent yang masuk package bersama; bila akses DB
  dibagi, teruskan DB/transaksi app secara eksplisit bersama actor, bukan memakai
  DB script-only milik package bersama. **Schema** bersama tetap eksklusif di
  `packages/db/src/schema/`. Lihat [overview](overview.md) dan [database](database.md).

Contoh perantara yang berguna adalah [admin roles route](../../apps/admin/src/app/api/admin/roles/route.ts)
yang mendelegasikan ke [roles-service](../../apps/admin/src/lib/rbac/roles-service.ts).
Rename/memindahkan seluruh module `lib/` yang berjalan **bukan** prasyarat:
migrasikan bertahap saat fitur terkait disentuh.

## Route Handlers versus other Next.js entry points

A Route Handler remains appropriate for browser-side HTTP calls, webhooks, cron, and external callers. A Server Component should normally call an authorized server-side data function directly instead of fetching its own app's HTTP API. Server Actions can be used for UI-triggered mutations but are independently reachable entry points: they require the same input validation and authorization, and can call the same use case. Do not replace existing HTTP APIs with actions merely to shorten files. See the [Next.js Backend-for-Frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend#caveats) and [data security guide](https://nextjs.org/docs/app/guides/data-security#mutating-data).

## Checklist refactor

1. Pilih **satu vertical slice**. Catat bentuk request/response, kode error,
log/request ID, scope auth dan branch, serta side effect eksternal yang ada ke
dalam test sebelum memindahkan logika. Ikuti [persyaratan testing](../../AGENTS.md)
dan [panduan testing](../testing/README.md).
2. Ekstrak service yang cohesive lebih dulu, lalu ekstrak persistence ke
repository di titik yang membuat invariant dan otorisasi lebih jelas. Pertahankan
scope transaksi dan urutan panggilan eksternal; jangan memindahkan provider call
ke dalam transaksi DB.
3. Pertahankan tipe/keputusan HTTP di boundary. Pakai input dan outcome bertipe di
service, lalu petakan ke kontrak HTTP yang **tidak berubah** di route. Pertahankan
logging `info` success dan `error` failure terstruktur untuk `/api/**` lewat
module-scoped logger — jangan menambah parameter logger/requestId saat ekstraksi
(lihat [dependency logging](#dependency-logging) dan [logging](../features/logging.md)).
4. Verifikasi perilaku unit, DB/integration, dan Playwright E2E yang relevan sesuai
kebutuhan perubahan. Baru setelah itu ulangi untuk fitur lain. Perpindahan
struktural tidak membenarkan drift perilaku.

**Contoh checkout:** untuk stok provider yang stale, `POST /api/checkout/place-order`
tetap harus mengembalikan respons retryable yang sudah ada tanpa meng-commit
order/stock hold atau memulai pembayaran. Memindahkan logika itu ke
service/repository hanya bernilai bila invariant yang sama tetap terlihat dan
teruji. Lihat [handler saat ini](../../apps/store/src/app/api/checkout/place-order/route.ts)
dan [stock reservation](../features/stock-reservation.md).
