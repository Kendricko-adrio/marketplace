import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CheckoutInputError } from "@/lib/checkout-input";
import { CheckoutAdmissionError } from "@/lib/checkout-admission";
import { CheckoutReviewRequiredError, CheckoutReviewUnavailableError } from "@/lib/checkout-review";
import { PricingContractError } from "@/lib/versioned-pricing";
import { RedemptionReviewChangedError } from "@/lib/discount-reservation";

// Karakterisasi boundary POST sebelum ekstraksi. DB/provider tidak boleh ditulis.
const state = vi.hoisted(() => ({
  accessError: null as unknown,
  authorized: true,
  paused: "false",
  configError: false,
  contract: 0,
  reads: [] as string[],
  logs: [] as [string, string][],
}));
vi.mock("@/lib/route-access", () => ({
  requireOnboardedApiSession: async () => {
    if (state.accessError) throw state.accessError;
    return state.authorized
      ? { ok: true, session: { user: { id: "client", name: "Customer" } } }
      : { ok: false, response: Response.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  },
}));
vi.mock("@/db", async () => {
  const schema = await import("@marketplace/db/src/schema");
  const { getTableName } = await import("drizzle-orm");
  return { ...schema, db: {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => {
      state.reads.push(getTableName(table));
      if (getTableName(table) !== "cart") throw new Error("Unexpected database read");
      return { where: () => ({ limit: async () => [] }) };
    } }),
  } };
});
vi.mock("@/lib/config", () => ({
  getConfigString: async () => {
    state.reads.push("pause");
    if (state.configError) throw new Error("Config unavailable");
    return state.paused;
  },
  getDiscountsContractVersion: async () => { state.reads.push("contract"); return state.contract; },
  getConfigNumber: vi.fn(() => { throw new Error("Unexpected config read"); }),
  getPpnRatePercent: vi.fn(() => { throw new Error("Unexpected tax read"); }),
}));
vi.mock("@/lib/logger", () => ({
  createModuleLogger: (module: string) => Object.fromEntries(["info", "warn", "error"].map((level) => [level,
    (message: string) => state.logs.push([`${module}:${level}`, message])])),
  getRequestId: () => "canonical-request",
  withRequestContext: (handler: unknown) => handler,
}));

const pickup = {
  phone: "081234567890", email: "test@example.invalid", pickupDate: "2030-01-01",
  pickupTime: "10:00", selectedItemIds: ["item-0"],
};
const delivery = {
  fulfillmentMethod: "delivery", contactPhone: pickup.phone, contactEmail: pickup.email,
  itemIds: ["item-0"], addressId: "address", courierId: 1, serviceId: 2,
  approvedPricing: {}, originFingerprint: "a".repeat(64),
};
async function submit(body: unknown = pickup, raw = false) {
  const { POST } = await import("./route");
  return POST(new NextRequest("http://localhost/api/checkout/place-order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  }));
}
beforeEach(() => {
  state.accessError = null; state.authorized = true; state.paused = "false";
  state.configError = false; state.contract = 0; state.reads = []; state.logs = [];
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Forbidden provider write/read"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("place-order POST parity before structural extraction", () => {
  it("returns the auth response before reading malformed JSON or config", async () => {
    state.authorized = false;
    const response = await submit("{", true);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Unauthorized" });
    expect(state.reads).toEqual([]);
  });
  it("keeps malformed JSON at the input boundary", async () => {
    const response = await submit("{", true);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "Invalid checkout JSON" });
    expect(state.reads).toEqual([]);
  });
  it.each([pickup, delivery])("reaches the same empty-cart outcome for valid method-aware input %#", async (body) => {
    const response = await submit(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "Cart is empty" });
    expect(state.reads).toEqual(["pause", "contract", "cart"]);
  });
  it.each([
    { ...pickup, selectedItemIds: ["item-0", "item-0"] },
    { ...pickup, selectedItemIds: [] },
    { ...pickup, unexpected: true },
    { ...delivery, pickupDate: "2030-01-01" },
    { ...pickup, acknowledgements: { promoIncrease: { candidateFingerprint: "invalid" } } },
    { ...pickup, promoSelection: { kind: "none", offerId: "unexpected" } },
  ])("rejects invalid input before any config or DB access %#", async (body) => {
    const response = await submit(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: "Invalid request body", details: expect.any(Array) });
    expect(state.reads).toEqual([]);
  });
  it.each(["true", " TRUE "])("keeps emergency pause fail-closed (%s)", async (paused) => {
    state.paused = paused;
    const response = await submit();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, code: "POLICY_UNAVAILABLE", error: "Checkout sedang dijeda sementara." });
    expect(state.reads).toEqual(["pause"]);
  });
  it("keeps config outage fail-closed without reading the cart", async () => {
    state.configError = true;
    expect((await submit()).status).toBe(503);
    expect(state.reads).toEqual(["pause"]);
  });
  it("rejects versioned selection under contract 0", async () => {
    const response = await submit({ ...pickup, promoSelection: { kind: "none" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: "UNSUPPORTED_VERSION", error: "Checkout berversi belum aktif." });
    expect(state.reads).toEqual(["pause", "contract"]);
  });
  it("requires review under contract 1 before reading cart", async () => {
    state.contract = 1;
    const response = await submit();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: "CHECKOUT_REVIEW_REQUIRED", requestId: "canonical-request" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(state.reads).toEqual(["pause", "contract"]);
  });
  it.each([
    { error: new CheckoutInputError("Too large", 413), status: 413, body: { success: false, error: "Too large" }, cache: null, retry: null },
    { error: new PricingContractError("PRICING_INPUT_INVALID", "Source changed"), status: 400, body: { success: false, error: "Data harga atau keranjang tidak valid.", code: "PRICING_INPUT_INVALID" }, cache: null, retry: null },
    { error: new CheckoutReviewUnavailableError("No secret"), status: 503, body: { success: false, code: "PRICING_UNAVAILABLE", error: "Review checkout belum tersedia.", requestId: "canonical-request" }, cache: "no-store", retry: null },
    { error: new RedemptionReviewChangedError(), status: 409, body: { success: false, code: "CHECKOUT_REVIEW_REQUIRED", error: "Pilihan promo berubah. Periksa kembali pesanan.", requestId: "canonical-request" }, cache: "no-store", retry: null },
    { error: new CheckoutAdmissionError(503, "POLICY_UNAVAILABLE", 7), status: 503, body: { success: false, code: "POLICY_UNAVAILABLE", error: "Checkout belum tersedia. Coba beberapa saat lagi.", requestId: "canonical-request" }, cache: "no-store", retry: "7" },
    { error: new CheckoutReviewRequiredError("promo_increase"), status: 409, body: { success: false, code: "CHECKOUT_REVIEW_REQUIRED", error: "Konfirmasi kenaikan total setelah mengganti promo diperlukan.", requestId: "canonical-request", data: { requiresAcknowledgement: "promo_increase" } }, cache: "no-store", retry: null },
    { error: new Error("Private provider response"), status: 500, body: { success: false, error: "Failed to place order" }, cache: null, retry: null },
  ])("preserves workflow error status/body/headers ($status, $body.code)", async ({ error, status, body, cache, retry }) => {
    state.accessError = error;
    const response = await submit();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get("Cache-Control")).toBe(cache);
    expect(response.headers.get("Retry-After")).toBe(retry);
    expect(state.reads).toEqual([]);
    expect(state.logs[0]).toEqual(["checkout-place-order:info", "place order requested"]);
    expect(state.logs).toHaveLength(2);
  });
});
