import { describe, expect, it, vi } from "vitest";

// =========================================================
// /api/addresses — seam wrapper `withRequestContext`
// =========================================================
// Boundary bersama `addressApi` diganti fake yang langsung menjalankan callback
// route, sehingga test ini mengunci tiga hal: (1) `Request` (dan body JSON-nya)
// sampai ke callback apa adanya, (2) status + body response tidak diubah
// wrapper, (3) response membawa header `x-request-id` kanonik dan baris
// completion module `store-addresses` memakai requestId yang sama. Route ini
// tidak punya log bisnis sendiri — logging bisnis tetap milik `client-addresses`.

const CLIENT_ID = "client-1";

const { sent } = vi.hoisted(() => ({
  sent: [] as Array<{
    action: string;
    payload: unknown;
    requestKey?: string;
    context?: string;
  }>,
}));

vi.mock("@/lib/address-api", () => ({
  addressApi: async (
    action: string,
    run: (
      book: {
        list: (userId: string) => Promise<unknown>;
        create: (
          userId: string,
          input: unknown,
          options?: { requestKey?: string }
        ) => Promise<unknown>;
      },
      userId: string,
      context: { requestKey?: string }
    ) => Promise<unknown>,
    request?: Request
  ) => {
    // Route only forwards the header; the boundary owns normalization.
    expect(request === undefined || request instanceof Request).toBe(true);
    const headerKey = request?.headers.get("idempotency-key") ?? undefined;
    const context: { requestKey?: string } =
      headerKey === undefined ? {} : { requestKey: headerKey };
    const data = await run(
      {
        list: async (userId: string) => ({ owner: userId, addresses: [] }),
        create: async (
          userId: string,
          input: unknown,
          options?: { requestKey?: string }
        ) => {
          sent.push({ action, payload: input, requestKey: options?.requestKey, context: context.requestKey });
          return { owner: userId, input, requestKey: options?.requestKey };
        },
      },
      CLIENT_ID,
      context
    );
    return new Response(JSON.stringify({ success: true, data: data ?? null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
}));

import { GET, POST } from "./route";

type LogRecord = Record<string, unknown>;

const APP = "store";
const MODULE = "store-addresses";
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

/** Request POST sederhana; body JSON dibaca oleh handler, bukan oleh wrapper. */
function createRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/addresses", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("/api/addresses wrapper", () => {
  it("GET: body/status apa adanya, header x-request-id, satu baris completion", async () => {
    sent.length = 0;
    const { captured, restore } = captureStdout();
    try {
      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        data: { owner: CLIENT_ID, addresses: [] },
      });

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      // GET dideklarasikan tanpa argumen, jadi label method jatuh ke "HTTP".
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("HTTP 200");
      expect(records[0].level).toBe("info");
      expect(Object.keys(records[0]).sort()).toEqual(FIXED_FIELDS);
      expect(canonicalUuid(records[0].requestId)).toBe(requestId);
    } finally {
      restore();
    }
  });

  it("POST: body JSON diteruskan ke addressApi dan request diberi requestId", async () => {
    sent.length = 0;
    const { captured, restore } = captureStdout();
    try {
      const input = { recipientName: "Budi", phone: "+628111111111" };
      const response = await POST(createRequest(input));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        data: { owner: CLIENT_ID, input },
      });
      expect(sent).toEqual([
        { action: "create", payload: input, requestKey: undefined, context: undefined },
      ]);

      const requestId = canonicalUuid(response.headers.get("x-request-id"));

      const records = appRecords(captured);
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("POST 200");
      expect(canonicalUuid(records[0].requestId)).toBe(requestId);
    } finally {
      restore();
    }
  });

  it("meneruskan header Idempotency-Key dan request ke boundary create", async () => {
    sent.length = 0;
    const input = { recipientName: "Budi", phone: "+628111111111" };
    const key = "b1200000-0000-4000-8000-0000000000aa";
    const response = await POST(createRequest(input, { "Idempotency-Key": key }));
    expect(response.status).toBe(200);
    expect(sent).toEqual([
      { action: "create", payload: input, requestKey: key, context: key },
    ]);
  });

  it("memberi requestId berbeda untuk dua request dan tidak meneruskan requestId klien", async () => {
    const first = await GET();
    const second = await GET();
    const firstId = canonicalUuid(first.headers.get("x-request-id"));
    const secondId = canonicalUuid(second.headers.get("x-request-id"));
    expect(firstId).not.toBe(secondId);

    const incoming = await POST(
      new Request("http://localhost/api/addresses", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "client-supplied" },
        body: JSON.stringify({ recipientName: "Sari" }),
      })
    );
    expect(canonicalUuid(incoming.headers.get("x-request-id"))).not.toBe(
      "client-supplied"
    );
  });
});
