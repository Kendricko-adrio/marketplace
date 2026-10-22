# Protokol eksekusi satu tiket (discounts)

Anda adalah **main agent** untuk SATU tiket. Anda bukan subagent. Tidak ada
manusia yang akan menjawab pertanyaan pada sesi ini; jangan menunggu input.
Tiket target adalah file tiket yang disertakan pada pesan ini (nomornya ada di
judul file).

## 1. Rekonstruksi state sebelum menyentuh kode

Baca, dalam urutan ini:

1. `AGENTS.md` (aturan repo, testing, izin).
2. `.scratch/discounts-implementation/map.md` bagian "Kontrak bersama untuk
   semua ticket" dan graph.
3. File tiket target, seluruh acceptance criteria dan batasnya.
4. `plan/discounts-spec.md` bagian yang dirujuk tiket.
5. 100 baris terakhir `.scratch/discounts-implementation/execution.md`.
6. Dokumen fitur/API yang relevan di `docs/`.

Perubahan di worktree dari tiket sebelumnya adalah hasil kerja yang sah.
**Jangan** `git reset`, `git checkout`, revert, atau "merapikan" file di luar
scope tiket ini.

Klaim tiket sebelum mulai: ubah `Status: open` menjadi `Status: claimed` dan
`Assignee: main-agent`. Jika sudah `claimed`, lanjutkan.

## 2. Batas kerja

- Ikuti `AGENTS.md`. Subagent hanya boleh author/edit; **Anda** yang menjalankan
  semua validasi. Gunakan subagent hanya jika lane-nya benar-benar terpisah.
- Context7 wajib sebelum memakai API library yang belum dikonfirmasi. Catat
  `Context7 checkpoint: <library-id> — <yang diverifikasi>` di Answer.
- Schema hanya di `packages/db/src/schema/`. Timestamp `timestamptz`. Jangan
  mengedit SQL generated di `packages/db/drizzle/`.
- DB = database disposable dari `.env`. Gate `discounts.contractVersion` tetap
  `0` di environment operasional.
- **Jangan**: commit, push, SSH/remote, operasi Docker remote, deployment,
  provider write nyata (Jubelio/Midtrans/Shipment), atau `npm run test:e2e`
  legacy. E2E hanya lewat `playwright.mock.config.ts`.
- Jangan mengubah scope tiket lain, jangan melemahkan test/guard agar hijau,
  jangan mengarang evidence.

## 3. Eksekusi

1. Pecah tiket menjadi slice vertikal kecil: satu perilaku publik + test-nya.
2. TDD: tulis test yang gagal dulu pada public seam, lalu implementasi minimal,
   lalu hijau. Satu slice pada satu waktu.
3. L0 setiap slice: `npm run verify:types:store` dan/atau
   `npm run verify:types:admin`.
4. L1 setiap slice: `npm run verify:unit:slice -- <path test yang disentuh>`.
   Daftar file eksplisit; jangan biarkan implicit.
5. L2 sebelum menutup tiket: `npm run verify:batch:unit` dan mock E2E yang
   terdampak `npm run verify:batch:e2e -- e2e/<app>/<spec>.spec.ts`.
6. Jika Playwright gagal, baca laporan Markdown/trace; jangan membuka PNG.
7. Update schema/seed/logging/docs yang terkena perubahan. Log wajib lewat
   structured logger aplikasi; jangan log token, PII, atau kode promo literal.
8. Jika konteks menipis: rangkum state ke `execution.md` dan/atau `## Comments`
   tiket, lalu lanjut. Jangan mengulang pekerjaan yang sudah terbukti.

## 4. Kontrak selesai

- Tulis/refresh `## Answer` di tiket: acceptance IDs, file yang berubah,
  command + environment + hasil (pass/fail/blocked/skipped), dan gap yang
  **tidak** diklaim selesai.
- Set `Status: resolved` **hanya jika** semua checkbox tiket valid dan evidence
  nyata sudah dijalankan. Infrastructure skip bukan pass.
- Tambahkan ringkasan 3–8 baris ke `execution.md` (apa yang berubah, evidence,
  gap) agar sesi berikutnya punya konteks.
- Baris terakhir stdout harus salah satu:
  - `TICKET:NN:RESOLVED`
  - `TICKET:NN:INCOMPLETE` (masih ada pekerjaan, bukan blocked)
  - `TICKET:NN:BLOCKED:<alasan singkat>`

## 5. Jika terhalang

- Butuh keputusan produk/kontrak baru: **jangan** putuskan sendiri, **jangan**
  bertanya. Tulis `## Comments` berisi pertanyaan, opsi, rekomendasi, dan
  evidence yang sudah ada. Biarkan `Status: claimed`. Cetak `BLOCKED`.
- Butuh izin baru (provider write, remote, commit, deployment, UAT staging):
  perlakukan sama: catat di `## Comments`, cetak `BLOCKED`, berhenti.
- Kegagalan environment yang tidak bisa Anda perbaiki (DB mati, dependency
  hilang, MCP tidak terautentikasi): catat di `## Comments` dan `BLOCKED`.

## 6. Larangan penutupan palsu

- Jangan menulis `resolved` jika test tidak dijalankan.
- Jangan mengganti live-provider test dengan mock lalu mengklaim lulus.
- Jangan menandai acceptance ID selesai hanya karena subagent melaporkan.
- Jangan menutup tiket demi membuat conductor melanjutkan tiket berikutnya.
