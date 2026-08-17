import { describe, expect, it, vi } from "vitest";
import { initializeReservedOrderPayment } from "./payment-initialization";

describe("initializeReservedOrderPayment", () => {
  it("compensates a reservation when payment creation fails", async () => {
    const gatewayError = new Error("gateway unavailable");
    const compensate = vi.fn().mockResolvedValue(undefined);

    await expect(
      initializeReservedOrderPayment({
        create: vi.fn().mockRejectedValue(gatewayError),
        persist: vi.fn(),
        compensate,
      })
    ).rejects.toThrow("gateway unavailable");
    expect(compensate).toHaveBeenCalledOnce();
  });

  it("returns the gateway result even if persistence needs reconciliation", async () => {
    const result = { redirectUrl: "https://pay.example/order", token: "token" };
    const initialized = await initializeReservedOrderPayment({
      create: vi.fn().mockResolvedValue(result),
      persist: vi.fn().mockRejectedValue(new Error("database unavailable")),
      compensate: vi.fn(),
    });

    expect(initialized.payment).toEqual(result);
    expect(initialized.persistenceError).toBeInstanceOf(Error);
  });
});
