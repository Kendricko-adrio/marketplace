import { beforeEach, describe, expect, it, vi } from "vitest";

// =========================================================
// GET /api/admin/session-check — seam route status sesi admin
// =========================================================
// Dikunci: tanpa sesi → 200 + body unauthenticated lama; dengan sesi → 200 +
// body lama + flag `mustResetPassword` dari sesi; lookup gagal → tetap 200 +
// body unauthenticated (kontrak fail-open lama) tanpa membocorkan pesan /
// session / cookie asli ke log. Setiap response membawa `x-request-id` UUID
// canonical yang sama dengan requestId event bisnis + completion HTTP.
//
// `@/lib/auth` dan `next/headers` diganti mock; instance Better Auth, DB, dan
// request scope Next.js asli tidak pernah dievaluasi.

const { state, getSession, SESSION_FAILURE, COOKIE_MARKER } = vi.hoisted(() => ({
  state: { session: null as unknown, fail: false },
  getSession: vi.fn(),
  SESSION_FAILURE: "lookup gagal: cookie admin.session=rahasia-uji",
  COOKIE_MARKER: "rahasia-uji",
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-test-marker": "session-check" }),
}));

import { GET } from "./route";

type LogRecord = Record<string, unknown>;

const APP = "admin";
const MODULE = "admin-session-check";

/** Envelope log tetap (skill maintainable-code §7.2). */
const FIXED_FIELDS = ["app", "level", "message", "module", "requestId", "timestamp"];

/** UUID canonical (8-4-4-4-12 hex) — selalu dibuat server, bukan dari klien. */
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNAUTHENTICATED_BODY = { success: false, mustResetPassword: false, authenticated: false };

// Fixture sintetis (bukan sesi nyata): token/email/nama hanya penanda bahwa
// data mentah sesi tidak boleh muncul di log.
const SESSION = {
  session: { id: "sess-1", token: "token-sesi-rahasia", userId: "admin-1" },
  user: {
    id: "admin-1",
    email: "admin.uji@contoh.test",
    name: "Admin Uji",
    mustResetPassword: true,
  },
};

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

beforeEach(() => {
  state.session = null;
  state.fail = false;
  getSession.mockReset();
  getSession.mockImplementation(async () => {
    if (state.fail) {
      throw new Error(SESSION_FAILURE);
    }
    return state.session;
  });
});

describe("GET /api/admin/session-check", () => {
  it("tanpa sesi mengembalikan body unauthenticated lama plus header dan log berkorelasi", async () => {
    const { captured, restore } = captureStdout();
    try {
      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(UNAUTHENTICATED_BODY);

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(Object.keys(record).sort()).toEqual(FIXED_FIELDS);
        expect(record.level).toBe("info");
        expect(canonicalUuid(record.requestId)).toBe(requestId);
      }
      expect(records.map((record) => record.message).sort()).toEqual([
        "HTTP 200",
        "Session check: pengguna belum terautentikasi",
      ]);
    } finally {
      restore();
    }
  });

  it("dengan sesi mengembalikan flag mustResetPassword tanpa membocorkan data sesi", async () => {
    state.session = SESSION;

    const { captured, restore } = captureStdout();
    try {
      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        authenticated: true,
        mustResetPassword: true,
      });

      // Pemanggilan Better Auth tetap satu kali dengan `headers()` dari Next.
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(getSession).toHaveBeenCalledWith({
        headers: expect.any(Headers),
      });

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(Object.keys(record).sort()).toEqual(FIXED_FIELDS);
        expect(canonicalUuid(record.requestId)).toBe(requestId);
      }
      expect(records.map((record) => record.message).sort()).toEqual([
        "HTTP 200",
        "Session check: mustResetPassword=true",
      ]);

      const output = JSON.stringify(records);
      for (const secret of [
        "token-sesi-rahasia",
        "admin.uji@contoh.test",
        "Admin Uji",
      ]) {
        expect(output).not.toContain(secret);
      }
    } finally {
      restore();
    }
  });

  it("lookup gagal tetap 200 dengan body unauthenticated dan error yang dinormalisasi", async () => {
    state.fail = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { captured, restore } = captureStdout();
    try {
      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(UNAUTHENTICATED_BODY);

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(canonicalUuid(record.requestId)).toBe(requestId);
      }

      const failure = records.filter((record) => "error" in record);
      expect(failure).toHaveLength(1);
      expect(failure[0].level).toBe("error");
      expect(failure[0].message).toBe("Session check gagal");
      expect(Object.keys(failure[0]).sort()).toEqual(
        [...FIXED_FIELDS, "error"].sort()
      );
      expect(failure[0].error).toMatchObject({
        name: "SessionLookupError",
        message: "Session lookup unavailable",
      });

      const completion = records.filter((record) => !("error" in record));
      expect(completion).toHaveLength(1);
      expect(completion[0]).toMatchObject({ level: "info", message: "HTTP 200" });

      // Payload mentah auth/session/cookie tidak pernah masuk log.
      expect(captured.join("")).not.toContain(COOKIE_MARKER);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      restore();
      consoleError.mockRestore();
    }
  });
});
