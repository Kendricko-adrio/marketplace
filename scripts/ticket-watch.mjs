#!/usr/bin/env node
/**
 * Live monitor untuk satu sesi `pi` (dipakai conductor tiket).
 *
 * Membaca file session JSONL yang ditulis Pi secara live, lalu mencetak baris
 * ringkas: model, thinking level, tool call, preview teks, durasi, dan token.
 * Tidak membuka koneksi ke model dan tidak mengubah session.
 *
 * Pemakaian:
 *   node scripts/ticket-watch.mjs                      # sesi terbaru di cwd ini
 *   node scripts/ticket-watch.mjs --session discounts-05-a1
 *   node scripts/ticket-watch.mjs --last 20 --once     # cetak lalu keluar
 *   node scripts/ticket-watch.mjs --all                # abaikan filter cwd
 *
 * Tekan Ctrl+C untuk berhenti; total token/cost dicetak saat keluar.
 */
import { closeSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_INTERVAL_MS = 500;

function parseArgs(argv) {
  const valueOf = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    session: valueOf("--session"),
    cwd: valueOf("--cwd") ? resolve(valueOf("--cwd")) : resolve(process.cwd()),
    last: Number(valueOf("--last") ?? 10),
    once: argv.includes("--once"),
    all: argv.includes("--all"),
    raw: argv.includes("--raw"),
    interval: Number(valueOf("--interval") ?? DEFAULT_INTERVAL_MS),
    sessionsRoot: valueOf("--sessions-root")
      ? resolve(valueOf("--sessions-root"))
      : join(homedir(), ".pi", "agent", "sessions"),
  };
}

function readHeader(file) {
  const text = readFileSync(file, "utf8");
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  try {
    return JSON.parse(firstLine);
  } catch {
    return null;
  }
}

function samePath(a, b) {
  const normalize = (value) => (process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value));
  return normalize(a) === normalize(b);
}

/** Cari session terbaru; filter opsional berdasarkan substring nama/id session. */
export function findSessionFile({ session, cwd, all, sessionsRoot }) {
  let directories;
  try {
    directories = readdirSync(sessionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return null;
  }

  const candidates = [];
  for (const directory of directories) {
    const directoryPath = join(sessionsRoot, directory.name);
    let files;
    try {
      files = readdirSync(directoryPath).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const name of files) {
      if (session && !name.includes(session)) continue;
      const file = join(directoryPath, name);
      const header = readHeader(file);
      if (!header) continue;
      if (!all && cwd && header.cwd && !samePath(header.cwd, cwd)) continue;
      candidates.push({
        file,
        id: header.id ?? name.replace(/\.jsonl$/, ""),
        cwd: header.cwd,
        mtimeMs: statSync(file).mtimeMs,
      });
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] ?? null;
}

/** Ringkasan argumen tool call, satu baris pendek. */
export function summarizeToolCall(call) {
  const args = call?.arguments ?? {};
  const firstLine = (value, limit = 100) =>
    String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

  if (typeof args.command === "string") return firstLine(args.command);
  if (typeof args.path === "string") return firstLine(args.path);
  if (typeof args.file_path === "string") return firstLine(args.file_path);
  if (typeof args.pattern === "string") return firstLine(args.pattern);
  if (typeof args.query === "string") return firstLine(args.query);
  if (typeof args.url === "string") return firstLine(args.url);

  const firstString = Object.values(args).find((value) => typeof value === "string");
  return firstString ? firstLine(firstString) : "";
}

export function emptyUsage() {
  return { input: 0, output: 0, total: 0, cacheRead: 0, cost: 0 };
}

export function sumUsage(usage, message) {
  const next = { ...usage };
  const value = message?.usage;
  if (value) {
    next.input += value.input ?? 0;
    next.output += value.output ?? 0;
    next.total += value.totalTokens ?? 0;
    next.cacheRead = value.cacheRead ?? next.cacheRead;
    next.cost += value.cost?.total ?? 0;
  }
  return next;
}

export function formatUsage(usage) {
  return `in=${usage.input} out=${usage.output} tok=${usage.total} cache=${usage.cacheRead}`;
}

/** 1234 -> 1.2k, 1158435 -> 1.16M */
export function compactNumber(value) {
  const number = Number(value ?? 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}k`;
  return String(number);
}

export function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return "";
  return durationMs >= 1000 ? ` ${(durationMs / 1000).toFixed(1)}s` : ` ${Math.round(durationMs)}ms`;
}

export function formatTotals(usage) {
  const cost = usage.cost > 0 ? ` $${usage.cost.toFixed(4)}` : "";
  return `Σ in=${usage.input} out=${usage.output} tok=${usage.total} cache=${usage.cacheRead}${cost}`;
}

const time = (entry) => String(entry?.timestamp ?? "").slice(11, 19) || "--:--:--";

/** Format satu entry session menjadi beberapa baris (string). */
export function formatEntry(entry, usage) {
  if (entry?.type === "session") {
    return `[session] ${entry.id ?? "?"} · ${entry.cwd ?? "?"}`;
  }
  if (entry?.type !== "message") {
    return `[${time(entry)}] ${entry?.type ?? "unknown"}`;
  }

  const message = entry.message ?? {};
  const role = message.role ?? "?";
  const body = Array.isArray(message.content) ? message.content : [];

  if (role === "toolResult") {
    const text = body
      .map((block) => block?.text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const flag = message.isError ? " ERROR" : "";
    const duration = formatDuration(message.durationMs);
    return `[${time(entry)}] result ${message.toolName ?? "?"}${duration}${flag} · ${text.slice(0, 120)}`;
  }

  if (role === "assistant") {
    const lines = [];
    const model = message.model ? `${message.provider ?? "?"}/${message.model}` : "?";
    const thinking = message.thinkingLevel ? ` think=${message.thinkingLevel}` : "";
    const duration = formatDuration(message.durationMs);
    const per = message.usage;
    const contextTokens = per ? (per.input ?? 0) + (per.cacheRead ?? 0) + (per.cacheWrite ?? 0) : 0;
    const outputTokens = per?.output ?? 0;
    lines.push(
      `[${time(entry)}] assistant ${model}${thinking}${duration} · ctx=${compactNumber(contextTokens)} out=${outputTokens} · Σ tok=${compactNumber(usage.total)}`
    );
    for (const block of body) {
      if (block?.type === "thinking") {
        lines.push(`   think · ${String(block.thinking ?? "").length}ch`);
      } else if (block?.type === "text") {
        const text = String(block.text ?? "").replace(/\s+/g, " ").trim();
        if (text) lines.push(`   text · ${text.slice(0, 140)}`);
      } else if (block?.type === "toolCall") {
        lines.push(`   → ${block.name ?? "?"} · ${summarizeToolCall(block)}`);
      }
    }
    if (message.stopReason) lines.push(`   stop=${message.stopReason}`);
    return lines.join("\n");
  }

  const text = body
    .map((block) => block?.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return `[${time(entry)}] ${role} · ${text.slice(0, 140)}`;
}

function readLines(file, fromByte = 0) {
  const size = statSync(file).size;
  if (size <= fromByte) return { lines: [], nextByte: size, remainder: "" };
  const length = size - fromByte;
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, length, fromByte);
  } finally {
    closeSync(fd);
  }
  return { lines: buffer.toString("utf8").split(/\r?\n/), nextByte: size };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const found = findSessionFile(args);
  if (!found) {
    console.error(
      `tidak ada session yang cocok${args.session ? ` untuk "${args.session}"` : ""} di ${args.sessionsRoot}`
    );
    process.exit(1);
  }

  const lines = readFileSync(found.file, "utf8").split(/\r?\n/).filter((line) => line.trim());
  let usage = emptyUsage();
  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry?.type === "message") usage = sumUsage(usage, entry.message);
      entries.push(entry);
    } catch {
      // baris parsial di akhir file saat sesi menulis
    }
  }

  const print = (entry) => {
    if (args.raw) {
      console.log(JSON.stringify(entry));
      return;
    }
    console.log(formatEntry(entry, usage));
  };

  console.log(`# file: ${found.file}`);
  console.log(`# ${entries.length} entry · ${formatTotals(usage)}`);
  for (const entry of entries.slice(-Math.max(1, args.last))) print(entry);
  if (args.once) return;

  let offset = statSync(found.file).size;
  let remainder = "";
  const timer = setInterval(() => {
    let size;
    try {
      size = statSync(found.file).size;
    } catch {
      return;
    }
    if (size < offset) {
      offset = 0;
      remainder = "";
    }
    if (size === offset) return;

    const chunk = readLines(found.file, offset);
    offset = chunk.nextByte;
    const text = remainder + chunk.lines.join("\n");
    const parts = text.split(/\r?\n/);
    remainder = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry?.type === "message") usage = sumUsage(usage, entry.message);
        print(entry);
      } catch {
        // abaikan baris yang belum lengkap
      }
    }
  }, Math.max(100, args.interval));

  const stop = () => {
    clearInterval(timer);
    console.log(`# ${formatTotals(usage)}`);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main();
