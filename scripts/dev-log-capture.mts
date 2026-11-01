import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

/** Windows tidak mendukung process group; taskkill /T menghentikan seluruh tree. */
export async function stopProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  if (process.platform !== "win32") {
    try { process.kill(-pid, signal); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", reject);
    killer.once("close", (code) => {
      if (code === 0) return resolve();
      try { process.kill(pid, 0); } catch { return resolve(); }
      reject(new Error(`taskkill gagal menghentikan proses ${pid} (exit ${code})`));
    });
  });
}

function main(): void {
  const scripts: Record<string, string> = {
    "jubelio-mock": "dev:jubelio-mock",
    store: "dev:store:app",
    admin: "dev:admin:app",
  };
  const app = process.argv[2] ?? "";
  const script = Object.hasOwn(scripts, app) ? scripts[app] : undefined;
  const npm = process.env.npm_execpath;
  if (!script || !npm) {
    console.error("Gunakan melalui npm run dev:all, dev:store, atau dev:admin.");
    process.exitCode = 1;
    return;
  }
  const logPath = join("logs", `${app}.log`);
  mkdirSync(dirname(logPath), { recursive: true });
  const fd = openSync(logPath, "w");
  // Jalankan npm lewat Node: tidak perlu npm.cmd, quoting shell, atau Bash.
  const child = spawn(process.execPath, [npm, "run", "--silent", script], {
    stdio: ["inherit", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let stopping: NodeJS.Signals | undefined;
  let forceStop: ReturnType<typeof setTimeout> | undefined;
  const reportError = (error: Error) => {
    console.error(`[capture:${app}] ${error.message}`);
    process.exitCode = 1;
  };
  const stop = (signal: NodeJS.Signals) => {
    if (stopping || !child.pid) return;
    stopping = signal;
    void stopProcessTree(child.pid, signal).catch(reportError);
    forceStop = setTimeout(() => {
      if (child.pid) void stopProcessTree(child.pid, "SIGKILL").catch(reportError);
    }, 5000);
    forceStop.unref();
  };
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  for (const [input, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]] as const) {
    input.setEncoding("utf8");
    let pending = "";
    input.on("data", (chunk: string) => {
      output.write(chunk);
      pending += chunk;
      // Buffer per baris agar ANSI/UTF-8 yang terpotong antar-chunk tetap utuh.
      const end = pending.lastIndexOf("\n") + 1;
      if (end) {
        writeSync(fd, stripVTControlCharacters(pending.slice(0, end)));
        pending = pending.slice(end);
      }
    });
    input.on("end", () => { writeSync(fd, stripVTControlCharacters(pending)); });
  }
  child.on("error", reportError);
  child.on("close", (code) => {
    if (forceStop) clearTimeout(forceStop);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    closeSync(fd);
    process.exitCode = process.exitCode || (stopping === "SIGINT" ? 130 : stopping ? 143 : code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
