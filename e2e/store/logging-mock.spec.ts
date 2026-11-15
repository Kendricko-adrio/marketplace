/**
 * Korelasi logging pada server NYATA — store (plan §8C/§9, fitur 2).
 *
 * Kenapa spec ini ada: route interception di browser hanya membuktikan request
 * dari halaman, bukan output server. Spec ini memanggil endpoint nyata pada
 * server yang dijalankan `playwright.mock.config.ts`, lalu memeriksa artifact
 * stdout proses app (file di luar repo) sebagai sumber kebenaran eksternal.
 *
 * Kontrak yang dikunci oleh SATU test (dua request concurrent):
 * 1. Incoming `x-request-id` sintetis yang SAMA pada kedua request tetap
 *    menghasilkan header `x-request-id` kanonik berbeda — selalu UUID buatan
 *    server, tidak pernah incoming id.
 * 2. Kontrak HTTP lama tidak berubah: 200 dan body `{ success, data }` dengan
 *    kategori aktif dari DB seeded.
 * 3. Artifact stdout memuat TEPAT dua record untuk setiap requestId kanonik —
 *    satu event bisnis module `categories-route` + satu completion `GET 200` —
 *    dengan envelope tetap (6 field, tanpa field bisnis), module benar,
 *    requestId sama dengan header, serta tanpa incoming id / query mentah.
 *
 * RED yang diharapkan: header/body sudah benar, tetapi artifact capture belum
 * ada sehingga `expect.poll` timeout (capture diimplementasikan harness pada
 * langkah GREEN). Spec ini tidak memakai browser fixture, tidak sign-in, tidak
 * menulis/mengubah data, dan tidak mengimpor logger app/core.
 */
import { isAbsolute, relative } from "node:path";
import { expect, test } from "@playwright/test";
import { readJsonLines, selectRecords } from "../support/logging-artifacts";

// ---------------------------------------------------------------------------
// Run-environment contract (keep in sync with playwright.mock.config.ts)
// ---------------------------------------------------------------------------

const APP = "store";
const MODULE = "categories-route";
const CATEGORIES_PATH = "/api/categories";
const STORE_PORT = "3110";

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const LOGGING_DIR = process.env.E2E_LOGGING_DIR ?? "";
const STORE_LOG_PATH = process.env.E2E_LOGGING_STORE_LOG ?? "";

/** Poll capture ≤ 10s (server dev sudah siap sebelum test dijalankan). */
const POLL_TIMEOUT_MS = 10_000;

/** Envelope log tetap — skill maintainable-code §7.2. */
const FIXED_FIELDS = ["app", "level", "message", "module", "requestId", "timestamp"];

/** UUID kanonik 8-4-4-4-12: identitas yang selalu dibuat server. */
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Incoming id sintetis: tidak boleh dipakai sebagai identitas kanonik. */
const INCOMING_REQUEST_ID = "e2e-incoming-request-id-store-must-not-be-canonical";

/** Query sintetis: nilai mentahnya tidak boleh muncul di record target. */
const QUERY_SECRET = "e2e-raw-query-secret-store";

/** Fail closed: hanya run mock terisolasi dengan artifact capture yang jelas. */
function requireIsolatedLoggingRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    LOGGING_DIR.length === 0 ||
    STORE_LOG_PATH.length === 0
  ) {
    throw new Error(
      "logging-mock.spec.ts (store) must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_STORE_BASE_URL and E2E_LOGGING_STORE_LOG set"
    );
  }

  const origin = new URL(STORE_BASE_URL);
  const loopback =
    origin.hostname === "127.0.0.1" || origin.hostname === "localhost";
  if (!loopback || origin.port !== STORE_PORT) {
    throw new Error(
      `logging-mock.spec.ts (store) refuses a non-loopback/foreign-port store origin (${STORE_BASE_URL}); the isolated mock store port is ${STORE_PORT}`
    );
  }

  // Artifact hanya boleh dibaca dari direktori capture run ini.
  const withinCaptureDir = relative(LOGGING_DIR, STORE_LOG_PATH);
  if (
    withinCaptureDir.length === 0 ||
    withinCaptureDir.startsWith("..") ||
    isAbsolute(withinCaptureDir)
  ) {
    throw new Error(
      `logging-mock.spec.ts (store) refuses a capture path outside E2E_LOGGING_DIR (${STORE_LOG_PATH})`
    );
  }
}

test.describe("logging correlation — store GET /api/categories", () => {
  // Kompilasi route pertama pada dev server bisa memakan puluhan detik.
  test.setTimeout(90_000);

  test("dua request nyata memakai requestId kanonik sendiri dan menulis tepat dua record log", async ({
    request,
  }) => {
    requireIsolatedLoggingRun();

    const url = `${STORE_BASE_URL}${CATEGORIES_PATH}?access_token=${QUERY_SECRET}`;
    const incomingHeaders = { "x-request-id": INCOMING_REQUEST_ID };

    // Dua request concurrent dengan incoming x-request-id yang identik.
    const responses = await Promise.all([
      request.get(url, { headers: incomingHeaders }),
      request.get(url, { headers: incomingHeaders }),
    ]);

    const statuses = responses.map((response) => response.status());
    const bodies = (await Promise.all(
      responses.map((response) => response.json())
    )) as Array<{ success?: unknown; data?: unknown }>;
    const requestIds = responses.map(
      (response) => response.headers()["x-request-id"] ?? ""
    );

    // --- Kontrak HTTP lama tetap apa adanya --------------------------------
    for (const [index, status] of statuses.entries()) {
      expect(status, `response #${index} status`).toBe(200);

      const body = bodies[index];
      expect(Object.keys(body).sort(), `response #${index} body keys`).toEqual([
        "data",
        "success",
      ]);
      expect(body.success, `response #${index} success`).toBe(true);

      const data = body.data as unknown[];
      expect(Array.isArray(body.data), `response #${index} data array`).toBe(true);
      expect(data.length, `response #${index} data seeded`).toBeGreaterThan(0);
    }

    // --- Header kanonik: unik per invocation, bukan incoming id -----------
    for (const [index, requestId] of requestIds.entries()) {
      expect(requestId, `response #${index} x-request-id`).toMatch(
        CANONICAL_UUID
      );
      expect(requestId, `response #${index} x-request-id`).not.toBe(
        INCOMING_REQUEST_ID
      );
    }
    expect(requestIds[0]).not.toBe(requestIds[1]);

    // --- Artifact stdout nyata: tepat dua record per invocation -----------
    const invocations = () =>
      requestIds.map((requestId) =>
        selectRecords(readJsonLines(STORE_LOG_PATH), {
          app: APP,
          module: MODULE,
          requestId,
        })
      );
    const completeInvocations = () =>
      invocations().filter((records) => records.length === 2).length;

    await expect
      .poll(completeInvocations, {
        timeout: POLL_TIMEOUT_MS,
        message: `artifact stdout store (${STORE_LOG_PATH}) harus memuat 2 record untuk kedua requestId kanonik`,
      })
      .toBe(2);

    for (const [index, records] of invocations().entries()) {
      const requestId = requestIds[index];
      const expectedCount = (bodies[index].data as unknown[]).length;

      // Tanpa duplikasi: satu event bisnis + satu completion HTTP.
      expect(records, `invocation #${index}`).toHaveLength(2);

      for (const record of records) {
        // Envelope tetap: 6 field, tanpa binding bisnis tambahan.
        expect(Object.keys(record).sort(), `record fields #${index}`).toEqual(
          [...FIXED_FIELDS].sort()
        );
        expect(record.app).toBe(APP);
        expect(record.module).toBe(MODULE);
        expect(record.requestId).toBe(requestId);
        expect(record.level).toBe("info");
        expect(typeof record.message).toBe("string");
        expect(String(record.message).length).toBeGreaterThan(0);

        const timestamp = String(record.timestamp);
        expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
        expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
      }

      const messages = records.map((record) => String(record.message));

      // Completion HTTP hanya memuat method + status.
      expect(messages, `invocation #${index} completion`).toContain("GET 200");
      // Event bisnis: jumlah kategori sama dengan body response yang diamati.
      expect(messages, `invocation #${index} business`).toContain(
        `Kategori aktif dimuat: ${expectedCount}`
      );

      // Incoming id dan query mentah tidak pernah masuk record target.
      const serialized = JSON.stringify(records);
      expect(serialized).not.toContain(INCOMING_REQUEST_ID);
      expect(serialized).not.toContain(QUERY_SECRET);
    }
  });
});
