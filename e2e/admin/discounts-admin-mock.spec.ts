/**
 * Ticket 06 — public fixed Offer administration, first RED slice: public HTTP
 * draft create + request-key replay + draft read on the isolated admin origin.
 *
 * Settled wire contract (approved spec §7.2, §8.1):
 *   POST /api/admin/discounts  { requestKey, activationKind: "public" }
 *     -> 201 { success: true, data: { id, state: "draft", activationKind:
 *        "public", currentRevisionId: null, version: 1, draftVersion: 1 } }
 *   the SAME requestKey + payload again -> 200, SAME identity/state (replay, no
 *     second Offer).
 *   GET /api/admin/discounts/{id} -> 200, same draft, currentRevisionId null:
 *     still unlaunchable (no published revision).
 *
 * An incomplete draft is legal: no quota, no budget, no voucher-style default
 * 100 is sent. Simulation/publish/pause stay out of scope.
 *
 * Second RED slice, same seam (approved spec §5.4 error contract): a denied
 * create command is `400 { success: false, code: "INPUT_INVALID", requestId,
 * error }` with `Cache-Control: no-store` and NO Offer in the body, for an
 * unknown field (strict shape) as well as for an unsupported non-public
 * `activationKind`. Today's wire answers `INVALID_BODY` (route) and
 * `UNSUPPORTED_ACTIVATION_KIND` (domain) for those two cases, so this slice is
 * the contract mismatch the ticket tracks — not a new product decision.
 *
 * DB access is fixture bookkeeping only (never a business assertion): read the
 * seeded HQ identity, switch `discounts.contractVersion` to 1 for this
 * disposable DB (restored in afterAll), and delete ONLY rows this fixture
 * provably owns. `discount_admin_request` is unique on
 * `(actor_identity, request_key)` — NOT on the request key alone — so every
 * receipt lookup and delete is scoped to this seeded HQ user id AND the exact
 * request key, and a draft is cleared/deleted only after that receipt names it
 * as its target. Cleanup failures are collected and thrown from afterAll (never
 * a silent console warning) after the activation gate, browser context and pool
 * are restored in a `finally`, so a leak can never look green. New tables are
 * guarded with to_regclass because the route and its tables do not exist yet
 * (red); absent tables or an empty owned-receipt set are legitimate no-ops.
 *
 * Run: isolated mock config, DATABASE_URL pointing at an explicit disposable
 * `marketplace_discounts_test_*` database, `discounts-admin` added to both
 * playwright.mock.config.ts testMatch regexes.
 */
import { test, expect, type APIResponse, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

// --- Run-environment contract (supplied by playwright.mock.config.ts) -------

const ADMIN_BASE_URL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_BASE_URL = process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const ADMIN_PORT = "3111";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);
const DISPOSABLE_DB = /^marketplace_discounts_test_/;

const isLoopback = (host: string) => host === "127.0.0.1" || host === "localhost";

function databaseName(raw: string | undefined): string {
  try {
    return decodeURIComponent(new URL(String(raw)).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

/** Fail closed: isolated mock run on an explicit disposable DB only. */
function requireIsolatedDisposableRun(): void {
  if (process.env.E2E_PROVIDER_MOCKS !== "true" || !process.env.E2E_MOCK_ADMIN_BASE_URL || !process.env.E2E_MOCK_API_BASE_URL) {
    throw new Error("discounts-admin-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with both E2E mock base URLs set");
  }
  const admin = new URL(ADMIN_BASE_URL);
  const mock = new URL(MOCK_BASE_URL);
  if (!isLoopback(admin.hostname) || admin.port !== ADMIN_PORT) {
    throw new Error(`discounts-admin-mock.spec.ts refuses a non-loopback admin origin "${ADMIN_BASE_URL}"; the isolated admin origin is loopback:${ADMIN_PORT}`);
  }
  if (!isLoopback(mock.hostname) || !MOCK_PORTS.has(mock.port)) {
    throw new Error(`discounts-admin-mock.spec.ts refuses a non-loopback/foreign-port provider base "${MOCK_BASE_URL}"; isolated mock ports are 3110/3111/3112`);
  }
  const db = databaseName(process.env.DATABASE_URL);
  if (!DISPOSABLE_DB.test(db)) {
    throw new Error(`discounts-admin-mock.spec.ts refuses DATABASE_URL database "${db}"; it only seeds/cleans a disposable marketplace_discounts_test_* database`);
  }
}

// --- Fixture identity and constants -----------------------------------------

// hqmanager is the seeded HQ identity carrying the four approved global
// discounts/discount_capacity view+edit grants. Sign-in uses the public Better
// Auth HTTP seam (username), not the UI (its .env.local pins :3001).
const HQ = {
  identifier: process.env.E2E_ADMIN_HQ_IDENTIFIER || "hqmanager",
  password: process.env.E2E_ADMIN_HQ_PASSWORD || "hq123",
};

// Stable fixture key: identical on every run, so the replay assertion is real
// and an interrupted run is healed by exact key — never a target scan.
const REQUEST_KEY = "b6f1c2d4-3a58-4e0b-9c77-6d5a1e0f0616";
const CREATE_BODY = { requestKey: REQUEST_KEY, activationKind: "public" };
// A property the create-draft command does not define (benefits are a later
// slice), i.e. the legacy-shaped payload a strict body must refuse instead of
// silently dropping.
const UNKNOWN_FIELD = "discountPercent";
const CONTRACT_VERSION_KEY = "discounts.contractVersion";
const NEW_TABLES = ["discount_offer", "discount_offer_revision", "discount_benefit", "discount_offer_usage", "discount_code", "discount_admin_request"];

let pool: Pool;
let hqContext: BrowserContext;
let hqId = "";
let previousContractVersion: string | null | undefined;
let createdOfferId = "";
/** Offers created through the UI in this run (cleaned by id after a receipt
 * lookup proves the seeded HQ actor owns them). */
const uiOfferIds: string[] = [];

// --- Fixture bookkeeping (setup/teardown only — no business assertions) -----

async function httpSignIn(context: BrowserContext, base: string, identifier: string, password: string): Promise<void> {
  const response = await context.request.post(`${base}/api/auth/sign-in/username`, { data: { username: identifier, password } });
  expect(response.ok(), `HTTP sign-in seam failed for ${identifier}: ${await failureText(response)}`).toBe(true);
}

/**
 * Response envelope of the admin API: `success`/`data` on success, plus
 * `code`/`requestId` on a denial (spec §5.2).
 */
async function body(response: APIResponse) {
  return (await response.json()) as {
    success?: boolean;
    data?: Record<string, unknown>;
    code?: string;
    requestId?: string;
  };
}

/**
 * Bounded failure detail for `expect(..., message)` labels: a raw error body can
 * be large (or a whole HTML error page), so only the first 300 characters are
 * quoted and the total length is reported instead.
 */
function bounded(text: string, limit = 300): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… (${text.length} chars)`;
}

async function failureText(response: APIResponse): Promise<string> {
  return bounded(await response.text());
}

/**
 * One denied create command against the public admin HTTP seam (spec §5.4):
 * 400 `INPUT_INVALID`, `success: false`, no Offer identity in the body, a
 * non-empty `requestId` that matches the `x-request-id` header, and an
 * uncacheable response. Public response assertions only — this helper never
 * inspects the database.
 */
async function expectCreateDenied(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), `${label} must be refused: ${await failureText(response)}`).toBe(400);
  const headers = response.headers();
  expect(headers["cache-control"] ?? "", `${label} must not be cacheable`).toContain("no-store");
  const denied = await body(response);
  expect(denied.success, `${label} must report success:false`).toBe(false);
  expect(denied.code, `${label} must use the spec §5.4 input code`).toBe("INPUT_INVALID");
  expect(denied.data, `${label} must not return an Offer identity`).toBeUndefined();
  const requestId = denied.requestId ?? "";
  expect(requestId.length, `${label} must carry a non-empty requestId`).toBeGreaterThan(0);
  expect(headers["x-request-id"], `${label} requestId must match the x-request-id header`).toBe(requestId);
}

/** Cleanup failures are collected and thrown from afterAll — never swallowed. */
function cleanupFailure(label: string, error: unknown): string {
  return `${label}: ${(error as Error).message}`;
}

/** Which of this slice's tables exist yet (to_regclass on the disposable DB). */
async function existingTables(): Promise<Set<string>> {
  const result = await pool.query<{ name: string; present: boolean }>(
    "SELECT name, to_regclass('public.' || name) IS NOT NULL AS present FROM unnest($1::text[]) AS name",
    [NEW_TABLES]
  );
  return new Set(result.rows.filter((row) => row.present).map((row) => row.name));
}

/**
 * Deletes ONE draft this fixture provably owns, in FK order. Ownership is
 * proven by a receipt scoped to the seeded HQ actor identity AND this fixture's
 * exact request key: `(actor_identity, request_key)` is the unique pair, so a
 * draft another actor created — even under the same request key — is never
 * touched, and a response id alone is never trusted. The pointer is cleared
 * first because the Offer references its current revision. Returns false (a
 * legitimate no-op) when the receipt store does not exist yet (red) or when no
 * receipt of this actor/key names this target. SQL errors are thrown so cleanup
 * can fail the run instead of leaking silently.
 */
async function deleteOwnDraft(offerId: string, actorId: string): Promise<boolean> {
  const tables = await existingTables();
  const has = (name: string) => tables.has(name);
  if (!has("discount_admin_request")) return false;
  const receipt = await pool.query(
    "SELECT 1 FROM discount_admin_request WHERE actor_identity = $1 AND request_key = $2 AND target_id = $3",
    [actorId, REQUEST_KEY, offerId]
  );
  if (receipt.rowCount === 0) return false;
  await deleteOfferRows(offerId, actorId);
  return true;
}

/**
 * Deletes ONE Offer created through the UI. Ownership is proven by a receipt
 * whose `target_id` is this Offer and whose immutable actor identity is the
 * seeded HQ user; a foreign Offer id is never touched.
 */
async function deleteOfferById(offerId: string, actorId: string): Promise<boolean> {
  const tables = await existingTables();
  const has = (name: string) => tables.has(name);
  if (!has("discount_admin_request")) return false;
  const receipt = await pool.query(
    "SELECT 1 FROM discount_admin_request WHERE actor_identity = $1 AND target_id = $2",
    [actorId, offerId]
  );
  if (receipt.rowCount === 0) return false;
  await deleteOfferRows(offerId, actorId);
  return true;
}

/** FK-ordered removal of one proven-owned Offer and every row it produced. */
async function deleteOfferRows(offerId: string, actorId: string): Promise<void> {
  const tables = await existingTables();
  const has = (name: string) => tables.has(name);
  const steps: Array<[string, string, unknown[]]> = [];
  // The Offer→current-revision pointer is RESTRICT and a non-draft Offer must
  // keep one, so the state is reset together with the pointer.
  if (has("discount_offer")) steps.push(["clear-current-pointer", "UPDATE discount_offer SET state = 'draft', current_revision_id = NULL WHERE id = $1", [offerId]]);
  if (has("discount_code")) steps.push(["codes", "DELETE FROM discount_code WHERE offer_id = $1", [offerId]]);
  if (has("discount_benefit") && has("discount_offer_revision")) steps.push(["benefit", "DELETE FROM discount_benefit WHERE revision_id IN (SELECT id FROM discount_offer_revision WHERE offer_id = $1)", [offerId]]);
  if (has("discount_offer_revision")) steps.push(["revision", "DELETE FROM discount_offer_revision WHERE offer_id = $1", [offerId]]);
  if (has("discount_offer_usage")) steps.push(["usage", "DELETE FROM discount_offer_usage WHERE offer_id = $1", [offerId]]);
  steps.push(["receipt", "DELETE FROM discount_admin_request WHERE actor_identity = $1 AND target_id = $2", [actorId, offerId]]);
  steps.push(["audit", "DELETE FROM audit_log WHERE entity_id = $1 AND user_id = $2", [offerId, actorId]]);
  if (has("discount_offer")) steps.push(["offer", "DELETE FROM discount_offer WHERE id = $1", [offerId]]);
  for (const [label, sql, params] of steps) {
    try {
      await pool.query(sql, params);
    } catch (error) {
      throw new Error(cleanupFailure(`delete-offer-rows:${label}`, error));
    }
  }
}

/**
 * Drafts left by an earlier run of THIS fixture. Scoped to the same
 * `(actor_identity, request_key)` pair as the receipts themselves, so a foreign
 * actor's row with the identical request key is never selected.
 */
async function ownedDraftIds(actorId: string): Promise<string[]> {
  if (!(await existingTables()).has("discount_admin_request")) return [];
  const result = await pool.query<{ target_id: string | null }>(
    "SELECT DISTINCT target_id FROM discount_admin_request WHERE actor_identity = $1 AND request_key = $2 AND target_id IS NOT NULL",
    [actorId, REQUEST_KEY]
  );
  return result.rows.map((row) => row.target_id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** The seeded HQ persona must exist — setup SQL, not an assertion. */
async function readSeededHqId(): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE username = $1', [HQ.identifier]);
  const id = result.rows[0]?.id ?? "";
  if (!id) throw new Error(`seeded HQ persona "${HQ.identifier}" is missing from this disposable DB — seed it with db:seed`);
  return id;
}

/**
 * The new-contract admin writer is fenced on `discounts.contractVersion`
 * (default 0). Activation 1 is allowed only in a disposable environment, so it
 * is switched on here and restored in afterAll.
 */
async function activateContractVersion(): Promise<void> {
  const result = await pool.query<{ value: string }>("SELECT value FROM system_config WHERE key = $1", [CONTRACT_VERSION_KEY]);
  previousContractVersion = result.rows[0]?.value ?? null;
  if (previousContractVersion === "1") return;
  if (previousContractVersion === null) {
    await pool.query("INSERT INTO system_config (key, value, type) VALUES ($1, '1', 'number')", [CONTRACT_VERSION_KEY]);
    return;
  }
  await pool.query("UPDATE system_config SET value = '1' WHERE key = $1", [CONTRACT_VERSION_KEY]);
}

async function restoreContractVersion(): Promise<void> {
  // `undefined` means activation never ran — leave the seeded value alone.
  if (previousContractVersion === undefined || previousContractVersion === "1") return;
  if (previousContractVersion === null) {
    await pool.query("DELETE FROM system_config WHERE key = $1", [CONTRACT_VERSION_KEY]);
    return;
  }
  await pool.query("UPDATE system_config SET value = $2 WHERE key = $1", [CONTRACT_VERSION_KEY, previousContractVersion]);
}

// --- Fixture lifecycle ------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedDisposableRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  hqId = await readSeededHqId();
  await activateContractVersion();
  // Heal drafts an interrupted earlier run of THIS actor/key left behind.
  for (const id of await ownedDraftIds(hqId)) await deleteOwnDraft(id, hqId);

  hqContext = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  await httpSignIn(hqContext, ADMIN_BASE_URL, HQ.identifier, HQ.password);
});

test.afterAll(async () => {
  const failures: string[] = [];

  try {
    if (pool && hqId && createdOfferId) {
      const deleted = await deleteOwnDraft(createdOfferId, hqId);
      // A draft we created must be named by our own receipt; refusing to delete
      // an unproven id is the safe choice, but it is a leak the run must report.
      if (!deleted) failures.push(`draft ${createdOfferId} is not named by a receipt for actor ${hqId} / key ${REQUEST_KEY}; refused to delete an unproven draft (inspect this disposable DB)`);
    }

    // UI-created Offers: each must be proven by a receipt for this seeded actor
    // before any row is deleted.
    for (const offerId of uiOfferIds) {
      try {
        const deleted = await deleteOfferById(offerId, hqId);
        if (!deleted) failures.push(`UI offer ${offerId} is not named by a receipt for actor ${hqId}; refused to delete an unproven Offer (inspect this disposable DB)`);
      } catch (error) {
        failures.push(cleanupFailure(`ui-draft-cleanup:${offerId}`, error));
      }
    }
  } catch (error) {
    failures.push(cleanupFailure("draft-cleanup", error));
  } finally {
    // Restore the activation gate, the session and the pool even when the draft
    // cleanup above threw, so one cleanup error cannot strand the environment.
    try {
      if (pool) await restoreContractVersion();
    } catch (error) {
      failures.push(cleanupFailure("contract-version-restore", error));
    }
    try {
      await hqContext?.close();
    } catch (error) {
      failures.push(cleanupFailure("context-close", error));
    }
    try {
      if (pool) await pool.end();
    } catch (error) {
      failures.push(cleanupFailure("pool-end", error));
    }
  }

  // Throwing keeps any primary assertion failure intact AND turns a leak into a
  // reported failure instead of a green run.
  if (failures.length > 0) throw new Error(`[discounts-admin-mock] cleanup failed:\n- ${failures.join("\n- ")}`);
});

// --- The slice: create a public fixed Offer draft, replay it, read it back ---

test.describe("admin public fixed Offer draft", () => {
  test("HQ creates one public draft, the same request key replays it, and the detail read stays an unlaunchable draft", async () => {
    // 1) Create — an incomplete draft is explicitly allowed (no quota/budget).
    const create = await hqContext.request.post("/api/admin/discounts", { data: CREATE_BODY });
    expect(create.status(), `create draft failed: ${await failureText(create)}`).toBe(201);
    const created = await body(create);
    expect(created.success).toBe(true);
    const draft = created.data ?? {};
    createdOfferId = String(draft.id ?? "");
    expect(createdOfferId.length, "the created draft must return its Offer id").toBeGreaterThan(0);
    expect(draft).toMatchObject({ state: "draft", activationKind: "public", currentRevisionId: null, version: 1, draftVersion: 1 });

    // 2) Replay with the exact same key + payload: stored result, same Offer.
    const replay = await hqContext.request.post("/api/admin/discounts", { data: CREATE_BODY });
    expect(replay.status(), `request-key replay failed: ${await failureText(replay)}`).toBe(200);
    const replayed = await body(replay);
    expect(replayed.success).toBe(true);
    expect(replayed.data?.id, "a replay must return the SAME Offer instead of creating a second one").toBe(createdOfferId);
    expect(replayed.data?.state).toBe("draft");

    // 3) Detail read — same identity, still draft, no published revision.
    const detail = await hqContext.request.get(`/api/admin/discounts/${createdOfferId}`);
    expect(detail.status(), `draft detail read failed: ${await failureText(detail)}`).toBe(200);
    const read = await body(detail);
    expect(read.success).toBe(true);
    expect(read.data).toMatchObject({ id: createdOfferId, state: "draft", activationKind: "public", currentRevisionId: null });
  });
});

// --- The denial slice: invalid create commands are refused, key not claimed --

test.describe("admin draft create denials", () => {
  test("HQ's strict-shape and non-public-kind commands are refused with 400 INPUT_INVALID and never claim the fixture request key", async () => {
    // 1) Unknown field: `discountPercent` is not part of the create-draft
    //    command, so the body must fail strict validation. It reuses the
    //    fixture key on purpose — a body that was accepted anyway would claim
    //    that key.
    await expectCreateDenied(
      await hqContext.request.post("/api/admin/discounts", { data: { ...CREATE_BODY, [UNKNOWN_FIELD]: 100 } }),
      "an unknown field in the create command"
    );

    // 2) Unsupported activation kind: manual-only Offers are a later slice, so
    //    `manual` is an explicit input denial, never a silent default to public.
    await expectCreateDenied(
      await hqContext.request.post("/api/admin/discounts", { data: { ...CREATE_BODY, activationKind: "manual" } }),
      "activationKind: manual"
    );

    // 3) Neither denial claimed the fixture key: the exact valid command still
    //    resolves — 201 as this run's first create, or 200 replaying the draft
    //    the happy-path test created. A key claimed by a denial would surface
    //    here as 409 REQUEST_KEY_CONFLICT instead.
    const afterDenials = await hqContext.request.post("/api/admin/discounts", { data: CREATE_BODY });
    expect(afterDenials.status(), `the valid command must still own the fixture key: ${await failureText(afterDenials)}`).toBe(createdOfferId ? 200 : 201);
    const accepted = await body(afterDenials);
    expect(accepted.success).toBe(true);
    const acceptedId = String(accepted.data?.id ?? "");
    expect(acceptedId.length, "the accepted command must return an Offer id").toBeGreaterThan(0);
    if (createdOfferId) {
      expect(acceptedId, "a denied command must not claim the fixture key: the valid command still resolves to the SAME draft").toBe(createdOfferId);
    } else {
      // This test ran before the happy-path one: the lifecycle still owns the draft.
      createdOfferId = acceptedId;
    }
  });
});

// --- The acceptance flow (B): draft -> simulate -> review -> publish -> pause -

test.describe("admin discounts UI", () => {
  test.setTimeout(90_000);

  test("HQ completes draft -> simulate -> review -> publish -> pause from the admin pages", async () => {
    const page = await hqContext.newPage();
    try {
      // 1) List -> create draft. The Offer id is taken from the navigated URL
      //    and registered for receipt-proven cleanup.
      await page.goto("/admin/discounts");
      await page.getByRole("button", { name: "Buat draft" }).click();
      await page.waitForURL(/\/admin\/discounts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
      const offerId = page.url().split("/").pop() ?? "";
      expect(offerId.length, "the created draft must navigate to its detail page").toBe(36);
      uiOfferIds.push(offerId);

      // 2) Save complete draft terms with one fixed-goods benefit.
      await page.getByLabel("Nama offer").fill("Diskon Rp17.000 Sepatu Pilihan");
      await page.getByLabel("Minimum subtotal (Rp)").fill("100000");
      await page.getByLabel("Nominal fixed-goods (Rp)").fill("17000");
      await page.getByRole("button", { name: "Simpan draft" }).click();
      await expect(page.getByRole("main").getByText("Draft disimpan")).toBeVisible();

      // 3) Capacity: a live Offer needs at least one global bound.
      await page.getByLabel("Kuota pemakaian").fill("10");
      await page.getByRole("button", { name: "Simpan kapasitas" }).click();
      await expect(page.getByText("Kapasitas disimpan")).toBeVisible();

      // 4) Simulation through the shared pricing interface. Literal from the
      //    spec: 150000 - 17000 = 133000 net goods, 11% PPN 14630, total 147630.
      await page.getByRole("button", { name: "Jalankan simulasi" }).click();
      await expect(page.getByText(/147\.630/)).toBeVisible();
      await expect(page.getByText(/Simulasi admin: bukan quote/)).toBeVisible();

      // 5) Review shows the server-bound validations and enables publish.
      await page.getByRole("button", { name: "Review draft" }).click();
      await expect(page.getByText(/Review siap publish/)).toBeVisible();
      await expect(page.getByText("Benefit goods version1 dengan parameter valid")).toBeVisible();

      // 6) Publish, then pause. Pausing is only offered for a live Offer.
      await page.getByRole("button", { name: "Publish offer" }).click();
      await expect(page.getByText("Offer dipublikasikan")).toBeVisible();
      const pauseButton = page.getByRole("button", { name: "Jeda" });
      await expect(pauseButton).toBeVisible();
      await pauseButton.click();
      await page.getByRole("button", { name: "Ya, lanjutkan" }).click();
      await expect(page.getByRole("button", { name: "Aktifkan" })).toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// =========================================================
// Ticket 10 — percentage goods
// =========================================================
test.describe("admin percentage goods UI", () => {
  test.setTimeout(90_000);

  test("HQ menyimpan draft persentase, mensimulasikan floor/cap, dan review valid", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto("/admin/discounts");
      await page.getByRole("button", { name: "Buat draft" }).click();
      await page.waitForURL(/\/admin\/discounts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
      const offerId = page.url().split("/").pop() ?? "";
      expect(offerId.length, "the created draft must navigate to its detail page").toBe(36);
      uiOfferIds.push(offerId);

      await page.getByLabel("Nama offer").fill("Diskon 10% maksimal Rp20.000");
      await page.getByLabel("Minimum subtotal (Rp)").fill("0");
      await page.getByLabel("Jenis benefit").click();
      await page.getByRole("option", { name: "Persentase barang" }).click();
      await page.getByLabel("Persentase (%)").fill("10");
      await page.getByLabel("Cap (Rp, opsional)").fill("20000");
      await page.getByRole("button", { name: "Simpan draft" }).click();
      await expect(page.getByRole("main").getByText("Draft disimpan")).toBeVisible();

      await page.getByLabel("Kuota pemakaian").fill("10");
      await page.getByRole("button", { name: "Simpan kapasitas" }).click();
      await expect(page.getByText("Kapasitas disimpan")).toBeVisible();

      // Simulasi default 150000 unit: 10% = 15000 (cap20000 belum mengikat),
      // net135000, PPN14850, total149850. Literal independen dari spec §4.4.
      await page.getByRole("button", { name: "Jalankan simulasi" }).click();
      await expect(page.getByText(/149\.850/)).toBeVisible();
      await expect(page.getByText(/Simulasi admin: bukan quote/)).toBeVisible();

      await page.getByRole("button", { name: "Review draft" }).click();
      await expect(page.getByText(/Review siap publish/)).toBeVisible();
      await expect(page.getByText("Benefit goods version1 dengan parameter valid")).toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// =========================================================
// Ticket 11 — shipping subsidy administration
// =========================================================
test.describe("admin shipping subsidy UI", () => {
  test.setTimeout(90_000);

  test("HQ menyimpan draft shipping cap, simulasi delivery berongkir, dan review valid", async () => {
    const page = await hqContext.newPage();
    try {
      await page.goto("/admin/discounts");
      await page.getByRole("button", { name: "Buat draft" }).click();
      await page.waitForURL(/\/admin\/discounts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
      const offerId = page.url().split("/").pop() ?? "";
      expect(offerId.length, "the created draft must navigate to its detail page").toBe(36);
      uiOfferIds.push(offerId);

      await page.getByLabel("Nama offer").fill("Subsidi Ongkir Rp20.000");
      await page.getByLabel("Minimum subtotal (Rp)").fill("0");
      await page.getByLabel("Jenis benefit").click();
      await page.getByRole("option", { name: "Subsidi ongkir (cap Rp)" }).click();
      await page.getByLabel("Cap subsidi ongkir (Rp)").fill("20000");
      await page.getByRole("button", { name: "Simpan draft" }).click();
      await expect(page.getByRole("main").getByText("Draft disimpan")).toBeVisible();

      await page.getByLabel("Kuota pemakaian").fill("10");
      await page.getByRole("button", { name: "Simpan kapasitas" }).click();
      await expect(page.getByText("Kapasitas disimpan")).toBeVisible();

      // Simulasi delivery: barang150000 + ongkir30000 cap20000 → subsidi20000,
      // net ongkir10000, PPN16500, total176500 (literal spec §4.4).
      await page.getByRole("combobox").last().click();
      await page.getByRole("option", { name: "Delivery" }).click();
      await page.getByRole("textbox", { name: "Ongkir (Rp)", exact: true }).fill("30000");
      await page.getByRole("button", { name: "Jalankan simulasi" }).click();
      await expect(page.getByText(/176.500/)).toBeVisible();
      await expect(page.getByText(/Subsidi ongkir: Rp 20.000/)).toBeVisible();
      await expect(page.getByText(/Simulasi admin: bukan quote/)).toBeVisible();

      await page.getByRole("button", { name: "Review draft" }).click();
      await expect(page.getByText(/Review siap publish/)).toBeVisible();
      await expect(page.getByText("Benefit shipping version1 (cap ongkir positif) valid")).toBeVisible();

      await page.getByRole("button", { name: "Publish offer" }).click();
      await expect(page.getByText("Offer dipublikasikan")).toBeVisible();
    } finally {
      await page.close();
    }
  });
});

// =========================================================
// Ticket 09 — Manual Promo Code administration
// =========================================================
// Create a manual_only Offer with reserved canonical codes through the public
// admin HTTP seam, prove the editor sees the literal and the viewer channel is
// masked, and exercise add/state from the editor UI. The viewer fixture adds a
// TEMPORARY discounts:view grant to the seeded Admin role and removes exactly
// that grant afterwards.
const MANUAL_REQUEST_KEY = "6d3f8a21-4c47-4b19-a2f6-9d1b7c5e0917";
const MANUAL_CODE = "MANUALADMIN25";

test.describe("admin Manual Promo Code", () => {
  let manualOfferId = "";
  let viewerGrantId = "";
  let viewerRoleId = "";

  test.afterAll(async () => {
    if (!pool) return;
    const failures: string[] = [];
    try {
      if (manualOfferId && hqId) {
        const deleted = await deleteOfferById(manualOfferId, hqId);
        if (!deleted) failures.push(`manual offer ${manualOfferId} is not named by a receipt for actor ${hqId}`);
      }
    } catch (error) {
      failures.push(cleanupFailure("manual-offer-cleanup", error));
    }
    try {
      if (viewerGrantId) {
        await pool.query("DELETE FROM admin_role_grant WHERE id = $1", [viewerGrantId]);
      }
    } catch (error) {
      failures.push(cleanupFailure("viewer-grant-cleanup", error));
    }
    if (failures.length > 0) throw new Error(`[discounts-admin-mock] manual cleanup failed: ${failures.join("; ")}`);
  });

  test("HQ creates a manual Offer with codes, adds/changes a code in the editor, and a viewer only sees masked labels", async () => {
    // Heal an interrupted earlier run: delete any Offer named by a receipt for
    // THIS actor + fixture key before creating, so the canonical codes are free.
    const leftovers = await pool.query<{ target_id: string | null }>(
      "SELECT DISTINCT target_id FROM discount_admin_request WHERE actor_identity = $1 AND request_key = $2 AND target_id IS NOT NULL",
      [hqId, MANUAL_REQUEST_KEY]
    );
    for (const row of leftovers.rows) {
      if (row.target_id) await deleteOfferById(row.target_id, hqId);
    }

    const created = await hqContext.request.post(`${ADMIN_BASE_URL}/api/admin/discounts`, {
      data: {
        requestKey: MANUAL_REQUEST_KEY,
        activationKind: "manual_only",
        codes: ["manualadmin25", "ManualAdminOff"],
      },
    });
    const createStatus = created.status();
    expect([200, 201], await failureText(created)).toContain(createStatus);
    const createdBody = await body(created);
    manualOfferId = String(createdBody.data?.id ?? "");
    expect(manualOfferId.length).toBeGreaterThan(0);
    const createdCodes = (createdBody.data?.codes ?? []) as Array<{
      id: string;
      code?: string;
      maskedCode: string;
      state: string;
    }>;
    expect(createdBody.data?.codeLiteralVisible).toBe(true);
    expect(createdCodes.map((code) => code.code)).toEqual(
      expect.arrayContaining(["MANUALADMIN25", "MANUALADMINOFF"])
    );

    // Editor detail carries the literal; the list never does.
    const detail = await hqContext.request.get(`${ADMIN_BASE_URL}/api/admin/discounts/${manualOfferId}`);
    expect(detail.ok(), await failureText(detail)).toBe(true);
    const detailBody = await body(detail);
    expect(detailBody.data?.codeLiteralVisible).toBe(true);

    // Editor UI: add a code, then archive it. Mengetik tidak menulis apa pun;
    // tombol Tambah adalah transaksi request-key + expected version.
    const page = await hqContext.newPage();
    try {
      await page.goto(`/admin/discounts/${manualOfferId}`);
      await expect(page.getByText("Kode manual", { exact: true })).toBeVisible();
      await expect(page.getByText(MANUAL_CODE)).toBeVisible();
      await page.getByLabel("Tambah kode").fill("extraadmin25");
      await page.getByRole("button", { name: "Tambah", exact: true }).click();
      const extraRow = page.getByRole("row", { name: /EXTRAADMIN25/ });
      await expect(extraRow).toBeVisible();
      await extraRow.getByRole("button", { name: "Nonaktifkan" }).click();
      await expect(extraRow.getByText("Nonaktif")).toBeVisible();
      await extraRow.getByRole("button", { name: "Arsipkan" }).click();
      await expect(extraRow.getByText("Arsip")).toBeVisible();
      await expect(extraRow.getByRole("button", { name: "Aktifkan" })).toHaveCount(0);
    } finally {
      await page.close();
    }

    // Viewer: temporary discounts:view grant on the seeded Admin role, no edit.
    const adminUser = await pool.query<{ id: string; role_id: string | null }>(
      'SELECT id, role_id FROM "user" WHERE username = $1',
      ["admintoko"]
    );
    viewerRoleId = adminUser.rows[0]?.role_id ?? "";
    expect(viewerRoleId.length).toBeGreaterThan(0);
    const grantId = `${viewerRoleId}-discounts-view-e2e-manual`;
    const existingGrant = await pool.query(
      "SELECT 1 FROM admin_role_grant WHERE role_id = $1 AND module = 'discounts' AND action = 'view'",
      [viewerRoleId]
    );
    if ((existingGrant.rowCount ?? 0) === 0) {
      await pool.query(
        `INSERT INTO admin_role_grant (id, role_id, module, action, scope)
         VALUES ($1, $2, 'discounts', 'view', 'global')`,
        [grantId, viewerRoleId]
      );
      viewerGrantId = grantId;
    }

    const viewerBrowser = hqContext.browser();
    if (!viewerBrowser) throw new Error("admin browser context is unavailable");
    const viewer = await viewerBrowser.newContext({ baseURL: ADMIN_BASE_URL });
    try {
      await httpSignIn(viewer, ADMIN_BASE_URL, "admintoko", "admin123");
      const maskedDetail = await viewer.request.get(`${ADMIN_BASE_URL}/api/admin/discounts/${manualOfferId}`);
      expect(maskedDetail.ok(), await failureText(maskedDetail)).toBe(true);
      const maskedBody = await body(maskedDetail);
      expect(maskedBody.data?.codeLiteralVisible).toBe(false);
      const maskedCodes = (maskedBody.data?.codes ?? []) as Array<Record<string, unknown>>;
      expect(maskedCodes.length).toBeGreaterThan(0);
      for (const code of maskedCodes) {
        expect(code.code).toBeUndefined();
        expect(String(code.maskedCode)).toContain("•");
        expect(String(code.maskedCode)).not.toBe(MANUAL_CODE);
      }
      expect(JSON.stringify(maskedBody)).not.toContain(MANUAL_CODE);

      const maskedList = await viewer.request.get(`${ADMIN_BASE_URL}/api/admin/discounts?limit=50`);
      expect(maskedList.ok(), await failureText(maskedList)).toBe(true);
      const listText = JSON.stringify(await maskedList.json());
      expect(listText).not.toContain(MANUAL_CODE);
      expect(listText).not.toContain("EXTRAADMIN25");
    } finally {
      await viewer.close();
    }
  });
});
