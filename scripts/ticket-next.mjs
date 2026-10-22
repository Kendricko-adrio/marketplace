#!/usr/bin/env node
/**
 * Resolver frontier tiket diskon (read-only).
 *
 * Membaca frontmatter `Status:` dan `Blocked by:` dari
 * `.scratch/discounts-implementation/issues/NN-*.md`, memvalidasi graf, lalu
 * memilih tiket berikutnya:
 *   1. tiket `claimed` (pekerjaan yang sedang berjalan), lalu
 *   2. tiket `open` bernomor terkecil yang seluruh blocker-nya `resolved`.
 *
 * Skrip ini tidak pernah menulis file tiket. Status hanya ditulis oleh sesi
 * tiket yang menjalankannya.
 *
 * Pemakaian:
 *   node scripts/ticket-next.mjs
 *   node scripts/ticket-next.mjs --quiet            # path tiket atau kosong
 *   node scripts/ticket-next.mjs --json             # rencana lengkap
 *   node scripts/ticket-next.mjs --status 07        # open|claimed|resolved
 *   node scripts/ticket-next.mjs --no-claimed       # jangan lanjutkan claimed
 *   node scripts/ticket-next.mjs --skip 08,09       # abaikan tiket tertentu
 *   node scripts/ticket-next.mjs --issues-dir <dir> # fixture/test
 *
 * Exit code: 0 normal, 2 graf/argumen tidak valid.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STATUSES = ["open", "claimed", "resolved"];

export class TicketGraphError extends Error {
  constructor(messages) {
    super(messages.join("\n"));
    this.name = "TicketGraphError";
    this.messages = messages;
  }
}

/** Parse hanya blok frontmatter: sebelum heading `## ` pertama, maksimal 40 baris. */
export function parseFrontmatter(text) {
  const fields = {};
  for (const raw of text.split(/\r?\n/).slice(0, 40)) {
    if (raw.startsWith("## ")) break;
    const match = raw.match(/^(Status|Blocked by|Assignee):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}

/**
 * `**resolved**`, `resolved.`, dan `resolved (catatan)` semuanya menjadi
 * `resolved`. Nilai yang tidak dikenal dikembalikan apa adanya agar validasi
 * graf bisa menolaknya.
 */
export function normalizeStatus(value) {
  const cleaned = (value ?? "").replace(/\*/g, "").trim();
  if (!cleaned) return "";
  return cleaned.split(/[\s.]/)[0].toLowerCase();
}

/** `none`/kosong = tanpa blocker. `1` dinormalisasi menjadi `01`. */
export function parseBlockers(value) {
  const cleaned = (value ?? "").trim();
  if (!cleaned || /^none$/i.test(cleaned)) return [];
  return cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/^\d{1,2}$/.test(part) ? part.padStart(2, "0") : part));
}

function compareByNumber(a, b) {
  return Number(a.id) - Number(b.id);
}

function findCycle(tickets) {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const state = new Map(); // 1 = sedang dikunjungi, 2 = selesai
  const stack = [];
  let cycle = null;

  const visit = (id) => {
    if (cycle) return;
    const current = state.get(id);
    if (current === 2) return;
    if (current === 1) {
      cycle = [...stack.slice(stack.indexOf(id)), id];
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const blocker of byId.get(id)?.blockedBy ?? []) visit(blocker);
    stack.pop();
    state.set(id, 2);
  };

  for (const ticket of tickets) visit(ticket.id);
  return cycle;
}

/** Muat + validasi graf. Melempar TicketGraphError untuk input tidak valid. */
export function loadTickets(issuesDir) {
  const files = readdirSync(issuesDir)
    .filter((file) => /^\d{2}-.+\.md$/.test(file))
    .sort();

  if (files.length === 0) {
    throw new TicketGraphError([`tidak ada tiket NN-*.md di ${issuesDir}`]);
  }

  const tickets = files.map((file) => {
    const fields = parseFrontmatter(readFileSync(join(issuesDir, file), "utf8"));
    return {
      id: file.slice(0, 2),
      file: join(issuesDir, file),
      status: normalizeStatus(fields.Status),
      blockedBy: parseBlockers(fields["Blocked by"]),
      assignee: fields.Assignee ?? "none",
    };
  });

  const seen = new Set();
  const errors = [];
  for (const ticket of tickets) {
    if (seen.has(ticket.id)) errors.push(`${ticket.id}: id duplikat`);
    seen.add(ticket.id);
    if (!STATUSES.includes(ticket.status)) {
      errors.push(`${ticket.id}: status tidak dikenal "${ticket.status}"`);
    }
  }
  for (const ticket of tickets) {
    for (const blocker of ticket.blockedBy) {
      if (!seen.has(blocker)) errors.push(`${ticket.id}: blocker "${blocker}" tidak ada`);
      if (blocker === ticket.id) errors.push(`${ticket.id}: memblokir dirinya sendiri`);
    }
  }
  if (errors.length) throw new TicketGraphError(errors);

  const cycle = findCycle(tickets);
  if (cycle) throw new TicketGraphError([`siklus blocker: ${cycle.join(" -> ")}`]);

  return tickets;
}

/**
 * Pilih tiket berikutnya.
 * @returns {{next: object|null, claimed: object[], ready: object[]}}
 */
export function selectNext(tickets, options = {}) {
  const { includeClaimed = true, skip = [] } = options;
  const skipSet = new Set(skip.map((id) => String(id).padStart(2, "0")));
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const isResolved = (id) => byId.get(id)?.status === "resolved";

  const claimed = (includeClaimed ? tickets : [])
    .filter((ticket) => ticket.status === "claimed" && !skipSet.has(ticket.id))
    .sort(compareByNumber);

  const ready = tickets
    .filter(
      (ticket) =>
        ticket.status === "open" &&
        !skipSet.has(ticket.id) &&
        ticket.blockedBy.every(isResolved)
    )
    .sort(compareByNumber);

  return { next: claimed[0] ?? ready[0] ?? null, claimed, ready };
}

/** Ringkasan untuk `--json` dan log penutup conductor. */
export function describePlan(tickets, options = {}) {
  const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const isResolved = (id) => byId.get(id)?.status === "resolved";
  const selection = selectNext(tickets, options);

  return {
    next: selection.next
      ? { id: selection.next.id, file: selection.next.file }
      : null,
    claimed: selection.claimed.map((ticket) => ticket.id),
    ready: selection.ready.map((ticket) => ticket.id),
    resolved: tickets
      .filter((ticket) => ticket.status === "resolved")
      .map((ticket) => ticket.id),
    blocked: tickets
      .filter((ticket) => ticket.status === "open" && !ticket.blockedBy.every(isResolved))
      .map((ticket) => ({
        id: ticket.id,
        waitingOn: ticket.blockedBy.filter((blocker) => !isResolved(blocker)),
      })),
  };
}

function parseArgs(argv) {
  const valueOf = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    quiet: argv.includes("--quiet"),
    json: argv.includes("--json"),
    noClaimed: argv.includes("--no-claimed"),
    status: valueOf("--status"),
    skip: valueOf("--skip"),
    issuesDir: valueOf("--issues-dir"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const issuesDir = args.issuesDir
    ? resolve(args.issuesDir)
    : resolve(scriptDir, "..", ".scratch", "discounts-implementation", "issues");

  let tickets;
  try {
    tickets = loadTickets(issuesDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  if (args.status) {
    const id = String(args.status).padStart(2, "0");
    const ticket = tickets.find((candidate) => candidate.id === id);
    if (!ticket) {
      console.error(`tiket ${id} tidak ada di ${issuesDir}`);
      process.exit(2);
    }
    console.log(ticket.status);
    return;
  }

  const options = {
    includeClaimed: !args.noClaimed,
    skip: args.skip ? args.skip.split(",").map((id) => id.trim()).filter(Boolean) : [],
  };

  if (args.json) {
    console.log(JSON.stringify(describePlan(tickets, options), null, 2));
    return;
  }

  const plan = describePlan(tickets, options);
  if (args.quiet) {
    if (plan.next) console.log(plan.next.file);
    return;
  }

  console.log(`claimed : ${plan.claimed.join(", ") || "-"}`);
  console.log(`ready   : ${plan.ready.join(", ") || "-"}`);
  console.log(`next    : ${plan.next?.id ?? "-"}`);
  if (plan.blocked.length > 0) {
    console.log(
      `blocked : ${plan.blocked
        .map((entry) => `${entry.id} (menunggu ${entry.waitingOn.join(", ")})`)
        .join("; ")}`
    );
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) main();
