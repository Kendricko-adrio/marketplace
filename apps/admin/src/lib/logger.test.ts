import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import * as logging from "./logger";

/**
 * Seam publik facade logging app (`apps/admin/src/lib/logger.ts`, dipakai kode
 * produksi sebagai `@/lib/logger`).
 *
 * Fokus test ini adalah wiring facade app — bukan mengulang kasus-kasus core
 * `@marketplace/logging`:
 *
 * 1. Facade mengekspos API target: `createModuleLogger`, `withRequestContext`,
 *    `getRequestId`, `withExecutionContext`, `withDetachedExecutionContext`.
 * 2. Root logger adalah satu instance milik runtime app ini, dibuat saat module
 *    dievaluasi (sebelum test menyentuh stdout) dan menulis ke stdout proses.
 *    Correlation dibaca dinamis per scope, tidak di-bind saat logger dibuat.
 * 3. Module logger yang dibuat **sebelum** scope apa pun tetap menulis
 *    `requestId` milik request yang sedang aktif, dan `app` selalu label app ini.
 * 4. Dua request concurrent dengan incoming `x-request-id` yang sama tetap
 *    mendapat UUID canonical berbeda; header response = body = `requestId` log.
 *
 * Expected value diambil dari kontrak format log (skill maintainable-code §7.2
 * serta `docs/architecture/code-organization.md`), bukan dari implementasi core.
 * Sink yang di-spy adalah stdout proses — output publik yang juga dipakai
 * produksi — bukan internal logger/core.
 *
 * Test ini RED selama facade app belum mengekspos API target: `logger.ts` masih
 * berupa logger lama, sehingga property di bawah `undefined` saat runtime.
 */

type LogRecord = Record<string, unknown>;

/** Label app milik runtime ini; satu-satunya nilai `app` yang sah di sini. */
const EXPECTED_APP = "admin";

/** Module marker: nama module logger yang diuji. */
const MODULE = "orders-service";

/** Marker bisnis unik supaya hanya line test ini yang ikut dihitung. */
const RUN_MARKER = "facade-red-admin";

/** Field tetap kontrak log (skill maintainable-code §7.2), sudah terurut. */
const FIXED_FIELDS = [
  "app",
  "level",
  "message",
  "module",
  "requestId",
  "timestamp",
];

/** Bentuk UUID canonical (8-4-4-4-12 hex). */
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 UTC dengan milidetik, mis. 2026-10-23T08:30:45.123Z */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Barrier (bukan sleep): setiap pihak menunggu gate yang sama, dibuka saat
 * pihak terakhir masuk. Interleaving jadi deterministik tanpa bergantung waktu.
 */
function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async function arrive(): Promise<void> {
    arrived += 1;
    if (arrived === parties) {
      release();
    }
    await gate;
  };
}

/**
 * Hanya line application log milik test ini yang dihitung: JSON valid, `app`
 * milik runtime ini, module marker, dan pesan yang memuat marker bisnis unik.
 * Tulisan reporter stdout (non-JSON) atau line app lain tidak termasuk.
 */
function applicationRecords(captured: string[]): LogRecord[] {
  const records: LogRecord[] = [];
  for (const line of captured.join("").split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
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
    if (record.app !== EXPECTED_APP || record.module !== MODULE) {
      continue;
    }
    const message = record.message;
    if (typeof message !== "string" || !message.includes(RUN_MARKER)) {
      continue;
    }
    records.push(record);
  }
  return records;
}

/** `requestId` wajib UUID canonical; nilai lain langsung menggagalkan test. */
function canonicalUuid(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("requestId bukan string UUID canonical");
  }
  expect(value).toMatch(CANONICAL_UUID);
  return value;
}

async function readJsonBody(response: Response): Promise<LogRecord> {
  return (await response.json()) as LogRecord;
}

describe("facade logging app (satu root instance per runtime app)", () => {
  it("memakai root app yang sudah dibuat saat import dengan requestId dinamis per request concurrent", async () => {
    const captured: string[] = [];

    // Sink eksternal = stdout proses. Root logger facade sudah dibuat saat
    // module diimpor (sebelum spy ini dipasang), jadi line yang tertangkap di
    // sini membuktikan tujuan tulis dibaca saat log ditulis dan correlation
    // dibaca dinamis per scope.
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        captured.push(
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
        );
        return true;
      });

    try {
      // API target facade app.
      expect(typeof logging.createModuleLogger).toBe("function");
      expect(typeof logging.withRequestContext).toBe("function");
      expect(typeof logging.getRequestId).toBe("function");
      expect(typeof logging.withExecutionContext).toBe("function");
      expect(typeof logging.withDetachedExecutionContext).toBe("function");

      // Module logger dibuat sekali di module scope: sebelum scope apa pun.
      const log = logging.createModuleLogger(MODULE);

      // Di luar scope HTTP tidak ada identitas palsu.
      expect(logging.getRequestId()).toBeNull();
      // Scope eksekusi non-HTTP tidak membawa requestId HTTP.
      expect(
        logging.withExecutionContext(() => logging.getRequestId())
      ).toBeNull();
      expect(
        logging.withDetachedExecutionContext(() => logging.getRequestId())
      ).toBeNull();

      const bothStarted = createBarrier(2);
      const incomingRequestId = "kiriman-klien-sama-untuk-kedua-request";
      const querySecret = "tok-facade-rahasia-01";

      /** Kunci bisnis per request, dibaca dari input HTTP (bukan untuk log URL). */
      function orderKeyOf(request: NextRequest): string {
        const order = request.headers.get("x-test-order");
        if (order === null) {
          throw new Error("request uji tanpa header x-test-order");
        }
        return `${RUN_MARKER}-${order}`;
      }

      const handler = logging.withRequestContext(async (request: NextRequest) => {
        const requestIdAtEntry = logging.getRequestId();
        const orderKey = orderKeyOf(request);
        log.info(`Order ${orderKey} diproses`);
        // Kedua request harus sama-sama masih di dalam scope sebelum salah
        // satunya selesai — kondisi "concurrent" yang diuji.
        await bothStarted();
        log.info(`Order ${orderKey} selesai`);
        return NextResponse.json({
          orderKey,
          requestId: requestIdAtEntry,
        });
      });

      const createRequest = (order: string): NextRequest =>
        new NextRequest(
          `http://localhost:3001/api/admin/orders?token=${querySecret}&order=${order}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-request-id": incomingRequestId,
              "x-test-order": order,
            },
            body: JSON.stringify({ catatan: RUN_MARKER }),
          }
        );

      const [responseA, responseB] = await Promise.all([
        handler(createRequest("a")),
        handler(createRequest("b")),
      ]);

      // Scope tertutup sesudah invocation selesai.
      expect(logging.getRequestId()).toBeNull();

      const headerA = canonicalUuid(responseA.headers.get("x-request-id"));
      const headerB = canonicalUuid(responseB.headers.get("x-request-id"));

      // Identitas canonical selalu dibuat server, unik per invocation, walau
      // kedua request membawa incoming `x-request-id` yang sama persis.
      expect(headerA).not.toBe(headerB);
      expect(headerA).not.toBe(incomingRequestId);
      expect(headerB).not.toBe(incomingRequestId);

      const bodyA = await readJsonBody(responseA);
      const bodyB = await readJsonBody(responseB);
      expect(bodyA.orderKey).toBe(`${RUN_MARKER}-a`);
      expect(bodyB.orderKey).toBe(`${RUN_MARKER}-b`);
      expect(bodyA.requestId).toBe(headerA);
      expect(bodyB.requestId).toBe(headerB);

      // Tulisan reporter stdout (non-JSON) dan JSON milik app lain bukan
      // application log app ini: keduanya harus tersaring.
      process.stdout.write("laporan reporter vitest, bukan application log\n");
      process.stdout.write(
        `${JSON.stringify({
          app: "core-diagnostic",
          module: MODULE,
          message: `Order ${RUN_MARKER}-luar-app diproses`,
        })}\n`
      );

      const records = applicationRecords(captured);
      expect(records).toHaveLength(4);

      for (const record of records) {
        expect(Object.keys(record).sort()).toEqual(FIXED_FIELDS);
        expect(record.app).toBe(EXPECTED_APP);
        expect(record.level).toBe("info");
        expect(record.module).toBe(MODULE);
        expect(String(record.timestamp)).toMatch(ISO_UTC);
        canonicalUuid(record.requestId);
      }

      const forOrder = (orderKey: string): LogRecord[] =>
        records.filter((record) => String(record.message).includes(orderKey));

      const recordsA = forOrder(`${RUN_MARKER}-a`);
      const recordsB = forOrder(`${RUN_MARKER}-b`);
      expect(recordsA).toHaveLength(2);
      expect(recordsB).toHaveLength(2);

      // Stabil per request: semua line request A memakai satu ID yang sama, dan
      // ID itu sama dengan header + body response.
      const idsA = recordsA.map((record) => canonicalUuid(record.requestId));
      const idsB = recordsB.map((record) => canonicalUuid(record.requestId));
      expect(new Set(idsA).size).toBe(1);
      expect(new Set(idsB).size).toBe(1);
      const [idA] = idsA;
      const [idB] = idsB;
      expect(idA).toBe(headerA);
      expect(idB).toBe(headerB);
      expect(idA).not.toBe(idB);

      // Kedua request memulai sebelum salah satu berakhir.
      const messages = records.map((record) => String(record.message));
      expect(new Set(messages).size).toBe(4);
      expect(messages.indexOf(`Order ${RUN_MARKER}-a selesai`)).toBeGreaterThan(
        messages.indexOf(`Order ${RUN_MARKER}-b diproses`)
      );
      expect(messages.indexOf(`Order ${RUN_MARKER}-b selesai`)).toBeGreaterThan(
        messages.indexOf(`Order ${RUN_MARKER}-a diproses`)
      );

      // Tanpa raw URL/query maupun identitas incoming di output log.
      for (const record of records) {
        expect(String(record.message)).not.toContain("http");
        expect(String(record.message)).not.toContain(querySecret);
      }
      const output = captured.join("");
      expect(output).not.toContain(incomingRequestId);
      expect(output).not.toContain(querySecret);
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
