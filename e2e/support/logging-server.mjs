/**
 * Harness test-only: menjalankan `next dev` milik app yang diminta, merekam
 * stdout mentah proses itu ke artifact log, dan meneruskan chunk yang sama apa
 * adanya ke stream runner.
 *
 * Kenapa perlu runner terpisah: spec korelasi logging harus memeriksa output
 * server NYATA (bukan route interception browser), sedangkan Playwright tidak
 * menyimpan stdout proses `webServer`. Runner ini menjalankan CLI Next yang
 * sama dengan `npx next` (di-resolve dari manifest paket yang terpasang, tanpa
 * shell), lalu menyalin stdout-nya ke file di temp dir di luar repo.
 *
 * Batas keamanan (fail closed): hanya untuk E2E provider-mock, hanya app
 * store/admin, hanya port fixture loopback 3110/3111, hanya NODE_ENV selain
 * production, dan hanya menulis artifact di dalam `E2E_LOGGING_DIR` yang
 * disiapkan `playwright.mock.config.ts`.
 *
 * Pemakaian (dari webServer config, cwd = apps/<app>):
 *   node ../../e2e/support/logging-server.mjs <store|admin> <3110|3111>
 *
 * Ini bukan transport produksi: `appendFileSync` dipakai per chunk supaya spec
 * deterministik (baris sudah ada di file saat chunk berikutnya tiba), dan tidak
 * ada endpoint, env app baru, atau perubahan tujuan log aplikasi.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";

const APP_FIXTURES = {
  store: { port: "3110", logEnv: "E2E_LOGGING_STORE_LOG" },
  admin: { port: "3111", logEnv: "E2E_LOGGING_ADMIN_LOG" },
};

/** Satu-satunya jalur kegagalan runner: dilempar, dicetak sekali, exit 1. */
function refuse(message) {
  const error = new Error(message);
  error.name = "LoggingServerRefused";
  throw error;
}

function main() {
  const [app, port] = process.argv.slice(2);
  const fixture = Object.hasOwn(APP_FIXTURES, app) ? APP_FIXTURES[app] : undefined;
  if (!fixture) {
    refuse(`app tidak dikenal (${String(app)}); hanya 'store' atau 'admin'`);
  }
  if (port !== fixture.port) {
    refuse(
      `port ${String(port)} bukan port fixture loopback ${fixture.port} untuk ${app}`
    );
  }
  if (process.env.E2E_PROVIDER_MOCKS !== "true") {
    refuse(
      "E2E_PROVIDER_MOCKS harus 'true' (jalankan lewat playwright.mock.config.ts)"
    );
  }
  if (process.env.NODE_ENV === "production") {
    refuse("NODE_ENV=production ditolak: runner ini hanya untuk E2E development");
  }

  // Artifact hanya di dalam direktori capture run ini, tidak ke jalur bebas.
  const loggingDir = process.env.E2E_LOGGING_DIR ?? "";
  const logPath = process.env[fixture.logEnv] ?? "";
  if (loggingDir.length === 0 || logPath.length === 0) {
    refuse(`E2E_LOGGING_DIR dan ${fixture.logEnv} harus diset`);
  }
  const withinCaptureDir = relative(loggingDir, logPath);
  if (
    withinCaptureDir.length === 0 ||
    withinCaptureDir.startsWith("..") ||
    isAbsolute(withinCaptureDir)
  ) {
    refuse(`${fixture.logEnv} harus berada di dalam E2E_LOGGING_DIR`);
  }
  // stderr terpisah: dipakai untuk diagnosis, tidak mencampur artifact JSON.
  const diagnosticsPath = `${logPath.replace(/\.log$/, "")}.stderr.log`;

  // CLI Next di-resolve dari manifest paket yang terpasang di app ini, bukan
  // dari PATH/npx: bin publik yang sama (`bin.next`) dijalankan dengan Node
  // yang sedang memakai runner ini, tanpa shell.
  const requireFromApp = createRequire(join(process.cwd(), "package.json"));
  const nextManifestPath = requireFromApp.resolve("next/package.json");
  const nextManifest = JSON.parse(readFileSync(nextManifestPath, "utf8"));
  const nextBin =
    typeof nextManifest.bin === "string"
      ? nextManifest.bin
      : nextManifest.bin?.next;
  if (typeof nextBin !== "string" || nextBin.length === 0) {
    refuse("manifest paket next tidak memuat bin.next");
  }
  const nextBinPath = join(dirname(nextManifestPath), nextBin);

  const child = spawn(process.execPath, [nextBinPath, "dev", "-p", port], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  /** Rekam chunk apa adanya, lalu teruskan chunk yang sama ke stream aslinya. */
  const tee = (chunk, filePath, target) => {
    try {
      appendFileSync(filePath, chunk);
    } catch {
      // Capture yang gagal tidak boleh menghentikan server yang sedang diuji;
      // spec akan timeout dan melaporkan artifact yang tidak lengkap.
    }
    target.write(chunk);
  };

  child.stdout.on("data", (chunk) => tee(chunk, logPath, process.stdout));
  child.stderr.on("data", (chunk) => tee(chunk, diagnosticsPath, process.stderr));

  child.on("error", (error) => {
    process.stderr.write(
      `[logging-server] gagal menjalankan next dev: ${error.message}\n`
    );
    process.exit(1);
  });

  child.on("close", (code, signal) => {
    // Server uji berhenti → runner berhenti pula. Kematian karena signal
    // (teardown Playwright) bukan kegagalan; exit code lain diteruskan apa
    // adanya supaya Playwright melihat kegagalan, bukan proses menggantung.
    process.exit(signal ? 0 : typeof code === "number" ? code : 1);
  });

  // Sinyal berhenti diteruskan ke child; runner keluar lewat handler `close`
  // di atas supaya chunk terakhir tetap terekam.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      if (child.exitCode === null && !child.killed) {
        child.kill(signal);
      }
    });
  }

  // Jangan tinggalkan server yatim bila runner berhenti lebih dulu.
  process.on("exit", () => {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[logging-server] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
