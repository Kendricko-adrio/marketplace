# Spec: Markdown, Coupon, dan Manual Promo Code

> Status plan secara keseluruhan hanya di [index.md](../index.md). Status per fitur ada di §1.5.
> **Complete spec disetujui pemilik**, termasuk seluruh proposal teknis §14.1 dan acceptance/verification. Plan eligible sebagai Ready; eksekusi implementasi/autonomous loop tetap menunggu permintaan pemilik. [13 implementation tickets yang disetujui](../ticket/map.md) telah dipublikasikan terpisah.

## 1. Tujuan, scope, dan approval

### 1.1 Problem statement dan solusi

Admin membutuhkan harga clearance persisten per SKU tanpa mengubah master price Jubelio, serta promo per order yang bisa dipakai customer tanpa perhitungan atau pencatatan pemakaian yang keliru. Excel harus boleh berhasil sebagian dengan laporan jujur. Nominal yang dibayar customer, diskon SO/invoice/payment Jubelio, dan penggunaan kuota harus tetap konsisten saat data berubah, request diulang, atau provider memberi hasil ambigu.

Solusi: Markdown berupa target harga tetap per variant, Offer publik/manual dengan satu benefit dan satu slot bersama, pricing exact dan snapshot berversi, reservation transaksional bersama order/stock intent, admin dengan kewenangan terpisah, serta perluasan gateway/ledger existing untuk diskon dan net ongkir. Dokumen ini menyatukan hasil Wayfinder menjadi kontrak implementasi yang dapat direview; bukan laporan fitur sudah berjalan.

### 1.2 Sumber dan urutan otoritas

1. [Koreksi pemilik: tanpa pembayaran Rp0 dan tanpa service fee](../wayfinder/decision-zero-payment-and-no-service-fee.md) menggantikan requirement lama yang bertentangan.
2. [Map Wayfinder dan 12 keputusan resolved](../wayfinder/map.md), terutama [01 Markdown](../wayfinder/01-markdown-base-drift-and-restore.md), [02 eligibility](../wayfinder/02-offer-eligibility-and-money-basis.md), [03 reservation](../wayfinder/03-redemption-limits-identity-and-reservations.md), [04 finance](../wayfinder/04-tax-and-shipping-subsidy-accounting.md), [05 Excel](../wayfinder/05-bulk-adjustment-and-partial-import.md), dan [10 safety/refund](../wayfinder/10-cancellation-refund-and-late-payment.md).
3. [Kontrak provider09](../wayfinder/contract-09-provider-representation-and-settlement.md), [logical schema11](../wayfinder/contract-11-schema-retention-and-extensibility.md), [wireframe/authorization06](../wayfinder/wireframe-06-admin-discounts-and-authorization.md), dan [acceptance12](../wayfinder/acceptance-12-and-specification-outline.md).
4. [Evidence08](../research/research-08-evidence.md), [lifecycle T1–T3](../research/research-08-selected-lifecycle.md), dan [post-invoice mirror M1/M2](../research/research-09-post-invoice-mirror.md). Evidence hanya berlaku pada envelope yang diuji, bukan dukungan universal.
5. [CONTEXT.md](../../../CONTEXT.md#product-pricing-and-promotions), [aturan repo](../../../AGENTS.md), dan [workflow](../../../.agents/skills/development-workflow/SKILL.md).

Dokumen research awal adalah bahan penelusuran, bukan otoritas untuk mengembalikan scope yang telah dikeluarkan. Jika ditemukan konflik dengan keputusan pemilik, perbaiki draft melalui review; jangan mengubah keputusan lama secara implisit.

**Penanda kontrak:** aturan produk/finance/UX dan seluruh detail teknis dokumen ini kini disetujui pemilik. Nama endpoint/module fisik, payload, angka operasional, format input, desain SQL dan rollout semula diajukan sebagai proposal pada drafting; approval lengkap dicatat di §1.3. Sebutan **usulan/draft** pada penjelasan teknis berikut mempertahankan konteks asal proposal, bukan berarti masih ada approval behavior yang diam-diam ditunda. Semuanya menjadi kontrak target yang disetujui, bukan klaim kode existing sudah sesuai atau tests sudah berjalan.

### 1.3 Approval dan batas tindakan

- Kesepahaman drafting: pemilik memilih **Sesuai, susun draft (Recommended)** melalui `ask_user_question` setelah rangkuman scope, seams, koreksi pembayaran, visual existing, dan pemisahan cleanup sandbox disampaikan pada sesi ini.
- Approval complete spec: pada sesi tindak lanjut `to-tickets`, pemilik memilih **Setujui spec lengkap (Recommended)** melalui `ask_user_question` setelah menerima link dokumen, ringkasan dan register §14.1. Approval mencakup complete scope, seluruh proposal teknis, acceptance/verification; mengizinkan Ready, bukan eksekusi implementasi.
- Approval breakdown terpisah: pemilik memilih **Setujui dan publikasikan (Recommended)** atas13 vertical slices, dependency dan Local Markdown di `.scratch/discounts/ticket/`. [Map dan approval record](../ticket/map.md) menautkan satu file per ticket; semuanya open/unclaimed saat publikasi. Pengelompokan5 fitur di bawah tetap bukan status tracker kedua.
- **Batas saat publikasi:** implementasi, subagent, provider requests, schema/config changes, commit, remote/deployment, dan launch belum diminta/diizinkan. Ready/publikasi bukan otorisasi tindakan tersebut.
- **Eksekusi sesi berikutnya:** pemilik meminta implementasi seluruh13 tickets dan mengizinkan parallel subagents untuk development serta penulisan unit/Playwright E2E tests. Hanya main agent menjalankan seluruh bash testing dan menerima hasil review. Ticket01 sedang dikerjakan; [catatan eksekusi](../ticket/execution.md) memuat lane boundaries dan evidence. Izin provider requests nyata, commit/push, remote/deployment/launch tetap tidak diberikan; gate operasional tetap0.
- Pemeriksaan drafting/publikasi hanya read-only terhadap aplikasi dan validasi dokumen. Semua tests fitur pada §12 masih rencana.

### 1.4 Scope dan non-goals

**Scope:** harga sama untuk seluruh cabang per SKU; manual/bulk/Excel; katalog/detail/cart/checkout/order detail; public Coupon/manual code; percentage goods dengan cap opsional, fixed goods, shipping subsidy; minimum/waktu/verified email/limits; admin draft/review/publish dan current policy; ownership/snapshots/retention; Midtrans dan Jubelio existing; automated acceptance, rehearsal, UAT staging lalu publik.

**Bukan scope:** harga per cabang; target Markdown berupa persen dinamis; prior claim/wallet; stacking beberapa Offer atau goods+shipping dalam satu Offer; targeting produk/kategori/brand; first-order/OTP/phone binding/CAPTCHA; limit periodik/subkuota kode; cashback/points/gift/BOGO/tier engine; background Excel worker; approval dua orang; refund/retur aplikasi atau sync refund; manual reset/release paksa promo; compatibility/dual-write/backfill usage voucher legacy; arsip workbook asli; emergency-switch subsystem baru.

Website **tidak mengenakan service fee**. Pembayaran customer Rp0 di luar scope operasional dan dijaga prosedur admin/pemilik bisnis. **Tidak ada kewajiban merancang atau membuktikan pembayaran/provider Rp0 sebagai acceptance, research, launch gate, atau follow-up.** Tidak menaikkan nominal atau menambah fee sebagai workaround. Ini keputusan scope, bukan bukti dukungan provider.

Visual prototype bukan desain final: ikuti [feedback pemilik](../prototype/README.md#feedback-pemilik--arah-fungsi-sesuai-style-belum-final) dengan theme/komponen admin existing. Outcome/cleanup sandbox lama tetap terpisah sesuai [scope08](../research/research-08-approved-proof-scope.md#tindak-lanjut-legacy-tetap-tercatat), bukan launch blocker fitur atau izin cleanup otomatis.

### 1.5 Fitur dan status

| # | Fitur | Status | verify: | Catatan |
| --- | --- | --- | --- | --- |
| 1 | Markdown dan read projection storefront | Ready | M01–M03; harga/coretan/filter/sort konsisten, sync tidak menghapus target | Termasuk harga authoritative checkout |
| 2 | Admin harga dan Excel partial/resume | Ready | X01–X06, A01, A04; Playwright + real PG | Memakai pricing fitur1, permission terpisah |
| 3 | Offer/admin/code/kapasitas/retention | In Progress | C05, T02–T03, A01–A04, D01/D03 | Ticket06 dimulai pada grants administrasi fixed-public; draft/publish/customer usage belum selesai |
| 4 | Pilihan customer dan reservation checkout/payment | In Progress | C01–C07, F01–F03, T01–T06, S01–S04 | Baseline snapshot checkout ticket01 sedang diimplementasikan; reservation Offer belum dibangun. Atomic order+promo+stock intent tetap target; no service fee |
| 5 | Provider integration, cutover dan release | In Progress | P01–P03, D02, R01; regression/rehearsal/UAT | Baseline contract2/ledger/mirror ticket01 sedang diintegrasikan. Cutover/release/UAT belum diverifikasi; evidence provider tetap bounded |

Ini pengelompokan scope untuk review, bukan urutan horizontal database → API → UI. Delivery nanti tetap vertical slice dengan TDD, review, dan bukti tiap slice sebelum diterima.

## 2. Fakta repo, domain, dan module seams

### 2.1 Kondisi existing yang diperiksa

| Area | Fakta existing dan perubahan target |
| --- | --- |
| Harga sumber | [Sync](../../../packages/db/src/jubelio-sync.ts) menulis `product.base_price` dari group sell price dan `product_variant.price` dari SKU sell price. **Base Price target diskon adalah harga SKU Jubelio di variant**, bukan group RRP. Jangan menimpa variant source dengan effective Markdown. |
| Katalog | [Products API](../../../apps/store/src/app/api/products/route.ts), [homepage API](../../../apps/store/src/app/api/homepage/route.ts), [cart API](../../../apps/store/src/app/api/cart/route.ts) dan [detail UI](../../../apps/store/src/app/products/[id]/page.tsx) memakai variant price/group base secara langsung. Read projection dan pairing harga coret perlu diperbarui, termasuk filter/sort, bukan hanya badge UI. |
| Voucher | Validator lama (`apps/store/src/app/api/vouchers/validate/route.ts`; artefak legacy tidak tersedia) memakai subtotal browser dan tabel `voucher`; helper (`apps/store/src/lib/vouchers.ts`; artefak legacy tidak tersedia) memperlakukan shipping seperti fixed goods. Tidak dapat menjadi authority fitur baru. |
| Checkout | [Place order](../../../apps/store/src/app/api/checkout/place-order/route.ts) sudah mengikat order/items/stock hold/SO intent dalam transaksi, lalu HTTP di luar; belum ada checkout-wide idempotency atau Redemption. `saveRequestId` hanya dedupe penyimpanan alamat. |
| PPN | [Order pricing](../../../apps/store/src/lib/order-pricing.ts) memakai exact arithmetic/rate6 digit tetapi masih memasukkan ongkir pada taxable base delivery. Target baru: PPN net barang saja untuk **order baru**. Checkout pickup memasok serviceFee0; tidak menambah fee pada delivery. |
| Provider | [Client](../../../apps/store/src/lib/jubelio-sales-client.ts) masih menolak diskon nonzero dan builder tanpa original/net shipping target. [Payment lifecycle](../../../apps/store/src/lib/jubelio-sales-lifecycle.ts) memakai `order.subtotal` untuk payable/recovery. Semuanya perlu dispatch berdasarkan versi snapshot baru, bukan sekadar melonggarkan guard. |
| Safety | [Finalizer](../../../apps/store/src/lib/order-finalize.ts), [settlement](../../../apps/store/src/lib/jubelio-sales-settlement.ts), dan [sweep](../../../apps/store/src/app/api/cron/sweep-reservations/route.ts) punya paid/blocked/cancel/late-paid paths. Promo harus terintegrasi di semua path tersebut, bukan hanya webhook sukses. |
| Ledger | [Operation ledger](../../../packages/db/src/schema/jubelio-sales.ts) dan [claim module](../../../apps/store/src/lib/jubelio-sales-operations.ts) sudah durable/at-most-once. Perluasan mempertahankan ledger ini dan [mirror existing](../../../apps/store/src/lib/jubelio-channel-mirror.ts), bukan sistem dispatch kedua. |
| RBAC | [Catalog](../../../packages/db/src/rbac/catalog.ts), [schema](../../../packages/db/src/schema/rbac.ts), [guard](../../../apps/admin/src/lib/rbac/guard.ts) belum punya tiga module diskon. CHECK module/scope SQL juga harus diperluas; update TypeScript saja tidak cukup. |
| Retention | [Order schema](../../../packages/db/src/schema/orders.ts) masih cascade client→orders dan beberapa evidence relations. Target RESTRICT memerlukan perubahan FK dan seed/test cleanup yang dependency-ordered. |
| Config/deployment | [System config](../../../packages/db/src/schema/system.ts) dan [loader store](../../../apps/store/src/lib/config.ts) memakai cache proses. [Caddy staging](../../../deployment/staging/caddy/Caddyfile) dan [production](../../../deployment/production/caddy/Caddyfile) meng-overwrite IP headers; itu dasar trusted proxy, bukan izin mempercayai header publik sembarang. |

Plan ini tidak menutup atau mengganti status plan checkout live-stock, Sales API switching, atau guided admin delivery yang masih In Progress. Integrasi harus mempertahankan kontraknya dan melaporkan blocker/regression yang ditemukan; spec ini tidak mengklaim outstanding plan lain selesai.

### 2.2 Domain dan ownership

Gunakan vocabulary glossary: **Base Price**, **Markdown**, **Offer**, **Offer Revision**, **Coupon**, **Manual Promo Code**, **Redemption**, dan **Promo Reservation**. Customer adalah store `client`; staf adalah Admin User `user`. Cookie/session Better Auth store dan admin tetap terpisah.

- Base Price/inventory/cabang: master Jubelio. Markdown/Offer/usage dan hasil pricing: website.
- Currency fase ini hanya IDR. Branch menentukan stock/fulfillment, tidak harga Markdown atau kapasitas promo.
- Satu order maksimal satu Redemption sepanjang hidupnya, termasuk jika released. Markdown memiliki allocation sendiri, bukan Redemption.
- `public` dan `manual_only` adalah activation kind identitas Offer yang tetap; pindah jalur membutuhkan Offer baru, bukan revisi terselubung.
- Semua kode satu Offer berbagi kuota/budget/jatah akun. Mengganti kode/nama/email/revision tidak membuat riwayat baru.

### 2.3 Deep modules dan interfaces target

Usulan module berikut membatasi kompleksitas tanpa generic plugin framework. Nama adalah vocabulary target; tidak menetapkan file private implementasinya.

| Module | Interface publik dan tanggung jawab | Callers/seam |
| --- | --- | --- |
| Pricing | `evaluatePricing(context)` mengembalikan breakdown exact, eligibility/reason, allocation, versions; tanpa DB/HTTP/mutasi usage | Store/admin preview/checkout dan provider intent; seam L |
| Product pricing projection | Effective price expression/read projection yang sama untuk katalog/filter/sort/detail/cart; source dan effective dipasangkan per variant | Store/admin data loaders; seam H/B, contoh L |
| Discount administration | `stagePriceChanges`, `applyPriceBatch`, `readPriceBatch`, `saveOfferDraft`, `reviewOffer`, `publishOffer`, `changeOfferState`, `changeOfferPolicy`, `readOfferUsage` | Admin HTTP; menyembunyikan transaksi/locking/audit; seam T/H/B |
| Checkout | `previewCheckout`, `placeCheckout`, `readCheckoutResult` | Store HTTP; satu authority order+usage+stock+request result; seam T/H/B |
| Promo lifecycle | `recordPaid`, `recordSafeUnpaidTerminal`, `recordLatePaid` mengintegrasikan finalizer existing; conditional transition, event dan projection atomik | Webhook/sweep/reconciliation; seam T/H |
| Sales integration existing | Intent/versioned expected snapshot → gateway → independent confirmation → ledger outcome/mirror | Existing checkout/settlement/sweep; seam H/P |

Constraint DB diuji di seam SQL untuk invariant schema itu sendiri. Tidak menguji helper lock/query builder internal atau membuat adapter hipotetis. Apps tetap memiliki DB lokal; schema dan pure shared pricing/projection dapat berada di package shared tanpa memperkenalkan shared runtime DB connection.

## 3. User stories

1. Sebagai customer, saya melihat harga efektif dan coretan yang benar untuk SKU yang dipilih, agar tidak tertipu harga group atau variant lain.
2. Sebagai customer, harga SKU sama di semua cabang, sementara ketersediaan stock tetap mengikuti cabang.
3. Sebagai customer, perubahan base yang membuat Markdown tidak efektif tidak membuat saya membayar lebih dari base terbaru.
4. Sebagai customer, saya memilih Coupon publik tanpa claim dan melihat alasan jika belum eligible.
5. Sebagai customer, saya memasukkan Manual Promo Code tanpa mendapat slot diskon kedua.
6. Sebagai customer, kegagalan kode baru tidak menghapus promo lama yang masih valid.
7. Sebagai customer, penggantian promo meminta konfirmasi jika total final naik, bukan jika sama/turun.
8. Sebagai customer, promo yang gugur memerlukan pilihan ulang atau persetujuan lanjut tanpa promo; tagihan tidak naik diam-diam.
9. Sebagai customer, rincian Markdown, kupon barang, ongkir, subsidi dan PPN dapat dipahami, tanpa service fee.
10. Sebagai customer, retry setelah koneksi putus mengembalikan order yang sama tanpa double usage.
11. Sebagai customer, order yang sudah dibuat mempertahankan nominal saat saya melanjutkan pembayaran.
12. Sebagai customer, saya mendapat alasan jelas jika kuota/budget/jatah tidak tersedia saat order dibuat.
13. Sebagai pengelola harga, saya mengubah atau menghapus Markdown satu SKU setelah review dampaknya.
14. Sebagai pengelola harga, saya memilih SKU lintas halaman dan mengubah target fixed melalui shortcut persen base.
15. Sebagai pengelola harga, saya mengimpor Excel dengan hasil per baris, bukan klaim sukses seluruh file saat sebagian gagal.
16. Sebagai pengelola harga, saya melanjutkan batch terputus tanpa menerapkan ulang baris committed dan memperbaiki error lewat linked batch baru.
17. Sebagai pengelola promo, saya menyusun draft, melihat diff, dan publish tanpa mengubah live sebelum konfirmasi.
18. Sebagai pengelola promo, saya mempertahankan usage saat rename/revision/tambah kode dan melihat konflik edit stale.
19. Sebagai pemegang izin kapasitas, saya menetapkan/menaikkan kapasitas dengan audit tanpa memberi kewenangan itu kepada semua editor promo.
20. Sebagai viewer, saya melihat ringkasan global tanpa kode lengkap atau order/customer di luar Orders scope.
21. Sebagai operator, saya membedakan reserved/consumed/released dan mengetahui order paid yang fulfillment-nya tertahan.
22. Sebagai operator, saya tidak melepaskan hold hanya karena timeout atau menggandakan provider write yang belum pasti.
23. Sebagai pemilik, saya mem-pause Offer bermasalah untuk pemakaian baru tanpa mengubah snapshot order lama.
24. Sebagai pemilik/tester, saya mereview hasil automated acceptance dan UAT staging sebelum rilis publik.

## 4. Kontrak harga dan uang

### 4.1 Markdown dan source projection

Untuk variant dengan source unit `B` dan target tersimpan `T`:

- Current `set_price` dan `0 < T < B`: effective unit `E=T`, Markdown aktif, original/coretan `B` dari **variant yang sama**.
- Tidak ada current/restore, atau `B <= T`: effective `E=B`, tanpa coretan/badge Markdown. Target tetap tersimpan pada fallback dan aktif kembali bila `B>T`.
- Admin set target wajib positif dan lebih rendah dari base **terbaru saat apply**. Tidak ada floor/persentase minimum tambahan.
- Restore melepas current Markdown terbaru dan mengikuti source terbaru; revision/version tidak reset. Riwayat tetap ada.
- Perubahan source/target setelah preview tidak memaksa review ulang tindakan harga: target tetap jika valid; invalid gagal; restore menghapus yang terbaru. Ini berbeda dari stale edit promo yang wajib ditolak.
- Snapshot order tidak direprice. Sync catalog hanya menulis source; jangan menyimpan effective ke source atau membuat loop sync→hapus Markdown.

Read projection mengembalikan `sourceUnitPrice`, `effectiveUnitPrice`, `storedTarget`, `markdownActive`, `markdownRevisionId`, dan `priceVersion`/source fingerprint. API card memilih variant termurah berdasarkan effective price, tie variant ID stabil; original/coretan harus dari variant itu, bukan `product.base_price`. Detail mengikuti variant terpilih. Filter range, sort harga, filter diskon dan carousel homepage memakai effective projection yang sama; filter diskon berarti ada Markdown efektif pada variant relevan, bukan selisih RRP group lama. Jangan menampilkan coretan karena dua variant mempunyai harga source berbeda.

Usulan cache: respons pricing mutable dan personalized preview memakai `Cache-Control: no-store`; tidak menambah materialized price job pada fase ini. Navigasi/refetch memuat harga terbaru; UI yang sudah terbuka bukan push subscription. Place order selalu revalidasi sehingga stale tab tidak menjadi authority. Query projection dibatasi pagination dan indexes, bukan evaluasi seluruh katalog di browser.

### 4.2 Rumus dan rounding

Per line `i`: quantity `q_i`, source unit `B_i`, effective unit `E_i`.

- `source_goods = Σ(B_i × q_i)`; `subtotal = Σ(E_i × q_i)`.
- `markdown_i = (B_i − E_i) × q_i`; `markdown_total = source_goods − subtotal`.
- Minimum belanja memakai `subtotal`, sebelum kupon/pajak/ongkir.
- Percentage goods: `D = min(floor(subtotal × rate / 100), subtotal, cap jika ada)`; `0 < rate <=100`, cap opsional positif.
- Fixed goods: `D=min(nominal,subtotal)`, nominal positif, sisa hangus.
- Shipping subsidy: delivery dan ongkir valid positif, `S=min(shipping_before_subsidy,cap)`. Pickup/ongkir0 tidak eligible; sisa hangus. Tidak membatasi kurir tertentu.
- Satu slot: goods discount atau shipping subsidy, tidak keduanya. Markdown tetap boleh digabung.
- `net_goods=subtotal−D`; `net_shipping=shipping_before_subsidy−S`.
- `taxable_base=net_goods`; `PPN=ceil(net_goods × stored_ppn_rate/100)` **sekali per order**. Ongkir dan fee tidak menjadi dasar pajak.
- `total_customer=net_goods+PPN+net_shipping`; website service fee0.
- `expected_provider_payable=net_goods+net_shipping`; provider tax/fees0.
- `redemption.amount=D` untuk goods, `S` untuk shipping; **tidak termasuk Markdown**.

Benefit sesudah rounding harus positif; invalid configuration tidak boleh publish dan benefit0 tidak dipakai/tidak mengurangi usage. Pembulatan benefit floor berbeda dari shortcut harga admin: persen dari base menghasilkan target fixed dengan nearest/half-up. Persentase shortcut20% berarti target80% base, bukan tambahan20% dari harga Markdown sekarang.

Goods allocation: proporsional terhadap effective whole-line subtotal, floor tiap porsi, sisa Rupiah ke remainder terbesar; tie lexicographic variant ID. Selected lines harus unique per variant pada satu branch; quantity diagregasi authoritative sebelum evaluasi. Porsi untuk line dengan basis0 adalah0; allocation0 tidak dibuat. Jika perlu rincian unit, bagi whole-line allocation dengan quantity dan berikan sisa ke ordinal unit stabil. Jangan memakai rounding per unit untuk menghitung ulang total line, dan jangan mengalikan `disc_amount` whole-line dengan quantity lagi. Result disimpan saat checkout; read order tidak menjalankan alokasi ulang.

### 4.3 Tipe, precision, dan bounds — usulan teknis

| Input | Kontrak draft |
| --- | --- |
| Money website | Decimal string IDR utuh, tanpa separator/exponent/sign/fraction nonzero; `0..9999999999999`. Existing scale2 boleh menyimpan `.00`; jumlah agregat juga wajib dalam bound tersebut. Perhitungan exact integer/rational, bukan binary float. |
| Source Jubelio | Baca decimal secara exact; `.0000` ekuivalen integer diterima. Source dengan pecahan Rupiah nonzero/invalid tidak dibulatkan diam-diam: checkout terkait ditahan dengan error data, bawa fakta ke review sebelum aktivasi. |
| Percentage/rate | Decimal string sampai6 fractional digits, tanpa rounding input berlebih; rate promo `>0..100`. PPN memakai resolver/config existing dan snapshot rate6 digit; contoh11% bukan keputusan rate baru. |
| Count/quantity | Kuota/jatah akun integer positif sampai2147483647; cart maksimal50 distinct variants, quantity1..99 per variant. Request melebihi batas ditolak sebelum provider read/write, bukan dipotong diam-diam. |
| Kode | Canonical trim+uppercase ASCII, 3–64 karakter, karakter pertama alphanumeric dan sisanya alphanumeric/`_`/`-`; spasi internal/Unicode alias ditolak. Contoh ` hemat17agustus ` → `HEMAT17AGUSTUS`. |
| Teks admin | Nama promo1–120 karakter setelah trim; terms maksimal2000; alasan opsional harga maksimal500. Plain text, bukan HTML executable. |
| ID/request | Existing domain IDs opaque string maksimal128; checkout/batch request key UUID; fingerprints SHA256 canonical payload. Pagination default25, maksimum100. |
| JSON/request | Checkout/preview body maksimal256KiB; typed snapshots maksimal256KiB per order, offer params maksimal4KiB; reject unknown fields/version. Workbook memakai limit terpisah §6. |

Batas ini proposal konservatif untuk bounded execution, **bukan hasil benchmark/SLA** dan belum merupakan approval produk tambahan. Konversi ke number untuk SDK/provider hanya setelah safe integer/bounds terbukti; representasi JSON historical money tetap decimal strings.

### 4.4 Contoh independen

PPN11% hanya ilustrasi; tiap baris adalah order berbeda, tanpa service fee. Pickup/ongkir0 kecuali disebutkan.

| Kasus | Expected literal |
| --- | --- |
| Source300000 → target150000, Coupon10% | Markdown150000, benefit15000, net135000, PPN14850, customer149850, provider135000; provider whole-line discount165000 |
| Subtotal450000,10% cap20000 | Benefit20000, net430000, PPN47300, customer477300, provider430000 |
| Subtotal450000,10% tanpa cap | Benefit45000, net405000, PPN44550, customer449550, provider405000 |
| Lines150000+100000, fixed25000 | Allocations15000+10000, net225000, PPN24750, customer249750 |
| Source100000,target90000,qty2,10% | Markdown20000, Coupon18000, net162000, PPN17820, customer179820; provider gross200000/disc38000/payable162000 |
| Goods150000,original shipping30000,cap20000 | Subsidy20000, net shipping10000, PPN16500, customer176500/provider160000; quote/biaya kurir tidak ikut dipotong |
| Goods150000,original shipping12000,cap20000 | Subsidy12000, net shipping0, customer166500/provider150000; sisa8000 hangus |
| Subtotal100005,10% | Benefit10000, net90005; PPN atas dasar100005 secara terpisah adalah11001 |
| Shortcut target85% dari source100001 | Target85001 melalui half-up; ini setara shortcut diskon15%, bukan floor kupon |
| Subtotal50,1% | Benefit0 → tidak diterapkan, tanpa usage |
| Fixed1,lines100+200 | Allocations0+1; total benefit1 |
| Fallback source120000,target150000 lalu source400000 | Harga120000 tanpa coretan, lalu150000 dengan coretan400000; target tidak hilang |

## 5. Customer selection dan HTTP contracts

### 5.1 Eligibility dan state pilihan

Customer menggunakan store account yang lolos onboarding existing. Verified email wajib untuk penggunaan Offer; akun tanpa verified email tetap dapat checkout tanpa Offer sesuai akses checkout existing. Contact email order bukan pengganti verified identity akun. Perubahan email tidak mereset usage dan email baru harus verified sebelum penggunaan berikutnya.

Eligibility: Offer enabled, revision supported, waktu server mulai inklusif/akhir eksklusif, minimum barang, activation/code tepat, verified email, benefit positif, kapasitas penuh dan jatah akun. Input waktu admin WIB (`Asia/Jakarta`), simpan absolute instant; dua batas opsional dan jika keduanya terisi start<end. Tidak menambah first-order/min quantity/courier targeting.

- Public picker menampilkan Offer publik relevan enabled yang waktunya aktif; yang belum memenuhi minimum/identitas/fulfillment/capacity ditampilkan disabled dengan alasan aman. Draft/paused/archived/manual-only tidak didiscovery. Urutan usulan: nama kemudian Offer ID, pagination; tidak auto-apply/rekomendasi benefit tanpa pilihan customer.
- Pilih/Terapkan adalah tindakan penggantian. Total final naik → dialog total lama/baru/selisih, konfirmasi atau batal; sama/turun → langsung mengganti dan refresh breakdown.
- Kode invalid/kehabisan kapasitas tidak mengganti pilihan lama yang masih valid. Jika pilihan lama juga gugur, tunjukkan alasan dan minta pilihan ulang atau **Lanjut tanpa promo** eksplisit.
- Perubahan cart, branch, fulfillment, quote, price atau promo re-evaluasi pilihan. Tidak mempertahankan benefit invalid atau mengubah ke promo lain otomatis.
- Preview tidak membuat Redemption/hold. Capacity race di place order menggagalkan commit penuh, bukan menawarkan benefit parsial atau diam-diam memesan tanpa promo.

### 5.2 Envelope umum dan proposed endpoints

Semua kontrak baru di bagian ini **usulan**. Endpoint existing lain tidak diganti namanya tanpa kebutuhan. Response success memakai `success:true,data`; failure `success:false,code,error,requestId` dengan field errors aman bila perlu. Money decimal strings, waktu ISO8601 dengan timezone. Session/owner/current policy dicek di server; body tidak boleh menentukan client identity, source price, budget atau provider amount. No-store untuk preview/private/admin.

| Method/path target | Input utama | Hasil/efek |
| --- | --- | --- |
| POST `/api/checkout/preview` baru | Selected cart IDs, fulfillment pickup/delivery, destination/service bila delivery, pilihan `none`/public Offer ID/manual code; previous review token opsional | Current pricing, eligibility/reason, versi, review token dan candidate fingerprint; tidak ada order/usage/provider business write |
| POST `/api/discounts/available` baru | Context selected cart/fulfillment/destination/service, cursor | Public Coupon list/disabled reasons; tidak mengembalikan manual codes atau order/customer lain |
| POST `/api/checkout/delivery-quote` existing | Existing owned items+address/newAddress; tambahan pilihan promo opsional | Services dengan original quote cost dan breakdown setelah promo untuk setiap service; bukan reservation |
| POST `/api/checkout/place-order` existing | Existing pickup/delivery fields; tambahan `requestKey`, pilihan promo/none, `reviewToken`, acknowledgements yang diperlukan | Atomic order/result;201 baru,200 replay,202 accepted tetapi provider/payment masih pending/review |
| GET `/api/checkout/requests/{requestKey}` baru | Key milik client session | Status accepted/order ID/current payment availability/review state;404 jika tidak ada/outside owner; tidak pernah dispatch write |
| GET `/api/orders/{id}` existing | Owner session | Immutable financial breakdown, selected promo dan Redemption status yang aman; tidak membocorkan master manual codes lain |
| POST `/api/vouchers/validate` legacy | Tidak digunakan flow baru | Pada cutover hapus route/consumer lama, hasil404; tidak ada compatibility adapter atau subtotal browser authority |

Pickup mempertahankan phone/email/pickupDate/pickupTime/selectedItemIds; delivery mempertahankan itemIds/contact/address/service/origin approval existing. Module menormalisasi ke satu context internal. Tidak menerima dua pilihan promo atau pickup fields di delivery. Approved pricing browser hanya acknowledgement untuk dibandingkan, bukan sumber perhitungan. API quote existing harus memisahkan provider cost dari net customer, bukan mengganti nilai service cost dengan subsidized price.

### 5.3 Review/confirmation dan reprice — usulan teknis

Gunakan review token bertanda tangan server, version1/TTL10 menit. Payload hanya hashes context/selection/version dan breakdown yang ditampilkan, expiry, client binding; tidak memuat alamat/telepon/kode literal. Kunci dari secret server existing dengan domain separation khusus review diskon; tidak menambah env secret atau menggunakan token ini sebagai auth/permission. Token berbeda dari idempotency key, tidak menjanjikan slot atau membekukan master sebelum order.

- Context fingerprint mengikat selected cart IDs+quantities, branch, fulfillment, destination digest, service/origin, aturan pricing dan pilihan promo. Key canonical disort; duplicate cart IDs ditolak. Monetary approvals dinormalisasi tanpa variasi format semu.
- Preview penggantian menerima previous token agar UI memperoleh old/new total yang terikat pada context. Return `requiresIncreaseConfirmation` dan candidate fingerprint; UI hanya mengubah selected state sesudah konfirmasi jika naik.
- Place order membawa acknowledgement penggantian yang mengikat candidate fingerprint bila token menandai kenaikan, atau acknowledgement `continue_without_promo` bila flow sebelumnya gugur. Sekadar `confirmed:true` tanpa fingerprint tidak cukup. Ini kontrak persetujuan request, bukan klaim server dapat membuktikan gerakan klik manusia.
- Invalid candidate mengembalikan error tanpa menimpa token/selection lama yang masih valid. Jangan menyimpan kode invalid di URL/log.
- Place order menghitung ulang authoritative inputs; token valid tidak mengizinkan stale money. Perbedaan result/version/context mengembalikan409 dengan preview baru sebelum order/usage/stock intent dibuat. Reprice delivery existing tetap membutuhkan reapproval jika quote/approved components berubah, walau total turun; aturan konfirmasi tambahan **penggantian promo** tetap hanya saat total naik.
- Kapasitas yang habis saat commit:409 `PROMO_CAPACITY_UNAVAILABLE`, bukan mengubah nominal. Client meninjau ulang lalu membuat logical request baru; request yang belum committed tidak mengunci key ke order fiktif.
- Token expired/invalid →409/400 dengan instruksi preview ulang; tidak memperpanjang deadline order existing saat repayment.

### 5.4 Error contract

| HTTP/code | Makna dan perilaku |
| --- | --- |
| 400 `INPUT_INVALID` / `UNSUPPORTED_VERSION` | Shape/limits/versi unsupported; tidak ada mutation atau provider dispatch |
| 401 `UNAUTHENTICATED` | Session store/admin yang tepat wajib; jangan menerima cookie aplikasi lain |
| 403 `EMAIL_VERIFICATION_REQUIRED` / RBAC `DENIED` | Offer memerlukan verified email atau tindakan admin tidak authorized; checkout tanpa Offer tetap opsi yang eksplisit |
| 404 `NOT_FOUND` | Resource/key bukan milik client atau order outside admin scope; tidak mengungkap existence |
| 409 `PROMO_UNAVAILABLE` | Kode unknown/nonaktif/jalur/waktu invalid; pesan aman tidak mendiscovery kode lain |
| 409 `PROMO_INELIGIBLE` / `PROMO_CAPACITY_UNAVAILABLE` | Minimum/fulfillment/jatah/budget/quota gagal; reason aman; old valid selection tetap |
| 409 `CHECKOUT_REVIEW_REQUIRED` / `DELIVERY_REPRICE_REQUIRED` | Result/context berubah atau persetujuan belum lengkap; tidak ada accepted order |
| 409 `REQUEST_KEY_CONFLICT` | Key sama, canonical request berbeda; jangan mengembalikan atau mengubah order sebagai checkout baru |
| 409 `STALE_REVISION` / `CAPACITY_BELOW_COMMITMENTS` | Admin reload/review; tidak force-overwrite atau menurunkan limit di bawah komitmen |
| 413 `INPUT_LIMIT_EXCEEDED` | Body/workbook/decompressed/row/cart limit dilampaui |
| 429 `RATE_LIMITED` | Retry-After detik; tanpa hold/dispatch atau perubahan pilihan lama |
| 503 `PRICING_UNAVAILABLE` / `STOCK_UNAVAILABLE` / `POLICY_UNAVAILABLE` | Authoritative data/dependency tidak tersedia; fail closed, tanpa fallback harga/izin stale |
| 202 success + `state:processing` / `state:manual_review` | Order **sudah committed**, ID dikembalikan walaupun SO/Snap belum siap; client poll/read order yang sama, bukan membuat request baru |

Error tak terduga setelah commit tidak boleh tampak seolah order tidak pernah dibuat. Catch path mencari result key dan mengembalikan order/status yang tersimpan atau recovery read; jika DB tidak dapat dibaca, UI wajib retry key yang sama. Error/log tidak memuat token, kode literal, raw provider error atau PII; review token/payment redirect hanya pada success interface yang memang membutuhkannya.

### 5.5 Rate limiting — usulan teknis untuk review

Existing address limiter memakai in-process Map dan tidak cukup untuk account+IP pada beberapa proses. Gunakan counter **khusus request diskon** di PostgreSQL, bukan Redis/service atau generic anti-abuse platform baru.

| Kelompok | Per account /60detik | Per trusted IP /60detik |
| --- | --- | --- |
| Preview/available/quote yang membawa manual code | 20 | 120 |
| Preview/available tanpa manual code | 60 | 300 |
| Place order baru | 10 | 60 |

Fixed window berdasarkan server clock, atomic increment dan check kedua buckets dalam transaksi pendek dengan urutan key stabil; kedua batas berlaku. Request shape invalid pada manual-code endpoint tetap dihitung setelah authenticated admission agar tidak menjadi jalur guessing. Same successful request replay/read-only result tidak dihitung sebagai place order baru dan tidak memicu dispatch ulang; request berbeda tetap tunduk limit. Account/IP bukan entitlement; IP bersama tidak mereset atau menggabungkan jatah customer.

Counter table `discount_request_window`: key berupa HMAC pseudonymous subject, bucket kind/window start/count/expiry, unique `(kind,subject_hash,window_start)`, index expiry, CHECK count nonnegative. Raw IP dan kode tidak disimpan. Window berakhir60detik, expired records dihapus opportunistic maksimal100 row/request setelah umur10menit; jika idle cleanup menunggu request berikutnya. Ini operational ephemeral state, **bukan** business history yang boleh dipurge. Tidak membuat cron cleanup baru. Trusted IP hanya dari proxy yang meng-overwrite header dan mencegah akses publik langsung ke app; dev langsung menggunakan loopback bucket. Bila trusted identity/policy limiter unavailable, fail closed503, jangan fallback ke header forged atau limiter lokal.

Angka ini bukan hasil load test dan dapat direvisi saat review dokumen; jangan menganggapnya keputusan universal. UI debounces manual input dan mengirim lewat Terapkan, bukan request tiap keystroke.

## 6. Admin harga dan Excel

### 6.1 UX dan staging

Penempatan: Produk untuk harga/manual/bulk/Excel; Diskon untuk Coupon/manual Offer. UI memakai token/theme dan shared components admin existing: table/dialog/button/form/errors/loading yang konsisten, focus dialog, keyboard navigation, label dan status tidak bergantung warna. Tidak redesign shell/typography baru atau menyalin CSS prototype sebagai final.

Manual/bulk/Excel selalu stage → review → apply. Bulk hanya checked SKUs, retained lintas halaman, tidak select seluruh filter otomatis. Review memperlihatkan base terbaru, harga website kini, target/restore, selisih/persentase hasil, kenaikan/penurunan, row errors dan jumlah diterima. Shortcut persen memakai base lalu membekukan target fixed di preview. Restore menyebutkan Markdown terbaru akan dilepas.

### 6.2 Template/parser contract — detail teknis usulan

- `.xlsx`, satu sheet bernama `Harga`, marker pada cell A1 literal `markdown_v1` (penamaan terbaru sesuai permintaan pemilik; marker lama diterima sebagai alias dan identitas internal batch tetap kompatibel), header row2 `sku`, `action`, `new_price`; data mulai row3. Nama sheet/cell marker adalah usulan format konkret, bukan format legacy yang harus kompatibel.
- SKU harus cell text, exact match case-sensitive tanpa fuzzy/trim perubahan identity. `action` literal `set_price` atau `restore_base`. `new_price` cell numeric integer Rupiah; teks `Rp150.000`, formula, negative/fraction/NaN tidak diterima. `set_price` wajib harga; restore wajib kosong.
- Export/template boleh menambah reference columns resmi `product_name`, `variant`, `source_price`, `effective_price`, `origin_row`, `error_reason`; tidak authoritative. Unknown/missing/duplicate header dan sheet tambahan fatal. File dengan extension/MIME saja tidak membuktikan format: periksa container/signature.
- Blank seluruh row diabaikan; partially filled tanpa SKU gagal row. Semua kemunculan SKU duplikat gagal, bukan last-row-wins. Formula pada cell row termasuk referensi menggagalkan row; tidak evaluate cached result. Macro, external relationships, encrypted/unsupported workbook ditolak fatal; jangan fetch external links.
- ZIP/decompression streaming/bounded: enforce compressed bytes, expanded bytes dan row count saat membaca, bukan setelah load penuh. Proposal tambahan: maksimum200 entries ZIP,100 cell/row, panjang cell text4096; zip path traversal/duplicate entries ditolak. Tidak memilih parser/library baru melalui spec ini; implementasi wajib verifikasi API/security terkini sebelum dependency dipilih.
- Default `system_config`: `discount.import.maxRows=1000`, `discount.import.maxFileBytes=5242880`, `discount.import.maxExpandedBytes=26214400`. Batas row berlaku untuk data nonblank termasuk invalid, juga bulk UI. Config tanpa UI, update via SQL; invalid config menolak operasi baru, bukan membuka batas tanpa limit.
- Usulan pembacaan limit admin: load current config per staging/apply request agar tidak memakai cache boot store yang stale; new limit tidak menghapus batch/result committed. Saat resume, batch tersimpan yang melampaui limit baru ditahan untuk review, tanpa rollback committed.
- Workbook asli hanya sementara dalam bounded parsing dan dibersihkan pada success/error/disconnect; tidak diarsipkan durable. Row input terbatas/hasil/audit dipertahankan. Fatal parsing selesai sebelum price writes live; file fatal tidak menghasilkan success rows.
- Export/laporan/subset retry `.xlsx` menulis field text sebagai text literal, tidak formula; data diawali `=,+,-,@` tidak menjadi executable cell. Download subset tetap reuploadable dengan marker/header resmi dan linked origin metadata tervalidasi server.

### 6.3 Proposed HTTP interface

| Method/path | Kontrak |
| --- | --- |
| GET `/api/admin/price-changes/template` | Template kosong berversi; harga:view + product view-all |
| POST `/api/admin/price-changes/export` | Selected variant IDs maksimal1000; export rows dari server current data |
| POST `/api/admin/price-changes` | Request key + manual/bulk rows atau multipart workbook + reason/parent retry; stage/preview saja, return batch ID dan paginated row results |
| GET `/api/admin/price-changes/{id}` | Aggregate counts + row pagination/status, current authorized viewer, no-store |
| POST `/api/admin/price-changes/{id}/apply` | Batch request key, approved preview digest; commit bounded rows lalu return status/count/pending cursor |
| GET `/api/admin/price-changes/{id}/report` | Semua hasil atau failed subset; format xlsx; current view grants wajib |
| GET `/api/admin/prices/{variantId}/history` | Immutable revisions + actual before/after/batch/actor, pagination |

Stage requests memerlukan harga:edit; export/history/read memerlukan harga:view dan product view-all. Apply/resume memerlukan edit setiap row. Restore/manual melewati interface batch yang sama; tidak ada jalur direct update tanpa review/audit. Request key unik per actor; key sama+isi berbeda409; retry batch baru punya key baru dan parent+origin row yang sah. Parent linkage bukan izin mengakses batch/order di luar grants.

### 6.4 Apply, concurrency, dan hasil

Usulan foreground chunk: maksimum25 row atau budget5detik/request, berhenti pada batas lebih dahulu, return202 selama pending. Sebelum mulai row/retry, hitung remaining budget; timeout transaksi/statement/lock memakai minimum batas §9 dan remaining budget. Jika tidak cukup, jangan mulai row baru. Tidak ada worker yang melanjutkan sesudah request mati. Tiap row satu transaksi; jika request berakhir saat transaksi berjalan, pastikan commit/rollback aktual dan baca durable row status sebelum melanjutkan, jangan menganggap timeout HTTP sebagai rollback DB. Tidak menyimpan status `applying` permanen yang kehilangan lease tanpa jalan recovery: row lock/conditional final result menjadi claim selama transaksi.

- Lock batch→row; jika row final, return hasil existing tanpa revision/audit ganda. Dua apply/resume requests boleh race, hanya satu memfinalkan row.
- Revalidasi current policy, variant/source dan current Markdown. Target fixed valid terhadap base terbaru tetap diterapkan; invalid gagal row, tanpa menulis target.
- No-op restore tanpa Markdown/set target identik valid → `unchanged`, tidak membuat revision harga fiktif; hasil tindakan tetap diaudit sekali.
- Commit row result, revision/current pointer dan audit bersama. Failure teknis yang rolled back meninggalkan pending untuk retry; validation error final menjadi failed. Limit DB retries §9 tetap berlaku.
- Izin dicabut menghentikan write berikutnya. Pending tetap pending dengan halt reason; hasil committed tetap akurat dan hanya dapat dibaca pihak yang masih berwenang.
- Batch status `staged` sebelum apply, `in_progress` selama pending, final `applied` jika tanpa failed, `partially_applied` jika ada failed dan ada applied/unchanged, `failed` jika semua final failed. Counts applied/unchanged/failed/pending selalu menjumlah seluruh rows; no-op bukan perubahan harga.
- Contoh100 row:60 committed/37 pending/3 failed → belum final. Resume hanya37; hasil97 applied/3 failed. Koreksi3 final failed lewat batch baru linked, bukan reset batch lama.

## 7. Offer administration dan authorization

### 7.1 Draft, review, publish, code dan capacity

Offer identity memiliki activation kind tetap, state draft/enabled/paused/archived, current published revision dan policy version. Terms/benefit diedit di unpublished draft; current live tidak berubah. Review mengembalikan diff dan expected identity/draft/policy versions; publish memvalidasi dan memindahkan pointer dalam satu transaksi. Draft invalid/incomplete boleh disimpan, tetapi tidak publish. Dua admin stale409 dan reload/review; tidak force-overwrite. Usulan satu shared draft per Offer, dengan draft version monotonic agar stale save juga ditolak.

Tepat satu benefit dan typed params version1. Percentage cap nullable; fixed nominal positive; shipping cap positive. Minimum boleh0, waktu opsional. Reject unknown benefit/currency/params version pada publish/evaluation, bukan defaulting ke fixed. Live policy kuota/budget wajib minimal satu; per-account limit default1/configurable. Draft baru tanpa capacity belum launchable, bukan diberi default kuota100 dari tabel voucher lama.

Capacity fields live terpisah dari immutable terms revision. Draft boleh mengusulkan capacity, tetapi apply/publish selalu memeriksa izin sesuai perbandingan **current policy** dan guard consumed+reserved. Initial assignment/increase/removal yang memperbesar capacity memerlukan capacity:edit; pengurangan cukup promo:edit tetapi tidak boleh di bawah komitmen. Jatah akun diturunkan hanya jika seluruh account commitments terkait muat; indexed max lookup di bawah lock Offer, bukan lock seluruh histori/accounts. Minimal satu global bound tidak boleh hilang.

Manual code literal/owner immutable setelah terbit; perubahan teks membuat code record baru pada Offer yang sama. Kode lama tetap reserved, tidak bisa dialihkan ke Offer lain. Public Offer tidak memiliki code. Code aktif/nonaktif/arsip mengikuti waktu Offer; tidak punya subquota/expiry/binding terpisah. Code mutation termasuk publish/state change memerlukan version gate Offer; unique canonical berlaku global. Draft code proposals baru direservasi canonical saat transaksi publish/add-code berhasil, bukan dengan menulis code published diam-diam saat mengetik draft.

Pause/archive menolak reservation baru, tidak membatalkan hold atau mengubah snapshot. Pause/unpause enabled untuk Offer non-archived memakai version guard; archival bukan hard-delete. Spec tidak menambah workflow restore arsip atau pemindahan activation kind. Viewer menerima label masked+code ID, bukan literal di API/export/history/audit. Editor promo boleh melihat literal pada interface terlindungi; log umum tetap tidak memuatnya.

### 7.2 Proposed admin endpoints

| Method/path | Kontrak |
| --- | --- |
| GET/POST `/api/admin/discounts` | Paginated list/filter activation/state; create draft dengan request key; state tidak live otomatis |
| GET `/api/admin/discounts/{id}` | Current terms/policy, draft/version, safe code labels, aggregate usage; full literal hanya editor |
| PUT `/api/admin/discounts/{id}/draft` | Expected offer/draft versions + complete typed draft; strict fields; stale409 |
| POST `/api/admin/discounts/{id}/simulate` | Promo:view; draft simulation juga perlu Promo:edit. Synthetic line/quantity/ongkir/fulfillment terbatas dan revision/draft version → breakdown melalui Pricing; label simulasi, bukan quote/order/hold atau janji kapasitas |
| POST `/api/admin/discounts/{id}/review` | Expected versions; server diff/eligibility/config/capacity validations dan review fingerprint; tidak publish |
| POST `/api/admin/discounts/{id}/publish` | Request key, expected versions, approved review fingerprint; terms/policy/code diffs dan audit atomik |
| PATCH `/api/admin/discounts/{id}/state` | Expected version + enable/pause/archive; no usage reset |
| PATCH `/api/admin/discounts/{id}/policy` | Expected policy/Offer version + limits; serialized terhadap reserve |
| POST `/api/admin/discounts/{id}/codes` | Manual-only, request key/canonical literal/expected version; code baru tidak memindah owner |
| PATCH `/api/admin/discounts/{id}/codes/{codeId}` | Expected version + active/inactive/archive; tidak menerima literal/owner replacement |
| GET `/api/admin/discounts/{id}/usage` | Aggregate global + paginated entries hanya jika Orders grants/scope mencakup order |
| GET `/api/admin/discounts/{id}/history` | Revision/policy/state/code audit terfilter; safe literal exposure mengikuti editor, bukan audit grant saja |

Create/add-code memakai request key untuk replay; fingerprint dan result identity disimpan bersama audit dalam bounded command metadata pada Offer/code atau mutation receipt terkait, tidak mengandalkan waktu/pesan UI. Usulan receipt spesifik `discount_admin_request` dijelaskan §8; publish/state/policy memakai expected versions dan receipt yang sama agar lost response tidak menghasilkan aksi duplikat. Read APIs tidak menerima role/scope dari browser sebagai authority.

### 7.3 Permission fisik usulan

Perluas catalog, DB scope CHECK, resolver/guard, Roles matrix, policy payload, navigation dan default seed dengan tiga **Global Modules**: `prices`, `discounts`, `discount_capacity`; masing-masing `view/edit`, tanpa delete/own-branch actions. Products edit/re-sync tetap terpisah.

| Tindakan | Grants dan guards |
| --- | --- |
| Existing product visibility | `products:view` scope existing; stock tidak melebar karena grant harga |
| Price history/batch/export/template | `prices:view global` + `products:view all_branches` |
| Stage/manual/bulk/import/apply/restore/resume | Di atas + `prices:edit global`; current policy per write row |
| Promo list/detail/global aggregate | `discounts:view global`; masked code untuk non-editor |
| Draft/review/publish/state/code, penurunan limit | `discounts:view/edit global`; version guard; penurunan tidak melanggar komitmen |
| Initial/increase/removal capacity yang memperbesar | `discount_capacity:view/edit global` + `discounts:view/edit global` |
| Capacity management fields | `discount_capacity:view` + `discounts:view`; summary budget tetap terlihat oleh promo viewer |
| Literal kode | `discounts:view/edit`; termasuk API/export/history; log umum tetap tanpa literal |
| Redemption list/detail | `discounts:view` + `orders:view` authorized scope; tanpa Orders hanya aggregate tanpa identities |
| Audit Log umum | `audit_log:view all_branches` untuk event global; audit grant sendiri tidak membuka kode |
| Mengatur grants | `roles:view/edit`, ceiling/coverage/self-role protection existing; bukan hardcoded role name |

Default seed **baru**: System Owner tetap full; HQ mendapat ketiga view/edit dan existing product view-all; Admin tidak mendapat grants baru. Role existing custom tidak mendapat auto-grant saat migration. Owner/authorized grantor mengatur secara eksplisit sebelum UAT. Missing Current Policy fail closed; URL/API/export/resume tidak bypass. Re-sync tidak mempunyai izin menulis Markdown/Offer.

Proposal enforcement race: setiap mutation/row admin membaca ulang actor active/assignment dan Role version dalam transaksi, mengambil shared locks Admin User lalu Role sebelum domain locks; Roles edits existing mengunci role row, Users edits mengunci user row sehingga revoke serial terhadap write ini. Tidak mengambil target admin/user lock setelah role lock domain. Audit policy version aktual dan commit yang menang; pencabutan setelah satu row commit berlaku pada row berikutnya. Jika audit semua paths menunjukkan lock conflict baru, laporkan sebelum implementasi path terkait, jangan mengganti aturan current-policy.

## 8. Physical data contract — usulan SQL/Drizzle target

Schema hanya di `packages/db/src/schema/`; timestamps selalu `timestamptz`, inserts Date. IDs text UUID kecuali referensi existing/provider integer. Money relational `numeric(15,2)` dengan finite/nonnegative CHECK dan **integer Rupiah untuk rows kontrak baru**; rate `numeric(9,6)`. Versions integer positif monotonic. Bounded JSON typed/versioned, bukan pengganti ownership FK atau money columns.

### 8.1 Records dan keys

| Record | Kolom/keys wajib |
| --- | --- |
| `variant_price_revision` | id PK, variant_id RESTRICT, revision_no, action set/restore, target nullable hanya restore, source/effective/current target before-after actual, actor nullable SET NULL + safe attribution, batch/row attribution, created_at; unique `(variant_id,revision_no)` dan `(variant_id,id)` untuk ownership |
| `variant_price_current` | variant_id PK RESTRICT, revision_id/version/updated_at; composite FK `(variant_id,revision_id)` ke revision; restore pointer dipertahankan |
| `price_change_batch` | id, actor/attribution, request_key/fingerprint, source manual/bulk/xlsx, template_version, parent_batch_id RESTRICT nullable, reason, state/counts/halt_reason, created/updated; unique `(actor_identity,request_key)` yang attribution-nya tidak hilang jika FK actor null |
| `price_change_batch_row` | id,batch_id RESTRICT,row_number, bounded input_sku/action/target, variant_id nullable RESTRICT, preview JSON, state/result_code, actual before-after, applied_revision_id nullable, origin_retry_row_id nullable RESTRICT; unique `(batch_id,row_number)` |
| `discount_offer` | id/key unique, activation_kind, state, current_revision_id nullable untuk draft, identity version, draft version, quota_count/budget_amount nullable, per_client_limit default1, policy_version, actor/times; unique `(id,activation_kind)` dan composite ownership current pointer |
| `discount_offer_revision` | id,offer_id RESTRICT,revision_no,name/terms,currencyIDR,min_subtotal,start/end nullable, schema/engine_version, draft_version,published_at nullable, actor/times; unique `(offer_id,revision_no)`, `(offer_id,id)`, partial unique satu unpublished draft/offer |
| `discount_benefit` | id,revision_id RESTRICT unique,kind/scope,rate/fixed_amount/cap_amount sesuai kind,params_version/params bounded; unique `(revision_id,id)`; exactly one saat publish melalui transaction guard |
| `discount_code` | id,offer_id/manual activation ownership RESTRICT,canonical_code unique,state,published_at,actor/times; unique `(offer_id,id)`; CHECK canonical/charset; published literal+owner immutable via authorized module |
| `discount_offer_usage` | offer_id PK RESTRICT,reserved_count/amount,consumed_count/amount,version/updated; dibuat bersama identity dan default counters0 |
| `discount_client_usage` | `(offer_id,client_id)` PK, kedua FK RESTRICT,counters/amount/version; initialized conflict-safe sesudah parent Offer lock |
| `discount_redemption` | id,order_id unique RESTRICT,client_id,offer_id,revision_id,code_id nullable,activation,status reserved/consumed/released,benefit_amount positif,deadline,policy/engine/contract versions,terms/result snapshot,terminal metadata/times |
| `discount_redemption_event` | id,redemption_id RESTRICT,event_key unique,event kind reserved/consumed/released/late_paid_review,previous/next status,amount,source/correlation,reason/actor/time; append-only, no refund event |
| `order_discount_allocation` | id,order_id/item_id nullable RESTRICT,component markdown/offer_goods/offer_shipping,markdown_revision_id atau redemption_id+benefit_id,amount positif,snapshot/version; shape checks dan ownership composite FKs |
| `checkout_request` | id,client_id RESTRICT,request_key,fingerprint,status accepted,result JSON bounded,order_id nullable unique RESTRICT,times; unique `(client_id,request_key)`; accepted result dalam commit order |
| `discount_admin_request` | id,actor_identity/request_key unique,fingerprint,action,target_id,version/result JSON bounded,actor nullable SET NULL,times; immutable accepted receipt dalam transaksi Offer/code/audit, tanpa kode literal di result umum |
| `discount_request_window` | Ephemeral counter dari §5.5; tidak FK client agar cleanup rate state bukan deletion path histori; unique bucket key dan expiry index |

Draft baru boleh belum memiliki global limit/current revision; DB CHECK mewajibkan minimal quota/budget **ketika state bukan draft**, publication guard mewajibkan revision+benefit valid. Ini cara fisik merepresentasikan kontrak draft belum launchable, bukan default kapasitas tersembunyi. Draft terms/candidate codes terbatas disimpan sebagai draft data; `discount_code` durable dicatat saat publish/add berhasil. Draft edit boleh menimpa unpublished draft saja; published revisions tidak berubah.

Idempotency receipt bukan generic event bus atau ledger provider kedua. Actor identity untuk keys tetap immutable string walaupun FK user menjadi null; perubahan atribusi FK tidak membuka reuse request key.

### 8.2 Ownership dan invariants

- FK Redemption→order/client menjamin owner client sama dengan order, revision milik Offer, code milik Offer manual, benefit milik revision terpilih. Composite unique parent disediakan untuk setiap composite FK; public code null/manual code wajib lewat CHECK+publication/reserve guard.
- Allocation item/redemption harus milik order yang sama; Markdown revision variant harus sama dengan item variant; goods allocation wajib item/redemption/benefit, shipping tanpa item, Markdown tanpa redemption. Unique source/destination/component mencegah allocation ganda.
- `UNIQUE(redemption.order_id)` untuk semua status; tidak unique Offer/client pada Redemption karena limit configurable dan safe release boleh checkout berikutnya. Capacity memakai locked usage, bukan unique constraint palsu.
- Shape benefit: percentage goods rate>0..100, cap opsional positif dan fixed null; fixed goods nominal positif dan rate/cap null; shipping cap positif dan rate/fixed null. Unknown version/kind ditolak.
- Usage counters/amount finite nonnegative; constraints tidak cukup untuk kapasitas. Module menjamin reserve penuh, projection/event konsisten dan sum allocation tepat.
- Published history/snapshot/amount immutable melalui sanctioned write modules; tidak mengklaim ordinary CHECK dapat menegakkan cross-row sum atau immutability. DB tests menguji constraints, module tests menguji write-path guards.
- Source pointer/fallback bukan CHECK target<source mutable: validasi terbaru saat apply, lalu source dapat turun tanpa menghapus target.

### 8.3 Order, item, delivery, provider snapshots

Tambah versioned pricing snapshot relational+bounded JSON pada order/item. Usulan nama `pricing_contract_version=1`, `pricing_engine_version=1`, `provider_contract_version=2` untuk order baru. Payload legacy tanpa explicit version dibaca oleh **decoder legacy eksplisit**, tidak ditebak sebagai versi2; legacy dipertahankan snapshot-nya, tanpa dual-write/backfill voucher.

| Lokasi | Data target |
| --- | --- |
| Order header | currencyIDR,source_goods_subtotal,markdown_total,subtotal setelah Markdown,discount goods,net_goods,shipping_before_subsidy,shipping_subsidy,shippingCost net customer,merchant funding,quote/provider cost known nullable,taxable_base,ppn_rate/amount,total,expected_provider_payable,versions,optional checkout request FK |
| Item | Source SKU/label/variant snapshot,quantity,source_unit_price,effective price existing,Markdown revision/context,whole-line Markdown/goods coupon amounts,net line,version; unique `(order_id,variant_id)` untuk canonical cart line |
| Delivery | Existing address/origin/parcel/service payload dibekukan. `service.shippingCost` tetap ongkir quote **sebelum subsidi**; `pricing.shippingCost` net customer, ditambah explicit original/subsidy/provider-cost fields dan snapshot version. Jangan mengganti ongkir booking dengan net subsidi. Biaya billed belum diketahui tetap null, ditambahkan lewat shipment ledger existing. |
| Sales operation | Payload/contract version,immutable request + expected money/identity,returned IDs segera jika ada,verification/review evidence; reuse existing create/cancel/invoice/payment unique `(order_id,type)` |
| Channel mirror | Expected/provider version dan linkage memakai order snapshot/ledger existing; preserve SO/detail/invoice/payment IDs, jangan membuat ulang create intent |

Semantik existing: `orders.subtotal` setelah Markdown sebelum kupon, `orders.discount` kupon barang, `orders.shippingCost` net ongkir, `order_item.price` effective unit sebelum kupon. `serviceFee/service_fee` jika dipertahankan untuk shape existing harus0 pada kontrak baru, tidak ditampilkan sebagai charge. `voucher_id` text tidak ditulis untuk fitur baru; legacy tabel/route hanya dihapus pada cutover yang direview, bukan sumber usage baru.

Order detail/account/admin/email dan Midtrans item details harus membaca snapshot ini. Midtrans goods memakai effective item amounts + goods discount adjustment sekali, PPN dan net shipping; jumlah detail persis total, tanpa service fee line. Tidak mengurangi subsidi lagi setelah memakai net shipping. Label manual code pada order hanya kode yang customer itu gunakan, bukan daftar kode Offer; viewer admin tetap masked sesuai grants.

### 8.4 Retention dan indexes

- Ubah client→order menjadi RESTRICT. Order→items/redemptions/allocations/checkout results/Sales operations/channel evidence/shipment/tracking/booking reviews tidak boleh cascade kehilangan histori. FK retention terkait RESTRICT; nullable address book link tetap SET NULL karena snapshot alamat berdiri sendiri.
- Published revisions, codes yang terbit, batch/rows final, accepted requests, events, allocations dan provider evidence tidak dipurge otomatis. Histori Markdown juga melindungi variant/catalog yang dirujuk dari cascade delete. Offer/code diarsipkan; tidak reuse published literal.
- Client dengan transaksi/usage/request dipertahankan; tidak membangun erasure/anonymization/account merge. Retention fase ini bukan klaim kepatuhan hukum. Actor nullable mengikuti audit attribution existing tanpa cascade evidence.
- Index wajib: owner/revision unique/composite keys, code canonical unique, current variant PK, offer usage PK, client usage PK, redemption order unique dan `(status,deadline)`/`(offer_id,client_id,created_at)`, event unique key/`(redemption_id,created_at)`, allocation order/item/redemption, batch actor/request dan `(batch_id,status,row_number)`, checkout owner/key dan order link, admin receipt actor/key, Offer state/activation/current pointer serta validity lookup. Index FK lookup retention untuk menghindari scans saat parent mutation.
- Tidak membuat index `now()` time-dependent, GIN seluruh JSON, purge histori, atau tabel kosong targeting/reward. EXPLAIN/rehearsal pada fixtures sesuai bounds membuktikan hot paths tidak scan seluruh histori.

## 9. Transaksi, lock ordering, dan idempotency

### 9.1 Place order

1. Authenticate, validate bounds; hitung canonical request fingerprint, cari accepted result `(client,key)` **sebelum membaca cart yang mungkin sudah dibersihkan**. Same key+fingerprint → order sama tanpa requote/reprice/reserve/dispatch ulang; berbeda409.
2. Untuk logical request baru: rate gate, owned cart/current price/promo inputs, live stock dan fresh delivery quote dilakukan **di luar** transaksi. Verify review/quote approvals. Tidak ada order/usage atau provider business POST di sini.
3. Transaksi pendek: client lock, claim request key, Offer/code/usage, source/Markdown, order/redemption, stock, operation sesuai urutan §9.2. Concurrent same-key yang kalah membaca accepted result, tidak external dispatch.
4. Revalidasi client verified state, active Offer/time/revision/code/policy/full benefit, price/current context/source, quote input fingerprint dan stock observation. Server changes setelah preview tidak memakai token sebagai izin stale. Jika source berubah saat fresh quote berlangsung, rollback+review ulang, jangan HTTP di dalam lock.
5. Satu commit: optional address save dengan existing saveRequestId, order/items/snapshots/allocations, Redemption+reserved event+counters, stock hold, durable SO intent, checkout accepted result. Any failure rollback seluruhnya tanpa accepted order/hold parsial.
6. Setelah commit, gunakan existing ledger single dispatch SO → independent GET → existing payment initialization. Returned order ID selalu dapat dibaca. Ambiguity tetap hold/manual review, tidak membuat order/SO baru otomatis.
7. Same-key replay mengembalikan current committed order result/redirect yang sudah ada. Tidak me-refresh payment deadline. Jika crash sebelum external claim, existing system recovery boleh mengambil **intent belum dispatched** melalui satu claim; jika sudah claimed, hanya reconcile sesuai contract, tidak re-POST. Tidak menambah worker/outbox subsystem kedua.

Canonical fingerprint memuat seluruh user intent: sorted selected cart IDs, requested fulfillment/slot/contact, destination/service/origin, save-address intent, pilihan Offer/code canonical/none, approved review fingerprint dan acknowledgements. Tidak memasukkan metadata transport/requestId. Source/promo aktual sesudah sukses tidak dihitung ulang saat replay; stored accepted fingerprint/order adalah authority. Rejected-before-commit key tidak memiliki result fiktif; retry tetap melewati review/capacity/stock terbaru.

### 9.2 Urutan lock global dan bounded execution

Untuk paths yang memerlukan beberapa kelompok, urutan global berikut wajib; skip kelompok yang tidak diperlukan, jangan mengambil kelompok terdahulu setelah kelompok berikutnya:

1. Client owner; atau prefix Current Policy Admin User→Role untuk mutation admin.
2. Checkout request; atau admin request receipt; atau batch→batch row pada price apply.
3. Offer identity→code IDs stabil→offer usage→client usage.
4. Variant/source→current Markdown, sorted variant ID. Kunci source row juga menyelaraskan sync master biasa; current row pertama diinisialisasi conflict-safe di bawah variant lock.
5. Existing order→Redemption, sorted order ID.
6. Branch stock, sorted `(branch_id,variant_id)`.
7. Existing provider operation/channel ledger yang dimutasi.

Discovery via unlocked read boleh untuk menemukan client/Offer/order IDs pada callbacks; sesudah locks wajib reread dan revalidate identity/state. Semua reserve/consume/release/publish/policy paths mengunci Offer sehingga pengurangan limit dan lookup commitments konsisten. Source/stock sync tidak boleh memperoleh Offer/order lock setelah stock; tidak membuat HTTP di transaksi.

Target integration audit mencakup checkout, optional address save, Midtrans webhook, sweep/failure/late settlement, SO definitive rejection, confirmed cancel/stock accounting, recovery, admin publish/policy/price apply, sync, serta fulfillment gate. Existing code belum diklaim mengikuti urutan ini. Khusus confirmed cancel, bukti provider didapat di luar DB; final accounting promo+stock+operation dilakukan dengan urutan di atas, bukan mengambil Offer setelah operation terkunci.

Usulan bounds: lock wait2detik, statement5detik, transaction wall ceiling10detik; paling banyak3 attempts total untuk PostgreSQL deadlock/serialization yang **terbukti seluruh transaksi rollback**, jeda25ms lalu75ms, seluruh external dispatch hanya setelah commit menang. Lock timeout/overload mengembalikan503 untuk logical request baru; jangan retry unbounded atau terus memegang transaksi sambil menunggu HTTP. Batas50 cart lines dan chunk25 row membuat work bounded; semua angka tetap perlu diuji di implementation environment.

### 9.3 Lifecycle atomik dan projection drift

- Paid authoritative pada reserved: order paid attributes + reserved→consumed + counters count/amount + consumed event committed bersama. Jangan claim paid di transaksi terpisah yang meninggalkan promo reserved tanpa recovery. Provider fulfillment blocked tidak membatalkan consumed.
- Unpaid terminal authoritative **dan** provider safe: reserved→released + projection/event + accounting stock yang terkait sekali. Jika cancel masih intent/dispatched/ambigu, Redemption tetap reserved walaupun local order gagal/expired.
- Provider create definitive pre-apply rejection: bukti tidak diterapkan + local failure dapat mengakhiri hold dalam transaksi yang sama; generic5xx bukan definitive rejection.
- Duplicate webhook/sweep callbacks: unique authoritative event key + conditional transition; duplicate no-op, bukan decrement counter dua kali. Simpan source/transaction correlation tanpa raw secrets.
- Late paid sesudah released: paid dicatat + unique late_paid_review, fulfillment blocked; Redemption tetap released, tidak reacquire kapasitas yang sudah dilepas ke customer lain. Jika cancel path sudah dimulai walau hold masih reserved, catat paid dan consume hold sesuai authority, tetapi settlement/fulfillment tetap blocked untuk review.
- Late paid saat belum pernah release/cancel dan SO masih active boleh melewati existing late settlement, tetapi recordPaid/capacity guards sama; tidak melewati versi/snapshot/provider verification.
- Counter dibanding ledger melalui targeted reconciliation per Offer/redemption dan laporan review. Drift fail closed untuk mutasi Offer terkait; tidak reset/rebuild counters online atau mengarang usage. Tidak menambah analytics eventual sebagai sumber kapasitas atau cron baru; gunakan observability/review existing dan pemeriksaan bounded pada interface lifecycle.

## 10. Jubelio/Midtrans integration dan verifikasi

### 10.1 Mapping kontrak baru

| Field provider | Expected dari snapshot versi2 |
| --- | --- |
| `items[].price` | Source unit Base Price, bukan effective Markdown |
| `qty_in_base` | Qty snapshot |
| `disc_amount` | Markdown whole-line + goods Offer allocation whole-line |
| `disc` | Persentase turunan `100 × disc_amount/(price×qty)` untuk gross positif; tanpa rounding dini, bukan diskon kedua |
| `amount` | Gross line − whole-line discount |
| `sub_total` / `total_disc` / `add_disc` | Σgross / Σwhole-line discount /0 |
| `original_shipment_cost` | Ongkir customer sebelum subsidi, pickup0 |
| `shipping_cost` | Net ongkir customer, pickup0 |
| `shipping_cost_discount` | **Omitted pada actual request**, bukan0/null/empty string walau GET response default0 |
| `tax_amount`,`total_tax`,`add_fee`,`service_fee` |0, valid No Tax record dengan rate0, source INTERNAL |
| `grand_total` / invoice / payment amount | Net goods + net shipping = expected_provider_payable |

Tidak memakai header discount nonzero, source/account workaround, unit price diturunkan untuk menyembunyikan diskon, atau payment nominal dinaikkan. PPN website/merchant subsidy funding/quote/billed courier cost terpisah; bukan otomatis dijurnal provider. Gross line0 tidak dibagi0; dukungan input di luar evidence tidak diasumsikan. Scope Rp0 tetap sesuai §1.4 tanpa requirement pembuktian baru.

### 10.2 Perubahan integration wajib

- Extend request DTO/snapshot di shared schema dengan version dan original/net shipping, per-line discount dan expected identity/money. Legacy decoder explicit tetap mempertahankan snapshot lama, bukan menerapkan formula2 ke payload lama.
- Ganti zero-discount guard **hanya** pada decoder/builder contract2 yang valid dan tested. Provider tax tetap0. Jangan menghapus validasi identity, finite money, unit/tax/source atau pre/post edit.
- Create/GET verifier membandingkan expected snapshot, bukan menjumlah ulang response lalu menganggapnya benar. Decimal serialization seperti `10000.0000` dinormalisasi exact; selisih Rp1 atau missing field wajib menahan tahap berikutnya.
- Invoice-only conversion lalu payment terpisah tetap Path1. Ganti **semua** penggunaan subtotal sebagai payable di ensure invoice/payment, GET recovery, mirror, fulfillment/delivery settlement gates dan admin display untuk contract2 dengan expected_provider_payable. Legacy branch tetap membaca contract lamanya.
- Invoice confirmation: SO.invoice_id dan identity invoice/baris/contact/location/uang/linkage; invoice.salesorder_id null tidak otomatis gagal jika accepted linkage lain cocok. Metadata original hanya diwajibkan di SO karena invoice tidak mengeksposnya.
- Payment confirmation: expected amount, account/type intent yang sah, tepat satu association ke invoice/SO benar, invoice paid amount exact dan due0. SO.is_paid sendiri bukan authority.
- Persist returned SO/invoice/payment/detail IDs segera bila tersedia **sebelum** verification berikutnya dapat gagal; confirmed pointers hanya setelah verification. Unknown ID tanpa handle → manual review, bukan create baru.
- Mirror: GET preflight dari version/expected envelope, full payload preserve IDs/unit/source/location/tax/financial/nonfinancial protected attributes; only intended status changes; GET postflight memastikan SO/invoice/payment linkage/money tetap. Jangan menyalin response shipping discount default0 ke request.
- Mirror failure dicatat/review, tidak membatalkan paid atau settlement yang sudah terbukti dan tidak memberi izin fulfillment sendiri. Tahap `Menunggu Verifikasi`, `Siap Proses`, `Selesai` mengikuti lifecycle existing, bukan label sebagai bukti finansial/WMS.
- Delivery quote/service cost dan booking expected quote tetap original sebelum subsidi. Packing/booking/recovery membaca snapshot, tidak menerapkan equality net shipping=provider quote. Guards baru membandingkan komponen yang benar agar subsidy tidak membuat false mismatch atau mengurangi courier cost.
- Midtrans initialization/repayment item details dan gross amount persis total customer snapshot. Paid authoritative hanya dari verified GET status existing, termasuk amount/order identity, bukan raw webhook/status label browser.

### 10.3 Failure dan evidence

Intent dicatat sebelum write dan at-most-once dispatch claim existing dipertahankan. Timeout/5xx/sukses tanpa ID/independent GET gagal/mismatch → tahan tahap berikutnya dan simpan safe expected/observed evidence. Jangan blind retry POST, cancel/cleanup ambiguity, menurunkan diskon, atau menganggap missing list sebagai rollback. Customer paid tetap paid/consumed, fulfillment blocked sampai settlement terbukti.

Evidence08 mendukung whole-line discount, precision/fixed/capped dua baris dan mapping terpilih; T1/T2 mendukung invoice/payment qty1/qty2 dan T3 safe pre-invoice cancel. Evidence M1/M2 mendukung post-invoice/payment marker preservation pada source INTERNAL/tax0/account2/type0, satu baris qty1/qty2,10%,original30000/net10000. SO68443/invoice45974/payment59 dan SO68444/invoice45975/payment61 adalah evidence research, **bukan fixtures reusable otomatis** atau izin edit lagi. Multi-line/fractional/semua config post-invoice tidak disebut universally verified.

App coverage tetap wajib lewat controlled external seam dengan expected independen dan version guards. Tidak mengulang research provider atau menambah launch blocker universal tanpa gap konkret. Jika integration menemukan fakta di luar envelope yang mengubah kontrak, tahan path terkait dan minta keputusan/bukti bounded yang diizinkan terpisah. **Pembuktian Rp0 tidak dibuka kembali.**

## 11. Lifecycle dan batas operasional

| Kejadian | Order/payment | Redemption/capacity | Tindakan |
| --- | --- | --- | --- |
| Preview/pilih kode | Belum ada order | Tidak ada hold | Re-evaluate current inputs |
| Place commit | Pending payment | Reserved benefit penuh/count/jatah | SO intent, HTTP sesudah commit |
| Payment attempt deny/cancel/nonterminal | Order tetap aktif | Reserved | Retry order sama; tidak memperpanjang deadline |
| Deadline lewat/GET payment unreachable | Belum membuktikan unpaid terminal | Reserved | Sweep memeriksa; tidak release karena clock saja |
| Unpaid terminal, cancel confirmed safe | Failed/cancelled sesuai existing | Released sekali | Promo+stock accounting/event atomik |
| Paid authoritative, provider belum confirmed | Paid/processing, blocked | Consumed sekali | Existing ops review; tidak auto-refund atau re-POST |
| Paid dan settlement confirmed | Pickup ready sesuai guards atau delivery processing | Consumed | Normal fulfillment existing; mirror informational |
| Paid setelah safe release/cancel | Paid/processing, blocked | Tetap released + late review event | Tidak rebut capacity atau buat replacement SO |
| Refund manual eksternal | Tidak membangun sync refund | Consumed/history tetap | Penyelesaian manual di luar aplikasi; tidak restore jatah/budget |

Ops existing menerima order ID, stage, expected/observed safe money, provider IDs jika ada, failure/review reason dan correlation. Jangan menambah role/SLA/tooling refund/komunikasi otomatis di scope ini. Interface admin tidak mempunyai reset usage, force release promo atau retry provider write baru. Pause Offer menghentikan penggunaan baru; hold lama tetap snapshot.

Logging wajib melalui structured logger masing-masing app pada semua endpoint baru/berubah: info success, error contextual failure, warn/info denial; requestId/correlation, actor/client IDs yang diperlukan, Offer/order/batch/version, counts/outcome dan expected/observed money aman. Jangan log kode literal, tokens, phone/address/email/raw provider responses atau review token. Business audit immutable terpisah dari runtime logs. General audit menyimpan code ID/masked label, bukan literal yang bocor ke audit viewer.

## 12. Acceptance, tests, dan evidence register

### 12.1 Seams dan prior art

Seams L/T/H/B/P/D mengikuti acceptance12 yang sudah disetujui dan checkpoint drafting. Concrete interfaces §2/§5–§7 adalah proposal yang direview bersama spec ini, bukan izin menulis tests sekarang.

- **L:** evaluatePricing/projection public interface, expected literals §4.4; prior art [order pricing tests](../../../apps/store/src/lib/order-pricing.test.ts), bukan memanggil engine untuk membangun expected.
- **T:** real PostgreSQL melalui public checkout/admin/lifecycle interfaces dan documented read results; prior art [ledger races](../../../apps/store/src/lib/jubelio-sales-operations.db.test.ts), [stock holds](../../../apps/store/src/lib/jubelio-sales-holds.db.test.ts), [checkout live stock](../../../packages/db/src/checkout-live-stock.db.test.ts), [Roles module DB](../../../apps/admin/src/lib/rbac/roles-service-db.test.ts). Direct SQL hanya untuk setup/cleanup/constraint seam, bukan private-state assertion aplikasi.
- **H:** actual application HTTP, current policy/owner, status/error/replay dan controlled Jubelio/Midtrans/Shipment/email adapters. Prior art [gateway](../../../apps/store/src/lib/jubelio-sales-client.test.ts) dan [delivery approval](../../../apps/store/src/lib/delivery-order.test.ts). Assertions jumlah provider writes sah di external seam; bukan mocks internal collaborators.
- **B:** Playwright real browser+app HTTP+disposable PG, usulan specs `e2e/store/discounts.spec.ts`, `e2e/store/markdown.spec.ts`, `e2e/admin/discounts.spec.ts`, `e2e/admin/price-changes.spec.ts`; diisolasi melalui mock-only config. Prior art [pickup mock](../../../e2e/store/pickup-mock.spec.ts) dan [RBAC security](../../../e2e/admin/rbac-security.spec.ts). Bukan component snapshot atau stub checkout response.
- **P:** evidence08/T1–T3/M1–M2 yang tersedia dan hanya protokol tambahan jika gap konkret disetujui terpisah. Mock green bukan bukti provider universal.
- **D:** generated migration review, disposable migration/seed rehearsal, readers/writers versions dan authorized rollout/rollback; bukan izin reset data nyata.

TDD satu vertical slice red→green; fixtures/clock/failure terkontrol, barrier deterministic untuk concurrency bukan sleeps acak. Tiap regression berawal failing test di public seam. Environment tidak siap/skips dilaporkan blocked, bukan dianggap pass. Semua UI berubah wajib browser coverage termasuk direct API denials, bukan hanya tombol hidden.

### 12.2 Traceability seluruh acceptance12

Semua baris **belum diverifikasi pada implementasi baru**. Kolom bukti adalah rencana; evidence research existing hanya pada P yang disebutkan.

| ID | Acceptance observable | Interface/test/evidence |
| --- | --- | --- |
| M01 | Harga SKU150000 dari base300000 sama di cabang berbeda; katalog/detail/cart/checkout konsisten, stock branch tetap | Pricing/projection + product/cart/preview HTTP, markdown Playwright; L/H/B |
| M02 | Base120000/150000 fallback tanpa badge; naik400000 target150000 aktif lagi | Source sync fixture→projection/read UI; L/H/B |
| M03 | Set/restore memakai terbaru saat apply, audit actual, order lama tetap | Price batch apply/history + order read; L/T/H/B |
| X01 | Upload tidak live; bulk persen fixed, kenaikan terlihat, selection lintas halaman | Stage/review/apply, price-changes Playwright; L/H/B |
| X02 | Fatal workbook menolak file; row formula/SKU/duplikat gagal tepat tanpa evaluate | HTTP upload/report public parser flow; independent workbook fixtures; L/H/B |
| X03 |97 applied/3 failed, no-op/pending dibedakan dan error row jelas | Apply/read/report; real PG dan UI; T/H/B |
| X04 |60 committed/37 pending/3 failed; resume hanya37; retry3 batch linked baru | Parallel apply/resume + read/history; T/H/B |
| X05 | Source/target/variant/permission berubah; write terbaru valid saja dan halt revoke | Apply with controlled current changes + HTTP denial/UI; T/H/B |
| X06 |1000 rows/5MiB/25MiB tepat batas versus berlebih; chunk bounded | Upload/generator independent lengths, bulk50/1000, apply/report; L/T/H; bukan benchmark claim |
| C01 | Public tanpa claim; satu slot goods/shipping/manual | Preview/place/order read + picker/code browser; T/H/B |
| C02 | Replace valid total naik konfirmasi/batal; sama/turun langsung | Preview/token + customer dialog dan server ack; L/H/B |
| C03 | Kode invalid/kehabisan capacity tidak mengganti old valid | Preview error + selected state/breakdown browser; H/B |
| C04 | Cart/minimum/pickup menggugurkan promo, pilih ulang/continue without explicit | Preview/place review guards + browser; L/H/B |
| C05 | Start inklusif/end eksklusif, WIB, minimum/verified/canonical/limits | Pricing/publish/preview/place di controlled clock; L/T/H/B |
| C06 | Budget/jatah habis sesudah preview menolak commit tanpa partial order/stock | Concurrent place→result/read, no external write pada loser; T/H/B |
| C07 | Account/IP limit dan shared IP bukan identity, kode manual tidak discovery | HTTP buckets lintas proses dengan controlled window dan spoofing; H/B |
| F01 | Percentage cap/uncapped/fixed/shipping/qty2 sesuai literals dan allocation tepat | evaluatePricing + order snapshot + browser totals; L/T/H/B |
| F02 | PPN net barang, tanpa service fee, detail Midtrans/repayment persis snapshot | Pricing/quote/place/repayment dan captured external payload; L/H/B |
| F03 | Invalid config tidak publish, benefit0 tidak diterapkan/tidak usage | Publish/evaluate/place; L/T/H/B; tidak memuat payment/provider Rp0 proof |
| T01 | Dua akun berebut slot/budget terakhir dan akun berebut jatah1/2 tidak oversell | Real PG parallel checkout; read result/usage authorized; T/H |
| T02 | Rename/revision/pause/code/email tidak reset usage/hold snapshot | Admin mutations→checkout/lifecycle/order read; T/H/B |
| T03 | Policy/publish/pause versus reserve serial, limit di bawah komitmen ditolak | Real PG races dan HTTP admin; T/H |
| T04 | Same-key paralel/replay sama order, changed intent409, crash commit terjaga | place/result public seams + failure injection/external dispatch ledger; T/H/B |
| T05 | Duplicate/out-of-order paid/expiry/sweep tidak double transition/counter negatif | Authoritative payment HTTP + lifecycle/read usage; T/H |
| T06 | Master price/promo/tax/quote/address berubah tidak reprice order/recovery | Order/repayment/provider intent and GET recovery; L/T/H/B |
| P01 | Mapping per-line/add_disc0/original/net/omission, invoice/payment exact | Gateway external HTTP contract tests + evidence08/T1–T3; L/H/P |
| P02 | Timeout/5xx/missing ID/GET fail/mismatch1 menahan tahap berikut, no blind retry | Controlled external faults→ledger outcome/order blocked; T/H/B/P bounded research |
| P03 | Mirror pre/post invoice/payment preserve IDs/uang/linkage, bukan paid authority | Mirror external HTTP + M1/M2 existing; H/P; integration belum verified |
| S01 | Deny/retry/deadline/ambiguity tetap hold dan deadline sama | Finalizer/payment/sweep HTTP + order/usage read; T/H/B |
| S02 | Unpaid terminal+safe cancel release sekali, tanpa post-invoice cancel | Lifecycle/stock+promo accounting + T3 evidence; T/H/B/P |
| S03 | Late paid after release dan paid-but-blocked diakui tanpa merebut kapasitas | Payment/sweep race→order review/read usage + browser detail; T/H/B |
| S04 | Refund manual eksternal tidak sync/restore usage/snapshot | Tidak ada refund mutation baru; lifecycle interface menolak unsupported events; T/H |
| A01 | Direct URL/API/export/apply/resume/revoke current grants tanpa bypass re-sync | Real admin HTTP + browser authorized/denied personas; T/H/B |
| A02 | Tanpa capacity grant initial/increase/removal ditolak; fresh HQ/Admin seed tepat | Publish/policy+Roles grants/read; T/H/B |
| A03 | Viewer tidak menerima code literal lewat API/export/history/audit atau order cross-scope | HTTP response/privacy + Playwright; H/B |
| A04 | Draft tidak live, diff/publish, stale409, audit actual/version tanpa secrets | Admin public mutations/read history, concurrent edits + browser; T/H/B |
| D01 | Owner FK/one-slot/one-benefit/canonical reservation/retention restrict | SQL constraint seam + sanctioned mutation failure; T/H |
| D02 | Shared schema/timestamptz/seed/versions, rehearsal dan rollback menjaga evidence | Generated SQL review + disposable DB migration/seed + deployment rehearsal; T/D |
| D03 | Unknown kind/params version fail closed; tanpa targeting/reward tables kosong | Publication/evaluation/decoder; L/T/H |
| R01 | Staging owner/tester UAT lalu publik; pause satu Offer tidak mengubah old orders | UAT checklist/token UI/current grants + release evidence; H/B/D |

Tambahan coverage untuk detail proposal: code charset/length3/64, rate6 digits, total overflow/unsafe numeric,50 variants/qty99, request byte bounds, token expired/client mismatch, fingerprint ordering/duplicate IDs, code guessing/per-IP forged header, paired original/net courier costs, source sync versus apply, policy revoke saat resume, receipt actor-null retention, draft tanpa capacity tidak publish, simulasi admin tanpa hold/quote promise, unknown decoder, dan initial never-dispatched intent recovery. Expected dari literal/independent fixtures, bukan engine yang diuji.

### 12.3 Command plan dan laporan

Saat implementasi diizinkan kelak, gunakan [testing guide](../../../docs/testing/README.md) dan disposable DB. Ini command plan, **belum dijalankan pada drafting**:

- Focused Vitest melalui workspace sesuai public module/route tests, lalu `npm run test:unit -- --no-file-parallelism` untuk full regression logic/DB.
- Browser coverage via `npx playwright test --config=playwright.mock.config.ts` dengan specs baru dimasukkan secara eksplisit pada isolated config; actual app HTTP/PG, fake provider credentials, SMTP suppressed, tidak reuse live dev server.
- Lint store/admin, workspace typechecks dan builds yang relevan setelah perubahan, serta `npm run db:check`/migration review sesuai repo. Generated SQL tidak diedit manual.
- Sebelum commit/PR, full unit dan UI/routing/auth E2E yang diwajibkan repo. Standard `npm run test:e2e` mengandung legacy live-provider writes: **jangan dijalankan tanpa izin provider terpisah**. Laporkan gate standard tersebut blocked sampai dapat dijalankan aman/diotorisasi, bukan menyatakan mock suite menggantikan semua gate tanpa approval.
- Migration/seed rehearsal hanya disposable, branch-specific fixtures/DB cleanup FK-ordered; tidak reset akun sandbox atau DB pengguna.

Evidence register per run mencatat command/environment/ref, acceptance IDs, pass/fail/blocked/skipped/reason, safe artifacts/known evidence dan owner sign-off. Saat Playwright gagal baca Markdown report/trace context, **jangan buka PNG**. Spec approval bukan app-test pass.

## 13. Deployment, cutover, dan release

### 13.1 Mekanisme versi dan rollout — usulan

Tidak menambah env/provider endpoints/ports/storage durable/cron baru. Usulan satu gate konfigurasi **domain-specific** `discounts.contractVersion` di `system_config`, default0 pada instalasi existing/disposable migration/config setup;0 menahan mutasi promo/Markdown baru dan pembuatan order kontrak baru sampai paired deployment siap, bukan emergency-switch subsystem atau izin melepas hold. Pembukaan ke1 dilakukan operator hanya sesudah readers/writers kompatibel dan scope disetujui. Existing `checkout.paused` dipakai untuk maintenance **order baru** saat paired cutover; in-flight callbacks/reconciliation tetap bekerja.

- Fase persiapan: review schema/SQL, conflict canonical/ownership/preexisting usage, backup/restore rehearsal dan manifest image. Jika ternyata ada usage legacy nyata, hentikan cutover terkait dan minta keputusan; jangan fabrikasi opening balances atau menganggap semua dummy.
- Deploy additive schema/reader compatible terlebih dahulu, default writer gate0. Pastikan admin/store/sweep/mirror/stock-sync readers yang relevan mendukung version1 pricing/version2 Sales. Tidak menambahkan fleet-version coordinator: paired images/config dan operator checklist memverifikasi seluruh proses, app decoder tetap fail closed unknown versions.
- Catalog effective projection hanya diaktifkan bersama seluruh pricing consumers yang kompatibel; sebelum gate terbuka tidak boleh admin mempublish target yang hanya tampil di sebagian surface. No bypass via direct API saat gate0.
- Saat maintenance berizin, pause checkout baru; selesaikan FK/catalog/permission checks dan legacy route cutover, explicit configuration import, current grants. Tidak menjalankan `db:seed` pada data nyata sebagai cara grant/migrate.
- Gate domain1, smoke mock/disposable dan authorized staging UAT, cek no service fee/PPN/baris/quote/net provider. Buka checkout baru setelah paired compatibility terbukti. Publikasi/aktivasi ini memerlukan izin operasi tersendiri, bukan dilakukan oleh dokumen.
- Tidak ada cohort internal production tambahan. UAT staging oleh pemilik/tester lalu rilis publik sesudah acceptance wajib/sign-off dan izin deploy/launch.

### 13.2 Seed/config/migration

Shared schema owner tunggal; generate SQL audit record, dev `db:push`, deployment migration container existing (bukan `db:migrate` di dev). Fresh demo seed membuat realistic Markdown/revision/restore/fallback, staged/partial batch rows, public percentage/fixed/shipping dan manual codes, account usage/reserved/consumed/released snapshots yang konsisten; import limits dan domain gate default0; new-role defaults sesuai §7.

Seed deletion FK-ordered mencakup events/allocations/requests/provider/shipment evidence sebelum parent orders/clients/offers/variants; RESTRICT tidak dinonaktifkan di aplikasi. `SEED_MODE=jubelio` tetap tanpa dummy catalog/transactions, production seeder dilarang. Seeder/reset hanya untuk environment disposable yang diizinkan, bukan migration usage.

### 13.3 Rollback dan observability

- Sebelum writer baru dibuka, rollback ke paired image/schema yang kompatibel melalui rehearsal. Jangan edit/delete generated SQL atau down-migrate blind.
- Sesudah ada order/snapshot baru, rollback ke aplikasi yang tidak mengerti versi itu **tidak aman**. Pause order baru/admin writes, pertahankan readers/reconciliation versi kompatibel untuk in-flight orders, gunakan forward-fix atau compatible previous image; keputusan restore backup memerlukan scope/approval dan rekonsiliasi provider karena restore lokal tidak membatalkan writes provider.
- Pause satu Offer bermasalah untuk penggunaan baru jika checkout lainnya terbukti aman; dampak meluas/belum jelas → tahan flow yang belum aman memakai existing maintenance controls. Tidak mass cancel/reprice atau force-release existing holds.
- Amati structured outcome counts: capacity conflict, pending/review ages, provider expected/observed mismatch, failed/pending batch, current-policy denial, drift dan unknown versions. Gunakan logs/ops review existing, tidak menjanjikan dashboard/SLA/alerting subsystem baru.
- Visual mengikuti admin existing tetap kriteria UI UAT, bukan blocker planning. Sandbox legacy cleanup tetap terpisah; jika fixture stock tidak memadai, blok hanya research/test yang membutuhkan fixture itu, tanpa mengarang hasil lulus.

### 13.4 Dokumentasi enduring dan deployment files

Saat implementasi, tambahkan feature diskon di `docs/features/`, perbarui `docs/api-reference.md` untuk seluruh route baru/berubah/dihapus, docs pricing/PPN/delivery/orders/Sales dan DB/RBAC/seeding/testing yang terpengaruh, serta index `docs/README.md`. Keterangan enduring ditulis dari hasil implementasi terverifikasi, bukan menyalin draft sebagai fitur sudah tersedia.

Review/update file relevan di `deployment/common/`, `deployment/staging/`, `deployment/production/` bila parser/build dependency, request size proxy, config import, migration readiness, trusted-IP atau maintenance procedure berubah; tidak mengubah domain/port/credential atau menambah service tersirat. Usulan batas body/ZIP dan IP trust §5/§6 harus diverifikasi terhadap proxy dan Docker runtime sebelum aktivasi. Dokumentasikan SQL config+restart/refresh behavior dan paired rollout/rollback di `docs/deployment-docs/`.

## 14. Review register dan kriteria selesai

### 14.1 Usulan yang perlu approval lengkap

Register proposal berikut telah disetujui bersama complete spec melalui approval §1.3. Judul bagian dipertahankan untuk penelusuran link drafting; bukan daftar keputusan yang masih belum disetujui:

| Proposal | Isi konkret | Dampak/trade-off |
| --- | --- | --- |
| Input bounds | §4.3 code3–64 ASCII/rate6/cart50/qty99/money13 digit/body limits | Eksekusi bounded, menolak input di luar format; tidak ada truncation diam-diam |
| HTTP/review/idempotency | §5 endpoints, token10menit, explicit acknowledgements dan201/200/202 outcomes | Menambah kontrak review/result supaya response putus tidak jadi duplicate order; approval token bukan promise capacity |
| Anti-abuse | §5.5 account/IP fixed windows dan operational PG buckets | Konsisten lintas proses tanpa Redis, menambah ephemeral table/writes; trusted proxy wajib |
| Import foreground | §6 marker/header/cell format, chunk25/5detik, config load per request | Tetap partial/resumable tanpa worker; limit bukan SLA, current config dapat menahan pending resume |
| Admin contracts | §7 module keys/current-policy serialization, draft/capacity, command receipts | Memperluas catalog+SQL CHECK dan menjaga replay/audit tanpa auto-grant existing roles |
| Physical integration | §8–§10 SQL keys/constraints/snapshot versions/lock order3-attempt retry | Menyatukan lifecycle existing dan menghindari subtotal/payable/courier cost salah; perlu concurrency/rehearsal |
| Writer/version gate | §13 domain config+paired deploy, tidak unknown-version rollback | Tidak ada fleet coordinator/kill-switch baru; butuh operator checklist dan compatible readers |

Agent mengisi proposal detail outstanding3 dan pemilik kemudian memberikan approval complete spec secara terpisah, bukan hanya berdasarkan status resolved tiket Wayfinder. Semua proposal di atas kini kontrak approved. Revisi behavior/scope berikutnya memerlukan approval ulang; jika repo integration mengungkap keputusan baru di luar scope, hentikan path terkait dan minta keputusan, bukan silent re-plan.

### 14.2 Gates dan completion

1. **Draft review — terpenuhi:** pemilik menyetujui complete spec/register/acceptance melalui pilihan **Setujui spec lengkap (Recommended)**; index dan fitur ditandai Ready.
2. **Ticket publication — terpenuhi, execution belum:** pemilik secara terpisah menyetujui13 slices/dependency/lokasi dan publikasinya. [Implementation map](../ticket/map.md) menjadi handoff; lingkup eksekusi masih harus diminta tersendiri. Delegasi tetap opt-in.
3. **Implementation acceptance:** semua40 acceptance IDs pada §12.2 dan coverage proposal terkait terverifikasi pada seams yang sesuai; blocked/skipped dilaporkan, bukan Done. Existing provider evidence dipakai bounded, bukan dibuka ulang sebagai Rp0 gate.
4. **Release:** rehearsal/version compatibility, current grants/config, UAT staging pemilik/tester dan sign-off, serta izin deploy/launch terpisah. Cleanup sandbox lama bukan syarat baru.
5. **Penutupan:** enduring docs selesai, semua feature verified, simpan file plan beserta decision/evidence dan mark index fitur Done dengan tanggal, outcome, dan bukti.

### 14.3 Verifikasi drafting

Pemeriksaan sumber Wayfinder/koreksi pemilik, kode harga/checkout/finalizer/ledger/gateway/delivery/RBAC/config dan testing/deployment docs telah dilakukan. Pemeriksaan dokumen:58 local links spec dan27 links map memiliki target file; seluruh40 acceptance IDs cocok tanpa hilang/duplikat; whitespace/fences dan index Draft konsisten; contoh money/allocation/rounding diperiksa dengan literals independen tanpa mengimpor module aplikasi. `git diff --check` file tracked yang disentuh bersih.

Pemeriksaan index juga menemukan satu link lama ke map implementasi pengiriman-ke-rumah yang targetnya tidak tersedia di worktree. Link yang sama sudah ada pada `HEAD`, bukan berasal dari row spec baru, dan tidak diperbaiki sebagai perubahan tak terkait. Pemeriksaan target file tidak membuktikan seluruh fragment heading pada semua dokumen tujuan. Tidak ada test/build/lint/typecheck aplikasi, migration execution, provider request, subagent, commit atau deployment sebagai bagian drafting.

### 14.4 Retirement checklist

- [x] Approval complete spec dicatat sebelum Ready; publikasi13 tickets mendapat approval terpisah. Eksekusi belum dimulai.
- [ ] Semua fitur dan acceptance/tests wajib terverifikasi, termasuk UI Playwright/PG concurrency dan regression gates.
- [ ] Enduring feature/API/architecture/testing/deployment docs diperbarui sesuai [aturan dokumentasi](../../../docs/README.md).
- [ ] UAT/release evidence dan izin operasi dicatat; tidak disamakan dengan mock-only pass.
- [ ] Plan tetap disimpan saat Done dan [index.md](../index.md) ditandai Done dengan tanggal, outcome, dan bukti; tidak ada status kedua di map.
