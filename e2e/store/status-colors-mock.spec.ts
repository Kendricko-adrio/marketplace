/**
 * Warna status semantik — surface STORE (spec §5.1, AC01/AC04/AC05/AC06/AC11/AC12).
 *
 * Strategi: fixture DTO ditulis literal, sesi lewat seam HTTP sign-in yang
 * sudah ada, dan data per halaman diambil dari respons API yang di-mock
 * (route interception) — komponen, token CSS, dan halaman yang dirender tetap
 * produksi. Halaman `/products` dan `/branches` adalah Server Component yang
 * membaca DB, jadi di sana kontraknya diuji sebagai invariant atas hasil
 * render nyata (DB disposable yang sudah di-seed).
 *
 * Expected warna TIDAK diambil dari token implementasi: helper
 * `../support/status-colors` menyimpan palet literal spec §7.1 dan membaca
 * computed style. Passing spec ini berarti pengguna melihat warna yang
 * disepakati, bukan bahwa className tertentu tertulis.
 *
 * Jalankan lewat konfigurasi mock terisolasi (butuh sesi nyata):
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { expect, test, type Page } from "@playwright/test";

import { TEST_USERS } from "../config";
import {
  expectStableOnHover,
  expectStatusTone,
  setStatusTheme,
  type StatusTone,
} from "../support/status-colors";

const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

/** Fail closed kecuali berjalan pada konfigurasi mock terisolasi. */
function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "status-colors-mock.spec.ts (store) harus dijalankan lewat playwright.mock.config.ts"
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

// ---------------------------------------------------------------------------
// Fixture: riwayat pesanan (enam nilai + satu nilai asing)
// ---------------------------------------------------------------------------

type ListOrder = {
  id: string;
  status: string;
  label: string;
  tone: StatusTone;
};

const HISTORY: ListOrder[] = [
  {
    id: "sc-pending-payment",
    status: "pending_payment",
    label: "Pending Payment",
    tone: "waiting",
  },
  {
    id: "sc-processing",
    status: "processing",
    label: "Processing",
    tone: "progress",
  },
  {
    id: "sc-ready-for-pickup",
    status: "ready_for_pickup",
    label: "Ready for Pickup",
    tone: "ready",
  },
  {
    id: "sc-completed",
    status: "completed",
    label: "Completed",
    tone: "success",
  },
  {
    id: "sc-cancelled",
    status: "cancelled",
    label: "Cancelled",
    tone: "cancelled",
  },
  {
    id: "sc-failed-payment",
    status: "failed_payment",
    label: "Payment Failed",
    tone: "error",
  },
  {
    id: "sc-awaiting-marketplace-review",
    status: "awaiting_marketplace_review",
    label: "Status pesanan belum tersedia",
    tone: "neutral",
  },
];

function listOrder(order: ListOrder) {
  return {
    id: order.id,
    userId: "client-e2e",
    status: order.status,
    paymentMethod: "bank_transfer",
    paymentStatus: "pending",
    subtotal: "100000",
    shippingCost: "0",
    discount: "0",
    serviceFee: "0",
    total: "100000",
    createdAt: "2026-11-01T02:00:00Z",
    items: [
      {
        id: `${order.id}-item`,
        orderId: order.id,
        variantId: `${order.id}-variant`,
        productName: `Produk ${order.id}`,
        variantInfo: null,
        price: "100000",
        quantity: 1,
        createdAt: "2026-11-01T02:00:00Z",
        productId: `${order.id}-product`,
        imageUrl: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Fixture: detail pesanan
// ---------------------------------------------------------------------------

const DELIVERY_SNAPSHOT = {
  address: {
    recipientName: "Nadia Pertiwi",
    phone: "081234567890",
    fullAddress: "Jl. Merdeka Raya No. 128, Depok, Jawa Barat",
    provinceId: "9",
    province: "Jawa Barat",
    cityId: "78",
    city: "Depok",
    districtId: "1123",
    areaId: "44321",
    district: "Cilodong",
    area: "Sukamaju",
    postalCode: "16415",
  },
  origin: {
    branchId: "branch-e2e",
    name: "ADF Cabang Depok",
    phone: "081200000000",
    address: "Jl. Margonda No. 1",
    zipcode: "16411",
    areaId: null,
  },
  parcel: { weight: 1200, items: [] },
  service: {
    courierId: 1,
    serviceId: 2,
    name: "JNE REG",
    shippingCost: "18000",
    validEta: { from: "2", to: "3" },
  },
  pricing: {
    subtotal: "265000",
    discount: "0",
    taxableBase: "283000",
    shippingCost: "18000",
    serviceFee: "0",
    ppnRatePercent: "11",
    ppnAmount: "31130",
    total: "314130",
  },
};

const ITEMS = [
  {
    id: "item-e2e-1",
    orderId: "SC-DETAIL-ORDER",
    variantId: "variant-e2e-1",
    productName: "Serum Pelembab Wajah",
    variantInfo: "Ukuran: 30 ml",
    price: "185000",
    quantity: 1,
    createdAt: "2026-11-01T02:00:00Z",
    productId: "product-e2e-1",
    imageUrl: null,
    slug: "serum-pelembab",
  },
];

function detailOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "SC-DETAIL-ORDER",
    userId: "client-e2e",
    status: "processing",
    paymentMethod: "bank_transfer",
    paymentStatus: "paid",
    paymentFailureReason: null,
    fulfillmentBlockedReason: null,
    pickupCode: null,
    pickupDate: null,
    pickupTime: null,
    contactPhone: "081234567890",
    contactEmail: "detail-e2e@example.test",
    subtotal: "265000",
    shippingCost: "18000",
    discount: "0",
    serviceFee: "0",
    ppnRate: "11",
    ppnAmount: "31130",
    total: "314130",
    createdAt: "2026-11-01T02:00:00Z",
    snapRedirectUrl: null,
    paymentRecovery: null,
    fulfillmentMethod: "delivery",
    deliverySnapshot: DELIVERY_SNAPSHOT,
    promo: null,
    shipment: null,
    branch: null,
    items: ITEMS,
    ...overrides,
  };
}

const TIMELINE = [
  { status: "WAITING", detail: null, at: "2026-11-01T03:00:00Z" },
  { status: "PICKED_UP", detail: "Paket diambil kurir uji", at: "2026-11-01T06:05:00Z" },
  { status: "ON_HOLD", detail: "Alamat sedang dikonfirmasi ulang", at: "2026-11-01T09:40:00Z" },
  { status: "RETURNED", detail: null, at: "2026-11-01T10:40:00Z" },
  { status: "CANCELED", detail: null, at: "2026-11-01T11:40:00Z" },
  { status: "SHIPMENT_ISSUE", detail: null, at: "2026-11-01T12:40:00Z" },
  { status: "DELIVERED", detail: "Diterima oleh penerima", at: "2026-11-02T07:20:00Z" },
];

// ---------------------------------------------------------------------------
// Seam sesi + route mock
// ---------------------------------------------------------------------------

async function signIn(page: Page) {
  const res = await page.request.post("/api/auth/sign-in/email", {
    data: TEST_USERS.store,
  });
  expect(res.ok(), `sign-in gagal: ${res.status()} ${await res.text()}`).toBe(
    true
  );
}

async function openHistory(page: Page) {
  await page.route("**/api/orders", async (route) => {
    await route.fulfill({
      json: { success: true, data: HISTORY.map(listOrder) },
    });
  });
  await page.goto("/account");
  await expect(page.getByText("Pesanan Saya")).toBeVisible();
}

async function openDetail(
  page: Page,
  order: Record<string, unknown>
) {
  await page.route("**/api/orders/**", async (route) => {
    await route.fulfill({ json: { success: true, data: order } });
  });
  await page.goto(`/account/orders/${String(order.id)}`);
  await expect(page.getByRole("heading", { name: "Detail Pesanan" })).toBeVisible();
}

function badgeByText(page: Page, text: string) {
  return page.locator(`[data-status-tone]`).filter({ hasText: text }).first();
}

test.beforeEach(async ({ page }) => {
  requireIsolatedMockRun();
  await signIn(page);
});

// ---------------------------------------------------------------------------
// AC01 — riwayat: ready teal, completed emerald, bukan navy identik
// ---------------------------------------------------------------------------

test("riwayat pesanan membedakan seluruh status order dan tidak menyamakan ready dengan completed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openHistory(page);

  for (const order of HISTORY) {
    await expectStatusTone(badgeByText(page, order.label), order.tone);
  }

  // AC01: dua status yang dulu identik sekarang berbeda tone dan warna.
  const ready = await badgeByText(page, "Ready for Pickup").evaluate((node) => {
    const style = getComputedStyle(node);
    return `${style.backgroundColor}|${style.color}`;
  });
  const completed = await badgeByText(page, "Completed").evaluate((node) => {
    const style = getComputedStyle(node);
    return `${style.backgroundColor}|${style.color}`;
  });
  expect(ready).not.toBe(completed);

  // Nilai asing tidak membocorkan identifier mentah ke customer.
  await expect(page.getByText("awaiting_marketplace_review")).toHaveCount(0);

  // Badge non-status (member tier) tidak ikut menjadi indikator status.
  const member = page.getByText("Member Silver", { exact: true });
  await expect(member).toBeVisible();
  await expect(member).not.toHaveAttribute("data-status-tone", /.+/);
});

test("badge status pasif tetap stabil saat hover dan memakai palet dark yang disepakati", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openHistory(page);

  await expectStableOnHover(badgeByText(page, "Ready for Pickup"));

  await setStatusTheme(page, "dark");
  for (const order of HISTORY) {
    await expectStatusTone(badgeByText(page, order.label), order.tone, "dark");
  }
  await setStatusTheme(page, "light");
  await expectStatusTone(badgeByText(page, "Ready for Pickup"), "ready", "light");
});

// ---------------------------------------------------------------------------
// AC04/AC05 — detail: order, pembayaran, redemption, dan tracking terpisah
// ---------------------------------------------------------------------------

test("detail pesanan memisahkan order, pembayaran, promo, dan tracking yang sudah diterima", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDetail(
    page,
    detailOrder({
      promo: {
        name: "Promo Hemat",
        benefitAmount: "20000",
        status: "consumed",
        consumedAt: "2026-11-01T03:00:00Z",
        releasedAt: null,
      },
      shipment: {
        awb: "E2ESTATUS0001",
        trackingUrl: null,
        latestStatus: "DELIVERED",
        delivered: true,
        deliveredAt: "2026-11-02T07:20:00Z",
        podUrl: null,
        timeline: TIMELINE,
      },
    })
  );

  // Empat dimensi terlihat bersamaan tanpa saling menimpa.
  await expectStatusTone(page.getByLabel("Status pesanan"), "progress");
  await expectStatusTone(badgeByText(page, "Lunas"), "success");
  await expectStatusTone(badgeByText(page, "Dipakai (lunas)"), "success");
  await expectStatusTone(badgeByText(page, "Paket telah diterima"), "success");

  // Timeline memakai resolver tracking yang sama, bukan satu warna. Empat
  // event terbaru tampil langsung; sisanya lewat disclosure existing.
  const tracking = page.getByRole("region", { name: "Lacak paket" });
  await expectStatusTone(
    tracking.getByText("Paket dikembalikan", { exact: true }).first(),
    "cancelled"
  );
  await expectStatusTone(
    tracking.getByText("Pengiriman dibatalkan", { exact: true }).first(),
    "cancelled"
  );
  await expectStatusTone(
    tracking.getByText("Pengiriman mengalami kendala", { exact: true }).first(),
    "error"
  );

  await tracking.getByRole("button", { name: "Lihat semua riwayat" }).click();
  await expectStatusTone(
    tracking.getByText("Pengiriman tertunda", { exact: true }).first(),
    "progress"
  );
  await expectStatusTone(
    tracking.getByText("Paket diambil kurir", { exact: true }).first(),
    "info"
  );
  await expectStatusTone(
    tracking.getByText("Menunggu kurir", { exact: true }).first(),
    "waiting"
  );
});

test("pembayaran lunas tetap success walau status order dan promo masih menunggu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDetail(
    page,
    detailOrder({
      status: "pending_payment",
      paymentStatus: "pending",
      promo: {
        name: "Promo Reservasi",
        benefitAmount: "15000",
        status: "reserved",
        consumedAt: null,
        releasedAt: null,
      },
    })
  );

  await expectStatusTone(page.getByLabel("Status pesanan"), "waiting");
  await expectStatusTone(badgeByText(page, "Menunggu"), "waiting");
  await expectStatusTone(
    badgeByText(page, "Direservasi sampai batas pembayaran"),
    "waiting"
  );
});

test("status promo asing tidak diklaim reserved dan order selesai bukan bukti barang diterima", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDetail(
    page,
    detailOrder({
      id: "SC-DETAIL-COMPLETED",
      status: "completed",
      paymentStatus: "paid",
      promo: {
        name: "Promo Masa Depan",
        benefitAmount: "10000",
        status: "awaiting_future_state",
        consumedAt: null,
        releasedAt: null,
      },
      shipment: {
        awb: "E2ESTATUS0002",
        trackingUrl: null,
        latestStatus: "SOME_FUTURE_PROVIDER_CODE",
        delivered: false,
        deliveredAt: null,
        podUrl: null,
        timeline: [
          {
            status: "SOME_FUTURE_PROVIDER_CODE",
            detail: null,
            at: "2026-11-03T01:00:00Z",
          },
        ],
      },
    })
  );

  await expectStatusTone(page.getByLabel("Status pesanan"), "success");
  await expectStatusTone(badgeByText(page, "Status promo belum tersedia"), "neutral");
  await expect(page.getByText("awaiting_future_state")).toHaveCount(0);

  // Tracking asing tetap netral dan berlabel eksplisit, bukan klaim delivered.
  const tracking = page.getByRole("region", { name: "Lacak paket" });
  await expectStatusTone(
    tracking.getByText("Pembaruan pengiriman", { exact: true }).first(),
    "neutral"
  );
  await expect(page.getByText("SOME_FUTURE_PROVIDER_CODE")).toHaveCount(0);
});

test("status order asing memakai label aman dan tone netral", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDetail(
    page,
    detailOrder({ id: "SC-DETAIL-UNKNOWN", status: "awaiting_review" })
  );

  await expectStatusTone(
    page.getByLabel("Status pesanan"),
    "neutral"
  );
  await expect(page.getByLabel("Status pesanan")).toHaveText(
    "Status pesanan belum tersedia"
  );
  await expect(page.getByText("awaiting_review")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// AC05 — hasil checkout memakai tone semantik
// ---------------------------------------------------------------------------

test("hasil checkout memakai tone success/waiting/error dengan copy existing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/checkout/result?order_id=sc-result-1&transaction_status=settlement");
  await expect(
    page.getByRole("heading", { name: "Pembayaran Berhasil!" })
  ).toBeVisible();
  await expectStatusTone(
    page.locator('[data-status-tone="success"]').first(),
    "success"
  );

  await page.goto("/checkout/result?order_id=sc-result-1&transaction_status=pending");
  await expect(
    page.getByRole("heading", { name: "Menunggu Pembayaran" })
  ).toBeVisible();
  await expectStatusTone(
    page.locator('[data-status-tone="waiting"]').first(),
    "waiting"
  );

  // Tanpa order id = kondisi gagal existing (bukan status server baru).
  await page.goto("/checkout/result");
  await expect(
    page.getByRole("heading", { name: "Pembayaran Gagal" })
  ).toBeVisible();
  await expectStatusTone(
    page.locator('[data-status-tone="error"]').first(),
    "error"
  );
});

// ---------------------------------------------------------------------------
// AC05 — verifikasi email: progress → success, dan gagal
// ---------------------------------------------------------------------------

test("verifikasi email menampilkan progres lalu sukses dengan ikon tone semantik", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/verify-email**", async (route) => {
    await gate;
    await route.fulfill({ json: { status: true } });
  });

  await page.goto("/auth/verify?token=status-colors-token&callbackURL=/login");
  await expect(page.getByText("Memverifikasi...")).toBeVisible();
  await expectStatusTone(page.locator("[data-status-tone]").first(), "progress");

  release();
  await expect(page.getByText("Email Terverifikasi!")).toBeVisible();
  await expectStatusTone(page.locator("[data-status-tone]").first(), "success");
});

test("verifikasi email tanpa token menampilkan tone error", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/auth/verify");
  await expect(page.getByText("Verifikasi Gagal")).toBeVisible();
  await expectStatusTone(page.locator("[data-status-tone]").first(), "error");
});

// ---------------------------------------------------------------------------
// AC06 — consumer shared ProductCard/BranchCard pada halaman store nyata
// ---------------------------------------------------------------------------

test("cabang aktif memakai tone success dan label Buka tidak berubah", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/branches");

  const open = page.locator('[data-status-tone="success"]').filter({ hasText: "Buka" });
  expect(await open.count()).toBeGreaterThan(0);
  await expectStatusTone(open.first(), "success");
});

test("kartu produk store tidak pernah memakai tone yang salah untuk status stok", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/products?limit=50");

  const badges = page.locator("[data-status-tone]");
  const count = await badges.count();
  for (let index = 0; index < count; index += 1) {
    const badge = badges.nth(index);
    const text = (await badge.textContent())?.trim() ?? "";
    if (text === "Stok Belum Tersedia") {
      await expectStatusTone(badge, "progress");
    } else if (text === "Cek stok saat bayar") {
      await expectStatusTone(badge, "info");
    } else {
      throw new Error(`tone status tidak dikenal pada kartu produk: "${text}"`);
    }
  }

  // Badge diskon tetap badge kategori, bukan indikator status.
  const discount = page.getByText(/^\d+%$/).first();
  if ((await discount.count()) > 0) {
    await expect(discount).not.toHaveAttribute("data-status-tone", /.+/);
  }
});
