import { describe, it, expect } from "vitest";
import { verifyPickupCode } from "./pickup-code";

// Backs POST /api/admin/orders/{id}/verify-pickup code comparison.
describe("verifyPickupCode", () => {
  it("accepts an exact match", () => {
    expect(verifyPickupCode("G4XUNM", "G4XUNM")).toBe(true);
  });

  it("rejects a wrong code", () => {
    expect(verifyPickupCode("AAAAAA", "G4XUNM")).toBe(false);
  });

  it("rejects a code of a different length", () => {
    expect(verifyPickupCode("G4XUN", "G4XUNM")).toBe(false);
    expect(verifyPickupCode("G4XUNMM", "G4XUNM")).toBe(false);
  });

  it("rejects when the stored code is missing", () => {
    expect(verifyPickupCode("G4XUNM", null)).toBe(false);
    expect(verifyPickupCode("G4XUNM", undefined)).toBe(false);
    expect(verifyPickupCode("G4XUNM", "")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(verifyPickupCode("g4xunm", "G4XUNM")).toBe(false);
  });
});
