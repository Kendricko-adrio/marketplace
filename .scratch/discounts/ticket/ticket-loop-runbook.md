# Runbook — conductor tiket diskon

Prosedur operasional untuk `.scratch/discounts/ticket/ticket-loop-plan.md`.
Conductor menjalankan **satu proses `pi` baru per tiket**; tidak ada context
lintas tiket. Status tiket tetap ditulis oleh sesi tiket, bukan oleh conductor.

## 1. Preflight (sekali per mesin/sesi)

Jalankan dari root worktree:

```bash
docker compose up -d                       # PostgreSQL 16
npm ci                                     # dependency workspace
pi mcp list                               # context7 harus "connected"
pi mcp login context7                      # hanya jika status belum sign-in
pi --approve -p "balas OK"                 # canary auth model, sesi sekali pakai
npm run test:e2e:install                   # Chromium untuk mock E2E
```

Pastikan:

- Worktree bersih saat mulai (`git status --short` kosong). Baseline checkpoint
  `2ddc252` sudah memuat pekerjaan tiket 01–07.
- `.env` menunjuk **database disposable** (bukan DB existing), dan gate
  `discounts.contractVersion` tetap `0` untuk environment operasional.
- `node --version` ≥ 20 (repo memakai Node 24).
- Tidak ada sesi `pi` lain yang sedang menulis worktree yang sama.
- Mesin tidak sleep saat loop berjalan (Windows: Power & sleep → Never).

`--approve` diperlukan karena print mode tidak bisa menampilkan trust prompt,
dan `.pi/mcp.json` hanya dibaca untuk project yang trusted.

## 2. Cek rencana sebelum spawn

```bash
node scripts/ticket-next.mjs          # claimed / ready / next
node scripts/ticket-next.mjs --json   # rencana lengkap + blocker
node scripts/ticket-next.mjs --status 07
```

Urutan yang diharapkan setelah tiket 01–07 resolved:

```
claimed : -
ready   : 05, 08
next    : 05
```

Dry-run conductor (tidak menjalankan model):

```bash
DISCOUNTS_DRY_RUN=1 DISCOUNTS_MAX_TICKETS=1 bash scripts/ticket-loop.sh
```

## 3. Menjalankan

```bash
bash scripts/ticket-loop.sh
```

Default model conductor adalah **`ollama/deepseek-v4.1-flash:1017-cloud` dengan
thinking `high`**, diteruskan eksplisit ke setiap proses `pi` melalui
`--provider/--model/--thinking`. Conductor mencetak baris `model: ...` di awal
supaya log menunjukkan konfigurasi yang dipakai.

Disarankan di terminal khusus / tmux, karena conductor menunggu proses `pi`
selama tiket berjalan (bisa 1–3 jam per tiket).

Override:

```bash
# model lain, thinking lebih murah
DISCOUNTS_MODEL="deepseek-v4-flash:cloud" DISCOUNTS_THINKING="medium" \
  bash scripts/ticket-loop.sh

# mewarisi settings pi sepenuhnya (jangan pass flag model/thinking)
DISCOUNTS_PROVIDER= DISCOUNTS_MODEL= DISCOUNTS_THINKING= \
  bash scripts/ticket-loop.sh

# satu tiket dulu, dengan checkpoint lokal
DISCOUNTS_MAX_TICKETS=1 DISCOUNTS_CHECKPOINT=1 bash scripts/ticket-loop.sh
```

## 4. Menghentikan

- **Berhenti rapi di antara tiket**: `touch .scratch/discounts/ticket/STOP`
- **Hentikan sekarang**: `Ctrl+C` di terminal conductor. Di Windows, proses
  `pi` anak bisa tetap hidup; tutup terminal atau hentikan PID node anak lewat
  Task Manager jika perlu. Ini keterbatasan proses biasa; versi RPC punya stop
  terprogram.
- **Hapus** `STOP` sebelum menjalankan loop lagi.

## 5. Monitoring live dan memeriksa hasil

### Monitoring live

Session JSONL ditulis Pi secara live; watcher membaca file itu tanpa mengganggu
proses yang berjalan:

```bash
# sesi terbaru di cwd ini, ikuti terus (Ctrl+C untuk berhenti)
node scripts/ticket-watch.mjs

# sesi tertentu, sekali lihat
node scripts/ticket-watch.mjs --session discounts-05-a1 --once --last 15

# lihat 30 entry terakhir lalu keluar
node scripts/ticket-watch.mjs --session discounts-05-a1 --once --last 30
```

Arti kolom:

| Kolom | Arti |
| --- | --- |
| `ctx=96.4k` | perkiraan context request terakhir (`input + cacheRead + cacheWrite`), bukan total kumulatif |
| `out=137` | output token request itu |
| `Σ tok=1.54M` | total token yang diproses sejak sesi dimulai (kumulatif) |
| `think=high` | thinking level yang benar-benar dipakai model |
| `→ tool · ...` | tool call yang sedang dijalankan |
| `result ... ERROR` | tool call gagal |

Watcher juga mencetak `Σ` total saat Ctrl+C, dan path file session di baris
pertama. Model/provider diambil dari tiap pesan assistant, sehingga terlihat
apakah `deepseek-v4.1-flash:1017-cloud` benar-benar dipakai.

### Setelah sesi selesai

```bash
# log per tiket (di luar repo)
ls "$TEMP/discounts-loop"
tail -n 80 "$TEMP/discounts-loop/05-a1.out"

# transkrip sesi pi (dari cwd yang sama)
pi --session discounts-05-a1
pi --export discounts-05-a1 ~/discounts-05.html

# status tiket + evidence
node scripts/ticket-next.mjs --status 05
sed -n '/## Answer/,$p' .scratch/discounts/ticket/05-excel-import-export-and-retry.md
```

Conductor menyimpan:

| File | Isi |
| --- | --- |
| `<id>-a1.out` | stdout final sesi (termasuk token `TICKET:NN:...`) |
| `<id>-a1.err` | stderr pi |
| `<id>-a1-retry.out/.err` | percobaan ulang dengan sesi yang sama |
| `<id>-blocked.txt` | penanda gagal/blocked dari conductor |

## 6. Melanjutkan tiket yang blocked

1. Baca `## Comments` di tiket dan log `.out`.
2. Jawab keputusan/izin yang diminta (edit `## Comments` atau bagian kontrak).
3. Jalankan loop lagi; tiket yang masih `claimed` dipilih lebih dulu.

Jika tiket perlu percobaan yang benar-benar baru (bukan melanjutkan konteks
lama), ganti session id di loop (`a1` → `a2`) atau jalankan manual:

```bash
pi --approve -p --session-id discounts-08-a2 \
  @.scratch/discounts/ticket/08-promo-replacement-and-invalidation.md \
  @.scratch/discounts/ticket/ticket-prompt.md \
  "Eksekusi tiket 08 dari state repo saat ini."
```

## 7. Troubleshooting

| Gejala | Penyebab / tindakan |
| --- | --- |
| `resolver gagal` | Blocker typo, status tidak dikenal, atau siklus. Perbaiki frontmatter; jangan menebak. |
| `binary 'pi' tidak ditemukan` | Jalankan dari Git Bash dengan npm global di PATH; atau set `DISCOUNTS_PI_BIN`. |
| `context7` tidak tersedia di sesi | `pi mcp login context7`; pastikan `--approve` dan `.pi/mcp.json` ada. |
| DB error di sesi | `docker compose up -d`; cek `DATABASE_URL` menunjuk DB disposable. |
| Playwright gagal | Baca laporan Markdown/trace di `playwright/results/mock/`; jangan buka PNG. |
| Sesi berhenti `length`/abort | Conductor retry sekali dengan sesi yang sama; lihat `.err`. |
| Dua conductor | Lock `%TEMP%/discounts-loop/.lock` menolak yang kedua. |
| Worktree kotor setelah crash | State ada di file; periksa `git status`, lalu lanjutkan tiket `claimed`. |

## 8. Batas keamanan

- Tidak ada push, deploy, SSH/remote, atau provider write di dalam loop.
- `DISCOUNTS_CHECKPOINT=1` hanya membuat commit lokal berisi seluruh perubahan
  yang tidak di-ignore sejak checkpoint sebelumnya; `.pi/subagents/` dikecualikan.
  Tetap tanpa push.
- Tiket 13 akan berhenti bila UAT staging/sign-off belum tersedia. Itu hasil
  yang benar; jangan menandai `resolved` untuk melewatinya.
- Hentikan loop bila muncul keputusan produk baru yang tidak tercakup spec.
