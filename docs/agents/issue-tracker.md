# Issue tracker: Local Markdown

Tracker lokal menggunakan `.scratch/<feature>/`, sesuai
[panduan artefak](../../.scratch/README.md). Tidak ada index status global.
Status conceptual plan hanya ada pada `index.md` fitur; status setiap ticket
hanya ada di file ticket. Publikasi spec dan breakdown mengikuti approval
[`AGENTS.md`](../../AGENTS.md) dan
[`development-workflow`](../../.agents/skills/development-workflow/SKILL.md).

## Lokasi

| Artefak | Path dari root repo |
|---|---|
| Navigasi dan status plan | `.scratch/<feature>/index.md` |
| Wayfinding map | `.scratch/<feature>/wayfinder/map.md` |
| Decision ticket | `.scratch/<feature>/wayfinder/NN-<slug>.md` |
| Implementation map | `.scratch/<feature>/ticket/map.md` |
| Implementation ticket | `.scratch/<feature>/ticket/NN-<slug>.md` |
| Research / spec | `.scratch/<feature>/research/` / `.scratch/<feature>/plan/` |

Kedua jenis ticket memiliki namespace nomor terpisah. Jangan membuat folder
`<feature>-implementation`, `issues/`, atau tracker tambahan. Saat skill meminta
"publish", tulis ke lokasi tahap yang sesuai setelah approval; saat meminta
"fetch", baca named link/path ticket atau map tersebut. Tidak ada publikasi
remote otomatis.

## Metadata dan operasi

- Pertahankan `Type: research | prototype | grilling | task`,
  `Status: open | claimed | resolved`, `Assignee`, dan `Blocked by:`.
- `Blocked by: NN, NN` mengacu pada ticket prerequisite dalam tahap yang sama.
  Blocker lintas tahap/fitur harus memakai named link yang jelas, bukan nomor ambigu.
- Ticket tanpa blocker (`none`/kosong) atau dengan seluruh blocker `resolved`
  adalah unblocked. Frontier adalah ticket open, unblocked, unclaimed, urut nomor.
- Temukan frontier dengan memindai ticket bernomor pada folder tahap terkait,
  bukan seluruh Markdown (folder itu juga memuat map/handoff/evidence).
- Claim: ubah `open` menjadi `claimed` sebelum bekerja. Resolve: tulis jawaban
  atau hasil verifikasi di `## Answer`, lalu set `resolved` setelah gate lulus.
- Map berlabel `wayfinder:map` atau `implementation:map` menyediakan navigasi.
  Decision map memakai Destination, Notes, Decisions so far, Not yet specified,
  dan Out of scope. Tautkan jawaban bernama dengan ringkasan satu baris, jangan
  menduplikasi jawaban lengkap atau frontier status di map/index.
- Percakapan dapat ditambahkan di `## Comments`. Jangan menganggap metadata lama
  sebagai izin baru. Plan, decision ticket, dan implementation ticket memiliki
  lifecycle berbeda; ticket `resolved` tidak otomatis menjadikan plan Done.

Research subagents, provider requests, sandbox writes, application changes,
commit, dan remote publication tetap membutuhkan izin sesuai aturan repo.
