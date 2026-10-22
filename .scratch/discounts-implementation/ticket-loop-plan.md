# Plan singkat — conductor tiket diskon (satu tiket = satu sesi `pi`)

Status: **Disetujui pemilik, siap dieksekusi** (22 Oktober 2026).
Effort: `.scratch/discounts-implementation/`.
Bukan plan di `plan/`: ini tooling satu-fitur untuk effort yang sudah berjalan,
bukan conceptual multi-feature plan. Tracker tiket tetap di `issues/`.

## Tujuan

Menyelesaikan tiket `05`–`13` secara otonom dengan pola **satu proses `pi` baru
per tiket**, sehingga:

- tidak ada context window yang menumpuk lintas tiket;
- setiap tiket selesai, sesi berikutnya benar-benar baru;
- pemilihan tiket deterministik dari frontmatter (`Status`, `Blocked by`), bukan
  dari model;
- hanya satu writer berjalan pada satu waktu (satu worktree, satu DB).

Conductor adalah skrip bash/node biasa, bukan model. Yang menjadi "main agent"
adalah setiap proses `pi -p`, sehingga aturan `AGENTS.md` §4 (hanya main agent
yang menjalankan validasi) tetap dipatuhi.

## Non-scope

- Tidak mengubah kode produk, schema, seed, atau perilaku aplikasi.
- Tidak menulis status tiket dari conductor; status hanya ditulis sesi tiket.
- Tidak menjalankan provider write, `npm run test:e2e` legacy, SSH/remote,
  Docker remote, deployment, atau push.
- Tidak menggantikan review manusia untuk keputusan produk baru; sesi tiket
  berhenti dan mencatat `## Comments` bila menemui konflik kontrak.

## Keputusan

1. **Resolver read-only** (`scripts/ticket-next.mjs`): prioritas `claimed`,
   lalu `open` bernomor terkecil yang seluruh blocker-nya `resolved`.
2. **Retry sekali** memakai session id yang sama (konteks tiket itu tetap ada).
   Token `TICKET:NN:BLOCKED` langsung menghentikan loop.
3. **Checkpoint commit opt-in** (`DISCOUNTS_CHECKPOINT=1`), lokal, tanpa push.
   Default mati.
4. **Log di luar repo** (`%TEMP%/discounts-loop`) agar worktree tetap bersih.
5. **Test resolver** masuk ke `npm run test:unit` lewat project vitest `scripts/`.
6. Tiket `13` dijalankan sampai batasnya; bila gate UAT/staging belum ada,
   tiket berhenti sebagai blocked dan loop berhenti — itu hasil yang benar.
7. **Model default conductor**: `ollama/deepseek-v4.1-flash:1017-cloud` dengan
   `--thinking high`, diteruskan eksplisit ke setiap proses `pi`. Override lewat
   `DISCOUNTS_PROVIDER`/`DISCOUNTS_MODEL`/`DISCOUNTS_THINKING`; kosongkan untuk
   mewarisi settings pi.

## File

| File | Isi | Acceptance |
| --- | --- | --- |
| `scripts/ticket-next.mjs` | parser frontmatter, validasi graf, pemilihan frontier, mode `--quiet/--json/--status/--no-claimed/--skip/--issues-dir` | unit test; exit 2 untuk graf rusak; tidak menulis file |
| `scripts/ticket-next.test.mjs` | unit test pure graph (claimed-first, blocker, `## Answer`, normalisasi status, siklus) | `npm run test:unit` lulus |
| `scripts/ticket-watch.mjs` | monitor live session JSONL: model/thinking, tool call, ctx/out/tok, error, total saat Ctrl+C | demo pada sesi nyata; tidak menulis apa pun |
| `scripts/ticket-watch.test.mjs` | unit test formatter/ringkasan tool/sum usage | `npm run test:unit` lulus |
| `scripts/vitest.config.mts` | project vitest khusus `scripts/*.test.mjs` | terdaftar di root config |
| `vitest.config.mts` | tambah satu entri project | suite lama tidak berubah |
| `.scratch/discounts-implementation/ticket-prompt.md` | protokol per sesi: batas, TDD, L0–L2, kontrak selesai/blocked | dipakai apa adanya oleh conductor |
| `scripts/ticket-loop.sh` | lock, preflight ringan, spawn `pi -p`, deteksi status, retry, stop, dry-run | `bash -n`; `DISCOUNTS_DRY_RUN=1` mencetak perintah tanpa spawn |
| `.scratch/discounts-implementation/ticket-loop-runbook.md` | preflight, start/stop, inspeksi session, resume, troubleshooting | prosedur dapat diikuti tanpa membaca kode |

## Verifikasi

1. `npx vitest run --project scripts` (atau `npm run test:unit` penuh).
2. `bash -n scripts/ticket-loop.sh`.
3. `node scripts/ticket-next.mjs`, `--json`, `--status 07`, `--no-claimed`.
4. `node scripts/ticket-watch.mjs --session <id> --once` mencetak ringkasan sesi nyata.
5. `DISCOUNTS_DRY_RUN=1 DISCOUNTS_MAX_TICKETS=1 bash scripts/ticket-loop.sh`
   mencetak perintah `pi` yang akan dijalankan, tanpa spawn.
5. Satu tiket nyata dijalankan hanya setelah pemilik memulai loop; sesi itu
   sendiri yang menjalankan L0–L2 sesuai protokol.

## Risiko dan mitigasi

- **Dua conductor** → lock `mkdir` atomik.
- **Sesi macet/limit** → retry sekali dengan session yang sama, lalu stop.
- **Keputusan produk** → `BLOCKED`, `## Comments`, stop. Tidak ada retry buta.
- **Worktree kotor** → checkpoint opt-in; tanpa checkpoint, state tetap di file
  dan tiket `claimed` dapat dilanjutkan.
- **DB/dev server** → preflight di runbook; loop tidak menyalakan/mematikan
  layanan.
