import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeCheckoutOrder, type PlaceCheckoutOrderInput } from "./place-checkout-service";

const mocks = vi.hoisted(() => ({ pause: vi.fn(), accepted: vi.fn(), attempt: vi.fn(), cart: vi.fn(), place: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/config", async (original) => ({ ...await original<typeof import("@/lib/config")>(), getConfigString: mocks.pause, getDiscountsContractVersion: async () => 0 }));
vi.mock("@/lib/checkout-request", async (original) => ({ ...await original<typeof import("@/lib/checkout-request")>(), findAcceptedCheckout: mocks.accepted }));
vi.mock("./place-order-repository", async (original) => ({ ...await original<typeof import("./place-order-repository")>(), loadCart: mocks.cart }));
vi.mock("./place-order-service", () => ({ replayCheckoutAttempt: mocks.attempt, placeCheckout: mocks.place }));
vi.mock("./place-order-legacy-service", () => ({ placeOrderLegacy: mocks.legacy }));

function input(versioned = false): PlaceCheckoutOrderInput {
  return {
    actor: { id: "client", name: "Customer" }, isDelivery: false, recovery: {},
    input: { phone: "081234567890", email: "test@example.invalid", pickupDate: "2030-01-01", pickupTime: "10:00", selectedItemIds: ["item"],
      ...(versioned ? { requestKey: "a1200000-0000-4000-8000-000000000023", reviewToken: `${Buffer.from(JSON.stringify({ fp: "a".repeat(64) })).toString("base64url")}.expired` } : {}) },
    admit: vi.fn(async () => undefined),
    initializeCheckoutPayment: vi.fn(async () => ({ kind: "ready" as const, token: "token", redirectUrl: "https://payment.invalid" })),
    createLegacyPayment: vi.fn(async () => ({ token: "token", redirectUrl: "https://payment.invalid" })),
  };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.pause.mockResolvedValue("false"); mocks.accepted.mockResolvedValue(null); mocks.attempt.mockResolvedValue(null); mocks.cart.mockResolvedValue([]);
});
describe("place checkout use case public outcome", () => {
  it("returns a domain rejection while checkout is paused without cart/provider work", async () => {
    mocks.pause.mockResolvedValue(" TRUE ");
    expect(await placeCheckoutOrder(input())).toEqual({ kind: "rejected", reason: "paused", data: { success: false, code: "POLICY_UNAVAILABLE", error: "Checkout sedang dijeda sementara." } });
    expect(mocks.cart).not.toHaveBeenCalled(); expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("fails closed on an unreadable pause config", async () => {
    mocks.pause.mockRejectedValue(new Error("DB unavailable"));
    expect(await placeCheckoutOrder(input())).toMatchObject({ kind: "rejected", reason: "paused" });
    expect(mocks.cart).not.toHaveBeenCalled();
  });
  it("answers accepted replay before current pause/config and providers", async () => {
    const accepted = { requestKey: "a1200000-0000-4000-8000-000000000023", orderId: "order", state: "payment_ready", paymentAvailable: true, redirectUrl: "https://payment.invalid", expiresAt: null };
    mocks.accepted.mockResolvedValue(accepted);
    expect(await placeCheckoutOrder(input(true))).toEqual({ kind: "accepted", result: accepted, replay: true });
    expect(mocks.pause).not.toHaveBeenCalled(); expect(mocks.attempt).not.toHaveBeenCalled(); expect(mocks.cart).not.toHaveBeenCalled();
  });
  it("answers a retained attempt without repeating the creator pipeline", async () => {
    const retained = { version: 2, attemptId: "attempt", state: "manual_review", orderId: null, replayed: true };
    mocks.attempt.mockResolvedValue(retained);
    expect(await placeCheckoutOrder(input(true))).toEqual({ kind: "attempt", result: retained });
    expect(mocks.pause).not.toHaveBeenCalled(); expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it("stops at the missing cart without choosing either lifecycle", async () => {
    expect(await placeCheckoutOrder(input())).toEqual({ kind: "rejected", reason: "cart-empty", data: { success: false, error: "Cart is empty" } });
    expect(mocks.cart).toHaveBeenCalledWith("client"); expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
});
