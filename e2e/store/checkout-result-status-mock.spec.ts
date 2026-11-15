/**
 * Halaman hasil pembayaran — status diverifikasi dari DTO, bukan dari query.
 *
 * Plan: `.scratch/checkout-simplification/plan/audit-findings-phase-2.md`
 * (W01, AC2-01). Semua data berasal dari route interception GET
 * `/api/orders/**`; tidak ada mutasi DB, provider call, atau halaman Midtrans.
 * Sesi memakai seam HTTP sign-in yang sudah ada karena GET detail pesanan
 * memvalidasi sesi nyata di server.
 *
 * Cakupan:
 * - query gateway (settlement/capture/pending/deny/cancel) tidak mengalahkan DTO
 * - paid + blocked, paid + cancelled, failed, cancelled, kombinasi kontradiktif
 * - 404 / 401 / 403 / 5xx / envelope atau identitas tidak sah / loading
 * - order_id kosong tidak memicu GET; ID bebas di-encode sebagai satu segmen
 * - login-return: proxy mempertahankan query, email & Google kembali ke pesanan
 *   yang sama tanpa melewati gate onboarding
 *
 * Jalankan lewat konfigurasi mock terisolasi:
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS } from "../config";

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112", "3210", "3211", "3212"]);

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "checkout-result-status-mock.spec.ts harus dijalankan lewat playwright.mock.config.ts"
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
        `spec ini menolak base ${name} non-loopback/port asing (${raw})`
      );
    }
  }
}

const ORDER_ID = "RESULT-2026-11-0001";

/** DTO minimal yang benar-benar dibaca halaman hasil. */
function orderDto(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    status: "pending_payment",
    paymentStatus: "pending",
    fulfillmentBlockedReason: null,
    ...overrides,
  };
}

type Reply = { status: number; body: unknown };

const envelope = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });

async function signIn(page: Page) {
  const res = await page.request.post("/api/auth/sign-in/email", {
    data: TEST_USERS.store,
  });
  expect(res.ok(), `sign-in gagal: ${res.status()} ${await res.text()}`).toBe(true);
}

async function openResult(
  page: Page,
  reply: Reply | (() => Reply),
  query = `order_id=${ORDER_ID}&transaction_status=settlement&status_code=200`
) {
  const resolve = typeof reply === "function" ? reply : () => reply;
  await page.route("**/api/orders/**", async (route) => {
    const next = resolve();
    await route.fulfill({ status: next.status, json: next.body });
  });
  await page.goto(`/checkout/result?${query}`);
}

test.beforeEach(async ({ page }) => {
  requireIsolatedMockRun();
  await signIn(page);
});

// ---------------------------------------------------------------------------
// DTO menang atas query
// ---------------------------------------------------------------------------

test("status mengikuti DTO meski query gateway berlawanan", async ({ page }) => {
  const cases = [
    { query: "settlement", dto: orderDto(), expected: "Menunggu pembayaran" },
    {
      query: "pending",
      dto: orderDto({ status: "processing", paymentStatus: "paid" }),
      expected: "Pembayaran diterima",
    },
    { query: "deny", dto: orderDto(), expected: "Menunggu pembayaran" },
    {
      query: "capture",
      dto: orderDto({ paymentStatus: "failed", status: "failed_payment" }),
      expected: "Pembayaran gagal",
    },
    {
      query: "settlement",
      dto: orderDto({ status: "cancelled", paymentStatus: "pending" }),
      expected: "Pesanan dibatalkan",
    },
    {
      // Kombinasi kontradiktif (order gagal + pembayaran pending) bukan bukti
      // settlement atau kegagalan: tetap netral.
      query: "settlement",
      dto: orderDto({ status: "failed_payment", paymentStatus: "pending" }),
      expected: "Status pembayaran belum dapat dipastikan",
    },
  ];

  for (const item of cases) {
    await page.unroute("**/api/orders/**");
    await openResult(
      page,
      envelope(item.dto),
      `order_id=${ORDER_ID}&transaction_status=${item.query}`
    );
    await expect(
      page.getByRole("heading", { name: item.expected, exact: true })
    ).toBeVisible();
    // Query mentah tidak pernah menjadi pesan pelanggan.
    await expect(page.getByText(item.query, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /Lihat Detail Pesanan/ })
    ).toHaveAttribute("href", `/account/orders/${ORDER_ID}`);
  }
});

test("paid tetap diterima meski pesanan dibatalkan, dan blocked dijelaskan terpisah", async ({
  page,
}) => {
  await openResult(
    page,
    envelope(orderDto({ status: "cancelled", paymentStatus: "paid" }))
  );
  await expect(
    page.getByRole("heading", { name: "Pembayaran diterima", exact: true })
  ).toBeVisible();

  await page.unroute("**/api/orders/**");
  await openResult(
    page,
    envelope(
      orderDto({
        status: "processing",
        paymentStatus: "paid",
        fulfillmentBlockedReason: "MANUAL_REVIEW",
      })
    )
  );
  await expect(
    page.getByRole("heading", {
      name: "Pembayaran diterima, pesanan menunggu verifikasi",
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText(/Tidak perlu membayar ulang/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Kegagalan baca: 404/401/403/5xx/envelope/identitas
// ---------------------------------------------------------------------------

test("GET gagal tidak diklaim sebagai pembayaran gagal dan retry memakai ID sama", async ({
  page,
}) => {
  const paths: string[] = [];
  let failing = true;
  await page.route("**/api/orders/**", async (route) => {
    paths.push(new URL(route.request().url()).pathname);
    if (failing) {
      await route.fulfill({ status: 503, json: { success: false, error: "unavailable" } });
      return;
    }
    await route.fulfill({ json: { success: true, data: orderDto({ paymentStatus: "paid", status: "processing" }) } });
  });
  await page.goto(`/checkout/result?order_id=${ORDER_ID}&transaction_status=deny`);

  await expect(
    page.getByRole("heading", {
      name: "Status pembayaran belum dapat diperiksa",
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByText("Pembayaran gagal", { exact: true })).toHaveCount(0);

  failing = false;
  await page.getByRole("button", { name: "Coba lagi" }).click();
  await expect(
    page.getByRole("heading", { name: "Pembayaran diterima", exact: true })
  ).toBeVisible();
  expect(paths.length).toBeGreaterThanOrEqual(2);
  expect(new Set(paths)).toEqual(new Set([`/api/orders/${ORDER_ID}`]));
});

test("envelope atau identitas yang tidak sah tidak membuktikan apa pun", async ({
  page,
}) => {
  for (const body of [
    { success: false, data: orderDto() },
    { success: true, data: { ...orderDto(), id: "ANOTHER-ORDER" } },
    { success: true },
  ]) {
    await page.unroute("**/api/orders/**");
    await openResult(page, { status: 200, body });
    await expect(
      page.getByRole("heading", {
        name: "Status pembayaran belum dapat diperiksa",
        exact: true,
      })
    ).toBeVisible();
  }
});

test("404, 403, dan 401 memberi langkah lanjut yang berbeda tanpa membocorkan detail", async ({
  page,
}) => {
  await openResult(page, {
    status: 404,
    body: { success: false, error: "Order not found" },
  });
  await expect(
    page.getByRole("heading", { name: "Pesanan tidak ditemukan", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Lihat Pesanan Saya/ })
  ).toHaveAttribute("href", "/account");
  await expect(
    page.getByRole("link", { name: /Lihat Detail Pesanan/ })
  ).toHaveCount(0);

  await page.unroute("**/api/orders/**");
  await openResult(page, {
    status: 403,
    body: { success: false, error: "ONBOARDING_REQUIRED" },
  });
  await expect(
    page.getByRole("heading", { name: "Akses pesanan belum tersedia", exact: true })
  ).toBeVisible();
  await expect(page.getByText(/ONBOARDING_REQUIRED/)).toHaveCount(0);

  await page.unroute("**/api/orders/**");
  await openResult(page, {
    status: 401,
    body: { success: false, error: "UNAUTHORIZED" },
  });
  await expect(
    page.getByRole("heading", { name: "Masuk untuk memeriksa pesanan", exact: true })
  ).toBeVisible();
  const login = page.getByRole("link", { name: "Masuk", exact: true });
  await expect(login).toHaveAttribute(
    "href",
    `/login?callbackUrl=${encodeURIComponent(
      `/checkout/result?order_id=${encodeURIComponent(ORDER_ID)}`
    )}`
  );
});

test("order_id kosong tidak memicu GET dan ID bebas di-encode satu segmen", async ({
  page,
}) => {
  const requests: string[] = [];
  const freeForm = "INV 2026#0001";
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/orders/**", async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await gate;
    await route.fulfill({
      json: { success: true, data: orderDto({ id: freeForm }) },
    });
  });

  // Kosong: tidak ada GET sama sekali, hanya arah ke riwayat.
  await page.goto("/checkout/result?order_id=");
  await expect(
    page.getByRole("heading", { name: "Pesanan belum dapat ditentukan", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Lihat Pesanan Saya/ })
  ).toHaveAttribute("href", "/account");
  expect(requests).toEqual([]);

  // Loading terlihat selama GET berjalan.
  await page.goto(`/checkout/result?order_id=${encodeURIComponent(freeForm)}`);
  await expect(
    page.getByText("Memeriksa status pembayaran…", { exact: true })
  ).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(1);
  release();
  await expect(
    page.getByRole("heading", { name: "Menunggu pembayaran", exact: true })
  ).toBeVisible();
  // Semua permintaan (dev double-effect) memakai ID yang di-encode sebagai SATU
  // segmen path, dan nilai aslinya tetap utuh di layar.
  expect(new Set(requests)).toEqual(
    new Set([`/api/orders/${encodeURIComponent(freeForm)}`])
  );
  await expect(page.locator("code")).toHaveText(freeForm);
});

// ---------------------------------------------------------------------------
// Login-return
// ---------------------------------------------------------------------------

test("tanpa sesi, proxy membawa pathname DAN query order_id ke login", async ({
  browser,
}) => {
  requireIsolatedMockRun();
  const context = await browser.newContext({ baseURL: STORE_BASE_URL });
  const page = await context.newPage();
  try {
    await page.goto(
      `/checkout/result?order_id=${ORDER_ID}&transaction_status=settlement`
    );
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    const callback = new URL(page.url()).searchParams.get("callbackUrl");
    expect(callback).toBe(`/checkout/result?order_id=${ORDER_ID}&transaction_status=settlement`);
  } finally {
    await context.close();
  }
});

test("login email kembali ke halaman hasil dengan order_id yang sama", async ({
  page,
}) => {
  const callbacks: string[] = [];
  await page.route("**/api/orders/**", async (route) => {
    await route.fulfill({ json: { success: true, data: orderDto() } });
  });
  // Seam login: response sukses dipakai apa adanya, lalu navigasi ke sync yang
  // membawa safe callback internal.
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await route.fulfill({
      json: { redirect: false, token: "result-spec-token", user: { id: "result-spec-user" } },
    });
  });
  await page.route("**/api/onboarding/sync**", async (route) => {
    const callback = new URL(route.request().url()).searchParams.get("callbackUrl");
    callbacks.push(callback ?? "");
    await route.fulfill({
      status: 307,
      headers: { location: callback ?? "/" },
    });
  });

  await page.goto(`/login?callbackUrl=${encodeURIComponent(`/checkout/result?order_id=${ORDER_ID}`)}`);
  const form = page.locator("form");
  await form.getByLabel("Email").fill(TEST_USERS.store.email);
  await form.getByLabel("Password").fill(TEST_USERS.store.password);
  await form.getByRole("button", { name: "Masuk", exact: true }).click();

  await expect(page).toHaveURL(
    new RegExp(`/checkout/result\\?order_id=${ORDER_ID}$`)
  );
  await expect(
    page.getByRole("heading", { name: "Menunggu pembayaran", exact: true })
  ).toBeVisible();
  await expect(page.locator("code")).toHaveText(ORDER_ID);
  expect(callbacks).toEqual([`/checkout/result?order_id=${ORDER_ID}`]);
});

test("login Google membawa safe callback yang sama ke onboarding sync", async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/auth/sign-in/social", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { url: `${STORE_BASE_URL}/__provider` } });
  });

  await page.goto(
    `/login?callbackUrl=${encodeURIComponent(`/checkout/result?order_id=${ORDER_ID}`)}`
  );
  await page.getByRole("button", { name: /Masuk dengan Google/ }).click();

  await expect
    .poll(() => bodies.length, { message: "POST sign-in/social belum terkirim" })
    .toBeGreaterThan(0);
  const body = bodies[0];
  expect(body.provider).toBe("google");
  expect(body.callbackURL).toBe(
    `/api/onboarding/sync?callbackUrl=${encodeURIComponent(
      `/checkout/result?order_id=${ORDER_ID}`
    )}`
  );
  expect(body.newUserCallbackURL).toBe("/onboarding");
});
