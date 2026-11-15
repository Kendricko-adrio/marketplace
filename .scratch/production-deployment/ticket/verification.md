# Verifikasi implementasi bootstrap production

Tanggal sesi: 2026-11-13. Scope: implementasi plan
[`../plan/first-production-deployment.md`](../plan/first-production-deployment.md)
dan verifikasi pada database disposable lokal. Tidak ada SSH, database/produksi
pengguna, request Jubelio live, commit, atau deployment.

## Evidence yang benar-benar dijalankan

| Perintah | Hasil |
|---|---|
| `npx tsc --noEmit -p packages/db/tsconfig.json` | Lulus tanpa error (modul + test baru). |
| `npx vitest run` focused: `bootstrap-input`, `jubelio-import-report`, `jubelio-import-options`, `rbac/bootstrap-owner-input`, `jubelio-sync-fetch` | 5 file / 59 test lulus. RED sebelum GREEN tercatat untuk slice policy. |
| `npm run test:unit` (root) | 183 file / **2175 test pass**, 12 skipped. 9 file gagal **pre-existing** karena guard DB disposable menolak `DATABASE_URL=storefront` (`marketplace_discounts_test_*`/admission/checkout attempt). Bukan dari perubahan ini. |
| `TEST_DATABASE_URL=.../marketplace_bootstrap_test npx vitest run src/migrations/fresh-production-rehearsal.test.ts src/production-bootstrap/production-bootstrap-cli.db.test.ts src/production-bootstrap/full-import-cli.db.test.ts` | **3 file / 13 test pass.** Rehearsal memakai `drizzle-kit migrate` nyata dua kali (run kedua no-op) + schema contract; CLI preflight/seed/verify/Owner berjalan pada scratch DB dengan role non-superuser; full import memakai fixture HTTP loopback 201 group / 202 SKU / 404 pasangan stok. Base test DB dan seluruh scratch DB/role dihapus setelah run (diverifikasi kosong). |
| CLI smoke tanpa DB | `seed` tanpa `DATABASE_URL` → exit 2 `BOOTSTRAP_REFUSED` (tidak memuat `.env` dev); manifest template → exit 2 `MISSING_REQUIRED_CONFIG`. |

## Lingkup verifikasi DB disposable

- Scratch DB + role non-superuser baru per suite; guard preflight privilege
  benar-benar diuji (bukan di-bypass). Nama DB wajib mengandung pola test.
- Preflight: target mismatch ditolak; `after-migrate` menerima schema release.
- Seed: dua invocation **bersamaan** menghasilkan tepat satu
  `REFERENCE_SEED_APPLIED` dan satu `REFERENCE_SEED_ALREADY_APPLIED`; hanya
  roles/grants/HQ/config/marker, nol user/client/product/order.
- Rerun: `checkout.paused=false` dipertahankan, grant yang dicabut tidak
  dikembalikan, jam operasional HQ hasil edit operator dipertahankan.
- Owner: dibuat dari file secret (tanpa secret di output), duplicate exit 1,
  hash password tidak berubah; `must_reset_password=true`.
- Full import: halaman 2 benar-benar masuk; kategori tak terpakai tidak
  diimpor; jam cabang `{}`; `report.dataQuality` = 0 gambar hilang / 201
  deskripsi hilang / 202 dimensi parcel hilang; drift sumber, observasi stok
  hilang, kegagalan 5xx, dan rerun tanpa duplikasi terdeteksi; local
  `reserved_stock` bertahan setelah re-sync; full import kedua ditolak
  `IMPORT_ALREADY_RUNNING`.
- Verify: laporan impor yang tidak lengkap → `BOOTSTRAP_INCOMPLETE` exit 4.

## AC → evidence

| AC | Status | Evidence / alasan |
|---|---|---|
| AC01 | Verified | Unit guard + CLI negative test pada DB disposable: exit 2 `PRODUCTION_TARGET_MISMATCH`, preflight read-only, tanpa write. |
| AC02 | Verified | Rehearsal nyata: seluruh migration release pada DB kosong, run kedua no-op, schema contract lengkap. |
| AC03 | Verified | Seed CLI: marker, `checkout.paused=true`, HQ tanpa Jubelio id, nol user/client/product/order. |
| AC04 | Pending | Serialisasi concurrent terverifikasi (satu applied, satu already-applied). Rollback kegagalan **di tengah** seed belum diinduksi. |
| AC05 | Verified | Rerun mempertahankan config, grant yang dicabut, jam cabang, password Owner, dan local hold `reserved_stock=3`. |
| AC06 | Verified | Owner dari file secret, output tanpa secret, `must_reset_password=true`, duplicate exit 1 tanpa reset hash. |
| AC07 | Pending | Policy test `--full` (cap/filter/start-page/malformed) lulus sebelum side effect; asserstion “tidak ada request provider/DB berubah” belum eksplisit. |
| AC08 | Verified | Fixture 201/202/404: seluruh ID tersimpan, group halaman ke-2 ada di DB, kategori tak terpakai tidak masuk. |
| AC09 | Verified | Drift enumerasi kedua, observasi stok hilang, 5xx + retry, interruption/partial, dan rerun tanpa duplikasi terverifikasi. |
| AC10 | Pending | Jam cabang `{}` dan `dataQuality` terverifikasi; “mempertahankan status produk/Markdown hasil admin” belum diassert terpisah. |
| AC11 | Pending | Service `bootstrap` Compose/env/manifest wiring ditulis; container rehearsal belum dijalankan (butuh izin Docker). |
| AC12 | Pending | Verifier menolak laporan/coverage tidak lengkap + `STOCK_COVERAGE`/timestamp; jalur positif `BOOTSTRAP_VERIFIED` pada DB yang di-seed + Owner + import dalam satu run belum dieksekusi. |
| AC13 | Pending | Runbook ditulis & dinavigasikan; CLI preflight/seed/Owner sudah dijalankan di DB disposable, tetapi walkthrough penuh (container/host/provider) belum. |
| AC14 | Pending | Output Owner terverifikasi tanpa secret; suite secret-sentinel menyeluruh (semua command/report) belum ada. |
| AC15 | Pending | Full unit suite dijalankan (2175 pass, 9 file gagal pre-existing); container rehearsal dan dua smoke spec E2E belum dijalankan. |

## Gate target production (§15) — belum dijalankan

- [ ] Identitas DB/user production, release, akses PostgreSQL dari container, backup + restore test, disk dan volume persisten diverifikasi.
- [ ] Port 80/443 dan topology Caddy target tidak konflik; DNS/TLS serta pembatasan akses bootstrap diverifikasi.
- [ ] Migration, seed referensi, satu Owner dan full import berhasil pada target; report run final direkonsiliasi terhadap database dan sumber tenant.
- [ ] Owner login dan ganti password; secret bootstrap dilepas; akun operasional/Home Branch dibuat lewat admin.
- [ ] Homepage, footer/kontak, static/legal pages dan aset production disiapkan serta direview; tidak mengandalkan fallback/demo.
- [ ] Rate/ID pajak, akun settlement dan numeric payment type, contract gate, jam cabang, serta data SKU/lokasi diverifikasi untuk flow yang diaktifkan.
- [ ] SMTP/OAuth dan Midtrans production config/webhook diverifikasi; transaksi live hanya sesuai izin dan safeguards terpisah.
- [ ] Stock freshness, webhook Jubelio, daily stock reconciliation, sweep reservation dan order communication cron dipasang/dipantau sesuai runbook existing.
- [ ] Untuk delivery: origin tiap cabang, contact/address hierarchy, parcel/packaging, Shipment credentials/webhook dan booking flow diverifikasi terpisah.
- [ ] Owner memberi sign-off go-live; checkout/config write diaktifkan eksplisit, store direstart untuk config cache, akses publik dibuka dan monitoring/rollback owner ditetapkan.

## Blocker yang masih terbuka

- Container rehearsal tools image (butuh izin Docker) — AC11/AC13/AC15.
- Dua smoke Playwright bootstrap (butuh DB yang di-seed + Owner + import sekaligus,
  serta `E2E_BOOTSTRAP_OWNER`/password) — AC13/AC15.
- Izin eksplisit POST Jubelio (login/read-stock) untuk import live dan seluruh
  gate target production.
- Tambahan test untuk AC04 (rollback kegagalan mid-seed), AC07 (counter
  request/DB tetap), AC10 (preserve status produk/Markdown), AC12 (jalur
  positif verifier), AC14 (secret sentinel menyeluruh).
