import { describe, expect, it, vi } from "vitest";

// =========================================================
// lib/checkout-request — seam respons hasil checkout yang sudah diterima
// =========================================================
// Dikunci: `checkoutResultResponse` tidak lagi menerima logger (scope HTTP
// dibuka wrapper di route), header `x-request-id` kanonik tetap ada pada
// response, status 200/202/201 sesuai `replay`+`state`, body lama
// (success/data plus alias orderId+redirectUrl) tidak berubah, dan baris log
// memakai module `checkout-request` dengan requestId yang sama dengan header.
//
// Boundary DB diganti fake kosong: fungsi yang diuji hanya memetakan hasil
// bacaan tersimpan ke response, tidak menyentuh query.

vi.mock("@/db", () => ({
  db: {},
  checkoutRequests: {},
  orders: {},
  jubelioSalesOperations: {},
}));

import { checkoutResultResponse } from "./checkout-request";
import { withRequestContext } from "./logger";

type LogRecord = Record<string, unknown>;

type ResultState =
  | "payment_ready"
  | "processing"
  | "manual_review"
  | "paid"
  | "failed";

const APP = "store";
const MODULE = "checkout-request";

/** Envelope log tetap (skill maintainable-code §7.2). */
const FIXED_FIELDS = ["app", "level", "message", "module", "requestId", "timestamp"];

/** UUID kanonik (8-4-4-4-12 hex) — selalu dibuat server, bukan dari klien. */
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hasil bacaan tersimpan: bentuk yang sama dengan `readCheckoutResult`. */
function storedResult(state: ResultState) {
  return {
    requestKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    orderId: "11111111-1111-4111-8111-111111111111",
    state,
    paymentAvailable: state === "payment_ready",
    redirectUrl: state === "payment_ready" ? "https://snap.example/redirect" : null,
    expiresAt: "2026-10-23T08:30:45.123Z",
  };
}

/** Status publik: replay selalu 200, processing/manual_review 202, sisanya 201. */
const STATUS_CASES: Array<{
  label: string;
  replay: boolean;
  state: ResultState;
  status: number;
}> = [
  { label: "replay dari request key yang sama", replay: true, state: "payment_ready", status: 200 },
  { label: "state processing", replay: false, state: "processing", status: 202 },
  { label: "state manual_review", replay: false, state: "manual_review", status: 202 },
  { label: "state payment_ready", replay: false, state: "payment_ready", status: 201 },
  { label: "state paid", replay: false, state: "paid", status: 201 },
  { label: "state failed", replay: false, state: "failed", status: 201 },
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

describe("checkoutResultResponse", () => {
  for (const { label, replay, state, status } of STATUS_CASES) {
    it(`${label} memakai status ${status} dan body lama`, async () => {
      const result = storedResult(state);

      // Tanpa argumen logger: scope + header kanonik milik wrapper HTTP.
      const response = await withRequestContext(
        async () => checkoutResultResponse(result, replay),
        MODULE
      )();

      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toMatch(CANONICAL_UUID);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        success: true,
        data: result,
        orderId: result.orderId,
        redirectUrl: result.redirectUrl,
      });
    });
  }

  it("mencatat satu baris bisnis pada module checkout-request dengan requestId header", async () => {
    const result = storedResult("payment_ready");

    const { captured, restore } = captureStdout();
    try {
      const response = await withRequestContext(
        async () => checkoutResultResponse(result, false),
        MODULE
      )();

      const requestId = response.headers.get("x-request-id") ?? "";
      expect(requestId).toMatch(CANONICAL_UUID);

      const records = appRecords(captured);
      // Satu event bisnis + satu completion HTTP wrapper.
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(Object.keys(record).sort()).toEqual(FIXED_FIELDS);
        expect(record.requestId).toBe(requestId);
      }
      // Urutan ekspektasi mengikuti `.sort()` default (lexicographic):
      // "HTTP 201" (H=0x48) selalu sebelum "accepted ..." (a=0x61).
      expect(records.map((record) => record.message).sort()).toEqual([
        "HTTP 201",
        `accepted checkout result returned: order ${result.orderId}, state ${result.state}, replay false, status 201`,
      ]);
    } finally {
      restore();
    }
  });
});
