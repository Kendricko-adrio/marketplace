/**
 * Halaman detail pesanan customer — spec presentasi mock-only.
 *
 * Fixture deterministik lewat route interception GET `/api/orders/[id]`: tidak
 * ada mutasi DB, provider call, atau perubahan order. Sesi memakai seam HTTP
 * sign-in yang sudah ada (Better Auth route handler pada origin mock), karena
 * layout `/account` memvalidasi sesi sungguhan di server.
 *
 * Cakupan (plan `.scratch/orders-presentation/plan/customer-order-detail-redesign.md`):
 * - AC-01 status/tindakan terbaca, stepper generik hilang
 * - AC-02 urutan mobile vs desktop + tidak ada overflow pada ID/resi panjang
 * - AC-03 timeline terbaru dahulu, empat event, disclosure keyboard
 * - AC-04 label status customer, status asing aman, detail simulator disembunyikan
 * - AC-05 tautan tracking/bukti terlihat sebagai link dan membuka tab baru
 * - AC-06 feedback salin sukses dan gagal
 * - AC-07 pembayaran satu kelompok dengan nominal dan aksi existing
 * - AC-08 barang terbaca, beli lagi, pickup tanpa tracking delivery
 * - AC-09 loading/error/retry/not-found/snapshot kosong/tanpa resi
 *
 * Jalankan lewat konfigurasi mock terisolasi:
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { expect, test, type Page } from "@playwright/test";
import { TEST_USERS } from "../config";

const ORDER_ID = "order-detail-presentation-1";
const LONG_ORDER_ID = "ORD-2026-11-0001-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const AWB = "E2EDETAILAWB0000000000000000000001";
const TRACKING_URL = "https://track.example.test/E2EDETAILAWB0001";
const POD_URL = "https://pod.example.test/proof-of-delivery-1";
const PRODUCT_SLUG = "serum-pelembab";

const MOCK_PORTS = new Set(["3110", "3111", "3112"]);
const STORE_BASE_URL =
  process.env.E2E_MOCK_STORE_BASE_URL ?? "http://localhost:3110";
const MOCK_BASE_URL =
  process.env.E2E_MOCK_API_BASE_URL ?? "http://127.0.0.1:3112";

/** Fail closed kecuali berjalan pada konfigurasi mock terisolasi. */
function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "order-detail-presentation-mock.spec.ts harus dijalankan lewat playwright.mock.config.ts"
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
// Fixture independen: nilai uang/tanggal/status ditulis literal dari plan
// ---------------------------------------------------------------------------

const TIMELINE = [
  { status: "WAITING", detail: "Menunggu penjemputan kurir", at: "2026-11-01T03:00:00Z" },
  { status: "CONFIRMED_BY_COURIER", detail: null, at: "2026-11-01T04:10:00Z" },
  { status: "PICKED_UP", detail: "Paket diambil kurir uji", at: "2026-11-01T06:05:00Z" },
  { status: "ON_DELIVERY", detail: "Simulasi webhook Jubelio: ON_DELIVERY", at: "2026-11-01T08:15:00Z" },
  { status: "ON_HOLD", detail: "Alamat sedang dikonfirmasi ulang", at: "2026-11-01T09:40:00Z" },
  { status: "DELIVERED", detail: "Diterima oleh penerima", at: "2026-11-02T07:20:00Z" },
];

const DELIVERY_SNAPSHOT = {
  address: {
    recipientName: "Nadia Pertiwi",
    phone: "081234567890",
    fullAddress:
      "Jl. Merdeka Raya No. 128, Kelurahan Sukamaju, Kecamatan Cilodong, Depok, Jawa Barat",
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

const PRODUCT_NAME = "Serum Pelembab Wajah dengan Vitamin B5 30ml";

const ITEMS = [
  {
    id: "item-e2e-1",
    orderId: LONG_ORDER_ID,
    variantId: "variant-e2e-1",
    productName: PRODUCT_NAME,
    variantInfo: "Ukuran: 30 ml",
    price: "185000",
    quantity: 1,
    createdAt: "2026-11-01T02:00:00Z",
    productId: "product-e2e-1",
    imageUrl: null,
    slug: PRODUCT_SLUG,
  },
];

const SHIPMENT = {
  awb: AWB,
  trackingUrl: TRACKING_URL,
  latestStatus: "DELIVERED",
  delivered: true,
  deliveredAt: "2026-11-02T07:20:00Z",
  podUrl: POD_URL,
  timeline: TIMELINE,
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: LONG_ORDER_ID,
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
    shipment: SHIPMENT,
    branch: null,
    items: ITEMS,
    ...overrides,
  };
}

type Reply = { status: number; body: unknown };

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });
const notFound: Reply = {
  status: 404,
  body: { success: false, error: "Order not found" },
};
const serverError: Reply = {
  status: 500,
  body: { success: false, error: "Failed to fetch order" },
};

async function signIn(page: Page) {
  const res = await page.request.post("/api/auth/sign-in/email", {
    data: TEST_USERS.store,
  });
  expect(res.ok(), `sign-in gagal: ${res.status()} ${await res.text()}`).toBe(
    true
  );
}

/** Stub clipboard: sukses merekam nilai, atau selalu menolak. */
async function stubClipboard(page: Page, mode: "success" | "reject" = "success") {
  await page.addInitScript((fail: boolean) => {
    (window as unknown as { __copied?: string[] }).__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          if (fail) throw new Error("clipboard denied");
          (window as unknown as { __copied: string[] }).__copied.push(value);
        },
      },
    });
  }, mode === "reject");
}

async function openOrder(
  page: Page,
  reply: Reply | (() => Reply),
  orderId = ORDER_ID
) {
  // Fungsi reply dipakai agar state bisa diubah antar aksi (mis. retry) tanpa
  // bergantung pada jumlah request — dev mode React menjalankan effect dua kali.
  const resolve = typeof reply === "function" ? reply : () => reply;
  await page.route("**/api/orders/**", async (route) => {
    const next = resolve();
    await route.fulfill({ status: next.status, json: next.body });
  });
  await page.goto(`/account/orders/${orderId}`);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow, "halaman tidak boleh overflow horizontally").toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page }) => {
  requireIsolatedMockRun();
  await stubClipboard(page);
  await signIn(page);
});

test("status leads the page, splits address from tracking, and hides the generic stepper", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(page, ok(order()));

  await expect(page.getByLabel("Status pesanan")).toHaveText("Pesanan diproses");
  await expect(page.getByText("Pembaruan pengiriman:")).toContainText(
    "2 Nov 2026"
  );

  // Stepper generik lama tidak boleh muncul lagi.
  await expect(page.getByText("Order Placed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ready for Pickup", { exact: true })).toHaveCount(0);

  const address = page.getByRole("region", { name: "Alamat pengiriman" });
  const tracking = page.getByRole("region", { name: "Lacak paket" });
  await expect(address).toBeVisible();
  await expect(tracking).toBeVisible();

  const addressBox = await address.boundingBox();
  const trackingBox = await tracking.boundingBox();
  expect(addressBox && trackingBox).toBeTruthy();
  expect(addressBox!.x).toBeLessThan(trackingBox!.x);

  // Status order, status paket, dan status pembayaran tidak saling tertukar.
  await expect(tracking).toContainText("Paket telah diterima");
  await expect(address).toContainText("Nadia Pertiwi");
  await expect(page.getByText("Lunas", { exact: true })).toBeVisible();
});

test("the newest four events come first and the disclosure reveals the full history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(page, ok(order()));

  const tracking = page.getByRole("region", { name: "Lacak paket" });
  const events = tracking.getByRole("listitem");

  await expect(events).toHaveCount(4);
  await expect(events.nth(0)).toContainText("Paket telah diterima");
  await expect(events.nth(1)).toContainText("Pengiriman tertunda");
  await expect(events.nth(2)).toContainText("Dalam pengantaran");
  await expect(events.nth(3)).toContainText("Paket diambil kurir");
  // Event terlama dan detail simulator tidak tampil sebelum dibuka.
  await expect(tracking.getByText("Menunggu kurir", { exact: true })).toHaveCount(0);
  await expect(tracking.getByText(/Simulasi webhook Jubelio/i)).toHaveCount(0);
  // Detail kurir yang informatif tetap ditampilkan.
  await expect(
    tracking.getByText("Alamat sedang dikonfirmasi ulang", { exact: true })
  ).toBeVisible();

  const toggle = tracking.getByRole("button", { name: "Lihat semua riwayat" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");

  const collapse = tracking.getByRole("button", {
    name: "Tampilkan lebih sedikit",
  });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(events).toHaveCount(6);
  await expect(events.nth(4)).toContainText("Kurir dikonfirmasi");
  await expect(events.nth(5)).toContainText("Menunggu kurir");

  await collapse.click();
  await expect(events).toHaveCount(4);
});

test("unknown provider codes never leak as headings while the package status stays honest", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(
    page,
    ok(
      order({
        shipment: {
          ...SHIPMENT,
          latestStatus: null,
          delivered: false,
          deliveredAt: null,
          podUrl: null,
          timeline: [
            { status: "SOME_FUTURE_CODE", detail: null, at: "2026-11-03T01:00:00Z" },
          ],
        },
      })
    )
  );

  const tracking = page.getByRole("region", { name: "Lacak paket" });
  await expect(
    tracking.getByText("Pembaruan pengiriman", { exact: true }).first()
  ).toBeVisible();
  await expect(tracking.getByText("SOME_FUTURE_CODE")).toHaveCount(0);
  await expect(tracking.getByText("Waktu tidak tersedia")).toHaveCount(0);
});

test("mobile stacks tracking before address without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openOrder(page, ok(order()));

  const address = page.getByRole("region", { name: "Alamat pengiriman" });
  const tracking = page.getByRole("region", { name: "Lacak paket" });
  const addressBox = await address.boundingBox();
  const trackingBox = await tracking.boundingBox();
  expect(trackingBox!.y).toBeLessThan(addressBox!.y);

  await expect(page.getByText(AWB, { exact: true })).toBeVisible();
  await expect(
    page.getByText(LONG_ORDER_ID, { exact: true })
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(200);
  await expectNoHorizontalOverflow(page);

  // Nama barang membungkus, tidak dipotong satu baris.
  const name = page.getByText(PRODUCT_NAME, { exact: true });
  await expect(name).toBeVisible();
  expect(
    await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  ).toBe(true);
});

test("tracking and proof links are recognisable links opening a new tab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(page, ok(order()));

  const tracking = page.getByRole("region", { name: "Lacak paket" });
  const trackLink = tracking.getByRole("link", {
    name: /Lacak di situs kurir/,
  });
  await expect(trackLink).toHaveAttribute("href", TRACKING_URL);
  await expect(trackLink).toHaveAttribute("target", "_blank");
  await expect(trackLink).toHaveAttribute("rel", "noreferrer");

  const podLink = tracking.getByRole("link", { name: /Lihat bukti pengiriman/ });
  await expect(podLink).toHaveAttribute("href", POD_URL);
  await expect(podLink).toHaveAttribute("target", "_blank");
});

test("a missing tracking URL offers the resi instead of a dead link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(
    page,
    ok(
      order({
        shipment: { ...SHIPMENT, trackingUrl: null, podUrl: null },
      })
    )
  );

  const tracking = page.getByRole("region", { name: "Lacak paket" });
  await expect(
    tracking.getByText(
      "Tautan pelacakan belum tersedia. Anda dapat menggunakan nomor resi di situs kurir.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    tracking.getByRole("link", { name: /Lacak di situs kurir/ })
  ).toHaveCount(0);
  await expect(tracking.getByRole("link", { name: /bukti pengiriman/ })).toHaveCount(0);
});

test("copy buttons report success, and a denied clipboard reports failure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(page, ok(order()));

  await page.getByRole("button", { name: "Salin ID" }).click();
  await expect(page.getByText("ID disalin", { exact: true })).toBeVisible();
  const tracking = page.getByRole("region", { name: "Lacak paket" });
  await tracking.getByRole("button", { name: "Salin resi" }).click();
  await expect(tracking.getByText("Resi disalin", { exact: true })).toBeVisible();

  const copied = await page.evaluate(
    () => (window as unknown as { __copied: string[] }).__copied
  );
  expect(copied).toEqual([LONG_ORDER_ID, AWB]);

  // Clipboard yang menolak tidak boleh menampilkan sukses palsu.
  const denied = await page.context().newPage();
  await stubClipboard(denied, "reject");
  await openOrder(denied, ok(order()));
  await denied.getByRole("button", { name: "Salin ID" }).click();
  await expect(
    denied.getByText("Gagal menyalin. Silakan salin secara manual.", {
      exact: true,
    })
  ).toBeVisible();
  await denied.close();
});

test("payment stays one group with unchanged totals and the existing pay action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(
    page,
    ok(
      order({
        status: "pending_payment",
        paymentStatus: "pending",
        fulfillmentMethod: "pickup",
        deliverySnapshot: null,
        shipment: null,
        snapRedirectUrl: "https://snap.example.test/pay-1",
      })
    )
  );

  await expect(page.getByLabel("Status pesanan")).toHaveText(
    "Menunggu pembayaran"
  );
  await expect(page.getByRole("button", { name: "Bayar sekarang" })).toBeVisible();
  await expect(page.getByText("Rp 314.130", { exact: true })).toBeVisible();
  await expect(page.getByText("Transfer Bank/VA", { exact: true })).toBeVisible();
  await expect(
    page.getByText("PPN (11%)", { exact: true })
  ).toBeVisible();

  // Beli lagi tetap menuju halaman produk, bukan menambah barang ke cart.
  await page.getByRole("button", { name: "Beli lagi" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/products/${PRODUCT_SLUG}`));
});

test("paid but blocked keeps the honest verification message", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(
    page,
    ok(
      order({
        status: "processing",
        paymentStatus: "paid",
        fulfillmentBlockedReason: "MANUAL_REVIEW",
      })
    )
  );

  await expect(
    page.getByText("Pembayaran diterima, pesanan menunggu verifikasi", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText(/Tidak perlu membayar ulang/)
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Bayar sekarang" })).toHaveCount(0);
});

test("payment recovery keeps its message and re-reads the same GET", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let recovered = false;
  const recoveryOrder = order({
    status: "pending_payment",
    paymentStatus: "pending",
    fulfillmentMethod: "pickup",
    deliverySnapshot: null,
    shipment: null,
    paymentRecovery: {
      state: "expired",
      message: "Batas pembayaran sudah lewat. Pesanan menunggu pemeriksaan.",
      paymentAvailable: false,
      canInitialize: false,
      redirectUrl: null,
      expiresAt: null,
    },
  });

  await openOrder(page, () =>
    recovered ? ok(order()) : ok(recoveryOrder)
  );

  await expect(
    page.getByText(
      "Batas pembayaran sudah lewat. Pesanan menunggu pemeriksaan.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bayar sekarang" })
  ).toHaveCount(0);

  // "Periksa status pembayaran" mengulang GET yang sama (tanpa mutasi).
  recovered = true;
  await page
    .getByRole("button", { name: "Periksa status pembayaran" })
    .click();
  await expect(
    page.getByRole("region", { name: "Lacak paket" })
  ).toBeVisible();
});

test("pickup keeps its own surface: no delivery tracking, gated code", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOrder(
    page,
    ok(
      order({
        status: "processing",
        fulfillmentMethod: "pickup",
        deliverySnapshot: null,
        shipment: null,
        pickupCode: "PKP-4821",
        branch: {
          id: "branch-e2e",
          name: "ADF Cabang Depok",
          address: "Jl. Margonda No. 1",
          city: "Depok",
          operatingHours: {},
        },
      })
    )
  );

  await expect(page.getByRole("region", { name: "Lacak paket" })).toHaveCount(0);
  await expect(page.getByText("Kode Pickup Anda")).toHaveCount(0);
  await expect(page.getByText("ADF Cabang Depok", { exact: true })).toBeVisible();

  await page.unroute("**/api/orders/**");
  await openOrder(
    page,
    ok(
      order({
        status: "ready_for_pickup",
        paymentStatus: "paid",
        fulfillmentMethod: "pickup",
        deliverySnapshot: null,
        shipment: null,
        pickupCode: "PKP-4821",
      })
    )
  );

  await expect(page.getByLabel("Status pesanan")).toHaveText("Siap diambil");
  await expect(page.getByText("Kode Pickup Anda")).toBeVisible();
  await expect(page.getByText("PKP-4821", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salin kode" }).click();
  await expect(page.getByText("Kode disalin", { exact: true })).toBeVisible();
});

test("error, not-found, retry, missing snapshot and missing resi follow the state matrix", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 404 → pesanan tidak ditemukan, tanpa membocorkan data owner lain.
  await openOrder(page, notFound);
  await expect(
    page.getByRole("heading", { name: "Pesanan tidak ditemukan" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Kembali ke riwayat pesanan/ })
  ).toBeVisible();
  await page.unroute("**/api/orders/**");

  // Gagal mengambil data → pesan + "Coba lagi" yang benar-benar mengulang GET.
  let failing = true;
  await openOrder(page, () => (failing ? serverError : ok(order())));
  await expect(
    page.getByText("Detail pesanan belum dapat dimuat. Silakan coba lagi.", {
      exact: true,
    })
  ).toBeVisible();
  failing = false;
  await page.getByRole("button", { name: "Coba lagi" }).click();
  await expect(page.getByRole("heading", { name: "Detail Pesanan" })).toBeVisible();
  await page.unroute("**/api/orders/**");

  // Snapshot alamat hilang: tracking tetap tampil.
  await openOrder(page, ok(order({ deliverySnapshot: null })));
  await expect(
    page.getByText("Detail alamat pengiriman tidak tersedia.", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Lacak paket" })
  ).toContainText("Paket telah diterima");
  await page.unroute("**/api/orders/**");

  // Belum ada shipment: resi belum tersedia, bukan klaim paket sudah dikirim.
  await openOrder(page, ok(order({ shipment: null })));
  const tracking = page.getByRole("region", { name: "Lacak paket" });
  await expect(tracking.getByText("Resi belum tersedia")).toBeVisible();
  await expect(
    tracking.getByText(
      "Informasi pelacakan akan tampil setelah resi tersedia.",
      { exact: true }
    )
  ).toBeVisible();
  await page.unroute("**/api/orders/**");

  // Shipment booked tanpa event: resi/link tetap tampil, riwayat belum ada.
  await openOrder(
    page,
    ok(
      order({
        shipment: { ...SHIPMENT, timeline: [], latestStatus: "WAITING" },
      })
    )
  );
  const noEvents = page.getByRole("region", { name: "Lacak paket" });
  await expect(noEvents.getByText(AWB, { exact: true })).toBeVisible();
  await expect(
    noEvents.getByText("Riwayat pengiriman belum tersedia.", { exact: true })
  ).toBeVisible();
  await expect(
    noEvents.getByText("Menunggu kurir", { exact: true }).first()
  ).toBeVisible();
});
