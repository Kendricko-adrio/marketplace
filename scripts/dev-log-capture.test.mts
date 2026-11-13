import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stopProcessTree } from "./dev-log-capture.mts";

const runner = resolve("scripts/dev-log-capture.mts");
const folders: string[] = [];
function project(source: string) {
  const cwd = mkdtempSync(join(tmpdir(), "dev capture "));
  folders.push(cwd);
  writeFileSync(join(cwd, "fixture.cjs"), source);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: {
    "dev:admin:app": "node fixture.cjs",
    "dev:store:app": "node fixture.cjs",
    "dev:jubelio-mock": "node fixture.cjs",
  } }));
  return cwd;
}
function run(cwd: string, app = "admin") {
  return spawnSync(process.execPath, [runner, app], { cwd, encoding: "utf8", timeout: 15000 });
}
afterEach(() => { for (const cwd of folders.splice(0)) rmSync(cwd, { recursive: true, force: true }); });

describe("runner capture development lintas platform", () => {
  it.each([
    ["dev:all", ["admin", "store", "jubelio-mock"]],
    ["dev:store", ["store", "jubelio-mock"]],
    ["dev:admin", ["admin"]],
  ] as const)("command npm %s berjalan tanpa utilitas Unix", (entry, apps) => {
    const actual = JSON.parse(readFileSync(resolve("package.json"), "utf8")).scripts;
    expect([actual[entry], actual[`pre${entry}`] ?? ""].join(" ")).not.toMatch(/\b(bash|mkdir|tee|sed)\b/);
    const cwd = project('console.log("siap");');
    const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    mkdirSync(join(cwd, "scripts"));
    writeFileSync(join(cwd, "scripts/dev-log-capture.mts"), readFileSync(runner));
    manifest.scripts[entry] = actual[entry];
    writeFileSync(join(cwd, "package.json"), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, [process.env.npm_execpath!, "run", "--silent", entry], { cwd, encoding: "utf8", timeout: 15000 });
    expect(result.status, result.stderr).toBe(0);
    for (const app of apps) expect(readFileSync(join(cwd, `logs/${app}.log`), "utf8").trim()).toBe("siap");
  }, 20000);
  it("menulis baris log saat proses masih berjalan dan dapat dihentikan", async () => {
    const cwd = project('console.log("berjalan"); setInterval(() => {}, 1000);');
    const child = spawn(process.execPath, [runner, "admin"], { cwd, detached: process.platform !== "win32", stdio: "ignore" });
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    try {
      await expect.poll(() => readFileSync(join(cwd, "logs/admin.log"), "utf8"), { timeout: 10000 }).toBe("berjalan\n");
      expect(child.exitCode).toBeNull();
    } finally {
      if (child.pid) await stopProcessTree(child.pid, "SIGTERM");
      const code = await closed;
      if (process.platform !== "win32") expect(code).toBe(143);
    }
  }, 20000);

  it("menghentikan proses anak beserta cucunya", async () => {
    const cwd = project('const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(child.pid); setInterval(() => {}, 1000);');
    const child = spawn(process.execPath, ["fixture.cjs"], { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "ignore"] });
    try {
      const pid = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.stdout!.once("data", (chunk) => resolve(Number(String(chunk).trim())));
      });
      await stopProcessTree(child.pid!, "SIGINT");
      await expect.poll(() => {
        try { process.kill(pid, 0); return true; } catch { return false; }
      }).toBe(false);
    } finally {
      if (child.pid) await stopProcessTree(child.pid, "SIGKILL");
    }
  }, 15000);

  it.each(["admin", "store", "jubelio-mock"])("menimpa log %s dan meneruskan exit code kegagalan", (app) => {
    const cwd = project('process.stdout.write("akhir"); process.exitCode = 7;');
    mkdirSync(join(cwd, "logs"));
    writeFileSync(join(cwd, `logs/${app}.log`), "log lama");
    const result = run(cwd, app);
    expect(result.status, result.stderr).toBe(7);
    expect(readFileSync(join(cwd, `logs/${app}.log`), "utf8")).toBe("akhir");
  });
  it("menghapus ANSI yang terpotong antar-chunk dan menyimpan baris terakhir", () => {
    const cwd = project('process.stdout.write("\\x1b["); setTimeout(() => { process.stdout.write("32mwarna\\x1b[0m\\nakhir"); }, 100);');
    const result = run(cwd);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(cwd, "logs/admin.log"), "utf8")).toBe("warna\nakhir");
  });
  it("membuat folder dan menyalin stdout/stderr tanpa ANSI atau banner npm", () => {
    const cwd = project('process.stdout.write("\\x1b[32mSiap café\\x1b[0m\\n"); process.stderr.write("gagal\\n");');
    const result = run(cwd);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("\x1b[32mSiap café\x1b[0m\n");
    expect(result.stderr).toContain("gagal\n");
    const log = readFileSync(join(cwd, "logs/admin.log"), "utf8");
    expect(log).toContain("Siap café\n");
    expect(log).toContain("gagal\n");
    expect(log).not.toMatch(/\x1b|> /);
  });
});
