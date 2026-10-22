# Catatan eksekusi dan handoff implementasi diskon

Catatan kerja sesi berizin, bukan tracker status baru. Status task tetap pada `issues/`; status conceptual plan tetap `plan/index.md`.

## Otorisasi dan batas

Pemilik meminta seluruh13 tickets diimplementasikan, mengizinkan parallel subagents untuk development serta penulisan unit/Playwright E2E tests. Main agent melakukan review, integrasi, dan **seluruh** eksekusi validation. Subagent memakai project agent `implementer` yang tidak memiliki shell. Tidak ada izin provider requests nyata, commit/push, SSH/remote/Docker/deployment/launch. Legacy live-provider E2E tidak dijalankan.

Perubahan pengguna sebelum sesi: `.agents/settings.local.json`, `.gitignore`, `.mcp.json`, `AGENTS.md`, `docs/README.md`, `docs/testing/README.md`, `package.json`, penghapusan `tasks.md`, serta untracked `.agents/agents/`, `.pi/`, `docs/agents/mcp-tooling.md`. Jangan overwrite atau commit perubahan tersebut. Snapshot status awal disimpan di `%TEMP%/discounts-initial-status.txt`.

## Environment validation

- Root: `C:/Users/USER/.herdr/worktrees/marketplace/worktree-diskon`, ref awal `d96bdf1`, branch `worktree/diskon`.
- `npm ci --ignore-scripts` berhasil (853 packages). Tidak ada dependency/version yang sengaja diubah. Audit npm existing melaporkan60 vulnerabilities; bukan hasil security remediation sesi ini.
- Local PG tersedia. Database **baru dan khusus disposable**: `marketplace_discounts_test_20261019`, localhost5432, credential dev dari `docker-compose.yml`. Tidak mengubah database existing.
- Baseline `db:push` dan `SEED_MODE=demo db:seed` berhasil pada database disposable tersebut. Pengaturan default domain belum diaktifkan ke1. Set `DATABASE_URL` eksplisit untuk semua SQL tests/push/seed, jangan mengandalkan DB default.
- Browser cache Chromium tersedia. Belum ada Playwright run fitur baru.
- Logs main berada di `/tmp/discounts-*.log` (Git Bash; padanan Windows `%TEMP%/discounts-*.log`). Jangan membaca PNG saat browser test gagal.

## Lane board ticket01 — multi-seam

| Lane | cwd / isolation | Exclusive ownership | Gate / handoff |
| --- | --- | --- | --- |
| A — snapshot uang | Worktree utama | `apps/store/src/lib/versioned-pricing.ts`, `.test.ts`; `packages/db/src/schema/orders.ts`; `packages/db/src/pricing-snapshot.db.test.ts`; schema export bila perlu | Public L pricing/decoder dan D SQL constraint. Main menjalankan setiap red/green. |
| B — gateway provider | `../discounts-provider-01`, detached `d96bdf1` | `packages/db/src/schema/jubelio-sales.ts` (request types), `apps/store/src/lib/jubelio-sales-client.ts`, `.test.ts` | H gateway/builder/edit expected envelope dan durable returned-ID runtime hooks. Belum diintegrasikan ke root. |

Worktree B dibuat manual tanpa commit karena root dirty. AGENTS/project implementer/package scripts dan scratch contracts disalin untuk cold start; perbedaan salinan dokumen bukan perubahan feature yang perlu diintegrasikan. Dependencies root dan workspace store/admin dijunction ke instalasi utama; jangan menghapus source dependency melalui junction. Hanya ambil diff tiga file ownership B saat integrasi.

Workflow awal `0d0bfbb7-c087-4ad5-952d-8d77e8723d6c`; A run `b7f94804-e3b1-4fff-b75f-31d9b66071ff`. B run awal `602dd8a8-cab1-4c24-ba00-7415440a1433`, retained follow-up `5e950bc5-6d87-416f-a59e-e2eb11a9ce14`. Report kandidat B berada di managed subagent artifacts `discounts/t01-components.t01-provider.md`.

## Evidence sementara — bukan acceptance ticket lengkap

- Baseline focused existing pricing/payment-items/gateway:3 files,113 tests passed (`discounts-baseline-unit.log`).
- Baseline lifecycle/finalizer/mirror/payment-init/delivery:6 files,88 tests passed (`discounts-baseline-lifecycle.log`).
- Baseline types admin passed (`discounts-types-admin-baseline.log`).
- A cycle1 RED missing module → GREEN2 tests + types store.
- A cycle2 RED missing cart/qty/ID/Markdown guards → GREEN32 tests + types store. Review memperbaiki fixture ambigu `150.000`: decimal150 valid; invalid ribuan memakai koma/multi-dot, bukan menolak trailing-zero decimal yang sah.
- A cycle3 RED missing decoder → GREEN61 tests + types store. Decoder pricing1/engine1/provider2 strict, money/line identities, fee0, quote/billed costs terpisah, size256KiB.
- A cycle4 menambahkan explicit legacy decoder dan dispatch. Review mempertahankan cents legacy numeric(15,2), bukan memaksakan integer baru ke history. Assertion null payload diperbaiki ke CORRUPT; unknown versions tetap UNSUPPORTED, tanpa fallback.
- A cycle5 RED pure5failed/78passed: relational engine/provider version tidak boleh diabaikan. SQL10failed pada PG nyata karena kolom belum ada (`42703`); types store passed. GREEN schema + row version guards telah diizinkan; main belum menerima/menjalankan kandidat schema.
- B baseline v2 RED grand_total150000 vs180000 dan missing original/net shipping. Kandidat awal full suite1failed/111passed karena additive null fields mengubah response legacy. Typecheck worktree awal gagal dependency nested Better Auth belum terhubung (environment), bukan feature error.
- B review1 RED8failed/1passed: explicit version null dianggap legacy dan unknown expected edit version mencapai mock network. Fix A/B/C sudah direcheck:121 tests existing/version regression passed.
- B review2 RED6failed/121passed: returned IDs belum di-await persist sebelum independent GET. Optional runtime hooks `onSalesOrderId`/`onInvoiceId`/`onPaymentId` sedang diimplementasikan setelah izin GREEN. Hooks tidak menjadi persisted DTO/JSON; failure wajib ambiguity tanpa verification GET/retry, dengan known IDs tetap tersedia.

Context7 checkpoint: `/drizzle-team/drizzle-orm-docs` — exact numeric string, `$type` compile-time saja, PostgreSQL transactions; `/vitest-dev/vitest` — `test.each`, literal assertions, throw/reject; `/vercel/next.js` — Route Handler JSON/status/headers. Installed Next.js Route Handler docs juga dibaca. Source library lain harus dicek sebelum API baru digunakan.

## Wave berikut — review schema dan integrasi provider

Main menerima component B setelah127 tests client + types store passed (`discounts-t01-provider-final.log`, `discounts-t01-provider-types-final.log`) dan mengintegrasikan tepat3 file ownership ke root. Pure A83 tests + types store passed; push schema disposable dan10 SQL tests passed. Review schema menemukan gap yang belum dicakup: SQL NULL semantics currency, versi legacy000, dan guards negatif/NaN pada reused/new line money. A mendapat satu targeted follow-up test-first; generated SQL menunggu perbaikan, bukan hand-edit.

| Lane | cwd / isolation | Exclusive ownership | Gate / independensi |
| --- | --- | --- | --- |
| A follow-up | Worktree utama | Schema orders + SQL test + pricing reader bila diperlukan | Tighten invariant yang sudah approved, tanpa feature baru. |
| C — provider settlement | `../discounts-provider-01` | Sales lifecycle/operations/settlement + tests; gateway additive invoice/payment fields bila dibutuhkan + tests | Durable returned-ID persistence, immutable payable/identity checks dan GET-only recovery; tidak menulis mirror/checkout/schema. |
| D — channel mirror | `../discounts-mirror-01`, detached `d96bdf1` | `jubelio-channel-mirror.ts`, `.test.ts`, `.db.test.ts` | Expected envelope v2 pre/post edit+recovery dan ID/money preservation; memakai API gateway B yang sudah stabil, tanpa lifecycle/checkout/schema edits. |

C/D memiliki mutable files terpisah di isolated worktrees; A tidak menulis backend files tersebut. Handoff diffs non-commit direview/diintegrasikan main. Setelah A selesai, checkout/UI writer dapat memakai root; C/D tetap isolated.

### Hasil schema dan lingkungan terbaru

- A targeted follow-up selesai; source constraints diperbaiki. `db:push` terhadap DB disposable awal **tidak** mengganti definisi CHECK yang bernama sama. Diagnosis main: `pg_get_constraintdef` masih menunjukkan definisi lama; installed `node_modules/drizzle-kit/bin.cjs:29346` memproses `alteredCheckConstraints` hanya jika `action !== "push"`. Bukan alasan mengubah expected test atau menjalankan db:migrate dev.
- Main membuat **database disposable baru** `marketplace_discounts_test_20261019_v2`, push schema dari nol, lalu24 SQL tests passed (`discounts-t01-schema-fresh-green.log`). Database awal dipertahankan untuk diagnosis. Semua validation berikut memakai URL **v2** secara eksplisit.
- Seed demo v2 passed; types store/admin passed. Generated SQL audit `packages/db/drizzle/0034_loving_nocturne.sql` + snapshot/journal dihasilkan drizzle-kit dan direview main, tidak hand-edit; `db:check` passed. Migration hanya menambah columns/index/CHECK terkait snapshot uang; versi default0, tanpa backfill.
- C RED latest realPG:11failed/1passed/1skipped pada13 tests; legacy characterization passed, v1 fixtures sah. Environment provider account/type dikontrol oleh test. Provider intent2 harus konsisten dengan immutable order snapshot1/engine1/provider2; legacy000+intent2 bukan pasangan sah. GREEN implementasi sudah diizinkan.
- D pure25passed; DB RED6failed/92passed/1skipped(99) pada propagation expected envelope/unknown-before-GET. Kandidat wiring direcheck main:2 files123passed/1skipped(124), types store passed (`discounts-t01-mirror-final.log`, `discounts-t01-mirror-types.log`). Satu skip adalah placeholder blocker environment; tests PG aktual dijalankan. Belum diintegrasikan: review menemukan resolver lokal mirror perlu konsisten dengan decoder persisted-request C (legacy dengan field shipping baru tidak boleh silent-drop, dan arithmetic/versi dari stored records tidak boleh berbeda). Konsolidasikan dalam targeted integration follow-up setelah API decoder C tersedia; jangan mengedit mirror dari lane C.

### Lane E — checkout baseline end-to-end

Setelah A selesai, worktree utama dialokasikan ke writer E untuk checkout/quote/cart→snapshot→payment/repayment/detail store/admin serta UI/E2E baseline ticket01. File provider lifecycle/operations/settlement/client/mirror tetap milik C/D dan tidak boleh diedit E. Prefactor sempit diperbolehkan: pindahkan pure pricing implementation ke `packages/db/src/versioned-pricing.ts`, pertahankan store re-export/API/tests, agar admin memakai module shared tanpa runtime DB package. Kontrak types/API tetap sama.

E run `65b7769d-1daa-478c-a52c-8407782495c9` menggunakan `openai-codex/gpt-6.1-sol:medium`, edit-only di root. Root kini dimiliki E; jangan overwrite pure helper/checkout/UI files saat mengintegrasikan C/D.

Fakta tambahan external seam yang diverifikasi main: `createSnapPayment` di `apps/store/src/lib/midtrans.ts` selalu memakai SDK; `MIDTRANS_MOCK_API_BASE_URL` sebelumnya hanya GET status, jadi config mock existing belum menangkap payload Snap create. E mendapat tambahan ownership sempit midtrans.ts/.test.ts + POST mock server, test-first. Adapter harus E2E flag eksplisit, nonproduction, HTTP loopback-only, reject invalid/missing URL/production tanpa SDK fallback, fetch redirect error/timeout; production SDK path dan builder payload tetap. Installed SDK `lib/snap.js:21–22` dan `apiConfig.js:81–82` mengonfirmasi path `/snap/v1/transactions`; tidak ada provider request nyata. Browser RED pertama berhenti pada cart/version assertion sebelum payment.

Context7 checkpoint UI slice: `/colinhacks/zod` — `z.strictObject`, array max, `superRefine` duplicate IDs, default `z.object` strips unknown; `/microsoft/playwright` — `context.request` berbagi cookies browser, `getByRole`/`toHaveText`, `testMatch` perlu mencakup spec baru di config global/project. Existing React hook API tidak berubah; layout mengikuti shared UI existing.

## Checkpoint integrasi berikutnya

- C targeted follow-up `d127ec6a-f288-49d3-922d-1223ebe78e83` memperbaiki ejaan DTO association `salesorderId` (bukan `salesOrderId`), expected numeric storage `196500.00`, dan CAS first-handle untuk SO/invoice/payment. RED5failed/20passed/2skipped; recheck8files196passed/1failed/2skipped, types store passed (`discounts-t01-settlement-final.log`, `discounts-t01-settlement-types-final.log`). Satu failure berasal dari demo seed, bukan perubahan lifecycle: confirmed completed-order operation punya holdAccountedAt NULL dan stock row tidak ada, sehingga global recovery fail closed dengan `Cannot account confirmed hold: stock row missing`. Main mendiagnosis lewat SQL terbatas dan source seed; jangan melemahkan guard atau skip test.
- C runtime/expected decoder/client+tests telah diintegrasikan root (7 files). D follow-up `8df585b4-5268-4b28-bd0c-451d1010a57b` memakai decoder C yang sama, memvalidasi pasangan order snapshot+intent sebelum gateway dan menghapus resolver uang ad-hoc; GREEN2files129passed/1skipped, types store passed. Tiga file D juga diintegrasikan root.
- E Snap adapter/mock HTTP GREEN64tests (2files). Browser actual UI→Snap loopback→landing RED karena order detail masih versi000, bukan112; bukan environment/provider failure (`discounts-t01-checkout-persist-red.log`). E mendapat GREEN persistence/readers. Browser strict-bounds RED duplicated IDs mendapat404 bukannya400; mock shipping RED tidak membawa original/net; keduanya GREEN diizinkan. Main membaca Markdown reports, tidak membuka PNG.

### Lane F — retention + fixtures + seed

Run `2e3d0f1f-d192-447e-bf8a-2418afa6d137`, `openai-codex/gpt-6.1-sol:medium`, isolated `../discounts-retention-01` detached d96bdf1. Ownership: FK/retention schema orders/Sales/channel, seed-cleanup(+test), NEW `order-retention.db.test.ts`, bounded fixture teardown, dan **hanya bagian ledger demo** seed.ts1430–1540. Root E tetap memiliki config seed entry; baseline seed F tersimpan `%TEMP%/discounts-retention-seed-baseline.ts` untuk patch disjoint, jangan overwrite seluruh seed.ts.

F SQL RED8failed/3passed(11): parent deletes cascade padahal harus23503; variant/catalog NOACTION dan address SETNULL sudah pass. FK candidate kini main push dari **cwd F**, SQL11passed (`discounts-t01-retention-push.log`, `discounts-t01-retention-green.log`). Saat checkpoint ini database v2 sudah memakai RESTRICT tetapi source root belum menerima FK F; root `db:push` sementara ditahan agar tidak mengembalikan cascade. **Update: handoff F kemudian diintegrasikan ke root; schema root kini sudah cocok dengan FK v2.** Generated SQL0035 sudah dibuat melalui drizzle-kit, bukan manual (lihat checkpoint lanjutan).

Seed-cleanup RED1failed/2passed karena Sales/channel evidence belum ada pada FK-order list; GREEN diizinkan. F juga memperbaiki demo historical holdAccountedAt untuk menutup regression seeded recovery di atas. Hanya main boleh seed ulang database disposable v2 sesudah perubahan diintegrasikan.

C/D kini terminal, sehingga cleanup-only ownership tiga test berikut dipindah ke F setelah final source disalin ke F: `jubelio-sales-versioned.db.test.ts`, `jubelio-sales-operations.db.test.ts`, `jubelio-channel-mirror.db.test.ts`. Runtime C/D read-only dalam F; baselines tiga tests disimpan `%TEMP%/discounts-retention-baseline-<filename>`. Jangan menerima diff copied runtime/preexisting baseline sebagai perubahan F. Root E mengurus teardown NEW `versioned-checkout-mock.spec.ts` sendiri; F boleh menyesuaikan teardown mock specs lama saja.

## Integrasi berikutnya setelah kandidat lolos main review

Ticket01 masih membutuhkan **aplikasi end-to-end**, bukan selesai dengan helper/schema/gateway:

1. Main review dan verifikasi A/B; generate SQL melalui drizzle-kit (tidak hand-edit), push hanya disposable, SQL tests + types.
2. Partition integrasi dengan file ownership eksklusif/worktree terpisah: checkout/quote/cart/payment/detail writer versus provider lifecycle/operations/settlement/mirror writer. Gunakan handoff signature aktual A/B. Tidak memakai `order.subtotal` sebagai payable v2 pada satu recovery branch pun.
3. Provider writer menghubungkan awaited returned-ID hooks ke durable operation ledger (confirmed order pointers hanya sesudah verification). Invoice/payment checks memakai expected intent/snapshot + exact linkage/money. Unknown version fail closed. Mirror menerima expected shipping envelope dan membandingkan expected payable, bukan legacy grandTotal==subtotal.
4. Checkout writer mengikat gate default0, snapshot ke header/items/delivery, authoritative quote dan Midtrans, immutable repayment/readers store/admin, bounds sebelum provider activity. Operasional tetap0; test gate1 hanya DB disposable. Tidak membuka Offer/Markdown atau request-wide idempotency ticket02 lebih awal.
5. Integrasi akhir mencakup seed/cleanup/retention fixtures, mock provider adapter asli, actual HTTP/Playwright pickup+delivery/detail/repayment, docs feature/API/testing/deployment yang perlu. UI tidak menyajikan service fee sebagai charge.
6. L0/L1 per slice, L2 serial unit + affected mock E2E. Catat acceptance F02/T06/P01/P02/D02/D03 yang benar-benar terbukti di Answer01; unresolved gates tetap blocked/claimed. Hanya setelah01 resolved, claim02 dan06 untuk parallel frontier berikut.

Tidak ada acceptance ticket lengkap yang dinyatakan pass/resolved pada catatan ini. UAT staging, release rehearsal target dan izin operasi tetap external gates; jangan mengarang R01/launch outcome atau menghapus plan sebelum semua gates selesai.

## Checkpoint setelah jeda usage limit

- F selesai dan main mengintegrasikan20 owned files; perubahan seed ledger diterapkan sebagai patch disjoint dari `%TEMP%/discounts-retention-seed-baseline.ts`, bukan overwrite konfigurasi E. SQL `0035_short_lethal_legion.sql` dihasilkan dan direview:9 FK diganti menjadi RESTRICT, tanpa perubahan schema lain. `db:check` passed.
- Seed ulang **hanya disposable v2** berhasil. Regression9files154passed/3skipped (`discounts-t01-retention-fixtures-green.log`) mencakup seed cleanup, recovery/holds/create marker/ledger/mirror serta shipment admin. Kegagalan recovery yang disebabkan historical seed tidak muncul lagi. Skip dilaporkan, bukan bukti acceptance.
- E terakhir berhenti karena `Codex error: The usage limit has been reached`, run `65b7769d-1daa-478c-a52c-8407782495c9`, pada20m47s. Native artifacts menandai runner terminal dan `resumeDisposition: resumable`; tidak ada writer E yang masih berjalan. Perubahan parsial tetap di root; belum ada final handoff/acceptance.
- Setelah pemilik meminta lanjut, main memverifikasi source parsial tanpa mengedit kode: `verify:types:store` PASS; `verify:types:admin` PASS; focused `checkout-input.test.ts` + `delivery-quote.test.ts`:2files47passed. Logs `/tmp/discounts-resume-types-store.log`, `discounts-resume-types-admin.log`, `discounts-resume-checkout-focused.log`. Ini evidence untuk source terbaru, bukan klaim checkout/UI end-to-end sudah green.
- Native tools `subagent`/`subagents_enable`/supervisor tidak diekspos pada daftar tool sesi lanjutan. Tidak memakai CLI/direct-provider workaround dan tidak mengambil alih implementasi karena pemilik membatasi main pada review/testing. Development berikut menunggu pemulihan delegation tools/kuota atau persetujuan eksplisit untuk perubahan mode eksekusi.
- Scope tersisa ticket01: browser checkout pickup/delivery dan paid provider lifecycle nyata melalui mock HTTP; detail store/admin dan repayment immutable/unknown versions; source/request/quote bounds; dokumentasi enduring serta L2/final review. Ticket02/06 belum claimed sebelum01 resolved.
- Pemilik memilih mempertahankan subagents dan akan AFK: **jangan gunakan ask_user_question lagi selama AFK**. Tidak ada izin mengambil alih coding pada main. Konfigurasi user sudah memiliki package pi-subagents/default child Ollama, tetapi native delegation tools belum diekspos; tidak ada child baru yang berhasil diluncurkan.
- Main memanfaatkan review/testing yang masih tersedia: full serial unit115files112passed/3failed,1311tests passed/2failed/3skipped (`/tmp/discounts-resume-batch-unit.log`). Dua assertions schema masih menuntut CASCADE lama; satu suite gagal teardown shipment-tracking karena provider evidence belum dihapus sebelum orders. Jangan rollback RESTRICT atau melemahkan guard.
- Browser versioned checkout3tests:1passed/2failed (`/tmp/discounts-resume-checkout-browser.log`), failures hanya row Biaya Layanan Rp0 yang masih tampil pada checkout/account detail. Assertions snapshot112, Snap/SO nominal dan immutable repayment pada pickup sudah dilewati; ini bukan bukti paid v1 settlement/delivery.
- Affected legacy mock E2E5specs18passed (`/tmp/discounts-resume-legacy-mock-regression.log`); jangan rerun tanpa source terkait berubah. Tidak ada real-provider traffic.
- Durable cold-start packet berikutnya: [checkout-recovery.md](checkout-recovery.md), berisi temuan dengan file/line, evidence dan scope tersisa. Main tidak mengubah app/tests atau mengklaim tool delegasi aktif. Semua ticket tetap belum resolved.

## Sesi pemulihan native delegation — 21 Oktober 2026

- Pemilik mengulangi izin implementasi seluruh tickets, parallel development/test oleh subagent, dan main hanya review/integrasi/eksekusi validation. Native delegation kini tersedia; `subagent action:status` awal mengonfirmasi tidak ada run aktif. Tidak ada commit/push/provider nyata/remote/deployment.
- Inspeksi status/source:01 claimed dan parsial;02–13 open. Jangan melewati prerequisite01. Database disposable v2 dapat diakses dan `discounts.contractVersion=0` sebelum validation.
- Workflow `e1eee1e8-85c6-4457-8d38-2dc298ae6104`: root checkout UI/E2E owner `e0f9b711-d647-460f-b0a0-cc422a967fc9`; isolated fixture owner `d5346ed6-d80e-46ad-857d-2d22237b61fe` di `../discounts-fixtures-resume`. Main tidak mengubah app/tests secara langsung.
- Fixture handoff direview dan tepat3 test files diintegrasikan: schema Sales/channel expected RESTRICT dan shipment tracking teardown exact owned IDs melalui helper retained fixtures. GREEN main: `DATABASE_URL=<disposable-v2> npm run verify:unit:slice -- packages/db/src/schema/jubelio-sales.test.ts packages/db/src/schema/jubelio-channel.test.ts packages/db/src/shipment-tracking.test.ts` → **3files20tests passed**, tanpa skip (`/tmp/discounts-resume2-fixture-unit.log`). Historical RED tetap log sesi sebelumnya; source FK tidak dilemahkan.
- Review main menemukan admin detail `apps/admin/src/app/api/admin/orders/[id]/route.ts` belum men-select versions/snapshot atau memakai `readOrderPricing`; tambahan public assertion diminta pada checkout writer sebelum backend fix.
- Lane docs `b9f36d18-9ca6-48ae-afa8-a0d6841f0685` isolated `../discounts-docs-resume`, docs-only baseline versioning/PPN/delivery/provider/API/testing, belum diintegrasikan.
- Lane paid HTTP test `97d69f06-4674-421b-af85-54fff6e337c8` memakai fixture worktree yang owner sebelumnya sudah terminal; hanya NEW `e2e/store/versioned-settlement-mock.spec.ts`, pickup tracer test-first, runtime/config read-only. Main perlu review, integrasikan file dan delegasikan penambahan `testMatch` sebelum RED. Tidak ada writer bersamaan pada cwd yang sama.
- Context7 checkpoint sesi: `/microsoft/playwright` — `context.request` shares cookie jar, JSON `data`, HTTP status; `/vercel/next.js` — dynamic Route Handler `params` Promise wajib await, `NextResponse.json` status; `/vitest-dev/vitest` — async `beforeAll`/`afterAll`, awaited rejection assertions. Conditional JSX UI dan fixture helper tidak memperkenalkan external API baru.
- Persiapan lane sempat gagal karena Python tidak tersedia setelah `git worktree add`; tidak ada child diluncurkan pada state gagal. Main menyelesaikan copy bounded memakai bash `cp`, tanpa dependency install/commit. Worktrees/salinan baseline bukan feature diffs yang boleh diintegrasikan seluruhnya.
- Gate main setelah integrasi fixture: `npm run verify:types:store` PASS (`/tmp/discounts-resume2-types-store.log`); `DATABASE_URL=<disposable-v2> npm run verify:batch:unit` → **115files passed;1313tests passed,3skipped** (`/tmp/discounts-resume2-batch-unit.log`,65.81s). Tiga skip adalah placeholder readiness environment pada Sales versioned/operations/channel mirror; actual PG behavior suites dijalankan. Jangan ulang batch ini tanpa source/fixture terkait berubah.
- Handoff root checkout diterima: fee rows conditional, delivery UI→quote/Snap/detail/repayment/admin contract + unknown snapshot fail-closed tests ditulis. Main types admin PASS (`/tmp/discounts-resume2-types-admin.log`). Browser RED pertama4tests2passed/2failed: kedua persistence tests berhenti pada CDP response body setelah cross-origin Snap navigation, bukan money mismatch (`/tmp/discounts-resume2-checkout-browser-red.log`). Markdown dibaca, PNG tidak dibuka.
- Root test-observer follow-up5094 menambah response-event read dan mendaftarkan `versioned-settlement` pada kedua `testMatch`. Main mereview dan mengintegrasikan NEW settlement spec dari lane97d. Focused browser recheck3tests3failed (`/tmp/discounts-resume2-browser-contract-red.log`): response-event timing masih race, sedangkan paidHTTP benar-benar mencapai webhook namun tertahan karena mock payment association tidak menyediakan `grand_total`/`due` yang verifier v2 wajibkan (`Payment line grand total undefined ...150000`). Verifier produksi tidak boleh dilonggarkan.
- Main menghentikan pendekatan menebak timing dan memverifikasi Context7 `/microsoft/playwright`: `route.fetch` meneruskan real request, `route.fulfill({response})` menyalin status/header/body original tanpa perubahan. Root owner25268286 hanya memperbaiki test capture deterministik sebelum browser menerima response. Tidak ada response bisnis buatan atau secondary POST.
- Isolated mock ownerb2f49c6c di fixtures lane menulis ONE HTTP mock regression test-only (payment association grand_total/due/linkage), menunggu main RED sebelum server implementation. Runtime mock/source reader tetap guarded.
- Docs recheck07f927ee memperbaiki copy-staleness dari main packet, nama kolom, seeder explicit0, dan menolak koreksi link main yang keliru: `../../plan` memang benar dari `docs/features/`. Docs candidate belum diintegrasikan, admin decoder masih gap riil. Final docs perlu diselaraskan setelah runtime fixes diterima; jangan menganggap keterbatasan copy worktree sebagai gap kode root.
- Passthrough capture252 berhasil: pickup persistence browser PASS; delivery melalui seluruh quote/Snap/detail/repayment money assertions, kemudian fixture sign-in salah memakai email endpoint untuk username. Auth fixture63/cee diperbaiki dari proven prior art; berikutnya own-branch admin mendapat404 yang benar pada synthetic delivery branch. Persona fixture620 diganti HQ all-branch dan explicit own-branch404 assertion ditambahkan (RBAC tidak dilemahkan).
- Main RED authorized admin decoder akhirnya tercapai: HQ UI/no-fee benar, HTTP admin response tidak membawa112/snapshot (`/tmp/discounts-resume2-admin-decoder-red.log`). Writer rootdf95b062 kini hanya admin route paired decoder + tiga docs admin-gap paragraphs; money projection dari shared pure decoder, scope checks dipertahankan.
- Mock payment RED unit1failed34passed (`/tmp/discounts-resume2-mock-payment-unit-red.log`), GREEN candidate566 direview main dan2files diintegrasikan. Enrichment GET association dari CURRENT invoice store untuk salesorder_id/grand_total/due, guard POST/verifier produksi tidak disentuh. Main unit **35passed** (`/tmp/discounts-resume2-mock-payment-unit-green.log`).
- Main paid pickup HTTP E2E **1passed** (`/tmp/discounts-resume2-paid-pickup-browser-green.log`): Snap166500, SO/invoice/payment150000, due0/account2/type0/linkage/snapshot112 dan duplicate callback no duplicate writes. SMTP disabled menghasilkan expected email failure log (bukan bukti email delivery); informational mock channel marker/mirror belum dimodelkan penuh. Tidak ada provider nyata.
- Lane fixtureb3f7cf87 kini authoring hanya tambahan ONE paid-delivery test pada versioned-settlement spec (customer196500/provider180000), runtime read-only, menunggu main review/run.
- Docs9files dari lane07 direview main dan diintegrasikan, local link targets semua9docs tersedia; docs API400vs413 dibetulkan saat review. Default gate explicit0 diselaraskan seed, legacy vs versioned dibedakan. Main tidak menulis app/tests; integrasi hanya file ownership dan docs corrections.
## Penutupan baseline01 dan frontier02/06

- Root admin paired decoderdf95 direview main dan GREEN: types admin PASS; delivery UI/Snap/detail store+HQ/admin version112, own-branch404, repayment immutable dan unknown JSON payload version failclosed tanpa provider activity PASS. Paid delivery HTTP180000 juga PASS pada run2tests (`/tmp/discounts-resume2-admin-delivery-browser-green.log`). Pickup paid sebelumnya PASS tidak diulang.
- Final full unit setelah perubahan admin/mock: **115files passed;1314tests passed,3skipped** (`/tmp/discounts-resume2-t01-batch-unit-final.log`,61.65s). Focused lint8storefiles+2adminfiles PASS. Source/schema tak berubah sesudah run, jangan rerun unit tanpa perubahan terkait.
- Affected mock regression5specs:16passed1failed karena BETTER_AUTH_SECRET tidak disediakan env developer, internal order-complete guard benar menolak403. Main menelusuri HMAC admin/store dan memeriksa hanya keberadaan/equality secret (tanpa mengungkap nilainya). Test-only config9e214 menyediakan satu shared deterministic secret≥32char pada webServer store/admin; tidak ada auth/guard/env nyata/deployment diubah. Focused failing pickup completion rerun **1passed** (`/tmp/discounts-resume2-pickup-regression-green.log`);16passed lain dicatat, tidak diulang.
- Ticket01 **resolved** dengan9criteria checked dan Answer traceable; F02/T06/P01/P02/D02/D03 hanya baseline tanpa promo. Standard live-provider E2E, build/rehearsal/UAT/launch tetap gate13/izin tersendiri, bukan diklaim pass. Gate disposable kembali0.
- Ticket02 dan06 **claimed**, user authorization tetap request implementasi semua tickets. Worktrees manual baru `../discounts-checkout-02` dan `../discounts-offers-06` detached d96bdf1 + snapshot reviewed dirty01. Baseline patch `/tmp/discounts-t01-frontier-baseline.patch`; untracked source feature disalin bounded, bukan commit dan bukan overwrite user config.
- Workflow73f82a9c stage test-first:02 owner hanya NEW checkout-review mock spec+testMatch;06 owner hanya catalog.test.ts untuk public global discounts/discount_capacity permissions. Keduanya diminta stop setelah one tracer RED candidate, bukan menulis seluruh suite dahulu. Main review/integrasi/testing berikut.
- Kontrak wire02 stagepreview dalam handoff: body existing pickup fields + promoSelection:{kind:"none"}, no requestKey on preview; success.data:{pricing,reviewToken,expiresAt,contextFingerprint}. TTL10menit/clientbinding/authoritative totals mengikuti approved spec. Signature/counter/request-wide replay belum diimplementasikan dari test pertama.
- Context7 frontier: /drizzle-team/drizzle-orm-docs — transaction callback/return, check(name,sql), compositeforeignKey+upsert; /colinhacks/zod resolved, strictObject/discriminated fields tetap signatures confirmed checkpoint01. /microsoft/playwright — webServer.env passes/merges explicit string variables; no real auth secret reused in mock.
- Plan tetap In Progress; fitur3 mulai In Progress karena06.03–05/07–13 masih open sesuai dependencies; tidak ada klaim seluruh scope selesai.
- Ticket06 catalog RED: main review/integrasikan hanya `packages/db/src/rbac/catalog.test.ts`, lalu `npm run verify:unit:slice -- packages/db/src/rbac/catalog.test.ts` → **2failed23passed** (`/tmp/discounts-t06-catalog-red.log`), tepat missing discounts/capacity global entries. Ini expected TDD frontier, bukan baseline01 regression yang disembunyikan.
- Follow-up component06 `a2ade414-d894-45c3-a2e5-4f9aa8288b28` isolated offers lane: GREEN catalog+exhaustive matrix labels saja, lalu ONE SQL test-only `discount-grants.db.test.ts` sebelum schema CHECK diubah. Main perlu integrate3files, run focusedcatalog/typesGREEN dan SQLRED; jangan menerima child report sebagai pass.02 preview test owner masih berjalan pada workflow73f82a9c; perlu read handoff+explicit testMatch registration+browserRED sebelum implementation.
- Ticket02 preview candidate3ae5 direview dan dua ownedfiles diintegrasikan (NEW checkout-review mock spec + kedua testMatch). Main browser RED **1failed**, HTTP404 expected200 (`/tmp/discounts-t02-preview-red.log`); Markdown dibaca. Writer0667bc93 kini GREEN pickup preview route+signing helper saja, no DB business write/provider call/UI/requestreplay; signature tampering/client binding belum diklaim terbukti dari token presence.
- Ticket06 componenta2 direview: catalog.ts + grant-matrix labels diintegrasikan. Main catalog **25passed** (`/tmp/discounts-t06-catalog-green.log`), types store/admin PASS (`/tmp/discounts-t06-catalog-types-{store,admin}.log`). NEW SQLtest candidate belum dieksekusi: review main menolak Date.now namespace/prefixwide cleanup dan guard yang hanya mengecek fixtureprefix, bukan database. Safety owner942a824e hanya memperbaiki exact2roleIDs, disposableURLguard dan finallypoolclose sebelum SQLRED. Schema rbacs masih unchanged; tidak ada grant baru pada seed/customexistingroles.
- SQL fixture safety942 diterima; main SQLRED v2 **1failed2passed** (`/tmp/discounts-t06-grant-sql-red.log`), tepat namedCHECK lama. SchemaGreen733 direview dan diintegrasikan; main `db:generate` menghasilkan **0036_volatile_gorilla_man.sql** + meta/journal (hanya drop/recreate named module-scope CHECK); SQL tidak hand-edit. `db:check` PASS (`/tmp/discounts-t06-rbac-db-check.log`).
- Main membuat DB kosong baru **marketplace_discounts_test_20261021_v3** tanpa mengubah DB existing, push schema fresh PASS (`/tmp/discounts-t06-fresh-push.log`). SQL grants **3passed** di v3 (`/tmp/discounts-t06-grant-sql-green.log`). v3 **belum diseed** pada checkpoint ini; browser02 masih memakai seeded v2. Semua unit/SQL batch berikut setelah fresh seed harus memakai v3 agar CHECK0036 benar, bukan db:push yang gagal mengubah namedCHECK di v2.
- Seed defaultsRED main **1failed6passed** (`/tmp/discounts-t06-seed-red.log`), missing4freshHQglobal grants. SeedGreen kini child workflowc603 stage t06-seed-green, ownership seed-defaults.ts/test+RBACdocs, bukan auto-grant roleexisting.
- Parallel pure Pricing component06 memakai cwd lama `../discounts-docs-resume` yang docs ownernya sudah terminal, ownership NEW discount-pricing.test.ts/implementation saja. TracerL325 direview dan diintegrasikan, main RED missingmodule (`/tmp/discounts-t06-fixed-pricing-red.log`). Green evaluator child workflowc603 t06-fixed-pricing-green hanya fixed-goods17000 example; module public evaluatePricing, BigInt/largest-remainder, no actualredeem/provider.
- Preview02 candidate0667 route+helper+test diintegrasikan setelah review. Main typesstorePASS (`/tmp/discounts-t02-preview-types.log`), publicpreview **1passed** (`/tmp/discounts-t02-preview-green.log`,v2). Docs candidate belum diintegrasikan: packet main sebelumnya salah menyebut consistent400 untuk oversizedbody; spec mewajibkan413. Child workflowc603 t02-preview-bounds-red hanya ONE publicbody413test. Review juga meminta query scoped selectedIDs≤50 (bukan seluruhcart) dan rejectnullbranch; sourcefix menunggu RED. Ini belum complete02 atau proof signature verification/replay/admission.
- SeedGreen eef diterima:4HQglobal grants+exact oldexpectedlist di2files diintegrasikan, Admin/SystemOwner/custom role migration unchanged. Main focused seed7tests +pricingtracer1 **8passed** (`/tmp/discounts-t06-seed-pricing-green.log`); seedrolesintegration3 sempat FAIL karena v3 masih kosong (main belumseed, bukan bugproduction). Main `SEED_MODE=demo DATABASE_URL=<v3> npm run db:seed` PASS (`/tmp/discounts-t06-v3-seed.log`), lalu ONLY failedseedintegration **3passed** (`/tmp/discounts-t06-seed-integration-green.log`). Mulai titik ini gunakan URLv3 untuk validation selanjutnya; v2 baseline dipertahankan.
- Main review menemukan nuance existing ensureInitialRoles: freshHQdefaults juga dilengkapi pada systemHQexisting bila operator menjalankanseed/Ownerbootstrap, tetapi tidak customroles dan tidak lewatmigration0036. Docs RBAC ditulis Indonesia saat integrasi, bukan klaim bahwa helperrepair berubah atau grantlive sudahditerapkan.
- PricingGreen c420 direview main dan NEW discount-pricing.ts diintegrasikan. PublicevaluatePricing fixed_goods paramsVersion1 +clipwholeline/largestremainder/BigIntceil/snapshotdecode, tanpa DB/provider/usage. Reviewcoverageed1 author tests ONLY, main **13passed** (`/tmp/discounts-t06-pricing-review-green.log`): multibarisliterals/reverse/tie/clip dan7invalidshapes. Tidak ada proofRp0payment/provider atau futurebenefits.
- Bodybounds02 publicRED **1failed**, actual400 underlyingStatus413 (`/tmp/discounts-t02-preview-bounds-red.log`), Markdown dibaca. Green+nextbranchRED writer43f24917 isolatedcheckout lane (previewroute/test/docs) masih berjalan; source 413fix/selectedIDs query dan nullbranchtest perlu mainreview/runs. Jangan menyebut02resolved.
- Ticket06 nextpublicdraftcreate+samekeyreplay test-only ownercfce2def isolatedofferslane, hanya NEW e2e/admin/discounts-admin-mock.spec.ts. Belum ada schemaOffer/receipt atau adminendpoint. Testconfig laneofferstale: jangan copy configdari06 ke root karena bisa menghapus registration checkout-review milik02; registerdiscounts-admin melalui bounded integration implementer nanti.
- Shared package typecheck `npx tsc -p packages/db/tsconfig.json --noEmit` PASS (`/tmp/discounts-t06-package-types.log`). Belum ada fullL2unit baru untuk02/06; baseline01 latestfull1314passed bukan klaim seluruhpartialfrontiergreen.
- Draftadmin HTTPtest cfce direview main, **belum diintegrasikan/dijalankan**: actor/key receipt cleanup kurangscope, bisa menyapu targetactorlain dengan key sama; errorcleanup ditelan warning. Safetyownerfc29c7e5 kini hanya memperbaiki exact actor_identity=hqId+requestKey+verifiedtargetreceipt, errorsurface dan finallyrestoregate/closepool. Rootconfigowner2249c652 hanya registerdiscounts-admin pada2testMatch tanpa menghapuscheckout-review. Setelahdua terminal, mainreviewcopytest+RED404v3 lalu handoffdomain implementation.
- Koreksi board:43f24917 sebenarnya sudah terminal; receipt completion pernah diterima, tetapi integrasinya tertunda ketika main memproses lane06. Main one-shot status mengonfirmasi terminal (bukan menggandakanwriter), membaca handoff+diff lalu mengintegrasikan route/test/docs02. Full preview v3: **2passed/1failed** (`/tmp/discounts-t02-preview-branch-red.log`): happy+413 GREEN, mixed validbranch+NULLbranch masih200/350000subtot, expected400. Markdown dibaca; response error sempat memuat reviewtoken fixture pada logtest, tidak diklaim aman untuk logsproduksi dan diagnostic diminta redacted. Greenowner21b936bc kini hanya previewbranchguard+safe testdiagnostic.
- Config2249 terminal diterima:dua testMatch sekarang memuatdiscounts-admin DAN checkout-review, semua provider/env/isolation lama utuh. AdminE2Etest safetyfc29 terminal diterima dan ONEownedfile diintegrasikan. Main actualHQHTTP **RED1failed**, create404 expected201 (`/tmp/discounts-t06-admin-create-red.log`); rawHTMLfailurelogpanjang dibatasi saat reviewMarkdown, PNG tidakdibuka. v3gate pulih0;HQdiscountgrants4 diverifikasi tanpa secrets.
- DomaincreateGREEN owner **876869c0-91d6-4eba-b00d-44baf8df55ae**, isolatedofferslane. Scope tightlycoupled atomicdraftcreate/replay/read: onlyschemaOffer+unpublishedrevision+usage0+adminreceipt, sharedschemaexport, adminlocaldbservice+2thinHTTP routes, seedcleanup/demoemptydraft/docs. Tidak ada Benefit/code/Redemption/futureemptytables, publish/simulate/UI/nav atau generatedSQL. Main harus reviewschema/currentpolicylocks/receiptownership, generateauditSQL/pushv3/seed+typechecks+HTTPgreen; worker tidakmenjalankancommands.
- Docs integration warning: offerslane docs/api-reference.md baseline belum memuat preview02terbaru; jangan copy seluruhfile saat876 handoff, ambil hanya additiveadminDiscountsections agar tidakmenghapusdocs02. Rootschemaindex/seedsource juga hanya integrateownedboundedchanges, journal0036 milikmain jangan ditimpa salinanlama.
- PreviewbranchGreen21b direview+2ownedfilesdiintegrasikan. Main typesstore/focusedlint PASS (`/tmp/discounts-t02-preview-final-types.log`, `discounts-t02-preview-lint.log`); publicpreviewv3 **3passed** (`/tmp/discounts-t02-preview-final-green.log`): authoritativepickup/tokenpresence, body413, mixedbranch400. T02 masihclaimed: verifier/replay/admission/delivery/UI belumada.
- Full firstfrontierbatch v3:117files116passed1failed,1331passed1failed3skipped (`/tmp/discounts-frontier-first-batch-unit.log`). Satu failure rehearsal0018 memakai HQ_SEED_GRANTS.length31padahalmigrationhistoris menghasilkan27. Main mendiagnosis/sourceapprovedhistoricalSQL tidakbolehdiubah; owner8687906b mengubahtestONLY keliteral27HQ/6Admin dari0018 +exacttuple/no-newdiscountgrants. Main review/copy ONLYtest, focusedrecheck **10passed** (`/tmp/discounts-t06-historical-migration-green.log`);116fileslain tidakdiulang. Tidak mengklaim satu commandfullgreen yangtidakdijalankan.
- Domaincreate876 kandidat **belumdiintegrasikan** saatreview mendeteksi dua bugSQL: published_complete menerimaNULLcurrency viaSQLNULLsemantics; quota/perclient/usage hardcodedmax1e9menyimpang dari2147483647. Main actualPGtempconstraintcounterexamples direproduksi lalu2assertions **FAIL** danROLLBACK (tidakmengubahdatashared). Worker **6efced27-728d-4b06-a2ec-1206e74f8343** isolatedofferslane kini menambah permanentSQLDregressions+fixschema, serta memperbaiki seedclear BOTH state draft+pointerNULL (CHECKliveotherwisefails) dan demoOffer onlyseedCatalogDependentFixtures. Tidak adafeaturemigrationbaru sesudah0036yangdihasilkanpadasnapshotini.
- Main completedread876 service721lines +schema388lines +thinroutes +seedDiff. Setelah6efhandoff, reviewulangtargetsajadanintegrasikanboundedsource, generateSQLbaru/pushv3/type+unit/seed/E2Ecreate201→replay200→detail200. DocsAPIcandidateOffersstale relatifpreview02: applyadditiveonly. Followupserviceconcerns beforeacceptingwhole06: approvederrorcodes/ID128, transactionwall10s ceiling(currentonlyper-statement5s+lock2s), request-keycanonicalization/parallelreceipt/conflicttests, currentpolicyrevoke/owner/viewerprivacy coverage; janganmengarangcomplete06darisinglehappytracer.
- Context7 draftslice tambahan: /colinhacks/zod z.uuid() RFC9562/4122+strictObject confirmed; /drizzle-team/drizzle-orm-docs onConflictDoNothing+returning; installed PGinsert.d.ts138–141 confirms target?:IndexColumn|IndexColumn[] (docssearchreturnedCockroachexamples, supplementfrominstalledPGtypes). PGselect.types.d.ts60 confirms LockStrength includes share/update/keyshare. No unsafeAPIguessingorchildvalidation.
- Admission preparatory facts main (belumcoding): Caddy staging/production meng-overwriteX-Real-IP+X-Forwarded-For remote_host; Compose store/admin hanya exposeinternal3000/3001, hostports hanya Caddy80/443. Dev/mock directloopback harusignoreforgedforwardheaders; sourcelegacyaddresslimiter bukan PGcounterbaru. Tidak adarate-limiter/checkoutrequestschema atau replayimplemented pada checkpointini. Tidak ada keputusanprodukbaru/operasiremote.
- Context7 /drizzle-team/drizzle-orm-docs dan /microsoft/playwright checkpoints tetap berlaku. Pure evaluator/seed catalog menyentuh repo-internal math/metadata, tidak menambah externalAPI. Main tetap satu-satunya executor validation.

## Ticket 06 resolved — admin Offer lifecycle (sesi lanjutan, 21 Oktober 2026)

- Kontrak error diselaraskan ke spec §5.4: shape/limit dan `activationKind`
  non-public sekarang `400 INPUT_INVALID` (bukan `INVALID_BODY` /
  `UNSUPPORTED_ACTIVATION_KIND`). Spec E2E terbaru dari lane
  `../discounts-offers-06` diintegrasikan ke root dan hijau.
- Schema `discount_benefit` ditambahkan (tepat satu per revision, fixed-goods,
  nominal > 0 Rupiah utuh, params version 1, composite unique untuk FK masa
  depan). Migrasi `0038_empty_george_stacy.sql` dihasilkan drizzle-kit (termasuk
  `checkout_request` ticket 02 yang belum masuk snapshot sebelumnya); `db:check`
  passed. Push + seed hanya ke DB disposable baru
  `marketplace_discounts_test_20261022`.
- Domain diperluas: save draft (revision baru setelah publish), review
  server-bound + fingerprint, publish atomik (receipt + pointer + benefit +
  audit), simulate via `evaluatePricing`, state (enable/pause/archive), policy
  (grant kapasitas + komitmen), usage, history. Receipt replay kini mencakup
  create/publish/state/policy. Semua writer memakai lock order Admin User →
  Role (SHARE) → receipt → Offer → usage dan bounded 2s/5s.
- 11 route admin + UI `/admin/discounts` dan `/admin/discounts/{id}` + link
  sidebar; `discounts-http.ts` menyatukan envelope/error/log. Affordance
  mengikuti policy mirror; server tetap otoritatif.
- Seed demo tetap draft tidak lengkap (tanpa benefit/kuota/budget), gate
  eksplisit `0`; seed-cleanup menghapus receipt → usage → benefit → revision →
  Offer.
- Docs diperbarui: feature `discount-administration.md` (full lifecycle),
  `api-reference.md` (tabel + kontrak 11 endpoint), index `docs/README.md`,
  `docs/testing/README.md`, dan tabel Global Module di `docs/features/rbac.md`.
- Evidence main agent (bukan laporan child): `verify:types:admin` dan
  `verify:types:store` PASS; `lint:admin` 0 error; unit murni 19 passed; real-PG
  9 passed; SQL schema + cleanup 18 passed; E2E mock 3 passed termasuk alur UI
  lengkap (`/tmp/discounts-t06-final-e2e.log`). Full serial unit
  **120 files / 1375 passed / 3 skipped** (`/tmp/discounts-t06-final-batch.log`);
  skip adalah placeholder readiness environment yang sudah terdokumentasi.
- Tidak ada commit/push, provider request, SSH, Docker remote, atau deployment.
  Gate operasional tetap `0`. Redemption/reserve race, percentage/shipping,
  kode manual, UAT staging, dan release tetap di ticket 07/09/10/11/12/13.

## Ticket 02 dipindahkan ke worktree utama (koreksi direktori)

- Pemilik mengoreksi bahwa implementasi ticket 02 harus berada di `worktree/diskon`, bukan lane `../discounts-checkout-02`. Lane tersebut berisi pekerjaan yang belum diintegrasikan/diverifikasi; root hanya punya preview pickup + replay backend.
- Scope disetujui pemilik lewat `ask_user_question`: (1) integrasi bertahap per-slice, (2) pindahkan + docs & env (bucket quote tetap gap terdokumentasi), (3) verifikasi types, SQL real-PG, unit, mock E2E.
- Slice 1 schema: `discount_request_window` + seed-cleanup; migrasi `0040_foamy_hedge_knight.sql` dihasilkan drizzle-kit di root (bukan copy lane), `db:check` PASS, DB disposable baru `marketplace_discounts_test_20261023` di-push + seed.
- Slice 2 lib: `checkout-admission`, `checkout-transaction`, `checkout-delivery-review`, `checkout-recovery`, update `checkout-review`/`checkout-request`/`jubelio-sales-lifecycle`, plus test SQL admission/request. Types store PASS.
- Slice 3 routes/UI: place-order (admission, fingerprint delivery, batas transaksi, rejection finalization), preview delivery, cron sweep, UI preview/requestKey/recovery. Types store PASS; focused unit 8 files/87 passed/2 skipped.
- Slice 4 E2E: spec 02 (18 test) awalnya 11 passed/1 failed karena fixture `insufficient-stock` tidak lagi menghasilkan rejection SO create (mock mengembalikan 500 ambiguity, bukan 4xx). Ditambahkan scenario mock-only `reject-create` (400 pre-apply, tanpa write) + unit test; spec 02 **18 passed**. Regresi gate1 `versioned-checkout`/`versioned-settlement` diperbarui memakai preview+token/`requestKey` dan **6 passed**. Legacy `pickup`/`delivery-order`/`delivery-quote` **27 passed**.
- L2 unit final: **122 files / 1380 passed / 3 skipped** (`/tmp/discounts-t02-final-batch-unit.log`). Lint store file berubah PASS; mock app tidak punya eslint config (pre-existing).
- Slice 5 docs: API reference (preview pickup+delivery, result lookup, admission, status 201/200/202), feature §12, testing README, deployment reference, `.env.example` (`CHECKOUT_TRUST_PROXY`).
- Ticket 02 **resolved** dengan Answer berisi evidence; gap yang tidak diklaim: admission `delivery-quote`, bucket manual-code (ticket 09), T04 promo-specific (ticket 07), UAT/rollout/release (ticket 13). Tidak ada commit/push/provider nyata.
- Lane `../discounts-checkout-02` dibiarkan apa adanya sebagai referensi; tidak dihapus tanpa izin pemilik.

## Ticket 03 resolved — Markdown manual dari admin sampai pembayaran

- Pemilik meminta eksekusi ticket 03 end-to-end dan mengizinkan subagent
  edit-only paralel; pengerjaan dilakukan main agent di worktree utama tanpa
  commit/push/provider nyata. Gate operasional tetap `0`.
- Kontrak: builder pricing menerima Markdown (revision ID wajib saat effective <
  source); helper pure `projectMarkdownPrice`/`computePercentTarget`/
  `validateSetTarget`. Schema `prices.ts` + `0041_even_wong.sql`,
  `0042_mushy_shocker.sql` (CHECK module `prices`); seed demo set/fallback/
  restore; seed-cleanup mereset row sebelum revision (siklus FK dihindari dengan
  `UNIQUE(batch_row_id)` tanpa FK balik).
- Admin: stage/detail/apply/history + UI `/admin/products/harga`; apply
  satu transaksi, replay/no-op/restore/stale source/revoke; Global Module
  `prices` dan HQ seed.
- Store: proyeksi SQL+JS identik di katalog/homepage/detail/cart/quote/preview;
  place-order me-revalidasi pointer Markdown (stale → 409 sebelum commit);
  provider create/invoice/payment/mirror memakai gross−disc dan expected payable.
- Evidence: unit+SQL serial **127 files/1429 passed/3 skipped**; SQL baru 14+12+2
  passed; mock E2E penuh **85 passed**; types/lint-fokus/db:check PASS. Gap
  dicatat di Answer: mirror PUT disc end-to-end belum terbentuk
  (`EDIT_SHAPE_INCOMPLETE` informational), homepage carousel belum punya spec
  khusus, live-provider E2E/UAT/release tetap gate terpisah. Lint store penuh
  masih gagal di `Header.tsx` pre-existing (bukan perubahan ticket ini).

## Ticket 07 claimed — Coupon publik fixed-goods pickup

- Pemilik menyetujui rencana S1–S8 dan scope **pickup saja**; pemilihan
  Coupon di checkout delivery tetap milik ticket 11 (slot bersama
  goods/shipping). Penyelesaian target: seluruh acceptance ticket 07, bukan
  subset. Subagent edit-only boleh dipakai untuk development/test authoring;
  main agent tetap reviewer dan satu-satunya eksekutor validation.
- DB disposable aktif dari `.env`: `marketplace_discounts_test_20261024_v2`
  (schema diskon sampai migrasi `0042`). Tidak ada DB/user data lain yang
  disentuh; gate operasional tetap `0`; tidak ada provider request/commit/push.

## Ticket 04 resolved — bulk harga, hasil, dan resume akurat

- Pemilik meminta eksekusi ticket 04 dan memilih: development dipecah ke
  subagent paralel (edit-only, model default agent), review/validasi oleh main,
  resume UI memakai tombol "Lanjutkan" manual, dan picker SKU memakai endpoint
  kandidat baru. Sempat ada override model yang tidak diminta; setelah koreksi
  pemilik, kedua lane dijalankan ulang tanpa override (`ollama/deepseek-v4.1-flash`).
- Kontrak lane A/B/C ada di [handoff-04.md](handoff-04.md) dan
  [handoff-04-seed-docs.md](handoff-04-seed-docs.md). Lane A (root): schema
  `price_change_apply_request`, config limits, stage 1..N, chunked apply,
  kandidat, detail paginasi, test real-PG. Lane B (worktree terpisah
  `../discounts-bulk-ui-04`): dua file baru (bulk client + spec E2E). Lane C
  (root setelah runtime hijau): seed default limit + demo batch staged, cleanup,
  dan docs.
- Main mengintegrasikan dua file lane B, wiring `page.tsx`, dan menambahkan
  `price-change-bulk` pada kedua `testMatch` mock. Review main menemukan dan
  memperbaiki empat hal: mapping SQLSTATE yang dibungkus Drizzle
  (`DrizzleQueryError.cause`) agar lock/statement timeout masuk jalur durable
  re-read; cleanup spec E2E untuk FK apply-request + reset `state`; klasifikasi
  `MARKDOWN_ABSENT` sebagai warning informasional; cleanup test config yang
  hanya menghapus tiga key milik suite dan mengembalikan nilai sebelumnya.
- Test rollback seam ditambahkan main: lock `product_variant` dari koneksi lain
  > lock_timeout → apply mengembalikan 202 dengan row tetap `pending`, tanpa
  revision/audit, lalu resume 5/5 setelah lock lepas. Ini juga membuktikan
  perbaikan SQLSTATE di atas.
- Migrasi `0045_young_shiva.sql` dihasilkan drizzle-kit (hanya tabel baru + FK +
  index), `db:check` PASS. DB disposable baru `marketplace_discounts_test_20261026`
  (push + seed demo), `.env` diarahkan ke DB tersebut; DB lama dipertahankan.
- Evidence main: types admin/store + packages/db PASS; `lint:admin` 0 error;
  focused 4 files 51 passed; DB admin 33 passed (termasuk lock timeout); batch unit
  **135 files / 1518 passed / 8 skipped**; mock E2E bulk+ticket03 **8 passed**;
  re-seed/cleanup termasuk satu apply-request receipt berhasil (ledger dihapus
  sebelum batch). Gate akhir `0`, config limit seeded 1000/5242880/26214400,
  batch demo `staged` 3 pending, 0 revision.
- Ticket 04 resolved dengan Answer berisi acceptance IDs M03/X01/X03–X06/A01/A04/
  D02 dan gap eksplisit (red terpisah tidak direkam, revoke-sebelum-request 403,
  percent+SKU tak dikenal menolak batch, Excel/report = ticket 05, live-provider
  E2E/UAT/release gate terpisah).
- Frontier berikutnya: ticket 05 (blocked by 04 → terbuka) dan ticket 07
  (blocked by 03+06, keduanya resolved → terbuka). Tidak ada klaim UAT/deploy.

## Ticket 07 resolved — Coupon publik pickup dan lifecycle Redemption

- Scope disetujui pemilik: **pickup saja** (promo delivery tetap ticket 11),
  seluruh acceptance ticket 07, subagent edit-only diizinkan dengan main agent
  sebagai satu-satunya reviewer/eksekutor validation. Implementasi di worktree
  utama; tanpa commit/push/provider nyata/remote/deployment.
- Schema: `discount_redemption`, `discount_redemption_event`,
  `discount_client_usage`, `order_discount_allocation`; unique parent
  `orders(id,user_id)` + `order_item(order_id,id)`. Migrasi drizzle-kit dibagi
  dua file karena FK komposit butuh unique parent lebih dulu:
  `0043_dazzling_juggernaut.sql` + `0044_futuristic_phalanx.sql`; `db:check`
  PASS. DB disposable `marketplace_discounts_test_20261024_v2` di-push dan
  di-seed ulang.
- Pure: `discount-eligibility.ts`; Markdown+Coupon dan qty2 di
  `discount-pricing.ts`.
- Store: `discount-availability.ts` + `POST /api/discounts/available`,
  `discount-selection.ts`, `discount-reservation.ts` (lock Offer→usage→client
  usage, re-evaluasi authoritative, insert satu commit), `discount-lifecycle.ts`
  (consume/release/late review). Integrasi `order-finalize.ts`,
  `jubelio-sales-lifecycle.ts` (cancel/reject release, op claim terakhir),
  `checkout-recovery.ts`.
- Preview pickup menerima `promoSelection: none|public`; token mengikat
  Offer/revision/benefit/nominal; place-order menolak kandidat stale/kapasitas
  dengan 409/403 tanpa order parsial. Delivery tetap `none`.
- UI: `PromoSelector` pickup + total/diskon jujur; `promo` status di order
  detail store & admin; notice paid-but-blocked. Seed demo Offer enabled +
  redemption consumed/reserved/released konsisten; docs feature/API/testing/
  seeding/index diperbarui.
- Evidence: types store/admin PASS, focused lint PASS, `db:check` PASS; full
  serial unit **131 files / 1479 passed / 46 skipped**; focused DB (schema/
  availability/selection/reservation/lifecycle) dan mock E2E inti **27**,
  regresi terdampak **18**, coupon **3**, run akhir **7** passed. Gate
  operasional kembali `0`; tidak ada provider/remote/commit.
- Gap tidak diklaim: delivery promo/shipping (11), replacement (08), manual
  code (09), percentage (10), usage privacy (12), UAT/rollout (13), mirror
  settlement POST (pre-existing).

## Ticket 05 resolved — Excel, laporan, dan linked retry

- Kontrak workbook baru: `apps/admin/src/lib/xlsx-container.ts` (ZIP bounded di
  atas `node:zlib`, tanpa dependency parser baru; entry/expanded/cell/text/row
  limit ditegakkan sebelum alokasi, traversal/duplikat/macro/external/enkripsi
  fatal) dan `apps/admin/src/lib/price-workbook.ts` (marker/header/row rules,
  formula & cached value tidak dievaluasi, writer literal inline string).
- Domain: `stageWorkbookPriceChange` parse sebelum transaksi (fatal → 400
  `WORKBOOK_REJECTED` tanpa batch), row error menjadi failed final dengan nomor
  baris sheet; `runStage` dipakai bersama manual/bulk; koreksi wajib
  `parentBatchId` + `origin_row` ke row failed final saja; report/subset/export/
  template dengan grant view + products all-branches.
- Schema: migrasi drizzle-kit `0046_short_pride.sql` + `0047_rainy_captain_cross.sql`
  (action `invalid` hanya pada row failed, SKU kosong hanya failed, target null
  hanya failed). Seed reset tidak lagi memalsukan `pending`; demo batch `xlsx`
  2 row pending ditambahkan. `drizzle-kit push` tidak dipakai (prompt drift lama
  `order_item_order_id_unique` di luar scope) — SQL generated diterapkan persis
  ke DB disposable.
- UI: kartu Excel (template/upload/review/apply/laporan/subset/koreksi) +
  tombol export SKU terpilih di bulk; docs feature/API/testing/seeding
  diperbarui, plus `apps/admin/vitest.setup.ts` yang memuat `.env` sebelum module
  test sehingga suite DB admin tidak lagi bergantung ekspor shell.
- Evidence main: types admin/store/db PASS, lint admin 0 error, `db:check` PASS,
  focused 4 file **71 passed** (serial), batch unit **137 files/1571 passed/
  14 skipped**, mock E2E price-change excel+bulk+manual **14 passed**, `db:seed`
  disposable PASS. Gate akhir `0`, demo batch seed utuh, 0 fixture sisa.
- Gap: benchmark 1000 row/25 MiB dan klaim parser aman universal tidak diklaim;
  suite DB admin wajib serial karena berbagi key config; live-provider E2E/UAT/
  release tetap gate ticket 13/izin terpisah.

## Ticket 08 resolved — penggantian dan gugurnya promo

- Preview pickup menerima `previous` (review token + pilihan lama) dan
  `acknowledgeInvalidation`; server mengevaluasi ulang pilihan lama **dan**
  kandidat, membandingkan total final (PPN ikut) dan mengembalikan
  `replacement`/`requiresIncreaseConfirmation`. Token bertanda tangan menambah
  digest pilihan `p` + flag `inc`/`cwo`; place-order mewajibkan
  `acknowledgements.promoIncrease|continueWithoutPromo` yang mengikat candidate
  fingerprint sebelum order/usage/stock.
- Pure seam baru `apps/store/src/lib/promo-replacement.ts` (dipakai juga nanti
  oleh manual09/percentage10/shipping11). UI: picker di langkah review, dialog
  total naik (Batal mempertahankan), invalidation notice + "Lanjut tanpa promo"
  eksplisit, breakdown tidak menampilkan diskon mati; network error tidak
  mengubah state.
- Evidence: types store/admin PASS, focused lint PASS (global `lint:store` gagal
  pada error pre-existing `Header.tsx`), unit slice 17 passed, batch unit
  **138 files / 1584 passed / 14 skipped**, `discounts-coupon-mock` **8 passed**
  (3 lama + 5 baru), regresi 5 spec checkout/delivery/markdown **36 passed**.
  Gate kembali `0`, fixture E2E bersih. Tanpa schema/seed/migrasi, tanpa
  commit/push/provider nyata/remote/deploy.
- Gap: promo delivery (11), manual code (09), percentage (10), race kuota dua
  akun HTTP nyata (12/13), live-provider E2E/UAT/rollout (izin terpisah).

## Ticket 09 resolved — Manual Promo Code dalam slot bersama

- Schema: tabel `discount_code` (canonical unik global, ownership `manual_only`,
  literal/owner immutable via modul), widen activation kind Offer/Redemption,
  `discount_redemption.code_id` + FK komposit, kind bucket rate `code:*`.
  Migrasi generated `0048_cooing_black_queen.sql` + `0049_dark_vapor.sql`,
  diterapkan ke DB disposable; `db:check` PASS.
- Pure/engine: `packages/db/src/discount-code.ts` (canonical trim+uppercase,
  ASCII 3–64, masking), `discount-eligibility.ts` channel manual memakai
  pemeriksaan/kapasitas bersama.
- Admin: create manual + initial codes, add-code/state endpoint, publish
  `proposedCodes` terikat fingerprint, detail/list masked vs literal editor,
  audit `codeId` + label masked, UI panel kode manual.
- Store: resolve kode (`evaluateSelectedManualCode`), kandidat manual dengan
  `codeId`, reservation mengunci Offer→usage→client→code dan menyimpan tepat
  satu Redemption manual; review token/previous memakai codeId (tanpa literal);
  UI input + Terapkan, invalidation manual memakai jalur Lanjut tanpa promo.
- Rate limit: bucket PG `code:account` 20 / `code:ip` 120 per 60 detik, termasuk
  shape invalid; lintas dua koneksi, forged header dev diabaikan, 503 fail-closed.
- Seed/demo manual (dua kode + Redemption consumed) dan docs feature/API/
  testing/seeding diperbarui.
- Evidence: types store/admin PASS; lint focused 0 error (global store hanya
  error pre-existing `Header.tsx`); batch unit **141 files / 1628 passed / 12
  skipped**; mock E2E coupon+admin **14 passed**; regresi checkout-review+pickup
  **20 passed**; seed PASS; gate akhir `0`, tanpa fixture test tersisa.
- Gap: percentage/manual cross dan shipping manual (10/11/13), usage/privacy
  penuh (12), UAT/staging/live-provider/commit (izin terpisah).

## Ticket 10 resolved — percentage goods dengan cap opsional

- Benefit goods version1 kini punya dua bentuk: `fixed_goods` dan
  `percentage_goods` (`rate >0..100` maks6 digit, `cap_amount` NULL/positif).
  Schema `discount_benefit` + migrasi `0050_polite_lady_ursula.sql` (shape check
  per kind, fixed/rate/cap tidak boleh campur); helper exact `floor/clip/cap`
  dipakai bersama eligibility, admin simulation, preview, place-order.
- Candidate store membawa bentuk benefit asli; snapshot/Redemption menyimpan
  bentuk itu, dan preview/place-order menolak bila nominal eligibility ≠
  `goodsDiscount` (fail closed). Allocation whole-line/largest remainder dan
  provider `disc_amount = sourceLine − netLine` tidak berubah; test drift 1
  Rupiah ditambahkan.
- Admin form/list/DTO/review/publish/simulation + zod draft union mendukung
  percentage; seed demo menambah Offer 10% cap20.000 (gate tetap 0). Docs
  feature/API/testing/seeding diperbarui.
- Evidence: types store/admin PASS, db:check PASS, batch unit **142 files/1669
  passed/12 skipped**, fokus 152 passed/3 skipped, mock E2E admin+coupon **16
  passed**, seed PASS, gate `0`, tanpa fixture sisa. Gap: kombinasi manual+
  percentage & contract map penuh di ticket 13; tanpa live-provider/UAT/deploy.

## Ticket 11 resolved — subsidi ongkir dan pemisahan biaya kurir

- Benefit `shipping` version1 (cap positif, scope shipping) masuk parser/harga/eligibility/admin; snapshot membedakan original, subsidi/merchant funding, net customer, quote cost, billed null; decoder menolak funding≠subsidi.
- Delivery memakai slot promo yang sama (public/manual), quote fresh → benefit → approval NET; booking/quote cost tetap original; satu allocation `offer_shipping` tanpa item; pickup/ongkir0 disabled.
- Seed demo publik cap20000 + manual `ONGKIRHEMAT`; migrasi generated 0051 diterapkan ke DB disposable; docs feature/API/testing/seeding diperbarui.
- Evidence: types store/admin PASS, db:check PASS, batch unit 144 files/1685 passed/13 skipped, shipping DB T 2 passed, provider H 3 passed, checkout-review mock 20 passed (public+manual+pickup+swap+stale), admin mock 6 passed, delivery/coupon regresi 18 passed. Gate akhir 0.
- Gap: live provider/UAT/rollout, legacy `test:e2e`, billed cost evidence. Tanpa commit/push/remote/deploy.

## Ticket 12 resolved — pemakaian, privacy, kapasitas

- Baru `discount-operations-read.ts` + `discount-usage-drift.ts`: agregat global
  consumed/held/available (`basis:"global"`), entries Redemption ter-scope
  Orders dengan pagination/filter/entryId, masking kode, drift terarah, dan
  histori beratribusi aman (fallback receipt setelah FK user NULL).
- Admin: `USAGE_DRIFT_REVIEW` fail-closed pada publish/policy, penurunan
  `perClientLimit` terhadap max komitmen per akun (indexed, Offer lock),
  `capacitySummary` di detail, audit `actorIdentity`, `CODE_CONFLICT` stabil
  untuk create kode yang sudah direservasi (termasuk arsip).
- UI detail menampilkan kapasitas global, peringatan drift, tabel pemakaian +
  filter/pagination/tautan order/badge review, histori aktor; route usage/history
  hanya log count/scope/drift.
- Bukti: types store/admin PASS, `db:check` PASS, batch unit **146 files /
  1701 passed / 14 skipped**, E2E admin usage+admin **10 passed**, regresi coupon
  **17 passed**, focused DB baru **11+1 skip** dan administrasi **18** PASS,
  store pause/hold **15+1 skip** PASS. Gate akhir `0`, tanpa fixture sisa.
- Gap: export diskon tidak ada; riwayat Offer tidak memuat referensi batch
  price-change; drift per-Offer tanpa repair massal; UAT/rollout/aktivasi dan
  live-provider tetap ticket 13/izin terpisah.

## Ticket 13 claimed — integrasi dan kesiapan rilis (blocked external gates)

- Cross-slice regression baru `discounts-integration.db.test.ts` (L+T): manual×
  percentage + Markdown qty2/multi-line (alokasi12308/7692, snapshot L==order,
  consume), public fixed (15385/9615), manual shipping delivery (original/subsidi/
  net/quote/payable), publish revisi & pause setelah preview tanpa order/usage
  parsial. E2E `discounts-coupon-mock` menambah kasus manual×percentage browser
  (total149850, benefit/allocation/provider15000).
- Evidence: types store/admin PASS; batch unit **147 file pass/2 skip, 1706 test
  pass/15 skip**; mock E2E coupon12, admin10, checkout-review+markdown25 PASS;
  db:check/build store+admin PASS; focused lint PASS.
- Rehearsal disposable: 52 migrasi, seed ×2, reset55→0, gate0, 0 bare timestamp,
  81 FK; `SEED_MODE=jubelio` tanpa transactional dummy; production seed ditolak.
- Perbaikan deployment: `CHECKOUT_TRUST_PROXY="true"` store di compose staging/
  production (sebelumnya production fail-closed 503). Docs cutover baru + testing
  README. Register 40 ID: `.scratch/discounts-implementation/evidence-register.md`.
- Gap/blocked: UAT staging+sign-off, standard `test:e2e` live-provider (izin),
  deployment/rollback rehearsal target, keputusan hapus legacy voucher route,
  aktivasi gate1/rilis. Gate tetap0; tanpa deploy/provider write/commit.

### Ticket 13 follow-up — legacy voucher cutover (keputusan pemilik: hapus)

- Dihapus: route `/api/vouchers/validate`, `lib/vouchers`+test, docs
  `features/vouchers.md`, entri API reference, blok seed voucher, test voucher
  E2E legacy, dan `voucherId` DTO admin. Endpoint 404, tanpa consumer/fallback
  subtotal; tabel `voucher`/`orders.voucher_id` inert menunggu migrasi destruktif
  terpisah. Checkbox preflight + writer-gate tiket 13 kini tercentang.
- Re-validasi dengan `DATABASE_URL` disposable eksplisit: types store/admin PASS,
  batch unit **148 file pass / 1703 pass / 12 skip**, build store+admin PASS,
  seed demo disposable PASS (voucher rows0, gate0).
- Insiden: `.env` root berubah eksternal ke `storefront`+`SEED_MODE=jubelio`;
  satu `db:seed` mengenai DB dev storefront sebelum diketahui (2 client/2 user,
  no katalog). Tidak di-reset; run yang memakai DB non-disposable ditolak guard
  dan tidak dipakai sebagai evidence. Recovery menunggu keputusan pemilik.
