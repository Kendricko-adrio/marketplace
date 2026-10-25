# Sentralisasi output Playwright

## Scope dan blueprint

Permintaan pemilik: satukan report/test-results/dump Playwright pada folder
`playwright/` dan ignore output sementara tersebut dari Git.

- `playwright.config.ts`: standard HTML `playwright/reports/default`, artifacts
  `playwright/results/default`; `playwright.mock.config.ts`: pasangan `mock`.
- `.pi/mcp.json` dan `.mcp.json`: `--output-dir playwright/mcp` untuk auto-named dumps.
- `.gitignore`: ignore seluruh `/playwright/`; pattern legacy tetap sebagai safeguard.
- `package.json`: command pembuka report standard/mock dan regression test config.
- `e2e/support/playwright-artifacts.unit.mjs`: public config import, Git ignore behavior,
  command report dan MCP args. Tidak membuat server/browser atau mengakses DB/provider.
- `AGENTS.md`, `docs/testing/README.md`, `docs/agents/mcp-tooling.md`: aturan output
  termasuk filename eksplisit yang relatif terhadap workspace root.
- UX: N/A — tidak ada perubahan UI. Pemisahan mode bukan izin menjalankan suite paralel
  dengan DB/fixture yang sama. Perubahan testMatch homepage existing dipertahankan.

## Migrasi existing

- `playwright-report/` → `playwright/reports/default/`.
- `playwright-report-mock/` → `playwright/reports/mock/`.
- `test-results/` → `playwright/results/legacy/`, karena asal standard/mock tidak pasti.
- HTML mock sebelumnya tracked; path lama dihapus dari worktree dan konten dipindah
  ke destination ignored. Tidak ada commit/staging otomatis.
- Auth fixture `e2e/.auth/` dan logging stdout di system temp mempertahankan kontrak existing.

## Context7 checkpoint

- `/microsoft/playwright`: `outputDir`, HTML `outputFolder`, dan positional path `show-report`.
- `/microsoft/playwright-mcp`: `--output-dir` hanya untuk auto-named files;
  filename eksplisit relatif terhadap workspace root.
- `/privatenumber/tsx`: `node --import tsx` untuk membaca config TypeScript pada test
  subprocess; hanya import config, bukan menjalankan Playwright suite.

Sumber: [Playwright config](https://playwright.dev/docs/api/class-testconfig),
[reporters](https://playwright.dev/docs/test-reporters),
[MCP configuration](https://github.com/microsoft/playwright-mcp#configuration),
[tsx Node CLI](https://github.com/privatenumber/tsx/blob/master/docs/dev-api/node-cli.md).

## Bukti verifikasi

- RED: 5 regression tests gagal pada path/report/ignore/MCP lama.
- GREEN: `npm run test:playwright-artifacts` — **5 passed, 0 failed**.
- Coverage ditambah untuk MCP config client kedua: RED lalu focused recheck
  `node --test --test-name-pattern='MCP auto-output' e2e/support/playwright-artifacts.unit.mjs`
  — **1 passed, 0 failed**. Empat test lainnya tidak berubah.
- Standard discovery terfokus: `npx playwright test e2e/store/products.spec.ts --list --reporter=line`
  — **13 tests in 2 files**, tanpa menjalankan tests/webServer.
- Mock discovery terfokus: `npx playwright test --config=playwright.mock.config.ts e2e/store/pickup-mock.spec.ts --list --reporter=line`
  — **2 tests in 1 file**, tanpa menjalankan tests/webServer.
- Discovery seluruh standard suite dicoba, tetapi gagal pada guard mock/disposable-DB
  existing saat collection (misalnya `markdown-mock.spec.ts:30`). Tidak diubah atau
  di-bypass karena pemisahan spec/provider berada di luar scope path artifact.
- `git diff --check`: PASS. `git check-ignore --no-index` membuktikan report,
  results, MCP, dan blob paths ignored, sedangkan config/spec tidak ignored.
- Tidak menjalankan full unit/E2E, build, server aplikasi, provider writes, commit,
  remote, atau deploy. Perubahan ini hanya config output dan dokumentasi.

Config MCP yang sudah berjalan perlu reconnect/restart agar argumen baru digunakan.
Sampai itu terjadi, gunakan explicit filename `playwright/mcp/<run>/...` untuk dumps.
Output ignored bersifat disposable; ringkasan enduring tidak boleh hanya ada di sana.
