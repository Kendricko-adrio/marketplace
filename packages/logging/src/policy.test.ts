import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// =========================================================
// Guard regresi statis untuk kebijakan logging (fitur 5)
// =========================================================
// Dua invarian yang tidak boleh kembali ke repo setelah migrasi logging:
//
//   1. Tidak ada file app (`apps/store/src`, `apps/admin/src`) yang memakai
//      engine logger lama — satu-satunya pengecualian adalah facade app itu
//      sendiri (`apps/<app>/src/lib/logger.ts`), yang menyebut nama-nama itu
//      hanya pada dokumentasi penghapusan.
//   2. Tidak ada route API (`apps/<app>/src/app/api`, kecuali file test) yang
//      memanggil `console.*` langsung; backend log wajib lewat module logger
//      facade (`createModuleLogger`).
//
// Scan dimulai dari lokasi package ini lalu naik sampai root repo (direktori
// yang memuat `apps/` dan `packages/`), sehingga guard tidak bergantung pada
// cwd proses test. Tidak ada dependency tambahan: `node:fs`, `node:path`, dan
// API vitest sudah cukup.

/** Ekstensi sumber first-party yang diperiksa. */
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/** Direktori non-source (build, dependency, artefak test, metadata VCS). */
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

/** Aplikasi yang tunduk pada kebijakan logging. */
const APP_NAMES = ["store", "admin"] as const;

/** Nama API engine logger lama yang sudah dihapus dari kedua app. */
const LEGACY_LOGGER_PATTERN =
  /\b(createLogger|requestLogger|withRequestId|serializeError)\b/g;

/** Pemanggilan console level backend yang dilarang di route API. */
const DIRECT_CONSOLE_PATTERN = /\bconsole\s*\.\s*(log|error|warn|debug)\s*\(/g;

/** File test dikecualikan dari aturan `console.*` (boleh meng-spy console). */
const TEST_FILE_PATTERN = /\.test\.tsx?$/;

interface Violation {
  /** Path relatif terhadap root repo, selalu memakai pemisah `/`. */
  file: string;
  line: number;
  detail: string;
}

/** Naik dari direktori package sampai menemukan root repo. */
function findRepoRoot(from: string): string {
  let current = from;
  for (;;) {
    if (
      existsSync(path.join(current, "apps")) &&
      existsSync(path.join(current, "packages"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        `policy logging: root repo tidak ditemukan dari direktori ${from}`
      );
    }
    current = parent;
  }
}

const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

function toRepoRelative(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

/** Daftar file sumber di bawah `root` (rekursif, deterministik). */
function listSourceFiles(root: string): string[] {
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Symlink dilewati agar scan tidak keluar dari tree repo.
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  };

  if (existsSync(root)) walk(root);
  return files.sort();
}

/** Facade logger app yang menjadi satu-satunya pengecualian aturan pertama. */
function isAppLoggerFacade(file: string): boolean {
  return APP_NAMES.some(
    (app) =>
      path.join(REPO_ROOT, "apps", app, "src", "lib", "logger.ts") === file
  );
}

/** Seluruh file sumber kedua app, kecuali facade logger masing-masing. */
let appSourceFileCache: string[] | null = null;

function appSourceFiles(): string[] {
  appSourceFileCache ??= APP_NAMES.flatMap((app) =>
    listSourceFiles(path.join(REPO_ROOT, "apps", app, "src"))
  ).filter((file) => !isAppLoggerFacade(file));
  return appSourceFileCache;
}

/** File route API non-test pada kedua app. */
let apiRouteFileCache: string[] | null = null;

function apiRouteSourceFiles(): string[] {
  apiRouteFileCache ??= APP_NAMES.flatMap((app) =>
    listSourceFiles(path.join(REPO_ROOT, "apps", app, "src", "app", "api"))
  ).filter((file) => !TEST_FILE_PATTERN.test(file));
  return apiRouteFileCache;
}

/** Cari setiap kemunculan pola per baris, sertakan path relatif dan nomor baris. */
function collectViolations(files: string[], pattern: RegExp): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const match of text.matchAll(pattern)) {
        violations.push({
          file: toRepoRelative(file),
          line: index + 1,
          detail: match[0].replace(/\s+/g, " "),
        });
      }
    });
  }
  return violations;
}

/** Pesan kegagalan yang bisa langsung dibaca: daftar `file:line`. */
function failureMessage(rule: string, violations: Violation[]): string {
  return [
    `${rule} — ${violations.length} pelanggaran:`,
    ...violations.map(
      (violation) =>
        `  ${violation.file}:${violation.line} → ${violation.detail}`
    ),
  ].join("\n");
}

describe("kebijakan logging: guard regresi statis", () => {
  it("memindai tree source app store dan admin (scan tidak boleh kosong)", () => {
    for (const app of APP_NAMES) {
      expect(
        existsSync(path.join(REPO_ROOT, "apps", app, "src")),
        `policy logging: apps/${app}/src tidak ditemukan dari ${REPO_ROOT}`
      ).toBe(true);
    }
    // Scan kosong akan membuat guard lolos tanpa memeriksa apa pun.
    expect(appSourceFiles().length).toBeGreaterThan(0);
    expect(apiRouteSourceFiles().length).toBeGreaterThan(0);
  });

  it("tidak ada file app yang memakai engine logger lama", () => {
    const violations = collectViolations(
      appSourceFiles(),
      LEGACY_LOGGER_PATTERN
    );
    expect(
      violations,
      failureMessage(
        "Engine logger lama (createLogger/requestLogger/withRequestId/serializeError) masih direferensikan; pakai facade @/lib/logger",
        violations
      )
    ).toEqual([]);
  });

  it("tidak ada route API yang memanggil console.* langsung", () => {
    const violations = collectViolations(
      apiRouteSourceFiles(),
      DIRECT_CONSOLE_PATTERN
    );
    expect(
      violations,
      failureMessage(
        "Route API memanggil console.* langsung; pakai createModuleLogger dari @/lib/logger",
        violations
      )
    ).toEqual([]);
  });
});
