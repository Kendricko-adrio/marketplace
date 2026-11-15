/**
 * Kepadatan copy checkout, review, dan hasil pembayaran — spec UI-only.
 *
 * Plan: `.scratch/checkout-simplification/plan/improve-checkout-copy-density.md`
 * (fitur 1–4). Semua data halaman datang dari route interception; sesi memakai
 * seam HTTP sign-in yang sudah ada karena `/checkout` memvalidasi sesi nyata.
 * Tidak ada mutasi DB, provider call, atau order/transaksi baru.
 *
 * Cakupan:
 * - AC-01 legenda “* Wajib diisi” + penanda/atribut wajib pada field pickup
 * - AC-02 validasi saat klik `Lanjut` memfokuskan field invalid pertama
 * - AC-03 nama aksesibel “Waktu Pickup”, keyboard, `aria-describedby`
 * - AC-03b penolakan slot pickup berbahasa Indonesia (bukan string Inggris)
 * - AC-04 InfoHint: hover, click, Enter/Space, Escape + fokus kembali, 24×24
 * - AC-05 kartu cabang 390/320 tanpa badge dan tanpa overflow
 * - AC-06/AC-07 tidak ada blok amber pickup, gateway pembayaran, atau reminder
 *   pickup duplikat; total/rincian/checkbox tetap ada
 * - AC-08 hasil pembayaran netral untuk semua nilai query, ID utuh, tanpa fetch
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

/** Fail closed kecuali berjalan pada konfigurasi mock terisolasi. */
function requireIsolatedMockRun(): void {
  if (
    process.env.E2E_PROVIDER_MOCKS !== "true" ||
    !process.env.E2E_MOCK_STORE_BASE_URL ||
    !process.env.E2E_MOCK_API_BASE_URL
  ) {
    throw new Error(
      "checkout-density-mock.spec.ts harus dijalankan lewat playwright.mock.config.ts"
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
// Fixture: literal dari plan/AC, bukan hasil perhitungan implementasi
// ---------------------------------------------------------------------------

const CART_ITEM_ID = "density-item-1";
const BRANCH = {
  id: "density-branch-1",
  name: "ADF Cabang Kemang Selatan Raya",
  code: "KMG",
  city: "Jakarta Selatan",
  address:
    "Jl. Kemang Selatan Raya No. 12, Bangka, Mampang Prapatan, Jakarta Selatan",
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

function cartPayload() {
  return {
    success: true,
    data: {
      id: "density-cart-1",
      itemCount: 1,
      subtotal: 150_000,
      ppnRatePercent: 11,
      // Versi 1: review membaca `/api/checkout/preview` (di-mock) supaya
      // total/rincian serta area promo tetap dirender seperti produksi.
      pricingContractVersion: 1,
      items: [
        {
          id: CART_ITEM_ID,
          quantity: 1,
          variantId: "density-variant-1",
          branchId: BRANCH.id,
          variant: {
            id: "density-variant-1",
            color: "Hitam",
            size: "M",
            price: "150000",
          },
          product: { id: "density-product-1", name: "Kemeja Linen Fixture" },
          image: null,
          branch: { id: BRANCH.id, name: BRANCH.name, city: BRANCH.city },
        },
      ],
    },
  };
}

function previewPayload() {
  return {
    success: true,
    data: {
      reviewToken: "density-review-token",
      expiresAt: "2045-01-01T00:00:00Z",
      contextFingerprint: "a".repeat(64),
      promo: { kind: "none" },
      // Baseline pickup tanpa promo: 150.000 + PPN 11% (16.500) = 166.500.
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

/** Tanggal pickup yang dijamin bukan hari tutup (Minggu) pada fixture. */
function nextOpenDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  while (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

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

type SlotBehaviour =
  | { kind: "ok" }
  | { kind: "reject"; error: string }
  | { kind: "network" };

type CheckoutMocks = {
  slot?: SlotBehaviour;
  preview?: () => unknown;
};

async function openCheckout(page: Page, mocks: CheckoutMocks = {}) {
  const slot = mocks.slot ?? { kind: "ok" };
  await page.addInitScript((ids) => {
    sessionStorage.setItem("checkoutSelectedItemIds", JSON.stringify(ids));
  }, [CART_ITEM_ID]);

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
    if (slot.kind === "network") {
      await route.abort("failed");
      return;
    }
    if (slot.kind === "reject") {
      await route.fulfill({
        status: 400,
        json: { success: false, error: slot.error },
      });
      return;
    }
    await route.fulfill({ json: { success: true, message: "ok" } });
  });
  await page.route("**/api/checkout/preview", async (route) => {
    await route.fulfill({ json: (mocks.preview ?? previewPayload)() });
  });

  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "Cara Pengiriman", exact: true })
  ).toBeVisible();
}

async function fillPickupSlot(page: Page) {
  await page.locator("#pickupDate").fill(nextOpenDate());
  const combobox = page.getByRole("combobox", { name: /Waktu Pickup/ });
  await combobox.click();
  await page.getByRole("option", { name: "10:00", exact: true }).click();
}

async function fillPickupContact(page: Page) {
  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByLabel("Email *").fill(TEST_USERS.store.email);
}

async function goToReview(page: Page) {
  await fillPickupSlot(page);
  await fillPickupContact(page);
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
// AC-01/AC-02/AC-03 — wajib, error per field, fokus, aksesibilitas waktu
// ---------------------------------------------------------------------------

test("step 1 menandai field wajib dan memfokuskan field invalid pertama", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCheckout(page);

  await expect(page.getByText("* Wajib diisi", { exact: true })).toBeVisible();

  const date = page.locator("#pickupDate");
  await expect(date).toHaveAttribute("required", "");
  await expect(date).toHaveAttribute("aria-required", "true");
  await expect(page.getByLabel("Nomor Telepon *")).toHaveAttribute(
    "required",
    ""
  );
  await expect(page.getByLabel("Nomor Telepon *")).toHaveAttribute(
    "aria-required",
    "true"
  );
  await expect(page.getByLabel("Email *")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Email *")).toHaveAttribute(
    "aria-required",
    "true"
  );

  const combobox = page.getByRole("combobox", { name: /Waktu Pickup/ });
  await expect(combobox).toHaveAttribute("aria-required", "true");

  // Sesi mengisi kontak dari profil; pakai nilai tidak valid agar kontrak
  // wajib/error per field tetap teruji tanpa melawan prefill profil.
  await page.getByLabel("Nomor Telepon *").fill("123");
  await page.getByLabel("Email *").fill("bukan-email");

  // Kontrak T02/D2: pickup tetap bisa menjalankan validasi lewat `Lanjut`;
  // error muncul dekat field dan fokus pindah ke field invalid pertama.
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await expect(page.getByText("Pilih tanggal pickup.", { exact: true })).toBeVisible();
  await expect(date).toBeFocused();
  await expect(date).toHaveAttribute("aria-invalid", "true");

  await date.fill(nextOpenDate());
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await expect(page.getByText("Pilih jam pickup.", { exact: true })).toBeVisible();
  await expect(combobox).toBeFocused();

  // Keyboard: Enter membuka daftar, panah + Enter memilih slot, hint/error
  // terhubung lewat aria-describedby.
  await combobox.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(combobox).not.toHaveText("Pilih waktu");
  await expect(combobox).toHaveAttribute(
    "aria-describedby",
    /pickupTime-hint/
  );

  // Kontak: error dekat field masing-masing dan fokus ke field invalid pertama.
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await expect(
    page.getByText("Masukkan nomor telepon yang valid (8–15 angka).", {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByLabel("Nomor Telepon *")).toBeFocused();
  await expect(page.getByLabel("Nomor Telepon *")).toHaveAttribute(
    "aria-invalid",
    "true"
  );

  await page.getByLabel("Nomor Telepon *").fill("081234567890");
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await expect(
    page.getByText("Masukkan alamat email yang valid.", { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel("Email *")).toBeFocused();
});

test("penolakan slot pickup dari server tampil dalam bahasa Indonesia", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCheckout(page, {
    slot: {
      kind: "reject",
      error: "Pickup time must be between 09:00 and 21:00 (30-min intervals).",
    },
  });
  await fillPickupSlot(page);
  await fillPickupContact(page);
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();

  await expect(
    page.getByText("Waktu pickup harus antara 09:00 dan 21:00.", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/Pickup time must be between/, { exact: false })
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Pembayaran", exact: true })
  ).toBeHidden();

  // Kegagalan jaringan: pesan Indonesia, bukan string Inggris mentah.
  await page.unroute("**/api/checkout/validate-step-2");
  await page.route("**/api/checkout/validate-step-2", async (route) => {
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Lanjut", exact: true }).click();
  await expect(
    page.getByText("Slot pickup belum dapat diverifikasi. Coba lagi.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByText(/Failed to validate pickup slot/, { exact: false })
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// AC-04 — InfoHint: hover, click, keyboard, Escape + fokus, target 24×24
// ---------------------------------------------------------------------------

test("InfoHint terbuka lewat hover/click/keyboard dan Escape mengembalikan fokus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCheckout(page);

  const trigger = page.getByRole("button", { name: "Tentang cabang pickup" });
  const content = page.getByText(/Satu checkout hanya untuk satu cabang/);

  const box = await trigger.boundingBox();
  expect(box?.width, `lebar trigger ${box?.width}`).toBe(24);
  expect(box?.height, `tinggi trigger ${box?.height}`).toBe(24);

  await trigger.hover();
  await expect(content).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(content).toBeHidden();

  // Click (mouse) tidak menutup popover yang sudah terbuka karena hover,
  // dan tap/touch (tanpa hover) juga membuka.
  await trigger.click();
  await expect(content).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(content).toBeHidden();

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(content).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(content).toBeHidden();
  await expect(trigger).toBeFocused();
});

// ---------------------------------------------------------------------------
// AC-05/AC-06 — kartu cabang dan disclaimer pada viewport sempit
// ---------------------------------------------------------------------------

for (const width of [390, 320]) {
  test(`kartu cabang dan disclaimer rapi pada ${width}px tanpa blok amber`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openCheckout(page);

    await expect(page.getByText(BRANCH.name, { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Jl\. Kemang Selatan Raya No\. 12/, { exact: false })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tentang cabang pickup" })
    ).toBeVisible();
    await expect(page.getByText("Cabang Terpilih", { exact: true })).toHaveCount(0);

    // Label langkah tetap terbaca di mobile (teks pendek).
    await expect(page.getByText("Pengiriman", { exact: true })).toBeVisible();
    await expect(page.getByText("Bayar", { exact: true })).toBeVisible();

    // Satu kalimat netral selalu terlihat tanpa hover; tidak ada warning amber.
    await expect(
      page.getByText("Tanggal dan jam pickup hanya estimasi, bukan janji temu.", {
        exact: true,
      })
    ).toBeVisible();
    await expect(page.locator('[class*="bg-amber-50"]')).toHaveCount(0);

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
  });
}

// ---------------------------------------------------------------------------
// AC-07/AC-14 — review ringkas tanpa gateway, total/rincian/checkbox tetap
// ---------------------------------------------------------------------------

test("review memakai copy ringkas tanpa blok gateway dan reminder duplikat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCheckout(page);
  await goToReview(page);

  await expect(
    page.getByText("Periksa pesanan, lalu lanjut ke pembayaran.", { exact: true })
  ).toBeVisible();

  // AC-14: identitas gateway dan daftar metode pembayaran tidak muncul.
  for (const forbidden of ["Midtrans", "QRIS", "GoPay"]) {
    await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
  }

  // AC-07: satu baris reminder pickup, bukan dua paragraf amber.
  await expect(
    page.getByText(
      "Pickup hanya estimasi. Saat mengambil, sebutkan nomor telepon dan email pesanan.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByText(/Sebutkan nomor telepon dan email yang kamu isi/, {
      exact: false,
    })
  ).toHaveCount(0);

  // Data keputusan tetap ada: total, rincian, dan persetujuan.
  const breakdown = page.getByRole("region", { name: "Rincian Pembayaran" });
  await expect(breakdown).toBeVisible();
  await expect(breakdown.getByText("Total Bayar", { exact: true })).toBeVisible();
  await expect(breakdown.getByText("Rp 166.500", { exact: true })).toBeVisible();
  const checkbox = page.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  await expect(
    page.getByText(
      "Saya telah memeriksa pesanan dan menyetujui Syarat & ketentuan. Saat mengambil, saya akan menyebutkan nomor telepon dan email pesanan.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bayar Sekarang" })
  ).toBeDisabled();
});

// ---------------------------------------------------------------------------
// AC-08 — hasil pembayaran membaca DTO, bukan query; ID utuh; tanpa transaksi
// ---------------------------------------------------------------------------

test("hasil pembayaran menampilkan status terverifikasi dan ID utuh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const orderId = "DENSITY-2026-11-0001-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/orders")) requests.push(path);
  });

  // Fase 2 (W01): status berasal dari DTO owner-scoped. Query gateway hanya
  // membawa identitas, bukan bukti sukses/pending/gagal.
  await page.route("**/api/orders/**", async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: {
          id: orderId,
          status: "pending_payment",
          paymentStatus: "pending",
          fulfillmentBlockedReason: null,
        },
      },
    });
  });

  for (const status of [
    "settlement",
    "capture",
    "pending",
    "deny",
    "cancel",
    "unexpected-status",
  ]) {
    await page.goto(
      `/checkout/result?order_id=${orderId}&transaction_status=${status}`
    );
    await expect(
      page.getByRole("heading", { name: "Menunggu pembayaran" })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Buka detail pesanan untuk melihat status dan pilihan pembayaran.",
        { exact: true }
      )
    ).toBeVisible();
    const code = page.locator("code", { hasText: orderId });
    await expect(code).toHaveText(orderId);
    await expect(code).toHaveClass(/break-all/);
    await expect(
      page.getByRole("link", { name: /Lihat Detail Pesanan/ })
    ).toHaveAttribute("href", `/account/orders/${orderId}`);
    await expect(page.getByText("Pembayaran Berhasil!", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Pembayaran Gagal", { exact: false })).toHaveCount(0);
  }

  await page.unroute("**/api/orders/**");
  await page.goto("/checkout/result");
  await expect(
    page.getByRole("heading", { name: "Pesanan belum dapat ditentukan" })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Lihat Pesanan Saya/ })
  ).toHaveAttribute("href", "/account");
  await expect(
    page.getByRole("link", { name: /Lihat Detail Pesanan/ })
  ).toHaveCount(0);

  // Tanpa order_id tidak ada GET pesanan sama sekali.
  expect(requests.every((path) => path === `/api/orders/${orderId}`)).toBe(true);
});
