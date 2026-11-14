# Deployment production pertama (bootstrap dari database kosong)

Runbook ini mengikuti plan [`.scratch/production-deployment/plan/first-production-deployment.md`](../../.scratch/production-deployment/plan/first-production-deployment.md).
Tujuannya: membangun schema dari database baru, mengisi referensi sistem tanpa
fixture demo, membuat satu System Owner, mengimpor seluruh master produk/stok
Jubelio, lalu memverifikasinya **sebelum** storefront dibuka.

> **Batas yang harus dipahami lebih dulu.** `BOOTSTRAP_VERIFIED` berarti
> database production siap dipakai untuk smoke terbatas. Itu **bukan** izin
> mengaktifkan checkout, Midtrans live, shipment, webhook, atau cron, dan bukan
> bukti seluruh transaksi live sudah diuji. Gate go-live tetap terpisah (§10).

Semua command dijalankan **dari `deployment/production/`** dengan flag
`-p production --env-file .env`. Jangan menjalankan `db:push`, `db:reset`,
`db:seed`, atau `up -d --build` penuh sebelum database siap.

## 0. Ringkasan urutan dan exit code

```text
preflight before-migrate → migrate → preflight after-migrate → seed referensi
  → bootstrap Owner → full import Jubelio → verify → start terbatas + smoke
  → gate transaksi/integrasi → go-live
```

Exit code command bootstrap/import:

| Code | Arti | Tindakan |
|---|---|---|
| `0` | Operasi yang diminta lulus | Lanjut ke tahap berikutnya. |
| `2` | Input/target/prasyarat ditolak | Perbaiki konfigurasi; tidak ada write yang perlu di-rollback. |
| `3` | Dependency/eksekusi gagal (DB, jaringan, provider) | Diagnosis, lalu ulangi tahap yang gagal. |
| `4` | Hasil verifikasi/import tidak lengkap | Jangan lanjut; baca report dan ulangi import/verify. |
| `1` (Owner CLI) | `OWNER_EXISTS` | Jangan buat ulang/reset password; verifikasi Owner lalu lanjut. |

Kode hasil yang dicari di log: `PREFLIGHT_OK`, `REFERENCE_SEED_APPLIED`,
`REFERENCE_SEED_ALREADY_APPLIED`, `OWNER_EXISTS`, `FULL_IMPORT_COMPLETE`,
`FULL_IMPORT_INCOMPLETE`, `BOOTSTRAP_VERIFIED`, `BOOTSTRAP_INCOMPLETE`.

## 1. Persiapan server dan release

**Prasyarat:** Docker + Docker Compose di VPS, PostgreSQL 16 bare-metal,
DNS/TLS untuk domain production, user ops (bukan root), ruang disk cukup untuk
image + report + backup.

1. Tetapkan identitas release (commit/tag yang dibangun) dan simpan sebagai
   `APP_RELEASE` di `.env`. Image, SQL migration, dan aplikasi harus dari
   release yang sama.
2. Siapkan `.env` production: `cp .env.example .env`, lalu isi seluruh secret
   (`BETTER_AUTH_SECRET` baru, SMTP provider, OAuth, Midtrans, Jubelio).
3. Periksa konflik port reverse proxy **sebelum** apa pun: staging dan
   production sama-sama memakai port host `80/443`.
   `ss -ltnp | grep -E ':80|:443'` atau `docker ps --format '{{.Names}} {{.Ports}}'`.
   Jika Caddy staging masih memegang port itu di host yang sama → **STOP** dan
   minta keputusan penataan proxy/host. Jangan menghentikan staging otomatis.
4. Buat direktori report di luar checkout:
   `mkdir -p /home/ops/log/marketplace-bootstrap/production` dan set
   `BOOTSTRAP_REPORT_DIR` di `.env`.
5. **STOP** bila identitas release, target host, atau pemilik port belum jelas.

## 2. Database dan backup

**Prasyarat:** akses `postgres` lokal untuk provisioning.

1. Buat role + database baru (jangan menyalin database development/staging):

   ```bash
   sudo -u postgres psql -c "CREATE USER qmarketplace_production WITH PASSWORD '<password-kuat>';"
   sudo -u postgres psql -c "CREATE DATABASE qadfstore_production OWNER qmarketplace_production;"
   ```

   Role harus **pemilik database** (non-superuser) agar punya privilege
   `CREATE` pada schema `public`. Preflight menolak superuser atau role tanpa
   privilege schema.
2. Isi `DATABASE_URL` di `.env` (URL-encode karakter khusus) dan
   `expectedDatabase` di manifest bootstrap. Keduanya harus menunjuk database
   yang sama.
3. Database baru tidak berisi data, sehingga backup awal cukup dicatat
   identitasnya. Sebelum migration berikutnya/backup rutin:
   `pg_dump -U qmarketplace_production -h localhost qadfstore_production > backup-$(date +%Y%m%d).sql`,
   dan uji restore ke database lain.

**STOP** bila `expectedDatabase` dan `DATABASE_URL` berbeda, atau role bukan
pemilik database.

## 3. Konfigurasi yang diisi operator

### 3.1 Manifest non-secret

```bash
cp bootstrap.config.example.json bootstrap.config.json
nano bootstrap.config.json    # file asli di-ignore git
```

Isi minimal:

| Key | Wajib | Catatan |
|---|---|---|
| `expectedDatabase` | ya | Nama database production; guard membandingkan `current_database()`. |
| `reservationTtlMinutes` | ya | Kontrak checkout existing (contoh template `15`). |
| `taxPpnRatePercent` | ya | Kebijakan pajak bisnis; tidak ada fallback 11%. |
| `discountsContractVersion` | ya | `0` atau `1`; `1` hanya setelah checklist cutover disetujui. |
| `jubelioSalesTaxId` | opsional saat bootstrap | Wajib benar sebelum checkout aktif; verifikasi tax master tenant. |
| `discountImport.*` | opsional | Default 1000 / 5 MiB / 25 MiB tervalidasi. |
| `shipment.*` | opsional | Hanya jika parameter operasional sudah divalidasi. |

Manifest menolak key tak dikenal, nilai di luar kontrak, dan **secret apa pun**.
Jangan menaruh password/DSN/token di manifest.

### 3.2 Secret dan mount

- Secret aplikasi: `.env` (di-ignore).
- Secret Owner: file read-only, hanya untuk invocation Owner:
  `/home/ops/secrets/owner_password` (mode `600`, milik user ops).
- Credentials Jubelio pada service `bootstrap` hanya master-read
  (`JUBELIO_EMAIL`, `JUBELIO_PASSWORD`). Kredensial settlement/shipment tidak
  dipasang ke service ini.

## 4. Build dan bootstrap schema

**Prasyarat:** `.env` dan manifest sudah final, port reverse proxy aman.

```bash
# Build tooling saja (tidak menyalakan aplikasi)
docker compose -p production --env-file .env --profile tools build migrate bootstrap

# 4.1 Preflight SEBELUM migration — read-only
docker compose -p production --env-file .env --profile tools run --rm \
  bootstrap preflight --config /bootstrap/bootstrap.config.json --phase before-migrate
# harapan: kode=PREFLIGHT_OK, exit 0
# STOP bila: PRODUCTION_TARGET_MISMATCH, TARGET_PRIVILEGE_MISMATCH,
#            atau schema ada tanpa migration journal

# 4.2 Migration (satu kali; menyimpan log + history)
docker compose -p production --env-file .env --profile tools run --rm migrate
# harapan: exit 0; drizzle-kit menerapkan seluruh migration release

# 4.3 Preflight SESUDAH migration — read-only
docker compose -p production --env-file .env --profile tools run --rm \
  bootstrap preflight --config /bootstrap/bootstrap.config.json --phase after-migrate
# harapan: PREFLIGHT_OK (journal lengkap + schema contract hadir)
```

**Recovery migration gagal:** simpan error dan backup. Jangan memperbaiki dengan
seed, `db:push`, reset, atau mengedit SQL audit. Diagnosis pada database
disposable dengan release yang sama; strategi baseline memerlukan approval
terpisah.

## 5. Seed referensi dan Initial Owner

```bash
# 5.1 Seed referensi sistem (transaksi + advisory lock, non-destruktif)
docker compose -p production --env-file .env --profile tools run --rm \
  bootstrap seed --config /bootstrap/bootstrap.config.json
# harapan: REFERENCE_SEED_APPLIED (pertama) / REFERENCE_SEED_ALREADY_APPLIED (rerun)

# 5.2 Satu System Owner, secret lewat file
docker compose -p production --env-file .env --profile tools run --rm \
  -v /home/ops/secrets/owner_password:/run/secrets/owner_password:ro \
  bootstrap npx tsx src/bootstrap-owner.ts \
    --name "Nama Owner" --email owner@domain.tld --username owner \
    --expected-database qadfstore_production \
    --password-file /run/secrets/owner_password
# harapan: "System Owner created", exit 0, mustResetPassword=true
```

Seed pertama hanya menulis Initial Roles/grants fresh-install, branch HQ lokal
tanpa `jubelio_location_id`, config sistem, dan marker
`production.bootstrapReferenceVersion=1`. Tidak ada customer, order, produk,
diskon, atau akun demo. `checkout.paused=true` ditulis pada seed pertama.

Aturan rerun:

- Seed ulang tidak mengembalikan grant yang dicabut, tidak mengganti config
  existing, tidak membuat HQ kedua, dan tidak menyentuh local hold.
- `OWNER_EXISTS` (exit `1`) berarti **jangan** membuat ulang/reset password;
  verifikasi identitas Owner lalu lanjut. Owner pertama wajib ganti password
  saat login pertama.
- Setelah Owner dibuat, lepaskan mount secret bootstrap.

**Recovery seed gagal:** transaksi rollback; perbaiki akar masalah lalu ulangi
seed. Marker tidak boleh tertinggal sebagian. Bila marker hilang pada database
yang sudah berisi data operasional, seed menolak (`OPERATIONAL_DATA_PRESENT`)
dan membutuhkan audit/manual, bukan seed otomatis.

## 6. Full import Jubelio

**Prasyarat izin:** full import mengirim `POST /login` dan
`POST /inventory/items/all-stocks/` (pembacaan). Izin itu tidak mencakup Sales
Order, invoice, payment, adjustment, booking shipment, atau perubahan master
Jubelio. Jangan menjalankan import kedua secara bersamaan (advisory lock akan
menolak dengan `IMPORT_ALREADY_RUNNING`).

```bash
docker compose -p production --env-file .env --profile tools run --rm \
  bootstrap npx tsx src/import-jubelio.ts --full \
    --expected-database qadfstore_production \
    --report-file /reports/import-$(date +%Y%m%dT%H%M%S).json
```

Yang dilakukan mode `--full`:

- Menolak `--item-name`, `JUBELIO_SYNC_MAX_PRODUCTS` berisi, dan
  `JUBELIO_SYNC_START_PAGE` selain 1 — sebelum side effect.
- Membaca dari halaman 1 tanpa cap/filter, upsert per halaman, lalu melakukan
  enumerasi kedua (masters saja) untuk mendeteksi sumber berubah.
- Menulis report durable: halaman, himpunan ID group/SKU, coverage pasangan
  stok, error/mismatch tersanitasi. Status `complete` hanya setelah
  rekonsiliasi database lulus.
- Tidak memberikan jam operasional contoh ke cabang: row baru memakai `{}`,
  row existing mempertahankan jam yang diubah operator.
- Tidak menghapus produk/variant yang hilang dari sumber; selisih dilaporkan.

Harapan: `FULL_IMPORT_COMPLETE`, exit `0`, report di `/reports/`.

**STOP** bila `FULL_IMPORT_INCOMPLETE`, exit `4`, timeout, atau report parsial.
Situs tetap belum dibuka. Perbaiki penyebab (jaringan/kredensial/data provider),
lalu ulangi full import dari halaman 1 — upsert tidak menduplikasi. Jangan reset
schema atau menjalankan seed demo sebagai "perbaikan".

## 7. Verifikasi hasil

```bash
docker compose -p production --env-file .env --profile tools run --rm \
  bootstrap verify --config /bootstrap/bootstrap.config.json \
    --import-report /reports/import-<run>.json
```

Verifier memeriksa (read-only): identitas target, history migration + schema
contract, marker referensi, Initial Roles, HQ, config sistem yang wajib,
System Owner + credential-nya, kecocokan ID katalog database dengan report,
serta invariant local hold. Setiap kegagalan dicetak sebagai
`verifikasi <CHECK> gagal`.

- `BOOTSTRAP_VERIFIED`, exit `0` → lanjut smoke terbatas.
- `BOOTSTRAP_INCOMPLETE`, exit `4` → jangan lanjut; perbaiki temuan.

Output juga mencetak **launch blockers** (pajak/settlement/SMTP/OAuth/cron/
stock-write) yang berasal dari environment service `bootstrap`. Itu indikator
konsistensi, bukan bukti konfigurasi runtime store; verifikasi akhirnya pada
service `store` (§9).

## 8. Start terbatas dan smoke

**Prasyarat:** bootstrap verified, akses publik masih dibatasi pada operator
(firewall allowlist IP), port proxy tidak konflik.

```bash
docker compose -p production --env-file .env up -d store admin
```

Smoke minimum:

1. Login admin dengan Owner → harus diarahkan mengganti password
   (`mustResetPassword=true`). Sesi admin tidak boleh dipakai sebagai client
   store.
2. Buka daftar + detail produk store/admin; periksa produk dari halaman kedua
   dan variant/SKU ikut tampil. Ini memeriksa jalur data, bukan redesign UI.
3. Buat akun operasional (HQ/Admin) dengan Home Branch yang benar lewat admin.
4. Siapkan konten storefront (homepage, footer, halaman statis/legal) — tidak
   ada fallback/demo yang diandalkan.

**STOP** bila login/reset gagal, katalog kosong/tidak lengkap, atau Anda perlu
mengekspos port aplikasi langsung/URL rahasia sebagai kontrol akses.

## 9. Prasyarat transaksi dan integrasi

Kerjakan setelah smoke lulus, tetap dengan akses terbatas dan
`JUBELIO_STOCK_WRITES_ENABLED=false` sampai aktivasi eksplisit:

- Rate/ID pajak (`tax.ppnRatePercent` + `jubelio.salesTaxId`) cocok dengan
  `GET /taxes/` tenant; `discounts.contractVersion` sesuai keputusan cutover.
- Settlement: `JUBELIO_PAYMENT_ACCOUNT_ID` dan `JUBELIO_PAYMENT_TYPE` (nilai
  numeric kontrak runtime, bukan string lama) terisi dan terverifikasi.
- SMTP/OAuth production; Midtrans production config + notification URL.
- Live stock: keputusan `JUBELIO_STOCK_WRITES_ENABLED` + stock freshness,
  webhook Jubelio, daily stock reconciliation.
- Cron: sweep reservation dan order communications dipasang/dipantau sesuai
  runbook existing (lihat [cron-sweep.md](cron-sweep.md),
  [order-communications.md](order-communications.md)).
- Delivery (bila diaktifkan): origin tiap cabang, contact/address hierarchy,
  parcel/packaging, Shipment credentials/webhook — lihat
  [shipment-readiness.md](shipment-readiness.md).

Uji write live (SO/payment/booking) membutuhkan izin terpisah. Bukti mock bukan
bukti live.

## 10. Go-live dan pemantauan

Gate go-live (centang hanya dengan evidence):

- [ ] Owner sign-off tertulis dan daftar akun operasional final.
- [ ] Rate/ID pajak, settlement, stock write, dan contract gate sesuai flow yang
      diaktifkan.
- [ ] SMTP/OAuth/Midtrans/webhook/cron terverifikasi (bukan mock).
- [ ] Konten storefront production direview.
- [ ] `checkout.paused=false` diubah lewat keputusan eksplisit, lalu **restart
      store** agar config cache membaca ulang.
- [ ] Akses publik dibuka (firewall/proxy) dan monitoring + penanggung jawab
      rollback ditetapkan.

Pantau setelah release: error log, settlement provider, kesegaran stok,
webhook, dan cron. Jangan menghapus transaksi/katalog sebagai workaround.

## Recovery ringkas

| Kejadian | Recovery aman |
|---|---|
| Preflight menolak target | Perbaiki config/identitas; tidak ada write. |
| Migration gagal | Simpan error + backup; diagnosis di DB disposable dengan release sama. Jangan seed/push/reset. |
| Seed gagal | Transaksi rollback; ulangi setelah fix; jangan repair marker manual. |
| Owner dibuat, tahap gagal | Pertahankan Owner; lanjut tahap berikut, jangan create ulang. |
| Import berhenti/berubah | Pertahankan data parsial; ulangi full dari halaman 1. |
| Smoke/gate gagal | Tetap akses terbatas + checkout paused; jangan buka transaksi sebagai workaround. |
| Masalah setelah live | Tahan checkout baru, tinjau order/attempt in-flight; restore/downgrade direview dulu. |

## Deployment berikutnya (bukan deployment pertama)

`backup → preflight release/target → migrate (jika ada) → deploy binary yang
kompatibel → smoke/verifikasi`. **Tidak** menjalankan Owner bootstrap, reset,
atau seed demo. Seed referensi versi sama boleh diuji no-op tetapi bukan syarat
restart harian; perubahan referensi versi berikutnya memerlukan migration/operasi
yang direview.

## Batas verifikasi runbook ini

Sesi implementasi tidak menjalankan Docker, SSH, database production, atau
request Jubelio live. Command di atas mengikuti kontrak script yang diuji pada
level unit/DB-disposable; langkah yang menyentuh host production atau provider
live ditandai **belum diverifikasi di target** dan membutuhkan operator dengan
izin eksekusi terpisah.
