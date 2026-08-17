import { describe, expect, it } from "vitest";
import { getPasswordPolicyError } from "./password-policy";

describe("getPasswordPolicyError", () => {
  it("validates newPassword on reset and change endpoints", () => {
    expect(
      getPasswordPolicyError("/reset-password", "POST", {
        newPassword: "alllowercase1",
      })
    ).toBe("Password harus mengandung huruf besar, huruf kecil, dan angka.");
    expect(
      getPasswordPolicyError("/change-password", "POST", {
        newPassword: "StrongPass1",
      })
    ).toBeNull();
  });

  it("validates password on sign-up", () => {
    expect(
      getPasswordPolicyError("/sign-up/email", "POST", {
        password: "StrongPass1",
      })
    ).toBeNull();
  });

  it("ignores unrelated endpoints", () => {
    expect(getPasswordPolicyError("/sign-in/email", "POST", {})).toBeNull();
  });
});
