import { test, expect, type APIResponse, type BrowserContext, type Locator } from "@playwright/test";
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
let pool: Pool;
let context: BrowserContext;
let gateBefore: { value: string; type: string; description: string | null } | undefined;
const ids: string[] = [];
let shipping: Offer;
const SECRET = "UXPARITYSECRET2026";

async function data<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as T;
}
async function create(kind: "public" | "manual_only", codes?: string[]): Promise<Offer> {
  const offer = await data<Offer>(await context.request.post("/api/admin/discounts", {
    data: { requestKey: randomUUID(), activationKind: kind, ...(codes ? { codes } : {}) },
  }));
  ids.push(offer.id);
  return offer;
}
async function live(name: string, benefit: Record<string, unknown>): Promise<Offer> {
  const offer = await create("public");
  const saved = await data<Offer>(await context.request.put(`/api/admin/discounts/${offer.id}/draft`, {
    data: { expectedOfferVersion: offer.version, expectedDraftVersion: offer.draftVersion,
      terms: { name, currency: "IDR", minSubtotal: "0", startAt: null, endAt: null, benefit } },
  }));
  const policy = await data<Offer>(await context.request.patch(`/api/admin/discounts/${offer.id}/policy`, {
    data: { requestKey: randomUUID(), expectedOfferVersion: saved.version, expectedPolicyVersion: saved.policyVersion,
      quotaCount: 100, budgetAmount: "2000000", perClientLimit: 1 },
  }));
  const review = await data<Review>(await context.request.post(`/api/admin/discounts/${offer.id}/review`, {
    data: { expectedOfferVersion: policy.version, expectedDraftVersion: policy.draftVersion },
  }));
  return data<Offer>(await context.request.post(`/api/admin/discounts/${offer.id}/publish`, {
    data: { requestKey: randomUUID(), expectedOfferVersion: review.offerVersion, expectedDraftVersion: review.draftVersion,
      expectedPolicyVersion: review.policyVersion, reviewFingerprint: review.fingerprint },
  }));
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  gateBefore = (await pool.query("SELECT value,type,description FROM system_config WHERE key='discounts.contractVersion'")).rows[0];
  await pool.query("INSERT INTO system_config(key,value,type) VALUES('discounts.contractVersion','1','number') ON CONFLICT(key) DO UPDATE SET value='1'");
  context = await browser.newContext({ baseURL: ADMIN_URL });
  expect((await context.request.post("/api/auth/sign-in/username", { data: { username: "hqmanager", password: "hq123" } })).ok()).toBe(true);
  shipping = await live("UX Subsidi Ongkir", { kind: "shipping", paramsVersion: 1, capAmount: "20000" });
  await pool.query("UPDATE discount_offer_usage SET consumed_count=90,reserved_count=10,consumed_amount=1800000,reserved_amount=200000 WHERE offer_id=$1", [shipping.id]);
  const fixed = await live("UX Nominal Barang", { kind: "fixed_goods", paramsVersion: 1, fixedAmount: "25000" });
  await data(await context.request.patch(`/api/admin/discounts/${fixed.id}/policy`, { data: {
    requestKey: randomUUID(), expectedOfferVersion: fixed.version, expectedPolicyVersion: fixed.policyVersion,
    quotaCount: 100, budgetAmount: null, perClientLimit: 1,
  } }));
  await live("UX Persentase Barang", { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: "20000" });
  await live("UX Persentase Tanpa Cap", { kind: "percentage_goods", paramsVersion: 1, rate: "10", capAmount: null });
  for (let i = 0; i < 12; i++) await create("manual_only", i === 0 ? [SECRET] : undefined);
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

test("tabs memiliki batas dan pilihan aktif yang jelas; bantuan daftar dapat dibuka tanpa meninggalkan pekerjaan", async () => {
  const page = await context.newPage();
  try {
    await page.goto("/admin/discounts");
    const tabs = page.getByRole("tablist", { name: "Jalur promo" });
    await expect(tabs).toHaveCSS("border-top-width", "1px");
    const selected = tabs.getByRole("tab", { selected: true });
    expect(await selected.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe(await tabs.evaluate((element) => getComputedStyle(element).backgroundColor));
    const help = page.getByText("Tentang promo", { exact: true });
    const explanation = page.getByText("Kupon publik dipilih customer di checkout; kode promo dimasukkan manual.", { exact: true });
    await expect(explanation).not.toBeVisible();
    await help.click();
    await expect(explanation).toBeVisible();
    await help.click();
    await expect(explanation).not.toBeVisible();
    await selected.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: /Kode promo/ })).toBeFocused();
    await expect(tabs.getByRole("tab", { name: /Kode promo/ })).toHaveAttribute("aria-selected", "true");
  } finally { await page.close(); }
});

test("tabel daftar promo memakai frame border dan sudut rounded yang sama dengan tabel Produk", async () => {
  const page = await context.newPage();
  // Frame = elemen pembungkus komponen Table (bukan tabelnya sendiri), yaitu
  // elemen yang memakai pattern `rounded-md border` pada halaman peer.
  const frameStyle = (table: Locator) => table.locator("../..").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderTopWidth: style.borderTopWidth,
      borderRightWidth: style.borderRightWidth,
      borderBottomWidth: style.borderBottomWidth,
      borderLeftWidth: style.borderLeftWidth,
      borderTopColor: style.borderTopColor,
      borderTopLeftRadius: style.borderTopLeftRadius,
      borderBottomRightRadius: style.borderBottomRightRadius,
    };
  });
  try {
    await page.goto("/admin/discounts");
    const promo = await frameStyle(page.getByRole("table", { name: "Daftar promo" }));
    await page.goto("/admin/products");
    await expect(page.getByRole("table").first()).toBeVisible();
    const products = await frameStyle(page.getByRole("table").first());
    expect(promo).toEqual(products);
    expect(promo.borderTopWidth).toBe("1px");
    expect(promo.borderTopLeftRadius).not.toBe("0px");
  } finally { await page.close(); }
});

test("draft mengelompokkan identitas, potongan dan jadwal serta mempertahankan input pada layar kecil", async () => {
  const offer = await create("public");
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/discounts/${offer.id}`);
    await expect(page.getByRole("group", { name: "Identitas promo", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Potongan", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Jadwal", exact: true })).toBeVisible();
    await page.getByLabel("Nama promo").fill("Draft UX ringkas");
    await expect(page.getByText("Menyimpan draft tidak mengaktifkan promo.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review perubahan", exact: true })).toBeDisabled();
    await page.getByRole("tab", { name: "Kode", exact: true }).click();
    await page.getByRole("tab", { name: "Aturan", exact: true }).click();
    await expect(page.getByLabel("Nama promo")).toHaveValue("Draft UX ringkas");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText("Ada draft belum dipublish", { exact: true })).toHaveCount(0);
  } finally { await page.close(); }
});

test("tabs detail Produk mengikuti style Diskon dan tetap dapat dinavigasi; review render desktop dan mobile", async ({}, testInfo) => {
  const products = await data<{ id: string }[]>(await context.request.get("/api/admin/products?limit=1"));
  expect(products.length).toBeGreaterThan(0);
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/discounts");
    await expect(page.getByRole("table", { name: "Daftar promo" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kelola", exact: true }).first()).toBeInViewport({ ratio: 1 });
    const discountTabs = page.getByRole("tablist", { name: "Jalur promo" });
    const activeColor = await discountTabs.getByRole("tab", { selected: true })
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.screenshot({ path: testInfo.outputPath("discounts-list-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const manage = page.getByRole("link", { name: "Kelola", exact: true }).first();
    await manage.scrollIntoViewIfNeeded();
    await expect(manage).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("discounts-list-mobile.png"), fullPage: true });
    await page.goto(`/admin/discounts/${shipping.id}`);
    await expect(page.getByRole("group", { name: "Potongan", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("discounts-editor-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath("discounts-editor-desktop.png"), fullPage: true });
    await page.goto(`/admin/products/${products[0].id}`);
    const productTabs = page.getByRole("tablist");
    await expect(productTabs).toHaveCSS("border-top-width", "1px");
    await expect(productTabs.getByRole("tab", { selected: true })).toHaveCSS("background-color", activeColor);
    await productTabs.getByRole("tab", { name: "Stok", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "Stok", exact: true })).toBeVisible();
    await productTabs.getByRole("tab", { name: "Stok", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(productTabs.getByRole("tab", { name: /Varian/ })).toBeFocused();
    await expect(productTabs.getByRole("tab", { name: /Varian/ })).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: testInfo.outputPath("product-tabs-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await productTabs.scrollIntoViewIfNeeded();
    await expect(productTabs.getByRole("tab", { name: "Stok", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("product-tabs-mobile.png"), fullPage: true });
  } finally { await page.close(); }
});

test("review invalid dan failure tidak mengizinkan publish; pending publish tidak dapat ditutup atau dikirim dua kali", async () => {
  const offer = await create("public");
  const page = await context.newPage();
  try {
    await page.goto(`/admin/discounts/${offer.id}`);
    await page.getByLabel("Nama promo").fill("UX Failure and Busy");
    await page.getByLabel("Nominal potongan barang (Rp)").fill("17000");
    await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
    const trigger = page.getByRole("button", { name: "Review perubahan", exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Review perubahan promo", exact: true });
    await expect(dialog.getByRole("button", { name: "Publish promo", exact: true })).toBeDisabled();
    await expect(dialog.getByText(/Review belum siap publish/)).toBeVisible();
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    await page.route(`**/api/admin/discounts/${offer.id}/review`, (route) => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ success: false, code: "BUSY", error: "Review sementara tidak tersedia" }),
    }));
    await trigger.click();
    await expect(dialog.getByRole("alert")).toHaveText("Review sementara tidak tersedia");
    await expect(dialog.getByRole("button", { name: "Publish promo", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    await page.unroute(`**/api/admin/discounts/${offer.id}/review`);
    await page.getByRole("tab", { name: "Pemakaian & budget", exact: true }).click();
    await page.getByLabel("Kuota pemakaian").fill("10");
    await page.getByRole("button", { name: "Simpan kapasitas", exact: true }).click();
    await expect(page.getByText("Kapasitas disimpan", { exact: true }).first()).toBeVisible();
    await page.getByRole("tab", { name: "Aturan", exact: true }).click();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    await page.route(`**/api/admin/discounts/${offer.id}/publish`, async (route) => { requests++; await barrier; await route.continue(); });
    await trigger.click();
    const publish = dialog.getByRole("button", { name: "Publish promo", exact: true });
    await expect(publish).toBeEnabled();
    await publish.dblclick();
    await expect(publish).toBeDisabled();
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Batal", exact: true })).toBeDisabled();
    expect(requests).toBe(1);
    release();
    await expect(page.getByText("Live: Revision 1", { exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  } finally { await page.close(); }
});

test("create dari tab kode memakai jalur manual dan viewer tetap masked serta read-only", async ({ browser }) => {
  const page = await context.newPage();
  let viewer: BrowserContext | undefined;
  const grantId = "e2e-discount-ux-view";
  try {
    await page.goto("/admin/discounts");
    await page.getByRole("tab", { name: /Kode promo/ }).click();
    await page.getByRole("button", { name: "Buat draft", exact: true }).click();
    await page.waitForURL(/\/admin\/discounts\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    ids.push(id);
    await page.getByRole("tab", { name: "Kode", exact: true }).click();
    await page.getByLabel("Tambah kode", { exact: true }).fill("UXVIEWERSECRET");
    await page.getByRole("button", { name: "Tambah", exact: true }).click();
    await expect(page.getByRole("cell", { name: "UXVIEWERSECRET", exact: true })).toBeVisible();
    const admin = await pool.query('SELECT role_id FROM "user" WHERE username=$1', ["admintoko"]);
    await pool.query("INSERT INTO admin_role_grant(id,role_id,module,action,scope) VALUES($1,$2,'discounts','view','global') ON CONFLICT(role_id,module,action) DO NOTHING", [grantId, admin.rows[0].role_id]);
    viewer = await browser.newContext({ baseURL: ADMIN_URL });
    expect((await viewer.request.post("/api/auth/sign-in/username", { data: { username: "admintoko", password: "admin123" } })).ok()).toBe(true);
    const vpage = await viewer.newPage();
    await vpage.goto(`/admin/discounts/${id}`);
    await vpage.getByRole("tab", { name: "Kode", exact: true }).click();
    await expect(vpage.getByLabel("Tambah kode", { exact: true })).toHaveCount(0);
    expect(await vpage.locator("main").innerText()).not.toContain("UXVIEWERSECRET");
    const payload = await viewer.request.get(`/api/admin/discounts/${id}`);
    expect(await payload.text()).not.toContain("UXVIEWERSECRET");
    await vpage.getByRole("tab", { name: "Aturan", exact: true }).click();
    await expect(vpage.getByLabel("Nama promo")).toBeDisabled();
    await expect(vpage.getByRole("button", { name: "Simpan draft", exact: true })).toHaveCount(0);
    await expect(vpage.getByRole("button", { name: "Review perubahan", exact: true })).toHaveCount(0);
    expect((await viewer.request.patch(`/api/admin/discounts/${id}/state`, { data: { requestKey: randomUUID(), expectedVersion: 1, state: "archived" } })).status()).toBe(403);
  } finally {
    await page.close(); await viewer?.close();
    await pool.query("DELETE FROM admin_role_grant WHERE id=$1", [grantId]);
  }
});

test("filter status reset pagination; failure berbeda dari empty dan respons tab lama tidak mengganti hasil terbaru", async () => {
  const page = await context.newPage();
  try {
    await page.goto("/admin/discounts");
    await page.getByRole("tab", { name: /Kode promo/ }).click();
    await page.getByRole("button", { name: "Berikutnya", exact: true }).click();
    await expect(page.getByText(/Halaman 2 dari/)).toBeVisible();
    await page.getByRole("combobox", { name: "Filter status promo" }).click();
    await page.getByRole("option", { name: "Diarsipkan", exact: true }).click();
    await expect(page.getByText(/Halaman 1 dari/)).toBeVisible();
    await expect(page.getByText("Belum ada kode promo pada filter ini.", { exact: true })).toBeVisible();
    await page.route("**/api/admin/discounts?*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, error: "Daftar sementara gagal" }) }));
    await page.getByRole("tab", { name: /Kupon publik/ }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Daftar sementara gagal");
    await expect(page.getByText(/Belum ada kupon publik/)).toHaveCount(0);
    await page.unroute("**/api/admin/discounts?*");
    await page.goto("/admin/discounts");
    await expect(page.getByRole("table", { name: "Daftar promo" })).toBeVisible();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let delivered!: () => void;
    const completed = new Promise<void>((resolve) => { delivered = resolve; });
    let intercepted!: () => void;
    const ready = new Promise<void>((resolve) => { intercepted = resolve; });
    await page.route("**/api/admin/discounts?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("activationKind") !== "public") return route.continue();
      const response = await route.fetch();
      intercepted(); await barrier;
      await route.fulfill({ response }).catch(() => {}); // Browser may abort the superseded request.
      delivered();
    });
    await page.getByRole("combobox", { name: "Filter status promo" }).click();
    await page.getByRole("option", { name: "Draft", exact: true }).click();
    await ready;
    await page.getByRole("tab", { name: /Kode promo/ }).click();
    await expect(page.getByRole("cell", { name: "Kode promo", exact: true }).first()).toBeVisible();
    release();
    await completed;
    await expect(page.getByRole("cell", { name: "Kupon publik", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /Kode promo/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("UX Subsidi Ongkir", { exact: true })).toHaveCount(0);
  } finally { await page.close(); }
});

test("dialog review menjaga draft tersimpan, cancel/fokus, publish dan stale policy pada mobile", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/discounts");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Buat draft", exact: true }).click();
    await page.waitForURL(/\/admin\/discounts\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    ids.push(id);
    await page.getByLabel("Nama promo").fill("UX Dialog Promo");
    await page.getByLabel("Nominal potongan barang (Rp)").fill("17000");
    const trigger = page.getByRole("button", { name: "Review perubahan", exact: true });
    await expect(trigger).toBeDisabled();
    await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
    await expect(page.getByText("Draft disimpan", { exact: true }).first()).toBeVisible();
    await page.getByRole("tab", { name: "Pemakaian & budget", exact: true }).click();
    await page.getByLabel("Kuota pemakaian").fill("10");
    await page.getByRole("button", { name: "Simpan kapasitas", exact: true }).click();
    await expect(page.getByText("Kapasitas disimpan", { exact: true }).first()).toBeVisible();
    await page.getByRole("tab", { name: "Aturan", exact: true }).click();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Review perubahan promo", exact: true });
    await expect(dialog.getByText("UX Dialog Promo", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Publish promo", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByText("Belum dipublish", { exact: true })).toBeVisible();
    await trigger.click();
    await dialog.getByRole("button", { name: "Publish promo", exact: true }).click();
    await expect(page.getByText("Live: Revision 1", { exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await page.getByLabel("Nama promo").fill("UX Dialog Revision Kedua");
    await page.getByRole("button", { name: "Simpan draft", exact: true }).click();
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(dialog.getByRole("button", { name: "Publish promo", exact: true })).toBeEnabled();
    const current = await data<Offer>(await context.request.get(`/api/admin/discounts/${id}`));
    await data(await context.request.patch(`/api/admin/discounts/${id}/policy`, { data: {
      requestKey: randomUUID(), expectedOfferVersion: current.version, expectedPolicyVersion: current.policyVersion,
      quotaCount: 11, budgetAmount: null, perClientLimit: 1,
    } }));
    await dialog.getByRole("button", { name: "Publish promo", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Muat versi terbaru", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Publish promo", exact: true })).toHaveCount(0);
    await expect(page.getByText("Live: Revision 1", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Muat versi terbaru", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  } finally { await page.close(); }
});

test("detail empat tab mempertahankan input dan membedakan aturan, kode publik, kapasitas live serta audit", async () => {
  const page = await context.newPage();
  try {
    await page.goto(`/admin/discounts/${shipping.id}`);
    await expect(page.getByRole("tab")).toHaveCount(4);
    await expect(page.getByText("Live: Revision 1", { exact: true })).toBeVisible();
    await page.getByLabel("Nama promo").fill("UX input belum disimpan");
    await page.getByRole("tab", { name: "Pemakaian & budget", exact: true }).click();
    await expect(page.getByText(/langsung berlaku/)).toBeVisible();
    await page.getByRole("combobox", { name: "Filter status pemakaian" }).selectOption("reserved");
    await page.getByRole("tab", { name: "Kode", exact: true }).click();
    await expect(page.getByText(/Kupon publik tidak memiliki kode/)).toBeVisible();
    await expect(page.getByLabel("Tambah kode", { exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Riwayat", exact: true }).click();
    await expect(page.getByText("Histori audit", { exact: true })).toBeVisible();
    const policyEvent = page.getByRole("listitem").filter({ hasText: "Kapasitas diubah" }).first();
    await policyEvent.getByText("Lihat perubahan", { exact: true }).click();
    await expect(policyEvent.getByText("Sebelum", { exact: true })).toBeVisible();
    await expect(policyEvent.getByText(/"quotaCount": 100/)).toBeVisible();
    await page.getByRole("tab", { name: "Aturan", exact: true }).click();
    await expect(page.getByLabel("Nama promo")).toHaveValue("UX input belum disimpan");
    await page.getByRole("tab", { name: "Aturan", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Kode", exact: true })).toHaveAttribute("aria-selected", "true");
  } finally { await page.close(); }
});

test("daftar memisahkan jalur sebelum pagination dan menampilkan revision, benefit serta dua kapasitas tersedia", async () => {
  const api = await context.request.get("/api/admin/discounts?activationKind=manual_only&limit=1");
  const body = await api.json();
  expect(body.data).toHaveLength(1);
  expect(body.pagination.total).toBeGreaterThanOrEqual(12);
  expect(body.countsByActivationKind.manual_only).toBeGreaterThanOrEqual(12);
  expect(await api.text()).not.toContain(SECRET);
  expect((await context.request.get("/api/admin/discounts?activationKind=invalid")).status()).toBe(400);
  const page = await context.newPage();
  try {
    await page.goto("/admin/discounts");
    await expect(page.getByRole("tab", { name: /Kupon publik/ })).toHaveAttribute("aria-selected", "true");
    const row = page.getByRole("row").filter({ hasText: "UX Subsidi Ongkir" });
    await expect(row).toContainText("Subsidi ongkir, maks Rp 20.000");
    await expect(row).toContainText("Revision 1");
    await expect(row.getByRole("cell").nth(5)).toContainText("Tersedia 0");
    await expect(row.getByRole("cell").nth(6)).toContainText("Tersedia Rp 0");
    await page.getByRole("tab", { name: /Kode promo/ }).click();
    await expect(page.getByText(/Belum disetel · belum dapat publish/).first()).toBeVisible();
    await expect(page.getByText("UX Subsidi Ongkir", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Berikutnya" })).toBeEnabled();
    await page.getByRole("button", { name: "Berikutnya" }).click();
    await expect(page.getByText(/Halaman 2 dari/)).toBeVisible();
    await page.getByRole("tab", { name: /Kupon publik/ }).click();
    await expect(page.getByText(/Halaman 1 dari/)).toBeVisible();
    const fixedRow = page.getByRole("row").filter({ hasText: "UX Nominal Barang" });
    await expect(fixedRow).toContainText("Nominal barang Rp 25.000");
    await expect(fixedRow.getByRole("cell").nth(6)).toContainText("Tidak dibatasi");
    await expect(page.getByRole("row").filter({ hasText: "UX Persentase Barang" })).toContainText("10% barang, maks Rp 20.000");
    await expect(page.getByRole("row").filter({ hasText: "UX Persentase Tanpa Cap" })).toContainText("10% barang");
  } finally { await page.close(); }
});
