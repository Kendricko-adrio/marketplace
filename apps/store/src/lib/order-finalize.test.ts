import { describe, it, expect } from "vitest";
import {
  canFinalizeReservedStock,
  describeFailureReason,
  generatePickupCode,
} from "./order-finalize";

// Backs the Midtrans webhook failure path (claimAndFailOrder) and the sweep
// cron's failure reason mapping.
describe("describeFailureReason", () => {
  it("maps expire to the expiry message", () => {
    expect(describeFailureReason("expire")).toBe(
      "Payment expired — user did not complete payment in time"
    );
  });

  it("maps deny with a status message", () => {
    expect(describeFailureReason("deny", "3DS authentication failed")).toBe(
      "Payment denied by issuer/acquirer (3DS authentication failed)"
    );
  });

  it("maps deny without a status message", () => {
    expect(describeFailureReason("deny")).toBe(
      "Payment denied by issuer/acquirer"
    );
  });

  it("maps cancel", () => {
    expect(describeFailureReason("cancel")).toBe("Payment cancelled");
  });

  it("returns null for non-failure statuses", () => {
    expect(describeFailureReason("settlement")).toBeNull();
    expect(describeFailureReason("capture")).toBeNull();
    expect(describeFailureReason("pending")).toBeNull();
  });
});

describe("generatePickupCode", () => {
  it("creates a six-character code without ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePickupCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});

describe("canFinalizeReservedStock", () => {
  it("requires both physical stock and reservation to cover the order", () => {
    expect(canFinalizeReservedStock(5, 3, 3)).toBe(true);
    expect(canFinalizeReservedStock(2, 3, 3)).toBe(false);
    expect(canFinalizeReservedStock(5, 2, 3)).toBe(false);
  });
});
