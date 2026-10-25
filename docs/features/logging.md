# Structured logging (store & admin)

Dokumen ini mencatat **keadaan nyata** logging backend store/admin: satu facade
di atas core `@marketplace/logging` (Pino), engine legacy yang sudah **dihapus**,
dan kontrak target yang mengikat kode baru. Aturan yang wajib dipatuhi saat
menulis kode ada di
[skill `maintainable-code`](../../.agents/skills/maintainable-code/SKILL.md) §7;
dokumen ini menjelaskan pemakaian, cakupan, dan batasannya.

> **Status: runtime sudah dimigrasikan dan gate verifikasi akhir sudah hijau
> (2026-10-23).** Seluruh logging backend first-party store/admin sekarang
> memakai facade di `apps/store/src/lib/logger.ts` /
> `apps/admin/src/lib/logger.ts`; engine legacy (`createLogger`,
> `requestLogger`, `withRequestId`, `serializeError`, tipe `Logger`/`LogLevel`)
> **sudah dihapus** dari kedua file itu dan digantikan guard statis
> `packages/logging/src/policy.test.ts`. Setiap route handler HTTP first-party
> dibungkus `withRequestContext` (kecuali boundary yang tercatat di
> [pengecualian](#pengecualian-yang-harus-dibaca-bersama-tabel)), sehingga baris
> log pada jalur HTTP memakai `requestId` kanonik. Migrasi dieksekusi dalam
> **gelombang batch besar** atas permintaan eksplisit user, jadi bukti RED/GREEN
> per-file hanya ada untuk sebagian seam; gate akhir (types, lint, full unit,
> sweep mock E2E, production build) beserta **batas bukti**-nya dicatat di
> [Status evidence dan batas bukti](#status-evidence-dan-batas-bukti).

## Satu implementasi: facade di atas `@marketplace/logging`

`apps/store/src/lib/logger.ts` dan `apps/admin/src/lib/logger.ts` identik secara
struktur, dibedakan hanya oleh field `app` (`store` / `admin`). Keduanya memuat
**satu** API surface:

| Bagian | Status | Isi |
|---|---|---|
| **App facade** | Satu-satunya API logging backend | `createModuleLogger`, `withRequestContext`, `getRequestId`, `withExecutionContext`, `withDetachedExecutionContext` |
| **Engine legacy** | **Dihapus** | `createLogger`, `requestLogger`, `withRequestId`, `serializeError`, tipe `Logger`/`LogLevel`, `logger.child(context)` tidak lagi diekspor dari kedua file |
| **Core server-only** | Package terpisah | `@marketplace/logging` (Pino 10.4.0) memiliki schema record, sanitizer error, redaksi, dan context `AsyncLocalStorage` |

Pemanggil **tidak pernah** mengimpor Pino langsung; hanya core yang menyentuhnya.
Penghapusan engine legacy dijaga `packages/logging/src/policy.test.ts`, yang
memindai `apps/store/src` dan `apps/admin/src` untuk (a) nama helper legacy dan
(b) `console.*` langsung di `apps/<app>/src/app/api` (file test dikecualikan).
Guard itu hanya menutup **dua** invarian tersebut: larangan impor Pino langsung di
luar core belum punya guard ESLint, jadi kepatuhannya masih bergantung pada
review.
Satu root logger dimiliki per runtime app (disimpan pada anggota global
app-specific agar evaluasi modul berulang oleh Next.js tidak membuat root/Pino
kedua); logger module dibuat sekali per module.

## API baru

Semua fungsi diekspor dari `@/lib/logger` di masing-masing app.

| Fungsi | Kegunaan |
|---|---|
| `createModuleLogger(module)` | Dibuat **sekali di module scope**; mengikat nama module saja. `requestId`/`executionId` dibaca dari scope aktif **setiap kali log ditulis**, bukan saat logger dibuat. |
| `withRequestContext(handler, module?)` | Membungkus satu HTTP entry (route handler, webhook, cron HTTP) sebagai satu request scope. Argumen diteruskan apa adanya, response diberi header `x-request-id`, dan tepat satu baris completion ditulis (`info` <400, `warn` 4xx, `error` ≥500) dengan module `http` bila argumen module tidak diberikan. Nilai yang dilempar dicatat di dalam scope lalu dilempar ulang objek yang sama: wrapper tidak menelan error dan tidak mengubah status, body, header lain, redirect, cache, maupun semantics streaming. |
| `getRequestId()` | `requestId` kanonik scope aktif; `null` di luar HTTP scope. |
| `withExecutionContext(work)` | Scope job/worker/CLI dengan `executionId` baru, tetap mempertahankan `requestId` bila dipicu HTTP (mis. cron HTTP). |
| `withDetachedExecutionContext(work)` | Scope job/listener independen: `requestId` `null`, `executionId` baru. Dipakai background listener yang dibuat saat request berjalan. |

Method logger: `trace`, `debug`, `info`, `warn`, `error`, `fatal` — semuanya
`(message: string, error?: unknown) => void`.

Signature ini **tidak** menerima `logger`, `requestId`, atau objek context lewat
parameter. Larangan itu berlaku untuk service, repository, provider adapter,
helper, script, dan test; yang tetap sah adalah input bisnis bertipe, dependency
yang benar-benar dipakai (`db`/`tx`, provider client), dan `Request`/`NextRequest`
di `route.ts`.

## Format record

Satu objek JSON per baris, UTF-8, ke stdout:

```json
{"timestamp":"2026-10-23T08:30:45.123Z","level":"info","app":"store","requestId":"…","module":"checkout-service","message":"Order order-123 berhasil dibuat"}
```

- Field tetap: `timestamp` (ISO 8601 UTC), `level`, `app`, `requestId`, `module`,
  `message`. Field opsional: `error`; khusus scope job/worker/CLI:
  `executionId`.
- Tidak ada field default Pino (`pid`, `hostname`, `msg`, level numerik) dan
  tidak ada binding bisnis bebas (`orderId`, `userId`, `total`, payload).
- `requestId` adalah UUID kanonik buatan **server** pada HTTP entry. Incoming
  `x-request-id` **tidak** dipakai sebagai identitas kanonik; response membawa
  UUID yang sama dengan log. `requestId` `null` di luar HTTP scope — bukan UUID
  palsu per log.
- `executionId` menandai scope job/worker/CLI/script, bukan pengganti
  `requestId`. Job yang dipicu HTTP (mis. cron HTTP) tetap membawa `requestId`
  HTTP-nya; job/worker/CLI independen memakai `requestId` `null` plus
  `executionId` baru yang dibuat sekali di entry.
- Level: `trace`…`fatal`; `LOG_LEVEL` (default `info`) memfilter. Nilai env yang
  tidak valid jatuh ke `info` dan dilaporkan satu kali lewat diagnostic aman.
  `fatal` tidak memanggil `process.exit()`.

## Data bisnis, error, dan privasi

- **Data bisnis masuk `message`** dengan frasa stabil dan identifier jelas
  (`Order order-123 berhasil dibuat`). Jangan menyerialkan request body, baris DB,
  atau payload provider ke message.
- Field `error` hanya berisi proyeksi teknis allowlisted: `name`, `message`, safe
  `code`, stack tersanitasi, dan `cause` terbatas (maksimum 3 level). Batas
  deterministik: message ≤ 2048 karakter, stack ≤ 8192 karakter, dengan penanda
  `[truncated]`/`[circular]`. Normalisasi error provider/auth ke proyeksi aman
  **sebelum** logging.
- Mekanisme proyeksi boleh berbeda per module: gateway `jubelio-sales` memakai
  allowlist literal (`QUEUE_FULL`/`QUEUE_TIMEOUT`), helper
  `jubelio-sales-lifecycle` memvalidasi **bentuk** kode (token uppercase terbatas)
  alih-alih mengenerasi daftar kode, dan `apps/admin/src/lib/rbac/guard.ts`
  memakai proyeksi statis `RbacGuardLogError` untuk jalur unexpected. Semuanya
  sama-sama tidak menyalin `message`, `stack`, maupun `cause` asli ke log.
- Redaksi nilai sensitif di message/`error` bersifat **best-effort**, bukan
  jaminan universal: ia mengenali known key (`password`, `token`, …;
  plain/quoted/JSON-like), header authorization/cookie, kredensial
  `Bearer`/`Basic`, email, userinfo URL, dan query value. Secret/PII yang
  tertanam di teks bebas tetap bisa lolos, jadi pemanggil tetap wajib mengirim
  ringkasan aman.
- Kegagalan serialisasi/sink **tidak** menggagalkan alur bisnis. Konsekuensinya:
  bila sink async down (`EPIPE`/`EIO`), baris log **hilang** — tidak ada retry
  otomatis dan tidak ada jaminan delivery, juga tidak ada fallback tulis ke
  tempat lain.
- Audit Event database tetap berbeda dari application log: audit row tidak
  diganti dengan baris stdout, dan perubahan logging tidak mengubah status/body
  HTTP, auth/RBAC denial, maupun urutan lock/transaksi.
- Belum ada OpenTelemetry SDK/collector, tracing terdistribusi, log aggregator
  baru, atau pino-pretty.

## Contoh pemakaian

Contoh di bawah mereproduksi route pilot store `GET /api/categories` apa adanya
(`apps/store/src/app/api/categories/route.ts`): struktur serta query tidak
diubah oleh slice logging, hanya module logger dan wrapper entry.

```ts
import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories } from "@/db";
import { eq, asc } from "drizzle-orm";
import { createModuleLogger, withRequestContext } from "@/lib/logger";

const log = createModuleLogger("categories-route");

async function getCategories(): Promise<Response> {
  try {
    const allCategories = await db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.name));

    // Data bisnis (jumlah kategori) hanya ada di message, bukan field log.
    log.info(`Kategori aktif dimuat: ${allCategories.length}`);

    return NextResponse.json({ success: true, data: allCategories });
  } catch (error) {
    log.error("Kategori gagal dimuat", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

export const GET = withRequestContext(getCategories, "categories-route");
```

Kode nyata pada file tersebut memuat query Drizzle inline karena slice-nya
logging-only; aturan `route.ts` tanpa query tetap berlaku untuk kode baru
(lihat [code organization](../architecture/code-organization.md)).

## Cakupan pemakaian

| Area | Contoh | Scope korelasi |
|---|---|---|
| Route handler HTTP first-party (store) | `api/categories`, `api/products`, `api/cart/*`, `api/checkout/*`, `api/orders/*`, `api/payments/*`, `api/webhooks/*`, `api/cron/*`, `api/internal/order-complete`, `api/addresses/*`, `api/onboarding/sync`, `api/shipment/regions`, `api/discounts/available` | HTTP (`withRequestContext`), satu module per entry |
| Route handler HTTP first-party (admin) | `api/admin/*` termasuk orders/delivery, discounts, price-changes, roles/RBAC, users, notifications, pages/CMS, analytics, upload | HTTP (`withRequestContext`), satu module per entry |
| Module bisnis non-HTTP | `jubelio-sales-client.ts` (`jubelio-sales`), `jubelio-sales-lifecycle.ts`, `jubelio-sales-settlement.ts`, `jubelio-channel-mirror.ts`, `jubelio-shipment-client.ts`, `order-finalize.ts`, `checkout-recovery.ts`, `checkout-request.ts`, `paid-order-side-effects.ts`, `config.ts`, `address-api.ts` (`client-addresses`), `admin/src/lib/shipment-fulfillment.ts`, `admin/src/lib/delivery-follow-up.ts`, `admin/src/lib/discounts-http.ts`, `admin/src/lib/price-changes-http.ts`, `admin/src/lib/rbac/guard.ts`, `admin/src/lib/rbac/route-guards.ts` | `createModuleLogger` di module scope; **tidak** membuka scope, mengikuti scope pemanggil |
| CLI/script fungsional (`packages/db` seeder/reset/import/bootstrap, script sandbox store) | output PASS/FAIL, ringkasan seed | tetap `console.*` — itu output fungsional CLI, bukan application log, dan berada di luar scope migrasi |

### Pengecualian yang harus dibaca bersama tabel

Cakupan wrapper per app (dihitung ulang setelah seluruh route first-party
dibungkus):

| App | `route.ts` di `src/app/api` | Dibungkus | Tanpa wrapper |
|---|---|---|---|
| store | 34 | 33 | `auth/[...all]/route.ts` |
| admin | 72 | 71 | `auth/[...all]/route.ts` |

Store 34 `route.ts` → 33 dibungkus; satu-satunya route store yang tidak dibungkus
adalah `apps/store/src/app/api/auth/[...all]/route.ts` (catch-all Better Auth,
memang tidak boleh dibungkus). Admin 72 `route.ts` → 71 dibungkus; hanya
`auth/[...all]/route.ts`. Setiap route first-party lain dibungkus
`withRequestContext`, jadi baris log pada jalur HTTP first-party memakai
`requestId` kanonik. Angka yang sama dirujuk di
[`docs/api-reference.md`](../api-reference.md), [`docs/testing/README.md`](../testing/README.md),
[`docs/deployment-docs/logging.md`](../deployment-docs/logging.md), dan skill
`maintainable-code`.

- `auth/[...all]/route.ts` (catch-all Better Auth, kedua app) dan
  `/uploads/[...path]` (handler file statis, di luar `src/app/api`) tidak dibungkus
  `withRequestContext`: keduanya handler milik library/static boundary dan tidak
  menjalankan logging bisnis first-party, sehingga jaminan header/`requestId`
  tidak berlaku di sana.
- `/api/addresses` (`store-addresses`), `/api/addresses/[id]` (`store-address`),
  dan `/api/addresses/[id]/default` (`store-address-default`) dibungkus
  `withRequestContext` pada `route.ts`-nya. Logging bisnisnya tetap milik boundary
  bersama `apps/store/src/lib/address-api.ts` (module `client-addresses`) yang
  tidak membuka scope sendiri, sehingga baris bisnis dan baris completion pada
  jalur ini memakai `requestId` HTTP yang sama.
- `/api/onboarding/sync` (`onboarding-sync`) dibungkus `withRequestContext` dan
  tidak menulis log bisnis; kontribusinya hanya satu baris completion per
  request. Status redirect, target redirect, dan cookie `client.onboarding` tetap
  apa adanya.
- Dua route admin yang dulu menjadi sisa migrasi —
  `apps/admin/src/app/api/admin/prices/[variantId]/history` dan
  `apps/admin/src/app/api/admin/shipment/regions` — sekarang memakai module logger
  miliknya sendiri (`admin-price-history`, `admin-shipment-regions`) plus
  `withRequestContext`, jadi tidak lagi mengambil `logger` dari
  `apps/admin/src/lib/rbac/guard.ts` (guard itu tetap tidak mengembalikan logger).

### Detail module yang sudah dimigrasikan (tetap berlaku)

- **Gateway `jubelio-sales-client.ts`** — satu `createModuleLogger("jubelio-sales")`,
  tanpa opsi logger/context dari pemanggil. Nilai caught tidak pernah diteruskan
  mentah: module membuat proyeksi statisnya sendiri (`JubelioSalesDependencyError`)
  dengan `code` hanya boleh literal allowlist `QUEUE_FULL`/`QUEUE_TIMEOUT`.
  Baris pre-send tetap ada sehingga penolakan antrean tercatat **sebelum** cabang
  klasifikasi. Body request/response provider dan nilai remote `channel_status`
  tidak dicatat.
- **Helper `jubelio-sales-lifecycle.ts`** — satu `createModuleLogger` di module
  scope, tanpa opsi logger/context; error memakai proyeksi statis milik module
  (`JubelioSalesLifecycleLogError`) dan `code` hanya diteruskan bila lolos pola
  token uppercase terbatas (`/^[A-Z][A-Z0-9_]{0,63}$/`) — validasi bentuk, bukan
  enum allowlist. Pesan hasil klasifikasi mentah tetap dipakai untuk persistensi
  dan nilai `return`, tidak masuk log. Helper ini tidak membuka scope apa pun.
- **RBAC guard `apps/admin/src/lib/rbac/guard.ts`** — satu module logger `rbac`,
  tidak mengembalikan/meneruskan logger ke pemanggil. Resource/action dan actor
  id berada di `message`; tidak ada nama, email, materi session, atau alasan
  denial bebas di baris log. Jalur unexpected memakai proyeksi statis
  `RbacGuardLogError` sementara pemanggil tetap menerima envelope 500 yang sama.
- **HTTP helper bersama** (`apps/admin/src/lib/price-changes-http.ts`,
  `apps/admin/src/lib/discounts-http.ts`, `apps/store/src/lib/address-api.ts`)
  memakai module logger tanpa parameter `logger`; yang berubah hanya logging,
  sedangkan status/body/envelope error tetap.

## `requestId` versus `executionId` (batas yang jujur)

- `requestId` adalah identitas kanonik untuk **jalur HTTP**: satu request → satu
  UUID yang sama pada semua baris dalam scope itu dan pada header
  `x-request-id` response.
- Entri non-HTTP (script yang dipanggil internal, kerja background yang detached)
  **tidak** punya `requestId`; nilainya `null` sesuai desain, bukan bug dan bukan
  alasan membuat UUID baru per baris.
- `withExecutionContext`/`withDetachedExecutionContext` adalah jalur resmi untuk
  memberi entri non-HTTP sebuah `executionId`. Hari ini keduanya baru dipakai di
  seam test, **belum** ada entry runtime (cron internal/script/worker) yang
  membukanya. Jangan mengklaim baris `executionId` sudah muncul di runtime
  sebelum entry semacam itu benar-benar dimigrasikan dan diuji.
- Helper/repository/provider bersarang tidak membuka scope sendiri. Context
  hilang di dalam satu alur HTTP adalah bug/diagnostic, bukan alasan membuat ID
  baru.
- Retry internal di dalam satu request mempertahankan `requestId` yang sama,
  sedangkan webhook berikutnya, replay lewat request baru, atau retry yang dikirim
  sebagai HTTP request baru mendapat UUID baru. Context tidak pernah diteruskan
  antar proses atau antar request.
- Facade tidak membaca `headers()` secara tersembunyi setiap kali log ditulis;
  satu-satunya sumber `requestId` adalah scope yang dibuka wrapper entry.

## Verifikasi

```bash
# kontrak core (envelope, level, error, redaksi, context) + guard kebijakan
npm run verify:unit:slice -- packages/logging/src/logger.test.ts \
  packages/logging/src/http-context.test.ts \
  packages/logging/src/policy.test.ts

# facade app + dua route pilot
npm run verify:unit:slice -- apps/store/src/lib/logger.test.ts \
  apps/admin/src/lib/logger.test.ts \
  apps/store/src/app/api/categories/route.test.ts \
  apps/admin/src/app/api/admin/session-check/route.test.ts

# provider client + helper/entry Jubelio yang sudah dimigrasikan
npm run verify:unit:slice -- apps/store/src/lib/jubelio-sales-client.test.ts
npm run verify:unit:slice -- \
  apps/store/src/lib/jubelio-sales-create-marker.db.test.ts \
  apps/store/src/lib/jubelio-sales-recovery.db.test.ts \
  apps/store/src/lib/jubelio-sales-versioned.db.test.ts \
  apps/store/src/lib/jubelio-sales-settlement.test.ts \
  apps/store/src/lib/discount-lifecycle-flow.db.test.ts

npm run verify:types:store
npm run verify:types:admin
npm run lint:store
npm run lint:admin

# korelasi pada server Next nyata (DB disposable + artifact stdout)
DATABASE_URL=<db-disposable> npm run verify:batch:e2e -- \
  e2e/store/logging-mock.spec.ts e2e/admin/logging-mock.spec.ts
```

`LOG_LEVEL=debug npm run dev:store` memunculkan level `debug`; default `info`
menyembunyikannya. Untuk memeriksa korelasi manual: satu request → satu
`requestId` pada semua baris yang ditulis dalam scope itu, dan response membawa
header `x-request-id` yang sama.

`npm run lint:store` masih gagal karena satu error **pre-existing** di
`apps/store/src/components/Header.tsx:39` (file tanpa diff pada pekerjaan logging
ini), jadi jangan mengharapkan perintah itu hijau; lihat
[batas bukti](#status-evidence-dan-batas-bukti).

## Status evidence dan batas bukti

Migrasi dijalankan sebagai **gelombang batch besar** (bukan slice kecil per
call-chain) atas permintaan eksplisit user, sehingga siklus RED→GREEN per file
hanya tercatat untuk subset seam berikut:

| Seam | Evidence RED/GREEN per file |
|---|---|
| Core package (`logger.test.ts` + `http-context.test.ts`) | 18 test |
| Facade app (`apps/store` dan `apps/admin`, `src/lib/logger.test.ts`) | 2 test |
| Dua route pilot (`categories`, `admin/session-check`) | 5 test |
| `jubelio-sales-client.test.ts` | 133 test |
| Slice lifecycle (5 file L1) | 38 pass / 2 skipped |
| `jubelio-sales-settlement` | 35 pass / 1 skipped |

Gate akhir kemudian dijalankan **satu kali sebagai batch** (parent, 2026-10-23)
pada database disposable `marketplace_discounts_test_logging_01a1646c` dengan
kredensial provider palsu, tanpa Docker, remote action, atau provider live:

| Gate akhir | Hasil |
|---|---|
| `npm run verify:types:store` | PASS |
| `npm run verify:types:admin` | PASS |
| `npm run verify:unit:slice -- packages/logging/src/policy.test.ts` | 3/3 PASS |
| ESLint scoped pada seluruh 186 file TS yang berubah | 0 error |
| `npm run lint:admin` | 0 error, 36 warning |
| `npm run lint:store` | **1 error pre-existing** — lihat batas bukti; `lint:store` **tidak** hijau |
| `npm run verify:batch:unit` | 163 file pass, 1776 test pass, 12 skipped (1788 total) |
| Sweep mock E2E penuh (`playwright.mock.config.ts`, semua spec) | 152 pass, 0 fail |
| `npm run build:store` + `npm run build:admin` | keduanya "Compiled successfully" |

**Batas bukti yang wajib dibaca bersama kedua tabel:**

- **`lint:store` tidak hijau dan tidak boleh disebut hijau.** Satu-satunya error
  adalah `react-hooks/set-state-in-effect` di
  `apps/store/src/components/Header.tsx:39` — file yang tidak punya diff pada
  pekerjaan logging ini sama sekali, jadi itu isu repo **pre-existing** di luar
  scope migrasi, bukan regresi. Jangan menyimpulkan "lint kedua app bersih".
- Skip **bukan** pass: 12 test pada batch unit tercatat skipped, bukan lulus.
- RED/GREEN per file hanya ada untuk subset seam di tabel pertama; gelombang besar
  tidak menyimpan bukti RED untuk setiap file yang disentuh. End-state dibuktikan
  tabel gate, bukan klaim per file.
- Korelasi `requestId` pada server Next nyata tetap dipusatkan pada dua spec pilot
  (`e2e/store/logging-mock.spec.ts`, `e2e/admin/logging-mock.spec.ts`) yang membaca
  artifact stdout; endpoint lain memakai wrapper yang sama tetapi belum punya
  artifact E2E sendiri.
- Cakupan wrapper sudah penuh untuk route first-party: store 33 dari 34
  `route.ts` dan admin 71 dari 72, dengan satu-satunya pengecualian
  `auth/[...all]/route.ts` (catch-all Better Auth). Lihat
  [tabel cakupan](#pengecualian-yang-harus-dibaca-bersama-tabel). Empat route
  store yang terakhir dibungkus — `/api/addresses`, `/api/addresses/[id]`,
  `/api/addresses/[id]/default`, `/api/onboarding/sync` — kini juga memakai
  wrapper, sehingga barisnya ber-`requestId` kanonik. Yang belum ada per
  endpoint bukan cakupan wrapper, melainkan artifact E2E korelasi sendiri (poin
  sebelumnya).
- Eksekusi non-HTTP memakai `requestId` `null` dan `executionId` bila entry-nya
  membuka scope; belum ada entry runtime yang membukanya, jadi ini batas desain,
  bukan bukti korelasi job.
- Seluruh run memakai provider palsu/loopback dan DB disposable: dokumen ini tidak
  membuktikan perilaku provider live, deployment, atau UAT staging.

## Capture log development (`logs/`)

Saat development, output proses `next dev` **dan** baris JSON
`@marketplace/logging` disalin ke file oleh script npm — bukan oleh aplikasi.
Aplikasi tetap hanya menulis ke stdout (lihat [Catatan operasional](#catatan-operasional)).

| Script | File yang ditulis |
|---|---|
| `npm run dev:all` | `logs/jubelio-mock.log`, `logs/store.log`, `logs/admin.log` |
| `npm run dev:store` (dan `npm run dev`) | `logs/jubelio-mock.log`, `logs/store.log` |
| `npm run dev:admin` | `logs/admin.log` |

Sifat capture:

- **Ditimpa setiap run** (bukan append), jadi isinya hanya sesi terakhir. Tidak ada
  rotasi/retensi: ini alat debugging, bukan arsip.
- **File bebas ANSI escape code.** `concurrently` menyuntikkan `FORCE_COLOR` ke
  setiap anak saat stdout-nya sendiri berupa TTY, sehingga Next/Turbopack tetap
  mengeluarkan kode warna walaupun stdout sudah dipipe ke `tee`. Karena itu file
  ditulis lewat `tee >(sed -u -E -f scripts/strip-ansi.sed > logs/<app>.log)`:
  terminal tetap berwarna, file bersih. `sed -u` penting agar baris langsung
  ditulis (tanpa `-u` sed menahan output di buffer ~4 KB, jadi `tail -f` terlihat
  kosong dan baris terakhir bisa hilang saat Ctrl+C).
- Terminal tetap menampilkan output yang sama; `concurrently` memberi prefiks nama
  proses (`[store]`, `[admin]`, `[jubelio-mock]`). Prefiks itu **tidak** masuk file,
  karena `tee` berjalan di dalam perintah anak.
- Baris JSON envelope tetap utuh di file sehingga bisa langsung dipakai:
  `grep '"level":"error"' logs/store.log` atau
  `jq -c 'select(.module=="checkout-service")' logs/store.log`.
- `npm run --silent` dipakai agar banner npm (`> dev:store:app`, `> next dev`)
  tidak mengotori file.
- Pipeline dibungkus `bash -o pipefail -c '…'` supaya exit code proses anak tidak
  ditelan `tee`; proses yang mati tetap dilaporkan `concurrently` dan
  `npm run dev:all` keluar non-zero.
- Folder `logs/` dibuat oleh `predev:all` / `predev:store` / `predev:admin`
  (`mkdir -p logs`) dan di-ignore git (`/logs/` di `.gitignore`).

Batasan yang perlu diketahui:

- Jangan menjalankan `dev:store`/`dev:admin` bersamaan dengan `dev:all`: dua sesi
  akan menulis file yang sama dan saling menimpa (gejalanya file berisi `\0` /
  campuran dua sesi).
- Script dev membutuhkan `bash` (Linux/macOS/WSL/Git Bash). `cmd.exe`/PowerShell
  tidak didukung.
- Output `next dev` tetap berisi baris non-JSON (compile/HMR); reader yang ketat
  harus melewati baris yang gagal di-parse, seperti
  [`e2e/support/logging-artifacts.ts`](../../e2e/support/logging-artifacts.ts).
- Produksi tidak berubah: container tetap menulis ke stdout dan dibaca `journald`
  ([`docker-compose.yml`](../../deployment/production/docker-compose.yml)).

Kontrak konfigurasi ini dijaga test
[`scripts/dev-log-capture.test.mts`](../../scripts/dev-log-capture.test.mts):

```bash
npm run verify:unit:slice -- scripts/dev-log-capture.test.mts
```

## Catatan operasional

- Tidak ada konfigurasi rotasi/file output di **aplikasi**; runtime hanya menulis ke
  stdout. Rotasi dan retensi urusan platform (Docker `journald`). Detail
  pembacaan/filter level ada di
  [`docs/deployment-docs/logging.md`](../deployment-docs/logging.md). Capture file
  saat development dilakukan script npm (`tee`), lihat
  [Capture log development](#capture-log-development-logs).
- Satu root logger per runtime app. Jangan membuat root/transport baru per module
  atau per request, dan jangan memonkey-patch `console`.
- `AsyncLocalStorage` tidak membatalkan async resource saat scope selesai:
  background work yang hidup melewati scope (listener singleton, timer) harus
  membuka `withExecutionContext`/`withDetachedExecutionContext` sendiri.
- Header `x-request-id` beserta kebijakan incoming-id ada di
  [`docs/api-reference.md`](../api-reference.md); perintah dan artifact test
  korelasi ada di [`docs/testing/README.md`](../testing/README.md).
