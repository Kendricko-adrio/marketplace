/**
 * Ticket 02 — mock-only client address book (browser + HTTP + DB fixture seam).
 *
 * ONE Playwright spec that proves the ticket-02 slice end to end WITHOUT any
 * live provider traffic (spec Ready + implementation tracker 02):
 *
 *   a signed-in store client creates an address through the browser form
 *   (Nama Penerima / Nomor Telepon / Provinsi / Kota/Kabupaten / Kecamatan /
 *   Kelurahan/Area / Kode Pos / Alamat Lengkap) choosing the mock Shipment
 *   region hierarchy, the saved card renders the canonical region names and
 *   postal code, "Jadikan utama" switches the single default, Edit rewrites
 *   the saved phone, "Hapus" removes the address — and another client can
 *   neither see, edit, promote nor delete that address over the public
 *   /api/addresses HTTP seam.
 *
 * Independent source of truth: the literal mock-provider region fixture below
 * (province "01"/"Fixture Province", city "0101"/"Fixture City",
 * district "010101"/"Fixture District", area "01010101"/"Fixture Area",
 * postal "01234") — never values recomputed from the implementation.
 *
 * Seams (pre-agreed):
 * - Browser: /account/addresses form + list actions
 *   (labels Nama Penerima, Nomor Telepon, Provinsi, Kota/Kabupaten, Kecamatan,
 *   Kelurahan/Area, Kode Pos, Alamat Lengkap; save "Simpan alamat";
 *   actions "Jadikan utama"/"Set jadikan utama", "Edit", "Hapus").
 * - Public HTTP: Better Auth sign-in, GET/POST /api/addresses,
 *   PATCH/DELETE /api/addresses/{id}, POST /api/addresses/{id}/default, and
 *   the mock-backed region lookups GET /api/shipment/regions?level=provinces
 *   (cities &parentId=…, districts &parentId=…, areas &parentId=…).
 * - Database fixture seam: the spec creates its own onboarding-complete
 *   fixture clients (prefix "addrmock-e2e-") directly mirroring the seeder and
 *   deletes them (cascade) in afterAll. Seeded rows are never reset.
 *
 * RED UNTIL THE PARENT IMPLEMENTS (in this order):
 * 1. `E2E_PROVIDER_MOCKS=true` must unlock the mock shipment region gateway in
 *    the store runtime (loopback-pinned, fail-closed, no live fallback). Until
 *    then the region endpoint/UI selects have no fixture data and saving must
 *    fail closed — that IS the expected red.
 * 2. The store endpoints GET /api/shipment/regions?level=provinces (plus
 *    cities/districts/areas by parentId) and the address book endpoints
 *    (/api/addresses, /api/addresses/{id}, /api/addresses/{id}/default) do not
 *    exist yet → the create/save/ownership assertions below fail (red).
 * 3. The /account/addresses page (form + list + actions) does not exist yet.
 * 4. The shared `address` schema misses the Shipment region columns; the
 *    implementer adds them ONLY in packages/db/src/schema/ + `npm run db:push`.
 * 5. apps/jubelio-mock (loopback 127.0.0.1:3112) must serve the fixture region
 *    hierarchy above (and nothing else needs a new mock endpoint for this
 *    slice — no quote/order/booking interactions here).
 *
 * Run with the isolated mock config (never alongside the live suite); the
 * parent selects this spec by updating playwright.mock.config.ts:
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import dotenv from "dotenv";
import { contrastRatio, readSurfaceColor, readTextColor, FAINT_PLACEHOLDER_MAX, FAINT_PLACEHOLDER_MIN } from "../support/contrast";
dotenv.config({ path: ".env" });

// ---------------------------------------------------------------------------
// Run-environment contract (also set by playwright.mock.config.ts; keep in sync)
// ---------------------------------------------------------------------------

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

/** Fail closed unless the ISOLATED mock run (loopback flags pinned). */
function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "addresses-mock.spec.ts must run under playwright.mock.config.ts: E2E_PROVIDER_MOCKS=true with E2E_MOCK_STORE_BASE_URL/E2E_MOCK_API_BASE_URL set"
    );
  }
  for (const [name, raw] of [
    ["store", STORE_BASE_URL],
    ["mock", MOCK_BASE_URL],
  ] as const) {
    const parsed = new URL(raw);
    const loopback =
      parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (!loopback || !MOCK_PORTS.has(parsed.port)) {
      throw new Error(
        `addresses-mock.spec.ts refuses a non-loopback/foreign-port ${name} base (${raw}); the isolated mock ports are 3110/3111/3112`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Independent fixture: one region hierarchy + two fixture clients
// ---------------------------------------------------------------------------

const REGION = {
  provinceId: "01",
  province: "Fixture Province",
  cityId: "0101",
  city: "Fixture City",
  districtId: "010101",
  district: "Fixture District",
  areaId: "01010101",
  area: "Fixture Area",
  postalCode: "01234",
} as const;

type AddressFixture = {
  recipientName: string;
  phone: string;
  street: string;
};

const ALICE_FIRST: AddressFixture = {
  recipientName: "E2E Penerima Alice",
  phone: "081300000001",
  street: "Jl. Fixture Alamat No. 1, Patokan Lampu",
};
const ALICE_SECOND: AddressFixture = {
  recipientName: "E2E Penerima Alice Dua",
  phone: "081300000002",
  street: "Jl. Fixture Alamat No. 2",
};
const EDITED_PHONE = "081399999991";
const BOB_FIXTURE: AddressFixture = {
  recipientName: "E2E Penerima Bob",
  phone: "081400000009",
  street: "Jl. Fixture Bob No. 9",
};

const FIXTURE_CLIENT_PREFIX = "addrmock-e2e-";
const ALICE_EMAIL = "addrmock-alice-e2e@example.test";
const BOB_EMAIL = "addrmock-bob-e2e@example.test";
const FIXTURE_PASSWORD = "AddrMock2026"; // 8+ chars, upper + lower + digit

// ---------------------------------------------------------------------------
// Own browser contexts (no storageState): sessions are created through the
// public Better Auth HTTP seam, which is same-origin and works on the isolated
// ports (e2e/store/pickup-mock.spec.ts pattern).
// ---------------------------------------------------------------------------

let aliceContext: BrowserContext;
let bobContext: BrowserContext;

// ---------------------------------------------------------------------------
// Database fixture
// ---------------------------------------------------------------------------

let pool: Pool;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Signs in a Better Auth session over public HTTP on the isolated origin. */
async function httpSignIn(
  context: BrowserContext,
  base: string,
  identifier: string,
  password: string
): Promise<void> {
  const isEmail = identifier.includes("@");
  const response = await context.request.post(
    `${base}/api/auth/sign-in/${isEmail ? "email" : "username"}`,
    {
      data: isEmail ? { email: identifier, password } : { username: identifier, password },
    }
  );
  expect(
    response.ok(),
    `HTTP sign-in seam failed for ${identifier}: ${await response.text()}`
  ).toBe(true);
}

type Row = Record<string, unknown>;

/** Accepts the repo convention { success, data } envelope or a plain array. */
function unwrapList(payload: unknown): Array<Row> {
  if (Array.isArray(payload)) return payload as Array<Row>;
  const data = (payload as { data?: unknown } | null)?.data;
  if (Array.isArray(data)) return data as Array<Row>;
  throw new Error(
    `unexpected address list envelope: ${JSON.stringify(payload).slice(0, 200)}`
  );
}

/** Accepts { id } at top level or inside the { data } envelope. */
function unwrapId(payload: unknown): string {
  for (const candidate of [payload, (payload as { data?: unknown } | null)?.data]) {
    const id = (candidate as Row | null | undefined)?.id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  throw new Error(
    `address create must return the id: ${JSON.stringify(payload).slice(0, 200)}`
  );
}

function streetOf(row: Row): string {
  return String(row.fullAddress ?? row.full_address ?? "");
}

function phoneOf(row: Row): string {
  return String(row.phone ?? row.phone_number ?? "");
}

function isDefaultRow(row: Row): boolean {
  return row.isDefault === true || row.is_default === true;
}

function rowByStreet(rows: Array<Row>, street: string): Row {
  const row = rows.find((candidate) => streetOf(candidate) === street);
  expect(row, `address row ${street} must be in the client's address list`).toBeTruthy();
  return row as Row;
}

function httpAddressInput(address: AddressFixture, isDefault: boolean) {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    fullAddress: address.street,
    provinceId: REGION.provinceId,
    cityId: REGION.cityId,
    districtId: REGION.districtId,
    areaId: REGION.areaId,
    postalCode: REGION.postalCode,
    isDefault,
  };
}

/** Lists the currently default addresses (streets) through the public API. */
async function defaultStreets(context: BrowserContext): Promise<string[]> {
  const response = await context.request.get("/api/addresses");
  expect(response.ok(), `address list failed: ${await response.text()}`).toBe(true);
  return unwrapList(await response.json())
    .filter((row) => isDefaultRow(row))
    .map((row) => streetOf(row));
}

/** The innermost container that both carries the unique street and a button. */
function addressCard(page: import("@playwright/test").Page, streetMarker: string) {
  return page
    .locator("li, div, article, section")
    .filter({ hasText: streetMarker })
    .filter({ has: page.getByRole("button") })
    .last();
}

/** Opens the address form — inline, or behind an add-address trigger. */
async function openAddressForm(page: import("@playwright/test").Page): Promise<void> {
  const trigger = page
    .getByRole("button", { name: /tambah|alamat baru|buat alamat/i })
    .first();
  try {
    await trigger.click({ timeout: 3_000 });
  } catch {
    // No standalone trigger: the form is inline on the page.
  }
}

async function pickRegion(
  page: import("@playwright/test").Page,
  comboboxIndex: number,
  optionName: string
): Promise<void> {
  await page.getByRole("combobox").nth(comboboxIndex).click();
  const option = page.getByRole("option", { name: optionName });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

/** Fills the address form with the mock region hierarchy and saves it. */
async function fillAndSaveAddress(page: import("@playwright/test").Page, address: AddressFixture): Promise<void> {
  await openAddressForm(page);
  await page.getByLabel("Nama Penerima").fill(address.recipientName);
  await page.getByLabel("Nomor Telepon").fill(address.phone);
  await pickRegion(page, 0, REGION.province);
  await pickRegion(page, 1, REGION.city);
  await pickRegion(page, 2, REGION.district);
  await pickRegion(page, 3, REGION.area);
  await page.getByLabel("Alamat Lengkap").fill(address.street);
  // Kode Pos belongs to the chosen Kelurahan/Area (fixture "01234"). Only an
  // editable input is filled; a read-only/auto-derived control is proven on
  // the saved card below.
  const postal = page.getByLabel("Kode Pos");
  if ((await postal.count()) > 0) {
    const editable = await postal.evaluate((element) =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? !element.readOnly && !element.disabled
        : false
    );
    if (editable) await postal.fill(REGION.postalCode);
  }
  await page.getByRole("button", { name: /simpan alamat/i }).click();
}

// ---------------------------------------------------------------------------
// Fixture lifecycle
// ---------------------------------------------------------------------------

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Heal leftovers from an interrupted previous run, then create the fixture
  // identities exactly like the seeder does (bcryptjs credential accounts).
  await pool.query(`DELETE FROM "client" WHERE email = ANY($1::text[])`, [
    [ALICE_EMAIL, BOB_EMAIL],
  ]);
  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);
  for (const [id, name, email] of [
    [`${FIXTURE_CLIENT_PREFIX}alice`, "Alice AddressMock", ALICE_EMAIL],
    [`${FIXTURE_CLIENT_PREFIX}bob`, "Bob AddressMock", BOB_EMAIL],
  ] as const) {
    await pool.query(
      `INSERT INTO "client" (id, name, email, email_verified, onboarding_completed)
       VALUES ($1, $2, $3, true, true)`,
      [id, name, email]
    );
    await pool.query(
      `INSERT INTO client_account (id, user_id, account_id, provider_id, password)
       VALUES ($1, $2, $2, 'credential', $3)`,
      [`${id}-account`, id, passwordHash]
    );
  }

  aliceContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(aliceContext, STORE_BASE_URL, ALICE_EMAIL, FIXTURE_PASSWORD);
  bobContext = await browser.newContext({ baseURL: STORE_BASE_URL });
  await httpSignIn(bobContext, STORE_BASE_URL, BOB_EMAIL, FIXTURE_PASSWORD);

  // Behavioral guard for the loopback flag: if the region endpoint already
  // exists in this run it MUST be the mock fixture, never live Jubelio data.
  const regions = await aliceContext.request.get(
    `${STORE_BASE_URL}/api/shipment/regions?level=provinces`
  );
  if (regions.ok()) {
    expect(
      await regions.text(),
      "an isolated mock run must serve the fixture region hierarchy, not live Jubelio region data"
    ).toContain("Fixture Province");
  }
});

test.afterAll(async () => {
  await aliceContext?.close().catch(() => {});
  await bobContext?.close().catch(() => {});
  if (pool) {
    // Fixture clients cascade: client_account, client_session and addresses.
    await pool.query(`DELETE FROM "client" WHERE email = ANY($1::text[])`, [
      [ALICE_EMAIL, BOB_EMAIL],
    ]);
    await pool.end();
  }
});

test.describe("mock-only client address book (ticket 02)", () => {
  // One fixture client, one growing address book: tests build on the previous
  // step's saved state and run in file order.
  test.describe.configure({ mode: "serial" });

  test("editable fields read as inputs while auto-filled fields read as locked", async () => {
    const page = await aliceContext!.newPage();
    await page.goto("/account/addresses");
    await openAddressForm(page);

    const editable = page.getByLabel("Nama Penerima");
    const locked = page.getByLabel("Kode Pos");
    await expect(editable).toBeVisible();
    await expect(locked).toBeVisible();

    // Independent source of truth: the page/card surface the fields sit on.
    // The editable field surface must NOT be the gray page background, which
    // reads as "disabled" (the regression this spec pins).
    const channels = (color: string): number[] =>
      color.match(/\d+/g)!.slice(0, 3).map(Number);
    const pageBackground = await page
      .locator("body")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(Math.min(...channels(pageBackground))).toBeLessThan(246);

    const editableBackground = await editable.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    const lockedBackground = await locked.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    expect(Math.min(...channels(editableBackground))).toBeGreaterThanOrEqual(246);

    // A locked field is never distinguished by colour alone: it carries the
    // readonly state, a lock icon and a short reason next to the field.
    await expect(locked).toHaveAttribute("readonly", "");
    await expect(lockedBackground).not.toBe(editableBackground);
    const lockedColor = await locked.evaluate((element) => getComputedStyle(element).color);
    const editableColor = await editable.evaluate((element) => getComputedStyle(element).color);
    expect(lockedColor).not.toBe(editableColor);
    await expect(page.getByTestId("read-only-lock")).toBeVisible();
    await expect(page.getByText("Terisi otomatis dari Kelurahan/Area.")).toBeVisible();

    // Region pickers are form controls too — same field surface, not the page gray.
    const regionSelect = page.getByRole("combobox").first();
    const selectBackground = await regionSelect.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    expect(selectBackground).toBe(editableBackground);

    // Empty is not "filled": every prompt in this dialog must sit in the faint
    // placeholder band while typed content stays strong. Before this change the
    // prompts reused --muted-foreground (7.7:1 vs the field surface), so an
    // untouched field looked pre-filled. "Alamat Lengkap" is the field that
    // actually carries a placeholder here ("Nama Penerima" has none).
    const prompted = page.getByLabel("Alamat Lengkap");
    const fieldSurface = await readSurfaceColor(prompted);
    const promptContrast = contrastRatio(
      await readTextColor(prompted, "placeholder"),
      fieldSurface
    );
    expect(promptContrast).toBeGreaterThanOrEqual(FAINT_PLACEHOLDER_MIN);
    expect(promptContrast).toBeLessThanOrEqual(FAINT_PLACEHOLDER_MAX);
    expect(
      contrastRatio(await readTextColor(prompted), fieldSurface),
      "typed value must stay far stronger than the prompt"
    ).toBeGreaterThanOrEqual(12);

    // An untouched Radix select carries `data-placeholder` on the trigger, so the
    // same token must reach it (its trigger colour IS the placeholder tone here).
    const selectPromptContrast = contrastRatio(
      await readTextColor(regionSelect),
      await readSurfaceColor(regionSelect)
    );
    expect(selectPromptContrast).toBeGreaterThanOrEqual(FAINT_PLACEHOLDER_MIN);
    expect(selectPromptContrast).toBeLessThanOrEqual(FAINT_PLACEHOLDER_MAX);

    await page.close();
  });

  test("required fields are marked with an asterisk and a written legend", async () => {
    const page = await aliceContext!.newPage();
    await page.goto("/account/addresses");
    await openAddressForm(page);

    // Penanda wajib harus punya arti tertulis, bukan hanya konvensi simbol.
    await expect(page.getByText("* Wajib diisi", { exact: true })).toBeVisible();

    // Setiap field wajib: bintang terlihat pada label DAN kontrak wajibnya
    // diumumkan lewat atribut pada kontrolnya (bintang sendiri `aria-hidden`).
    for (const label of [
      "Nama Penerima", "Nomor Telepon", "Provinsi", "Kota/Kabupaten",
      "Kecamatan", "Kelurahan/Area", "Alamat Lengkap",
    ]) {
      await expect(page.locator("label", { hasText: label }).first()).toContainText("*");
      const control = page.getByLabel(label);
      const announcedRequired = await control.evaluate((element) =>
        element.hasAttribute("required") || element.getAttribute("aria-required") === "true"
      );
      expect(announcedRequired, `${label} must announce itself as required`).toBe(true);
    }

    // Nama aksesibel tetap bersih: bintang tidak ikut dibacakan.
    await expect(page.getByRole("textbox", { name: "Nama Penerima", exact: true })).toBeVisible();

    // Kode Pos terkunci dan terisi otomatis dari Kelurahan/Area — tanpa bintang.
    await expect(page.locator("label", { hasText: "Kode Pos" })).not.toContainText("*");

    await page.getByRole("button", { name: "Batal" }).click();
    await expect(page.getByLabel("Nama Penerima")).toHaveCount(0);
    await page.close();
  });

  test("address form saves an address with the mocked Shipment region hierarchy", async () => {
    const page = await aliceContext!.newPage();
    await page.goto("/account");
    await page.getByRole("button", { name: "Buku Alamat" }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/);
    await fillAndSaveAddress(page, ALICE_FIRST);

    // The saved card renders the canonical region chain + postal + street.
    const card = addressCard(page, ALICE_FIRST.street);
    await expect(card).toBeVisible();
    await expect(card.getByText(REGION.province)).toBeVisible();
    await expect(card.getByText(REGION.city)).toBeVisible();
    await expect(card.getByText(REGION.district)).toBeVisible();
    await expect(card.getByText(REGION.area)).toBeVisible();
    await expect(card.getByText(REGION.postalCode)).toBeVisible();

    // The public list API returns the same persisted address.
    const response = await aliceContext!.request.get("/api/addresses");
    expect(response.ok(), `address list failed: ${await response.text()}`).toBe(true);
    const rows = unwrapList(await response.json());
    expect(rows).toHaveLength(1);
    const row = rowByStreet(rows, ALICE_FIRST.street);
    expect(streetOf(row)).toBe(ALICE_FIRST.street);
    expect(phoneOf(row)).toBe(ALICE_FIRST.phone);
    expect(String(row.provinceId ?? row.province_id)).toBe(REGION.provinceId);
    // Leading-zero string IDs round-trip exactly (never "1", never numeric).
    expect([
      String(row.provinceId ?? row.province_id),
      String(row.cityId ?? row.city_id),
      String(row.districtId ?? row.district_id),
      String(row.areaId ?? row.area_id),
      String(row.postalCode ?? row.postal_code),
    ]).toEqual(["01", "0101", "010101", "01010101", "01234"]);

    await page.close();
  });

  test("set-default switches to exactly one address and the second address can be deleted", async () => {
    const page = await aliceContext!.newPage();
    await page.goto("/account/addresses");
    await expect(page.getByText(ALICE_FIRST.street, { exact: true })).toBeVisible();
    await fillAndSaveAddress(page, ALICE_SECOND);
    const cardA = addressCard(page, ALICE_FIRST.street);
    const cardB = addressCard(page, ALICE_SECOND.street);
    await expect(cardB).toBeVisible();

    // First default: exactly alice's first address.
    await cardA.getByRole("button", { name: /jadikan utama/i }).click();
    await expect.poll(() => defaultStreets(aliceContext!), { message: "exactly ONE default after set-default" }).toEqual([
      ALICE_FIRST.street,
    ]);

    // Switch: the second address becomes the single default.
    await cardB.getByRole("button", { name: /jadikan utama/i }).click();
    await expect.poll(() => defaultStreets(aliceContext!), { message: "the default must switch atomically" }).toEqual([
      ALICE_SECOND.street,
    ]);

    // Delete the second address: gone from UI and from the client's list.
    await cardB.getByRole("button", { name: /hapus/i }).click();
    const dialog = page
      .getByRole("dialog")
      .or(page.getByRole("alertdialog"));
    try {
      await dialog.waitFor({ state: "visible", timeout: 2_000 });
      await dialog
        .getByRole("button", { name: /hapus|ya|setuju|konfirmasi/i })
        .first()
        .click();
    } catch {
      // No confirmation step on this surface.
    }
    await expect(page.getByText(ALICE_SECOND.street, { exact: true })).toHaveCount(0);
    const rows = unwrapList(await (await aliceContext!.request.get("/api/addresses")).json());
    expect(rows.some((row) => streetOf(row) === ALICE_SECOND.street)).toBe(false);
    expect(rows.some((row) => streetOf(row) === ALICE_FIRST.street)).toBe(true);

    await page.close();
  });

  test("Edit rewrites the saved address in place", async () => {
    const page = await aliceContext!.newPage();
    await page.goto("/account/addresses");
    const before = rowByStreet(
      unwrapList(await (await aliceContext!.request.get("/api/addresses")).json()),
      ALICE_FIRST.street
    );

    const cardA = addressCard(page, ALICE_FIRST.street);
    await cardA.getByRole("button", { name: /edit|ubah/i }).click();
    await page.getByLabel("Nomor Telepon").fill(EDITED_PHONE);
    await page.getByRole("button", { name: /simpan alamat/i }).click();

    await expect(page.getByText(EDITED_PHONE)).toBeVisible();
    await expect(page.getByText(ALICE_FIRST.phone)).toHaveCount(0);

    // Same address record (id stable), new phone, region untouched.
    const after = unwrapList(await (await aliceContext!.request.get("/api/addresses")).json());
    expect(after).toHaveLength(1);
    expect(String(after[0].id)).toBe(String(before.id));
    expect(after[0]).toMatchObject({
      phone: EDITED_PHONE,
      recipientName: ALICE_FIRST.recipientName,
      fullAddress: ALICE_FIRST.street,
    });
    expect([
      String(after[0].provinceId ?? after[0].province_id),
      String(after[0].areaId ?? after[0].area_id),
      String(after[0].postalCode ?? after[0].postal_code),
    ]).toEqual([REGION.provinceId, REGION.areaId, REGION.postalCode]);

    await page.close();
  });

  test("another client's address is invisible and untouchable over the address API", async () => {
    // Bob creates his own address through the public HTTP seam.
    const createBob = await bobContext!.request.post("/api/addresses", {
      data: httpAddressInput(BOB_FIXTURE, false),
    });
    expect(
      createBob.ok(),
      `bob's own address create must succeed: ${await createBob.text()}`
    ).toBe(true);
    const bobAddressId = unwrapId(await createBob.json());
    expect(bobAddressId.length).toBeGreaterThan(0);

    // Alice's list is scoped to alice: bob's row is invisible.
    const aliceRows = unwrapList(await (await aliceContext!.request.get("/api/addresses")).json());
    expect(aliceRows.some((row) => streetOf(row) === BOB_FIXTURE.street)).toBe(false);
    expect(aliceRows.some((row) => streetOf(row) === ALICE_FIRST.street)).toBe(true);

    // Alice must not edit, promote or delete bob's address.
    const tamper = await aliceContext!.request.patch(`/api/addresses/${bobAddressId}`, {
      data: httpAddressInput({ ...BOB_FIXTURE, phone: "089999999999" }, true),
    });
    expect(tamper.status(), "a foreign client must not edit another client's address").toBeGreaterThanOrEqual(400);
    const promote = await aliceContext!.request.post(`/api/addresses/${bobAddressId}/default`);
    expect(promote.status(), "a foreign client must not set another client's default").toBeGreaterThanOrEqual(400);
    const remove = await aliceContext!.request.delete(`/api/addresses/${bobAddressId}`);
    expect(remove.status(), "a foreign client must not delete another client's address").toBeGreaterThanOrEqual(400);

    // Bob's address is exactly as he created it — untampered, still not default.
    const bobRows = unwrapList(await (await bobContext!.request.get("/api/addresses")).json());
    expect(bobRows).toHaveLength(1);
    const bobRow = rowByStreet(bobRows, BOB_FIXTURE.street);
    expect(phoneOf(bobRow)).toBe(BOB_FIXTURE.phone);
    expect(streetOf(bobRow)).toBe(BOB_FIXTURE.street);
    expect(isDefaultRow(bobRow)).toBe(false);

    // Bob still drives his own book: set default, then delete.
    const setDefault = await bobContext!.request.post(`/api/addresses/${bobAddressId}/default`);
    expect(setDefault.ok(), `bob's own set-default must succeed: ${await setDefault.text()}`).toBe(true);
    const promoted = unwrapList(await (await bobContext!.request.get("/api/addresses")).json());
    expect(isDefaultRow(rowByStreet(promoted, BOB_FIXTURE.street))).toBe(true);
    const deleteBob = await bobContext!.request.delete(`/api/addresses/${bobAddressId}`);
    expect(deleteBob.ok(), `bob's own delete must succeed: ${await deleteBob.text()}`).toBe(true);
    const emptyList = unwrapList(await (await bobContext!.request.get("/api/addresses")).json());
    expect(emptyList.some((row) => streetOf(row) === BOB_FIXTURE.street)).toBe(false);
  });
});