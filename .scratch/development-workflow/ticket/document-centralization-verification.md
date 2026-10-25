# Verifikasi sentralisasi artefak dokumentasi

## Scope dan keputusan pemilik

- Semua artefak workflow existing, termasuk legacy, dipusatkan di `.scratch/<feature>/`.
- `index.md` hanya per fitur, tidak ada global status index karena pekerjaan paralel lintas branch.
- Plan Done tetap disimpan; enduring content tetap dirangkum ke `docs/`.
- Keputusan layout dan retensi dikonfirmasi melalui `ask_user_question`; migrasi fitur lama
  diminta eksplisit melalui jawaban: "iya tolong lakukan juga untuk fitur lama."
- Tidak mengubah behavior aplikasi, approval produk, status implementasi, atau izin agent loop.

## Blueprint teknis ringkas

- `AGENTS.md`, `.agents/skills/development-workflow/SKILL.md`, `.scratch/README.md`:
  aturan lokasi output dan lifecycle; skill definitions tetap pada tempatnya.
- `.scratch/<feature>/index.md`: navigasi dan status plan; 11 baris index lama
  dibagi sesuai pemilik fitur, tanpa menaikkan atau menurunkan status.
- `docs/agents/issue-tracker.md`, `docs/README.md`,
  `docs/architecture/matt-skills-integration.md`: tracker dan batas enduring docs.
- `scripts/ticket-next.mjs`, `scripts/ticket-loop.sh`: hanya path default diubah
  ke `.scratch/discounts/ticket/`; exported contracts dan alur eksekusi tidak berubah.
- `scripts/workflow-paths.test.mjs`: seam CLI resolver dan conductor dry-run memakai
  temporary fixture repo. Tidak menjalankan agent, provider, commit, atau deployment.
- UX blueprint: N/A — tidak ada perubahan UI; visual review/typecheck aplikasi tidak relevan.

Context7 checkpoint: `/vitest-dev/vitest` — dikonfirmasi import `test` dan
`TestContext.onTestFinished` untuk cleanup fixture. Query sumber resmi:
<https://github.com/vitest-dev/vitest/blob/main/docs/api/hooks.md>.
Migrasi Markdown dan perubahan path internal tidak memakai API library eksternal.

## Hasil migrasi

- 131 file dipindahkan; semua destination tersedia dan tidak ada source duplikat tersisa.
- Folder `plan/`, folder `*-implementation` existing, dan plan legacy `.agents/`
  tidak dipertahankan sebagai tempat output baru.
- 15 folder fitur mempunyai `index.md`; `.scratch/templates/` adalah template shared,
  bukan fitur atau register status global.
- Research historis di `docs/` dipindah ke fitur terkait; dokumentasi fitur,
  referensi arsitektur permanen, ADR, dan vendored skills tidak dipindah.
- Relative links dan referensi path disesuaikan. Beberapa link lama yang salah
  sudah diarahkan ke file yang tersedia; referensi legacy yang file-nya sudah
  hilang ditampilkan sebagai catatan, bukan tautan seolah file masih ada.
- Plan yang sudah dihapus sebelum migrasi tidak direkonstruksi; outcome lama
  tetap pada index fitur. Map implementasi home delivery yang tidak tersedia
  sebelum migrasi dicatat di index, bukan dibuat ulang.

## Verifikasi

| Pemeriksaan | Hasil |
|---|---|
| Audit destination/source 131 file | PASS — seluruh destination ada; source lama tidak tersisa |
| Audit relative Markdown links | 0 broken link baru; 7 temuan baseline di luar artefak yang dipindah (termasuk URL-encoded paths yang tidak didekode checker) |
| `git diff --check` | PASS |
| `bash -n scripts/ticket-loop.sh` | PASS |
| `node scripts/ticket-next.mjs --quiet` | PASS — menunjuk `.scratch/discounts/ticket/13-integration-and-release-readiness.md` |
| RED CLI tests sebelum path diperbaiki | 2 gagal: ENOENT path resolver lama dan prompt conductor lama tidak ditemukan |
| GREEN CLI tests setelah path diperbaiki | 2 passed; conductor hanya dry-run |
| `npm run verify:unit:slice -- scripts/workflow-paths.test.mjs scripts/ticket-next.test.mjs scripts/ticket-watch.test.mjs` | 3 files, 22 passed |
| Focused recheck setelah environment fixture dibuat eksplisit: `npm run verify:unit:slice -- scripts/workflow-paths.test.mjs` | 1 file, 2 passed |
| `npm run verify:batch:unit` | 155 files passed, 2 files skipped, **7 suites failed saat collection**; 1.679 tests passed / 14 skipped |

Batch failure berasal dari safety guard disposable DB: konfigurasi saat run menunjuk
`storefront`, sedangkan suite mensyaratkan nama `marketplace_discounts_test_*`.
Contoh guard: `packages/db/src/discount-schema.db.test.ts:48–66` dan
`apps/store/src/lib/checkout-admission.db.test.ts:12–14`. File guard/test tersebut
tidak diubah pada migrasi ini. Tidak ada retry dengan production DB atau bypass guard.
Untuk full gate hijau, jalankan ulang batch dengan disposable test DB yang disiapkan
sesuai prosedur testing repo; tidak dilakukan sebagai bagian migrasi dokumentasi ini.

Log run lokal berada di `/tmp/workflow-paths-red.log`,
`/tmp/workflow-paths-green.log`, `/tmp/workflow-slice.log`,
`/tmp/workflow-final-slice.log`, dan `/tmp/document-centralization-unit.log`.
Log tersebut temporer dan tidak menggantikan ringkasan bukti di sini.

Tidak ada browser/E2E, build aplikasi, agent loop live, commit, push, SSH, atau deploy.
Perubahan UI existing di worktree berada di luar scope dan tidak disentuh.
