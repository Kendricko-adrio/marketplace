# 06 — Admin Coupon publik nominal

Label: ready-for-agent
Type: task
Status: resolved
Assignee: main-agent
Blocked by: 01
Parent: [Map implementasi diskon](map.md)
Spec: [Complete spec](../plan/discounts-spec.md)
Acceptance IDs: C05, F03, T03, A01, A02, A04, D01, D02, D03

## Perilaku yang dibangun

Admin berwenang membuat Offer publik fixed-goods, menyimpan draft, melakukan simulasi nominal, melihat diff lalu publish/pause dengan batas pemakaian. Ini admin path lengkap yang bisa didemokan tanpa mengklaim customer redemption sudah aktif; penggunaannya ditambahkan07.

Bawa schema/revision/benefit/capacity/current grants/audit yang diperlukan fixed-public saja. Tidak membuat tabel targeting/reward atau engine kondisi generik. Reuse pricing/version baseline01 dan writer gate tetap default0 di environment operasional.

## Acceptance criteria

- [x] Offer identity public tetap, tanpa code; satu benefit fixed-goods per published revision, nominal positif/minimum nonnegative/currency IDR. Unknown kind/version/shape invalid ditolak, bukan default menjadi fixed.
- [x] Draft incomplete boleh disimpan tetapi belum launchable. Minimal kuota atau budget wajib pada live state, per-account default1/configurable positif. Tidak mengambil default quota100 dari voucher legacy.
- [x] Draft tidak mengubah live terms. Review diff server-bound versions/fingerprint, publish eksplisit atomik dengan benefit/pointer/policy/code-free invariants/audit. Dua editor stale409 pada save/publish; reload/review, tanpa force-overwrite.
- [x] Admin simulation melalui pricing interface, subtotal/nominal clipping dan PPN jelas, label simulasi/no hold/no quote promise. Subtotal150000/fixed17000 → net133000, PPN11%14630, pickup total147630.
- [x] Start/end opsional, WIB input/server time authoritative, start inklusif/end eksklusif dan start<end. Min barang setelah Markdown (input pricing authoritative ketika dipakai07), tanpa first-order/targeting tambahan.
- [x] Initial/increase/removal capacity yang memperbesar memerlukan promo+capacity grants; editor promo tanpa capacity grant boleh draft tetapi tidak men-setting capacity lewat publish bypass. Penurunan di bawah reserved+consumed ditolak.
- [x] Catalog/SQL scope CHECK/guard/role matrix/default fresh HQ dan Admin mendukung discounts/discount_capacity sebagai global modules; custom existing grants tidak auto-upgrade. Ceiling/coverage/self-role/current-policy tetap berlaku, direct URL/API tidak bypass.
- [x] Command request receipts memastikan create/publish/state/policy replay tidak menggandakan Offer/audit atau mengubah hasil sesudah response putus; actor attribution/key tetap walau FK actor null.
- [x] Pause/archive tidak reset usage/identity, published terms immutable/retained, canonical state/ownership/benefit constraints teruji. Empty usage projections dibuat bersama Offer; customer reserve race nyata disambungkan07, bukan dimock sebagai proof final.
- [x] Viewer/authorized draft access, logs tanpa secrets, feature/API/testing docs dan seed fixtures sesuai spec. Percentage/shipping/manual features belum didukung tidak diberi UI aktif/publish path palsu.

## Verifikasi

B admin draft→simulate→review→publish/pause dan grant personas. H strict input/versions/replay/permission. T real PG untuk publish/current pointer/one-benefit/capacity edit/receipt dan SQL constraint seam, termasuk draft belum capacity tidak publish. L literal simulation/invalid config, D seed/shared timestamp/unknown versions. Tidak membuat fake customer usage untuk menyebut T03 reserve race sudah terverifikasi; real reserve coverage07/12.

## Catatan eksekusi

- Ticket01 resolved dengan main review dan evidence baseline; pemilik sudah mengizinkan seluruh scope serta parallel edit-only subagents. Lane terisolasi: `../discounts-offers-06`, snapshot baseline01 dirty d96bdf1 tanpa commit. Main memiliki seluruh validation dan integrasi.
- Stage pertama test-first pada seam publik; jangan menyebut seluruh ticket selesai dari komponen awal. Gate domain tetap0; fitur1 hanya DB disposable.

## Answer

Status: **resolved** untuk scope ticket 06 (admin path lengkap, redemption tetap
belum aktif). Gate operasional tetap `0`; tidak ada commit/push, provider
request, SSH, atau deployment.

Yang diimplementasikan (worktree `worktree-diskon`, branch `worktree/diskon`,
uncommitted):

- Schema `packages/db/src/schema/discounts.ts`: Offer, revision, benefit
  fixed-goods (satu per revision), usage projection, command receipt; CHECK
  Rupiah utuh, publik tanpa kode, publikasi lengkap, pointer ownership, satu
  draft per Offer.
- Migrasi dihasilkan drizzle-kit: `0036` (scope CHECK grant), `0037` (tabel
  Offer), `0038` (tabel benefit); `db:check` passed, push + seed hanya ke DB
  disposable `marketplace_discounts_test_20261022`.
- Domain `apps/admin/src/lib/discounts-administration.ts`: create, save draft,
  review + fingerprint, publish atomik, simulate melalui `evaluatePricing`,
  state, policy, usage, history; receipt replay untuk create/publish/state/
  policy; lock order + bounded execution; policy re-read dalamtransaksi.
- Route `apps/admin/src/app/api/admin/discounts/**` (11 endpoint) dan UI
  `/admin/discounts` + `/admin/discounts/{id}` + link sidebar.
- RBAC: dua Global Module di catalog, seed HQ, label matrix; SQL CHECK dan test
  grant scope. Tidak ada auto-grant ke Role existing.
- Seed demo: satu draft publik tidak lengkap, gate eksplisit `0`, cleanup FK
  termasuk benefit.
- Docs: `docs/features/discount-administration.md`,
  `docs/api-reference.md`, `docs/README.md`, `docs/testing/README.md`,
  `docs/features/rbac.md`.

Evidence (main agent, DB disposable eksplisit):

- `verify:types:admin` PASS; `lint:admin` 0 error.
- `apps/admin/src/lib/discounts-administration.test.ts` — 19 passed.
- `apps/admin/src/lib/discounts-administration.db.test.ts` — 9 passed (real PG):
  publish tanpa kapasitas ditolak, simulasi literal 133000/14630/147630,
  publish + replay, stale save/publish 409, grant kapasitas, penurunan di bawah
  komitmen 409, pause tanpa reset usage, revision kedua + benefit terpisah,
  replay state/policy.
- `packages/db/src/discount-schema.db.test.ts` + `seed-cleanup.test.ts` —
  18 passed (termasuk 5 constraint benefit).
- `e2e/admin/discounts-admin-mock.spec.ts` — 3 passed: create/replay/detail,
  denial `INPUT_INVALID`, dan alur UI draft→simpan→kapasitas→simulasi→review→
  publish→pause.
- `npm run verify:batch:unit` (serial, DB disposable) dijalankan setelah
  perubahan terakhir; hasil dicatat di
  `.scratch/discounts/ticket/execution.md`.

Tidak diklaim: redemption/reserve customer, race kapasitas T03 (ticket 07/12),
persentase/subsidi ongkir/kode manual, UAT staging, dan aktivasi release.

## Batas dan penyelesaian

Baca [kontrak bersama](map.md#kontrak-bersama-untuk-semua-ticket). Belum ada redemption UI/provider writes; gate0 operasional tetap. Main agent menjalankan TDD/review/validation setelah izin eksekusi dan mencatat Answer sebelum resolved. Approval ticket tidak memberi izin implementasi, delegasi, commit atau deploy.
