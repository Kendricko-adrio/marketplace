# 02 — Review checkout dan retry tanpa order ganda

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 01
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: C07, T04, T06, D01, D02

## Perilaku yang dibangun

Customer mereview checkout tanpa promo dan dapat melanjutkan setelah koneksi putus tanpa membuat order kedua. HTTP/UI mengikat current review, request key dan accepted result. Order yang sudah committed tetap ditemukan walaupun cart telah dibersihkan atau response hilang.

Gunakan baseline uang/version gate01. Sediakan interface pilihan promo yang extensible, tetapi jangan membangun Offer/Markdown atau menampilkan fitur yang belum didukung. Penggantian promo ditambahkan08, manual guessing09.

## Acceptance criteria

- [x] Preview authoritative menghasilkan review token bertanda tangan, context/price/version fingerprints, expiry10menit dan client binding sesuai spec. Token bukan auth, harga beku atau reservation.
- [x] Reprice/expired token/missing acknowledgement/context berubah menolak order baru dan meminta review; delivery reapproval existing tetap berlaku walau perubahan total turun. Tidak memakai money browser sebagai authority.
- [x] Place order mengikat key UUID+canonical user intent; same key+same fingerprint mengembalikan order sama, different fingerprint409. Duplicate cart IDs invalid; sort canonical tidak membuat konflik semu.
- [x] Accepted request result, order/items/snapshot, optional saved address, stock hold dan SO intent satu commit. Kegagalan sebelum commit tidak menyisakan accepted order atau hold parsial.
- [x] Parallel same-key hanya satu order dan satu SO dispatch claim. Replay mencari accepted result sebelum membaca cart/master terbaru; tidak requote/reprice/reserve ulang sesudah sukses.
- [x] Response201 baru,200 replay,202 committed tetapi processing/manual-review jujur. Error sesudah commit tidak tampil seolah order tidak ada; UI memakai key sama dan result lookup/read order.
- [x] Client hanya dapat membaca request result/order miliknya; key berbeda owner404. Result lookup/read tidak dispatch HTTP write. Retry/repayment tidak memperpanjang expiry atau menciptakan payment attempt/order pengganti otomatis.
- [x] Crash sebelum external claim dibedakan dari possibly-sent claim: existing system path boleh claim intent belum dispatched sekali; dispatched ambiguity hanya reconcile, tidak re-POST. Tidak menambah worker/outbox kedua.
- [x] Admission account/IP non-code dan place-order limits persis spec, lintas proses memakai operational PG counters; trusted proxy/spoofing,429 Retry-After dan503 fail-closed teruji. Raw IP/review tokens tidak disimpan di business logs. Same accepted replay tidak dihitung sebagai new placement.
- [x] Ephemeral rate state terpisah dari retained checkout results; accepted results/ownership tidak hilang via cascade atau reset request key. Seeder, schema/version/read docs dan UI E2E ikut berubah.

## Verifikasi

T real PG: parallel same-key/changed-key, commit boundaries, no partial stock intent; observe via result/order interfaces. H/B: review expired/changed contexts, lost response dan replay sesudah cart removal, owner privacy, HTTP statuses/limiter shared-process simulation dan trusted IP. Inject failures deterministic pada external boundary/transaction seam yang disepakati, bukan mocking lock/counter internal. Expected order/amount literals independen.

Ticket ini belum menyelesaikan promo-specific reservation T04;07 harus mengikat Redemption ke transaksi/request yang sama. Jangan menambah schema Offer dahulu untuk menyebut fondasi selesai.

## Catatan eksekusi

- Ticket01 resolved dengan main review dan evidence baseline; pemilik sudah mengizinkan seluruh scope serta parallel edit-only subagents. Lane terisolasi: `../discounts-checkout-02`, snapshot baseline01 dirty d96bdf1 tanpa commit. Main memiliki seluruh validation dan integrasi.
- Stage pertama test-first pada seam publik; jangan menyebut seluruh ticket selesai dari komponen awal. Gate domain tetap0; fitur1 hanya DB disposable.

## Batas dan penyelesaian

Baca [kontrak bersama](map.md#kontrak-bersama-untuk-semua-ticket). Semua identifiers/limits/errors mengikuti approved spec; perubahan perilaku baru kembali ke pemilik. Ticket bukan izin eksekusi, provider requests, subagent, commit atau deployment. Main agent memiliki TDD, review dan validasi; catat Answer sebelum resolved.

## Answer

Status: resolved. Implementasi dipindahkan dari lane terisolasi `../discounts-checkout-02` ke worktree utama `worktree/diskon` (bukan dijalankan di lane), lalu diverifikasi main agent. Tidak ada commit/push, provider nyata, remote, atau deployment.

### Yang diimplementasikan

- Review preview pickup + delivery (`POST /api/checkout/preview`): token HMAC v1 TTL 10 menit, `contextFingerprint` (selection terurut, cabang/fulfillment, slot atau snapshot delivery, digest kontak, promo `none`, versi + breakdown), read-only tanpa order/hold/usage/provider business write.
- Place-order gate1: wajib `requestKey` + `reviewToken` + `promoSelection`; fingerprint delivery dihitung ulang; verifikasi context/token sebelum stock/quote; replay request-wide sebelum cart; 201/200/202; result lookup `GET /api/checkout/requests/{requestKey}` (owner-only, read-only, tidak memperpanjang expiry).
- Satu commit: order/items/snapshot/optional saved address/stock hold/SO intent/accepted result; batas transaksi 2s/5s/10s + retry serialization maksimal 3 attempt; finalisasi definitive create rejection (released hold sekali) dan recovery intent checkout lewat sweep existing (tanpa worker/outbox kedua).
- Admission PostgreSQL `discount_request_window`: preview 60/account + 300/IP, place 10/account + 60/IP per 60 detik, HMAC subject, `429 RATE_LIMITED` + `Retry-After`, `503 POLICY_UNAVAILABLE` fail closed, trusted proxy (`CHECKOUT_TRUST_PROXY`) dengan loopback di dev/mock, cleanup opportunistic ≤100 baris tanpa cron baru. Replay accepted tidak dihitung placement baru.
- UI checkout: preview sebelum review, `requestKey` disimpan di `sessionStorage`, panel recovery "Periksa pesanan", penanganan 200/201/202 dan review/reprice required.
- Schema `discount_request_window` + migrasi `0040_foamy_hedge_knight.sql` (drizzle-kit, bukan hand-edit) + seed-cleanup.
- Test fixture mock: scenario `reject-create` (400 pre-apply, tidak menulis) untuk menguji definitive rejection tanpa melemahkan verifier produksi; spec gate1 lama diperbarui memakai preview+token.
- Docs: `docs/api-reference.md`, `docs/features/versioned-checkout-pricing.md` (§12), `docs/testing/README.md`, `docs/deployment-docs/reference.md`, `.env.example`.

### Evidence (main agent, bukan laporan child)

| Check | Hasil | Log |
| --- | --- | --- |
| `npm run verify:types:store` | PASS | `/tmp/discounts-t02-final-types-store.log` |
| `npm run verify:types:admin` | PASS | `/tmp/discounts-t02-final-types-admin.log` |
| `npx eslint` file store berubah | PASS | `/tmp/discounts-t02-final-lint.log` |
| SQL real-PG: `checkout-request.db.test.ts`, `checkout-admission.db.test.ts`, `seed-cleanup.test.ts` | 3 files / 8 tests passed | `/tmp/discounts-t02-sql-slice1.log` |
| Focused lifecycle/pricing unit | 8 files / 87 passed, 2 skipped | `/tmp/discounts-t02-focused-unit.log` |
| Mock server unit (termasuk `reject-create`) | 36 passed | `/tmp/discounts-t02-mock-unit.log` |
| `verify:batch:unit` (serial) | 122 files / 1380 passed, 3 skipped | `/tmp/discounts-t02-final-batch-unit.log` |
| Mock E2E `checkout-review-mock` | **18 passed** | `/tmp/discounts-t02-e2e-2.log` |
| Mock E2E regresi gate1 `versioned-checkout` + `versioned-settlement` | **6 passed** | `/tmp/discounts-t02-e2e-regression.log` |
| Mock E2E legacy `pickup` + `delivery-order` + `delivery-quote` | **27 passed** | `/tmp/discounts-t02-e2e-legacy.log` |
| `db:generate` + `db:check` | PASS; `0040_foamy_hedge_knight.sql` hanya CREATE TABLE/index | `/tmp/discounts-t02-gen.log`, `/tmp/discounts-t02-dbcheck.log` |
| Push + seed DB disposable baru `marketplace_discounts_test_20261023` | PASS | `/tmp/discounts-t02-push.log`, `/tmp/discounts-t02-seed.log` |

Tiga skip pada batch unit adalah placeholder readiness environment (Sales versioned/operations/channel mirror) yang sudah terdokumentasi; perilaku PG aktualnya dijalankan di suite DB terpisah.

### Tidak diklaim / gap tersisa

- **Bucket quote**: `POST /api/checkout/delivery-quote` belum memakai admission preview (spec §5.5 memasukkan quote). Ini keputusan scope pemilik pada sesi ini; dicatat di docs dan harus ditutup sebelum gate produksi dinaikkan.
- Bucket manual-code 20/120 belum ada karena kode manual dibangun di ticket 09.
- Reservation/Redemption promo (T04 promo-specific) tetap milik ticket 07; ticket ini hanya membuktikan T04 untuk jalur non-promo.
- UAT staging, rollout gate `1`, migration deployment, rehearsal dan release tidak dijalankan (ticket 13/izin terpisah). `npm run test:e2e` legacy live-provider tidak dijalankan.
- Mock app (`apps/jubelio-mock`) tidak memiliki `eslint.config.*` (pre-existing); unit test-nya dijalankan, lint tidak tersedia.
