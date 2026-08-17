import { describe, expect, it } from "vitest";
import { getClientAccessError } from "./client-access";

describe("getClientAccessError", () => {
  it("requires authentication", () => {
    expect(getClientAccessError(null)).toEqual({
      status: 401,
      code: "UNAUTHORIZED",
      error: "Unauthorized",
    });
  });

  it("requires completed onboarding", () => {
    expect(getClientAccessError({ onboardingCompleted: false })).toEqual({
      status: 403,
      code: "ONBOARDING_REQUIRED",
      error: "Onboarding required",
    });
  });

  it("allows an onboarded client", () => {
    expect(getClientAccessError({ onboardingCompleted: true })).toBeNull();
  });
});
