---
name: maintainable-code
description: Aturan wajib sebelum implementasi/refactor di marketplace repo — struktur feature-first dengan route/service/repository/gateway, service per operasi (anti God Service), review signal 80/300, no overabstraction, serta logging contextual Pino module-scope tanpa parameter logger/requestId. Gunakan saat menulis kode backend baru, memindahkan logika dari route, mengubah struktur fitur, atau menambah logging.
---

# Maintainable code dan contextual logging

Aturan ini wajib dibaca **sebelum** implementasi: kode backend baru, perubahan
struktur/folder fitur, pemindahan logika dari `route.ts`, penambahan logging, atau
review perubahan yang menyentuh dua hal tersebut. Sifatnya mengikat, tetapi bukan
izin refactor massal dan bukan bukti bahwa kode runtime sudah mengikuti aturan ini.

Dokumen pendamping:

- [`docs/architecture/code-organization.md`](../../../docs/architecture/code-organization.md) — konvensi organisasi kode yang mengikat.
- [`codebase-design`](../codebase-design/SKILL.md) — kosakata **module**, **interface**, **seam**, **adapter**, **deep/shallow** yang dipakai di sini.
- [`tdd`](../tdd/SKILL.md) — cara menulis test pada public seam.

> **Status implementasi.** Skill ini menetapkan **kontrak yang mengikat**, dan
> runtime store/admin sudah dimigrasikan ke kontrak ini: seluruh logging backend
> first-party memakai facade `apps/<app>/src/lib/logger.ts`
> (`createModuleLogger`, `withRequestContext`, `getRequestId`,
> `withExecutionContext`, `withDetachedExecutionContext`) di atas core
> `@marketplace/logging`/Pino, setiap route handler HTTP first-party dibungkus
> `withRequestContext`, dan **engine legacy** (`createLogger`, `requestLogger`,
> `withRequestId`, `serializeError`, tipe `Logger`) sudah **dihapus** dari kedua
> file logger. Migrasi dieksekusi sebagai gelombang batch besar, jadi bukti
> RED/GREEN per file hanya ada untuk sebagian seam; gate verifikasi akhir sudah
> hijau (types store+admin, `policy.test.ts` 3/3, batch unit 159 file/1766 pass/12
> skipped, sweep mock E2E penuh 152 pass, `build:store`+`build:admin` compiled),
> dengan satu pengecualian yang wajib tetap disebut: `npm run lint:store` masih
> gagal karena satu error **pre-existing** di
> `apps/store/src/components/Header.tsx:39` (di luar scope migrasi). Cakupan
> wrapper sudah penuh — store 33 dari 34 `route.ts` dan admin 71 dari 72, dengan
> satu-satunya pengecualian `auth/[...all]/route.ts` (catch-all Better Auth,
> memang tidak boleh dibungkus) — sehingga baris HTTP first-party, termasuk
> `/api/addresses*` dan `/api/onboarding/sync`, memakai `requestId` kanonik.
> Tabel cakupan wrapper, pengecualian, dan batas evidence ada di
> `docs/features/logging.md`; jangan melaporkan gate lulus di luar run yang
> benar-benar dijalankan.

## 1. Struktur: feature-first, bukan layer-first

Default alur backend per fitur:

```text
HTTP request → app/api/**/route.ts        # HTTP adapter
             → features/<domain>/*-service.ts     # workflow / use case
                 ├── *-repository.ts       # persistence
                 ├── *-client.ts           # provider/gateway HTTP eksternal
                 └── modul domain murni    # kalkulasi, policy, schema input
```

- Kode diorganisir **berdasarkan fitur/domain**, bukan folder global `services/`,
  `repositories/`, `controllers/`.
- Ini konvensi proyek, bukan keharusan Next.js. Next.js hanya mewajibkan
  `route.ts` dan named export `GET`/`POST`; sisanya bebas.
- Nama file harus spesifik: `place-order-service.ts`, `checkout-repository.ts`,
  `midtrans-client.ts`. Hindari `service.ts`, `helpers.ts`, `utils.ts` di dalam
  folder fitur tanpa kata benda domain.
- Folder baru dibuat **saat dibutuhkan**, bukan sebagai skeleton kosong.
- Schema tabel tetap **hanya** di `packages/db/src/schema/`; app tidak pernah
  mendefinisikan tabel, dan `db`/auth satu app tidak boleh diimpor app lain.

## 2. Tanggung jawab per layer

| Layer | Boleh | Tidak boleh |
|---|---|---|
| `route.ts` (HTTP adapter) | Parse request/params, resolve actor, validasi input, panggil service/query module, map hasil ke status/body existing, log success/failure | Menulis query Drizzle, aturan harga/stok, orkestrasi provider, transaksi panjang |
| `*-service.ts` (workflow) | Invariant bisnis, urutan langkah, batas transaksi, compensation, input/output bertipe, koordinasi repository + client | SQL/Drizzle query, `NextRequest`/`NextResponse`, parameter `logger`/`requestId`/request object yang diteruskan untuk logging |
| `*-repository.ts` (persistence) | Query Drizzle terfokus, write, projection aman, scope/branch ownership, lock, atomic conditional update | Panggilan HTTP provider, mapping HTTP response, aturan presentasi |
| `*-client.ts` (gateway) | Panggilan provider eksternal + translasi protokol, normalisasi error provider | Menjadi pengganti repository, dipanggil di dalam transaksi DB seolah atomik |
| Modul domain murni | Kalkulasi, policy, schema input, aturan deterministik | Menjadi tempat sampah lintas fitur |

Aturan yang paling sering dilanggar:

- **`route.ts` tidak menulis query.** Handler hanya memanggil service, atau —
  bila memang tidak ada workflow bisnis — memanggil **query/DAL function** bernama
  secara langsung. Query tidak dikembalikan ke dalam handler.
- **Repository atau query module tidak boleh bergantung pada route guard.**
  Fungsi yang bisa dipakai ulang harus menegakkan scope di dekat data (mis.
  cross-branch tetap `404`).
- **Provider call tidak dibungkus transaksi DB.** Pertahankan urutan, idempotency,
  dan compensation yang sudah ada.

## 3. Service per operasi, bukan God Service

- Satu service = **satu operasi bisnis** dengan nama operasi: `place-order-service`,
  `recover-payment-service`, `cancel-order-service`.
- Pisahkan operasi ketika tanggung jawabnya memang berbeda (preview vs place vs
  recover vs cancel). Jangan gabungkan hanya karena satu folder/halaman.
- Service menjelaskan **urutan dan keputusan**. Detail kalkulasi, payload
  provider, dan persistence berada di module masing-masing.
- Dilarang: `CheckoutService` raksasa, `helpers.ts`, `manager.ts`, atau generic
  repository sebagai dumping ground.
- **Memindahkan 1.400 baris dari route ke satu file service bukan pemenuhan
  aturan.** Yang dinilai adalah cohesion dan interface, bukan lokasi file.

## 4. Review signal, bukan hard limit

- Handler/fungsi sekitar **80 baris** dan file handwritten sekitar **300 baris**
  adalah **sinyal** untuk mengevaluasi cohesion dan detail yang seharusnya pindah
  ke module lain.
- Angka itu **bukan hard limit** dan bukan acceptance criterion.
- Dilarang mengejar angka dengan memadatkan formatting, memecah file tanpa alasan
  cohesion, atau menambah wrapper pass-through.
- Generated file, fixture besar, dan test dievaluasi sesuai tujuannya; jangan
  dipotong mekanis.

## 5. Jangan over-abstract

Tidak wajib: class, pasangan interface–implementation, DI container,
`BaseRepository`, entity class duplikat, atau tiga file ceremonial untuk CRUD
sederhana. Seam hanya dibuat kalau sesuatu benar-benar bervariasi di sana, dan
module baru harus lulus **deletion test**: kalau dihapus, kompleksitas hilang
berarti itu hanya pass-through.

**Contoh kasus.** Endpoint yang hanya membaca satu daftar dengan filter cukup
memanggil `list-products.ts` dari `route.ts`. Menambahkan
`list-products-service.ts` yang meneruskan parameter ke fungsi itu tidak menambah
leverage, hanya menambah file; sebaliknya, memindahkan query 60 baris ke dalam
`route.ts` karena "masih satu query" juga melanggar aturan §2.

## 6. Types, error, test, privacy

- **Types.** Input/output service dan repository bertipe eksplisit. Jangan
  melempar baris tabel utuh ke client; shape DTO minimal. Jangan memakai `any`
  untuk melewati kontrak, dan jangan membawa `NextRequest`/`NextResponse` ke
  service/repository — tipe HTTP itu tempatnya di `route.ts` atau wrapper entry
  point, bukan di modul domain/persistence.
- **Error.** Bedakan **expected outcome** (validasi, unauthorized, conflict,
  stok stale, provider menolak) dari **unexpected failure**. Petakan ke
  status/body HTTP yang sudah ada **di route**; jangan menelan error, jangan
  mengubah kontrak HTTP, dan jangan jadikan error tak terduga sebagai success.
- **Test.** Uji perilaku lewat public seam (service, route, helper publik), bukan
  detail internal. Unit test untuk aturan domain dan mapping; integration test
  untuk transaksi/concurrency/scope; Playwright dengan provider **mock** untuk
  perilaku user-visible. Tulis test yang mengunci invariant existing sebelum
  memindahkan logika. Lihat [`tdd`](../tdd/SKILL.md).
- **Privacy/security.** Jangan mengembalikan atau menuliskan PII, kredensial,
  cookie, authorization header, raw provider response, atau full URL query ke
  log. Authorization tetap dicek dekat data, bukan hanya di route/middleware.
  Audit Event database bukan application log: jangan diganti dengan stdout.

## 7. Contextual logging (target kontrak)

Engine: Pino di balik satu wrapper internal server-only. Pemanggil **tidak pernah**
mengimpor Pino langsung dan **tidak pernah** meneruskan logger sebagai parameter.

### 7.1 Deklarasi sekali di module scope

Contoh berikut memakai API satu-satunya di `@/lib/logger` kedua app
(`createModuleLogger`, `withRequestContext`); signature-nya dikunci test public
seam `packages/logging/src/*.test.ts`, `apps/*/src/lib/logger.test.ts`, dan test
route. Engine legacy sudah dihapus, jadi tidak ada jalur kedua yang sah: jangan
menulis pola lama (`createLogger`, `requestLogger`, parameter `logger`,
`logger.child(...)`, `console.*` di `apps/**/src/app/api`) — guard statis
`packages/logging/src/policy.test.ts` akan merah untuk itu.

```ts
// features/checkout/place-order-service.ts
import { createModuleLogger } from "@/lib/logger";

const log = createModuleLogger("checkout-place-order");

export async function placeOrder(input: PlaceOrderInput) {
  log.info(`Order ${input.orderId} mulai diproses`);
  // ...
  log.error(`Order ${input.orderId}: inisialisasi pembayaran gagal`, error);
}
```

- Logger dibuat **sekali per module**, mengikat nama module saja.
- Context dinamis (requestId/executionId) dibaca **saat log ditulis**, bukan saat
  import atau saat logger dibuat.
- **Dilarang** adalah menyalurkan **logging/correlation** lewat parameter atau
  options: `logger`/`log`, `requestId`/execution ID, HTTP request object, atau
  object context bebas yang semata-mata dipakai untuk logging. Ini berlaku untuk
  service, repository, provider adapter, helper, caller script, dan test.
  Parameter `uuid` generator ikut dilarang **hanya** bila tujuannya membuat ID
  korelasi log.
- **Tetap sah** dan bukan pelanggaran larangan di atas:
  - input bisnis bertipe yang memang bagian dari kontrak operasi (mis.
    `orderId`, `actor`, `branchId`, DTO input/outcome);
  - dependency eksplisit yang benar-benar dipakai untuk bekerja: `db`/`tx`,
    provider client/gateway, clock, dan generator ID bisnis;
  - `Request`/`NextRequest` di `route.ts` atau wrapper HTTP/entry point, karena
    di situlah objek HTTP memang dibaca dan dipetakan.

  Uji cepatnya: parameter itu ada untuk **logging/correlation** atau untuk
  **pekerjaan nyata**? Yang pertama dilarang, yang kedua sah.
- **Dilarang** membuat root logger/transport baru per module atau per request,
  serta memonkey-patch `console`.

### 7.2 Bentuk record

Satu JSON object per baris ke stdout:

```json
{"timestamp":"2026-10-23T08:30:45.123Z","level":"info","app":"store","requestId":"req-A","module":"checkout-service","message":"Order order-123 berhasil dibuat"}
```

- Field tetap: `timestamp` (ISO 8601 UTC), `level`
  (`trace|debug|info|warn|error|fatal`), `app`, `requestId`, `module`,
  `message`. Field opsional: `error`; khusus eksekusi non-HTTP: `executionId`.
- `requestId` adalah UUID canonical dibuat server pada HTTP entry; `null` di luar
  HTTP scope (bukan UUID palsu per log). Incoming `x-request-id` tidak dipakai
  sebagai identitas canonical.
- Tidak ada binding bisnis bebas (`orderId`, `userId`, `total`, payload). Field
  teknis ini bukan tempat data bisnis.

### 7.3 Data bisnis masuk `message`

Tulis fakta bisnis ke message dengan frasa stabil dan identifier yang jelas,
supaya tetap bisa dicari lintas request/job:

```ts
log.info(`Order ${orderId} berhasil dibuat`);
log.warn(`Order ${orderId}: stok provider berubah, minta ulang review`);
log.error(`Order ${orderId}: inisialisasi pembayaran gagal`, error);
```

Jangan menyerialkan request body, baris DB, atau payload provider ke message.

### 7.4 Error allowlisted

Field `error` hanya berisi proyeksi teknis: `name`, safe `message`, safe `code`
bila relevan, stack tersanitasi, dan cause terbatas. Normalisasi error
provider/auth ke proyeksi aman **sebelum** logging; redaction berbasis key tidak
menolong secret yang sudah masuk ke string. Sanitizer harus tahan terhadap thrown
string/object, cause melingkar/bersarang, dan error oversized, dengan batas
ukuran/depth deterministik dan penanda truncation. Kegagalan serialisasi log tidak
boleh menggagalkan alur bisnis.

### 7.5 Context entry

- `withRequestContext(handler)` di HTTP entry (termasuk early return, webhook,
  cron HTTP, internal endpoint).
- `withExecutionContext(work)` pada job/worker/CLI entry.
- Helper/repository/provider bersarang **tidak** membuka scope baru. Context
  hilang di dalam satu alur HTTP adalah bug/diagnostic, bukan alasan membuat ID
  baru.
- Jangan mengklaim satu scope untuk seluruh render tree RSC; Server Action yang
  dimiliki app membuka scope sendiri, render di luar scope memakai `requestId`
  `null`.

### 7.6 Volume dan level

Event bisnis penting di `info`, diagnosis rinci di `debug`/`trace`. Validasi atau
deny yang expected tidak otomatis `error`. Hindari duplikasi stack yang sama di
setiap layer dan hindari entry/exit log setiap fungsi.

## 8. Jangan perluas scope

Aturan di sini diterapkan pada kode **baru** dan bagian yang memang disentuh.
Perubahan kecil tidak membenarkan refactor unrelated (memindahkan folder,
mengganti endpoint dengan Server Action, membersihkan logger/console di luar call
chain yang diubah). Pengecualian harus dijelaskan di handoff dan tidak boleh
membatalkan correctness, security, atau kontrak HTTP/auth/stream yang ada.

## 9. Checklist sebelum menyerahkan perubahan

- [ ] Handler hanya parse/auth/validasi/map/log; tidak ada query Drizzle di `route.ts`.
- [ ] Service dinamai per operasi bisnis; tidak ada God Service/`helpers` dumping ground.
- [ ] Service bebas SQL dan bebas `NextRequest`/`NextResponse`.
- [ ] Persistence dan scope ada di repository/query module; provider call di luar transaksi.
- [ ] Tidak ada parameter `logger`/`requestId`/request object yang diteruskan untuk logging; dependency bisnis/DB/provider bertipe tetap sah; logger dibuat di module scope.
- [ ] Data bisnis ada di `message`; field log hanya whitelist; error tersanitasi.
- [ ] Input/output bertipe, DTO minimal, tanpa `any`/baris DB utuh.
- [ ] Test ada di public seam dan mengunci invariant existing; tidak ada assertion ke detail internal.
- [ ] Tidak ada refactor unrelated yang ikut terbawa.
- [ ] Klaim status sesuai evidence aktual — nyatakan migrasi selesai atau gate lulus hanya sebatas run yang benar-benar dijalankan; sisa pengecualian yang belum termigrasikan wajib disebut eksplisit.
