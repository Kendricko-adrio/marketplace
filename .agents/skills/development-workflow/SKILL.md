---
name: development-workflow
description: Use for behavior-affecting changes in the marketplace repo to align scope before planning, gate plan/ticket approval, implement approved work, and delegate bounded subagent tasks only when authorized.
---

# Marketplace development workflow

Read [`AGENTS.md`](../../../AGENTS.md) for always-on constraints, [`.scratch/README.md`](../../../.scratch/README.md) for the plan lifecycle, and the relevant app's `AGENTS.md` before changing app code. This skill provides the detailed procedure, not authority to bypass those files. A user's concrete, already-agreed request is not an excuse to create an unnecessary plan; an ambiguous request is not permission to invent its answer.

## 1. Establish facts and select a route

- Read relevant code, tests, and docs; distinguish verified facts from assumptions. Research external facts only when they block a decision, using primary sources and a short cited note where useful. Do not repeat settled research without identifying a missing or stale fact. Library work still follows the repo's current-documentation rule.
- Bugs and regressions: load `systematic-debugging`; reproduce the user's symptom before deciding on a fix. UI/auth/test work must also load the matching project skills.
- Small, well-defined change that fits one session: align on the observable behavior in conversation; skip a multi-feature plan file and tickets. The user's clear request can establish scope; do not demand a ceremonial approval for every trivial edit.
- Perubahan multi-feature: simpan artefak di `.scratch/<feature>/` dan status plan di `index.md` milik fitur tersebut. Gunakan satu slug stabil lintas sesi, research, wayfinding, dan implementasi; jangan membuat folder `<feature>-implementation` atau global status index. Effort besar lintas sesi boleh memakai `wayfinder` untuk menyelesaikan **decision tickets** sebelum implementation plan; pekerjaan satu sesi tidak memerlukan decision map.
- Do not assume an upstream skill, issue tracker, remote operation, or subagent permission exists merely because a workflow example mentions it. Use installed skills where appropriate; follow this project's gates even if an upstream skill would publish or commit automatically. See [`docs/architecture/matt-skills-integration.md`](../../../docs/architecture/matt-skills-integration.md) for the imported-skill prerequisites and Pi compatibility notes.

### Imported skills in Pi

When an upstream Matt Pocock skill says "Call the Skill tool", Pi may not expose such a tool. Load the named skill's `SKILL.md` with `read` or invoke `/skill:<name>` explicitly instead; do not merely mention its name and assume it ran. The `grilling` skill's question rounds still use this project's `ask_user_question` rule. Do not let `grill-with-docs` or `wayfinder` silently launch a child, publish to a tracker, or make a product decision.

Tracker Local Markdown sudah dikonfigurasi di [`docs/agents/issue-tracker.md`](../../../docs/agents/issue-tracker.md). Output `research` masuk `.scratch/<feature>/research/`; output `to-spec` dan plan/proposal masuk `plan/` di dalam fitur; map dan decision tickets `wayfinder` masuk `wayfinder/`; output `to-tickets`, implementation map, handoff, dan verification masuk `ticket/`. Prototype opsional masuk `prototype/`. Gunakan [`panduan artefak`](../../../.scratch/README.md) dan [`template plan`](../../../.scratch/templates/plan.md). Penempatan ini mengesampingkan contoh path upstream, tanpa mengubah vendored skills. `index.md` fitur menavigasi artefak dan mencatat status plan, bukan tracker status ticket kedua. Publikasi breakdown tetap perlu approval user; mengganti tracker atau publikasi remote perlu izin tersendiri. `implement` asks for a commit, `prototype` asks for a throwaway-branch commit, and `research`/`code-review`/`wayfinder` ask for subagents: these upstream instructions are conditional on this project's separate user-authorization gates. For uncommitted work, review the working-tree and staged diff too, not only a `git diff <ref>...HEAD` comparison. Do not modify vendored upstream files to resolve these differences; keep project-specific policy here.

### Transisi dari research ke alignment

Setiap penutup research harus membedakan temuan terverifikasi dari asumsi, lalu mengelompokkan open items berikut. Jika suatu kategori kosong, nyatakan tidak ada; jangan menciptakan pertanyaan atau tahap tambahan.

| Kategori | Tindak lanjut |
|---|---|
| Fakta belum diketahui | Agent mencari fakta code/API dari sumber yang relevan, bukan meminta user menebaknya. Jika akses terhalang, jelaskan blocker dan kebutuhan akses. |
| Keputusan user diperlukan | Jelaskan konteks, opsi, trade-off, dan rekomendasi bila didukung evidence; keputusan tetap milik user. |
| Di luar scope | Catat sebagai non-goal, bukan backlog yang otomatis ikut dikerjakan. |

Rekomendasikan satu jalur berikut beserta alasan berdasarkan bentuk ketidakjelasannya, bukan otomatis menjalankan skill atau tahap baru:

- **Klarifikasi langsung:** keputusan sedikit dan sederhana; gunakan `ask_user_question` untuk keputusan yang perlu dijawab user.
- **`grill-with-docs`:** perlu interview mendalam untuk mempertajam desain sekaligus mencatat istilah domain dan keputusan.
- **`wayfinder`:** keputusan banyak, saling bergantung, dan perlu dikelola lintas sesi sebagai decision tickets, bukan implementation tickets. Pekerjaan satu sesi tidak memerlukan decision map.
- **Alignment menuju plan/spec:** keputusan penting sudah cukup jelas; rangkum pemahaman untuk dikonfirmasi sesuai bagian 2 sebelum menulis draft nontrivial.

Jika user hanya meminta research, tutup dengan temuan, open items, dan rekomendasi; tunggu arahan sebelum melanjutkan. Jika user sudah meminta tahap lanjutan secara eksplisit, ikuti scope tersebut tanpa approval seremonial tambahan, dengan tetap memenuhi gate alignment, approval spec, delegasi, dan publikasi yang berlaku.

Saat berpindah ke klarifikasi atau sesi berikutnya, bawa referensi research existing, keputusan yang sudah disepakati beserta sumbernya, pertanyaan terbuka dan dependencies, serta batas scope. Jangan mengulang research atau membuka kembali keputusan tanpa menunjukkan fakta yang hilang, stale, atau berubah. Saat menjalankan wrapper interview, baca skill yang dirujuk dan ikuti aturan round/frontier serta `ask_user_question`; user tetap menjawab keputusannya sendiri.

Tutup interview dengan rangkuman keputusan, non-goals, acceptance criteria yang sudah diketahui, dan ketidakpastian tersisa. Minta konfirmasi bahwa rangkuman sesuai untuk menjadi dasar draft spec nontrivial. **Konfirmasi hasil interview bukan approval spec atau izin implementasi**; approval tetap diberikan atas draft lengkap sesuai bagian 2.

Saat menjelaskan workflow kepada user, bedakan **wajib** (sertakan aturan sumber), **rekomendasi** (pertimbangan agent beserta alasan), dan **opsional** (sesuai kebutuhan atau permintaan). Jangan menyebut rekomendasi agent sebagai kewajiban dari skill.

Contoh: research affiliate menemukan aturan atribusi referral, komisi, dan payout belum diputuskan. Ini keputusan user, bukan fakta yang bisa ditentukan dengan membaca code. Agent merekomendasikan `grill-with-docs` untuk menyepakati model bisnis; jika keputusan ternyata membutuhkan banyak sesi dengan dependencies, rekomendasikan `wayfinder`. Jangan langsung membuat schema, plan implementasi, atau tickets.

## 2. Align before an actionable nontrivial plan/spec

- Ask only questions about decisions the user owns; look up filesystem/code/API facts yourself. Ask dependency-aware rounds where one answer affects later choices. Offer a recommendation with trade-offs, but let the user decide. If a prototype is necessary, use it to make alternatives concrete, not to select the winner on the user's behalf.
- Read back the goal, confirmed decisions, non-goals, observable acceptance/verification criteria, and remaining uncertainty. Ask for explicit confirmation of the shared understanding before writing an actionable nontrivial plan/spec. Keep unresolved choices visible as questions, not assumed implementation decisions.
- **Wajib menggunakan `to-spec` saat membuat spesifikasi.** Sebelum menulis draft spec, baca [`.agents/skills/to-spec/SKILL.md`](../to-spec/SKILL.md) secara penuh dan gunakan proses serta template-nya untuk menyintesis percakapan, research, dan keputusan yang telah disepakati, termasuk hasil `grill-with-docs` atau `wayfinder`. Penyebutan skill saja tidak memenuhi kewajiban ini; aturan juga berlaku bagi subagent penulis spec yang diizinkan. Jangan mengulang interview atau mengubah keputusan yang sudah disepakati; konfirmasikan test seams sesuai skill, dan jika ada keputusan baru yang menghalangi spec, kembalikan ke alignment. Lengkapi template dengan acceptance criteria serta technical/UX blueprint repo dalam file yang sama, termasuk full paths meskipun template upstream melarangnya. Gunakan bahasa Indonesia dan lokasi artefak repo. Instruksi publikasi otomatis atau label `ready-for-agent` dari `to-spec` tidak boleh melewati approval draft lengkap di bawah. Kewajiban ini tidak memaksa pekerjaan kecil yang scope-nya sudah disepakati untuk membuat spec formal.
- Draft the plan/spec from that understanding, including tests at public seams and deployment implications when applicable. Show the **complete** draft or a reviewable link plus an accurate decision/edge-case summary. Obtain explicit user approval of the complete scope and acceptance criteria before marking a plan `Ready`, publishing an agent-ready spec, queueing a task for an autonomous loop, or starting implementation. Editing an approved contract requires renewed approval if it changes behavior, scope, or acceptance criteria.
- `Draft` is not authorization. Record the approval and its scope in the plan's approval section and transition the index only after the gate passes. Existing `In Progress` plans are not retroactively returned to `Draft`; new decisions or scope changes still require confirmation.
- Carry a **technical blueprint** and a **UX blueprint** inside the same spec/plan file whenever the work touches code. They are an advisory checklist, not an extra gate: fill what applies, record every empty part as an open item, and never claim the design is complete while a path, state, or label is still undecided. For a small single-session change, 4–6 lines (files touched + relevant UI states) are enough.

### Keputusan UI sebelum implementasi

- Saat alignment, termasuk `grill-with-docs` atau decision tickets `wayfinder` bila digunakan, konfirmasikan keputusan milik user: alur, informasi prioritas, aksi yang tersedia, permission, dan konsekuensi tindakan. Contoh: create affiliate melalui dialog atau halaman tersendiri, lalu kembali ke daftar atau membuka detail. Jangan memulai sesi wrapper tambahan jika keputusan ini sudah disepakati.
- Agent wajib memeriksa pola existing sampai perilaku datanya dan merekomendasikan referensi yang layak. Warna, typography, spacing, helper text, serta kontrol yang sudah distandarkan mengikuti komponen/tokens existing; jangan meminta approval per detail visual atau menciptakan gaya baru per halaman.
- Jika standar existing saling berbeda, tidak memadai, atau perlu disimpangi, jelaskan hasil audit, alternatif, rekomendasi, dan dampaknya; minta keputusan user sebelum mengimplementasikan bagian terkait. Jangan memilih halaman buruk sebagai standar hanya karena tersedia. Gunakan mockup/prototype bila membantu keputusan, bukan sebagai tahap wajib setiap fitur.
- Catat hasilnya dalam blueprint spec yang direview dan disetujui; untuk perubahan kecil cukup scope percakapan yang disepakati. Approval mencakup kontrak UI, bukan hanya nama halaman. Keputusan baru atau perubahan kontrak saat implementasi kembali ke user, bukan diputuskan diam-diam.

### Technical blueprint

- File table: full `path`, create/modify, a 1–3 line responsibility, the layer from [`docs/architecture/code-organization.md`](../../../docs/architecture/code-organization.md) (`route.ts` / `-service.ts` / `-repository.ts` / `-client.ts` / UI component / `packages/db/src/schema/`), and the test seam. Full paths, never bare filenames — bare names are what make an implementer write the same module twice in two places.
- Exported contract for each new or contract-changing file: function/type names and parameters, **without bodies**. This is the seam neighbouring slices code against, not an implementation manual.
- Non-obvious structure decisions (new module, new folder, splitting a file, shared vs app-local) with the reason and the rejected alternative.
- `discovery:` marker with a concrete question wherever a file is genuinely unknown. An unknown is a discovery task; guessing it mid-implementation is not.

### UX blueprint

Required when the change affects UI; otherwise write `N/A — <reason>`.

- The agreed **reference page/pattern** compared for cross-page consistency, and the hierarchy with its single dominant primary action.
- **Component reuse map**: existing shared component (with path) versus new, and which variant applies.
- **State matrix** per screen with final labels/copy: idle, loading, empty, error, success, disabled/permission-restricted, unsaved. A state that is not in the table will not be implemented.
- Target viewport, responsive behaviour, and the keyboard/focus/contrast points to verify.
- When the owner asks for a prototype, record it as the **binding** reference for screen structure, flow, action naming, and states — while existing tokens and shared components remain the source of truth for visuals. Never copy prototype CSS or introduce ad-hoc values, fonts, or palettes.

### Kontrak list/table lintas UX dan backend

Untuk layar list/table, catat satu kontrak yang menghubungkan UX blueprint dengan exported contracts/test seams pada technical blueprint; jangan menduplikasi aturan yang bisa berbeda di dua tempat:

- Referensi halaman/pattern beserta full paths komponen dan alur query/backend yang digunakan, termasuk reuse toolbar, pagination, row actions, badges, dan feedback.
- Sumber data, cakupan search (seluruh dataset yang boleh diakses atau subset yang dinyatakan), server/client-side search dan pagination, ukuran halaman/default, sorting stabil, filter, total/indikator navigasi, serta perilaku reset halaman saat search/filter berubah.
- URL state dan perilaku navigasi mengikuti standar yang disepakati; nyatakan parameter yang disimpan atau alasan tidak memakai URL state. Jangan mengarang mekanisme baru per halaman.
- Loading, belum ada data, tidak ada hasil pencarian, error, dan permission states, dengan final copy mengikuti UX blueprint.
- Acceptance criteria yang membuktikan perilaku lintas halaman data, bukan hanya keberadaan input/kontrol. Contoh: hasil yang semula di luar halaman pertama tetap ditemukan oleh search backend, dan pencarian mengembalikan pagination ke halaman pertama.

Jangan menghilangkan pagination atau mengganti search backend menjadi filter browser atas current page demi kemudahan implementasi. Client-side boleh untuk dataset kecil yang memang dimuat lengkap jika sesuai kontrak yang disepakati; bukan default diam-diam. Tandai aspek yang tidak berlaku sebagai N/A beserta alasan. Ikuti gate audit dan verifikasi di `ux-design`.

### Blueprint checklist (advisory)

- [ ] File table: path, action, responsibility, layer, test seam
- [ ] Exported contract (names + parameters) for new or contract-changing files
- [ ] Non-obvious structure decisions with rejected alternatives
- [ ] `discovery:` markers where paths are genuinely unknown
- [ ] (UI) Agreed reference page/pattern + component reuse map
- [ ] (UI) State matrix + final labels/copy per screen
- [ ] (UI) Target viewport, responsive, keyboard/focus, contrast
- [ ] (UI) Requested prototype recorded as the binding reference
- [ ] (List/table) Kontrak search/pagination/sorting/filter/URL state dan acceptance lintas halaman data

### Slice blueprint (per implementation ticket)

The plan/spec blueprint is the source; the **ticket carries the slice it needs**, because an
implementation session often reads the ticket and nothing else. Required when the ticket
changes code, otherwise `N/A — <reason>`. Source template:
[`.scratch/templates/ticket.md`](../../../.scratch/templates/ticket.md).

- Slice file table (path, action, responsibility, layer, test seam) plus the exported-contract
  delta, copied from the approved blueprint rather than designed again in the ticket.
- One public seam, the first RED test path, and prior art.
- Decision boundaries that must not be reopened, each linked to its authority (wayfinder
  decision, owner correction, spec section).
- Every acceptance criterion names the observation that proves it false at the implementer's
  starting commit.
- A one-line demo path. No demo path means the slice is horizontal and must be recut.

This deliberately deviates from the upstream `to-spec`/`to-tickets` templates, which forbid file
paths. Their rule prevents long-term staleness; a ticket is consumed within days, and without
paths the implementer invents modules and names that contradict the repo's layer conventions.
Record the deviation as a repo decision, not as a reading of upstream.

## 3. Slice only when useful

- If the build spans sessions or the user requests a multi-ticket breakdown, propose tracer-bullet tickets: each delivers a narrow, independently testable end-to-end behavior (rather than a whole database/API/UI layer), with acceptance criteria and real blockers. Show the numbered breakdown and dependencies to the user; get separate approval before publishing/queueing tickets. Small work goes straight from approved conversational scope or spec to implementation.
- Tickets convey *what* must work and inherit the approved technical/UX blueprint; they are not an invitation to redesign product behavior. A ticket may refine a file name or placement only while the approved layer convention and exported contracts stay intact, and the deviation is written to the plan's deviation log and reported to the owner. A new module, a new behavior, or a state/label outside the approved blueprint still needs an owner decision. Every ticket also carries its own **slice blueprint** (section 2) and records a `Deviation log` in its `## Answer`; a planned file or contract that changed without an entry there is a review finding. Carry the approved spec, blueprint, testing seams, exclusions, and source-of-truth research in the handoff. **A session may cover one or several approved tickets according to the user's requested scope.** Even in a multi-ticket session, implement, test, review, and record the outcome of each verifiable slice before moving to the next; respect dependencies and do not mark blocked or unverified tickets Done. A new product decision still requires owner approval, not an agent-selected default. No second product plan is required.

## 4. Implement, review, and close

- Start from the approved behavior; make a short technical work sequence, then use `tdd` at agreed public seams. Update feature/API/deployment docs where applicable.
- **Development: hanya focused unit tests.** Jalankan `npm run verify:unit:slice -- <explicit test paths>` untuk public seams slice yang sedang dikerjakan: RED sebelum GREEN, bukan seluruh workspace. Typecheck app yang terdampak tetap mengikuti L0 di `AGENTS.md`. Refactoring dilakukan saat review sesuai skill `tdd`, lalu periksa kembali unit tests yang terdampak. Jangan menjalankan full unit, integration, atau E2E suites selama development secara default; eksekusi lebih awal membutuhkan permintaan eksplisit user. Tulis coverage E2E bersama fitur, tetapi tunda eksekusinya ke final gate.
- **Final gate di akhir scope yang disepakati.** Setelah deliverable yang diminta user terintegrasi, jalankan full unit suite dan E2E yang diwajibkan `AGENTS.md`, termasuk mock specs terkait dengan explicit paths. Akhir bukan setiap slice, ticket, batch internal, atau laporan progres: jika user meminta beberapa ticket sekaligus, lakukan final gate setelah semuanya terintegrasi. Izin terpisah legacy E2E tetap berlaku. Sebelum commit/PR atau klaim selesai, final gate harus memiliki evidence yang valid untuk perubahan terkini. Progress parsial boleh dilaporkan tanpa memicu broad suite; final verification dan AC yang belum terbukti tetap `Pending`, ticket belum `resolved` sampai evidence final tersedia. Browser/integration behavior tidak dianggap terverifikasi hanya karena unit tests lolos; rendered UX review tetap wajib sebelum penerimaan frontend.
- **Hindari pengulangan tanpa alasan.** Ulangi focused tests hanya setelah code/test/dependency/kondisi relevan berubah atau untuk investigasi failure tertentu. Simpan evidence PASS untuk code yang tidak berubah. Jika final suite gagal, diagnosis dan perbaiki dengan focused tests dahulu, lalu ulangi final gate yang terdampak; jangan mengulang semua suite pada setiap percobaan fix. Perubahan yang membuat evidence lama tidak valid harus diverifikasi ulang pada gate yang terdampak.
- If implementation reveals a new product, policy, or architecture choice outside the approved scope, stop the affected work, explain the options, and request a user decision. Do not let a worker, reviewer, or loop silently expand the spec.
- Review the changed diff against **both** repo standards and the approved spec/acceptance criteria, plus the approved blueprints: a file outside the file table, a state/label missing from the state matrix, or an invented component is a review finding even when the tests pass. Verify findings against current files and test results. Check the exact changed files, including any pre-existing user changes; never claim the full suite passed if it did not run.
- **Audit AC sebelum melapor.** Ubah tabel acceptance criteria pada spec/tiket menjadi checklist kerja sejak slice pertama, bukan saat menutup plan. Sebelum setiap laporan progres, perbarui tabel `AC → evidence` dan sebut status tiap baris `Verified`/`Pending`. Laporan progres tidak boleh memakai kata selesai, "sudah diimplementasikan", atau daftar PASS tanpa menyebut baris `Pending`. Contoh: bila hanya repository/service yang selesai sementara daftar dan dialog create belum diubah, kalimat pertama laporan berbunyi "belum ada perubahan yang terlihat di halaman Diskon; AC02, AC03, AC04 `Pending`", bukan daftar jumlah test.
- **Slice berakhir di jalur user, bukan di layer.** Untuk spec yang mengubah perilaku terlihat, potong vertical (daftar → create → editor) supaya setiap slice bisa dipakai dan dinilai. Fondasi backend boleh lebih dulu hanya bila diakui sebagai pekerjaan yang belum terlihat oleh user, dan tidak dihitung sebagai kemajuan terhadap AC mana pun. Urutan layer ("semua schema, semua service, lalu semua UI") dilarang sebagai bentuk delivery.
- **Jangan menyentuh DB development user di dalam slice fondasi.** Tambah kolom tanpa `db:push` membuat halaman yang tidak berubah menjadi 500; menambahkannya tanpa izin menghapus state kerja user. Minta izin eksplisit, sebutkan apa yang rusak sampai schema diterapkan, dan jangan menyelundupkannya ke checkpoint yang tidak dilaporkan. Bila DB user perlu direset atau di-seed ulang, nyatakan data apa yang hilang sebelum eksekusi.
- **Baca bagian penutupan spec apa adanya.** Bila spec punya checklist penutupan (`## Penutupan`), salin item yang belum selesai ke limitations laporan dan jangan menandainya selesai tanpa evidence. Review akhir membandingkan diff dengan teks spec baris per baris (heading, label, kolom, larangan seperti "tidak ada tombol Simpan kapasitas"), bukan hanya dengan hasil test.
- Main agent bertanggung jawab atas konsistensi `.scratch/<feature>/index.md`, ekstraksi enduring docs, dan penutupan plan saat `Done` (langsung atau memvalidasi handoff yang diizinkan). Simpan file plan beserta research/decision/ticket/evidence; jangan hapus plan saat Done. Index mencatat tanggal, hasil, dan bukti verifikasi tanpa menduplikasi status ticket. Plan legacy juga mengikuti layout ini; status lama tidak dinaikkan atau di-reset hanya karena migrasi. Commits require user authorization; push, remote work, and deployment each require the explicit permission specified in `AGENTS.md`.

## 5. Delegation when explicitly authorized for this task/session

The main agent decides whether a bounded subagent earns its cost; authorization is opt-in, not an order to delegate every stage. Do not treat plan approval as subagent permission. Keep owner decisions, routing, integration, and final verification in the main agent.

| Stage | Good bounded handoff | Avoid |
|---|---|---|
| Fact finding | One read-only scout for a named code area, or one researcher for a specific external question; parallel only for distinct evidence | Several children each rediscovering the whole repo |
| Alignment/wayfinding | A focused research question or disposable prototype, if it unblocks a human decision | Child deciding scope or conducting the owner's interview |
| Spec/tickets | Optional read-only contradiction check on a high-risk draft | Multiple agents inventing competing actionable plans or dependencies |
| Implementation | One worker on one approved slice with exclusive ownership; parallel only for genuinely independent contracts in isolated worktrees | Overlapping writers in one checkout or a worker redesigning the feature |
| Review | One fresh read-only reviewer for a meaningful risk; two distinct angles only if justified | Endless review/polish cycles or duplicate broad reviews |

Every child gets a compact cold-start packet: objective; repo/cwd/ref; approved spec/ticket and **existing research**; exact code seam or file ownership; allowed actions (read/edit/commit/push/remote); acceptance criteria; focused validation; output/report format; and stop/escalation rules. The packet must stand alone without making the child repeat broad discovery. Require matching project skills inside the child. Do not allow nested subagents unless separately authorized.

Use one writer per checkout/worktree. If independently testable contracts warrant parallel writers, give each an exclusive boundary and isolated worktree, require durable handoffs, then let the main agent integrate and run final validation. Existing dirty changes must not be overwritten or swept into a child commit. Delegate plan-status bookkeeping only within the authorized boundary and verify it personally.

Prefer a single targeted review followed by fixing substantiated findings and **one focused recheck** of the affected area. If the same issue persists or a new owner decision is needed, stop and report the blocker instead of spawning another automatic worker/reviewer round. A child report or clean review is evidence, never acceptance authority. Do not use a tight hard tool-call budget that could interrupt a mutation mid-tool; scope the task, request a checkpoint, and escalate when blocked.
