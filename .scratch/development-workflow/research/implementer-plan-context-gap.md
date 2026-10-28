# Research: kenapa implementer "kehilangan plan" — batas upstream `to-spec`/`to-tickets`/`implement` dan kompensasinya

Tanggal riset: 2026-10-26. Metode: `web_search` (Ollama) untuk menemukan dokumen primer, lalu fetch langsung ke
[`mattpocock/skills`](https://github.com/mattpocock/skills) (`main`, docs + `skills/**/SKILL.md`), ditambah pembacaan
salinan vendored di [`../../../.agents/skills/`](../../../.agents/skills/) (pin `c55ee46073ed923f86ce59a5eb3b6d895095d1b7`,
lihat [`docs/architecture/matt-skills-integration.md`](../../../docs/architecture/matt-skills-integration.md)).

Fokus: gejala "agent kurang plan saat mengerjakan ticket sehingga keputusan di code jelek dan keluar dari hasil
wayfinder/grilling". Dokumen ini riset, bukan izin implementasi, subagent, commit, atau perubahan workflow.

## 1. Ringkasan temuan

1. **Upstream memang sengaja membuat spec dan ticket bebas path dan bebas code snippet.** `to-spec` menulis
   *"Do NOT include specific file paths or code snippets. They may end up being outdated very quickly"*, dan `to-tickets`
   mengulang aturan yang sama. Ticket hanya membawa **perilaku + acceptance + blocker**, bukan HOW.
2. **`implement` sendiri menyatakan itu titik terlemahnya.** Dokumen resmi `docs/engineering/implement.md`:
   *"The 'pre-agreed' part matters, and it is also the skill's weakest point. Nothing inside `implement` agrees the seams.
   … If it happens nowhere, the run becomes 'just write the code' and nothing warns you."* Jadi gejala yang dilaporkan
   bukan salah pakai; itu **lubang yang diakui penulisnya**.
3. **Drift dari grilling/wayfinder lahir di `to-spec`, bukan di `implement`.** `to-spec` **tidak melakukan interview**:
   ia menyintesis percakapan. *"If the spec states something you never said, that is a defect"*, dan
   *"if the spec surprises you, the grilling was too shallow; the spec is not too long"*. Keputusan yang belum
   diselesaikan di grilling/wayfinder akan diisi diam-diam oleh sintesis, lalu diwarisi ticket dan implementer.
4. **Keputusan grilling memang tidak otomatis tersimpan.** `grill-with-docs` hanya menulis `GLOSSARY.md` saat istilah
   selesai, dan ADR hanya bila tiga gate terpenuhi sekaligus. Sisanya: *"most of what you agreed exists only in the
   context window you agreed it in."* `to-spec` harus dijalankan **di sesi yang sama**, sebelum context dibersihkan.
5. **Repo ini sudah menambal dua lubang terbesar** (blueprint teknis file-level + kontrak exported, dan "Kontrak bersama"
   lintas ticket), tetapi **penambalan itu hidup satu level di atas ticket** — sehingga sesi implementer yang hanya
   membaca file ticket tetap kehilangan HOW. Itu kandidat utama penyebab gejala.

## 2. Alur resmi dan percabangannya

`ask-matt` menegaskan: yang dirutekan adalah **flow**, bukan skill tunggal. Table di `docs/engineering/ask-matt.md`
dan README:

| Posisi kamu | Yang dijalankan |
|---|---|
| Belum memutuskan apa pun, ada repo, muat satu sesi | `grill-with-docs` (`grilling` + `domain-modeling`) |
| Belum memutuskan, tanpa working directory | `grill-me` |
| Besar, berkabut, lintas sesi (>1 sesi) | `wayfinder` → peta decision ticket |
| Sudah diputuskan, muat satu context window | `implement` langsung (skip spec/ticket) |
| Sudah diputuskan, lintas sesi | `to-spec` → `to-tickets` → `implement` per ticket |
| Peta wayfinder sudah clear | `to-spec #<map>` → `to-tickets` → `implement` |
| Sudah jadi, ingin diperiksa | `code-review` |
| Ingin seluruh graph ticket landed satu run | `implement-spec` (butuh worktree per subagent) |

Batas tunggal yang dipakai upstream: **jumlah sesi**, bukan besar-kecil fitur. `grill-with-docs` = perencanaan satu sesi;
`wayfinder` = perencanaan multi-sesi.

Semua skill inti memakai `disable-model-invocation: true`: **agent tidak boleh memilihnya sendiri**, manusia yang
mengetik slash command. Ini penting untuk diagnosis: kalau satu tahap terasa hilang, biasanya bukan karena agent
melewatkannya, tapi karena tahap itu memang tidak pernah dijalankan.

## 3. Pembagian informasi yang sebenarnya (siapa menyimpan apa)

| Artefak | Isi | Yang **tidak** ada di situ |
|---|---|---|
| `grilling` | keputusan di kepala + percakapan | file apa pun |
| `grill-with-docs` | `GLOSSARY.md` (istilah), `docs/adr/*` (keputusan irreversibel) | keputusan biasa, spec, ticket |
| `wayfinder` map + decision ticket | satu keputusan per ticket, gist di `Decisions so far` | rencana build, path file |
| `to-spec` | problem, solusi, user stories, implementation decisions (module/interface), testing decisions, out-of-scope, **seam yang disepakati** | **path file, snippet, urutan pengerjaan** |
| `to-tickets` | slice vertikal + blocking edges + acceptance | path file, desain teknis |
| ticket | perilaku end-to-end + acceptance + blocker | HOW, kontrak module, seam (kecuali ditulis manual) |
| `implement` | kode + test + typecheck + review + commit | keputusan desain baru |

Konsekuensinya: **HOW disimpan paling jauh di `to-spec` (module + interface), dan hilang di `to-tickets`.** Ticket adalah
dokumen *what to build*, bukan *how to build it*. Upstream mengandalkan `tdd` untuk "menanyakan seam" di awal run;
tetapi `tdd` menolak menulis test pada seam yang belum dikonfirmasi, dan tidak ada yang mengonfirmasi bila spec/ticket
tidak menyebutnya.

## 4. Tiga mode kegagalan yang dilaporkan upstream sendiri

| Kegagalan | Kutipan / sumber | Mitigasi resmi |
|---|---|---|
| Seam tidak disepakati → run jadi "just write the code" | `docs/engineering/implement.md` §Pre-agreed seams | sebut seam di spec/ticket |
| Ticket horizontal (per layer) → acceptance saling silang, rework besar | `docs/engineering/to-tickets.md` §Tracer bullets; satu tim 26 ticket by layer, ~20 run per ticket, ¾ rework | quiz "apa yang bisa didemokan saat ticket ini selesai?" |
| Terlalu banyak ticket (12 ticket untuk perubahan 3 baris) | `docs/engineering/to-tickets.md` FAQ | merge saat quiz; kalau muat satu context window, jangan pakai `to-tickets` |
| Acceptance criteria tidak menguji apa pun (lulus di base commit) | `docs/engineering/to-tickets.md` FAQ | untuk tiap kriteria, sebut observasi yang membuatnya salah, dan pastikan gagal di commit awal |
| `to-spec` memotong context / gagal membaca spec | FAQ `to-spec` | jangan `clear`/`compact` antara `to-spec` dan `to-tickets` |
| `implement` tidak menutup ticket | FAQ `implement` | tutup manual; kalau tidak, frontier tidak pernah terbuka |
| `implement` menjalankan `code-review` pada diff kosong (belum commit) | FAQ `implement` | commit dulu, review terhadap titik branch; atau review di sesi terpisah |
| `implement-spec` paralel: bentrok file, review loop 4 jam | `docs/engineering/implement-spec.md` | satu writer per worktree, review sekali di akhir, hentikan fix-loop setelah satu putaran |

## 5. Perbandingan dengan workflow repo ini

Repo ini sudah memakai flow upstream tetapi menambahkan gate yang tidak ada di upstream:

| Kebutuhan | Upstream | Repo ini (lebih ketat) | Bukti |
|---|---|---|---|
| Approval sebelum siap | `to-spec` publish langsung dengan label `ready-for-agent` | approval kesepahaman + approval **complete** scope/acceptance sebelum `Ready` | [`development-workflow` §2](../../../.agents/skills/development-workflow/SKILL.md), [`AGENTS.md` §4](../../../AGENTS.md) |
| HOW di level file | tidak ada (sengaja) | **technical blueprint**: tabel path/layer/tanggung jawab/seam + kontrak export + `discovery:` | [`.scratch/templates/plan.md`](../../templates/plan.md), `development-workflow` §2 |
| HOW di level UI | tidak ada | **UX blueprint**: reference page, component reuse map, state matrix dengan copy final | [`.scratch/templates/plan.md`](../../templates/plan.md), [`ux-design` §3](../../../.agents/skills/ux-design/SKILL.md) |
| Kontrak lintas ticket | tidak ada (hanya blocking edges) | **"Kontrak bersama untuk semua ticket"** di map | [`.scratch/discounts/ticket/map.md`](../../discounts/ticket/map.md) |
| Sumber otoritas | tidak eksplisit | **urutan otoritas** (koreksi pemilik > wayfinder > research > CONTEXT/AGENTS) | [`discounts-spec.md` §1.2](../../discounts/plan/discounts-spec.md) |
| Eksekusi satu ticket | `implement` 6 baris | **protokol eksekusi** yang mewajibkan baca AGENTS → map → ticket → spec → execution.md | [`.scratch/discounts/ticket/ticket-prompt.md`](../../discounts/ticket/ticket-prompt.md) |
| Review | 2 axis via subagent paralel | 2 axis di main agent, plus bukti L0–L3 | `AGENTS.md` §5, `development-workflow` §4 |

Artinya: dibanding upstream, repo ini **sudah lebih kuat pada WHAT yang disetujui dan HOW di level modul**. Gejala yang
kamu rasakan bukan karena tidak ada blueprint, melainkan karena **blueprint itu tidak ikut ke dalam paket kerja yang
dibaca implementer**.

## 6. Gap yang masih terbuka (berdasarkan file yang ada)

1. **Ticket tidak memuat irisan blueprint-nya sendiri.** Ticket discounts hanya merujuk `Spec: ../plan/discounts-spec.md`
   dan acceptance/verifikasi; tidak ada tabel file, kontrak export, atau penanda `discovery:` untuk slice itu. Sebuah
   sesi `/implement` yang membaca ticket saja (perilaku normal upstream) harus menebak modul, nama fungsi, dan seam.
   → Ini kandidat penyebab utama "keputusan code jelek".
2. **Tidak ada deviation log pada eksekusi yang sudah jalan.** Template plan mewajibkan `## Deviation log`, tetapi
   [`discounts-spec.md`](../../discounts/plan/discounts-spec.md) (692 baris, 14 seksi) tidak punya seksi itu, dan
   `Answer` ticket mencatat "apa yang berubah" tanpa menandai "apa yang menyimpang dari spec §x". Akibatnya drift
   tidak terlihat, tidak bisa dikoreksi, dan tidak bisa dipelajari.
3. **Keputusan wayfinder tersimpan sebagai gist + detail di ticket, bukan ringkasan keputusan yang ringkas.** Spec
   memuat urutan otoritas yang benar, tetapi implementer harus membuka 12 dokumen untuk tahu batasnya. `map.md`
   sudah mendekati bentuk yang benar ("Batas produk dan evidence" berupa bullet aturan), tetapi belum semua keputusan
   wayfinder diterjemahkan ke bentuk satu-baris-larangan.
4. **Tidak ada `implement-spec` lokal** (tidak di-vendor). Itu bukan kekurangan wajib — `AGENTS.md` membatasi subagent —
   tetapi berarti eksekusi paralel tetap manual dan biaya integrasinya ditanggung main agent.

## 7. Rekomendasi

Urut dari dampak terbesar. Semua ini usulan; mengubah template/skill adalah perubahan perilaku dan butuh keputusanmu.

1. **Tambahkan "Irisan blueprint" wajib di setiap ticket implementasi** (5–8 baris): tabel file (path, aksi, layer,
   seam test), kontrak export yang berubah, dan `discovery:` bila path benar-benar belum diketahui. Ini sengaja
   **melanggar aturan upstream "no file paths"**; alasannya: alasan upstream adalah staleness jangka panjang, sedangkan
   ticket dikonsumsi dalam hitungan hari, dan alternatifnya adalah implementer mengarang arsitektur. Catat
   trade-off-nya di ticket agar review bisa menilainya.
2. **Sebut seam publik + path test RED pertama di ticket.** Ini menutup lubang yang diakui `implement.md`. Satu seam
   per ticket adalah target ideal; kalau lebih, tulis alasannya.
3. **Bawa batas keputusan wayfinder sebagai daftar larangan satu baris di ticket.** Contoh bentuk: "jangan menambah
   service fee", "jangan membuka kembali pembuktian Rp0", "jangan membuat enum lifecycle baru". Rujuk dokumennya,
   tetapi jangan andalkan implementer membuka 12 file.
4. **Wajibkan `Deviation log` per ticket di `## Answer`.** Tiga kolom cukup: apa yang direncanakan, apa yang terjadi,
   alasannya. Ini satu-satunya cara melihat drift sebelum `code-review` menemukannya.
5. **Pakai `code-review` axis Spec terhadap diff working tree** (bukan hanya commit), dengan spec/ticket sebagai acuan.
   Tanpa axis ini, drift hanya ketahuan saat UAT.
6. **Jangan `clear` di antara `to-spec` dan `to-tickets`; jalankan `to-spec` di sesi grilling yang sama.** Ini menghindari
   sintesis ulang dan kehilangan keputusan yang hanya ada di percakapan.
7. **Uji acceptance criteria di base commit.** Setiap kriteria harus punya observasi yang membuktikannya salah. Ini
   menangkap kriteria "pemanis" yang lulus tanpa pekerjaan.
8. **Tetapkan aturan ukuran ticket yang eksplisit:** satu ticket = satu context window, satu sesi, satu writer; kalau
   satu ticket menembus ~100k token, pecah — jangan naikkan effort.
9. **Pertahankan penolakan commit otomatis dan subagent tanpa izin.** Upstream `implement` commit sendiri dan
   `code-review` memakai subagent paralel; keduanya bertentangan dengan `AGENTS.md` §4 dan sudah benar untuk ditolak.

## 8. Checklist operasional (ringkas)

- [ ] Ide kecil satu sesi → `grill-with-docs` → `implement`. Tidak ada spec/ticket.
- [ ] Ide lintas sesi → `grill-with-docs` → (bila berkabut) `wayfinder` → `to-spec` **di sesi yang sama** → approval
      complete spec → `to-tickets` → approval breakdown → `implement` per ticket.
- [ ] Sebelum `to-spec`: pastikan setiap keputusan wayfinder sudah muncul di spec; kalau spec "mengejutkan", grilling
      kurang dalam, bukan spec-nya kepanjangan.
- [ ] Sebelum `implement`: ticket memuat irisan blueprint, seam, larangan, dan blocker yang benar.
- [ ] Sesudah `implement`: `code-review` dua axis terhadap working tree, `Deviation log`, lalu tutup ticket manual.
- [ ] Setelah rilis: keputusan yang tahan lama masuk `CONTEXT.md`/ADR/`docs/`, bukan diedit balik ke spec.

## 9. Batasan riset

- Sumber adalah dokumentasi dan `SKILL.md` upstream, bukan observasi sesi pribadi Matt Pocock. Dokumen upstream sendiri
  mencatat beberapa bug yang belum diperbaiki (spec fetch truncation, `code-review` pada diff kosong, `grill-with-docs`
  tidak menulis file saat dijalankan di dalam orchestrator lain).
- Salinan vendored di repo di-pin pada satu commit; halaman `docs/engineering/*.md` di `main` sudah memakai penamaan
  v1.1 (`wayfinder`, `to-spec`, `to-tickets`) dan memuat `implement-spec` yang **tidak** di-vendor di sini. Selisih ini
  bisa berubah tanpa notifikasi.
- Tidak ada test aplikasi yang dijalankan; tidak ada kode aplikasi yang diubah.

## Referensi

- [`mattpocock/skills` README](https://github.com/mattpocock/skills/blob/main/README.md) — alasan skill ada, empat failure mode.
- [`docs/engineering/to-spec.md`](https://github.com/mattpocock/skills/blob/main/docs/engineering/to-spec.md) — spec sebagai decision record, seams before prose, FAQ `ready-for-agent`.
- [`docs/engineering/to-tickets.md`](https://github.com/mattpocock/skills/blob/main/docs/engineering/to-tickets.md) — tracer bullet, blocking edges, expand–contract, FAQ acceptance criteria.
- [`docs/engineering/implement.md`](https://github.com/mattpocock/skills/blob/main/docs/engineering/implement.md) — "never reopens the plan", weakest point pada seam, ticket tidak ditutup.
- [`docs/engineering/implement-spec.md`](https://github.com/mattpocock/skills/blob/main/docs/engineering/implement-spec.md) — paralel per worktree, biaya review.
- [`docs/engineering/wayfinder.md`](https://github.com/mattpocock/skills/blob/main/docs/engineering/wayfinder.md) — destination/fog/frontier, "plan, don't do", waterfall trap.
- [`docs/engineering/grill-with-docs.md`](https://github.com/mattpocock/skills/blob/main/docs/engineering/grill-with-docs.md) — paper trail `GLOSSARY.md`/ADR, "sisanya hanya di context window".
- [`docs/engineering/ask-matt.md`](https://github.com/mattpocock/skills/blob/main/docs/engineering/ask-matt.md) — flow, phase boundary, urutan `continue`/`clear`/`handoff`/`subagent`/`compact`.
