import { describe, it, expect } from "vitest";
import {
  getFailedPickupAttemptUpdate,
  isPickupVerificationLocked,
  verifyPickupCode,
} from "./pickup-code";

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

describe("pickup verification throttling", () => {
  const now = new Date("2026-08-17T10:00:00Z");

  it("locks verification after five failed attempts", () => {
    expect(getFailedPickupAttemptUpdate(4, now)).toEqual({
      attempts: 5,
      lockedUntil: new Date("2026-08-17T10:15:00.000Z"),
    });
  });

  it("recognizes an active lock and an expired lock", () => {
    expect(
      isPickupVerificationLocked(new Date("2026-08-17T10:01:00Z"), now)
    ).toBe(true);
    expect(
      isPickupVerificationLocked(new Date("2026-08-17T09:59:00Z"), now)
    ).toBe(false);
  });
});
