import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// =========================================================
// /api/onboarding/sync — seam wrapper `withRequestContext`
// =========================================================
// Route ini hanya melakukan redirect + cookie, tanpa log bisnis. Yang dikunci di
// sini: status 307, target redirect (termasuk `safeStoreRedirect` untuk
// callbackUrl tidak aman), dan cookie `client.onboarding` tetap apa adanya
// setelah wrapper menambahkan header `x-request-id` pada response redirect yang
// header-nya immutable. Satu baris completion module `onboarding-sync` harus
// memakai requestId yang sama dengan header.

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/public-url", () => ({
  getPublicAppUrl: () => "https://store.example.com",
}));

import { GET } from "./route";

type LogRecord = Record<string, unknown>;

const APP = "store";
const MODULE = "onboarding-sync";
const FIXED_FIELDS = ["app", "level", "message", "module", "requestId", "timestamp"];
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function canonicalUuid(value: unknown): string {
  expect(value).toMatch(CANONICAL_UUID);
  return value as string;
}

function syncRequest(search = ""): NextRequest {
  return new NextRequest(
    `https://store.example.com/api/onboarding/sync${search}`
  );
}

describe("/api/onboarding/sync wrapper", () => {
  it("tanpa session: 307 ke halaman login plus requestId kanonik", async () => {
    getSession.mockResolvedValueOnce(null);

    const { captured, restore } = captureStdout();
    try {
      const response = await GET(syncRequest());

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://store.example.com/login?callbackUrl=%2Fonboarding"
      );

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(1);
      expect(records[0].level).toBe("info");
      expect(records[0].message).toBe("GET 307");
      expect(Object.keys(records[0]).sort()).toEqual(FIXED_FIELDS);
      expect(canonicalUuid(records[0].requestId)).toBe(requestId);
    } finally {
      restore();
    }
  });

  it("onboarding belum selesai: 307 kembali ke /onboarding tanpa cookie", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "client-1", onboardingCompleted: false },
    });

    const response = await GET(syncRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://store.example.com/onboarding"
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("onboarding selesai: redirect ke callbackUrl aman dan cookie tetap utuh", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "client-1", onboardingCompleted: true },
    });

    const { captured, restore } = captureStdout();
    try {
      const response = await GET(syncRequest("?callbackUrl=%2Fcart%3Fstep%3D2"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://store.example.com/cart?step=2"
      );

      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("client.onboarding=1");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=604800");
      expect(cookie).toContain("SameSite=lax");
      expect(cookie).not.toContain("HttpOnly");

      const requestId = canonicalUuid(response.headers.get("x-request-id"));
      const records = appRecords(captured);
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("GET 307");
      expect(canonicalUuid(records[0].requestId)).toBe(requestId);
    } finally {
      restore();
    }
  });

  it("callbackUrl tidak aman tetap jatuh ke halaman utama (redirect tidak ditulis ulang)", async () => {
    getSession.mockResolvedValueOnce({
      user: { id: "client-1", onboardingCompleted: true },
    });

    const response = await GET(syncRequest("?callbackUrl=%2F%2Fevil.example.com"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://store.example.com/");
  });
});
