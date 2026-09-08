import { describe, expect, it } from "vitest";
import {
  buildResetPasswordPayload,
  resetPasswordSchema,
} from "./reset-password-contract";

describe("reset password request contract", () => {
  it("omits password in generated mode", () => {
    expect(buildResetPasswordPayload("generate", "")).toEqual({
      passwordMode: "generate",
    });
    expect(resetPasswordSchema.safeParse({ passwordMode: "generate" }).success).toBe(true);
  });

  it("requires a valid password in manual mode", () => {
    expect(resetPasswordSchema.safeParse({ passwordMode: "manual" }).success).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ passwordMode: "manual", password: "short" }).success
    ).toBe(false);
    expect(
      buildResetPasswordPayload("manual", "valid-pass-123")
    ).toEqual({ passwordMode: "manual", password: "valid-pass-123" });
    expect(
      resetPasswordSchema.safeParse({
        passwordMode: "manual",
        password: "valid-pass-123",
      }).success
    ).toBe(true);
  });
});
