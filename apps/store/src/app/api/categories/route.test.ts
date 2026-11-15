import { describe, expect, it, vi } from "vitest";

// =========================================================
// GET /api/categories — seam route daftar kategori aktif
// =========================================================
// Dikunci: body/status lama apa adanya (sukses 200 dan gagal 500), header
// `x-request-id` UUID canonical di kedua response, dan output log publik
// (stdout proses) module `categories-route` yang memakai requestId sama dengan
// header — satu event bisnis + satu completion HTTP, tanpa field bisnis
// tambahan dan tanpa baris data.
//
// Boundary DB diganti fake berantai `select → from → where → orderBy`; tabel
// `categories` tetap schema asli karena `eq(categories.isActive, true)` butuh
// kolom sungguhan. `@/db` asli (Pool pg) tidak pernah dievaluasi.

const { state, DB_FAILURE } = vi.hoisted(() => ({
  state: { rows: [] as unknown[], fail: false },
  DB_FAILURE: "koneksi database uji gagal",
}));

vi.mock("@/db", async () => {
  const { categories } = await import("@marketplace/db/src/schema/products");
  return {
    categories,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => {
              if (state.fail) {
                throw new Error(DB_FAILURE);
              }
              return state.rows;
            },
          }),
        }),
      }),
    },
  };
});

import { GET } from "./route";

type LogRecord = Record<string, unknown>;

const APP = "store";
const MODULE = "categories-route";

/** Envelope log tetap (skill maintainable-code §7.2). */
const FIXED_FIELDS = ["app", "level", "message", "module", "requestId", "timestamp"];

/** UUID canonical (8-4-4-4-12 hex) — selalu dibuat server, bukan dari klien. */
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fixture sintetis: baris DB memakai Date, body JSON memakai ISO string.
const CATEGORY_ROWS = [
  { id: "cat-1", name: "Sepatu Lari", slug: "sepatu-lari", isActive: true, createdAt: new Date("2026-02-03T04:05:06.700Z") },
  { id: "cat-2", name: "Tas Punggung", slug: "tas-punggung", isActive: true, createdAt: new Date("2026-02-04T05:06:07.800Z") },
];

const CATEGORY_BODY = [
  { id: "cat-1", name: "Sepatu Lari", slug: "sepatu-lari", isActive: true, createdAt: "2026-02-03T04:05:06.700Z" },
  { id: "cat-2", name: "Tas Punggung", slug: "tas-punggung", isActive: true, createdAt: "2026-02-04T05:06:07.800Z" },
];

/** Sink eksternal: stdout proses, bukan internal logger/core. */
function captureStdout(): { captured: string[]; restore: () => void } {
  const captured: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array): boolean => {
      captured.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
      );
      return true;
    }
  );
  return { captured, restore: () => spy.mockRestore() };
}

/** Hanya line application log milik app + module ini. */
function appRecords(captured: string[]): LogRecord[] {
  const records: LogRecord[] = [];
  for (const line of captured.join("").split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) {
      continue;
    }
    const record = parsed as LogRecord;
    if (record.app === APP && record.module === MODULE) {
      records.push(record);
    }
  }
  return records;
}

/** requestId wajib UUID canonical; nilai lain langsung menggagalkan test. */
function canonicalUuid(value: unknown): string {
  expect(value).toMatch(CANONICAL_UUID);
  return value as string;
}

describe("GET /api/categories", () => {
  it("mengembalikan body sukses apa adanya plus header dan log yang berkorelasi", async () => {
    state.rows = CATEGORY_ROWS;
    state.fail = false;

    const { captured, restore } = captureStdout();
    try {
      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, data: CATEGORY_BODY });

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      // Satu event bisnis + satu completion HTTP — tidak ada stack ganda.
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(Object.keys(record).sort()).toEqual(FIXED_FIELDS);
        expect(record.level).toBe("info");
        expect(canonicalUuid(record.requestId)).toBe(requestId);
      }
      expect(records.map((record) => record.message).sort()).toEqual([
        "HTTP 200",
        "Kategori aktif dimuat: 2",
      ]);

      // Baris data kategori tidak ikut masuk log.
      expect(JSON.stringify(records)).not.toContain("cat-1");
    } finally {
      restore();
    }
  });

  it("mengembalikan 500 body lama dan mencatat kegagalan pada requestId yang sama", async () => {
    state.rows = [];
    state.fail = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { captured, restore } = captureStdout();
    try {
      const response = await GET();

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        success: false,
        error: "Failed to fetch categories",
      });

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(record.level).toBe("error");
        expect(canonicalUuid(record.requestId)).toBe(requestId);
      }

      const business = records.filter((record) => "error" in record);
      expect(business).toHaveLength(1);
      expect(business[0].message).toBe("Kategori gagal dimuat");
      expect(Object.keys(business[0]).sort()).toEqual(
        [...FIXED_FIELDS, "error"].sort()
      );
      expect((business[0].error as LogRecord).message).toBe(DB_FAILURE);

      const completion = records.filter((record) => !("error" in record));
      expect(completion).toHaveLength(1);
      expect(completion[0].message).toBe("HTTP 500");

      // console.error lama tidak dipakai lagi.
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
      consoleError.mockRestore();
    }
  });
});
