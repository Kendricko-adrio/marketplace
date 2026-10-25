/**
 * Stok storefront: seam HTTP + browser, PG disposable dan provider mock.
 * SQL hanya menyiapkan fixture; hasil diverifikasi melalui HTTP/UI.
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import dotenv from "dotenv";
import { TEST_USERS } from "../config";

dotenv.config({ path: ".env" });
const baseURL = process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const dbName = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid").pathname.slice(1);
if (process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !/^marketplace_discounts_test_[A-Za-z0-9_]+$/.test(dbName) ||
    !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname) ||
    new URL(baseURL).port !== "3110") {
  throw new Error("stock-visibility requires isolated mock config and disposable DB");
}

const prefix = "e2e-stock-visible";
const mixed = `${prefix}-mixed`;
const empty = `${prefix}-empty`;
const unknown = `${prefix}-unknown`;
const held = `${prefix}-held`;
const zero = `${prefix}-zero`;
const redM = `${prefix}-red-m`;
const blueL = `${prefix}-blue-l`;
const emptyVariant = `${prefix}-empty-variant`;
const variants = [zero, redM, blueL, unknown, held, emptyVariant];
const products = [mixed, empty, unknown, held];
let pool: Pool;
let context: BrowserContext;
let branchA: string;
let branchB: string;
let branchNameA: string;
let branchNameB: string;

async function cleanup() {
  await pool.query("DELETE FROM cart_item WHERE variant_id = ANY($1::text[])", [variants]);
  await pool.query("DELETE FROM homepage_section WHERE id LIKE $1", [`${prefix}%`]);
  await pool.query("DELETE FROM branch_stock WHERE product_variant_id = ANY($1::text[])", [variants]);
  await pool.query("DELETE FROM product_variant WHERE id = ANY($1::text[])", [variants]);
  await pool.query("DELETE FROM product WHERE id = ANY($1::text[])", [products]);
}

test.beforeAll(async ({ browser }) => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  await cleanup();
  const branches = await pool.query(
    "SELECT id, name FROM branch WHERE status='aktif' AND jubelio_location_id IS NOT NULL ORDER BY id LIMIT 2"
  );
  expect(branches.rows.length).toBe(2);
  [branchA, branchB] = branches.rows.map(b => b.id);
  [branchNameA, branchNameB] = branches.rows.map(b => b.name);
  for (const id of products) {
    await pool.query(
      "INSERT INTO product(id,name,slug,base_price,status) VALUES($1,$2,$1,'100000','aktif')",
      [id, `Stock Visibility ${id}`]
    );
  }
  await pool.query(
    `INSERT INTO product_variant(id,product_id,sku,price,is_default,color,size,jubelio_item_id) VALUES
      ($1,$4,$1,'10000',true,'Red','S',980001),
      ($2,$4,$2,'20000',false,'Red','M',980002),
      ($3,$4,$3,'30000',false,'Blue','L',980003),
      ($5,$5,$5,'5000',true,NULL,NULL,980004),
      ($6,$6,$6,'5000',true,NULL,NULL,980005)`,
    [zero, redM, blueL, mixed, unknown, held]
  );
  // Produk empty memakai varian zero terpisah agar URL langsung dapat diuji.
  await pool.query(
    "INSERT INTO product_variant(id,product_id,sku,price,is_default,jubelio_item_id) VALUES($1,$2,$1,'10000',true,980006)",
    [emptyVariant, empty]
  );
  for (const variant of variants) {
    for (const branch of [branchA, branchB]) {
      await pool.query(
        `INSERT INTO branch_stock(branch_id,product_variant_id,stock,available_stock,pending_remote_stock)
          VALUES($1,$2,10,$3,$4)`,
        [branch, variant, variant === unknown ? null : variant === redM && branch === branchA ? 3 :
          variant === blueL && branch === branchB ? 1 : variant === held ? 2 : 0,
         variant === redM && branch === branchA ? 1 : variant === held ? 2 : 0]
      );
    }
  }
  context = await browser.newContext({ baseURL });
  const login = await context.request.post("/api/auth/sign-in/email", { data: TEST_USERS.store });
  expect(login.ok(), await login.text()).toBe(true);
});

test.afterAll(async () => {
  await context?.close();
  if (pool) { await cleanup(); await pool.end(); }
});

test.beforeEach(async () => {
  await pool.query("DELETE FROM cart_item WHERE variant_id = ANY($1::text[])", [variants]);
});

test("API menolak stok nol, null, dan stok yang seluruhnya tertahan", async () => {
  for (const variantId of [zero, unknown, held]) {
    const response = await context.request.post("/api/cart/items", {
      data: { variantId, branchId: branchA, quantity: 1 },
    });
    expect(response.status(), variantId).toBe(400);
    expect((await response.json()).success).toBe(false);
  }
  const cart = await (await context.request.get("/api/cart")).json();
  expect(cart.data.items.filter((i: { variantId: string }) => variants.includes(i.variantId))).toEqual([]);
});

test("katalog dan detail hanya mengembalikan stok tersedia dengan harga dan pagination sesuai", async () => {
  const list = async (query = "") => (await context.request.get(`/api/products?search=${prefix}${query}`)).json();
  const catalog = await list("&limit=1");
  expect(catalog.data.map((p: { id: string }) => p.id)).toEqual([mixed]);
  expect(catalog.pagination).toMatchObject({ total: 1, totalPages: 1 });
  expect(catalog.data[0]).toMatchObject({ price: "20000", sourcePrice: "20000", hasStock: true });
  const branchFiltered = await list(`&branch=${branchB}`);
  expect(branchFiltered.data.map((p: { id: string }) => p.id)).toEqual([mixed]);
  expect(branchFiltered.data[0].price).toBe("30000");
  expect((await list("&maxPrice=10000")).pagination.total).toBe(0);
  const detail = await (await context.request.get(`/api/products/${mixed}`)).json();
  expect(detail.data.variants.map((v: { id: string }) => v.id).sort()).toEqual([redM, blueL].sort());
  expect(detail.data.sizes.sort()).toEqual(["L", "M"]);
  const red = detail.data.variants.find((v: { id: string }) => v.id === redM);
  expect(red.branchStock.map((b: { branchId: string; available: number }) => [b.branchId, b.available])).toEqual([[branchA, 2]]);
  const soldOut = await (await context.request.get(`/api/products/${empty}`)).json();
  expect(soldOut.data.variants).toEqual([]);
  expect(soldOut.data.sizes).toEqual([]);
});

test("homepage manual dan filter menyembunyikan produk habis sebelum limit", async () => {
  for (const [suffix, content] of [
    ["manual", { mode: "manual" }],
    ["filter", { mode: "filter", filter: { search: prefix }, limit: 1 }],
    ["price", { mode: "filter", filter: { search: prefix, maxPrice: "10000" }, limit: 1 }],
  ] as const) {
    await pool.query("INSERT INTO homepage_section(id,type,title,content) VALUES($1,'carousel_product',$1,$2)",
      [`${prefix}-${suffix}`, JSON.stringify(content)]);
  }
  for (const [index, id] of products.entries()) {
    await pool.query("INSERT INTO homepage_section_product(section_id,product_id,display_order) VALUES($1,$2,$3)",
      [`${prefix}-manual`, id, index]);
  }
  const home = await (await context.request.get("/api/homepage")).json();
  for (const suffix of ["manual", "filter"]) {
    const section = home.data.find((s: { id: string }) => s.id === `${prefix}-${suffix}`);
    expect(section.products.map((p: { id: string }) => p.id)).toEqual([mixed]);
    expect(section.products[0].price).toBe("20000");
  }
  expect(home.data.find((s: { id: string }) => s.id === `${prefix}-price`).products).toEqual([]);
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: `${prefix}-manual`, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `Stock Visibility ${empty}`, exact: true })).toHaveCount(0);
  } finally { await page.close(); }
});

test("browser hanya menawarkan kombinasi tersedia dan membatasi quantity sebelum add", async () => {
  const page = await context.newPage();
  try {
    await page.goto(`/products/${mixed}`);
    await page.getByRole("button", { name: "Red", exact: true }).click();
    await expect(page.getByRole("button", { name: "S", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "M", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "L", exact: true })).toHaveCount(0);
    const add = page.getByRole("button", { name: "Masukkan Keranjang", exact: true });
    await expect(add).toBeDisabled();
    await expect(page.getByRole("button", { name: new RegExp(branchNameB) })).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(branchNameA) }).click();
    await expect(add).toBeEnabled();
    await page.getByRole("button", { name: "Tambah jumlah", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Jumlah", exact: true })).toHaveValue("2");
    await expect(page.getByRole("button", { name: "Tambah jumlah", exact: true })).toBeDisabled();
    await add.click();
    await expect(page.getByText("Produk berhasil ditambahkan ke keranjang!")).toBeVisible();
    const cart = await (await context.request.get("/api/cart")).json();
    expect(cart.data.items.find((i: { variantId: string }) => i.variantId === redM).quantity).toBe(2);
    await page.getByRole("button", { name: "Blue", exact: true }).click();
    await expect(page.getByRole("button", { name: "M", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "L", exact: true })).toBeVisible();
    await expect(add).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Jumlah", exact: true })).toHaveValue("1");
    await page.getByRole("button", { name: new RegExp(branchNameB) }).click();
    await expect(add).toBeEnabled();
    await expect(page.getByRole("button", { name: "Tambah jumlah", exact: true })).toBeDisabled();
    await page.goto(`/products/${empty}`);
    await expect(page.getByText("Stok habis", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Masukkan Keranjang", exact: true })).toBeDisabled();
    await page.goto(`/products?search=${prefix}`);
    await expect(page.getByRole("link", { name: `Stock Visibility ${mixed}`, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `Stock Visibility ${empty}`, exact: true })).toHaveCount(0);
  } finally { await page.close(); }
});

test("keranjang membatasi tombol quantity dan tetap menyimpan item yang kemudian habis", async () => {
  const added = await context.request.post("/api/cart/items", { data: { variantId: redM, branchId: branchA, quantity: 2 } });
  expect(added.status()).toBe(200);
  const cart = await (await context.request.get("/api/cart")).json();
  const item = cart.data.items.find((i: { variantId: string }) => i.variantId === redM);
  expect(item.available).toBe(2);
  const page = await context.newPage();
  try {
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: `Stock Visibility ${mixed}`, exact: true })).toBeVisible();
    const row = page.getByRole("heading", { name: `Stock Visibility ${mixed}`, exact: true }).locator("xpath=ancestor::div[contains(@class, 'bg-card')][1]");
    await expect(row.getByRole("button", { name: "Tambah jumlah", exact: true })).toBeDisabled();
    await pool.query("UPDATE branch_stock SET available_stock=0 WHERE product_variant_id=$1 AND branch_id=$2", [redM, branchA]);
    await page.reload();
    await expect(row.getByText("Stok habis", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Tambah jumlah", exact: true })).toBeDisabled();
    const after = await (await context.request.get("/api/cart")).json();
    expect(after.data.items.find((i: { id: string }) => i.id === item.id)).toMatchObject({ quantity: 2, available: 0 });
  } finally {
    await pool.query("UPDATE branch_stock SET available_stock=3 WHERE product_variant_id=$1 AND branch_id=$2", [redM, branchA]);
    await page.close();
  }
});

test("cabang nonaktif atau mapping hilang tidak meloloskan quantity item lama", async () => {
  const added = await context.request.post("/api/cart/items", { data: { variantId: redM, branchId: branchA, quantity: 1 } });
  expect(added.status()).toBe(200);
  const cart = await (await context.request.get("/api/cart")).json();
  const item = cart.data.items.find((i: { variantId: string }) => i.variantId === redM);
  try {
    await pool.query("UPDATE branch SET status='nonaktif' WHERE id=$1", [branchA]);
    expect((await context.request.put(`/api/cart/items/${item.id}`, { data: { quantity: 1 } })).status()).toBe(400);
    const list = await (await context.request.get(`/api/products?search=${prefix}&branch=${branchA}`)).json();
    expect(list.pagination.total).toBe(0);
    await pool.query("UPDATE branch SET status='aktif' WHERE id=$1", [branchA]);
    await pool.query("UPDATE product_variant SET jubelio_item_id=NULL WHERE id=$1", [redM]);
    expect((await context.request.put(`/api/cart/items/${item.id}`, { data: { quantity: 1 } })).status()).toBe(400);
    const detail = await (await context.request.get(`/api/products/${mixed}`)).json();
    expect(detail.data.variants.map((v: { id: string }) => v.id)).toEqual([blueL]);
  } finally {
    await pool.query("UPDATE branch SET status='aktif' WHERE id=$1", [branchA]);
    await pool.query("UPDATE product_variant SET jubelio_item_id=980002 WHERE id=$1", [redM]);
  }
});

test("quantity kumulatif dibatasi stok termasuk request konkuren dan update", async () => {
  const add = (quantity: number) => context.request.post("/api/cart/items", {
    data: { variantId: redM, branchId: branchA, quantity },
  });
  expect((await add(3)).status()).toBe(400); // 3 available - 1 pending = 2.
  const responses = await Promise.all([add(1), add(1), add(1)]);
  expect(responses.map(r => r.status()).sort()).toEqual([200, 200, 400]);
  const cart = await (await context.request.get("/api/cart")).json();
  const item = cart.data.items.find((i: { variantId: string }) => i.variantId === redM);
  expect(item.quantity).toBe(2);
  const update = (quantity: number) => context.request.put(`/api/cart/items/${item.id}`, { data: { quantity } });
  expect((await update(3)).status()).toBe(400);
  expect((await update(1)).status()).toBe(200);
  try {
    await pool.query("UPDATE branch_stock SET available_stock=0 WHERE product_variant_id=$1 AND branch_id=$2", [redM, branchA]);
    expect((await update(1)).status()).toBe(400);
    const after = await (await context.request.get("/api/cart")).json();
    expect(after.data.items.find((i: { id: string }) => i.id === item.id).quantity).toBe(1);
  } finally {
    await pool.query("UPDATE branch_stock SET available_stock=3 WHERE product_variant_id=$1 AND branch_id=$2", [redM, branchA]);
  }
});
