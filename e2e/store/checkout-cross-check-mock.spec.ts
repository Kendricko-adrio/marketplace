/**
 * Cross-check checkout: pemeriksaan read-only, satu feedback submit, bantuan
 * mobile, kebijakan tab baru, target Close, dan kontras footer/header.
 *
 * Plan: `.scratch/checkout-simplification/plan/audit-findings-phase-2.md`
 * (W02, W05, W06, W07, W08, W09, W12; AC2-02, AC2-05, AC2-07, AC2-08, AC2-13,
 * AC2-14, AC2-15).
 *
 * Semua data halaman berasal dari route interception; sesi memakai seam HTTP
 * sign-in yang sudah ada. Tidak ada mutasi DB, provider call, atau order baru.
 *
 * Jalankan lewat konfigurasi mock terisolasi:
 *   npx playwright test --config=playwright.mock.config.ts
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TEST_USERS } from "../config";
import {
  contrastRatio,
  parseRgb,
  readSurfaceColor,
  readTextColor,
  type Rgb,
} from "../support/contrast";

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
      "checkout-cross-check-mock.spec.ts harus dijalankan lewat playwright.mock.config.ts"
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
// Fixture literal (nominal mengikuti plan §8), bukan hasil hitung komponen
// ---------------------------------------------------------------------------

const CART_ITEM_ID = "crosscheck-item-1";
const REQUEST_KEY = "11111111-2222-3333-4444-555555555555";
const BRANCH = {
  id: "crosscheck-branch-1",
  name: "ADF Cabang Kemang",
  code: "KMG",
  city: "Jakarta Selatan",
  address: "Jl. Kemang Selatan Raya No. 12",
  operatingHours: {
    monday: { open: "09:00", close: "21:00" },
    tuesday: { open: "09:00", close: "21:00" },
    wednesday: { open: "09:00", close: "21:00" },
    thursday: { open: "09:00", close: "21:00" },
    friday: { open: "09:00", close: "21:00" },
    saturday: { open: "09:00", close: "21:00" },
    sunday: null,
  },
  latitude: null,
  longitude: null,
  googleMapsUrl: null,
  status: "aktif",
};

function cartPayload(items = 1) {
  return {
    success: true,
    data: {
      id: "crosscheck-cart-1",
      itemCount: items,
      subtotal: 150_000 * items,
      ppnRatePercent: 11,
      pricingContractVersion: 1,
      items: Array.from({ length: items }, (_, index) => ({
        id: `${CART_ITEM_ID}-${index}`,
        quantity: 1,
        variantId: `crosscheck-variant-${index}`,
        branchId: BRANCH.id,
        variant: { id: `crosscheck-variant-${index}`, color: "Hitam", size: "M", price: "150000" },
        product: { id: `crosscheck-product-${index}`, name: `Produk Fixture ${index + 1}` },
        image: null,
        branch: { id: BRANCH.id, name: BRANCH.name, city: BRANCH.city },
      })),
    },
  };
}

function previewPayload() {
  return {
    success: true,
    data: {
      reviewToken: "crosscheck-review-token",
      expiresAt: "2045-01-01T00:00:00Z",
      contextFingerprint: "b".repeat(64),
      promo: { kind: "none" },
      pricing: {
        subtotal: "150000",
        discount: "0",
        taxableBase: "150000",
        shippingCost: "0",
        serviceFee: "0",
        ppnRatePercent: "11",
        ppnAmount: "16500",
        total: "166500",
      },
    },
  };
}

function nextOpenDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  while (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function signIn(page: Page) {
  const res = await page.request.post("/api/auth/sign-in/email", {
    data: TEST_USERS.store,
  });
  expect(res.ok(), `sign-in gagal: ${res.status()} ${await res.text()}`).toBe(true);
}

/**
 * Warna permukaan efektif: komposisi `backgroundColor` elemen dan parent-nya
 * sampai layer opak ditemukan. Dipakai untuk latar semi-transparan (footer).
 */
async function readCompositedBackground(locator: Locator): Promise<Rgb> {
  const rgb = await locator.evaluate((node) => {
    const parse = (css: string): number[] | null => {
      const match = /rgba?\(([^)]+)\)/.exec(css);
      if (!match) return null;
      const parts = match[1]
        .split(/[,\s/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const layers: number[][] = [];
    let current: Element | null = node;
    while (current) {
      const parsed = parse(getComputedStyle(current).backgroundColor);
      if (parsed) {
        layers.push(parsed);
        if (parsed[3] === 1) break;
      }
      current = current.parentElement;
    }
    let out = [255, 255, 255];
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const [r, g, b, a] = layers[index];
      out = [
        r * a + out[0] * (1 - a),
        g * a + out[1] * (1 - a),
        b * a + out[2] * (1 - a),
      ];
    }
    return out.map((value) => Math.round(value));
  });
  return parseRgb(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
}

async function currentUserId(page: Page): Promise<string> {
  const res = await page.request.get("/api/auth/get-session");
  const body = (await res.json()) as { user?: { id?: string } } | null;
  const id = body?.user?.id;
  expect(id, "sesi uji harus punya user id").toBeTruthy();
  return id as string;
}

async function mockCheckoutData(page: Page) {
  await page.route("**/api/cart", async (route) => {
    await route.fulfill({ json: cartPayload() });
  });
  await page.route("**/api/branches/*", async (route) => {
    await route.fulfill({ json: { success: true, data: BRANCH } });
  });
  await page.route("**/api/discounts/available", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: [],
          page: 1,
          pageSize: 10,
          totalItems: 0,
          totalPages: 1,
          selectedOffer: null,
          selectedOfferUnavailable: false,
        },
      },
    });
  });
  await page.route("**/api/checkout/validate-step-2", async (route) => {
    await route.fulfill({ json: { success: true, message: "ok" } });
  });
  await page.route("**/api/checkout/preview", async (route) => {
    await route.fulfill({ json: previewPayload() });
  });
  await page.addInitScript((ids) => {
    sessionStorage.setItem("checkoutSelectedItemIds", JSON.stringify(ids));
  }, [`${CART_ITEM_ID}-0`]);
}

/**
 * Alamat fixture untuk dropdown: satu normal, satu panjang, satu belum siap
 * wilayah. Nilai ditulis literal (bukan dihitung komponen).
 */
async function mockAddresses(page: Page) {
  const row = (
    id: string,
    name: string,
    full: string,
    regionReady = true
  ) => ({
    id,
    recipientName: name,
    phone: "081234567890",
    fullAddress: full,
    postalCode: "12730",
    provinceId: regionReady ? "9" : null,
    cityId: regionReady ? "78" : null,
    districtId: regionReady ? "1123" : null,
    areaId: regionReady ? "44321" : null,
    isDefault: id === "address-1",
  });
  await page.route("**/api/addresses", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: [
          row(
            "address-1",
            "Nadia Pertiwi",
            "Jl. Kemang Selatan Raya No. 12, Bangka, Mampang Prapatan, Jakarta Selatan"
          ),
          row(
            "address-2",
            "Muhammad Rizky Pratama Wijaya Kusuma",
            "Jl. Perumahan Bukit Hijau Blok C7 No. 25, Kelurahan Sukamaju Baru, Kecamatan Tapos, Kota Depok, Jawa Barat 16457"
          ),
          row("address-3", "Sari Wulandari", "Jl. Melati No. 3", false),
        ],
      },
    });
  });
}

const QUOTE_SERVICES = [
  {
    courierId: 1,
    serviceId: 1,
    name: "JNE REG",
    shippingCost: 18000,
    pricing: {
      subtotal: "150000",
      discount: "0",
      taxableBase: "168000",
      shippingCost: "18000",
      serviceFee: "0",
      ppnRatePercent: "11",
      ppnAmount: "18480",
      total: "186480",
    },
    originFingerprint: "fingerprint",
    validEta: { from: "2026-11-18T00:00:00Z", to: "2026-11-19T00:00:00Z" },
  },
  {
    courierId: 2,
    serviceId: 2,
    name: "SiCepat HALU",
    shippingCost: 24000,
    pricing: {
      subtotal: "150000",
      discount: "0",
      taxableBase: "174000",
      shippingCost: "24000",
      serviceFee: "0",
      ppnRatePercent: "11",
      ppnAmount: "19140",
      total: "193140",
    },
    originFingerprint: "fingerprint",
    validEta: null,
  },
];

async function openCheckoutReview(page: Page) {
  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "Cara Pengiriman", exact: true })
  ).toBeVisible();
  await page.locator("#pickupDate").fill(nextOpenDate());
  await page.getByRole("combobox", { name: /Waktu Pickup/ }).click();
  await page.getByRole("option", { name: "10:00", exact: true }).click();
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *").fill(TEST_USERS.store.email);
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pembayaran", exact: true })
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  requireIsolatedMockRun();
  await signIn(page);
});

// ---------------------------------------------------------------------------
// AC2-02/AC2-13 — pemeriksaan status read-only, hasil eksplisit, tanpa POST
// ---------------------------------------------------------------------------

test("lookup 404 tidak memanggil place-order dan mempertahankan request", async ({
  page,
}) => {
  const userId = await currentUserId(page);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/checkout")) {
      posts.push(new URL(request.url()).pathname);
    }
  });
  await page.route("**/api/cart", async (route) => {
    await route.fulfill({ json: { success: true, data: { id: "empty", itemCount: 0, subtotal: 0, ppnRatePercent: 11, pricingContractVersion: 1, items: [] } } });
  });
  await page.route("**/api/checkout/requests/*", async (route) => {
    await route.fulfill({ status: 404, json: { success: false, error: "not found" } });
  });
  await page.addInitScript(
    ([key, requestKey]) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({ requestKey, body: { itemIds: ["item-1"], fulfillmentMethod: "pickup" } })
      );
    },
    [`checkoutRequest:${userId}`, REQUEST_KEY]
  );

  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "Periksa status pesanan", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Periksa pesanan" }).click();

  await expect(
    page.getByText("Hasil checkout belum ditemukan. Periksa lagi atau hubungi bantuan.", {
      exact: true,
    })
  ).toBeVisible();
  // Request tetap tersimpan: tidak ada placement/payment baru dari pemeriksaan.
  expect(posts).toEqual([]);
  const stored = await page.evaluate(
    ([key]) => sessionStorage.getItem(key),
    [`checkoutRequest:${userId}`]
  );
  expect(stored).not.toBeNull();
  expect(stored).toContain(REQUEST_KEY);
});

test("pemeriksaan attempt uncertain menjelaskan checking/unchanged/updated", async ({
  page,
}) => {
  const userId = await currentUserId(page);
  const posts: string[] = [];
  let state = "processing";
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/checkout/place-order")) {
      posts.push(request.url());
    }
  });
  await page.route("**/api/cart", async (route) => {
    await route.fulfill({ json: { success: true, data: { id: "empty", itemCount: 0, subtotal: 0, ppnRatePercent: 11, pricingContractVersion: 1, items: [] } } });
  });
  await page.route("**/api/checkout/requests/*", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: {
          version: 2,
          requestKey: REQUEST_KEY,
          attemptId: "attempt-1",
          state,
          orderId: null,
          paymentAvailable: false,
          redirectUrl: null,
          retryAllowed: false,
          failureCode: null,
          message: state === "processing" ? "Checkout masih diproses." : "Checkout sedang diperiksa tim kami.",
          expiresAt: null,
        },
      },
    });
  });
  await page.addInitScript(
    ([key, requestKey]) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({ requestKey, body: { itemIds: ["item-1"], fulfillmentMethod: "pickup" } })
      );
    },
    [`checkoutRequest:${userId}`, REQUEST_KEY]
  );

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Periksa pesanan" }).click();
  await expect(page.getByText("Checkout masih diproses.", { exact: true })).toBeVisible();

  // Putaran kedua tanpa perubahan status: bukan error, bukan klaim sukses.
  await page.getByRole("button", { name: "Periksa status checkout" }).click();
  await expect(
    page.getByText("Status belum berubah. Silakan periksa lagi nanti.", { exact: true })
  ).toBeVisible();

  // Putaran ketiga dengan status berbeda: dinyatakan diperbarui.
  state = "manual_review";
  await page.getByRole("button", { name: "Periksa status checkout" }).click();
  await expect(
    page.getByText("Checkout sedang diperiksa tim kami.", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Status checkout diperbarui.", { exact: true })
  ).toBeVisible();
  expect(posts).toEqual([]);
});

// ---------------------------------------------------------------------------
// AC2-05 — satu feedback submit utama, terlihat dan dapat difokuskan
// ---------------------------------------------------------------------------

test("submit error tampil inline, dapat difokuskan, dan menyediakan recovery", async ({
  page,
}) => {
  await mockCheckoutData(page);
  await page.route("**/api/checkout/place-order", async (route) => {
    await route.abort("connectionfailed");
  });
  await openCheckoutReview(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();

  const alert = page.getByRole("alert").filter({
    hasText: "Koneksi terputus. Periksa status pesanan sebelum mencoba lagi.",
  });
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  // Satu pesan utama: judul/aksi utama tetap tersedia setelah error.
  await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
});

// ---------------------------------------------------------------------------
// AC2-07/AC2-08 — bantuan mobile, target Close, fokus kembali
// ---------------------------------------------------------------------------

test("bantuan di checkout mobile menjadi link biasa tanpa tombol mengambang", async ({
  page,
}) => {
  await mockCheckoutData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/checkout");

  const inlineHelp = page.getByRole("link", {
    name: "Butuh bantuan? Hubungi WhatsApp",
  });
  await expect(inlineHelp).toBeVisible();
  // Tepat satu bantuan aktif: tombol mengambang disembunyikan pada viewport ini.
  await expect(page.getByRole("link", { name: /WhatsApp/ })).toHaveCount(1);
  const box = await inlineHelp.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // CTA utama tidak tertutup bantuan.
  const cta = page.getByRole("button", { name: "Lanjut", exact: true });
  await cta.scrollIntoViewIfNeeded();
  const ctaBox = await cta.boundingBox();
  const helpBox = await inlineHelp.boundingBox();
  const overlaps =
    ctaBox!.x < helpBox!.x + helpBox!.width &&
    helpBox!.x < ctaBox!.x + ctaBox!.width &&
    ctaBox!.y < helpBox!.y + helpBox!.height &&
    helpBox!.y < ctaBox!.y + ctaBox!.height;
  expect(overlaps).toBe(false);
  await cta.click();

  // Desktop tetap memakai tombol mengambang yang sama.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/checkout");
  await expect(
    page.getByRole("link", { name: "Butuh bantuan? Hubungi WhatsApp" })
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /WhatsApp/ })).toHaveCount(1);
});

test("dialog alamat dan promo memberi target Close nyaman dan fokus kembali", async ({
  page,
}) => {
  await mockCheckoutData(page);
  await mockAddresses(page);
  await page.route("**/api/shipment/regions*", async (route) => {
    await route.fulfill({ json: { success: true, data: [{ id: "r1", name: "Wilayah Uji Panjang Nama Kecamatan" }] } });
  });
  await page.route("**/api/checkout/delivery-quote", async (route) => {
    await route.fulfill({ json: { success: false, error: "tidak dipakai" } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Kirim ke alamat" }).click();

  const trigger = page.getByRole("button", { name: "Gunakan alamat baru" });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();

  const close = page.getByRole("button", { name: "Close" });
  const closeBox = await close.boundingBox();
  expect(closeBox!.width).toBeGreaterThanOrEqual(32);
  expect(closeBox!.height).toBeGreaterThanOrEqual(32);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Placeholder aktif dialog alamat memenuhi kontras teks biasa (AA).
  await trigger.click();
  const street = page.locator("#checkout-street");
  const promptContrast = contrastRatio(
    await readTextColor(street, "placeholder"),
    await readSurfaceColor(street)
  );
  expect(promptContrast).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press("Escape");
});

// ---------------------------------------------------------------------------
// AC2-14/AC2-15 — kebijakan tab baru, kontras footer dan header store
// ---------------------------------------------------------------------------

test("link kebijakan dekat checkbox membuka tab baru tanpa men-toggle checkbox", async ({
  page,
}) => {
  await mockCheckoutData(page);
  await openCheckoutReview(page);

  const policy = page.getByRole("link", { name: /Syarat & ketentuan/ });
  await expect(policy).toHaveAttribute("href", "/pages/terms");
  await expect(policy).toHaveAttribute("target", "_blank");
  await expect(policy).toHaveAttribute("rel", /noopener/);

  const checkbox = page.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    policy.click(),
  ]);
  expect(popup.url()).toContain("/pages/terms");
  await popup.close();

  // Checkbox dan isian tetap utuh setelah membuka kebijakan.
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByRole("heading", { name: "Pembayaran", exact: true })).toBeVisible();
  // Anchor terpisah: mengklik link tidak memilih checkbox.
  await policy.focus();
  await page.keyboard.press("Enter");
  await expect(checkbox).not.toBeChecked();
});

test("teks footer, badge cart, dan inisial avatar memenuhi kontras", async ({
  page,
}) => {
  await page.route("**/api/cart", async (route) => {
    await route.fulfill({ json: cartPayload(2) });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/products");
  await page.waitForTimeout(600);

  // Footer memakai latar semi-transparan, jadi warna permukaan dihitung dari
  // komposisi layer sampai opak (metode: rgba di atas parent sampai alpha=1).
  const footerLink = page.locator("footer a").first();
  const footerContrast = contrastRatio(
    await readTextColor(footerLink),
    await readCompositedBackground(footerLink)
  );
  expect(footerContrast).toBeGreaterThanOrEqual(4.5);

  // Anchor sosial punya hit area >= 32x32 tanpa menutupi tetangga.
  const social = page.locator("footer a[aria-label]").first();
  const socialBox = await social.boundingBox();
  expect(socialBox!.width).toBeGreaterThanOrEqual(32);
  expect(socialBox!.height).toBeGreaterThanOrEqual(32);
  const second = page.locator("footer a[aria-label]").nth(1);
  if (await second.count()) {
    const secondBox = await second.boundingBox();
    const gap = secondBox!.x - (socialBox!.x + socialBox!.width);
    expect(gap).toBeGreaterThanOrEqual(0);
  }

  // Badge cart: teks putih di atas latar badge sendiri.
  const badge = page.locator('a[aria-label="Keranjang"] span').first();
  await expect(badge).toBeVisible();
  const badgeContrast = contrastRatio(
    await readTextColor(badge),
    await readSurfaceColor(badge)
  );
  expect(badgeContrast).toBeGreaterThanOrEqual(4.5);

  // Inisial avatar dibaca pada background header setelah scroll.
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(500);
  const avatar = page.locator('header [class*="bg-secondary"]').first();
  await expect(avatar).toBeVisible();
  const avatarContrast = contrastRatio(
    await readTextColor(avatar),
    await readSurfaceColor(avatar)
  );
  expect(avatarContrast).toBeGreaterThanOrEqual(4.5);
});

// ---------------------------------------------------------------------------
// AC2-11 — daftar alamat bounded, penerima/alamat panjang, disabled reason
// ---------------------------------------------------------------------------

test("dropdown alamat membungkus penerima dan alamat, membatasi tinggi, dan menjelaskan alasan disabled", async ({
  page,
}) => {
  await mockCheckoutData(page);
  await mockAddresses(page);
  await page.route("**/api/checkout/delivery-quote", async (route) => {
    await route.fulfill({ json: { success: true, data: { services: QUOTE_SERVICES } } });
  });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/checkout");
    await page.getByRole("button", { name: "Kirim ke alamat" }).click();
    await page.getByLabel("Alamat Pengiriman").click();

    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    const listBox = await listbox.boundingBox();
    expect(listBox!.height).toBeLessThanOrEqual(844 * 0.7);

    // Penerima + alamat panjang dirender sebagai blok yang membungkus.
    const longItem = page.getByRole("option", {
      name: /Muhammad Rizky Pratama Wijaya Kusuma/,
    });
    const longBox = await longItem.boundingBox();
    expect(longBox!.height).toBeGreaterThan(40);
    await expect(
      longItem.getByText(/Jl\. Perumahan Bukit Hijau Blok C7 No\. 25/)
    ).toBeVisible();

    // Alasan disabled tertulis, bukan sekadar abu-abu.
    const disabled = page.getByRole("option", { name: /Sari Wulandari/ });
    await expect(disabled).toBeDisabled();
    await expect(
      disabled.getByText("Wilayah belum lengkap — perbarui di Buku Alamat")
    ).toBeVisible();

    // Keyboard dapat memilih alamat.
    await page.keyboard.press("Escape");
    await page.getByLabel("Alamat Pengiriman").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Alamat Pengiriman")).not.toHaveText(
      "Pilih alamat pengiriman"
    );
  }
});

test("mengubah tujuan membuang layanan lama dan menjelaskan pemilihan ulang", async ({
  page,
}) => {
  await mockCheckoutData(page);
  await mockAddresses(page);
  await page.route("**/api/checkout/delivery-quote", async (route) => {
    await route.fulfill({ json: { success: true, data: { services: QUOTE_SERVICES } } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Kirim ke alamat" }).click();
  await page.getByRole("radio", { name: /JNE REG/ }).check();
  const next = page.getByRole("button", { name: "Lanjut", exact: true });
  await expect(next).toBeEnabled();

  // Tujuan berubah: quote/pilihan/acknowledgement lama gugur.
  await page.getByLabel("Alamat Pengiriman").click();
  await page.getByRole("option", { name: /Muhammad Rizky/ }).click();
  await expect(
    page.getByText("Tujuan berubah. Pilih layanan pengiriman kembali.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByRole("radio", { name: /JNE REG/ }).check();
  await expect(
    page.getByText("Tujuan berubah. Pilih layanan pengiriman kembali.", {
      exact: true,
    })
  ).toHaveCount(0);
  await expect(next).toBeEnabled();
});

// ---------------------------------------------------------------------------
// AC2-06 — 320 px dan pembesaran teks 200% tetap terbaca dan dapat dioperasikan
// ---------------------------------------------------------------------------

test("pada 320 px dan teks 200% biaya, tombol, dan daftar tetap dapat dipakai", async ({
  page,
}) => {
  await mockCheckoutData(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await openCheckoutReview(page);

  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );

  expect(await overflow()).toBeLessThanOrEqual(0);
  const breakdown = page.getByRole("region", { name: "Rincian Pembayaran" });
  await expect(breakdown.getByText("Total Bayar", { exact: true })).toBeVisible();
  await expect(breakdown.getByText("Rp 166.500", { exact: true })).toBeVisible();
  const pay = page.getByRole("button", { name: /Bayar Sekarang/ });
  await pay.scrollIntoViewIfNeeded();
  await expect(pay).toBeVisible();

  // Screening text-resize 200%: ukuran font akar digandakan sehingga SEMUA
  // ukuran rem (paddings, ikon, kartu) juga ikut membesar — lebih keras dari
  // text-resize font-only di browser. Kontrak yang diuji di sini adalah fungsi:
  // biaya, tombol, dan daftar tetap terbaca dan dapat dioperasikan, dan tidak
  // ada konten yang terpotong (clipping) oleh `overflow: hidden`.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.waitForTimeout(400);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => {
        const style = getComputedStyle(el);
        const hides =
          style.overflowX === "hidden" || style.overflowX === "clip";
        return hides && el.scrollWidth > el.clientWidth + 1;
      })
      .map((el) => `${el.tagName}.${(el.className || "").toString().slice(0, 40)}`)
      .slice(0, 5)
  );
  expect(clipped, "tidak boleh ada konten terpotong").toEqual([]);

  await expect(breakdown.getByText("Total Bayar", { exact: true })).toBeVisible();
  await expect(
    breakdown.getByText("Rp 166.500", { exact: true })
  ).toBeVisible();
  const payAfter = page.getByRole("button", { name: /Bayar Sekarang/ });
  await payAfter.scrollIntoViewIfNeeded();
  await expect(payAfter).toBeVisible();
  const policy = page.getByRole("link", { name: /Syarat & ketentuan/ });
  await policy.scrollIntoViewIfNeeded();
  await expect(policy).toBeVisible();
  const checkbox = page.getByRole("checkbox");
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect(payAfter).toBeEnabled();
});

// ---------------------------------------------------------------------------
// AC2-04 — promo gugur (total naik) dan promo yang menurunkan total
// ---------------------------------------------------------------------------

test("promo gugur menjelaskan total sebelum/sesudah dan promo penurun total memakai delta inline", async ({
  page,
}) => {
  await mockCheckoutData(page);
  await page.unroute("**/api/discounts/available");
  await page.route("**/api/discounts/available", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: {
          items: [
            {
              offerId: "offer-hemat-20",
              name: "Hemat 20 Ribu",
              benefitAmount: "20000",
              benefitKind: "fixed_goods",
              rate: null,
              capAmount: null,
              minSubtotal: "0",
              endsAt: null,
              eligible: true,
              reason: null,
              reasonMessage: null,
            },
          ],
          page: 1,
          pageSize: 10,
          totalItems: 1,
          totalPages: 1,
          selectedOffer: null,
          selectedOfferUnavailable: false,
        },
      },
    });
  });

  // Fixture plan §8: baseline 166.500; promo 20.000 → 144.300; promo 25.000 →
  // 138.750. Nominal ditulis literal, bukan hasil hitung komponen.
  const pricing = (discount: string, total: string) => ({
    subtotal: "150000",
    discount,
    taxableBase: String(150000 - Number(discount)),
    shippingCost: "0",
    serviceFee: "0",
    ppnRatePercent: "11",
    ppnAmount: String(Math.round((150000 - Number(discount)) * 0.11)),
    total,
  });
  let step: "baseline" | "promo20" | "gone" = "baseline";
  await page.unroute("**/api/checkout/preview");
  await page.route("**/api/checkout/preview", async (route) => {
    if (step === "gone") {
      await route.fulfill({
        status: 409,
        json: {
          success: false,
          code: "PROMO_NOT_APPLICABLE",
          error: "Promo tidak lagi berlaku untuk pesanan ini.",
          data: {
            previous: {
              status: "invalid",
              message: "Kuota promo sudah habis.",
              promo: { kind: "public", offerId: "offer-hemat-20" },
            },
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        success: true,
        data: {
          reviewToken: `token-${step}`,
          expiresAt: "2045-01-01T00:00:00Z",
          contextFingerprint: "d".repeat(64),
          promo:
            step === "promo20"
              ? { kind: "public", offerId: "offer-hemat-20", benefitAmount: "20000" }
              : { kind: "none" },
          pricing: step === "baseline" ? pricing("0", "166500") : pricing("20000", "144300"),
        },
      },
    });
  });

  await openCheckoutReview(page);
  await expect(
    page
      .getByRole("region", { name: "Rincian Pembayaran" })
      .getByText("Rp 166.500", { exact: true })
  ).toBeVisible();

  // Promo 20.000 diterapkan → total turun 22.200 dari baseline, inline.
  step = "promo20";
  await page.getByRole("button", { name: /^(Pilih promo|Ubah promo)$/ }).click();
  await page.getByRole("radio", { name: /Hemat 20 Ribu/ }).check();
  await page.getByRole("button", { name: "Gunakan promo", exact: true }).click();
  await expect(
    page.getByText("Total turun Rp22.200 menjadi Rp144.300.", { exact: true })
  ).toBeVisible();

  // Promo gugur saat place-order: total kembali tanpa promo + alasan + ack.
  step = "gone";
  await page.route("**/api/checkout/place-order", async (route) => {
    await route.fulfill({
      status: 409,
      json: {
        success: false,
        code: "PROMO_NOT_APPLICABLE",
        error: "Promo tidak lagi berlaku untuk pesanan ini.",
      },
    });
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Bayar Sekarang/ }).click();

  await expect(
    page.getByText("Promo tidak berlaku. Total naik Rp22.200 menjadi Rp166.500.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lanjut tanpa promo" })
  ).toBeVisible();
  // Penghematan palsu tidak dipertahankan: total kembali ke 166.500.
  await expect(
    page.getByText("Rp 144.300", { exact: true })
  ).toHaveCount(0);
});

