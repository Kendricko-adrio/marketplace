import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  createLogging,
  type LogDestination,
  type Logging,
  type LogLevel,
  type ModuleLogger,
} from "./index";

// Seam publik core logging (`@marketplace/logging`) → JSON output yang
// ditangkap sink test. Expected value diambil dari kontrak format final
// plan/maintainable-code-and-contextual-logging.md §6.3, bukan dari
// implementasi.
describe("createLogging public interface", () => {
  it("emits exactly one JSON line with only the fixed contract fields", () => {
    const lines: string[] = [];
    const logging = createLogging({
      app: "store",
      level: "info",
      destination: {
        write(line: string) {
          lines.push(line);
        },
      },
    });

    const log = logging.createModuleLogger("checkout-service");
    log.info("Order order-123 berhasil dibuat");

    const payloads = lines
      .join("")
      .split("\n")
      .filter((line) => line.length > 0);
    expect(payloads).toHaveLength(1);

    const record = JSON.parse(payloads[0]) as Record<string, unknown>;

    expect(Object.keys(record).sort()).toEqual([
      "app",
      "level",
      "message",
      "module",
      "requestId",
      "timestamp",
    ]);
    expect(record.level).toBe("info");
    expect(record.app).toBe("store");
    expect(record.requestId).toBeNull();
    expect(record.module).toBe("checkout-service");
    expect(record.message).toBe("Order order-123 berhasil dibuat");

    // ISO 8601 UTC dengan milidetik, mis. 2026-10-23T08:30:45.123Z
    expect(record.timestamp).toEqual(expect.any(String));
    expect(record.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
    expect(Number.isNaN(Date.parse(record.timestamp as string))).toBe(false);
  });
});

type LogRecord = Record<string, unknown>;

function parseRecords(lines: string[]): LogRecord[] {
  return lines
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LogRecord);
}

function recordFor(records: LogRecord[], message: string): LogRecord {
  const found = records.find((record) => record.message === message);
  if (!found) {
    throw new Error(`record log ${message} tidak ditemukan`);
  }
  return found;
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

// Bentuk UUID canonical (8-4-4-4-12 hex) — sumber kebenaran: kontrak requestId
// di plan/maintainable-code-and-contextual-logging.md §6.2/§6.3 ("UUID
// canonical dibuat server"), bukan bentuk internal implementasi.
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Seam publik kedua: `runWithRequestContext` pada objek `Logging`. Kontrak yang
// dituju (belum diimplementasikan pada slice ini):
//
//   runWithRequestContext<T>(work: () => T): T
//
// Nilai kembali callback diteruskan apa adanya; context hidup selama callback
// (termasuk seluruh `await` di dalamnya) masih berjalan. Test ini RED sampai
// slice implementasi context mendarat.
describe("runWithRequestContext per request scope", () => {
  it("memisahkan requestId tiap request concurrent dan mempertahankan return value", async () => {
    const lines: string[] = [];
    const logging = createLogging({
      app: "store",
      level: "info",
      destination: {
        write(line: string) {
          lines.push(line);
        },
      },
    });

    // Module logger dibuat sekali, sebelum scope request mana pun dibuka:
    // requestId harus dibaca saat log ditulis, bukan saat logger dibuat.
    const log = logging.createModuleLogger("checkout-service");
    log.info("process:before");

    const bothStarted = createBarrier(2);

    async function runRequest(label: "A" | "B"): Promise<string> {
      return logging.runWithRequestContext(async () => {
        log.info(`${label}:start`);
        // Kedua request harus sama-sama masih berada di dalam scope sebelum
        // salah satunya selesai — kondisi "concurrent" yang diuji.
        await bothStarted();
        log.info(`${label}:end`);
        return `${label}:result`;
      });
    }

    const [resultA, resultB] = await Promise.all([
      runRequest("A"),
      runRequest("B"),
    ]);

    log.info("process:after");

    // Return value callback dipertahankan.
    expect(resultA).toBe("A:result");
    expect(resultB).toBe("B:result");

    const records = parseRecords(lines);
    const messages = records.map((record) => record.message);

    expect(messages).toHaveLength(6);
    // Di luar scope HTTP: requestId null, sebelum maupun sesudah.
    expect(messages[0]).toBe("process:before");
    expect(messages[5]).toBe("process:after");
    // Kedua request memulai sebelum salah satu berakhir.
    expect(messages.slice(1, 3).sort()).toEqual(["A:start", "B:start"]);
    expect(messages.slice(3, 5).sort()).toEqual(["A:end", "B:end"]);

    const processBefore = recordFor(records, "process:before");
    const processAfter = recordFor(records, "process:after");
    const aStart = recordFor(records, "A:start");
    const aEnd = recordFor(records, "A:end");
    const bStart = recordFor(records, "B:start");
    const bEnd = recordFor(records, "B:end");

    expect(processBefore.requestId).toBeNull();
    expect(processAfter.requestId).toBeNull();

    // requestId tiap log dalam scope: UUID canonical non-null.
    for (const record of [aStart, aEnd, bStart, bEnd]) {
      expect(record.module).toBe("checkout-service");
      expect(record.requestId).not.toBeNull();
      expect(record.requestId).toEqual(expect.any(String));
      expect(record.requestId as string).toMatch(CANONICAL_UUID);
    }

    // Stabil di dalam satu request, berbeda antar request.
    expect(aEnd.requestId).toBe(aStart.requestId);
    expect(bEnd.requestId).toBe(bStart.requestId);
    expect(aStart.requestId).not.toBe(bStart.requestId);
  });
});

// Seam publik ketiga: execution/job scope.
//
//   runWithExecutionContext<T>(work: () => T): T
//   runDetachedExecutionContext<T>(work: () => T): T
//
// Kontrak (plan/maintainable-code-and-contextual-logging.md §6.2/§7.2):
// `executionId` dibuat sekali per job/worker/CLI entry dan hanya muncul sebagai
// field tambahan saat execution scope aktif; job yang dibuka di dalam HTTP scope
// mempertahankan `requestId` HTTP tersebut, sedangkan job/listener independen
// memakai `requestId: null` dengan `executionId` baru. Selesai scope, context
// pemanggil kembali seperti semula.
//
// Test ini RED sampai slice execution context diimplementasikan.
const ENVELOPE_KEYS = [
  "app",
  "level",
  "message",
  "module",
  "requestId",
  "timestamp",
];

const EXECUTION_KEYS = ["app", "executionId", "level", "message", "module", "requestId", "timestamp"];

describe("execution context per job scope", () => {
  it("memberi executionId stabil per job, mempertahankan requestId HTTP, dan memisahkan job independen", () => {
    const lines: string[] = [];
    const logging = createLogging({
      app: "store",
      level: "info",
      destination: {
        write(line: string) {
          lines.push(line);
        },
      },
    });

    const log = logging.createModuleLogger("report-job");

    // 1. Process scope: tanpa requestId maupun executionId.
    log.info("process:before");

    const httpScope = logging.runWithRequestContext(() => {
      log.info("http:start");

      // 2. Job yang dipicu HTTP cron: executionId tambahan, requestId HTTP tetap.
      const jobReturn = logging.runWithExecutionContext(() => {
        log.info("job:start");

        // 3. Listener/pekerjaan independen di dalam job: requestId dilepas,
        //    executionId baru (bukan mewarisi executionId job).
        const detachedReturn = logging.runDetachedExecutionContext(() => {
          log.info("listener:start");
          return "listener:result" as const;
        });

        // 4. Kembali ke context job setelah detached scope selesai.
        log.info("job:end");
        return { detachedReturn, value: "job:result" } as const;
      });

      // 5. Kembali ke context HTTP setelah job selesai: executionId hilang.
      log.info("http:end");
      return { jobReturn, value: "http:result" } as const;
    });

    // 6. Kembali ke process scope.
    log.info("process:after");

    // Return value tiap scope diteruskan apa adanya.
    expect(httpScope.value).toBe("http:result");
    expect(httpScope.jobReturn.value).toBe("job:result");
    expect(httpScope.jobReturn.detachedReturn).toBe("listener:result");

    const records = parseRecords(lines);
    expect(records.map((record) => record.message)).toEqual([
      "process:before",
      "http:start",
      "job:start",
      "listener:start",
      "job:end",
      "http:end",
      "process:after",
    ]);

    const processBefore = recordFor(records, "process:before");
    const httpStart = recordFor(records, "http:start");
    const jobStart = recordFor(records, "job:start");
    const listenerStart = recordFor(records, "listener:start");
    const jobEnd = recordFor(records, "job:end");
    const httpEnd = recordFor(records, "http:end");
    const processAfter = recordFor(records, "process:after");

    // Hanya execution scope yang punya field tambahan `executionId`.
    for (const record of [processBefore, httpStart, httpEnd, processAfter]) {
      expect(Object.keys(record).sort()).toEqual(ENVELOPE_KEYS);
    }
    for (const record of [jobStart, listenerStart, jobEnd]) {
      expect(Object.keys(record).sort()).toEqual(EXECUTION_KEYS);
    }

    // Process scope: tidak ada identitas palsu per log.
    expect(processBefore.requestId).toBeNull();
    expect(processAfter.requestId).toBeNull();

    // HTTP scope: satu UUID canonical untuk seluruh request.
    expect(httpStart.requestId as string).toMatch(CANONICAL_UUID);
    expect(httpEnd.requestId).toBe(httpStart.requestId);

    // Job di dalam HTTP scope mempertahankan requestId HTTP.
    expect(jobStart.requestId).toBe(httpStart.requestId);
    expect(jobEnd.requestId).toBe(httpStart.requestId);

    // executionId job stabil di seluruh job.
    expect(jobStart.executionId as string).toMatch(CANONICAL_UUID);
    expect(jobEnd.executionId).toBe(jobStart.executionId);

    // Job independen: requestId null (bukan mewarisi requestId), executionId baru.
    expect(listenerStart.requestId).toBeNull();
    expect(listenerStart.executionId as string).toMatch(CANONICAL_UUID);
    expect(listenerStart.executionId).not.toBe(jobStart.executionId);
  });
});

// Seam publik keempat: level.
//
//   log.trace|debug|info|warn|error|fatal(message)
//   createLogging({ level })     → menang atas env LOG_LEVEL
//   env LOG_LEVEL               → dipakai bila opts.level tidak diberikan
//   tanpa keduanya              → default "info"
//   LOG_LEVEL tidak valid       → fallback "info" + tepat satu diagnostic aman
//                                 yang tidak memuat nilai env mentah
//
// Kontrak: plan/maintainable-code-and-contextual-logging.md §6.1 (level) dan
// §6.3 (label level berupa string). Test ini RED sampai slice level
// diimplementasikan.
const ALL_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

const INVALID_LOG_LEVEL = "verbose-gacor";

/** Set/restore `LOG_LEVEL` tanpa meninggalkan jejak ke test lain. */
function withLogLevelEnv<T>(value: string | undefined, work: () => T): T {
  const previous = process.env.LOG_LEVEL;
  if (value === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = value;
  }
  try {
    return work();
  } finally {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  }
}

function emitAt(
  log: ModuleLogger,
  level: LogLevel,
  message: string,
  error?: unknown
): void {
  switch (level) {
    case "trace":
      log.trace(message, error);
      break;
    case "debug":
      log.debug(message, error);
      break;
    case "info":
      log.info(message, error);
      break;
    case "warn":
      log.warn(message, error);
      break;
    case "error":
      log.error(message, error);
      break;
    case "fatal":
      log.fatal(message, error);
      break;
  }
}

function emitEveryLevel(log: ModuleLogger): void {
  for (const level of ALL_LEVELS) {
    emitAt(log, level, `level:${level}`);
  }
}

function createSink() {
  const lines: string[] = [];
  return {
    lines,
    destination: {
      write(line: string) {
        lines.push(line);
      },
    },
  };
}

describe("level control", () => {
  it("menulis semua level trace..fatal dengan label level berupa string", () => {
    const sink = createSink();
    const logging = createLogging({
      app: "admin",
      level: "trace",
      destination: sink.destination,
    });

    emitEveryLevel(logging.createModuleLogger("jubelio-sync-service"));

    const records = parseRecords(sink.lines);
    expect(records.map((record) => record.message)).toEqual(
      ALL_LEVELS.map((level) => `level:${level}`)
    );
    expect(records.map((record) => record.level)).toEqual([...ALL_LEVELS]);

    // Tidak ada numeric level / `msg` / `pid` / `hostname` yang bocor.
    for (const record of records) {
      expect(Object.keys(record).sort()).toEqual(ENVELOPE_KEYS);
      expect(record.app).toBe("admin");
      expect(record.requestId).toBeNull();
    }
  });

  it("memfilter menurut opts.level, lalu env LOG_LEVEL, lalu default info", () => {
    const run = (
      options: { level?: LogLevel },
      envValue: string | undefined
    ): unknown[] => {
      const sink = createSink();
      let logging!: Logging;
      withLogLevelEnv(envValue, () => {
        logging = createLogging({
          app: "store",
          ...options,
          destination: sink.destination,
        });
      });

      emitEveryLevel(logging.createModuleLogger("checkout-place-order"));
      return parseRecords(sink.lines).map((record) => record.level);
    };

    // Tanpa opts.level dan tanpa env: default info.
    expect(run({}, undefined)).toEqual(["info", "warn", "error", "fatal"]);
    // Env LOG_LEVEL dipakai bila opts.level tidak diberikan.
    expect(run({}, "debug")).toEqual(["debug", "info", "warn", "error", "fatal"]);
    // opts.level eksplisit menang atas env, dan tidak memunculkan diagnostic.
    expect(run({ level: "error" }, "trace")).toEqual(["error", "fatal"]);
  });

  it("fallback ke info dan menulis tepat satu diagnostic aman saat LOG_LEVEL tidak valid", () => {
    const sink = createSink();
    let logging!: Logging;

    withLogLevelEnv(INVALID_LOG_LEVEL, () => {
      logging = createLogging({ app: "store", destination: sink.destination });
    });

    // Diagnostic startup sudah ditulis oleh factory, sebelum ada log bisnis.
    const diagnostics = parseRecords(sink.lines);
    expect(diagnostics).toHaveLength(1);
    const diagnostic = diagnostics[0];

    expect(diagnostic.level).toBe("warn");
    expect(diagnostic.app).toBe("store");
    expect(diagnostic.requestId).toBeNull();
    // Diagnostic datang lewat module logging, bukan dari call site aplikasi.
    expect(diagnostic.module).toBe("logging");
    // Envelope tetap fixed-field: tidak ada field mentah untuk nilai env.
    expect(Object.keys(diagnostic).sort()).toEqual(ENVELOPE_KEYS);
    // Setting yang bermasalah disebut, nilai mentahnya tidak.
    expect(String(diagnostic.message)).toMatch(/LOG_LEVEL/);
    expect(sink.lines.join("")).not.toContain(INVALID_LOG_LEVEL);

    // Fallback ke info: debug dibuang, info lolos.
    const log = logging.createModuleLogger("checkout-place-order");
    log.debug("business:debug");
    log.info("business:info");

    const records = parseRecords(sink.lines);
    expect(records.map((record) => record.message)).toEqual([
      diagnostic.message,
      "business:info",
    ]);
  });
});

// Seam publik kelima: error allowlisted.
//
//   log.error(message: string, error?: unknown): void
//
// Kontrak (plan §6.3/§7.4): field `error` hanya memuat proyeksi teknis
// `name`/`message`/`code`/`stack`/`cause`. Properti custom pada object error
// (mis. orderId, password, body) bukan bagian dari field log. Batas yang
// disetujui: message ≤ 2048, stack ≤ 8192, cause maksimum 3 level di bawah error
// utama; penanda berupa string `[truncated]` untuk melewati batas dan
// `[circular]` untuk cause melingkar. Saat dipotong, prefix isi dipertahankan.
//
// Test ini RED sampai serializer safe diimplementasikan.
const ERROR_FIELD_KEYS = [
  "app",
  "error",
  "level",
  "message",
  "module",
  "requestId",
  "timestamp",
];

const SAFE_ERROR_KEYS_WITH_CAUSE = ["cause", "message", "name", "stack"];

describe("safe error projection", () => {
  it("menulis field error allowlisted dengan batas ukuran, depth, dan penanda cause melingkar", () => {
    const sink = createSink();
    const logging = createLogging({
      app: "store",
      level: "info",
      destination: sink.destination,
    });
    const log = logging.createModuleLogger("payment-client");

    // Nilai sensitif khusus test: hanya boleh muncul di file test ini.
    const secretValue = "rahasia-uji-9f3a";
    const oversizeMessage = `payment gagal: ${"m".repeat(3000)}-ekor-pesan`;
    const oversizeStack = `Error: payment gagal\n${"s".repeat(9000)}-ekor-stack`;

    // Rantai cause 5 level: root -> cause-1 -> cause-2 -> cause-3 -> cause-4.
    let causeChain = new Error("cause-4");
    for (let depth = 3; depth >= 1; depth -= 1) {
      causeChain = new Error(`cause-${depth}`, { cause: causeChain });
    }

    const failure = new Error(oversizeMessage, { cause: causeChain });
    failure.stack = oversizeStack;
    Object.assign(failure, {
      orderId: "order-999",
      password: secretValue,
      body: { total: 15000 },
    });

    log.error("payment:gagal", failure);

    const firstRecords = parseRecords(sink.lines);
    expect(firstRecords).toHaveLength(1);
    const failureRecord = firstRecords[0];

    // Envelope tetap fixed-field; hanya `error` yang ditambahkan.
    expect(Object.keys(failureRecord).sort()).toEqual(ERROR_FIELD_KEYS);
    expect(failureRecord.level).toBe("error");
    // Fakta bisnis tetap di message, bukan dipindah ke field error.
    expect(failureRecord.message).toBe("payment:gagal");

    const projected = failureRecord.error as Record<string, unknown>;
    expect(typeof projected).toBe("object");
    expect(Object.keys(projected).sort()).toEqual(SAFE_ERROR_KEYS_WITH_CAUSE);
    expect(projected.name).toBe("Error");

    // Message: dipotong ≤ 2048 dengan marker, prefix tetap terbaca.
    const projectedMessage = projected.message as string;
    expect(projectedMessage.startsWith("payment gagal: mmmm")).toBe(true);
    expect(projectedMessage.length).toBeLessThanOrEqual(2048);
    expect(projectedMessage.endsWith("[truncated]")).toBe(true);

    // Stack: dipotong ≤ 8192 dengan marker, prefix tetap terbaca.
    const projectedStack = projected.stack as string;
    expect(projectedStack.startsWith("Error: payment gagal\n")).toBe(true);
    expect(projectedStack.length).toBeLessThanOrEqual(8192);
    expect(projectedStack.endsWith("[truncated]")).toBe(true);

    // Cause: maksimum 3 level di bawah error utama, sisanya marker truncation.
    const chain: Record<string, unknown>[] = [];
    let node: unknown = projected;
    while (node !== null && typeof node === "object") {
      chain.push(node as Record<string, unknown>);
      node = (node as Record<string, unknown>).cause;
    }
    expect(chain).toHaveLength(4);
    expect(chain.slice(1).map((entry) => entry.message)).toEqual([
      "cause-1",
      "cause-2",
      "cause-3",
    ]);
    expect(node).toBe("[truncated]");
    for (const entry of chain) {
      expect(Object.keys(entry).sort()).toEqual(SAFE_ERROR_KEYS_WITH_CAUSE);
    }

    // Cause melingkar: berhenti dengan marker, bukan rekursi tanpa batas.
    const circularFirst = new Error("circular-a");
    const circularSecond = new Error("circular-b", { cause: circularFirst });
    circularFirst.cause = circularSecond;
    log.error("payment:siklus", circularFirst);

    // `code` ikut hanya bila berupa nilai aman.
    const timedOut = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    log.error("payment:timeout", timedOut);

    const records = parseRecords(sink.lines);
    expect(records).toHaveLength(3);

    const circular = records[1].error as Record<string, unknown>;
    expect(circular.message).toBe("circular-a");
    const circularCause = circular.cause as Record<string, unknown>;
    expect(circularCause.message).toBe("circular-b");
    expect(circularCause.cause).toBe("[circular]");

    const withCode = records[2].error as Record<string, unknown>;
    expect(Object.keys(withCode).sort()).toEqual([
      "code",
      "message",
      "name",
      "stack",
    ]);
    expect(withCode.code).toBe("ETIMEDOUT");

    // Properti bisnis pada object error tidak pernah masuk output.
    const output = sink.lines.join("");
    expect(output).not.toContain(secretValue);
    expect(output).not.toContain("order-999");
    expect(output).not.toContain("15000");
  });
});

// Seam publik keenam: ketahanan (fail-safe) logging.
//
// Kontrak (plan §6.3/§7.4): kegagalan serialisasi error maupun kegagalan sink
// tidak boleh menggagalkan alur bisnis, tidak boleh melempar ulang, dan tidak
// boleh rekursi tanpa akhir. Setiap method level menerima error opsional dengan
// proyeksi yang sama, dan tetap menulis tepat satu line per pemanggilan.
//
// Test ini RED sampai hardening fail-safe diimplementasikan.
const SAFE_ERROR_ALLOWED_KEYS = ["cause", "code", "message", "name", "stack"];

describe("logging robustness", () => {
  it("tidak menggagalkan alur bisnis saat error atau sink tidak bisa diserialisasi", () => {
    const sink = createSink();
    const logging = createLogging({
      app: "store",
      level: "trace",
      destination: sink.destination,
    });
    const log = logging.createModuleLogger("checkout-service");

    // Getter yang melempar: dibaca sebagai field yang tidak tersedia.
    const hostileGetters = {
      get name(): string {
        throw new Error("getter name meledak");
      },
      get message(): string {
        throw new Error("getter message meledak");
      },
      get stack(): string {
        throw new Error("getter stack meledak");
      },
      get cause(): unknown {
        throw new Error("getter cause meledak");
      },
    };

    // Proxy yang melempar untuk get/has/ownKeys: tidak boleh diiterasi/di-spread.
    const hostileProxy = new Proxy(
      {},
      {
        get(): never {
          throw new Error("proxy get meledak");
        },
        has(): never {
          throw new Error("proxy has meledak");
        },
        ownKeys(): never {
          throw new Error("proxy ownKeys meledak");
        },
      }
    );

    const hostileToString = {
      message: "gagal kirim",
      toString(): string {
        throw new Error("toString meledak");
      },
    };

    expect(() => log.error("hostile:getters", hostileGetters)).not.toThrow();
    expect(() => log.error("hostile:proxy", hostileProxy)).not.toThrow();
    expect(() => log.error("hostile:toString", hostileToString)).not.toThrow();
    // Non-Error thrown: string, number, null.
    expect(() => log.error("thrown:string", "boom-teks")).not.toThrow();
    expect(() => log.error("thrown:number", 42)).not.toThrow();
    expect(() => log.error("thrown:null", null)).not.toThrow();

    const records = parseRecords(sink.lines);
    expect(records.map((record) => record.message)).toEqual([
      "hostile:getters",
      "hostile:proxy",
      "hostile:toString",
      "thrown:string",
      "thrown:number",
      "thrown:null",
    ]);

    // Field `error` tetap ada dan tetap berbentuk allowlist walau sumbernya rusak.
    for (const record of records) {
      const projected = record.error as Record<string, unknown>;
      expect(typeof projected).toBe("object");
      expect(typeof projected.name).toBe("string");
      expect(typeof projected.message).toBe("string");
      for (const key of Object.keys(projected)) {
        expect(SAFE_ERROR_ALLOWED_KEYS).toContain(key);
      }
    }

    // Nilai primitive yang di-throw tetap terbaca sebagai message proyeksi.
    const thrownString = recordFor(records, "thrown:string");
    expect((thrownString.error as Record<string, unknown>).message).toBe(
      "boom-teks"
    );

    // Sink yang melempar: semua level harus tetap tidak melempar ke pemanggil.
    const brokenLogging = createLogging({
      app: "store",
      level: "trace",
      destination: {
        write() {
          throw new Error("sink rusak");
        },
      },
    });
    const brokenLog = brokenLogging.createModuleLogger("checkout-service");

    expect(() => emitEveryLevel(brokenLog)).not.toThrow();
    expect(() => brokenLog.error("sink:error", new Error("gagal"))).not.toThrow();

    // Diagnostic startup juga fail-safe: LOG_LEVEL invalid + sink rusak.
    expect(() =>
      withLogLevelEnv(INVALID_LOG_LEVEL, () =>
        createLogging({
          app: "store",
          destination: {
            write() {
              throw new Error("sink rusak");
            },
          },
        })
      )
    ).not.toThrow();
  });

  it("menerima error opsional pada semua level dan menulis satu line per emit", () => {
    const sink = createSink();
    const logging = createLogging({
      app: "admin",
      level: "trace",
      destination: sink.destination,
    });
    const log = logging.createModuleLogger("order-service");

    for (const level of ALL_LEVELS) {
      const cause = new Error(`penyebab-${level}`);
      const failure = new Error(`gagal-${level}`, { cause });
      emitAt(log, level, `level-error:${level}`, failure);
    }

    const records = parseRecords(sink.lines);
    expect(records).toHaveLength(ALL_LEVELS.length);
    expect(records.map((record) => record.level)).toEqual([...ALL_LEVELS]);

    records.forEach((record, index) => {
      const level = ALL_LEVELS[index];
      expect(record.message).toBe(`level-error:${level}`);
      expect(record.module).toBe("order-service");
      expect(record.requestId).toBeNull();
      const projected = record.error as Record<string, unknown>;
      expect(projected.message).toBe(`gagal-${level}`);
      expect((projected.cause as Record<string, unknown>).message).toBe(
        `penyebab-${level}`
      );
    });
  });
});

// Seam publik ketujuh: redaksi nilai sensitif.
//
// Kontrak (plan §6.3/§7.4): message log dan seluruh field `error` (name, message,
// stack, cause bersarang) tidak boleh memuat nilai sensitif yang dikenali:
// assignment token yang dikenal (termasuk nilai ber-kutip), header
// authorization/cookie, Bearer/Basic token, email, kredensial URL, dan nilai
// query URL. Placeholder `[redacted]`/`[redacted-email]`, nama key tetap
// terbaca. Batasan yang diakui: ini bukan jaminan universal menghapus semua PII
// atau secret berbentuk bebas — caller tetap wajib mengirim ringkasan aman.
// `name` dan `code` dibatasi ke token teknis sempit agar tidak menjadi jalur
// penyelundupan data.
//
// Test ini RED sampai redaction diimplementasikan. Seluruh nilai sensitif di
// bawah adalah fixture khusus test ini.
const SENSITIVE_FIXTURES = {
  password: "kata-sandi-abc123",
  quoted: "kutip-ganda-xyz",
  bearer: "tok-bearer-12345",
  cookie: "abc; lain=def",
  email: "budi.santoso@contoh.test",
  urlUser: "userrahasia",
  urlPassword: "kataluar",
  queryToken: "tok-999",
} as const;

const NARROW_NAME_TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

describe("log redaction", () => {
  it("menyamarkan nilai sensitif di message dan seluruh field error tanpa menghilangkan fakta aman", () => {
    const sink = createSink();
    const logging = createLogging({
      app: "store",
      level: "info",
      destination: sink.destination,
    });
    const log = logging.createModuleLogger("payment-client");

    const fixtures = SENSITIVE_FIXTURES;

    log.info(
      `Order order-777 pembayaran gagal password=${fixtures.password} Password: "${fixtures.quoted}"`
    );
    log.info(
      `Order order-777 authorization: Bearer ${fixtures.bearer}`
    );
    log.info(`Order order-777 cookie: ${fixtures.cookie}`);
    log.info(`Order order-777 kontak ${fixtures.email}`);
    log.info(
      `Order order-777 callback https://${fixtures.urlUser}:${fixtures.urlPassword}@db.contoh.test/orders?token=${fixtures.queryToken}&branch=JKT-01`
    );

    const messageRecords = parseRecords(sink.lines);
    expect(messageRecords).toHaveLength(5);

    // Fakta bisnis yang aman tetap terbaca.
    for (const record of messageRecords) {
      expect(record.message).toContain("Order order-777");
      expect(record.module).toBe("payment-client");
    }

    // Nama key/parameter tetap terbaca supaya line masih bisa ditelusuri.
    expect(messageRecords[0].message).toContain("password");
    expect(messageRecords[1].message).toContain("authorization");
    expect(messageRecords[2].message).toContain("cookie");
    expect(messageRecords[3].message).toContain("kontak");
    expect(messageRecords[4].message).toContain("db.contoh.test");
    expect(messageRecords[4].message).toContain("branch");

    const messageOutput = sink.lines.join("");
    for (const secret of [
      fixtures.password,
      fixtures.quoted,
      fixtures.bearer,
      fixtures.cookie,
      fixtures.email,
      fixtures.urlUser,
      fixtures.urlPassword,
      fixtures.queryToken,
    ]) {
      expect(messageOutput).not.toContain(secret);
    }

    // Redaksi juga berlaku pada field error: message, stack, dan cause bersarang.
    const failure = new Error(
      `gagal hubungi ${fixtures.email} password=${fixtures.password}`
    );
    failure.stack = `Error: gagal\n    at load (https://${fixtures.urlUser}:${fixtures.urlPassword}@db.contoh.test/v1/orders?token=${fixtures.queryToken})`;
    failure.cause = new Error(`timeout untuk ${fixtures.email}`);
    log.error("payment:redaksi", failure);

    const errorRecord = recordFor(parseRecords(sink.lines), "payment:redaksi");
    const projected = errorRecord.error as Record<string, unknown>;
    const projectedOutput = JSON.stringify(projected);
    for (const secret of [
      fixtures.password,
      fixtures.email,
      fixtures.urlUser,
      fixtures.urlPassword,
      fixtures.queryToken,
    ]) {
      expect(projectedOutput).not.toContain(secret);
    }

    // Fakta teknis aman di stack/cause tetap terbaca.
    expect(String(projected.message)).toContain("gagal hubungi");
    expect(String(projected.stack)).toContain("db.contoh.test");
    expect(
      String((projected.cause as Record<string, unknown>).message)
    ).toContain("timeout");
  });

  it("membatasi name dan code error ke token teknis sempit", () => {
    const sink = createSink();
    const logging = createLogging({
      app: "store",
      level: "info",
      destination: sink.destination,
    });
    const log = logging.createModuleLogger("payment-client");

    const suspiciousName = new Error("gagal membayar");
    suspiciousName.name = `TypeError password=${SENSITIVE_FIXTURES.password}`;

    const looseCode = Object.assign(new Error("gagal membayar"), {
      code: "invalid code value",
    });
    const numericCode = Object.assign(new Error("gagal membayar"), {
      code: 500,
    });
    const technicalFailure = Object.assign(new Error("gagal membayar"), {
      name: "HttpError",
      code: "ETIMEDOUT",
    });

    log.error("token:nama", suspiciousName);
    log.error("token:code-bebas", looseCode);
    log.error("token:code-angka", numericCode);
    log.error("token:teknis", technicalFailure);

    const records = parseRecords(sink.lines);
    expect(records).toHaveLength(4);

    const suspicious = records[0].error as Record<string, unknown>;
    expect(String(suspicious.name)).toMatch(NARROW_NAME_TOKEN);
    expect(String(suspicious.name)).not.toContain(SENSITIVE_FIXTURES.password);

    // Nilai code yang bukan token teknis sempit di-drop, bukan di-coerce.
    expect(records[1].error).not.toHaveProperty("code");
    expect(records[2].error).not.toHaveProperty("code");

    // Token teknis yang sah tetap dipertahankan.
    const technical = records[3].error as Record<string, unknown>;
    expect(technical.name).toBe("HttpError");
    expect(technical.code).toBe("ETIMEDOUT");
    expect(technical.message).toBe("gagal membayar");
  });
});

// Regresi redaksi: known key ber-kutip (bentuk JSON-like) dan Bearer/Basic
// pendek. Nilai di bawah sintetis, hanya hidup di file test ini.
describe("log redaction of quoted and short credentials", () => {
  it("menyamarkan known key ber-kutip dan credential Bearer/Basic pendek", () => {
    const sink = createSink();
    const logging = createLogging({
      app: "store",
      level: "info",
      destination: sink.destination,
    });
    const log = logging.createModuleLogger("provider-client");

    const jsonSecret = "sintetis-json-77";
    const singleQuotedSecret = "sintetis-kutip-88";
    const shortBearer = "abc9x";
    const shortBasic = "bsc7q";
    const safeOrderId = "order-4242";

    log.info(
      `Order ${safeOrderId} payload ${JSON.stringify({ password: jsonSecret, token: jsonSecret })}`
    );
    log.info(`Order ${safeOrderId} payload {'cookie': '${singleQuotedSecret}'}`);
    log.info(`Order ${safeOrderId} provider replied with Bearer ${shortBearer}`);
    log.info(`Order ${safeOrderId} provider replied with Basic ${shortBasic}`);
    log.info(
      `Order ${safeOrderId} header {"authorization":"Bearer ${shortBearer}"}`
    );

    const records = parseRecords(sink.lines);
    expect(records).toHaveLength(5);

    const output = sink.lines.join("");
    for (const secret of [
      jsonSecret,
      singleQuotedSecret,
      shortBearer,
      shortBasic,
    ]) {
      expect(output).not.toContain(secret);
    }

    // Fakta bisnis yang aman tetap terbaca.
    for (const record of records) {
      expect(record.message).toContain(`Order ${safeOrderId}`);
      expect(record.module).toBe("provider-client");
    }
  });
});

// Regresi kegagalan sink **asinkron** (`EPIPE`/`EIO`).
//
// Kontrak (logger.ts "Logging must never break business flow"): kegagalan sink
// yang datang sebagai event `error` asinkron — bentuk kegagalan pipe stdout yang
// sebenarnya (pipe ditutup → EPIPE) — juga tidak boleh lolos menjadi uncaught
// exception. `write` di bawah hanya MENJADWALKAN error lewat microtask, tidak
// melempar, jadi jalur `try/catch` sinkron saja tidak menolong.
//
// Setiap emit dibungkus try/catch dan dicatat sebagai data test: tanpa listener,
// `emit('error')` melempar dan Node menganggapnya uncaught exception yang
// mematikan seluruh file test — dengan cara ini kegagalan terbaca rapi sebagai
// assertion, bukan crash harness. Penjadwalan memakai microtask + promise
// penyelesaian, bukan sleep, supaya deterministik.
type StreamLikeSink = EventEmitter & { write(line: string): void };

function createFailingStreamSink(code: string) {
  const stream = new EventEmitter() as StreamLikeSink;
  const writes: string[] = [];
  const escaped: unknown[] = [];
  const pending: Promise<void>[] = [];

  stream.write = (line: string): void => {
    writes.push(line);
    let settled!: () => void;
    pending.push(
      new Promise<void>((resolve) => {
        settled = resolve;
      })
    );
    // Sink stream-like tidak melempar: ia memancarkan `error` pada tick
    // berikutnya, setelah pemanggil `write` sudah kembali.
    queueMicrotask(() => {
      try {
        stream.emit("error", Object.assign(new Error(`write ${code}`), { code }));
      } catch (error) {
        escaped.push(error);
      } finally {
        settled();
      }
    });
  };

  return {
    stream,
    writes,
    escaped,
    /** `write` yang dipasang test ini, untuk membuktikan tidak diubah core. */
    writeRef: stream.write,
    listenerCount: () => stream.listenerCount("error"),
    settled: () => Promise.all(pending),
  };
}

describe("async sink failure", () => {
  it("menetralkan error async sink (EPIPE/EIO) tanpa retry dan tanpa mengubah write pemanggil", async () => {
    for (const code of ["EPIPE", "EIO"] as const) {
      const sink = createFailingStreamSink(code);
      const logging = createLogging({
        app: "store",
        level: "info",
        destination: sink.stream as unknown as LogDestination,
      });
      const log = logging.createModuleLogger("checkout-service");

      // Penulisan pertama sampai ke sink, lalu sink melaporkan gagal secara async.
      expect(() => log.info(`process:start:${code}`)).not.toThrow();
      await sink.settled();
      expect(sink.writes).toHaveLength(1);
      expect(sink.escaped).toEqual([]);

      // Sink sudah dinyatakan gagal: penulisan berikutnya tidak dicoba ulang
      // (tidak retry/rekursi) dan error susulan tetap tidak lolos ke pemanggil.
      // Konsekuensi yang diterima: line setelah sink down bisa hilang, delivery
      // tidak dijanjikan.
      expect(() => log.info(`process:after:${code}`)).not.toThrow();
      await sink.settled();
      expect(sink.writes).toHaveLength(1);
      expect(sink.escaped).toEqual([]);

      // `write` milik pemanggil tidak diganti/dimonkey-patch oleh core.
      expect(sink.stream.write).toBe(sink.writeRef);
    }

    // Satu listener per physical destination: dua factory dengan stream yang
    // sama tidak menumpuk listener `error`.
    const shared = createFailingStreamSink("EPIPE");
    for (let index = 0; index < 2; index += 1) {
      createLogging({
        app: "store",
        level: "info",
        destination: shared.stream as unknown as LogDestination,
      });
    }
    expect(shared.listenerCount()).toBe(1);
  });
});

// Regresi redaksi: nilai known key yang mengandung tanda baca.
//
// Kontrak (redaction.ts "Scope of the guarantee"): key assignment yang dikenali
// diganti `[redacted]` secara **utuh**. Nilai seperti `Pass,word;2024` tidak boleh
// menyisakan ekor tanpa label setelah `,`/`;`/kutip/kurung kurawal/backslash, dan
// nilai JSON ber-escape (`{"password":"a\"b"}`) harus habis sampai kutip
// penutup. `&` sengaja tetap dikecualikan supaya `?token=x&branch=JKT-01`
// mempertahankan key `branch` (kontrak test URL query di atas).
//
// Batas yang tetap diakui: ini bukan scrubber universal — secret yang ditulis
// bebas tanpa key yang dikenali tetap tanggung jawab pemanggil.
describe("log redaction of punctuated credential values", () => {
  it("menyemarkan nilai known key bertanda baca secara utuh tanpa menghilangkan fakta aman", () => {
    const sink = createSink();
    const logging = createLogging({
      app: "store",
      level: "info",
      destination: sink.destination,
    });
    const log = logging.createModuleLogger("provider-client");

    const safeOrderId = "order-4242";
    const commaSemicolonSecret = "Pass,word;2024";
    const braceSecret = "k1{k2}";
    const quoteSecret = 'abc"def';
    const backslashSecret = "a\\b";
    const escapedJsonSecret = 'kuat-55"ekor';
    const queryToken = "tok-sintetis-1";

    log.info(
      `Order ${safeOrderId} password=${commaSemicolonSecret} api_key=${braceSecret}`
    );
    log.info(
      `Order ${safeOrderId} client_secret=${quoteSecret} token=${backslashSecret}`
    );
    log.info(
      `Order ${safeOrderId} payload ${JSON.stringify({ password: escapedJsonSecret })}`
    );
    log.info(
      `Order ${safeOrderId} callback /v1/orders?token=${queryToken}&branch=JKT-01`
    );

    const records = parseRecords(sink.lines);
    expect(records).toHaveLength(4);

    const output = sink.lines.join("");

    // Ekor nilai yang dulu tertinggal tanpa label (bagian dari secret).
    expect(output).not.toContain("word;2024");
    expect(output).not.toContain("{k2}");
    expect(output).not.toContain('"def');
    expect(output).not.toContain("ekor");

    for (const secret of [
      commaSemicolonSecret,
      braceSecret,
      quoteSecret,
      backslashSecret,
      escapedJsonSecret,
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toContain(queryToken);

    // Fakta bisnis aman dan known key tetap terbaca supaya line bisa ditelusuri.
    for (const record of records) {
      expect(record.message).toContain(`Order ${safeOrderId}`);
      expect(record.module).toBe("provider-client");
    }
    expect(records[0].message).toContain("password");
    expect(records[0].message).toContain("api_key");
    expect(records[1].message).toContain("client_secret");
    expect(records[1].message).toContain("token");
    expect(records[3].message).toContain("branch");
  });
});
