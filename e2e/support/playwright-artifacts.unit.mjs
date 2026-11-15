import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

function loadConfig(file, ci, t) {
  const logs = mkdtempSync(join(tmpdir(), "playwright-config-test-"));
  t.after(() => rmSync(logs, { recursive: true, force: true }));
  const code = `
    const module = await import(${JSON.stringify(join(root, file))});
    const config = module.default.default ?? module.default;
    console.log(JSON.stringify({ outputDir: config.outputDir, reporter: config.reporter }));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: ci ? "1" : "", E2E_LOGGING_DIR: logs },
  }));
}

for (const ci of [false, true]) {
  test(`standard config memusatkan report dan artifacts (CI=${ci})`, (t) => {
    const config = loadConfig("playwright.config.ts", ci, t);
    assert.equal(config.outputDir, "playwright/results/default");
    assert.equal(config.reporter.find(([name]) => name === "html")[1].outputFolder, "playwright/reports/default");
  });
}

test("mock config mempunyai report dan results terpisah dari standard run", (t) => {
  const config = loadConfig("playwright.mock.config.ts", false, t);
  assert.equal(config.outputDir, "playwright/results/mock");
  assert.equal(config.reporter.find(([name]) => name === "html")[1].outputFolder, "playwright/reports/mock");
});

test("Git mengabaikan seluruh output Playwright terpusat, bukan config/spec", () => {
  const paths = [
    "playwright/reports/default/index.html",
    "playwright/reports/mock/index.html",
    "playwright/results/default/error-context.md",
    "playwright/results/mock/trace.zip",
    "playwright/mcp/snapshot.md",
    "playwright/blob/report.zip",
    "playwright.config.ts",
    "e2e/support/playwright-artifacts.unit.mjs",
  ];
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root, input: paths.join("\n"), encoding: "utf8",
  }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, paths.slice(0, 6));
});

test("MCP auto-output dan command pembuka report memakai folder terpusat", () => {
  for (const file of [".pi/mcp.json", ".mcp.json"]) {
    const args = readJson(file).mcpServers.playwright.args;
    assert.equal(args[args.indexOf("--output-dir") + 1], "playwright/mcp", file);
  }
  const scripts = readJson("package.json").scripts;
  assert.equal(scripts["test:e2e:report"], "playwright show-report playwright/reports/default");
  assert.equal(scripts["test:e2e:report:mock"], "playwright show-report playwright/reports/mock");
});
