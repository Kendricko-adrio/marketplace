# Handoff implementasi ticket 04 — bulk harga, hasil, dan resume akurat

Dokumen kerja untuk lane implementer (edit-only) dan main agent (review, integrasi,
seluruh validation). Bukan tracker status; status ada di
[`.scratch/discounts/ticket/04-bulk-price-apply-and-resume.md`](04-bulk-price-apply-and-resume.md).

- Ref awal: `d96bdf1`, branch `worktree/diskon` (dirty: seluruh hasil ticket 01–03 belum
  di-commit). Jangan commit, push, SSH/remote, provider request nyata, Docker remote,
  deployment, atau menjalankan command validation apa pun.
- Baca dulu: ticket 04, [`map.md`](map.md) §kontrak bersama, [`.scratch/discounts/plan/discounts-spec.md`](../plan/discounts-spec.md)
  §4.1–§4.2, §6.1–§6.4, §8.1–§8.4, §9.2, §12.1–§12.2.
- Basis kode ticket 03 (jangan didesain ulang): `apps/admin/src/lib/price-changes-administration.ts`,
  `apps/admin/src/lib/price-changes-http.ts`, `packages/db/src/schema/prices.ts`,
  `packages/db/src/markdown-pricing.ts`, `apps/admin/src/app/admin/products/harga/*`,
  `e2e/admin/price-change-mock.spec.ts`.
- Gate `discounts.contractVersion` tetap dibaca **uncached** dan wajib `1` untuk setiap
  mutasi. Environment operasional tetap `0`; hanya DB disposable untuk test.

## Batas lane

| Lane | cwd | File yang boleh diedit/dibuat | Tidak boleh |
| --- | --- | --- | --- |
| **A — core domain/HTTP** | `C:/Users/USER/.herdr/worktrees/marketplace/worktree-diskon` | lihat daftar ownership A | UI, seed, docs, `playwright.mock.config.ts`, migration SQL, e2e |
| **B — bulk UI + e2e** | `C:/Users/USER/.herdr/worktrees/marketplace/discounts-bulk-ui-04` | hanya dua file BARU: `apps/admin/src/app/admin/products/harga/price-change-bulk-client.tsx`, `e2e/admin/price-change-bulk-mock.spec.ts` | file lain (termasuk `page.tsx`, config, test lama) |
| main | root | integrasi, `drizzle-kit generate`, push disposable, index schema, page wiring, `testMatch`, docs akhir, ticket Answer | — |

Lane A dan B berjalan paralel. Main tidak menulis file milik A/B selama lane berjalan.

## Ownership file lane A

1. `packages/db/src/schema/prices.ts` — tambah tabel `price_change_apply_request` (+ export
   otomatis lewat `export * from "./prices"`; jangan ubah index schema).
2. `packages/db/src/discount-import-limits.ts` (BARU) + `packages/db/src/discount-import-limits.test.ts` (BARU).
3. `apps/admin/src/lib/discount-import-limits.ts` (BARU) — pembaca config uncached.
4. `apps/admin/src/lib/price-changes-administration.ts` — perluasan bulk + chunked apply + kandidat + read paginasi.
5. `apps/admin/src/lib/price-changes-administration.db.test.ts` — tambahan test T (real PG).
6. `apps/admin/src/lib/admin-command.ts` — `beginBoundedTransaction` menerima override timeout (tetap dibatasi default).
7. `apps/admin/src/app/api/admin/price-changes/route.ts` — stage N row.
8. `apps/admin/src/app/api/admin/price-changes/[id]/route.ts` — paginasi + filter state.
9. `apps/admin/src/app/api/admin/price-changes/[id]/apply/route.ts` — status 202 + log.
10. `apps/admin/src/app/api/admin/price-changes/candidates/route.ts` (BARU).

Tidak boleh menyentuh: `price-change-client.tsx`, `page.tsx`, `e2e/**`, `playwright.mock.config.ts`,
`packages/db/src/seed*.ts`, `docs/**`, `packages/db/drizzle/**`, file ticket/map.

## Kontrak domain (lane A)

### A1. Config limit — pure + reader

`packages/db/src/discount-import-limits.ts` (tanpa DB, tanpa import Next):

```ts
export const DISCOUNT_IMPORT_LIMIT_KEYS = {
  maxRows: "discount.import.maxRows",
  maxFileBytes: "discount.import.maxFileBytes",
  maxExpandedBytes: "discount.import.maxExpandedBytes",
} as const;

export const DISCOUNT_IMPORT_LIMIT_DEFAULTS = {
  maxRows: 1000,
  maxFileBytes: 5242880,
  maxExpandedBytes: 26214400,
} as const;

export type DiscountImportLimits = typeof DISCOUNT_IMPORT_LIMIT_DEFAULTS;

export class DiscountImportLimitError extends Error {
  readonly key: keyof DiscountImportLimits;
}

/** null/undefined/"" -> default; selain itu wajib /^\d{1,10}$/ dan 1..2147483647. */
export function parseDiscountImportLimit(
  key: keyof DiscountImportLimits,
  raw: string | null | undefined
): number;

export function resolveDiscountImportLimits(
  rows: Partial<Record<keyof DiscountImportLimits, string | null | undefined>>
): DiscountImportLimits;
```

`apps/admin/src/lib/discount-import-limits.ts` (DB admin lokal):

```ts
export async function readDiscountImportLimitsUncached(): Promise<DiscountImportLimits>;
// select value dari system_config untuk ketiga key sekaligus; key hilang -> default;
// nilai invalid -> throw DiscountImportLimitError (fail closed).
```

Test L wajib (literal independen, bukan meniru implementasi): missing → 1000/5242880/26214400;
`"1000"`/`"1"`/`"2147483647"` diterima; `"0"`, `"-5"`, `"1.5"`, `"abc"`, `""`+spasi,
`"2147483648"`, `"1000abc"` ditolak; satu key invalid menggagalkan seluruh resolve
(tidak diam-diam memakai default untuk key itu).

### A2. Schema `price_change_apply_request`

Tabel baru di `prices.ts` (nama module-scope untuk ekspor Drizzle: **`priceChangeApplyRequests`**,
nama SQL **`price_change_apply_request`**):

| kolom | tipe | aturan |
| --- | --- | --- |
| `id` | text PK | uuid |
| `actor_identity` | text not null | length 1..128 |
| `request_key` | text not null | CHECK regex UUID |
| `batch_id` | text not null | FK → `price_change_batch.id` `onDelete: restrict` |
| `preview_digest` | text null | null atau length 1..128 |
| `created_at` | timestamptz not null default now | |

- `uniqueIndex(actor_identity, request_key)` — satu key per actor (lintas batch juga unik;
  payload yang berbeda = 409).
- index `(batch_id)`.
- Tambahkan `relations` batch → many apply requests dan sebaliknya (pola file yang sama).
- **Jangan** menulis SQL migrasi; main menghasilkannya dengan drizzle-kit setelah review.

### A3. Stage batch (1..N row)

Perluas modul yang ada tanpa mengganti nama publik lama:

```ts
export interface StagePriceChangeInput {
  requestKey: string;
  source?: "manual" | "bulk";      // opsional; default: rows.length === 1 ? "manual" : "bulk"
  reason?: string | null;
  rows: readonly StagePriceChangeRowInput[];
}
export async function stagePriceChangeBatch(
  input: StagePriceChangeInput,
  actorUserId: string
): Promise<{ status: 200 | 201; data: PriceChangeBatchDto }>;

/** Tetap diekspor (dipakai test/route ticket 03); alias stagePriceChangeBatch. */
export async function stageManualPriceChange(input, actorUserId): Promise<...>;
```

Aturan:

- `MAX_STAGE_ROWS_HARD_LIMIT = 5000` diekspor (batas statis body); limit efektif = config
  `discount.import.maxRows` dibaca uncached **sebelum** transaksi.
- Config invalid → `PriceChangeError(503, "IMPORT_LIMITS_INVALID", ...)`.
- `rows.length > maxRows` → 400 `ROW_LIMIT_EXCEEDED` (pesan menyebut limit; tidak ada mutation).
- `rows.length === 0` → 400 `INPUT_INVALID`.
- SKU duplikat persis (case-sensitive) dalam satu batch → 400 `INPUT_INVALID`.
- SKU tidak ditemukan / source price invalid **bukan** alasan menolak seluruh batch: baris tetap
  di-stage dengan `variantId: null` + `preview.warnings: ["VARIANT_NOT_FOUND"]` atau
  `"SOURCE_PRICE_INVALID"`; apply memfinalkannya `failed` dengan `resultCode` yang sesuai.
- `set_price` wajib tepat satu dari `targetUnitPrice`/`discountPercent`; `restore_base` keduanya
  kosong. Shortcut persen dibekukan menjadi target fixed saat stage memakai `computePercentTarget`
  terhadap source terbaru; persen tidak disimpan sebagai authority.
- Fingerprint = SHA-256 JSON kanonik `{source, reason, rows:[{sku,action,targetUnitPrice,discountPercent}]}`
  (urutan dipertahankan). Key sama + fingerprint beda → 409 `REQUEST_KEY_CONFLICT`; key sama +
  fingerprint sama → 200 replay batch yang sama (tanpa batch/audit kedua).
- `rowCount = rows.length`, `pendingCount = rowCount`, counts lain `0`, state `staged`.
- Audit `PRICE_CHANGE_STAGED` tetap satu per row saat stage, `changes` memuat batchId/rowId/
  rowNumber/sku/action/target/source/sebelum/sesudah/reason seperti sekarang (tidak ada PII/secret).
- Satu transaksi stage untuk seluruh row: batch + semua row + semua audit. `preview_json` sudah
  dibatasi CHECK 16KiB per row.

### A4. Apply chunked (foreground, per row commit)

Konstanta + helper pure (diekspor, diuji literal):

```ts
export const APPLY_MAX_ROWS_PER_REQUEST = 25;
export const APPLY_BUDGET_MS = 5000;
export const APPLY_MIN_ROW_BUDGET_MS = 250;

export const PRICE_CHANGE_HALT = {
  policyRevoked: "POLICY_REVOKED",
  rowLimitExceeded: "ROW_LIMIT_EXCEEDED",
} as const;

export function remainingBudgetMs(deadline: number, now: number): number;
export function planRowBudget(remainingMs: number):
  | { lockTimeoutMs: number; statementTimeoutMs: number }
  | null; // null bila remaining < APPLY_MIN_ROW_BUDGET_MS
export function deriveBatchState(counts: {
  rowCount: number; applied: number; unchanged: number; failed: number; pending: number;
}): PriceChangeBatchState;
```

Literal test: `planRowBudget(5000) → {2000,5000}`; `(3000) → {2000,3000}`; `(1200) → {1200,1200}`;
`(249) → null`; `remainingBudgetMs` mengembalikan 0 untuk deadline lewat.
`deriveBatchState`: `{60,37,3,0}`→`in_progress`; `{97,3,0,0}`→`partially_applied`;
`{0,0,3,0}`→`failed`; `{0,0,0,100}`→`in_progress`; `{100,0,0,0}`→`applied`;
`{0,100,0,0}`→`applied`. (urutan field: rowCount, applied, unchanged, failed, pending —
tulis test dengan objek bernama agar tidak ambigu).

`applyPriceChangeBatch(batchId, input, actorUserId): Promise<{status: 200 | 202; data}>`:

1. `requireActiveContract()` (gate 1, uncached).
2. Baca limits uncached; invalid → 503 `IMPORT_LIMITS_INVALID`.
3. **Klaim apply request** dalam satu transaksi bounded:
   - `loadActorPolicyInTransaction` → bukan editor (`prices:view`+`prices:edit` global +
     `products:view all_branches`) → 403 `DENIED`.
   - Baca batch header; tidak ada → 404 `NOT_FOUND`.
   - `insert price_change_apply_request ... onConflictDoNothing (actor_identity, request_key)`.
     Bila sudah ada: `batch_id`/`preview_digest` harus sama (null-safe) → lanjut (resume/replay);
     beda → 409 `REQUEST_KEY_CONFLICT`.
4. Bila `batch.rowCount > limits.maxRows` → **tahan**: tidak ada row write; set
   `halt_reason = ROW_LIMIT_EXCEEDED`, `state = pending>0 ? in_progress : <final>`, kembalikan
   202/200 dengan DTO. Committed rows tetap.
5. Loop chunk, `deadline = Date.now() + APPLY_BUDGET_MS`, maksimum `APPLY_MAX_ROWS_PER_REQUEST`
   row:
   - Sebelum memulai row: `remaining = remainingBudgetMs(deadline, Date.now())`;
     `planRowBudget(remaining)` null → berhenti.
   - Pilih row `pending` dengan `row_number` terkecil (read di luar transaksi). Tidak ada → berhenti.
   - Satu transaksi per row (`beginBoundedTransaction` dengan override timeout dari
     `planRowBudget`): lock berurutan **batch (`for update`) → row (`for update`) → variant
     (`for update`) → current pointer (`for update`)**; re-read actor policy di dalam transaksi.
     Konsekuensi yang diterima: dua request apply pada batch yang sama akan menunggu batch lock
     (serial), sehingga total revision tetap = jumlah row dan tidak ada duplikasi; row yang sudah
     final dilewati tanpa write/audit kedua.
     - Policy tidak lagi editor → jangan menulis apa pun; set `halt_reason = POLICY_REVOKED`
       (update batch, transaksi terpisah/berikut yang boleh menulis halt) dan hentikan loop.
     - Row sudah final (race dengan request lain) → tidak ada revision/audit/result kedua;
       hitung sebagai "tidak diproses" dan lanjut ke row pending berikutnya.
     - `applyRow` yang sudah ada dipakai ulang: validasi target terhadap source terbaru, restore
       melepas target terbaru, no-op (`unchanged`) tanpa revision, revision+pointer+hasil row+audit
       dalam transaksi yang sama.
     - Setelah row diproses: recalc counts/state batch dalam transaksi yang sama dan bersihkan
       `halt_reason` (karena izin kembali valid).
   - Error transient (`isRetryableDatabaseError`, timeout statement/lock): **jangan** dianggap
     rollback. Baca ulang state row secara durable di luar transaksi:
     - row sudah final → lanjut (hasil dihitung);
     - masih `pending` → hentikan loop, kembalikan 202 dengan DTO (pending jujur), tanpa
       mengubah row menjadi failed.
6. Setelah loop: baca DTO; `status = pendingCount > 0 ? 202 : 200`. Batch **belum final** selama
   `pending > 0` (`state = in_progress`). Counts selalu menjumlah `rowCount`.
7. Log dilakukan di route (bukan di domain): `price_changes.apply` dengan `outcome: "success"`
   untuk 200 dan `outcome: "partial"` untuk 202, memuat batchId/state/4 counts/haltReason/actorId,
   tanpa request key/digest/source price.

Final state mengikuti spec: `applied` bila tanpa failed; `partially_applied` bila failed>0 dan
minimal satu applied/unchanged; `failed` bila semua row final failed; `in_progress` selama pending.

**No-op bukan perubahan fiktif:** set target identik dan restore tanpa Markdown tetap
`unchanged`, tidak membuat revision/pointer baru; audit `PRICE_CHANGE_UNCHANGED` tetap satu kali
per row (sekali, bukan per resume). Karena row sudah final, resume tidak mengaudit ulang.

### A5. Read detail + kandidat

```ts
export interface PriceChangeBatchQuery { page?: number | string; limit?: number | string; state?: string }
export async function getPriceChangeBatch(
  batchId: string, actorUserId: string, query?: PriceChangeBatchQuery
): Promise<PriceChangeBatchDto | null>;
```

- `PriceChangeBatchDto` tetap memuat counts/haltReason/rows, ditambah
  `pagination: { page, limit, total, totalPages }`. `rows` adalah halaman yang diminta
  (default page 1, limit 25, max 100). `state` filter: `all` (default), `pending`, `applied`,
  `unchanged`, `failed`; nilai lain → 400 `INPUT_INVALID`.
- `source` di DTO menjadi union `"manual" | "bulk" | "xlsx"`.
- `PriceChangeBatchRowDto` tetap seperti sekarang (preview + actual + resultCode) supaya report/
  retry ticket 05 bisa membentuk workbook tanpa arsip file; tambahkan
  `preview.variantLabel: string | null` (gabungan color/size, null bila tidak ada) pada preview
  yang dibangun saat stage. Jangan menambah field sensitif.
- `getPriceChangeBatch` tetap mewajibkan `prices:view` + `products:view all_branches`; batch di luar
  grant = 404/403 seperti sekarang (tidak membocorkan hasil ke viewer tanpa grant).
- Kandidat:

```ts
export interface PriceChangeCandidateQuery { search?: string; page?: number | string; limit?: number | string }
export async function listPriceChangeCandidates(
  query: PriceChangeCandidateQuery, actorUserId: string
): Promise<{ rows: PriceChangeCandidate[]; pagination: {...} }>;

export interface PriceChangeCandidate {
  variantId: string; sku: string; productId: string; productName: string;
  variantLabel: string | null;
  basePrice: string | null;          // source Jubelio saat ini (whole Rupiah)
  effectiveUnitPrice: string | null; // proyeksi projectMarkdownPrice
  storedTarget: string | null;
  markdownActive: boolean;
  priceVersion: number | null;  // pointer version
}
```

- Search case-insensitive pada SKU dan nama produk (`ilike %search%`, search max 100 char),
  pagination default 25/max 100, count query memakai filter yang sama, urut `sku asc` (stabil).
- Proyeksi memakai `projectMarkdownPrice` yang sama (bukan duplikasi rumus). **Keputusan kontrak**:
  baris dengan source invalid tetap dikembalikan dengan `basePrice`/`effectiveUnitPrice` **null**
  dan tetap dihitung pada pagination; UI menandai "source tidak valid" dan baris tidak bisa dipilih.
  Ini menghindari count yang tidak konsisten antara daftar dan total.
- Grant: `prices:view` global + `products:view all_branches`; tanpa itu 403 `DENIED`.

### A6. `admin-command.ts`

```ts
export interface BoundedTransactionOptions {
  isolationLevel?: "read committed" | "repeatable read" | "serializable";
  /** Override budget sisa request; selalu di-clamp ke default (2s/5s) dan minimal 100ms. */
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}
export async function beginBoundedTransaction<T>(run, options?: BoundedTransactionOptions): Promise<T>;
```

`set local lock_timeout/statement_timeout` diisi dari konstanta internal (bukan input request;
nilai numerik sudah di-clamp & dibulatkan integer ms). Perilaku default tidak berubah.

### A7. Route HTTP

- `POST /api/admin/price-changes` (`prices:edit`): body
  `{ requestKey: uuid, source?: "manual"|"bulk", reason?: string|null, rows: [{sku, action, targetUnitPrice?, discountPercent?}] }`,
  `rows` `.min(1).max(MAX_STAGE_ROWS_HARD_LIMIT)`, `z.strictObject` (tanpa field tak dikenal).
  Teruskan `source`. Sukses 201/200 replay. Log stage memuat batchId/state/rowCount/replayed/actorId/
  policyVersion (tanpa fingerprint/request key).
- `GET /api/admin/price-changes/{id}` (`prices:view`): query `page`, `limit`, `state`; 400 untuk
  state tidak dikenal (dari domain). Tetap no-store.
- `POST /api/admin/price-changes/{id}/apply` (`prices:edit`): kirim `202` bila `result.status === 202`,
  `200` bila final. Log `outcome: result.status === 202 ? "partial" : "success"` beserta counts +
  haltReason + batchId + actorId + policyVersion.
- `GET /api/admin/price-changes/candidates` (`prices:view`): query search/page/limit; envelope sama;
  no-store; log info `price_changes.candidates` (outcome success, total, actorId) dan error
  kontekstual. Tidak me-log SKU massal.

## Kontrak UI (lane B)

File baru `apps/admin/src/app/admin/products/harga/price-change-bulk-client.tsx` (client component,
`"use client"`, ekspor `PriceChangeBulkClient`), memakai komponen shared existing
(`@/components/ui/{badge,button,card,checkbox,input,label,table}`, `toast` dari `sonner`,
`useAuth().hasPermission`). Bahasa UI Indonesia, token/theme existing, tanpa redesign shell.

Perilaku minimum:

1. **Kandidat SKU lintas halaman**
   - `GET /api/admin/price-changes/candidates?search=&page=&limit=25` → tabel checkbox dengan kolom
     SKU, produk, variant, base, efektif, status (Markdown aktif/fallback/tanpa target).
   - Checkbox per baris: `aria-label={"Pilih SKU " + sku}`; checkbox header "Pilih halaman ini"
     memilih **hanya** baris halaman aktif (bukan seluruh hasil filter).
   - Seleksi disimpan di `useState<Map<string, Candidate>>` sehingga bertahan saat pindah halaman
     dan saat search berubah (baris yang tidak lagi tampil tetap terpilih).
   - Tampilkan "Terpilih: N SKU" + tombol "Bersihkan pilihan". Tombol prev/next + indikator
     halaman/total.
   - Baris dengan `basePrice === null` tidak bisa dicentang dan menampilkan "source tidak valid".
2. **Form aksi bulk** (satu aksi untuk semua SKU terpilih)
   - Pilihan `set_price` (target fixed **atau** diskon %) / `restore_base`; alasan opsional (≤500);
     untuk restore tampilkan catatan "Markdown terbaru akan dilepas".
   - Untuk percent: kirim `discountPercent` (server membekukan target fixed). Jangan menghitung
     target di browser sebagai authority.
   - Tombol "Stage N SKU untuk review" (disabled bila N=0 atau `!hasPermission("prices","edit")`).
   - Body stage: `{ requestKey: crypto.randomUUID(), source: "bulk", reason, rows: [...] }`.
3. **Review**
   - Ringkasan counts: `N baris · X diterima · Y error` dan total dampak naik/turun.
   - Tabel per row: SKU, variant, base (source saat stage), harga efektif kini, target, dampak
     ("Naik Rp 90.000 (60,00%)" / "Turun …" / "Tidak berubah"), status/warnings.
   - Baris restore menandai "melepas Markdown" bila `preview.storedTargetBefore !== null`.
   - Tombol "Apply" memakai `requestKey` baru per klik (simpan key di ref sampai response sukses;
     retry setelah error memakai key yang sama) + `previewDigest` = SHA-256 hex dari
     `JSON.stringify(rows.map(r => r.preview))`.
4. **Hasil + resume (manual)**
   - Satu klik = satu chunk server (maks 25 row / 5 detik). Jangan loop otomatis.
   - Setelah response, tampilkan counts jujur: `applied/unchanged/failed/pending` dari DTO.
   - `pendingCount > 0` → pesan info "Belum final: A diterapkan, B tanpa perubahan, C gagal,
     D pending." + tombol "Lanjutkan apply (sisa D)" yang memanggil endpoint apply lagi dengan
     `requestKey` baru. Jangan pernah menulis berhasil penuh selama pending.
   - Final: `applied` → "A baris diterapkan."; `partially_applied` → "A diterapkan, B tanpa
     perubahan, C gagal."; `failed` → "Semua baris gagal."; `unchanged` semua → "Tidak ada
     perubahan harga."
   - `haltReason`: `POLICY_REVOKED` → "Izin edit dicabut; sisa baris ditahan."; `ROW_LIMIT_EXCEEDED`
     → "Batch melebihi batas baris terbaru; sisa baris ditahan." Tampilkan sebagai error, bukan sukses.
   - Setelah final, segarkan daftar kandidat (fetch ulang halaman aktif) dan bersihkan seleksi
     hanya bila final `applied`/`partially_applied`. Sediakan tombol "Buka batch" yang menampilkan
     id batch untuk audit.

Selector e2e yang stabil (wajib dipakai spec): `data-testid` pada
`bulk-candidate-table`, `bulk-select-page`, `bulk-selection-count`, `bulk-stage`,
`bulk-review-counts`, `bulk-apply`, `bulk-resume`, `bulk-status`, `bulk-next-page`,
`bulk-prev-page`, `bulk-search`.

Spec e2e baru `e2e/admin/price-change-bulk-mock.spec.ts` (pola `price-change-mock.spec.ts`:
guarded mock config, loopback origin, DB disposable, sign-in lewat HTTP, fixture SQL + cleanup):

- Fixture 30 SKU (`E2E-BULK-01..30`) di 2–3 produk, source 300000. Salah satu variant punya
  Markdown aktif 150000 (boleh via SQL fixture: batch+revision+current pointer).
- Skenario utama: cari "E2E Bulk", pilih 10 SKU di halaman 1, pindah halaman, pilih 20 SKU di
  halaman 2 → `Terpilih: 30 SKU` (seleksi bertahan); stage diskon 20% → review menampilkan target
  fixed `Rp 240.000` untuk variant source 300000 (bukan 80% dari 150000) dan kenaikan
  `Naik Rp 90.000` pada variant yang Markdown-nya aktif; apply → counts menjumlah 30 dan
  `pending > 0` (chunk maks 25) dengan pesan "Belum final"; klik "Lanjutkan" sampai `state` final
  → assert 30 applied/30 revision lewat pool. Jangan assert angka chunk tertentu (25) agar tidak
  rapuh terhadap budget waktu; assert `pending > 0` pada respons pertama dan final setelah resume.
- Skenario tambahan: restore untuk SKU tanpa Markdown → `unchanged` (tanpa revision) dan pesan
  "Tidak ada perubahan harga."; percent shortcut `85%` dari source 100001 → target `85001`
  (half-up) pada fixture khusus; akses non-editor (admin tanpa grant) ditolak 403 pada API dan
  tombol stage disabled/no-access.
- Daftarkan spec di `playwright.mock.config.ts` **tidak** dilakukan lane B (main yang menambah
  `price-change-bulk` pada kedua `testMatch`).

## Test T untuk lane A (real PG, `price-changes-administration.db.test.ts`)

Wajib (expected literal independen, assertion lewat domain interface; SQL hanya untuk fixture/
hitung audit):

1. Bulk stage 3 row → 1 batch, 3 row pending, 3 audit `PRICE_CHANGE_STAGED`; variant selain yang
   dipilih tidak punya revision/pointer; apply per chunk → 3 applied, 3 revision, 3 audit applied,
   counts sum = rowCount, source variant tidak berubah.
2. Chunk & 202: stage 30 row (fixture 30 variant `ZZ-BULK-01..30`), satu apply → `status 202`,
   `appliedCount` ≥1, `pendingCount` ≥1, `applied+pending=30`, dan jumlah revision = appliedCount;
   resume (request key baru) berulang sampai final → 30 applied, 30 revision, tidak ada row yang
   diproses dua kali (unique batch_row revision) dan counts final jujur.
3. Apply paralel pada batch 30 row (dua request key berbeda, `Promise.all`) → total revision 30,
   audit applied 30, tidak ada duplikasi; kedua response 200/202 konsisten.
4. Resume setelah revoke: stage 30, apply chunk pertama (25) → revoke `prices:edit` → apply/resume
   → response memuat `haltReason "POLICY_REVOKED"`, pending tidak turun, tidak ada revision baru,
   row yang sudah applied tetap; re-grant → resume → final.
5. Config limits: set `discount.import.maxRows=2` → stage 3 row ditolak 400 `ROW_LIMIT_EXCEEDED`;
   stage 3 row dengan limit 1000 lalu ubah limit jadi 2 → apply ditahan (`haltReason
   "ROW_LIMIT_EXCEEDED"`, tanpa revision, committed rows sebelumnya tetap); nilai config invalid
   (`"abc"`) → stage/apply 503 `IMPORT_LIMITS_INVALID` dan batch final lama masih bisa dibaca;
   key hilang → default 1000.
6. Source terbaru saat apply: stage target 150000 (source 300000) → ubah source ke 100000 →
   apply gagal row `TARGET_NOT_BELOW_SOURCE` tanpa revision; ubah source ke 200000 → tetap
   diterapkan dengan actual source 200000 (tanpa re-review), effective 150000; restore melepas
   target terbaru.
7. No-op: set target identik → `unchanged` + satu audit, tanpa revision; restore tanpa Markdown →
   `unchanged`; apply ulang row final tidak menambah audit/revision.
8. Request key apply: key sama + `previewDigest` berbeda → 409 `REQUEST_KEY_CONFLICT`; key sama
   dengan payload sama → lanjut tanpa duplikasi; key baru pada batch final → 200 tanpa write.
9. Read/report seam untuk 05: detail dengan `limit=2` mengembalikan pagination total = rowCount;
   filter `state=failed` hanya baris failed dengan `resultCode` dan actuals; viewer tanpa grant
   403, batch orang lain tidak terbaca.
10. Kandidat: search SKU menemukan row dengan base/effective/target/priceVersion benar (variant
    dengan Markdown aktif → effective = target), pagination konsisten, dan tanpa `prices:view`/
    all-branch products view → 403.

Jangan mengubah test lama kecuali signature yang memang berubah (`apply` sekarang mengembalikan
`status`, `stage` bisa N row). Jaga `dbReady`/skip pattern dan cleanup FK-ordered yang ada; tambah
pembersihan `price_change_apply_request` sebelum `price_change_batch_row`/`price_change_batch`
(dan hapus batch oleh actor fixture).

## Aturan test & review

- Test-first per slice; expected value literal dari spec §4.4 (mis. 85% dari 100001 = 85001;
  base300000/current150000/20% → target240000, kenaikan90000).
- Jangan mock module internal. PostgreSQL nyata hanya DB disposable `marketplace_discounts_test_*`.
- Batas output: jangan print seluruh response 1000 row.
- Lane A/B tidak menjalankan `npm`, `npx`, vitest, playwright, tsc, lint, drizzle-kit, seed, docker.
  Semua itu milik main agent.
- Bila kontrak di dokumen ini bertabrakan dengan kode existing, **berhenti dan laporkan** di handoff
  (jangan mengubah kontrak sendiri). Perubahan produk/scope baru = stop, bukan re-plan.
- Report handoff (ringkas): file yang diubah, keputusan implementasi yang menyimpang dari paket
  (harus kosong/beralasan), daftar test yang ditulis + nama test, risiko/gap, dan apa yang belum
  diverifikasi.
