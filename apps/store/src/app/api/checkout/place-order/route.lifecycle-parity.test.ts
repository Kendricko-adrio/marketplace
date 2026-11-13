import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildPricingSnapshot, PricingContractError } from "@/lib/versioned-pricing";
import { buildCheckoutReviewContextFingerprint, createCheckoutReviewToken } from "@/lib/checkout-review";
import { RedemptionReviewChangedError } from "@/lib/discount-reservation";
import { DeliveryQuoteDataError } from "@/lib/delivery-quote-data";
import { QuoteDeliveryError } from "@/lib/delivery-quote";

// Boundary POST; doubles hanya pada persistence/provider existing. Tidak mock
// modul baru hasil ekstraksi. Nilai response/provider diassert dengan literal.
const state = vi.hoisted(() => ({
  contract: 0, sales: "confirmed", paymentFails: false, persistFails: false,
  quoteError: null as unknown, missingService: false,
  acceptedReplay: false, attemptReplay: false, conflict: false, paused: false, liveReads: [] as string[],
  txError: null as unknown, txCount: 0,
  events: [] as string[], writes: [] as { table: string; values: Record<string, unknown> }[],
  creates: [] as unknown[], payments: [] as unknown[], attemptInputs: [] as unknown[],
}));
vi.mock("@/lib/route-access", () => ({ requireOnboardedApiSession: async () => ({
  ok: true, session: { user: { id: "client", name: "Customer" } },
}) }));
vi.mock("@/db", async () => {
  const schema = await import("@marketplace/db/src/schema");
  const { getTableName } = await import("drizzle-orm");
  const item = { cartItemId: "item", cartItemUpdatedAt: new Date("2026-10-01T00:00:00Z"), quantity: 2,
    variantId: "variant", variantColor: "Black", variantSize: "40", variantPrice: "1000",
    parcelDimensions: null, jubelioItemId: 101, productId: "product", productName: "Shoes", branchId: "branch" };
  const db = {
    select: () => {
      let table = "";
      const result = () => {
        if (table === "cart") return [{ id: "cart", userId: "client" }];
        if (table === "cart_item") return [item];
        if (table === "branch") return [{ id: "branch", status: "aktif", jubelioLocationId: 7, operatingHours: { tuesday: { open: "09:00", close: "17:00" } } }];
        if (table === "branch_stock") return [{ available: 100, pending: 0, onOrder: 0 }];
        if (table === "product_variant") return [{ variantId: "variant", sourceUnitPrice: "1000", storedTargetUnitPrice: null, markdownRevisionId: null, revisionVariantId: null }];
        if (table === "orders") return [{ branchId: "branch" }];
        if (table === "client") return [{ emailVerified: true }];
        if (table === "address") return [];
        throw new Error(`Unexpected persistence read: ${table}`);
      };
      const query = { from: (value: Parameters<typeof getTableName>[0]) => { table = getTableName(value); return query; },
        where: () => query, innerJoin: () => query, leftJoin: () => query, limit: () => query, for: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result()).then(resolve) };
      return query;
    },
    insert: (table: Parameters<typeof getTableName>[0]) => ({ values: (values: Record<string, unknown>) => {
      state.writes.push({ table: getTableName(table), values }); return Promise.resolve();
    } }),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (values: Record<string, unknown>) => ({ where: () => {
      state.writes.push({ table: getTableName(table), values });
      return Object.assign(Promise.resolve([]), { returning: async () => [{ branchId: "branch", pending: 0 }] });
    } }) }),
    delete: (table: Parameters<typeof getTableName>[0]) => ({ where: async () => { state.events.push(`delete:${getTableName(table)}`); } }),
    transaction: async <T>(work: (tx: unknown) => Promise<T>) => {
      state.txCount++;
      if (state.txError) throw state.txError;
      if (state.persistFails && state.txCount > 1) throw new Error("Persistence failed");
      state.events.push("transaction"); return work(db);
    },
  };
  return { ...schema, db };
});
vi.mock("@/lib/config", () => ({
  getConfigString: async () => { state.liveReads.push("pause"); return state.paused ? "true" : "false"; }, getDiscountsContractVersion: async () => { state.liveReads.push("contract"); return state.contract; },
  getConfigNumber: async () => 15, getPpnRatePercent: async () => 11,
}));
vi.mock("@/lib/checkout-admission", async (original) => ({
  ...await original<typeof import("@/lib/checkout-admission")>(), admitCheckoutRequest: async () => undefined,
}));
vi.mock("@/features/checkout/prepare-checkout-tax-service", async (original) => ({
  ...await original<typeof import("@/features/checkout/prepare-checkout-tax-service")>(),
  prepareCheckoutTax: async () => ({ taxId: -2, ratePercent: "11" }),
}));
vi.mock("@/lib/jubelio-sales-operations", async (original) => ({
  ...await original<typeof import("@/lib/jubelio-sales-operations")>(),
  recordJubelioSalesIntent: async (_tx: unknown, input: unknown) => { state.events.push("intent"); state.creates.push(input); },
}));
vi.mock("@/lib/jubelio-sales-lifecycle", async (original) => ({
  ...await original<typeof import("@/lib/jubelio-sales-lifecycle")>(),
  dispatchJubelioSalesCreate: async () => { state.events.push("sales"); return { status: state.sales, message: "Rejected" }; },
}));
vi.mock("@/lib/order-finalize", () => ({ claimAndFailOrder: async () => { state.events.push("compensate"); } }));
// Spec TX-02: the durable payment ledger is persistence. This boundary test
// already doubles @/db, so the ledger seam is doubled too — assertion tetap
// pada urutan/efek publik (intent sebelum provider, payment di luar tx).
vi.mock("@/features/payments/order-payment-repository", () => ({
  recordOrderPaymentIntent: async () => { state.events.push("payment-intent"); return { sessionId: "session" }; },
  claimOrderPaymentInitialization: async () => {
    state.events.push("payment-claim");
    return { claimed: true, sessionId: "session", dispatchClaimId: "claim",
      providerReference: "00000000-0000-4000-8000-000000000001", expectedAmount: "2220.00",
      paymentStartedAt: new Date("2026-10-01T00:00:00Z"), expiresAt: new Date("2026-10-01T00:15:00Z"),
      cartSnapshot: null };
  },
  recordOrderPaymentOutcome: async (input: { outcome: { kind: string; token?: string; redirectUrl?: string } }) => {
    state.events.push("payment-outcome");
    if (state.persistFails) return { kind: "unknown" };
    if (input.outcome.kind === "ready") return { kind: "ready", redirectUrl: input.outcome.redirectUrl, token: input.outcome.token, cartLinesDeleted: 1 };
    if (input.outcome.kind === "definitive_rejection") return { kind: "rejected" };
    return { kind: "unknown" };
  },
}));
vi.mock("@/lib/checkout-request", async (original) => ({
  ...await original<typeof import("@/lib/checkout-request")>(), findAcceptedCheckout: async () => {
    const { CheckoutRequestConflictError } = await original<typeof import("@/lib/checkout-request")>();
    if (state.conflict) throw new CheckoutRequestConflictError();
    return state.acceptedReplay ? { requestKey: "a1200000-0000-4000-8000-000000000023", orderId: "retained", state: "payment_ready", paymentAvailable: true, redirectUrl: "https://payment.invalid", expiresAt: "2026-10-01T00:15:00.000Z" } : null;
  },
}));
vi.mock("@/features/checkout/place-order-service", () => ({
  replayCheckoutAttempt: async () => state.attemptReplay ? { version: 2, attemptId: "retained-attempt", state: "promoted", orderId: "retained", redirectUrl: "https://payment.invalid", replayed: true } : null,
  placeCheckout: async (input: unknown) => {
    state.attemptInputs.push(input);
    return { version: 2, attemptId: "attempt", state: "promoted", orderId: "order", redirectUrl: "https://payment.invalid", replayed: false };
  },
}));
vi.mock("@/lib/midtrans", async (original) => ({
  ...await original<typeof import("@/lib/midtrans")>(),
  // Spec TX-02: the route's provider seam is createCheckoutPayment (the shared
  // durable initialize workflow calls it). A thrown provider error is UNKNOWN.
  createCheckoutPayment: async (input: {
    orderId: string; grossAmount: number; customerDetails: unknown; itemDetails: unknown;
    expiryMinutes: number; paymentStartedAt: Date;
  }) => {
    state.events.push("payment");
    state.payments.push([input.orderId, input.grossAmount, input.customerDetails, input.itemDetails, input.expiryMinutes, input.paymentStartedAt]);
    if (state.paymentFails) throw new Error("Payment rejected");
    return { kind: "ready", token: "token", redirectUrl: "https://payment.invalid" };
  },
}));

vi.mock("@/lib/delivery-quote-data", async (original) => ({
  ...await original<typeof import("@/lib/delivery-quote-data")>(),
  loadQuoteOriginBranch: async () => ({ id: "branch", name: "Branch", shippingPhone: "021123456", shippingAddress: "Origin", shippingPostalCode: "01234", shippingAreaId: "area" }),
  loadRevalidatedDestination: async () => {
    if (state.quoteError) throw state.quoteError;
    return { recipientName: "Customer", phone: "081234567890", fullAddress: "Destination", postalCode: "01234", areaId: "area", canonical: { provinceId: "01", province: "Province", cityId: "0101", city: "City", districtId: "010101", district: "District", areaId: "area", area: "Area", postalCode: "01234" } };
  },
  loadRevalidatedNewDestination: async () => ({ recipientName: "Customer", phone: "081234567890", fullAddress: "Destination", postalCode: "01234", areaId: "area", canonical: { provinceId: "01", province: "Province", cityId: "0101", city: "City", districtId: "010101", district: "District", areaId: "area", area: "Area", postalCode: "01234" } }),
  loadShipmentParcelConfig: async () => ({ fallback: { weight: 100, length: 10, width: 10, height: 10 }, packagingWeightGrams: 0 }),
}));
vi.mock("@/lib/delivery-quote", async (original) => ({
  ...await original<typeof import("@/lib/delivery-quote")>(),
  quoteDelivery: async () => ({ services: state.missingService ? [] : [{ courierId: 1, serviceId: 2, name: "Courier", shippingCost: 500, originFingerprint: "a".repeat(64), pricing: { subtotal: "2000.00", discount: "0.00", shippingCost: "500.00", taxableBase: "2500.00", serviceFee: "0.00", ppnRatePercent: "11", ppnAmount: "275.00", total: "2775.00" } }] }),
}));
vi.mock("@/lib/discount-selection", async (original) => ({
  ...await original<typeof import("@/lib/discount-selection")>(),
  evaluateSelectedPublicOffer: async () => ({ ok: false, reason: "OFFER_UNAVAILABLE", message: "Promo tidak tersedia." }),
  evaluateSelectedManualCode: async () => ({ ok: false, reason: "OFFER_UNAVAILABLE", message: "Promo tidak tersedia." }),
}));

const pickup = { phone: "081234567890", email: "test@example.invalid", pickupDate: "2030-01-01", pickupTime: "10:00", selectedItemIds: ["item"] };
beforeEach(() => {
  state.contract = 0; state.sales = "confirmed"; state.paymentFails = false; state.persistFails = false;
  state.quoteError = null; state.missingService = false;
  state.acceptedReplay = false; state.attemptReplay = false; state.conflict = false; state.paused = false; state.liveReads = [];
  state.txError = null; state.txCount = 0; state.events = []; state.writes = []; state.creates = []; state.payments = []; state.attemptInputs = [];
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
  let id = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`);
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-place-order-parity-signing-secret");
  vi.stubEnv("JUBELIO_EMAIL", "fixture@example.invalid"); vi.stubEnv("JUBELIO_PASSWORD", "test-only");
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/login")) return Response.json({ token: "token" });
    if (url.endsWith("/inventory/items/all-stocks/")) return Response.json({ locations: [{ location_id: 7, location_name: "Branch" }], data: [{ item_id: 101, location_stocks: [{ location_id: 7, on_hand: 100, on_order: 0, reserved: 0, available: 100 }] }] });
    throw new Error(`Forbidden provider request: ${url}`);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
async function submit(body: Record<string, unknown> = pickup) {
  const routeModule = process.env.PLACE_ORDER_BASELINE_MODULE ?? "./route";
  const { POST }: typeof import("./route") = await import(/* @vite-ignore */ routeModule);
  return POST(new NextRequest("http://localhost/api/checkout/place-order", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}
function reviewedPickup() {
  const pricing = buildPricingSnapshot({ fulfillmentMethod: "pickup", ppnRatePercent: 11,
    providerTax: { taxId: -2, ratePercent: "11" }, lines: [{ variantId: "variant", quantity: 2, sourceUnitPrice: "1000", effectiveUnitPrice: "1000", markdownRevisionId: null }] });
  const fp = buildCheckoutReviewContextFingerprint({ clientId: "client", contactPhone: pickup.phone, contactEmail: pickup.email,
    pickupDate: pickup.pickupDate, pickupTime: pickup.pickupTime, branchId: "branch", fulfillmentMethod: "pickup", promo: { kind: "none" },
    pricing: { ...pricing, discount: pricing.goodsDiscount }, lines: [{ cartItemId: "item", variantId: "variant", branchId: "branch", quantity: 2, sourceUnitPrice: "1000" }] });
  return { ...pickup, requestKey: "a1200000-0000-4000-8000-000000000023", promoSelection: { kind: "none" },
    reviewToken: createCheckoutReviewToken({ contextFingerprint: fp, promo: { kind: "none" } }).reviewToken };
}

const delivery = { fulfillmentMethod: "delivery", itemIds: ["item"], contactPhone: "081234567890", contactEmail: "test@example.invalid",
  addressId: "address", courierId: 1, serviceId: 2, originFingerprint: "a".repeat(64),
  approvedPricing: { subtotal: "2000.00", discount: "0.00", shippingCost: "500.00", taxableBase: "2500.00", serviceFee: "0.00", ppnRatePercent: "11", ppnAmount: "275.00", total: "2775.00" } };

function reviewedDelivery() {
  const pricing = buildPricingSnapshot({ fulfillmentMethod: "delivery", ppnRatePercent: 11, providerTax: { taxId: -2, ratePercent: "11" }, shippingBeforeSubsidy: "500", providerQuotedShippingCost: "500", lines: [{ variantId: "variant", quantity: 2, sourceUnitPrice: "1000", effectiveUnitPrice: "1000", markdownRevisionId: null }] });
  const net = { subtotal: "2000", discount: "0", shippingCost: "500", taxableBase: "2000", serviceFee: "0", ppnRatePercent: "11", ppnAmount: "220", total: "2720" };
  const deliverySnapshot = {
    address: { recipientName: "Customer", phone: "081234567890", fullAddress: "Destination", provinceId: "01", province: "Province", cityId: "0101", city: "City", districtId: "010101", district: "District", areaId: "area", area: "Area", postalCode: "01234" },
    origin: { branchId: "branch", name: "Branch", phone: "021123456", address: "Origin", zipcode: "01234", areaId: "area" },
    parcel: { weight: 200, items: [{ item_name: "Shoes Black / 40", quantity: 2, value: 1000, weight: 100, length: 10, width: 10, height: 10 }] },
    service: { courierId: 1, serviceId: 2, name: "Courier", shippingCost: 500 }, pricing: net,
  };
  const fingerprint = buildCheckoutReviewContextFingerprint({ clientId: "client", contactPhone: "081234567890", contactEmail: "test@example.invalid", pickupDate: null, pickupTime: null, branchId: "branch", fulfillmentMethod: "delivery", deliverySnapshot, promo: { kind: "none" }, pricing: { ...pricing, discount: pricing.goodsDiscount }, lines: [{ cartItemId: "item", variantId: "variant", branchId: "branch", quantity: 2, sourceUnitPrice: "1000" }] });
  return { ...delivery, approvedPricing: net, requestKey: "a1200000-0000-4000-8000-000000000023", promoSelection: { kind: "none" }, reviewToken: createCheckoutReviewToken({ contextFingerprint: fingerprint, promo: { kind: "none" } }).reviewToken };
}

describe("place-order legacy and attempt orchestration parity", () => {
  it.each(["accepted", "attempt"])("answers %s replay before pause, changed contract and expired review", async (kind) => {
    const body = reviewedPickup();
    state.acceptedReplay = kind === "accepted"; state.attemptReplay = kind === "attempt"; state.paused = true;
    vi.setSystemTime(new Date("2026-10-01T00:11:00Z"));
    const response = await submit(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, orderId: "retained", redirectUrl: "https://payment.invalid" });
    expect(state.liveReads).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state.payments).toEqual([]);
  });
  it("keeps request-key conflict ahead of all live checks", async () => {
    state.conflict = true;
    const response = await submit(reviewedPickup());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: "REQUEST_KEY_CONFLICT", error: "Request checkout ini sudah digunakan untuk pilihan berbeda." });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(state.liveReads).toEqual([]);
    expect(state.events).toEqual([]);
  });
  it("retains the complete v1 delivery snapshot through the attempt boundary", async () => {
    state.contract = 1;
    const response = await submit(reviewedDelivery());
    expect(response.status).toBe(201);
    expect(state.attemptInputs[0]).toMatchObject({ snapshot: { order: { fulfillmentMethod: "delivery", subtotal: "2000", shippingCost: "500", ppnAmount: "220", total: "2720", deliverySnapshot: { service: { shippingCost: 500 }, pricing: { total: "2720" } } }, createRequest: { originalShipmentCost: 500, shippingCost: 500, expectedProviderPayable: 2720 } } });
  });
  it.each(["pickup", "delivery"])("preserves direct promo rejection for %s instead of generic repricing", async (method) => {
    state.contract = 1;
    const body = method === "pickup" ? reviewedPickup() : reviewedDelivery();
    const response = await submit({ ...body, promoSelection: { kind: "public", offerId: "offer" } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: "PROMO_UNAVAILABLE", error: "Promo ini sedang tidak tersedia." });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(state.attemptInputs).toEqual([]);
    expect(state.events).toEqual([]);
  });
  it("saves a verified new destination under a stable scoped address id in the order transaction", async () => {
    const { addressId: _address, ...body } = delivery;
    void _address;
    const response = await submit({ ...body, saveAddress: true, saveRequestId: "a1200000-0000-4000-8000-000000000023", newAddress: { recipientName: "Customer", phone: "081234567890", fullAddress: "Destination", provinceId: "01", cityId: "0101", districtId: "010101", areaId: "01010101", postalCode: "01234", isDefault: false } });
    expect(response.status).toBe(200);
    const id = "checkout:305ee4abf0594cbf0b74382b9fb1a31bd9dfb8a1763cdfea030121e45a821912";
    expect(state.writes.find((write) => write.table === "address")?.values).toMatchObject({ id, userId: "client", firstName: "Customer", fullAddress: "Destination", postalCode: "01234" });
    expect(state.writes.find((write) => write.table === "orders")?.values).toMatchObject({ addressId: id });
  });
  it("persists an approved legacy delivery snapshot and original quoted shipping", async () => {
    const response = await submit(delivery);
    expect(response.status).toBe(200);
    expect(state.writes.find((write) => write.table === "orders")?.values).toMatchObject({ fulfillmentMethod: "delivery", pickupDate: null, pickupTime: null, total: "2775.00", deliverySnapshot: { service: { shippingCost: 500 }, pricing: { total: "2775.00" }, address: { recipientName: "Customer", fullAddress: "Destination" } } });
  });
  it.each(["service", "origin", "pricing"])("requires reapproval for changed delivery %s before any local writes", async (change) => {
    if (change === "service") state.missingService = true;
    const body = { ...delivery, ...(change === "origin" ? { originFingerprint: "b".repeat(64) } : {}), ...(change === "pricing" ? { approvedPricing: { ...delivery.approvedPricing, total: "1" } } : {}) };
    const response = await submit(body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: "DELIVERY_REPRICE_REQUIRED", data: { services: expect.any(Array) } });
    expect(state.events).toEqual([]);
    expect(state.writes.every((write) => write.table === "branch_stock")).toBe(true);
  });
  it.each([
    { error: new DeliveryQuoteDataError("NOT_FOUND", "Destination missing"), status: 404, body: { success: false, error: "Destination missing" } },
    { error: new DeliveryQuoteDataError("UNAVAILABLE", "Region unavailable"), status: 502, body: { success: false, error: "Region unavailable" } },
    { error: new QuoteDeliveryError("PROVIDER", "Provider unavailable"), status: 409, body: { success: false, code: "DELIVERY_REPRICE_REQUIRED", error: "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan.", data: { services: [] } } },
    { error: new PricingContractError("PRICING_INPUT_INVALID", "Changed"), status: 409, body: { success: false, code: "DELIVERY_REPRICE_REQUIRED", error: "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan.", data: { services: [] } } },
    { error: new Error("Unknown"), status: 409, body: { success: false, code: "DELIVERY_REPRICE_REQUIRED", error: "Ongkir telah berubah. Periksa kembali rincian pesanan sebelum melanjutkan.", data: { services: [] } } },
  ])("keeps delivery error boundary ($error.name, $status)", async ({ error, status, body }) => {
    state.quoteError = error;
    const response = await submit(delivery);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(state.events).toEqual([]);
  });
  it("keeps legacy order/intent before SO, payment outside transaction, and cart removal after payment", async () => {
    const response = await submit();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, orderId: "00000000-0000-4000-8000-000000000001", redirectUrl: "https://payment.invalid", token: "token" });
    expect(state.events).toEqual(["transaction", "intent", "payment-intent", "sales", "payment-claim", "payment", "payment-outcome"]);
    expect(state.writes.find((write) => write.table === "orders")?.values).toMatchObject({ subtotal: "2000.00", ppnAmount: "220.00", total: "2220.00", fulfillmentMethod: "pickup", expiresAt: new Date("2026-10-01T00:15:00Z") });
    expect(state.payments[0]).toMatchObject([expect.any(String), 2220, { first_name: "Customer", email: "test@example.invalid", phone: "081234567890" }, expect.any(Array), 15, new Date("2026-10-01T00:00:00Z")]);
    expect(state.creates[0]).toMatchObject({ type: "create", payload: { create: { refNo: "00000000-0000-4000-8000-000000000001", note: "SO_CREATE:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002", contactId: -1, locationId: 7, customerName: "Customer", items: [{ itemId: 101, quantity: 2, price: 1000, discAmount: 0, taxAmount: 0, unit: "Buah", taxId: 1 }] } } });
  });
  it("compensates definitive legacy SO rejection without starting payment or removing cart", async () => {
    state.sales = "rejected";
    const response = await submit();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, error: "Stock produk berubah atau tidak mencukupi. Silakan periksa keranjang Anda." });
    expect(state.events).toEqual(["transaction", "intent", "payment-intent", "sales", "transaction"]);
    expect(state.writes.filter((write) => write.table === "orders").at(-1)?.values).toMatchObject({ status: "failed_payment", paymentStatus: "failed", midtransFailureStatus: "sales_order_rejected" });
  });
  it.each(["manual_review", "in_flight"])("keeps unknown legacy SO (%s) pending without payment", async (sales) => {
    state.sales = sales;
    const response = await submit();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, error: "Pesanan sedang diproses. Tim kami akan mengonfirmasi ketersediaan stok — silakan cek status pesanan atau hubungi kami." });
    expect(state.events).toEqual(["transaction", "intent", "payment-intent", "sales"]);
  });
  it("reports an unknown legacy payment instead of compensating on a provider exception", async () => {
    // Spec TX-02 §8.2: a thrown/lost provider response is UNKNOWN, never a
    // definitive rejection, so no compensation and no Sales-Order cancel runs.
    state.paymentFails = true;
    const response = await submit();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "PAYMENT_INITIALIZATION_UNKNOWN",
      orderId: "00000000-0000-4000-8000-000000000001",
      redirectUrl: null,
    });
    expect(state.events).toEqual(["transaction", "intent", "payment-intent", "sales", "payment-claim", "payment", "payment-outcome"]);
    expect(state.events).not.toContain("compensate");
  });
  it("reports an unknown payment when the session handle cannot be persisted", async () => {
    // AC10: a persistence failure is NOT a definitive rejection. The order stays
    // owned by the customer and no compensation/SO cancel runs.
    state.persistFails = true;
    const response = await submit();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: false, code: "PAYMENT_INITIALIZATION_UNKNOWN" });
    expect(state.events).not.toContain("compensate");
  });
  it.each([
    { error: new PricingContractError("PRICING_INPUT_INVALID", "Source changed"), code: "CHECKOUT_REVIEW_REQUIRED", message: "Source changed", cache: null },
    { error: new RedemptionReviewChangedError(), code: "CHECKOUT_REVIEW_REQUIRED", message: "Periksa kembali rincian pesanan dan konfirmasikan checkout terbaru.", cache: "no-store" },
  ])("retains transaction-phase error translation ($error.name)", async ({ error, code, message, cache }) => {
    state.txError = error;
    const response = await submit();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code, error: message });
    expect(response.headers.get("Cache-Control")).toBe(cache);
    expect(state.events).toEqual([]);
  });
  it("selects the v2 attempt pipeline only for snapshot plus request identity", async () => {
    state.contract = 1;
    const response = await submit(reviewedPickup());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, orderId: "order", redirectUrl: "https://payment.invalid" });
    expect(state.events).toEqual([]);
    expect(state.attemptInputs).toHaveLength(1);
    expect(state.attemptInputs[0]).toMatchObject({ clientId: "client", branchId: "branch", paymentStartedAt: new Date("2026-10-01T00:00:00Z"), expiresAt: new Date("2026-10-01T00:15:00Z"), snapshot: { order: { subtotal: "2000", total: "2220", providerContractVersion: 3 }, createRequest: { providerContractVersion: 3, items: [{ itemId: 101, price: 1000, quantity: 2, discAmount: 0, taxAmount: 220, taxId: -2 }] } } });
  });
});
