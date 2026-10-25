# Administrasi Offer diskon (publik, goods) — ticket 06/10

Halaman admin `/admin/discounts` dan API `/api/admin/discounts/**` mengelola
Offer diskon publik dengan satu benefit **goods** — nominal tetap atau
persentase dengan cap opsional: draft, review, publish, pause,
kapasitas, simulasi, usage, dan histori. Slice ini **tidak** mengaktifkan
redemption customer; pemakaian nyata (reserve/consume) dimiliki ticket 07/12.

## 1. Scope dan non-goals

Didukung:

- Offer publik tanpa kode kupon.
- Tepat satu benefit goods version1 per revision: `fixed_goods` (nominal positif
  Rupiah utuh) atau `percentage_goods` (rate `>0..100` maksimal6 digit pecahan,
  cap Rupiah positif opsional).
- Draft yang boleh tidak lengkap, tetapi tidak bisa dipublish sampai lengkap.
- Kapasitas global: `quota_count`, `budget_amount`, `per_client_limit`.
- Review diff + fingerprint, publish atomik, pause/enable/archive.
- Simulasi pricing admin memakai interface pricing bersama.
- Usage projection global dan histori audit immutable.

Belum didukung (tidak diberi UI/publish path palsu):

- Redemption/reservasi customer, usage per client, dan race-nya (ticket 07/12).
- Subsidi ongkir (ticket 11) dan redemption/reservasi customer (ticket 07/12).
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
| `discount_benefit` | tepat satu per revision (`unique(revision_id)`), `scope='goods'`, `params_version=1`; bentuk tepat satu kind: `fixed_goods` → `fixed_amount > 0` Rupiah utuh, `rate/cap_amount` NULL; `percentage_goods` → `fixed_amount` NULL, `rate numeric(9,6)` `>0..100`, `cap_amount` NULL atau `>0` Rupiah utuh |
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
- `benefit.kind` hanya `fixed_goods` atau `percentage_goods`, `params_version`
  hanya `1`.
- `fixed_goods`: `fixedAmount` Rupiah utuh > 0; `rate`/`capAmount` tidak boleh ikut.
- `percentage_goods`: `rate` decimal `>0..100` dengan maksimal6 digit pecahan
  (lebih presisi ditolak, bukan dibulatkan); `capAmount` boleh dikosongkan/NULL
  (tanpa cap) atau Rupiah utuh positif; `fixedAmount` tidak boleh ikut.
- Kind/versi/currency/field campuran tak dikenal → `400 INPUT_INVALID`, bukan
  default diam-diam ke fixed goods.

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
  → butuh grant `discount_capacity` **dan** `discounts:edit`; penurunan hanya
  butuh `discounts:edit`.
- Offer live wajib menyisakan minimal satu dari kuota/budget
  (`409 CAPACITY_REQUIREMENT`).
- Kuota tidak boleh < reserved + consumed; budget tidak boleh <
  reserved amount + consumed amount (`409 CAPACITY_BELOW_COMMITMENTS`).
- Penurunan `perClientLimit` juga wajib muat terhadap komitmen per akun
  tertinggi. Lookup memakai primary key terindex `(offer_id, client_id)` di
  bawah lock Offer yang sama; tidak ada lock seluruh account/histori dan tidak
  ada default subkuota per kode.
- Projection yang menyimpang dari ledger Redemption ditahan
  (`409 USAGE_DRIFT_REVIEW`): tidak ada reset/rebuild counter online. Pause
  tetap boleh sebagai tindakan aman.
- `policy_version` dan `version` naik; receipt replay didukung.

### 5.7 Simulasi

`POST /api/admin/discounts/{id}/simulate` memakai `buildPricingSnapshot` +
`evaluatePricing` dari `packages/db`. Input: 1–50 baris (variant, harga, qty
1–99), fulfillment pickup/delivery, dan ongkir. PPN dibaca dari
`tax.ppnRatePercent` (fallback 11). Subtotal dihitung setelah Markdown; jika
subtotal < `min_subtotal`, `applied: false` dan breakdown baseline dikembalikan.
Response selalu membawa `simulation: true`, `notice`, dan tidak menulis apa pun.

Literal acuan fixed: subtotal 150000, fixed 17000, PPN 11%, pickup → net 133000,
PPN 14630, total 147630. Literal acuan percentage (spec §4.4): subtotal 450000,
rate 10%, cap 20000 → benefit 20000, net 430000, PPN 47300, total 477300; tanpa
cap → benefit 45000, net 405000, PPN 44550, total 449550; subtotal 100005 rate
10% → benefit floor 10000. Rate yang menghasilkan benefit 0 (mis. subtotal 50
rate 1%) tidak diterapkan.

### 5.8 Usage dan history

- `GET /api/admin/discounts/{id}/usage` — dua lapisan yang tidak boleh
  dicampur:
  - **Global (otoritas kapasitas):** `consumed`, `held` (reserved), dan
    `available` untuk kuota/budget, dengan `basis:"global"`. Contoh kontrak:
    quota100/consumed90/held10 → available0; budget100000/consumed80000/held20000
    → available0.
  - **Scoped (operasional):** daftar Redemption dengan pagination/filter,
    hanya bila aktor punya `orders:view`. Scope own-branch dipin ke Home
    Branch server-side; direct `entryId`, `branchId` asing, page, dan count
    tidak dapat memperlebar predicate. Tanpa `orders:view` response hanya
    agregat (tanpa identitas order/customer/cabang).
  - `drift` melaporkan selisih projection vs ledger Redemption terarah
    (indexed per Offer) untuk review; bukan analytics eventual dan bukan sumber
    kapasitas baru.
- `GET /api/admin/discounts/{id}/history` — audit Offer terbaru (maks 100),
  dengan `action`, policy version, referensi revision/draft/code (masked), dan
  `actor { id, identity, label, available }`. Bila FK Admin User menjadi NULL,
  `identity` immutable dari payload audit tetap dilaporkan; `label` null dan
  `available:false`. Literal kode tidak pernah masuk histori, dan grant
  `audit_log:view` saja bukan jalur literal.
- Entri usage membawa status order/payment, cabang, customer, penanda
  `fulfillmentBlocked`, dan `review.latePaidReview` sehingga kasus
  paid-but-provider-blocked / ambiguous hold / late-paid dapat ditelusuri lewat
  detail order existing. Tidak ada tombol reset usage, force release, retry
  provider write, atau refund baru.

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
| `GET /api/admin/discounts/{id}/usage` | `discounts:view` (+`orders:view` untuk entries) | agregat global + entries ter-scope |
| `GET /api/admin/discounts/{id}/history` | `discounts:view` | audit + atribusi aman |

Kode error stabil: `INPUT_INVALID` (400), `DENIED` (403), `NOT_FOUND` (404),
`STALE_REVISION` / `REQUEST_KEY_CONFLICT` / `OFFER_NOT_PUBLISHABLE` /
`INVALID_STATE_TRANSITION` / `CAPACITY_REQUIREMENT` /
`CAPACITY_BELOW_COMMITMENTS` / `USAGE_DRIFT_REVIEW` (409), `BUSY` / `DISCOUNTS_INACTIVE` /
`DISCOUNTS_CONTRACT_UNSUPPORTED` (503).

## 7. UI admin

- `/admin/discounts` — tab **Kupon publik / Kode promo** (default publik), dengan
  jumlah hasil sesuai filter status sebelum pagination. Pergantian tab/status
  kembali ke halaman 1. **Buat draft** mengikuti jalur tab aktif.
- Tabel menampilkan identitas/terms live, jalur, benefit nominal/persentase/subsidi
  ongkir, status, revision live, penanda draft, **kuota dan budget tersedia**
  bersamaan, serta masked codes dan statusnya. Revision memakai `revisionNo`,
  bukan identity/draft/policy version. Literal kode tidak dikirim pada list,
  termasuk untuk editor.
- Kapasitas list memakai projection global: batas − consumed − hold; contoh
  kuota100/90/10 → tersedia0, budget2000000/1800000/200000 → Rp0. `null` pada
  dimensi berarti tidak dibatasi; draft tanpa dua batas diberi label belum
  disetel/belum dapat publish. Projection hilang atau melebihi batas ditandai
  tidak tersedia/perlu review, bukan diisi nol palsu. List bukan booking kuota
  dan tidak melakukan rekonsiliasi/reset counter.
- `/admin/discounts/{id}` — header live revision/draft dan empat tab:
  **Aturan** (terms draft + simulasi biaya collapsible), **Kode** (manual;
  publik hanya penjelasan tanpa form), **Pemakaian & budget** (kapasitas global,
  drift, entries ter-scope/filter/pagination/order link), **Riwayat** (aktor,
  waktu, revision/policy dan perubahan tersimpan). Input bertahan lintas tab;
  mengganti filter usage tidak me-reset terms.
- **Simpan kapasitas** langsung mengubah policy live melalui writer existing,
  bukan menunggu publish terms. Increase/reduction dan current grants tetap
  diperiksa server.
- **Review perubahan** membuka dialog berisi diff server, benefit, syarat,
  waktu WIB, konteks kapasitas/hold dan validasi sebelum **Publish promo**.
  Terms lokal yang berubah harus disimpan terlebih dahulu. Cancel tidak
  publish dan mengembalikan fokus; pending publish tidak bisa ditutup/dikirim
  dua kali. Stale409 menginvalidasi review dan meminta **Muat versi terbaru**;
  tidak ada force-overwrite. Snapshot/hold order lama tidak diubah.
- Theme/komponen admin existing dipakai langsung. Desktop1440/mobile390
  mempertahankan scroll pada kontainer tabel/tab dan dialog yang dapat
  dijangkau, tanpa overflow dokumen.
- Navigasi sidebar "Diskon" hanya muncul dengan `discounts:view`; tombol tulis
  mengikuti policy mirror, tetapi server tetap otoritatif.
- Aksi destruktif (pause/archive) memakai dialog konfirmasi, bukan `confirm()`.

### 7.1 Penyempurnaan UX: copy, grouping, dan navigasi

Pemilik menyetujui scope **Diskon + shared tabs**: daftar dan editor Diskon,
perbaikan komponen tabs bersama, serta regression check pada detail Produk.
Tidak mengubah API, permission, formula, lifecycle, shell admin, atau gate rilis.

- Pengantar daftar dipersingkat. Penjelasan jalur, aturan penggabungan promo,
  draft/publish, dan istilah kapasitas berada pada disclosure **Tentang promo**.
  Keterangan bahwa kapasitas bersifat global dan bukan reservasi tetap terlihat.
- Data tabel tetap lengkap: terms live, revision, kuota, budget, dan masked codes
  tidak dihilangkan. Nilai tersedia lebih menonjol daripada rincian batas/terpakai/
  ditahan. Kolom **Aksi / Kelola** tetap terlihat di kanan ketika tabel digeser.
- Form Aturan dikelompokkan dengan fieldset **Identitas promo**, **Potongan**,
  dan **Jadwal**. Label batas potongan memakai “Maksimum”; jadwal memakai WIB
  dengan keterangan bahwa waktu mulai termasuk dan promo berhenti tepat pada
  waktu berakhir. Nilai dan makna aturan tidak berubah.
- **Simpan draft** dan **Review perubahan** berdekatan, disertai penanda perubahan
  belum disimpan dan keterangan bahwa menyimpan draft tidak mengaktifkan promo.
  Review tetap dinonaktifkan bila belum memenuhi guard existing. Simulasi tetap
  berada pada bagian terpisah yang bisa dibuka/tutup.
- Draft baru tidak menampilkan badge draft kedua yang mengulang status. Promo
  yang sudah live dan memiliki draft tetap ditandai **Ada perubahan draft**.
- Peringatan bahwa **Simpan kapasitas langsung berlaku pada promo live** tetap
  terlihat dekat tindakan, tidak disembunyikan di bantuan tambahan. Ketentuan
  email terverifikasi, uang Rupiah utuh, dan privacy kode tetap dipertahankan.
- Shared `TabsList` memiliki surface `bg-card`, border, dan padding; tab aktif
  memakai `bg-primary`/`text-primary-foreground`, selaras dengan tombol/navigasi
  admin existing. Hover, focus ring, keyboard navigation, dan semantik Radix
  dipertahankan. Detail Produk memakai pattern yang sama tanpa redesign halaman.

**Checkpoint dokumentasi:** Context7 `/microsoft/playwright` mengonfirmasi
`getByRole`, `toHaveCSS`, keyboard `press`, `setViewportSize`, `testInfo.outputPath`,
dan `toBeInViewport({ ratio })`. Perubahan aplikasi hanya menyentuh JSX/copy/layout
serta class CSS pada komponen existing; tidak menambah API framework atau Radix.
Panduan installed Next.js `use-client.md` juga dibaca sebelum implementasi.

**Bukti verifikasi lokal:**

- Red → green: dua test UX gagal pada implementasi awal (batas tabs belum ada dan
  grouping form belum ada), kemudian **2 passed**. Pemeriksaan lanjutan menemukan
  tombol Kelola di luar viewport; assertion viewport gagal sebelum kolom aksi
  dipertahankan di kanan, lalu **1 passed** setelah perbaikan.
- Mock E2E pada `discounts-prototype-mock.spec.ts`,
  `discounts-admin-mock.spec.ts`, dan `discounts-usage-mock.spec.ts`:
  **19 kasus unik memiliki hasil PASS** melalui focused run dan batch regression.
  Batch 17 kasus menghasilkan 16 pass dan satu assertion lama “Jeda offer?” yang
  tidak sesuai dialog existing “Jeda promo?”. Setelah locator diselaraskan dengan
  accessible dialog, focused safe-pause **1 passed**; assertion bahwa hold dan
  availability tidak berubah tetap dipertahankan. Test render/action terbaru
  kemudian direcheck dan lulus. Angka ini bukan klaim satu full run 19 sekaligus.
- `verify:batch:unit`: **150 files passed; 1722 tests passed, 12 skipped**.
  Tidak ada unit seam/logic domain baru; unit regression domain tercakup batch ini.
- `verify:types:admin`, `verify:types:store`, dan ESLint scoped pada tiga file
  halaman Diskon: **PASS**. Log disimpan di luar repo dengan prefix
  `/tmp/discounts-ux-`.
- Agent utama memeriksa hasil render Chromium pada desktop1440 dan mobile390,
  termasuk screenshot dari test yang lulus. Tabs detail Produk dibandingkan
  dengan Diskon; keyboard, selected state, serta akses ke Stok/Varian lulus.
  Daftar/editor Diskon tidak menambah overflow dokumen; tabel/tab tetap memiliki
  region scroll. Shell/sidebar mobile existing tidak direstruktur.

Tidak menjalankan legacy/live-provider E2E, usability test dengan operator nyata,
commit, atau deployment. Verifikasi ini tidak menyelesaikan UAT/sign-off dan
release gates pada plan diskon existing.

## 8. Seed fixture (mode demo)

`packages/db/src/seed.ts` menambahkan satu draft publik yang jelas belum
lengkap: nama realistis, `min_subtotal = 0`, tanpa benefit, tanpa kuota/budget,
pointer NULL, usage 0, dan gate tetap `0`. Tidak ada pemakaian customer fiktif,
kode kupon, atau auto-launch. Cleanup seed menghapus receipt → usage → benefit →
revision → Offer sebelum user/role, dengan pointer dikosongkan lebih dulu.

## 9. Berkas terkait

- `packages/db/src/schema/discounts.ts`, `packages/db/src/schema/index.ts`
- `packages/db/drizzle/0038_empty_george_stacy.sql` (tabel benefit)
- `packages/db/drizzle/0050_polite_lady_ursula.sql` (kolom `rate`/`cap_amount`,
  shape check percentage goods)
- `packages/db/src/seed-cleanup.ts`, `packages/db/src/seed.ts`
- `apps/admin/src/lib/discounts-administration.ts` (domain + invariant)
- `apps/admin/src/lib/discount-operations-read.ts` (usage/entry/history ops reads)
- `apps/admin/src/lib/discount-usage-drift.ts` (targeted projection reconciliation)
- `apps/admin/src/lib/discounts-http.ts` (envelope bersama)
- `apps/admin/src/app/api/admin/discounts/**`
- `apps/admin/src/app/admin/discounts/**`
- `apps/admin/src/components/AdminSidebar.tsx`
- `apps/admin/src/lib/rbac/catalog.ts`, `seed-defaults.ts`, `grant-matrix.ts`
- `e2e/admin/discounts-admin-mock.spec.ts`
- `e2e/admin/discounts-usage-mock.spec.ts` (ticket 12 persona/privacy/pause)
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

Cakupan ticket 12 yang sudah terbukti (lihat
[docs/testing](../testing/README.md#usage-privacy-dan-kapasitas-ticket-12-disposable)):

```bash
npm run verify:types:admin
npx vitest run apps/admin/src/lib/discount-operations-read.test.ts
DATABASE_URL=<db-disposable> npx vitest run   apps/admin/src/lib/discount-operations-read.db.test.ts
DATABASE_URL=<db-disposable> npm run verify:batch:e2e --   e2e/admin/discounts-usage-mock.spec.ts
```

Seam T membuktikan agregat global vs scoped entries, aggregate-only tanpa
`orders:view`, 404/403 untuk direct id/filter cabang asing, masking kode,
atribusi aktor setelah FK NULL, penurunan per-account limit terhadap komitmen
nyata, serialisasi policy vs commit reservasi, drift fail-closed + pause aman,
usage tidak reset oleh rename/email/code, dan constraint retensi. Seam B
membuktikan persona HQ/viewer melalui browser. Retensi ini bukan klaim
kepatuhan/erasure workflow baru.

Cakupan yang sudah terbukti:

- Unit: parsing uang/instant, kind/versi/precision/campuran-field benefit,
  fingerprint sensitivity (termasuk rate/cap), klasifikasi kapasitas, validasi
  publikasi.
- Real PG: create → draft → review (tanpa kapasitas) ditolak publish → policy →
  review → simulasi literal 133000/14630/147630 → publish → replay receipt →
  pause tanpa reset usage → revision kedua dengan benefit sendiri; stale save
  dan stale publish 409; grant kapasitas untuk initial assignment; penurunan di
  bawah komitmen ditolak. Percentage: draft rate 10.000000 cap 20000 tersimpan
  sebagai rate `10`/cap `20000`, rate 7 digit ditolak `INPUT_INVALID`, review
  `BENEFIT_VALID`, simulasi 450000 → 20000/430000/47300/477300, lalu publish
  menerbitkan revision live berbentuk sama.
- SQL: satu benefit per revision, kind/scope/params/shape (fixed vs percentage,
  rate/cap), published completeness, pointer ownership, draft reset.
- E2E mock: create/replay/detail, denial `INPUT_INVALID`, alur UI fixed
  (buat draft → simpan terms → kapasitas → simulasi → review → publish → pause),
  dan alur UI percentage (pilih jenis benefit → rate 10 → cap 20000 → simpan →
  simulasi 149850 → review valid).

**Tidak diklaim:** redemption/reservasi customer, race kapasitas nyata
(T03), UAT staging, deployment, dan aktivasi gate operasional. Itu gate ticket
07/12/13 dan release, bukan bukti slice ini.

## Pemakaian, privacy, dan kapasitas (ticket 12)

- Capacity authority tetap **global**: satu `discount_offer_usage` per Offer
  (reserved/consumed count+amount). Daftar entry adalah view operasional
  ter-scope; totalnya tidak pernah diklaim sama dengan total global.
- Privacy: `discounts:view` saja → agregat. Entries butuh `orders:view`;
  own-branch dipin ke Home Branch. Direct id di luar scope → 404; `branchId`
  asing pada own-branch → 403. Export/API/list/history/audit tidak memiliki
  saluran literal kode untuk non-editor.
- Retensi: FK `orders`/`client`/`redemption`/`allocation`/`provider`/
  `shipment` memakai RESTRICT; Offer/kode diarsipkan, bukan hard delete, dan
  literal kode yang sudah terbit tidak dapat dipakai ulang. Percobaan hard delete
  transaksi ditolak database. Ini bukan klaim kepatuhan/erasure workflow baru.
- Drift projection ditahan untuk review (`USAGE_DRIFT_REVIEW`) pada publish dan
  perubahan kapasitas; pause/archive tetap aman. Tidak ada reset/rebuild online
  dan tidak ada analytics eventual sebagai authority baru.
- Pause hanya menghentikan reservasi baru. Hold lama tetap snapshot dan tetap
  bisa consume/release; tidak ada mass cancel/reprice/force release. Refund
  manual eksternal tidak sync/restore usage.
- Bukti: `apps/admin/src/lib/discount-operations-read.db.test.ts` (Seam T),
  `apps/store/src/lib/discount-reservation.db.test.ts` (pause + hold),
  `e2e/admin/discounts-usage-mock.spec.ts` (Seam B), unit
  `apps/admin/src/lib/discount-operations-read.test.ts`.

## Manual Promo Code (ticket 09)

Offer `manual_only` dibuat lewat `POST /api/admin/discounts` dengan
`activationKind: "manual_only"` dan `codes?: string[]`. Canonical code
direservasi DI DALAM transaksi create; mengetik draft di browser tidak menulis
apa pun. Kode tambahan memakai `POST /api/admin/discounts/{id}/codes` (request
key + `expectedOfferVersion`), dan state kode memakai
`PATCH /api/admin/discounts/{id}/codes/{codeId}` (`active|inactive|archived`,
dua version guard, arsip terminal). Publish menerima `proposedCodes` yang
terikat review fingerprint sehingga usulan yang berubah tidak pernah
direservasi diam-diam. Literal dan owner tidak pernah berubah setelah terbit;
tidak ada update canonical/`offer_id` dan tidak ada pemindahan kode ke Offer
lain.

Detail admin selalu memuat `codes` dengan `maskedCode`; field literal `code`
hanya dikirim bila aktor memegang `discounts:view` + `discounts:edit` global.
List hanya memuat label masked + jumlah kode. Audit mencatat `codeId` dan label
masked, bukan literal, sehingga grant audit saja tidak membuka kode. Seeder demo
menambahkan satu Offer manual dengan kode aktif/nonaktif dan satu Redemption
consumed yang menyebut `code_id`.

## Subsidi ongkir (ticket 11)

Benefit ketiga version1 adalah `shipping`: `scope='shipping'`, `cap_amount`
positif Rupiah utuh, dan `fixed_amount`/`rate` wajib NULL. Form admin hanya
menampilkan field cap; nominal tetap, rate, dan cap persentase tidak boleh ikut
terkirim. Draft/save/review/publish memakai fingerprint yang sama, sehingga cap
yang berubah setelah review tidak bisa lolos dengan fingerprint lama.

`POST /api/admin/discounts/{id}/simulate` menerima `fulfillmentMethod` dan
`shippingCost` sintetis. Untuk delivery dengan ongkir positif, breakdown
menampilkan ongkir asli, subsidi aktual `min(ongkir, cap)`, ongkir net, PPN
barang saja, total customer, dan payable provider. Pickup atau ongkir 0 tidak
menerapkan benefit dan menampilkan baseline (disabled dengan alasan), bukan
subsidi Rp0 palsu. Tidak ada field aktif untuk targeting kurir, merchant
funding provider baru, fee, atau rate/fixed goods pada kind shipping.

Literal verifikasi: barang 150000, ongkir 30000, cap 20000 → subsidi 20000,
ongkir net 10000, PPN 16500, total customer 176500, payable provider 160000;
ongkir 12000 cap 20000 → subsidi 12000, ongkir net 0, total 166500, payable
150000, sisa 8000 hangus. Migrasi `0051_numerous_sebastian_shaw.sql` hanya
memperluas constraint kind/scope/shape benefit yang sudah ada.
