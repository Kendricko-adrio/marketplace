# Handoff lane C — seed, cleanup, dan docs ticket 04

Dokumen kerja untuk lane implementer docs/seed. Baca dulu
[`handoff-04.md`](handoff-04.md) (kontrak lane A/B) dan ticket
[`.scratch/discounts/ticket/04-bulk-price-apply-and-resume.md`](04-bulk-price-apply-and-resume.md).
Tidak ada akses shell: jangan menjalankan npm/npx/vitest/tsc/lint/drizzle/seed/docker/git.
Jangan commit, jangan menyentuh runtime app/tests di luar daftar ownership di bawah.

## Ownership (hanya file ini)

1. `packages/db/src/seed-system-config.ts` — tambah export array
   `discountImportSystemConfigSeedRows` berisi tiga baris default spec §6.2:
   - `discount.import.maxRows` = `1000`, type `number`
   - `discount.import.maxFileBytes` = `5242880`, type `number`
   - `discount.import.maxExpandedBytes` = `26214400`, type `number`
   Deskripsi singkat: batas import/bulk harga (ticket 04), ubah via SQL dan baca
   per request (bukan cache boot store).
2. `packages/db/src/seed.ts` — dua perubahan additive saja:
   - sertakan `discountImportSystemConfigSeedRows` pada insert `systemConfig`
     (dekat `...shipmentSystemConfigSeedRows`, jangan menimpa konfigurasi lain);
   - satu batch demo **bulk staged** setelah blok Markdown ticket 03 (setelah
     pointer/current selesai): `source: "bulk"`, `state: "staged"`, 3 row
     `pending` untuk tiga SKU yang sudah ada di `seededVariantsBySku`
     (`SS-WHT-41`, `SS-BLK-41`, `OX-BLK-41`), `requestKey` UUID deterministik
     (`00000000-0000-4000-8000-000000000004`), fingerprint 64 char `0`,
     `rowCount/appliedCount/unchangedCount/failedCount/pendingCount = 3/0/0/0/3`,
     reason "Seed demo bulk Markdown (ticket 04)". `previewJson` per row harus
     cocok dengan `PriceChangePreview` di
     `apps/admin/src/lib/price-changes-administration.ts` (isi minimal: inputSku,
     variantId, productId, productName, variantLabel, action `set_price`,
     targetUnitPrice, sourceUnitPrice, storedTargetBefore,
     effectiveUnitPriceBefore, markdownActiveBefore, markdownRevisionIdBefore,
     effectiveUnitPriceAfter, delta, direction, percent, warnings[]). Row tidak
     menulis revision/pointer (state pending, `applied_revision_id` null) dan
     tidak mengubah `product_variant.price`. **Jangan** membuat batch kedua yang
     bentrok dengan batch ticket 03.
3. `packages/db/src/seed-cleanup.ts` — tambah entri
   `["priceChangeApplyRequests", schema.priceChangeApplyRequests]` **sebelum**
   `priceChangeBatchRows`/`variantPriceCurrent`/`variantPriceRevisions`/
   `priceChangeBatches` (FK RESTRICT ke batch).
4. `packages/db/src/seed-cleanup.test.ts` — tambah assertion urutan: apply
   requests sebelum batch rows dan sebelum batch.
5. `packages/db/src/seed-system-config.test.ts` — tambah assertion bahwa tiga
   key discount import ada dengan nilai default di atas (jika pola test file
   menguji export array; ikuti pola existing).
6. Dokumentasi (bahasa Indonesia, additive, jangan menghapus kontrak ticket 03):
   - `docs/features/markdown-pricing.md`: bagian baru "Bulk harga (ticket 04)"
     yang menjelaskan: pilihan SKU lintas halaman (hanya SKU dicentang, bukan
     seluruh hasil filter), batas `discount.import.maxRows` (default 1000, invalid
     fail closed, perubahan limit tidak menghapus hasil committed dan batch
     pending yang melebihi limit ditahan), stage/review (fixed target dari
     shortcut persen dihitung half-up dari source lalu dibekukan; review
     menampilkan base/current/target/dampak/kenaikan/warning dan konsekuensi
     restore), apply foreground maksimal 25 row atau budget 5 detik per request
     dengan satu transaksi per row (bukan satu transaksi 1000 row, tanpa
     background worker), 202 selama pending + resume manual hanya row pending,
     counts jujur applied/unchanged/failed/pending (contoh 60/37/3 belum final;
     resume hanya 37), no-op = `unchanged` tanpa revision, source/Markdown
     terbaru dipakai saat apply tanpa re-review wajib, revoke `prices:edit`
     menghentikan write berikutnya dengan halt reason dan tidak me-rollback yang
     sudah commit, apply-request key (key sama + payload beda = 409), dan batas:
     parser Excel/export workbook adalah ticket 05.
   - `docs/api-reference.md`: perbarui tabel endpoint harga + paragraf detail:
     `POST /api/admin/price-changes` menerima 1..N row (`source` opsional
     `manual|bulk`), `GET /api/admin/price-changes/{id}` menerima
     `page`/`limit`/`state`, `POST .../apply` mengembalikan `202` selama pending
     dan `200` saat final, `GET /api/admin/price-changes/candidates` (baru:
     `search`/`page`/`limit`, butuh `prices:view` + products view-all) untuk
     pemilihan SKU lintas halaman. Sebutkan error `ROW_LIMIT_EXCEEDED`,
     `IMPORT_LIMITS_INVALID`, `REQUEST_KEY_CONFLICT`, halt
     `POLICY_REVOKED`/`ROW_LIMIT_EXCEEDED`, dan bahwa money tetap decimal string.
   - `docs/testing/README.md`: tambah entri unit/DB test bulk (`price-changes-administration.db.test.ts`
     skenario bulk/chunk/revoke/limit/request-key/kandidat), pure
     `discount-import-limits.test.ts`, dan mock E2E
     `e2e/admin/price-change-bulk-mock.spec.ts` (mock config, disposable DB).
   - Jangan menambah klaim UAT/release/provider.

## Aturan isi dokumen

- Nyatakan hanya perilaku yang benar-benar ada di source setelah lane A; baca
  source final `apps/admin/src/lib/price-changes-administration.ts` di root sebelum
  menulis docs. Jika source belum ada (lane A belum selesai), tunggu/berhenti dan
  laporkan.
- Jangan mengklaim batas sebagai SLA terukur; sebut sebagai batas konfigurasi.
- Jangan menulis bahasa Inggris untuk dokumen baru; pertahankan identifier, path,
  command, key config.
- Seed hanya untuk environment disposable; jangan menambah instruksi menjalankan
  `db:seed` pada data nyata.
- Laporkan: file berubah, nama test, command yang harus dijalankan main, gap.
