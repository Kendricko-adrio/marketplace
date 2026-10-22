import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TicketGraphError,
  describePlan,
  loadTickets,
  normalizeStatus,
  parseBlockers,
  parseFrontmatter,
  selectNext,
} from "./ticket-next.mjs";

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function makeIssues(files) {
  const directory = mkdtempSync(join(tmpdir(), "ticket-next-"));
  temporaryDirectories.push(directory);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(directory, name), contents, "utf8");
  }
  return directory;
}

function ticket(id, { status = "open", blockedBy = "none", answer = "" } = {}) {
  return [
    `# ${id} — fixture`,
    "",
    "Label: ready-for-agent",
    "Type: task",
    `Status: ${status}`,
    "Assignee: none",
    `Blocked by: ${blockedBy}`,
    "",
    "## Perilaku yang dibangun",
    "Fixture.",
    answer,
    "",
  ].join("\n");
}

describe("parseFrontmatter", () => {
  it("berhenti di heading ## pertama sehingga Status di Answer tidak terbaca", () => {
    const text = [
      "# 07 — x",
      "",
      "Status: claimed",
      "Blocked by: 03, 06",
      "",
      "## Answer",
      "Status: resolved.",
    ].join("\n");
    expect(parseFrontmatter(text)).toEqual({
      Status: "claimed",
      "Blocked by": "03, 06",
    });
  });
});

describe("normalizeStatus", () => {
  it("menormalkan penanda bold dan kalimat setelah status", () => {
    expect(normalizeStatus("resolved")).toBe("resolved");
    expect(normalizeStatus("**resolved** untuk scope 06")).toBe("resolved");
    expect(normalizeStatus("resolved. Implementasi dipindahkan")).toBe("resolved");
    expect(normalizeStatus("Claimed")).toBe("claimed");
    expect(normalizeStatus("")).toBe("");
  });
});

describe("parseBlockers", () => {
  it("memperlakukan none dan kosong sebagai tanpa blocker", () => {
    expect(parseBlockers("none")).toEqual([]);
    expect(parseBlockers("None")).toEqual([]);
    expect(parseBlockers("")).toEqual([]);
    expect(parseBlockers(undefined)).toEqual([]);
  });

  it("memecah daftar, menormalkan nomor, dan membuang spasi", () => {
    expect(parseBlockers("03, 06")).toEqual(["03", "06"]);
    expect(parseBlockers("1, 12")).toEqual(["01", "12"]);
  });
});

describe("selectNext", () => {
  it("mendahulukan tiket claimed sebelum open yang ready", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { status: "resolved" }),
      "02-b.md": ticket("02", { status: "claimed", blockedBy: "01" }),
      "03-c.md": ticket("03"),
    });
    const { next } = selectNext(loadTickets(directory));
    expect(next.id).toBe("02");
  });

  it("memilih open bernomor terkecil yang seluruh blocker-nya resolved", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { status: "resolved" }),
      "02-b.md": ticket("02", { blockedBy: "01" }),
      "03-c.md": ticket("03"),
    });
    const { next } = selectNext(loadTickets(directory));
    expect(next.id).toBe("02");
  });

  it("mengabaikan open yang blocker-nya belum resolved", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01"),
      "02-b.md": ticket("02", { blockedBy: "01" }),
    });
    const { next } = selectNext(loadTickets(directory));
    expect(next.id).toBe("01");
  });

  it("menghormati --no-claimed", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { status: "resolved" }),
      "02-b.md": ticket("02", { status: "claimed", blockedBy: "01" }),
      "03-c.md": ticket("03"),
    });
    const { next } = selectNext(loadTickets(directory), { includeClaimed: false });
    expect(next.id).toBe("03");
  });

  it("menghormati daftar skip", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { status: "resolved" }),
      "02-b.md": ticket("02", { blockedBy: "01" }),
      "03-c.md": ticket("03", { blockedBy: "01" }),
    });
    const { next } = selectNext(loadTickets(directory), { skip: ["02"] });
    expect(next.id).toBe("03");
  });

  it("mengembalikan null ketika tidak ada tiket ready", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { status: "open" }),
      "02-b.md": ticket("02", { blockedBy: "01" }),
    });
    const tickets = loadTickets(directory).map((entry) =>
      entry.id === "01" ? { ...entry, status: "claimed" } : entry
    );
    expect(selectNext(tickets, { includeClaimed: false }).next).toBe(null);
  });
});

describe("loadTickets", () => {
  it("menolak blocker yang tidak ada", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { blockedBy: "99" }),
    });
    expect(() => loadTickets(directory)).toThrow(TicketGraphError);
    expect(() => loadTickets(directory)).toThrow(/blocker "99" tidak ada/);
  });

  it("menolak siklus blocker", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { blockedBy: "02" }),
      "02-b.md": ticket("02", { blockedBy: "01" }),
    });
    expect(() => loadTickets(directory)).toThrow(/siklus blocker/);
  });

  it("menolak status yang tidak dikenal", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { status: "blocked" }),
    });
    expect(() => loadTickets(directory)).toThrow(/status tidak dikenal/);
  });
});

describe("describePlan", () => {
  it("melaporkan blocker yang masih ditunggu", () => {
    const directory = makeIssues({
      "01-a.md": ticket("01", { status: "resolved" }),
      "02-b.md": ticket("02", { blockedBy: "01" }),
      "03-c.md": ticket("03", { blockedBy: "04" }),
      "04-d.md": ticket("04", { status: "resolved" }),
      "05-e.md": ticket("05", { blockedBy: "03, 04" }),
    });
    const plan = describePlan(loadTickets(directory));
    expect(plan.next.id).toBe("02");
    expect(plan.ready).toEqual(["02", "03"]);
    expect(plan.blocked).toEqual([{ id: "05", waitingOn: ["03"] }]);
    expect(plan.resolved).toEqual(["01", "04"]);
  });
});
