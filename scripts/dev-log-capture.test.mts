import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guard statis untuk capture log development ke `logs/` (plan
 * `dev-log-capture`).
 *
 * Seam yang diuji adalah **kontrak konfigurasi repo**: script npm yang
 * dijalankan developer, helper `scripts/strip-ansi.sed`, dan `.gitignore`.
 * Test ini sengaja tidak men-spawn `next dev` (butuh DB, port, dan waktu)
 * sehingga deterministik; perilaku nyata (file muncul, isinya bersih) dibuktikan
 * oleh smoke run yang dicatat sebagai evidence di
 * `.scratch/dev-log-capture/index.md`.
 *
 * Nilai harapan diambil dari acceptance criteria plan, bukan dari bentuk
 * implementasi: satu file per app, ditimpa per run, exit code tidak ditelan
 * `tee`, tanpa banner npm, tanpa ANSI escape code di file, dan `logs/` tidak
 * di-track git.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Entry point dev yang disepakati beserta app yang wajib tertangkap. */
const CAPTURE_MATRIX: Record<string, readonly string[]> = {
  "dev:all": ["jubelio-mock", "store", "admin"],
  "dev:store": ["jubelio-mock", "store"],
  "dev:admin": ["admin"],
};

/** Helper strip ANSI yang dipakai seluruh pipeline capture. */
const STRIP_SCRIPT = "scripts/strip-ansi.sed";

function readRepoFile(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

function readScripts(): Record<string, string> {
  const manifest = JSON.parse(readRepoFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

/** Isi setiap pembungkus `bash -o pipefail -c '<pipeline>'` pada satu script. */
function pipelinesOf(script: string): string[] {
  return [...script.matchAll(/bash -o pipefail -c '([^']*)'/g)].map(
    (match) => match[1] ?? ""
  );
}

/** Target file log pada satu pipeline, mis. `logs/store.log`. */
function logTargetsOf(pipeline: string): string[] {
  return [
    ...pipeline.matchAll(
      new RegExp(
        `sed -u -E -f ${STRIP_SCRIPT} > (logs\\/[a-z-]+\\.log)\\b`,
        "g"
      )
    ),
  ].map((match) => match[1] ?? "");
}

describe("capture log development", () => {
  const scripts = readScripts();

  it("menyalin setiap proses dev ke logs/<app>.log miliknya sendiri", () => {
    for (const [entry, apps] of Object.entries(CAPTURE_MATRIX)) {
      const pipelines = pipelinesOf(scripts[entry] ?? "");
      expect(pipelines, `${entry} harus mempipe tiap proses`).toHaveLength(
        apps.length
      );
      expect(
        pipelines.flatMap(logTargetsOf).sort(),
        `${entry} harus menulis tepat satu file per app`
      ).toEqual(apps.map((app) => `logs/${app}.log`).sort());
      for (const pipeline of pipelines) {
        expect(pipeline, `${entry} harus menangkap stderr juga`).toContain(
          "2>&1"
        );
      }
    }
  });

  it("menulis file log tanpa ANSI escape code, terminal tetap apa adanya", () => {
    // `concurrently` menyuntik `FORCE_COLOR` saat stdout-nya TTY, sehingga
    // Next/Turbopack tetap mengeluarkan SGR walau stdout dipipe ke `tee`.
    // Karena itu file harus melewati helper strip, bukan ditulis `tee` langsung.
    for (const entry of Object.keys(CAPTURE_MATRIX)) {
      const script = scripts[entry] ?? "";
      for (const pipeline of pipelinesOf(script)) {
        expect(pipeline, `${entry} harus memakai helper strip`).toContain(
          `tee >(sed -u -E -f ${STRIP_SCRIPT} >`
        );
        expect(pipeline, `${entry} tidak boleh menulis file secara mentah`).not
          .toMatch(/tee logs\//);
      }
    }

    // `-u` wajib: tanpa itu sed menahan output di buffer block (file tetap
    // kosong sampai ~4 KB atau sampai sed berhenti), sehingga `tail -f` tidak
    // menampilkan apa pun dan baris terakhir bisa hilang saat Ctrl+C.
    for (const entry of Object.keys(CAPTURE_MATRIX)) {
      for (const pipeline of pipelinesOf(scripts[entry] ?? "")) {
        expect(pipeline, `${entry} harus memakai sed -u`).not.toMatch(
          /(?<![.\w])sed (?!-u)/
        );
      }
    }

    // Helper harus benar-benar menghapus escape code, termasuk kode cursor
    // (`ESC[?25h`) yang dikirim Next saat proses berhenti.
    const stripScript = readRepoFile(STRIP_SCRIPT);
    expect(stripScript).toContain("\\x1b");
    expect(stripScript).toContain("[0-9;?]*[A-Za-z]");
  });

  it("menekan banner npm agar isi file log bersih", () => {
    for (const entry of Object.keys(CAPTURE_MATRIX)) {
      for (const pipeline of pipelinesOf(scripts[entry] ?? "")) {
        expect(pipeline, `${entry} harus memakai --silent`).toMatch(
          /^npm run --silent \S+ /
        );
        expect(
          pipeline,
          `${entry} tidak boleh memanggil npm run tanpa --silent`
        ).not.toMatch(/\bnpm run (?!--silent)/);
      }
    }
  });

  it("meneruskan exit code proses anak meski output dipipe", () => {
    for (const entry of Object.keys(CAPTURE_MATRIX)) {
      const script = scripts[entry] ?? "";
      const pipelines = pipelinesOf(script);
      // Tidak ada `tee` di luar pembungkus pipefail: tanpanya exit code proses
      // anak tertelan menjadi status `tee` (0).
      expect(
        [...script.matchAll(/tee /g)],
        `${entry} tidak boleh punya tee di luar pembungkus pipefail`
      ).toHaveLength(pipelines.length);
    }
  });

  it("menyiapkan folder logs sebelum proses dijalankan", () => {
    for (const entry of Object.keys(CAPTURE_MATRIX)) {
      expect(scripts[`pre${entry}`], `pre${entry} harus ada`).toBe(
        "mkdir -p logs"
      );
    }
  });

  it("menimpa file tiap run, bukan menumpuk", () => {
    for (const entry of Object.keys(CAPTURE_MATRIX)) {
      const script = scripts[entry] ?? "";
      expect(script, `${entry} tidak boleh memakai tee -a`).not.toContain(
        "tee -a"
      );
      expect(script, `${entry} tidak boleh memakai append redirect`).not.toContain(
        ">>"
      );
    }
  });

  it("mengabaikan folder logs dari git", () => {
    let gitignore = "";
    try {
      gitignore = readRepoFile(".gitignore");
    } catch {
      gitignore = "";
    }
    const lines = gitignore.split("\n").map((line) => line.trim());
    expect(lines).toContain("/logs/");
  });
});
