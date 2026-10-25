import { describe, expect, it, vi } from "vitest";

// =========================================================
// /api/addresses/[id]/default — seam wrapper `withRequestContext`
// =========================================================
// Handler hanya membaca `params` (promise) dan tidak punya Request body.
// Test ini mengunci: id dari params sampai ke boundary `addressApi`, status/body
// response tidak diubah wrapper, dan satu baris completion module
// `store-address-default` memakai `requestId` yang sama dengan header.

const CLIENT_ID = "client-1";

const { sent } = vi.hoisted(() => ({
  sent: [] as Array<{ action: string; id: string }>,
}));

vi.mock("@/lib/address-api", () => ({
  addressApi: async (
    action: string,
    run: (
      book: {
        setDefault: (userId: string, id: string) => Promise<unknown>;
      },
      userId: string
    ) => Promise<unknown>
  ) => {
    const data = await run(
      {
        setDefault: async (userId: string, id: string) => {
          sent.push({ action, id });
          return { owner: userId, defaultId: id };
        },
      },
      CLIENT_ID
    );
    return new Response(JSON.stringify({ success: true, data: data ?? null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
}));

import { POST } from "./route";

type LogRecord = Record<string, unknown>;

const APP = "store";
const MODULE = "store-address-default";
const FIXED_FIELDS = ["app", "level", "message", "module", "requestId", "timestamp"];
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS_ID = "0b1c2d3e-4f50-4617-8899-aabbccddeeff";

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

describe("/api/addresses/[id]/default wrapper", () => {
  it("POST: id params diteruskan, response tidak berubah, requestId kanonik", async () => {
    sent.length = 0;
    const { captured, restore } = captureStdout();
    try {
      const request = new Request(
        `http://localhost/api/addresses/${ADDRESS_ID}/default`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ id: ADDRESS_ID }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        data: { owner: CLIENT_ID, defaultId: ADDRESS_ID },
      });
      expect(sent).toEqual([{ action: "set-default", id: ADDRESS_ID }]);

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("POST 200");
      expect(records[0].level).toBe("info");
      expect(Object.keys(records[0]).sort()).toEqual(FIXED_FIELDS);
      expect(canonicalUuid(records[0].requestId)).toBe(requestId);
    } finally {
      restore();
    }
  });
});
