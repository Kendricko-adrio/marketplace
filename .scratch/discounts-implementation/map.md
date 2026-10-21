# Implementasi diskon — map 13 ticket

Label: implementation:map

## Tujuan dan sumber kebenaran

Menerapkan [complete spec Markdown, Coupon, dan Manual Promo Code](../../plan/discounts-spec.md) melalui vertical slices yang dapat diverifikasi. [Plan index](../../plan/index.md) tetap satu-satunya sumber status conceptual plan; map ini hanya navigasi dan handoff implementation tickets.

[Wayfinder keputusan](../discounts/map.md) dan 12 child resolved tetap terpisah. Tickets baru tidak membuka ulang keputusan atau mengganti ID ticket lama. Seluruh scope, kontrak teknis yang disetujui, 40 acceptance IDs, dan coverage proposal pada spec tetap wajib; pembagian ticket bukan pengurangan acceptance.

## Approval eksplisit

Setelah membaca link complete spec, ringkasan dan register proposal, pemilik menjawab dua pertanyaan terpisah melalui `ask_user_question` pada sesi publikasi ini:

1. **Setujui spec lengkap (Recommended)** — menyetujui complete scope, seluruh proposal teknis §14.1, acceptance/verification; mengizinkan transisi Ready, bukan implementasi.
2. **Setujui dan publikasikan (Recommended)** — menyetujui 13 vertical slices, blocking edges, Local Markdown di `.scratch/discounts-implementation/`, map dan satu file per ticket.

Pada publikasi seluruh ticket `Type: task`, `Status: open`, `Assignee: none`, berlabel `ready-for-agent`. Label menunjukkan scope disetujui, bukan izin eksekusi atau penghapusan blockers. Ikuti [tracker Local Markdown](../../docs/agents/issue-tracker.md): open → claimed → resolved. Claim hanya setelah pemilik meminta eksekusi dan semua prerequisite resolved. Jangan memakai `Status: ready-for-agent` sebagai pengganti lifecycle tracker.

Tidak ada izin implementasi, delegasi, provider requests, commit, push, remote/deployment, atau launch dari publikasi ini. Approval plan juga bukan izin otomatis untuk tindakan tersebut.

## Graph yang disetujui

| Ticket | Blocked by | Hasil end-to-end |
| --- | --- | --- |
| [01 — Checkout dengan snapshot uang berversi](issues/01-versioned-checkout-money.md) | none | Pickup/delivery tanpa promo: PPN net barang, service fee0, immutable order/repayment dan provider payable yang benar. |
| [02 — Review checkout dan retry tanpa order ganda](issues/02-checkout-review-and-idempotency.md) | 01 | Review/request key/result lookup, reprice, parallel retry dan crash-safe result, account/IP admission. |
| [03 — Markdown manual dari admin sampai pembayaran](issues/03-manual-markdown-through-payment.md) | 02 | Set/restore SKU, projection seluruh storefront, fallback, diskon provider dan audit/current price grants. |
| [04 — Bulk harga dengan hasil dan resume akurat](issues/04-bulk-price-apply-and-resume.md) | 03 | Selected SKUs lintas halaman, persen→fixed, bounded partial apply/resume, no-op dan revoke safety. |
| [05 — Excel dan linked retry subset gagal](issues/05-excel-import-export-and-retry.md) | 04 | Template, parsing bounded/safe, fatal versus row errors, export/report dan retry batch linked. |
| [06 — Admin Coupon publik nominal](issues/06-public-fixed-offer-administration.md) | 01 | Draft/review/simulate/publish/pause fixed-goods; grants promo/capacity, limits dan audit. |
| [07 — Coupon publik nominal dan lifecycle pembayaran](issues/07-public-fixed-coupon-lifecycle.md) | 03, 06 | Picker→atomic reservation→paid/consume atau safe release; ambiguity/late paid/concurrency aman. |
| [08 — Penggantian dan gugurnya promo](issues/08-promo-replacement-and-invalidation.md) | 07 | Confirmation total naik, same/lower direct replace, invalidation dan explicit continue without. |
| [09 — Manual Promo Code dalam slot bersama](issues/09-manual-promo-codes.md) | 08 | Canonical/reserved codes, activation manual, invalid code preserves old choice, masking dan guessing limits. |
| [10 — Percentage goods dengan cap opsional](issues/10-percentage-goods-benefits.md) | 08 | Form/simulasi→pricing/allocation→checkout/provider/order detail, cap opsional dan rounding exact. |
| [11 — Subsidi ongkir dan pemisahan biaya kurir](issues/11-shipping-subsidy-and-courier-costs.md) | 09 | Public/manual shipping delivery, clipping, original/net/quote/booking/payable tetap terpisah. |
| [12 — Pemakaian, privacy dan kapasitas](issues/12-usage-privacy-and-capacity.md) | 09 | Real usage/aggregate/Orders scope, code privacy, capacity races, history/retention dan ops review. |
| [13 — Integrasi dan kesiapan rilis](issues/13-integration-and-release-readiness.md) | 05, 10, 11, 12 | Full evidence register, cross-slice regression, migration/seed/rollback rehearsal dan UAT/sign-off readiness. |

Graph minimal: 01 → {02,06}; 02 → 03 → 04 → 05; {03,06} → 07 → 08 → {09,10}; 09 → {11,12}; {05,10,11,12} → 13. Dependency transitif tidak diulang. Nomor adalah urutan referensi, bukan tambahan blocker. Tidak ada izin parallel writers/subagents; shared module changes diintegrasikan main agent satu slice terverifikasi pada satu waktu.

## Kontrak bersama untuk semua ticket

### Batas produk dan evidence

- Sumber tertinggi untuk koreksi scope adalah [tanpa pembayaran Rp0 dan tanpa service fee](../discounts/decision-zero-payment-and-no-service-fee.md). Jangan menambah fee, menaikkan payable, atau mengembalikan pembuktian pembayaran/provider Rp0 sebagai test/research/gate/ticket.
- Satu target Markdown fixed per SKU untuk semua cabang. Base sumber adalah SKU Jubelio, bukan group RRP. Satu slot Coupon ATAU Manual Promo Code di samping Markdown; tanpa targeting produk/kategori/brand.
- [Logical schema](../discounts/contract-11-schema-retention-and-extensibility.md), [provider contract](../discounts/contract-09-provider-representation-and-settlement.md), [wireframe/authorization](../discounts/wireframe-06-admin-discounts-and-authorization.md), [acceptance matrix](../discounts/acceptance-12-and-specification-outline.md) dan [glossary](../../CONTEXT.md#product-pricing-and-promotions) tetap menjadi referensi yang diturunkan spec.
- Gunakan [evidence08](../discounts/research-08-evidence.md), [T1–T3](../discounts/research-08-selected-lifecycle.md) dan [M1/M2](../discounts/research-09-post-invoice-mirror.md) sesuai envelope, bukan fixtures yang boleh diedit ulang. Tidak mengulang provider writes karena ticket meminta tests; additional proof hanya untuk gap konkret dan izin spesifik baru.
- Refund manual eksternal tidak membuat fitur/event sync/restore usage. Outcome/cleanup sandbox lama tetap follow-up terpisah, bukan blocker kontrak baru atau izin cancellation otomatis.
- Visual mengikuti admin existing/shared components, bukan CSS prototype sebagai final. Jangan redesign di luar scope.

### Incremental delivery dan keamanan interim

- Setiap ticket membawa schema/API/UI/tests/docs yang diperlukan untuk perilakunya, bukan membuat seluruh schema atau semua tests di awal. Prefactor terbatas hanya jika diperlukan untuk slice itu; tidak ada wide refactor tersirat.
- `discounts.contractVersion` default0, current version decoders dan writer fences dijaga sejak slice pertama yang membutuhkannya. Aktivasi1 dalam automated tests hanya pada environment disposable/controlled. Tidak membuka runtime staging/production selama scope masih parsial.
- Ticket01 membuktikan baseline tanpa Offer/Markdown baru; ticket02 menambahkan request-wide replay/review; ticket03 dan seterusnya membangun di atas kontrak itu. Acceptance final lintas fitur tetap menunggu ticket13, bukan klaim baseline menyelesaikan semua IDs terkait.
- Ticket06 mendemonstrasikan administrasi/simulasi fixed Coupon, bukan izin customer redemption sebelum ticket07. Benefit percentage/shipping tidak boleh dipublish/evaluate melalui path yang belum didukung; jangan menampilkan field aktif yang baru pura-pura bekerja.
- Ticket10 tidak bergantung pada09 karena percentage adalah benefit, bukan activation channel. Ia harus memakai interface bersama; kombinasi manual+percentage diuji setelah keduanya terintegrasi pada ticket13. Ticket11 bergantung09 untuk menguji public dan manual shipping secara end-to-end. Ticket12 membaca usage generik; tidak memerlukan implementasi benefit10/11 untuk berfungsi, tetapi kompatibilitasnya wajib dicek pada13.
- Safety kasus ambiguity, consume/release, cancellation, late paid dan no duplicate dispatch dibangun pada slice yang memperkenalkan mutasinya. Tidak menunda seluruh safety ke ticket13.

### Implementasi dan verifikasi

- Sebelum implementasi berizin, load `development-workflow`, `tdd`, dan matching skills (Next.js/UI/design/auth/debugging sesuai pekerjaan). Gunakan Context7 untuk current library APIs sebelum coding. Skill ini tidak memberi izin subagent otomatis.
- Schema hanya di shared package; timestamps `timestamptz`, insert Date; money exact/typed/versioned. Keep seed FK-ordered dan sesuai demo/Jubelio modes; generated SQL tidak diedit manual. Dev memakai db:push, bukan db:migrate.
- Public seams L/T/H/B/P/D mengikuti spec §12. Expected literals independen. PostgreSQL nyata untuk transaksi/locks/counters, Playwright real app HTTP untuk UI, controlled external adapters untuk Jubelio/Midtrans/Shipment/email. Tidak mock internal modules atau hanya stub checkout response.
- TDD red→green satu vertical slice. Main agent menjalankan seluruh tests/checks dan review. Jika delegasi kelak diizinkan, subagent hanya author/edit dan tidak menjalankan validation; main agent tetap pemilik acceptance.
- Semua endpoint baru/berubah memakai structured logger: info success, error contextual failure, safe denial; no tokens/kode literal/raw PII/provider responses. Business audit immutable bukan runtime log.
- Tiap slice memperbarui enduring feature/API/testing docs yang relevan. Deployment-aware changes memperbarui common/staging/production dan deployment docs yang sesuai; ini bukan izin operasi remote.
- Setelah tiap slice jalankan focused checks dan regression yang diperlukan; sebelum commit/PR full unit dan UI/routing/auth E2E wajib sesuai repo. Command plan: `npm run test:unit -- --no-file-parallelism`, isolated `npx playwright test --config=playwright.mock.config.ts`, focused lint/types/build/schema sebagaimana relevan. Standard `npm run test:e2e` mengandung legacy live-provider writes: jangan jalankan tanpa izin terpisah; laporkan blocked, bukan diganti diam-diam oleh mock pass.
- Baca Markdown report saat Playwright gagal, jangan buka PNG. Infrastructure blocker/skips bukan bukti lulus. Tidak ada test yang dijalankan saat publikasi tickets ini.
- Ticket hanya resolved setelah implementasi berizin, main-agent review dan verifikasi acceptance slice tercatat di Answer. Catat acceptance IDs, commands/environment/ref, pass/fail/blocked/skipped dan artifacts aman. Jangan menutup ticket hanya karena child/subagent melaporkan selesai.
- Konflik produk/kontrak atau batas bukti baru menghentikan path terkait untuk keputusan pemilik, bukan silent re-plan. Ticket bukan izin mengubah plan lain yang masih In Progress atau menyebut outstanding-nya selesai.

## Ownership acceptance lintas ticket

Tabel ini mengarahkan verifikasi, bukan status register atau pengurangan scope. ID yang tersebar wajib dibuktikan di setiap konteks terkait; ticket13 merekonsiliasi semuanya terhadap spec.

| Acceptance IDs | Ticket utama dan integrasi |
| --- | --- |
| M01, M02, M03 | 03; latest-data bulk/import juga04/05 |
| X01 | 04; upload/preview juga05 |
| X02 | 05 |
| X03, X04, X05, X06 | 04,05 |
| C01 | 07,09,11 |
| C02 | 08; integrasi manual/benefit lain09/10/11 |
| C03 | 09 |
| C04 | 08,11 |
| C05 | 06,07,09; benefit shape10/11 |
| C06 | 07 |
| C07 | 02 untuk non-code/admission;09 untuk guessing manual |
| F01 | 07,10,11; kombinasi Markdown03 |
| F02 | 01,03,07,11 |
| F03 | 06,07,10,11; bukan proof pembayaran/provider Rp0 |
| T01 | 07 |
| T02 | 07,09,12 |
| T03 | 06,07,12 |
| T04 | 02,07 |
| T05 | 07 |
| T06 | 01,02,03,07,11 |
| P01 | 01 baseline;03/07/10/11 discounted mapping |
| P02 | 01,03,07,11 |
| P03 | 03,07,10,11 memakai evidence M1/M2 bounded |
| S01, S02, S03, S04 | 07; ops read/visibility juga12 |
| A01 | 03,04,05,06,09,12 |
| A02 | 06,12 |
| A03 | 09,12 |
| A04 | 03,04,05,06,09,12 |
| D01 | 02,03,06,07,09,12; constraint/retention dibawa slice terkait |
| D02 | Tiap slice schema/seed; rehearsal/compatibility lengkap13 |
| D03 | 01 decoder;06 publication;10/11 benefit versions |
| R01 | 12 pause/ops;13 staging UAT/release evidence |

## Eksekusi berizin — sesi implementasi

Pemilik meminta implementasi seluruh13 tickets dan mengizinkan subagent development, penulisan unit tests/Playwright E2E, serta parallel work pada kontrak independen. Hanya main agent menjalankan bash testing dan menerima hasil review. Izin ini menggantikan status execution/delegation yang belum diminta pada catatan publikasi historis di atas, bukan izin provider requests, commit/push, remote/deployment atau launch.

Frontier awal01 dikerjakan melalui lane snapshot uang/gateway/checkout/retention terisolasi. **Update21Oktober2026:**01 sudah resolved oleh main berdasarkan source review, types/lint, full unit dan focused+regression mock evidence; lihat Answer01. Frontier02 dan06 kini claimed dan berjalan paralel di `../discounts-checkout-02` serta `../discounts-offers-06`. Approval scope/spec tidak berubah. Map tetap navigasi, bukan status tracker kedua; lihat masing-masing ticket dan execution.md untuk evidence serta batas.

## Completion dan handoff berikutnya

Lanjutkan dari frontier open/unclaimed dengan prerequisite resolved; baca ticket, complete spec dan kontrak bersama ini, jangan memakai ringkasan sebagai substitusi. Plan sekarang In Progress karena implementasi memang diminta dan dimulai, bukan karena publikasi ticket saja.

Sesudah seluruh ticket verified/resolved dan semua gates terpenuhi, extract enduring docs, retire plan sesuai checklist dan update plan index Done. Staging UAT, deployment dan launch memerlukan environment/izin/sign-off terpisah. Jika belum tersedia, catat blocked; jangan mengarang acceptance atau menyatakan production activated. Decision/evidence scratch tidak dihapus otomatis.

Publikasi hanya mengubah artefak planning/tracker. Verifikasi dokumen sesi publikasi:13 task open/unclaimed, blocking edges cocok dengan breakdown yang disetujui dan berurutan tanpa siklus; frontier awal hanya01;40 acceptance IDs memiliki mapping pada feature tickets dan register integrasi13;133 unchecked acceptance criteria;154 local link targets pada spec/map/tickets yang diperiksa tersedia, tanpa whitespace/fence errors. Index dan5 fitur konsisten Ready; `git diff --check` perubahan tracked terkait bersih. Ini pemeriksaan dokumen, bukan unit/E2E/build/lint/typecheck aplikasi atau provider proof baru. Broken link index lama yang sudah dicatat pada spec tidak diubah sebagai perubahan tak terkait.
