# Handoff pemulihan ticket01 — checkout writer

## Authority dan kondisi lane

Pemilik meminta seluruh13 implementation tickets, mengizinkan subagent development/test, dan membatasi main agent pada review/integrasi/eksekusi validation. Pemilik kemudian meminta **jangan menggunakan `ask_user_question` selama AFK**. Jangan mengambil keputusan produk baru; ikuti complete spec yang sudah disetujui dan catat blocker. Tidak ada izin provider writes nyata, commit/push, remote/deployment/launch.

Writer E `65b7769d-1daa-478c-a52c-8407782495c9` berhenti karena usage limit. Artifacts menandai runner terminal/resumable; tidak ada writer aktif yang boleh ditumpuk. Native delegation tools belum diekspos di sesi main saat handoff ini dibuat. Jangan mengganti native delegation dengan CLI/direct-provider runner atau diam-diam mengambil alih implementasi pada main. Pengaturan user sudah memasang `pi-subagents` dan default child `ollama/deepseek-v4.1-flash:1017-cloud`; original child memakai Codex dan retained resume mempertahankan model lamanya. Ikuti native status/recovery protocol ketika tool tersedia lagi.

Root: `C:/Users/USER/.herdr/worktrees/marketplace/worktree-diskon`, ref awal `d96bdf1`. Source parsial E ada di root, backend C/D dan retention F sudah diintegrasikan. Lihat `execution.md` untuk ownership dan original dirty user changes. Jangan overwrite perubahan pengguna atau memodifikasi generated SQL.

## Evidence terbaru (main yang menjalankan)

Database hanya **disposable** `marketplace_discounts_test_20261019_v2`, localhost5432 dengan credential dev dari `docker-compose.yml`. Schema root dan DB kini cocok: money snapshot + FK RESTRICT. Generated SQL0034/0035 tidak hand-edit; keduanya sudah direview. Gate domain default0, fixture browser mengubah1 hanya sementara dan restore saat cleanup.

1. `npm run verify:types:store` — PASS (`/tmp/discounts-resume-types-store.log`).
2. `npm run verify:types:admin` — PASS (`/tmp/discounts-resume-types-admin.log`).
3. Focused `checkout-input.test.ts` + `delivery-quote.test.ts` —2 files47passed (`/tmp/discounts-resume-checkout-focused.log`).
4. Full serial unit dengan explicit disposable URL —115 files:112passed/3failed;1311tests passed/2failed/3skipped. Satu file gagal pada afterAll. Log `/tmp/discounts-resume-batch-unit.log`. Tidak dianggap full green.
5. Browser `e2e/store/versioned-checkout-mock.spec.ts` —3 tests:1passed/2failed (`/tmp/discounts-resume-checkout-browser.log`). Batas input test sudah green; dua failure adalah label service fee yang masih tampil.
6. Affected legacy mock regression5 specs — **18passed** (`/tmp/discounts-resume-legacy-mock-regression.log`): pickup, delivery-order, shipment-tracking, shipment-booking admin, delivery-follow-up admin. Ini gate0/legacy regression, bukan bukti v1 delivery/settlement baru.

Jangan rerun suite yang sudah lulus tanpa source/fixture terkait berubah. Main membaca error-context Markdown, tidak membuka PNG.

## Temuan review yang sudah direproduksi — fix pada owner implementer, bukan main

### A. Service fee UI masih tampil

Tests public browser yang sudah RED:
- `versioned-checkout-mock.spec.ts::gate1 pickup review uses the versioned goods-only tax contract without a service charge`: expected label Biaya Layanan count0, received2.
- `...::gate1 pickup persists immutable pricing through real Snap creation, detail and repayment`: expected count0, received1 pada account detail.

Source terkait:
- `apps/store/src/app/checkout/page.tsx` sekitar1064 dan1172: dua summary menampilkan Biaya Layanan Rp0 tanpa conditional.
- `apps/store/src/app/account/orders/[id]/page.tsx` sekitar574: row serviceFee selalu ditampilkan.
- `apps/admin/src/app/admin/orders/[id]/page.tsx` sekitar1252: row yang sama; browser coverage admin masih perlu dilengkapi.

Jangan menghapus assertion atau menambah fee. Kontrak baru fee0 dan tidak ditampilkan sebagai charge; history legacy dengan fee nonzero boleh tetap diperlihatkan. Gunakan komponen/style existing, tanpa redesign.

Markdown failure contexts yang sudah dibaca main (report directory dapat tertimpa run berikut):
- `playwright/results/legacy/store-versioned-checkout-m-f072e-ct-without-a-service-charge-pickup-mock/error-context.md`
- `playwright/results/legacy/store-versioned-checkout-m-b36c2-eation-detail-and-repayment-pickup-mock/error-context.md`

Penting: test pickup persistence sudah melewati assertions versi112, snapshot150000/PPN16500/customer166500/provider150000, captured actual Snap payload, captured SO original/net shipping0, snapshot/expiry tetap setelah harga/config berubah, repayment memakai redirect yang sama. Failure terakhir hanya label UI; ini belum membuktikan paid v1 settlement.

### B. Dua schema tests masih menuntut CASCADE lama

- `packages/db/src/schema/jubelio-sales.test.ts:30–34`: nama test dan expected `onDelete: cascade` masih lama.
- `packages/db/src/schema/jubelio-channel.test.ts:34–38`: hal yang sama.

Expected aktual harus mengikuti approved retention spec8.4: RESTRICT. Jangan mengembalikan FK ke CASCADE untuk mengatasi test. SQL retention tests baru sudah membuktikan23503, bukan sekadar schema introspection.

### C. Satu fixture shipment tracking belum FK-ordered

`packages/db/src/shipment-tracking.test.ts:493` afterAll menghapus orders sementara `jubelio_sales_operation` anak masih ada →23503. beforeAll sekitar456 juga punya pola cleanup lama; `seedBookedShipment` sekitar151–156 punya cleanup scoped sendiri.

Gunakan helper test-only `packages/db/src/testing/retained-order-fixtures.ts` dengan exact fixture order IDs (prefix `track-dbtest-order-%` ditambah static `track-order-1`) untuk setup/teardown. Jangan delete shared users/order lain, disable FK, atau mengubah logic production tracking. Pertahankan seluruh expected business assertions. File ini tidak memakai suffix `.db.test.ts`, sehingga terlewat pada audit awal.

## Scope checkout yang masih harus dilengkapi sebelum01 resolved

- Actual v1 delivery quote→checkout→Snap→order detail/repayment: barang150000 + original/net shipping30000, PPN16500, customer196500, provider180000; booking/service original cost tetap terpisah.
- Authoritative paid status/webhook→SO/invoice/payment melalui actual loopback HTTP, minimal pickup/delivery; captured invoice/payment150000/180000, account/type/linkage/paid amount/due0 dan no duplicate writes. Existing `pickup-mock.spec.ts` menyediakan public control/status/webhook prior art. Mock raw observation fields mungkin masih perlu diperluas dengan test-first (`invoice.payment_amount`, payment account/type, associations grand_total/due).
- Store/admin readers dan repayment memakai strict versioned decoder sebelum early return redirect, tidak reprice dari master/config. Unknown snapshot version harus fail closed tanpa provider write; legacy cents dipertahankan.
- Source/cart/body bounds sebelum stock/rates provider calls; preliminary `buildPricingSnapshot` kini berada sebelum `verifyCheckoutStock` pada place-order. Tambahkan public coverage untuk source fraction/qty/current source changes bila belum ada.
- Immutable snapshot/order intent konsisten saat fresh quote berlangsung; sorted source locks/revalidation tidak boleh diganti HTTP di transaction.
- Enduring feature/API/testing/deployment documentation dari hasil aktual. Jangan mengklaim feature Offer/Markdown sudah tersedia; ticket02/06 dan seterusnya masih open.
- Main final review terhadap spec+standards, focused types/unit, full serial unit setelah temuan di atas diperbaiki, affected mock E2E dan scope acceptance record. Standard legacy live-provider E2E tidak berizin; UAT/launch tetap external gates.

## Batas file dan review

Gateway/lifecycle/operations/expected/mirror C/D sudah main-reviewed dan terintegrasi; jangan menulis ulang. Schema/retention F sudah main-reviewed; perubahan remaining B/C di atas hanya tests/fixture teardown, bukan perilaku FK. Store pure pricing sudah dipindahkan ke `packages/db/src/versioned-pricing.ts`; store module merupakan thin re-export. Jangan import runtime shared DB ke app.

Context7 checkpoints tersedia di `execution.md`: Drizzle, Vitest, Next.js, Zod, Playwright. Load matching skills sebelum coding dan periksa API uncertain sesuai repo; jangan mengulang settled research tanpa gap konkret.

Tidak ada ticket yang dinyatakan resolved. Hanya setelah01 memenuhi evidence acceptance, claim02 dan06 dan gunakan isolated worktrees untuk parallel writers.
