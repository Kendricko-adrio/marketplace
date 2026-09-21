import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// =========================================================
// RBAC: legacy-authorization cutover guard (permanent)
// =========================================================
// Slice 9 removed every hardcoded admin/HQ authorization branch and the
// legacy permission-table path. This repository-level test FAILS when any
// forbidden legacy pattern reappears in source, tests, or E2E specs:
//
// - `HQ_PERMISSIONS` / `permissions-shared` (static HQ permission map)
// - imports or uses of the legacy `permissions` table / `moduleNames`
// - legacy Role-name authorization (`session.user.role`, `role === "hq"`,
//   literal `["admin", "hq"]` role lists, `users.role` column access)
// - `hqOnly` navigation gates
// - legacy `/api/admin/permissions` or `/permissions/me` client calls
//
// Literal role/system names are allowed ONLY in seed/migration/display
// fixtures where they are not authorization decisions (seed files, the
// generated SQL audit record, and this test's own pattern list).

const ROOT = path.resolve(import.meta.dirname, "../../../../..");

/** Directories scanned for forbidden patterns. */
const SCAN_DIRS = [
  "apps/admin/src",
  "packages/db/src",
  "e2e",
];

const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx"]);

/** Files where literal legacy names are display/seed/migration fixtures. */
const ALLOWED_FILES = new Set([
  // Seeds keep the legacy `role` mapping ONLY as migration fixture data.
  "packages/db/src/seed.ts",
  "packages/db/src/seed-cleanup.ts",
  "packages/db/src/rbac/seed-defaults.ts",
  "packages/db/src/rbac/ensure-roles.ts",
  // This test owns the pattern list itself.
  "apps/admin/src/lib/rbac/legacy-cutover.test.ts",
]);

/** Any path containing one of these segments is skipped entirely. */
const ALLOWED_SEGMENTS = ["drizzle", "node_modules", ".next"];

interface ForbiddenPattern {
  /** Human-readable rule name for the failure message. */
  name: string;
  /** Regex that must not match any scanned source line. */
  pattern: RegExp;
}

const FORBIDDEN: ForbiddenPattern[] = [
  {
    name: "HQ_PERMISSIONS static permission map",
    pattern: /HQ_PERMISSIONS/,
  },
  {
    name: "legacy permissions lib import",
    pattern: /from "\.\/permissions"|from "@\/lib\/permissions"|permissions-shared/,
  },
  {
    name: "legacy permissions API route or client call",
    pattern: /api\/admin\/permissions/,
  },
  {
    name: "legacy permission table / moduleNames usage",
    pattern: /\bschema\.permissions\b|\bmoduleNames\b|\bmodule_name\b/,
  },
  {
    name: "hqOnly navigation gate",
    pattern: /\bhqOnly\b|hq_only|hqOnlyGate/,
  },
  {
    name: "legacy users.role column access",
    pattern: /\busers\.role\b(?!\w)/,
  },
  {
    name: "legacy session role-name authorization",
    pattern: /session\.user\.role\b/,
  },
  {
    name: "legacy role-name comparison authorization",
    pattern: /\.role\s*(?:===|!==)\s*["'](hq|admin)["']/,
  },
  {
    name: "legacy role union type authorization",
    pattern: /["'](admin|hq)["']\s*\|\s*["'](admin|hq)["']/,
  },
  {
    name: "legacy literal role list guard",
    pattern: /\[\s*["']admin["']\s*,\s*["']hq["']\s*(?:,\s*["'][^"']+["']\s*)?\]/,
  },
];

function walk(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(base, full).split(path.sep).join("/");
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (ALLOWED_SEGMENTS.some((s) => entry === s || rel.includes(s))) continue;
      walk(full, base, out);
    } else if (ALLOWED_EXTENSIONS.has(path.extname(entry))) {
      out.push(full);
    }
  }
}

function collectScanFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    walk(path.join(ROOT, dir), ROOT, files);
  }
  return files.filter((f) => {
    const rel = path.relative(ROOT, f).split(path.sep).join("/");
    if (ALLOWED_FILES.has(rel)) return false;
    return !ALLOWED_SEGMENTS.some((s) => rel.includes(`/${s}/`) || rel.startsWith(`${s}/`));
  });
}

describe("legacy RBAC cutover guard", () => {
  it("has no forbidden legacy authorization patterns in source", () => {
    const violations: string[] = [];
    for (const file of collectScanFiles()) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const rule of FORBIDDEN) {
          if (rule.pattern.test(line)) {
            violations.push(`${rel}:${i + 1} [${rule.name}]: ${line.trim().slice(0, 160)}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});