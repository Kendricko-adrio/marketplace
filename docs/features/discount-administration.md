# Administrasi Offer diskon (publik, fixed-goods) — ticket 06

Halaman admin `/admin/discounts` dan API `/api/admin/discounts/**` mengelola
Offer diskon publik bertipe **fixed-goods**: draft, review, publish, pause,
kapasitas, simulasi, usage, dan histori. Slice ini **tidak** mengaktifkan
redemption customer; pemakaian nyata (reserve/consume) dimiliki ticket 07/12.

## 1. Scope dan non-goals

Didukung:

- Offer publik tanpa kode kupon.
- Tepat satu benefit `fixed_goods` per revision, nominal positif Rupiah utuh.
- Draft yang boleh tidak lengkap, tetapi tidak bisa dipublish sampai lengkap.
- Kapasitas global: `quota_count`, `budget_amount`, `per_client_limit`.
- Review diff + fingerprint, publish atomik, pause/enable/archive.
- Simulasi pricing admin memakai interface pricing bersama.
- Usage projection global dan histori audit immutable.

Belum didukung (tidak diberi UI/publish path palsu):

- Redemption/reservasi customer, usage per client, dan race-nya (ticket 07/12).
- Benefit percentage dan subsidi ongkir (ticket 10/11).
- Kode manual/kupon (ticket 07/09).
- Targeting, reward engine generik, refund, dan restore Offer arsip.

## 2. Gate kontrak domain

`discounts.contractVersion` dibaca **tanpa cache** pada setiap writer. Nilai
`0` atau baris yang absen berarti legacy/nonaktif (`503 DISCOUNTS_INACTIVE`);
nilai tak dikenal gagal tertutup (`503 DISCOUNTS_CONTRACT_UNSUPPORTED`). Seeder
menulis baris eksplisit `0`, sehingga semua environment operasional tetap
nonaktif sampai operator menaikkannya ke `1`.

## 3. Otorisasi

Dua **Global Modules** terpisah, hanya `view`/`edit`, tanpa `delete` dan tanpa
branch scope (SQL CHECK menolak baris lain):

| Modul | Dipakai untuk |
|---|---|
| `discounts` | list/detail, draft, review, publish, pause/archive, simulasi, usage, history |
| `discount_capacity` | initial assignment, kenaikan, atau penghapusan batas yang memperbesar kapasitas |

Konsekuensi yang disengaja: promo editor tanpa grant kapasitas **boleh**
menyimpan draft, tetapi tidak bisa menaikkan kuota/budget/jatah per akun.
Publish tidak menerima kapasitas sebagai input, sehingga tidak ada jalur bypass
"publish sambil menaikkan kapasitas".

Fresh seed HQ mendapat empat grant (keduanya `view`+`edit`); Admin tidak
mendapat grant baru dan Role custom existing tidak di-upgrade otomatis. Semua
keputusan izin server-side; policy dari browser tidak pernah dipercaya.

### Enforcement race (spec §7.3)

Setiap transaksi writer mengambil `SHARE` lock pada Admin User lalu Role,
membaca ulang grant di dalam transaksi, baru mengambil lock domain. Revoke Role
yang berkompetisi karena itu serial terhadap write ini: menang → request
ditolak; kalah → menunggu commit. `apps/admin/src/lib/discounts-administration.ts`
memakai satu authorizer yang sama di luar dan di dalam transaksi.

## 4. Record yang ditulis

| Tabel | Isi |
|---|---|
| `discount_offer` | identitas (`key` opaque, tanpa kode), `activation_kind='public'`, state `draft/enabled/paused/archived`, pointer `current_revision_id`, `version`, `draft_version`, `policy_version`, kapasitas, aktor |
| `discount_offer_revision` | satu revision per publish; draft boleh `name/currency/min_subtotal` NULL; `published_at` menandai revision live; satu draft unpublished per Offer (partial unique index) |
| `discount_benefit` | tepat satu per revision (`unique(revision_id)`), `kind='fixed_goods'`, `scope='goods'`, `fixed_amount > 0` Rupiah utuh, `params_version=1` |
| `discount_offer_usage` | proyeksi global reserved/consumed (count+amount), dibuat bersama Offer dengan nilai 0 |
| `discount_admin_request` | receipt immutable per `(actor_identity, request_key)` + fingerprint + result JSON bounded (create/publish/state/policy) |
| `audit_log` | event `DISCOUNT_OFFER_*` dengan policy version dan diff before/after |

FK retention memakai `RESTRICT`; pointer Offer→revision bersifat dua arah dan
tidak bisa dihapus selama Offer live. Uang disimpan `numeric(15,2)` dengan CHECK
Rupiah utuh dan batas `0..9999999999999` (nominal benefit `> 0`).

## 5. Lifecycle

### 5.1 Create draft

`POST /api/admin/discounts` membuat Offer + satu revision draft kosong + usage 0
+ receipt + audit dalam satu commit. Response `201`, replay key yang sama
`200`. Draft sengaja tidak lengkap: **tidak ada default kuota 100**.

### 5.2 Save draft

`PUT /api/admin/discounts/{id}/draft` menyimpan terms lengkap dan benefit.
Draft selalu baris `published_at IS NULL`; revision live tidak pernah disentuh.
Setelah publish, penyimpanan berikutnya membuat revision draft baru
(`revision_no + 1`). Validasi input:

- `name` 1–120 karakter, `currency` hanya `IDR`.
- `min_subtotal` Rupiah utuh ≥ 0.
- `start_at`/`end_at` opsional, wajib ISO-8601 **dengan offset eksplisit**
  (UI mengirim WIB `+07:00`), dan `start < end` (start inklusif, end eksklusif).
- `benefit.kind` hanya `fixed_goods`, `params_version` hanya `1`, nominal > 0.
- Kind/versi/currency tak dikenal → `400 INPUT_INVALID`, bukan default diam-diam.

### 5.3 Review

`POST /api/admin/discounts/{id}/review` hanya membaca. Response berisi:

- Diff terms live vs draft dan benefit live vs draft.
- `validations`: `TERMS_COMPLETE`, `BENEFIT_VALID`, `CAPACITY_BOUND`,
  `WINDOW_ORDERED`, `CODE_FREE`, `LIVE_TERMS_IMMUTABLE`.
- `canPublish`.
- `fingerprint` SHA-256 atas offer/draft/policy version, pointer live, revision
  draft, terms, benefit, kapasitas, dan state hasil publish.
- Label eksplisit: bukan quote, bukan order, tidak menahan kapasitas.

### 5.4 Publish

`POST /api/admin/discounts/{id}/publish` menerima `requestKey`, ketiga expected
versions, dan `reviewFingerprint`. Di dalam transaksi:

1. Receipt dicek lebih dulu: key sama + fingerprint sama → replay; fingerprint
   beda → `409 REQUEST_KEY_CONFLICT`.
2. Offer di-lock; versions dan fingerprint **dihitung ulang dari baris terkunci**
   dan dibandingkan. Berubah setelah review → `409 STALE_REVISION`.
3. Validasi publikasi dijalankan; gagal → `409 OFFER_NOT_PUBLISHABLE`.
4. `published_at` diisi, pointer dipindah, state `draft → enabled` (state live
   lain dipertahankan), `version + 1`.
5. Receipt + audit ditulis di commit yang sama.

Publish tidak memanggil provider dan tidak membuat kode.

### 5.5 Pause / enable / archive

`PATCH /api/admin/discounts/{id}/state` dengan `requestKey` + `expectedVersion`.
`draft → archived` diizinkan (membuang draft); `draft → enabled/paused` ditolak
`409 INVALID_STATE_TRANSITION` karena publish adalah satu-satunya jalur live.
Archive bersifat terminal dan bukan hard delete. Pause/archive **tidak**
mengubah usage, pointer, atau revision terbit. Receipt replay mengembalikan
hasil yang sama.

### 5.6 Kapasitas (`policy`)

`PATCH /api/admin/discounts/{id}/policy` dengan `requestKey`,
`expectedOfferVersion`, `expectedPolicyVersion`, `quotaCount`, `budgetAmount`,
dan `perClientLimit`.

- Arah perubahan diklasifikasi: initial/kenaikan/penghapusan batas = memperbesar
  → butuh grant `discount_capacity`; penurunan hanya butuh `discounts:edit`.
- Offer live wajib menyisakan minimal satu dari kuota/budget
  (`409 CAPACITY_REQUIREMENT`).
- Kuota tidak boleh < reserved + consumed; budget tidak boleh <
  reserved amount + consumed amount (`409 CAPACITY_BELOW_COMMITMENTS`).
- `policy_version` dan `version` naik; receipt replay didukung.

### 5.7 Simulasi

`POST /api/admin/discounts/{id}/simulate` memakai `buildPricingSnapshot` +
`evaluatePricing` dari `packages/db`. Input: 1–50 baris (variant, harga, qty
1–99), fulfillment pickup/delivery, dan ongkir. PPN dibaca dari
`tax.ppnRatePercent` (fallback 11). Subtotal dihitung setelah Markdown; jika
subtotal < `min_subtotal`, `applied: false` dan breakdown baseline dikembalikan.
Response selalu membawa `simulation: true`, `notice`, dan tidak menulis apa pun.

Literal acuan: subtotal 150000, fixed 17000, PPN 11%, pickup → net 133000, PPN
14630, total 147630.

### 5.8 Usage dan history

- `GET /api/admin/discounts/{id}/usage` — agregat global + sisa kapasitas.
  Belum ada rincian per customer karena redemption nonaktif.
- `GET /api/admin/discounts/{id}/history` — audit Offer terbaru (maks 100),
  termasuk policy version saat aksi.

## 6. HTTP contract

Semua endpoint di bawah memakai admin session. Envelope sukses
`{ success: true, data }` (list menambahkan `pagination` di top level); envelope
error `{ success: false, error, code, requestId }` + header `x-request-id`.
Response `Cache-Control: no-store`.

| Method/path | Grant | Catatan |
|---|---|---|
| `GET /api/admin/discounts` | `discounts:view` | `page`, `limit` (≤50), `state` |
| `POST /api/admin/discounts` | `discounts:edit` | `{ requestKey, activationKind:'public' }` |
| `GET /api/admin/discounts/{id}` | `discounts:view` | detail live+draft+benefit+usage |
| `PUT /api/admin/discounts/{id}/draft` | `discounts:edit` | expected Offer+draft versions |
| `POST /api/admin/discounts/{id}/review` | `discounts:edit` | read-only diff + fingerprint |
| `POST /api/admin/discounts/{id}/publish` | `discounts:edit` | request key + versions + fingerprint |
| `POST /api/admin/discounts/{id}/simulate` | `discounts:edit` | expected draft version |
| `PATCH /api/admin/discounts/{id}/state` | `discounts:edit` | request key + expected version |
| `PATCH /api/admin/discounts/{id}/policy` | `discounts:edit` (+`discount_capacity` bila memperbesar) | request key + dua versi |
| `GET /api/admin/discounts/{id}/usage` | `discounts:view` | agregat |
| `GET /api/admin/discounts/{id}/history` | `discounts:view` | audit |

Kode error stabil: `INPUT_INVALID` (400), `DENIED` (403), `NOT_FOUND` (404),
`STALE_REVISION` / `REQUEST_KEY_CONFLICT` / `OFFER_NOT_PUBLISHABLE` /
`INVALID_STATE_TRANSITION` / `CAPACITY_REQUIREMENT` /
`CAPACITY_BELOW_COMMITMENTS` (409), `BUSY` / `DISCOUNTS_INACTIVE` /
`DISCOUNTS_CONTRACT_UNSUPPORTED` (503).

## 7. UI admin

- `/admin/discounts` — daftar Offer: terms live, status, benefit, kapasitas,
  penanda draft, filter status, pagination, tombol "Buat draft".
- `/admin/discounts/{id}` — editor: terms draft, kapasitas, simulasi pricing,
  review (validasi + diff + fingerprint), publish, pause/enable/archive,
  ringkasan usage, dan histori.
- Navigasi sidebar "Diskon" hanya muncul dengan `discounts:view`; tombol tulis
  mengikuti policy mirror, tetapi server tetap otoritatif.
- Aksi destruktif (pause/archive) memakai dialog konfirmasi, bukan `confirm()`.

## 8. Seed fixture (mode demo)

`packages/db/src/seed.ts` menambahkan satu draft publik yang jelas belum
lengkap: nama realistis, `min_subtotal = 0`, tanpa benefit, tanpa kuota/budget,
pointer NULL, usage 0, dan gate tetap `0`. Tidak ada pemakaian customer fiktif,
kode kupon, atau auto-launch. Cleanup seed menghapus receipt → usage → benefit →
revision → Offer sebelum user/role, dengan pointer dikosongkan lebih dulu.

## 9. Berkas terkait

- `packages/db/src/schema/discounts.ts`, `packages/db/src/schema/index.ts`
- `packages/db/drizzle/0038_empty_george_stacy.sql` (tabel benefit)
- `packages/db/src/seed-cleanup.ts`, `packages/db/src/seed.ts`
- `apps/admin/src/lib/discounts-administration.ts` (domain + invariant)
- `apps/admin/src/lib/discounts-http.ts` (envelope bersama)
- `apps/admin/src/app/api/admin/discounts/**`
- `apps/admin/src/app/admin/discounts/**`
- `apps/admin/src/components/AdminSidebar.tsx`
- `apps/admin/src/lib/rbac/catalog.ts`, `seed-defaults.ts`, `grant-matrix.ts`
- `e2e/admin/discounts-admin-mock.spec.ts`
- `docs/api-reference.md`

## 10. Verifikasi

Dijalankan pada DB disposable `marketplace_discounts_test_*` dengan
`DATABASE_URL` eksplisit:

```bash
npm run verify:types:admin
npx vitest run apps/admin/src/lib/discounts-administration.test.ts
DATABASE_URL=<disposable> npx vitest run \
  apps/admin/src/lib/discounts-administration.db.test.ts \
  packages/db/src/discount-schema.db.test.ts
DATABASE_URL=<disposable> npm run verify:batch:e2e -- \
  e2e/admin/discounts-admin-mock.spec.ts
```

Cakupan yang sudah terbukti:

- Unit: parsing uang/instant, kind/versi benefit, fingerprint sensitivity,
  klasifikasi kapasitas, validasi publikasi.
- Real PG: create → draft → review (tanpa kapasitas) ditolak publish → policy →
  review → simulasi literal 133000/14630/147630 → publish → replay receipt →
  pause tanpa reset usage → revision kedua dengan benefit sendiri; stale save
  dan stale publish 409; grant kapasitas untuk initial assignment; penurunan di
  bawah komitmen ditolak.
- SQL: satu benefit per revision, kind/scope/params/nominal, published
  completeness, pointer ownership, draft reset.
- E2E mock: create/replay/detail, denial `INPUT_INVALID`, dan alur UI lengkap
  (buat draft → simpan terms → kapasitas → simulasi → review → publish → pause).

**Tidak diklaim:** redemption/reservasi customer, race kapasitas nyata
(T03), UAT staging, deployment, dan aktivasi gate operasional. Itu gate ticket
07/12/13 dan release, bukan bukti slice ini.
