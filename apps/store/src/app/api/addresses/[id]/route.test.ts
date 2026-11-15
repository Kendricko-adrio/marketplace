import { describe, expect, it, vi } from "vitest";

// =========================================================
// /api/addresses/[id] — seam wrapper `withRequestContext`
// =========================================================
// Fokus: argumen kedua (`context.params`) adalah promise yang diteruskan wrapper
// apa adanya, jadi handler tetap bisa `await params`. Boundary bersama
// `addressApi` diganti fake yang mencatat id + body yang diterimanya, sehingga
// terbukti tidak ada argumen yang hilang atau ditulis ulang oleh wrapper.
// Status/body response dan header `x-request-id` (module `store-address`)
// dikunci di sini.

const CLIENT_ID = "client-1";

const { sent } = vi.hoisted(() => ({
  sent: [] as Array<{ action: string; id: string; payload?: unknown }>,
}));

vi.mock("@/lib/address-api", () => ({
  addressApi: async (
    action: string,
    run: (
      book: {
        update: (userId: string, id: string, input: unknown) => Promise<unknown>;
        remove: (userId: string, id: string) => Promise<unknown>;
      },
      userId: string
    ) => Promise<unknown>
  ) => {
    const data = await run(
      {
        update: async (userId: string, id: string, input: unknown) => {
          sent.push({ action, id, payload: input });
          return { owner: userId, id, input };
        },
        remove: async (userId: string, id: string) => {
          sent.push({ action, id });
          return { owner: userId, removed: id };
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

import { DELETE, PATCH } from "./route";

type LogRecord = Record<string, unknown>;

const APP = "store";
const MODULE = "store-address";
const FIXED_FIELDS = ["app", "level", "message", "module", "requestId", "timestamp"];
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS_ID = "6f4a0b7e-2b2f-4f0f-9d3e-1c2b3a4d5e6f";

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

/** `context.params` sengaja promise, sama seperti yang dikirim Next.js. */
function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("/api/addresses/[id] wrapper", () => {
  it("PATCH: params promise dan body diteruskan apa adanya, requestId kanonik", async () => {
    sent.length = 0;
    const { captured, restore } = captureStdout();
    try {
      const input = { recipientName: "Budi", postalCode: "01234" };
      const request = new Request(
        `http://localhost/api/addresses/${ADDRESS_ID}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );

      const response = await PATCH(request, context(ADDRESS_ID));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        data: { owner: CLIENT_ID, id: ADDRESS_ID, input },
      });
      expect(sent).toEqual([
        { action: "update", id: ADDRESS_ID, payload: input },
      ]);

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("PATCH 200");
      expect(Object.keys(records[0]).sort()).toEqual(FIXED_FIELDS);
      expect(canonicalUuid(records[0].requestId)).toBe(requestId);
    } finally {
      restore();
    }
  });

  it("DELETE: id dari params sampai ke addressApi tanpa body", async () => {
    sent.length = 0;
    const { captured, restore } = captureStdout();
    try {
      const request = new Request(
        `http://localhost/api/addresses/${ADDRESS_ID}`,
        { method: "DELETE" }
      );

      const response = await DELETE(request, context(ADDRESS_ID));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        data: { owner: CLIENT_ID, removed: ADDRESS_ID },
      });
      expect(sent).toEqual([{ action: "remove", id: ADDRESS_ID }]);

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("DELETE 200");
      expect(canonicalUuid(records[0].requestId)).toBe(requestId);
    } finally {
      restore();
    }
  });
});
