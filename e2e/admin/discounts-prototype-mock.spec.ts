import { test, expect, type APIResponse, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config({ path: ".env", quiet: true });
const ADMIN_URL = process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const origin = new URL(ADMIN_URL);
const database = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid").pathname.slice(1);
if (process.env.E2E_PROVIDER_MOCKS !== "true" || origin.port !== "3111"
  || !["localhost", "127.0.0.1"].includes(origin.hostname)
  || !/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(database)) {
  throw new Error("Discount UX spec requires isolated mock origins and a disposable discounts DB");
}

interface Offer { id: string; version: number; draftVersion: number; policyVersion: number }
interface Review { offerVersion: number; draftVersion: number; policyVersion: number; fingerprint: string }

const uniqueCode = () => `UX${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
let pool: Pool;
let context: BrowserContext;
let gateBefore: { value: string; type: string; description: string | null } | undefined;
const ids: string[] = [];

async function data<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as T;
}

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    draftSchemaVersion: 1,
    name: "UX Dasar",
    currency: "IDR",
    minSubtotal: "0",
    startAt: null,
    endAt: null,
    benefit: { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "25000" },
    capacity: { quotaCount: 100, budgetAmount: "2000000", perClientLimit: 1 },
    codeChanges: { proposedCodes: [], states: [] },
    ...overrides,
  };
}

async function create(kind: "public" | "manual_only", codes?: string[]): Promise<Offer> {
  const offer = await data<Offer>(await context.request.post("/api/admin/discounts", {
    data: { requestKey: randomUUID(), activationKind: kind, ...(codes ? { codes } : {}) },
  }));
  ids.push(offer.id);
  return offer;
}

/** Draft -> review -> publish lewat kontrak HTTP baru (satu snapshot). */
async function publishOffer(offer: Offer, config = configuration()): Promise<Offer> {
  const saved = await data<Offer>(await context.request.put(`/api/admin/discounts/${offer.id}/draft`, {
    data: {
      requestKey: randomUUID(),
      expectedOfferVersion: offer.version,
      expectedDraftVersion: offer.draftVersion,
      configuration: config,
    },
  }));
  const review = await data<Review>(await context.request.post(`/api/admin/discounts/${offer.id}/review`, {
    data: { expectedOfferVersion: saved.version, expectedDraftVersion: saved.draftVersion },
  }));
  return data<Offer>(await context.request.post(`/api/admin/discounts/${offer.id}/publish`, {
    data: {
      requestKey: randomUUID(),
      expectedOfferVersion: review.offerVersion,
      expectedDraftVersion: review.draftVersion,
      expectedPolicyVersion: review.policyVersion,
      reviewFingerprint: review.fingerprint,
    },
  }));
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  gateBefore = (await pool.query("SELECT value,type,description FROM system_config WHERE key='discounts.contractVersion'")).rows[0];
  await pool.query("INSERT INTO system_config(key,value,type) VALUES('discounts.contractVersion','1','number') ON CONFLICT(key) DO UPDATE SET value='1'");
  context = await browser.newContext({ baseURL: ADMIN_URL });
  expect((await context.request.post("/api/auth/sign-in/username", { data: { username: "hqmanager", password: "hq123" } })).ok()).toBe(true);
  // Fixture live untuk daftar & editor: satu public, satu manual dengan kode.
  await publishOffer(await create("public"), configuration({ name: "UX Kupon Publik" }));
  await publishOffer(
    await create("manual_only", [uniqueCode()]),
    configuration({ name: "UX Kode Promo" })
  );
});

test.afterAll(async () => {
  await context?.close();
  if (!pool) return;
  try {
    await pool.query("DELETE FROM discount_admin_request WHERE target_id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM audit_log WHERE entity_id=ANY($1::text[])", [ids]);
    await pool.query("UPDATE discount_offer SET state='draft',current_revision_id=NULL WHERE id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM discount_code WHERE offer_id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM discount_offer_usage WHERE offer_id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM discount_benefit WHERE revision_id IN(SELECT id FROM discount_offer_revision WHERE offer_id=ANY($1::text[]))", [ids]);
    await pool.query("DELETE FROM discount_offer_revision WHERE offer_id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM discount_offer WHERE id=ANY($1::text[])", [ids]);
    if (gateBefore) await pool.query("UPDATE system_config SET value=$1,type=$2,description=$3 WHERE key='discounts.contractVersion'", [gateBefore.value, gateBefore.type, gateBefore.description]);
    else await pool.query("DELETE FROM system_config WHERE key='discounts.contractVersion'");
  } finally { await pool.end(); }
});

test("daftar memakai satu tabel dengan filter jenis, tanpa tab jalur atau blok bantuan", async () => {
  const page = await context.newPage();
  try {
    await page.goto("/admin/discounts");
    await expect(page.getByRole("table", { name: "Daftar diskon" })).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByText("Tentang promo", { exact: true })).toHaveCount(0);
    const kind = page.getByRole("combobox", { name: "Filter jenis promo" });
    await expect(kind).toHaveText(/Semua jenis/);
    const header = page.getByRole("table", { name: "Daftar diskon" }).getByRole("columnheader");
    await expect(header).toHaveText([
      "Nama diskon", "Jenis", "Potongan", "Status", "Sisa kuota", "Sisa budget", "Aksi",
    ]);
    await kind.click();
    await page.getByRole("option", { name: "Kode promo", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "UX Kode Promo" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "UX Kupon Publik" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await page.close(); }
});

test("dialog Buat diskon meminta jenis secara eksplisit dan batal tidak membuat data", async () => {
  const page = await context.newPage();
  const before = Number((await pool.query("SELECT count(*) FROM discount_offer")).rows[0].count);
  try {
    await page.goto("/admin/discounts");
    await page.getByRole("button", { name: "Buat diskon", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Buat diskon", exact: true });
    await dialog.getByRole("button", { name: "Lanjut", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Pilih jenis promo");
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    expect(Number((await pool.query("SELECT count(*) FROM discount_offer")).rows[0].count)).toBe(before);

    await page.getByRole("button", { name: "Buat diskon", exact: true }).click();
    await dialog.getByRole("radio", { name: /Kode promo/ }).check();
    await dialog.getByRole("button", { name: "Lanjut", exact: true }).click();
    await page.waitForURL(/\/admin\/discounts\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    ids.push(id);
    // Jenis yang dipilih dialog, bukan filter daftar.
    await expect(page.getByText("Kode promo", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Kode", exact: true })).toBeVisible();
  } finally { await page.close(); }
});

test("kupon publik tidak mempunyai tab Kode; kode promo mempunyai tab dengan tugas nyata", async () => {
  const page = await context.newPage();
  try {
    await page.goto("/admin/discounts");
    await page.getByRole("row").filter({ hasText: "UX Kupon Publik" }).getByRole("link", { name: "Kelola" }).click();
    await expect(page.getByRole("tablist", { name: "Bagian diskon" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Kode", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Kupon publik tidak memiliki kode/)).toHaveCount(0);

    await page.goto("/admin/discounts");
    await page.getByRole("row").filter({ hasText: "UX Kode Promo" }).getByRole("link", { name: "Kelola" }).click();
    await page.getByRole("tab", { name: "Kode", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Kode baru" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kode yang sudah diterbitkan" })).toBeVisible();
    await expect(page.getByLabel("Tambah kode")).toBeVisible();
    await expect(page.getByRole("table", { name: "Kode yang sudah diterbitkan" })).toBeVisible();
  } finally { await page.close(); }
});

test("satu snapshot menyimpan Pengaturan dan Kode bersama tanpa tombol simpan per bagian", async () => {
  const offer = await publishOffer(
    await create("manual_only", [uniqueCode()]),
    configuration({ name: "UX Satu Snapshot", capacity: { quotaCount: 100, budgetAmount: "2000000", perClientLimit: 1 } })
  );
  const page = await context.newPage();
  try {
    await page.goto(`/admin/discounts/${offer.id}`);
    await expect(page.getByRole("button", { name: "Simpan kapasitas", exact: true })).toHaveCount(0);
    await expect(page.getByText("Perubahan belum disimpan", { exact: true })).toHaveCount(0);

    await page.getByLabel(/Nama diskon/).fill("UX Snapshot Tersimpan");
    await page.getByLabel(/Kuota pemakaian/).fill("250");
    await page.getByRole("tab", { name: "Kode", exact: true }).click();
    await page.getByLabel("Tambah kode").fill("UXDRAFTSECRET");
    await page.getByRole("button", { name: "Tambah ke draft", exact: true }).click();
    await expect(page.getByText("UXDRAFTSECRET", { exact: true })).toBeVisible();
    await expect(page.getByText("Perubahan belum disimpan", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Pengaturan", exact: true }).click();
    await expect(page.getByLabel(/Nama diskon/)).toHaveValue("UX Snapshot Tersimpan");
    await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
    await expect(page.getByText("Draft tersimpan", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/Nama diskon/)).toHaveValue("UX Snapshot Tersimpan");
    await expect(page.getByLabel(/Kuota pemakaian/)).toHaveValue("250");
    await page.getByRole("tab", { name: "Kode", exact: true }).click();
    await expect(page.getByText("UXDRAFTSECRET", { exact: true })).toBeVisible();

    // Draft tidak mengaktifkan kode baru sebelum publish.
    const rows = await pool.query("SELECT canonical_code, state FROM discount_code WHERE offer_id=$1 AND canonical_code='UXDRAFTSECRET'", [offer.id]);
    expect(rows.rowCount).toBe(0);
  } finally { await page.close(); }
});

test("input uang dan persen memakai format Indonesia serta bertahan saat pindah tab", async () => {
  const offer = await publishOffer(await create("public"), configuration({ name: "UX Format Angka" }));
  const page = await context.newPage();
  try {
    await page.goto(`/admin/discounts/${offer.id}`);
    const minimum = page.getByLabel(/Minimum belanja/);
    await minimum.fill("100000");
    await minimum.blur();
    await expect(minimum).toHaveValue("100.000,00");

    await page.getByRole("combobox", { name: "Jenis potongan" }).click();
    await page.getByRole("option", { name: "Persentase", exact: true }).click();
    const rate = page.getByLabel(/Persentase diskon/);
    // Ketikan per karakter: angka nol di belakang koma tidak boleh dimakan saat mengetik.
    await rate.pressSequentially("12,50", { delay: 10 });
    await expect(rate).toHaveValue("12,50");
    await rate.blur();
    await expect(rate).toHaveValue("12,5");

    // Batas 100%: ketikan yang melewati 100 ditolak, bukan disimpan lalu error.
    await rate.click();
    await page.keyboard.press("ControlOrMeta+a");
    await rate.pressSequentially("150", { delay: 10 });
    await expect(rate).toHaveValue("15");
    await rate.fill("12,50");
    await rate.blur();
    await expect(rate).toHaveValue("12,5");
    const cap = page.getByLabel(/Maksimum potongan per pesanan/);
    // Ketikan per karakter (bukan fill sekali jadi): separator grouping tidak boleh ikut tersimpan.
    await cap.pressSequentially("20000", { delay: 10 });
    await expect(cap).toHaveValue("20.000");
    await cap.blur();
    await expect(cap).toHaveValue("20.000,00");

    await page.getByRole("tab", { name: "Simulasi", exact: true }).click();
    await page.getByRole("tab", { name: "Pengaturan", exact: true }).click();
    await expect(minimum).toHaveValue("100.000,00");
    await expect(rate).toHaveValue("12,5");
  } finally { await page.close(); }
});

test("Lanjut ke publish menyimpan draft kotor lalu menampilkan review dan menerbitkan", async () => {
  const offer = await create("public");
  const page = await context.newPage();
  try {
    await page.goto(`/admin/discounts/${offer.id}`);
    await page.getByLabel(/Nama diskon/).fill("UX Lanjut Publish");
    await page.getByRole("combobox", { name: "Jenis potongan" }).click();
    await page.getByRole("option", { name: "Nominal tetap", exact: true }).click();
    await page.getByLabel(/Nominal potongan barang/).fill("17000");
    await page.getByLabel(/Minimum belanja/).fill("0");
    await page.getByLabel(/Kuota pemakaian/).fill("10");
    await page.getByRole("button", { name: "Lanjut ke publish", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Periksa sebelum publish", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Perubahan berlaku setelah publish. Pesanan yang sudah dibuat tidak berubah.", { exact: false })).toBeVisible();
    await expect(dialog.getByText(/Untuk customer dengan email terverifikasi/)).toBeVisible();
    await dialog.getByRole("button", { name: "Publish diskon", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Diskon dipublish", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Aktif", { exact: true }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Nama diskon/)).toHaveValue("UX Lanjut Publish");
  } finally { await page.close(); }
});

test("meninggalkan editor dengan perubahan belum disimpan meminta pilihan", async () => {
  const offer = await publishOffer(await create("public"), configuration({ name: "UX Keluar Guard" }));
  const page = await context.newPage();
  try {
    await page.goto(`/admin/discounts/${offer.id}`);
    await page.getByLabel(/Nama diskon/).fill("UX Belum Disimpan");
    await expect(page.getByText("Perubahan belum disimpan", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Daftar diskon", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Perubahan belum disimpan", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Tetap mengedit", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Buang perubahan", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Simpan draft dan keluar", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Tetap mengedit", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/discounts/${offer.id}$`));
    await expect(page.getByLabel(/Nama diskon/)).toHaveValue("UX Belum Disimpan");
  } finally { await page.close(); }
});

test("writer konfigurasi lama ditutup dan viewer tetap read-only", async ({ browser }) => {
  const secret = uniqueCode();
  const offer = await publishOffer(await create("manual_only", [secret]), configuration({ name: "UX Writer Lama" }));
  const moved = await context.request.patch(`/api/admin/discounts/${offer.id}/policy`, { data: { quotaCount: 10 } });
  expect(moved.status()).toBe(410);
  expect((await moved.json()).code).toBe("CONFIGURATION_MOVED_TO_DRAFT");
  expect((await context.request.post(`/api/admin/discounts/${offer.id}/codes`, { data: { code: "UXNEWSECRET" } })).status()).toBe(410);

  let viewer: BrowserContext | undefined;
  const grantId = "e2e-discount-unified-view";
  try {
    const admin = await pool.query('SELECT role_id FROM "user" WHERE username=$1', ["admintoko"]);
    await pool.query("INSERT INTO admin_role_grant(id,role_id,module,action,scope) VALUES($1,$2,'discounts','view','global') ON CONFLICT(role_id,module,action) DO NOTHING", [grantId, admin.rows[0].role_id]);
    viewer = await browser.newContext({ baseURL: ADMIN_URL });
    expect((await viewer.request.post("/api/auth/sign-in/username", { data: { username: "admintoko", password: "admin123" } })).ok()).toBe(true);
    const vpage = await viewer.newPage();
    await vpage.goto(`/admin/discounts/${offer.id}`);
    await expect(vpage.getByText("Anda hanya dapat melihat diskon.", { exact: true })).toBeVisible();
    await expect(vpage.getByRole("button", { name: "Simpan draft", exact: true })).toHaveCount(0);
    await expect(vpage.getByRole("button", { name: "Lanjut ke publish", exact: true })).toHaveCount(0);
    await vpage.getByRole("tab", { name: "Kode", exact: true }).click();
    await expect(vpage.getByLabel("Tambah kode")).toHaveCount(0);
    const payload = await viewer.request.get(`/api/admin/discounts/${offer.id}`);
    expect(await payload.text()).not.toContain(secret);
  } finally {
    await viewer?.close();
    await pool.query("DELETE FROM admin_role_grant WHERE id=$1", [grantId]);
  }
});

test("editor tetap terbaca pada viewport mobile tanpa overflow horizontal", async () => {
  const offer = await publishOffer(await create("manual_only", [uniqueCode()]), configuration({ name: "UX Mobile Editor" }));
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/discounts/${offer.id}`);
    await expect(page.getByLabel(/Nama diskon/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("tab", { name: "Kode", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto("/admin/discounts");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await page.close(); }
});

test("paused tetap dijeda setelah publish dan archived menjadi read-only", async () => {
  const offer = await publishOffer(await create("public"), configuration({ name: "UX Paused Offer" }));
  const paused = await data<Offer>(await context.request.patch(`/api/admin/discounts/${offer.id}/state`, {
    data: { requestKey: randomUUID(), expectedVersion: offer.version, state: "paused" },
  }));
  const page = await context.newPage();
  try {
    await page.goto(`/admin/discounts/${offer.id}`);
    await expect(page.getByText("Dijeda", { exact: true }).first()).toBeVisible();
    await page.getByLabel(/Nama diskon/).fill("UX Paused Offer v2");
    await page.getByRole("button", { name: "Lanjut ke publish", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Periksa sebelum publish", exact: true });
    await expect(dialog.getByText("Diskon tetap dijeda setelah publish.", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Publish diskon", exact: true }).click();
    await expect(page.getByText("Diskon dipublish", { exact: true }).first()).toBeVisible();
    // Publish pada Offer paused tidak mengaktifkannya diam-diam.
    await expect(page.getByText("Dijeda", { exact: true }).first()).toBeVisible();

    const current = await data<Offer>(await context.request.get(`/api/admin/discounts/${offer.id}`));
    await data(await context.request.patch(`/api/admin/discounts/${offer.id}/state`, {
      data: { requestKey: randomUUID(), expectedVersion: current.version, state: "archived" },
    }));
    await page.reload();
    await expect(page.getByText("Diskon diarsipkan dan tidak dapat diubah.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan draft", exact: true })).toHaveCount(0);
    await expect(page.getByLabel(/Nama diskon/)).toBeDisabled();
    expect(paused.state).toBe("paused");
  } finally { await page.close(); }
});

test("keyboard tabs editor dan daftar dapat dinavigasi tanpa jebakan fokus", async () => {
  const offer = await publishOffer(await create("manual_only", [uniqueCode()]), configuration({ name: "UX Keyboard" }));
  const page = await context.newPage();
  try {
    await page.goto(`/admin/discounts/${offer.id}`);
    const tabs = page.getByRole("tablist", { name: "Bagian diskon" });
    await tabs.getByRole("tab", { name: "Pengaturan", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Kode", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Tambah kode")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.getByRole("tab", { name: "Pengaturan", exact: true })).toHaveAttribute("aria-selected", "true");
  } finally { await page.close(); }
});
