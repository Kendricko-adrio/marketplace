/**
 * Warna status semantik — surface ADMIN (spec §5.2, AC03/AC04/AC07–AC13).
 *
 * Semua halaman admin yang datanya datang lewat `fetch` diuji dengan route
 * interception sehingga fixture deterministik dan tidak menyentuh data
 * operasional. `/admin/customers/[id]` adalah Server Component, jadi di sana
 * kontrak diuji pada customer seeded di DB disposable:
 * `jane@example.com` (onboarding pending + email verified) membuktikan kedua
 * dimensi tidak saling diturunkan.
 *
 * Expected warna berasal dari palet literal spec §7.1 (helper
 * `../support/status-colors`) sehingga equality lintas app terbukti karena
 * kedua spec memakai palet yang sama.
 *
 * Jalankan lewat konfigurasi mock terisolasi:
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  expectStableOnHover,
  expectStatusTone,
  setStatusTheme,
} from "../support/status-colors";

const ADMIN_BASE_URL =
  process.env.E2E_MOCK_ADMIN_BASE_URL ?? "http://localhost:3111";
const MOCK_PORTS = new Set(["3110", "3111", "3112"]);

/**
 * Customer seeded yang dipakai menguji pemisahan onboarding vs email:
 * onboarding pending + email verified (dua dimensi tidak saling diturunkan),
 * dan onboarding completed. ID di-resolve lewat API agar spec tidak bergantung
 * pada UUID hasil seed di satu mesin.
 */
let janeId = "";
let johnId = "";
let context: BrowserContext;

async function resolveSeededCustomer(email: string): Promise<string> {
  const res = await context.request.get(
    `/api/admin/customers?search=${encodeURIComponent(email)}&page=1&limit=5`
  );
  expect(res.ok(), `gagal membaca customer ${email}`).toBe(true);
  const body = (await res.json()) as {
    success: boolean;
    data: Array<{ id: string; email: string }>;
  };
  const match = body.data?.find((row) => row.email === email);
  expect(match, `customer ${email} tidak ditemukan di DB seed`).toBeTruthy();
  return match!.id;
}

function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_ADMIN_BASE_URL
  ) {
    throw new Error(
      "status-colors-mock.spec.ts (admin) harus dijalankan lewat playwright.mock.config.ts"
    );
  }
  const parsed = new URL(ADMIN_BASE_URL);
  const loopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!loopback || !MOCK_PORTS.has(parsed.port)) {
    throw new Error(
      `spec ini menolak base admin non-loopback/port asing (${ADMIN_BASE_URL})`
    );
  }
}

test.beforeAll(async ({ browser }) => {
  requireIsolatedMockRun();
  context = await browser.newContext({ baseURL: ADMIN_BASE_URL });
  const signIn = await context.request.post("/api/auth/sign-in/username", {
    data: { username: "hqmanager", password: "hq123" },
  });
  expect(signIn.ok(), `sign-in admin gagal: ${signIn.status()}`).toBe(true);
  janeId = await resolveSeededCustomer("jane@example.com");
  johnId = await resolveSeededCustomer("john@example.com");
});

test.afterAll(async () => {
  await context?.close();
});

/** Badge status pertama yang teksnya cocok (pill pasif). */
function badge(page: Page, text: string | RegExp) {
  return page.locator("[data-status-tone]").filter({ hasText: text }).first();
}

// ---------------------------------------------------------------------------
// AC03/AC04 — daftar order: payment, tahap delivery, dan stock review terpisah
// ---------------------------------------------------------------------------

const ORDER_ROW = (overrides: Record<string, unknown>) => ({
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  createdAt: "2026-11-01T02:00:00Z",
  status: "processing",
  paymentStatus: "paid",
  total: "150000",
  fulfillmentMethod: "delivery",
  customer: { name: "Nadia Pertiwi" },
  branch: { name: "Cabang Jakarta Pusat" },
  ...overrides,
});

const DELIVERY_ROWS = [
  ORDER_ROW({
    id: "row-ready",
    stage: {
      label: "Barang siap",
      guidance: "Barang siap. Pesan pengiriman.",
      terminal: false,
    },
  }),
  ORDER_ROW({
    id: "row-booking",
    stage: {
      label: "Booking belum pasti",
      guidance: "Konfirmasi ke Jubelio.",
      terminal: false,
    },
  }),
  ORDER_ROW({
    id: "row-manual",
    status: "completed",
    stage: {
      label: "Selesai manual",
      guidance: "Order ditutup manual.",
      terminal: true,
    },
  }),
  ORDER_ROW({
    id: "row-pending-payment",
    status: "pending_payment",
    paymentStatus: "pending",
    stage: {
      label: "Menunggu pembayaran",
      guidance: "Tunggu pembayaran.",
      terminal: false,
    },
    stockNeedsReview: true,
  }),
  ORDER_ROW({
    id: "row-unknown-stage",
    stage: {
      label: "Tahap masa depan",
      guidance: "Belum tersedia.",
      terminal: false,
    },
  }),
];

test("daftar order admin memisahkan payment, tahap delivery, dan review stok", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/orders?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: DELIVERY_ROWS,
          pagination: {
            page: 1,
            limit: 20,
            total: DELIVERY_ROWS.length,
            baseTotal: DELIVERY_ROWS.length,
            totalPages: 1,
          },
        },
      })
    );
    await page.goto("/admin/orders");

    // Dua dimensi berbeda terlihat sekaligus pada daftar yang sama.
    await expectStatusTone(badge(page, "Barang siap"), "ready");
    await expectStatusTone(badge(page, "Booking belum pasti"), "progress");
    await expectStatusTone(badge(page, "Selesai manual"), "neutral");
    await expectStatusTone(badge(page, "Menunggu pembayaran"), "waiting");
    await expectStatusTone(badge(page, "Stock review"), "progress");

    // Payment memakai domainnya sendiri, bukan tone tahap delivery.
    await expectStatusTone(
      page.locator("[data-status-tone]").filter({ hasText: /^paid$/ }).first(),
      "success"
    );
    await expectStatusTone(
      page.locator("[data-status-tone]").filter({ hasText: /^pending$/ }).first(),
      "waiting"
    );

    // Tahap asing tetap netral, bukan klaim sukses.
    await expectStatusTone(badge(page, "Tahap masa depan"), "neutral");
  } finally {
    await page.close();
  }
});

test("tab pickup memakai mapping order yang sama dengan store dan aman di mobile", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/admin/orders?*", (route) => {
      const url = new URL(route.request().url());
      const rows =
        url.searchParams.get("fulfillment") === "pickup"
          ? [
              ORDER_ROW({
                id: "pickup-ready",
                status: "ready_for_pickup",
                paymentStatus: "paid",
                fulfillmentMethod: "pickup",
              }),
              ORDER_ROW({
                id: "pickup-failed",
                status: "failed_payment",
                paymentStatus: "failed",
                fulfillmentMethod: "pickup",
              }),
              ORDER_ROW({
                id: "pickup-cancel",
                status: "cancelled",
                paymentStatus: "pending",
                fulfillmentMethod: "pickup",
              }),
            ]
          : DELIVERY_ROWS;
      void route.fulfill({
        json: {
          success: true,
          data: rows,
          pagination: {
            page: 1,
            limit: 20,
            total: rows.length,
            baseTotal: rows.length,
            totalPages: 1,
          },
        },
      });
    });
    await page.goto("/admin/orders?tab=pickup");

    await expectStatusTone(badge(page, "Ready for Pickup"), "ready");
    await expectStatusTone(badge(page, "Payment Failed"), "error");
    await expectStatusTone(badge(page, "Cancelled"), "cancelled");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(
      overflow,
      "halaman tidak boleh overflow horizontal"
    ).toBeLessThanOrEqual(0);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// AC03 — notifikasi memakai vocabulary yang sama
// ---------------------------------------------------------------------------

test("notifikasi admin memakai tone order yang sama dengan daftar dan detail", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const statuses = [
      { status: "pending_payment", label: "Pending Payment", tone: "waiting" },
      { status: "processing", label: "Processing", tone: "progress" },
      { status: "ready_for_pickup", label: "Ready for Pickup", tone: "ready" },
      { status: "completed", label: "Completed", tone: "success" },
      { status: "cancelled", label: "Cancelled", tone: "cancelled" },
      { status: "failed_payment", label: "Payment Failed", tone: "error" },
    ] as const;

    await page.route("**/api/admin/notifications?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: statuses.map((entry, index) => ({
            id: `notif-${index}`,
            type: "order_status",
            title: `Order ${entry.label}`,
            message: `Pesanan berstatus ${entry.label}`,
            isRead: false,
            createdAt: `2026-11-0${index + 1}T02:00:00Z`,
            orderId: `order-${index}`,
            order: {
              id: `order-${index}`,
              status: entry.status,
              customerName: "Nadia Pertiwi",
              total: "150000",
              fulfillmentMethod: "delivery",
            },
          })),
          pagination: {
            page: 1,
            limit: 20,
            total: statuses.length,
            totalPages: 1,
          },
        },
      })
    );
    await page.goto("/admin/notifications");

    for (const entry of statuses) {
      await expectStatusTone(
        page
          .locator("[data-status-tone]")
          .filter({ hasText: new RegExp(`^${entry.label}$`) })
          .first(),
        entry.tone
      );
    }
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// AC07 — onboarding vs email verification terpisah
// ---------------------------------------------------------------------------

test("daftar customer memakai onboarding, bukan email verification", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const customer = (
      id: string,
      name: string,
      onboardingCompleted: boolean
    ) => ({
      id,
      name,
      email: `${id}@example.test`,
      phone: null,
      birthDate: null,
      gender: null,
      onboardingCompleted,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      orderCount: 0,
    });
    await page.route("**/api/admin/customers?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            customer("cust-completed", "Customer Selesai", true),
            customer("cust-pending", "Customer Tertunda", false),
          ],
          pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
        },
      })
    );
    await page.goto("/admin/customers");

    await expectStatusTone(badge(page, "Selesai"), "success");
    await expectStatusTone(badge(page, "Belum selesai"), "waiting");

    // Ikon ringkasan memakai token yang sama untuk dua status onboarding.
    await expectStatusTone(
      page
        .locator('div[data-status-tone="success"]')
        .filter({ has: page.locator("svg") })
        .first(),
      "success"
    );
    await expectStatusTone(
      page
        .locator('div[data-status-tone="waiting"]')
        .filter({ has: page.locator("svg") })
        .first(),
      "waiting"
    );
    // Kategori (Registered customers / Total orders) tidak menjadi status.
    const registered = page.getByText("Registered customers", { exact: true });
    await expect(registered).toBeVisible();
    await expect(registered).not.toHaveAttribute("data-status-tone", /.+/);
  } finally {
    await page.close();
  }
});

test("detail customer memisahkan onboarding dari email verification", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/admin/customers/${janeId}`);

    // Onboarding pending …
    await expectStatusTone(badge(page, "Onboarding pending"), "waiting");
    // … sementara email sudah verified: dua dimensi tidak saling diturunkan.
    await expectStatusTone(badge(page, "Verified"), "success");
    await expect(page.getByText("Email verified", { exact: true })).toBeVisible();
  } finally {
    await page.close();
  }
});

test("detail customer dengan onboarding selesai memakai tone success", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/admin/customers/${johnId}`);
    await expectStatusTone(badge(page, "Onboarding completed"), "success");
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// AC07 — master data: produk, cabang, admin user, role
// ---------------------------------------------------------------------------

test("daftar produk membedakan aktif, habis, dan arsip", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/products?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: ["aktif", "habis", "arsip"].map((status, index) => ({
            id: `product-${status}`,
            name: `Produk ${status}`,
            slug: `produk-${status}`,
            basePrice: "100000",
            status,
            variants: [],
            variantCount: 1,
            totalStock: index,
            totalReserved: 0,
            totalAvailable: index,
            categories: [],
            images: [],
          })),
          pagination: { page: 1, limit: 10, total: 3, totalPages: 1 },
        },
      })
    );
    await page.goto("/admin/products");

    await expectStatusTone(badge(page, "aktif"), "success");
    await expectStatusTone(badge(page, "habis"), "progress");
    await expectStatusTone(badge(page, "arsip"), "neutral");
  } finally {
    await page.close();
  }
});

test("daftar cabang membedakan aktif dan nonaktif tanpa menganggap nonaktif sebagai error", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/branches?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: "branch-1",
              name: "Cabang Jakarta Pusat",
              code: "JKT",
              city: "Jakarta",
              address: "Jl. A",
              status: "aktif",
            },
            {
              id: "branch-2",
              name: "Cabang Bandung Dago",
              code: "BDG",
              city: "Bandung",
              address: "Jl. B",
              status: "nonaktif",
            },
          ],
          pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
        },
      })
    );
    await page.goto("/admin/branches");

    await expectStatusTone(badge(page, "aktif"), "success");
    await expectStatusTone(badge(page, "nonaktif"), "neutral");
  } finally {
    await page.close();
  }
});

test("daftar admin user: aktif success dan reset password warning, role tetap kategori", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/roles?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: "role-1",
              key: "admin",
              name: "Admin",
              description: null,
              isSystem: true,
              archived: false,
              archivedAt: null,
              version: 1,
              userCount: 1,
              activeUserCount: 1,
              grants: [],
            },
          ],
        },
      })
    );
    await page.route("**/api/admin/users?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: "user-1",
              name: "Admin Satu",
              username: "admin1",
              email: "admin1@example.test",
              role: {
                id: "role-1",
                key: "admin",
                name: "Admin",
                isSystem: true,
              },
              branch: null,
              isActive: true,
              mustResetPassword: true,
              emailVerified: true,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
          pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
        },
      })
    );
    await page.goto("/admin/users");

    await expectStatusTone(badge(page, "Reset diperlukan"), "progress");
    await expectStatusTone(badge(page, "Aktif"), "success");
    // Role adalah kategori/otorisasi, bukan status lifecycle.
    const roleBadge = page.getByText("Admin", { exact: true }).first();
    await expect(roleBadge).not.toHaveAttribute("data-status-tone", /.+/);
  } finally {
    await page.close();
  }
});

test("role arsip netral dengan ikon arsip dan tipe role tetap kategori", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/roles?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: "role-system",
              key: "system_owner",
              name: "System Owner",
              description: null,
              isSystem: true,
              archived: false,
              archivedAt: null,
              version: 3,
              userCount: 1,
              activeUserCount: 1,
              grants: [],
            },
            {
              id: "role-archived",
              key: null,
              name: "Role Lama",
              description: "Sudah tidak dipakai",
              isSystem: false,
              archived: true,
              archivedAt: "2026-01-01T00:00:00Z",
              version: 1,
              userCount: 0,
              activeUserCount: 0,
              grants: [],
            },
          ],
        },
      })
    );
    await page.goto("/admin/roles");

    await expectStatusTone(badge(page, "Arsip"), "neutral");
    const category = page.getByText("Sistem · Owner", { exact: true });
    await expect(category).toBeVisible();
    await expect(category).not.toHaveAttribute("data-status-tone", /.+/);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// AC08 — lifecycle Offer
// ---------------------------------------------------------------------------

test("daftar diskon memakai seluruh lifecycle offer; Ada draft tetap kategori netral", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const states = [
      { state: "draft", label: "Draft", tone: "neutral" },
      { state: "enabled", label: "Aktif", tone: "success" },
      { state: "paused", label: "Dijeda", tone: "progress" },
      { state: "archived", label: "Diarsipkan", tone: "neutral" },
    ] as const;
    await page.route("**/api/admin/discounts?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: states.map((entry, index) => ({
            id: `offer-${entry.state}`,
            key: `offer_${entry.state}`,
            activationKind: "public",
            state: entry.state,
            version: 1,
            draftVersion: 1,
            policyVersion: 1,
            perClientLimit: 1,
            quotaCount: null,
            budgetAmount: null,
            updatedAt: "2026-11-01T00:00:00Z",
            displayName: `Promo ${entry.label}`,
            draftSummary: null,
            capacitySummary: null,
            liveRevision:
              entry.state === "draft"
                ? null
                : {
                    id: `rev-${index}`,
                    revisionNo: 1,
                    kind: "fixed",
                    fixedAmount: "10000",
                    rate: null,
                    capAmount: null,
                  },
            draftRevisionId: entry.state === "enabled" ? "draft-1" : null,
          })),
          pagination: { page: 1, limit: 10, total: states.length, totalPages: 1 },
        },
      })
    );
    await page.goto("/admin/discounts");

    for (const entry of states) {
      await expectStatusTone(
        badge(page, new RegExp(`^${entry.label}$`)),
        entry.tone
      );
    }
    // "Ada draft" tetap indikator kategori: draft tidak diklaim published.
    const draftIndicator = page.getByText("Ada draft", { exact: true }).first();
    await expect(draftIndicator).toBeVisible();
    await expect(draftIndicator).not.toHaveAttribute("data-status-tone", /.+/);
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// AC10 — CMS page, homepage preview, analytics
// ---------------------------------------------------------------------------

test("halaman CMS membedakan Dipublikasi dan Draft", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/pages", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: "page-1",
              slug: "about",
              title: "Tentang Kami",
              isPublished: true,
              displayOrder: 1,
              updatedAt: "2026-11-01T00:00:00Z",
            },
            {
              id: "page-2",
              slug: "faq",
              title: "FAQ",
              isPublished: false,
              displayOrder: 2,
              updatedAt: "2026-11-01T00:00:00Z",
            },
          ],
        },
      })
    );
    await page.goto("/admin/pages");

    await expectStatusTone(badge(page, "Dipublikasi"), "success");
    await expectStatusTone(badge(page, "Draft"), "neutral");
  } finally {
    await page.close();
  }
});

test("preview homepage: konten nonaktif netral dan BranchCard shared memakai tone success", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/homepage/preview-all", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: "section-inactive",
              type: "announcement_bar",
              title: "Promo akhir tahun",
              subtitle: null,
              content: { text: "Promo akhir tahun", linkUrl: null },
              displayOrder: 1,
              isActive: false,
            },
            {
              id: "section-banner",
              type: "store_banner",
              title: "Kunjungi cabang",
              subtitle: null,
              content: {},
              displayOrder: 2,
              isActive: true,
              branches: [
                {
                  id: "branch-1",
                  name: "Cabang Jakarta Pusat",
                  code: "JKT",
                  city: "Jakarta",
                  address: "Jl. Merdeka No. 1",
                  phone: null,
                  operatingHours: {},
                  latitude: null,
                  longitude: null,
                  googleMapsUrl: null,
                },
              ],
            },
          ],
        },
      })
    );
    await page.goto("/admin/homepage/preview");

    // Konten nonaktif bukan error; badge netral.
    await page.getByRole("button", { name: "Tampilkan Semua" }).click();
    await expectStatusTone(badge(page, "Nonaktif"), "neutral");

    // BranchCard shared: label Buka memakai tone success.
    await expectStatusTone(badge(page, "Buka"), "success");
  } finally {
    await page.close();
  }
});

test("analytics memakai badge status yang sama dengan daftar order", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/analytics", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            totalRevenue: 1000000,
            monthlyRevenue: 250000,
            totalOrders: 8,
            weeklyOrders: 3,
            totalCustomers: 5,
            averageOrderValue: 125000,
            ordersByStatus: [
              { status: "pending_payment", count: 1 },
              { status: "ready_for_pickup", count: 2 },
              { status: "completed", count: 3 },
              { status: "failed_payment", count: 1 },
              { status: "awaiting_future_status", count: 1 },
            ],
            recentOrders: [
              {
                id: "order-1",
                total: "150000",
                status: "processing",
                createdAt: "2026-11-01T02:00:00Z",
                customer: "Nadia",
              },
              {
                id: "order-2",
                total: "150000",
                status: "cancelled",
                createdAt: "2026-11-02T02:00:00Z",
                customer: "Budi",
              },
            ],
            trend: [{ date: "2026-11-01", revenue: 150000, orders: 1 }],
          },
        },
      })
    );
    await page.goto("/admin/analytics");

    await expectStatusTone(badge(page, "Menunggu Pembayaran"), "waiting");
    await expectStatusTone(badge(page, "Siap Diambil"), "ready");
    await expectStatusTone(badge(page, "Selesai"), "success");
    await expectStatusTone(badge(page, "Pembayaran Gagal"), "error");
    await expectStatusTone(badge(page, "Dibatalkan"), "cancelled");
    // Status asing pada breakdown tetap netral, bukan success.
    await expectStatusTone(badge(page, "awaiting_future_status"), "neutral");
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// AC09 — markdown harga dan agregat import/bulk
// ---------------------------------------------------------------------------

test("markdown harga memakai empat tone kondisi existing", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const candidate = (
      variantId: string,
      sku: string,
      overrides: Record<string, unknown>
    ) => ({
      variantId,
      sku,
      productId: `product-${variantId}`,
      productName: `Produk ${sku}`,
      variantLabel: null,
      basePrice: "100000",
      effectiveUnitPrice: "100000",
      storedTarget: null,
      markdownActive: false,
      priceVersion: 1,
      ...overrides,
    });
    await page.route("**/api/admin/price-changes/candidates?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            rows: [
              candidate("v-invalid", "SKU-INVALID", {
                basePrice: null,
                effectiveUnitPrice: null,
              }),
              candidate("v-active", "SKU-ACTIVE", {
                effectiveUnitPrice: "90000",
                storedTarget: "90000",
                markdownActive: true,
              }),
              candidate("v-target", "SKU-TARGET", { storedTarget: "90000" }),
              candidate("v-absent", "SKU-ABSENT", {}),
            ],
            pagination: { page: 1, limit: 25, total: 4, totalPages: 1 },
          },
        },
      })
    );
    await page.route("**/api/admin/price-changes?*", (route) =>
      route.fulfill({ json: { success: true, data: [] } })
    );
    await page.goto("/admin/products/harga");

    await expectStatusTone(badge(page, "Source tidak valid"), "error");
    await expectStatusTone(badge(page, "Aktif"), "success");
    await expectStatusTone(badge(page, "Target nonaktif"), "progress");
    await expectStatusTone(badge(page, "Tanpa markdown"), "neutral");
  } finally {
    await page.close();
  }
});

const BATCH_ROW = (overrides: Record<string, unknown>) => ({
  id: `row-${String(overrides.rowNumber ?? 1)}`,
  rowNumber: 1,
  inputSku: "SKU-1",
  variantId: "v-1",
  action: "set_price",
  targetUnitPrice: "90000",
  state: "pending",
  resultCode: null,
  preview: {
    inputSku: "SKU-1",
    action: "set_price",
    variantLabel: null,
    storedTargetBefore: null,
    effectiveUnitPriceBefore: "100000",
    effectiveUnitPriceAfter: "90000",
    markdownActiveBefore: false,
    delta: "-10000",
    direction: "decrease",
    percent: "-10",
    warnings: [],
  },
  actual: {
    sourceUnitPrice: "100000",
    previousTargetUnitPrice: null,
    previousEffectiveUnitPrice: "100000",
    targetUnitPrice: "90000",
    effectiveUnitPrice: "90000",
    markdownActive: true,
  },
  appliedRevisionId: null,
  ...overrides,
});

const BATCH_BASE = {
  id: "batch-1",
  source: "xlsx",
  templateVersion: "1",
  parentBatchId: null,
  state: "staged",
  rowCount: 3,
  appliedCount: 1,
  unchangedCount: 1,
  failedCount: 1,
  pendingCount: 0,
  haltReason: null,
  // receiveImportBatch membaca `rows` sebelum DTO baris dimuat terpisah.
  rows: [] as Record<string, unknown>[],
};

test("import harga: baris dan agregat memakai tone sesuai hasil, bukan statusMessage", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });

    let rows: Record<string, unknown>[] = [
      BATCH_ROW({ rowNumber: 1, state: "applied", appliedRevisionId: "rev-1" }),
      BATCH_ROW({ rowNumber: 2, state: "unchanged" }),
      BATCH_ROW({
        rowNumber: 3,
        state: "failed",
        resultCode: "VARIANT_NOT_FOUND",
      }),
    ];

    await page.route("**/api/admin/price-changes?*", (route) =>
      route.fulfill({ json: { success: true, data: [] } })
    );
    // Batch berikutnya menggantikan agregat & baris yang sedang direview.
    let currentBatch: Record<string, unknown> = { ...BATCH_BASE, rows };
    await page.route("**/api/admin/price-changes", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fulfill({ json: { success: true, data: [] } });
        return;
      }
      await route.fulfill({ json: { success: true, data: currentBatch } });
    });
    await page.route("**/api/admin/price-changes/batch-1?*", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            ...currentBatch,
            rows,
            pagination: {
              page: 1,
              limit: 100,
              total: rows.length,
              totalPages: 1,
            },
          },
        },
      })
    );

    await page.goto("/admin/products/harga");
    await page.getByRole("tab", { name: /Import & batch/ }).click();

    await page.locator("#excel-file").setInputFiles({
      name: "harga.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("fixture"),
    });
    await page.getByTestId("excel-upload").click();

    await expect(page.getByTestId("excel-batch-summary")).toBeVisible();
    await expectStatusTone(badge(page, "applied"), "success");
    await expectStatusTone(badge(page, "unchanged"), "neutral");
    await expectStatusTone(badge(page, "failed"), "error");

    // Agregat: sebagian gagal tanpa pending → progress (statusMessage lama
    // memberi error untuk kondisi ini).
    await expectStatusTone(page.getByTestId("excel-batch-summary"), "progress");

    // Seluruh baris gagal → error.
    rows = [
      BATCH_ROW({ rowNumber: 1, state: "failed", resultCode: "VARIANT_NOT_FOUND" }),
      BATCH_ROW({ rowNumber: 2, state: "failed", resultCode: "VARIANT_NOT_FOUND" }),
    ];
    currentBatch = {
      ...BATCH_BASE,
      rowCount: 2,
      appliedCount: 0,
      unchangedCount: 0,
      failedCount: 2,
      rows,
    };
    await page.locator("#excel-file").setInputFiles({
      name: "harga-2.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("fixture-2"),
    });
    await page.getByTestId("excel-upload").click();
    await expectStatusTone(page.getByTestId("excel-batch-summary"), "error");
  } finally {
    await page.close();
  }
});

// ---------------------------------------------------------------------------
// AC11/AC12 — palet dark dan hover pasif pada surface admin
// ---------------------------------------------------------------------------

test("badge status admin memakai palet dark dan tetap stabil saat hover", async () => {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route("**/api/admin/pages", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: "page-1",
              slug: "about",
              title: "Tentang Kami",
              isPublished: true,
              displayOrder: 1,
              updatedAt: "2026-11-01T00:00:00Z",
            },
          ],
        },
      })
    );
    await page.goto("/admin/pages");

    const published = badge(page, "Dipublikasi");
    await expectStatusTone(published, "success");
    await expectStableOnHover(published);

    await setStatusTheme(page, "dark");
    await expectStatusTone(published, "success", "dark");
    await setStatusTheme(page, "light");
    await expectStatusTone(published, "success", "light");
  } finally {
    await page.close();
  }
});
