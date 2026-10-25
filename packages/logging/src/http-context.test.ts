import { describe, expect, it } from "vitest";

import { createLogging, type Logging } from "./index";

/**
 * Seam publik HTTP core (`@marketplace/logging`) → response Web standar plus
 * line log yang ditangkap sink test.
 *
 * Kontrak (plan/maintainable-code-and-contextual-logging.md §6.4 dan §8C):
 *
 * 1. `withRequestContext(handler, module?)` membuka tepat satu scope
 *    `AsyncLocalStorage` per invocation, dengan UUID canonical yang **selalu
 *    dibuat server** — incoming `x-request-id` tidak dipakai sebagai identitas.
 * 2. Response yang dikembalikan handler diberi header `x-request-id` berisi ID
 *    yang sama dengan seluruh line log di scope tersebut.
 * 3. Satu event completion ditulis otomatis: `info` saat status < 400, `warn`
 *    saat 4xx, `error` saat 5xx; message hanya memuat method + status, tanpa raw
 *    URL/query/body.
 * 4. Handler dipanggil dengan argument yang diteruskan utuh (termasuk
 *    `context.params` berupa Promise dinamis milik framework), dan response
 *    (status/header/cookie/body/redirect) diteruskan apa adanya. Body response
 *    tidak dibaca wrapper.
 * 5. Exception dilempar ulang sebagai object yang identik setelah dicatat di
 *    dalam context request; tidak ada response pengganti dan context bersih
 *    sesudahnya.
 *
 * Fixture memakai `Request`/`Response` Web standar karena core tidak mengimpor
 * Next.js. Assertion bersifat literal/observable pada response dan output log —
 * bukan spy terhadap `AsyncLocalStorage` atau collaborator logger internal.
 *
 * Sejak slice implementasi mendarat, test ini memakai kontrak publik `Logging`
 * apa adanya — tanpa interface maupun cast sementara — dan menjadi gate hijau
 * untuk seam tersebut.
 */

type LogRecord = Record<string, unknown>;

// Bentuk UUID canonical (8-4-4-4-12 hex) — sumber kebenaran: kontrak requestId
// di plan/maintainable-code-and-contextual-logging.md §6.3/§6.4 ("UUID
// canonical dibuat server"), bukan bentuk internal implementasi.
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_HTTP_MODULE = "http";

/** Root logger test dengan sink line yang bisa dibaca sebagai output JSON. */
function createHttpLogging(app: "store" | "admin"): {
  logging: Logging;
  lines: string[];
} {
  const lines: string[] = [];
  const logging = createLogging({
    app,
    level: "info",
    destination: {
      write(line: string) {
        lines.push(line);
      },
    },
  });
  return { logging, lines };
}

function parseRecords(lines: string[]): LogRecord[] {
  return lines
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogRecord);
}

function recordFor(records: LogRecord[], message: string): LogRecord {
  const found = records.filter((record) => record.message === message);
  if (found.length !== 1) {
    throw new Error(
      `record log ${message}: diharapkan tepat satu, ditemukan ${found.length}`
    );
  }
  return found[0];
}

/**
 * Completion event tidak diikat ke teks message tertentu (implementasi bebas
 * memilih frasa), jadi record dicari lewat module + status di message.
 */
function completionFor(
  records: LogRecord[],
  module: string,
  status: string
): LogRecord {
  const found = records.filter(
    (record) =>
      record.module === module && String(record.message).includes(status)
  );
  if (found.length !== 1) {
    throw new Error(
      `completion ${status} module ${module}: diharapkan tepat satu, ditemukan ${found.length}`
    );
  }
  return found[0];
}

/** UUID canonical wajib berbentuk string; dikembalikan agar bisa dipakai lagi. */
function expectCanonicalUuid(value: unknown): string {
  expect(typeof value).toBe("string");
  expect(value as string).toMatch(CANONICAL_UUID);
  return value as string;
}

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

describe("HTTP request context public contract", () => {
  it("memakai satu UUID canonical per invocation di log module, body, dan header response — dua request concurrent dengan incoming ID sama tetap berbeda", async () => {
    const { logging, lines } = createHttpLogging("store");

    // Module logger dibuat sekali, sebelum request mana pun: korelasi dibaca
    // saat log ditulis, bukan saat logger dibuat.
    const ordersLog = logging.createModuleLogger("orders-service");

    // Di luar scope HTTP tidak ada identitas palsu.
    expect(logging.getRequestId()).toBeNull();

    const bothStarted = createBarrier(2);
    const incomingRequestId = "kiriman-klien-sama-untuk-kedua-request";
    const querySecret = "tok-uji-rahasia-01";
    const bodyMarker = "body-order-tidak-boleh-masuk-log";

    function createHandler(label: "A" | "B", status: number) {
      return logging.withRequestContext(
        async (request: Request) => {
          const requestIdAtEntry = logging.getRequestId();
          ordersLog.info(`${label}:start`);
          // Kedua request harus sama-sama masih di dalam scope sebelum salah
          // satunya selesai — kondisi "concurrent" yang diuji.
          await bothStarted();
          ordersLog.info(`${label}:end`);
          return Response.json(
            { label, method: request.method, requestId: requestIdAtEntry },
            { status, headers: { "cache-control": "no-store" } }
          );
        },
        "orders-route"
      );
    }

    const handlerA = createHandler("A", 201);
    const handlerB = createHandler("B", 422);

    const createRequest = () =>
      new Request(
        `https://contoh.test/api/orders?token=${querySecret}&branch=JKT-01`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": incomingRequestId,
          },
          body: JSON.stringify({ catatan: bodyMarker }),
        }
      );

    const [responseA, responseB] = await Promise.all([
      handlerA(createRequest()),
      handlerB(createRequest()),
    ]);

    // Scope tertutup sesudah invocation selesai.
    expect(logging.getRequestId()).toBeNull();
    ordersLog.info("process:after");

    // Status bisnis tidak diubah wrapper.
    expect(responseA.status).toBe(201);
    expect(responseB.status).toBe(422);

    const headerA = expectCanonicalUuid(responseA.headers.get("x-request-id"));
    const headerB = expectCanonicalUuid(responseB.headers.get("x-request-id"));

    // Identitas canonical selalu dibuat server dan unik per invocation, walau
    // kedua request membawa incoming `x-request-id` yang sama persis.
    expect(headerA).not.toBe(headerB);
    expect(headerA).not.toBe(incomingRequestId);
    expect(headerB).not.toBe(incomingRequestId);

    // Body response memakai ID yang sama dengan header response.
    const bodyA = (await responseA.json()) as LogRecord;
    const bodyB = (await responseB.json()) as LogRecord;
    expect(bodyA.label).toBe("A");
    expect(bodyB.label).toBe("B");
    expect(bodyA.method).toBe("POST");
    expect(bodyA.requestId).toBe(headerA);
    expect(bodyB.requestId).toBe(headerB);

    const records = parseRecords(lines);
    const messages = records.map((record) => String(record.message));
    const at = (message: string) => messages.indexOf(message);

    // Empat log module + dua completion + satu log process sesudahnya.
    expect(records).toHaveLength(7);
    expect(messages[6]).toBe("process:after");

    // Kedua request memulai sebelum salah satu berakhir.
    expect(at("A:start")).toBeGreaterThanOrEqual(0);
    expect(at("B:start")).toBeGreaterThanOrEqual(0);
    expect(at("A:start")).toBeLessThan(at("A:end"));
    expect(at("A:start")).toBeLessThan(at("B:end"));
    expect(at("B:start")).toBeLessThan(at("B:end"));
    expect(at("B:start")).toBeLessThan(at("A:end"));

    // Log module yang dibuat sebelum request ikut scope request masing-masing.
    for (const record of [
      recordFor(records, "A:start"),
      recordFor(records, "A:end"),
    ]) {
      expect(record.module).toBe("orders-service");
      expect(record.requestId).toBe(headerA);
    }
    for (const record of [
      recordFor(records, "B:start"),
      recordFor(records, "B:end"),
    ]) {
      expect(record.module).toBe("orders-service");
      expect(record.requestId).toBe(headerB);
    }

    // Completion otomatis: level mengikuti status, ID mengikuti scope request.
    const completionA = completionFor(records, "orders-route", "201");
    expect(completionA.level).toBe("info");
    expect(completionA.requestId).toBe(headerA);
    expect(String(completionA.message)).toContain("POST");

    const completionB = completionFor(records, "orders-route", "422");
    expect(completionB.level).toBe("warn");
    expect(completionB.requestId).toBe(headerB);
    expect(String(completionB.message)).toContain("POST");

    // Completion hanya memuat method + status: tanpa raw URL/query/body.
    for (const completion of [completionA, completionB]) {
      expect(String(completion.message)).not.toContain("https://");
      expect(String(completion.message)).not.toContain("token=");
    }
    const output = lines.join("");
    expect(output).not.toContain(querySecret);
    expect(output).not.toContain(bodyMarker);
    expect(output).not.toContain(incomingRequestId);
  });

  it("meneruskan argument dinamis (context.params Promise) dan response apa adanya tanpa membaca body-nya", async () => {
    const { logging, lines } = createHttpLogging("store");

    const cacheControl = "private, max-age=60, stale-while-revalidate=30";
    const branchHeader = "JKT-01";
    const firstCookie = "cart=abc123; Path=/; HttpOnly";
    const secondCookie = "branch=JKT-01; Path=/; SameSite=Lax";
    const requestBodyMarker = "body-permintaan-tidak-dibaca";

    // Tanpa argumen module: completion memakai module default `http`.
    const handler = logging.withRequestContext(
      async (
        request: Request,
        context: { params: Promise<{ orderId: string }> }
      ) => {
        // `params` adalah Promise dinamis milik framework; wrapper meneruskan
        // object context utuh, bukan menyelesaikan promise-nya lebih dulu.
        const params = await context.params;

        const responseHeaders = new Headers();
        responseHeaders.append("content-type", "application/json");
        responseHeaders.append("cache-control", cacheControl);
        responseHeaders.append("x-branch-id", branchHeader);
        responseHeaders.append("set-cookie", firstCookie);
        responseHeaders.append("set-cookie", secondCookie);

        return new Response(
          JSON.stringify({ method: request.method, orderId: params.orderId }),
          { status: 202, headers: responseHeaders }
        );
      }
    );

    const response = await handler(
      new Request("https://contoh.test/api/orders/order-555", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catatan: requestBodyMarker }),
      }),
      { params: Promise.resolve({ orderId: "order-555" }) }
    );

    // Status, cache, header custom, dan multi-value Set-Cookie tidak berubah.
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe(cacheControl);
    expect(response.headers.get("x-branch-id")).toBe(branchHeader);
    expect(response.headers.getSetCookie()).toEqual([firstCookie, secondCookie]);

    // Wrapper tidak membaca body response: stream masih utuh dan isinya persis
    // sama dengan yang ditulis handler (termasuk hasil `context.params`).
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe(
      '{"method":"PATCH","orderId":"order-555"}'
    );

    const requestId = expectCanonicalUuid(response.headers.get("x-request-id"));
    const completion = completionFor(
      parseRecords(lines),
      DEFAULT_HTTP_MODULE,
      "202"
    );
    expect(completion.level).toBe("info");
    expect(completion.requestId).toBe(requestId);
    expect(String(completion.message)).toContain("PATCH");

    // Response error (5xx) juga diteruskan apa adanya; level completion error.
    const querySecret = "tok-laporan-rahasia-02";
    const busyHandler = logging.withRequestContext(async (_request: Request) =>
      new Response("layanan sedang sibuk", {
        status: 503,
        headers: { "retry-after": "30" },
      })
    );

    const busy = await busyHandler(
      new Request(`https://contoh.test/api/reports?token=${querySecret}`, {
        method: "GET",
      })
    );

    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("30");
    expect(await busy.text()).toBe("layanan sedang sibuk");

    const busyRequestId = expectCanonicalUuid(busy.headers.get("x-request-id"));
    expect(busyRequestId).not.toBe(requestId);

    const records = parseRecords(lines);
    const busyCompletion = completionFor(records, DEFAULT_HTTP_MODULE, "503");
    expect(busyCompletion.level).toBe("error");
    expect(busyCompletion.requestId).toBe(busyRequestId);
    expect(String(busyCompletion.message)).toContain("GET");
    expect(String(busyCompletion.message)).not.toContain(querySecret);
    expect(lines.join("")).not.toContain(requestBodyMarker);
  });

  it("menstempel header pada Response.redirect yang header-nya immutable tanpa mengubah status dan Location", async () => {
    const { logging, lines } = createHttpLogging("store");

    const target = "https://contoh.test/masuk?lanjut=%2Fakun";
    // `Response.redirect` menghasilkan header dengan guard `immutable`, jadi
    // `response.headers.set(...)` langsung akan melempar TypeError.
    const redirect = Response.redirect(target, 303);

    const handler = logging.withRequestContext(
      async (_request: Request) => redirect,
      "auth-route"
    );

    const response = await handler(
      new Request("https://contoh.test/api/logout", { method: "POST" })
    );

    // Semantik redirect utuh: status dan Location tidak diubah wrapper.
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(target);

    // Header ditambahkan lewat response baru, bukan mutasi objek milik handler.
    const requestId = expectCanonicalUuid(response.headers.get("x-request-id"));
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get("location")).toBe(target);
    expect(redirect.headers.get("x-request-id")).toBeNull();

    // 303 < 400 → completion info, di scope yang sama dengan header response.
    const completion = completionFor(
      parseRecords(lines),
      "auth-route",
      "303"
    );
    expect(completion.level).toBe("info");
    expect(completion.requestId).toBe(requestId);
    expect(String(completion.message)).toContain("POST");
  });

  it("meneruskan Error yang identik dari handler, mencatatnya di dalam context, dan meninggalkan context bersih", async () => {
    const { logging, lines } = createHttpLogging("admin");
    const ordersLog = logging.createModuleLogger("orders-service");

    const failure = new Error("gagal menyimpan order");
    const querySecret = "tok-gagal-rahasia-03";
    const bodyMarker = "body-order-gagal";

    const handler = logging.withRequestContext(
      async (_request: Request) => {
        ordersLog.info("handler:sebelum-gagal");
        throw failure;
      },
      "orders-route"
    );

    let thrown: unknown;
    try {
      await handler(
        new Request(`https://contoh.test/api/orders?token=${querySecret}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ catatan: bodyMarker }),
        })
      );
    } catch (error) {
      thrown = error;
    }

    // Dibandingkan secara identitas: wrapper tidak membungkus atau menggantinya.
    expect(thrown).toBe(failure);
    // Tidak ada response framework pengganti (mis. 500) saat handler throw.
    expect(thrown).not.toBeInstanceOf(Response);

    // Context tidak bocor sesudah rejection.
    expect(logging.getRequestId()).toBeNull();
    ordersLog.info("process:after");

    const records = parseRecords(lines);

    // Tepat satu line error dari wrapper — tanpa duplikasi stack per layer.
    const failureRecords = records.filter(
      (record) => record.module === "orders-route"
    );
    expect(failureRecords).toHaveLength(1);
    const failureRecord = failureRecords[0];

    expect(failureRecord.level).toBe("error");
    const failureRequestId = expectCanonicalUuid(failureRecord.requestId);

    // Log yang ditulis handler memakai context request yang sama.
    expect(recordFor(records, "handler:sebelum-gagal").requestId).toBe(
      failureRequestId
    );

    // Kegagalan dicatat sebagai proyeksi error yang aman, bukan object mentah.
    const projected = failureRecord.error as LogRecord;
    expect(typeof projected).toBe("object");
    expect(projected.message).toBe("gagal menyimpan order");

    // Tidak ada raw URL/query/body pada line kegagalan.
    expect(String(failureRecord.message)).not.toContain("https://");
    expect(String(failureRecord.message)).not.toContain(querySecret);
    expect(String(failureRecord.message)).not.toContain(bodyMarker);
    const output = lines.join("");
    expect(output).not.toContain(querySecret);
    expect(output).not.toContain(bodyMarker);

    // Context bersih untuk log sesudah rejection.
    expect(recordFor(records, "process:after").requestId).toBeNull();
  });
});
