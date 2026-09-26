import { describe, it, expect } from "vitest";
import {
  describeFailureReason,
  generatePickupCode,
  resolvePaymentOutcome,
} from "./order-finalize";

// Backs the Midtrans webhook status dispatch (multi-method Snap flow).
describe("resolvePaymentOutcome", () => {
  it("finalizes on settlement", () => {
    expect(resolvePaymentOutcome("settlement")).toBe("finalize");
  });

  it("finalizes on capture with accepted fraud", () => {
    expect(resolvePaymentOutcome("capture", "accept")).toBe("finalize");
  });

  it("defers on capture without an accepted fraud status", () => {
    expect(resolvePaymentOutcome("capture", "challenge")).toBe("defer");
    expect(resolvePaymentOutcome("capture")).toBe("defer");
  });

  it("fails only on expire", () => {
    expect(resolvePaymentOutcome("expire")).toBe("fail");
  });

  it("defers non-terminal attempt statuses (Snap allows method retries)", () => {
    expect(resolvePaymentOutcome("pending")).toBe("defer");
    expect(resolvePaymentOutcome("deny")).toBe("defer");
    expect(resolvePaymentOutcome("cancel")).toBe("defer");
    expect(resolvePaymentOutcome("failure")).toBe("defer");
  });
});

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
// The retired adjustment-era helpers (canFinalizeReservedStock /
// getStockFinalizationDeltas) were removed with the Sales-Order cutover: the
// SO flow never touches the local `stock` mirror at settlement — the provider
// owns the units from SO creation until fulfillment.
